import { useEffect, useMemo, useState } from 'react'
import { Activity as ActivityIcon, Archive, ArrowDownToLine, CheckCircle2, ChevronDown, CircleAlert, ClipboardPaste, Clock3, Copy, Database, Download, FileSpreadsheet, Filter, History, LayoutDashboard, ListTodo, PackageCheck, RefreshCw, Search, Settings, ShieldCheck, Trash2, Upload, X } from 'lucide-react'
import * as XLSX from 'xlsx'
import { db } from './db'
import { commitImport } from './importer'
import type { Shipment, ImportBatch, Activity, PodStatus, ImportPreview } from './types'
import { parseRows, todayLocal, defaultColumnMap } from './parser'

type Page='dashboard'|'pending'|'pod'|'failed'|'import'|'history'|'activity'|'settings'
type ShipmentWithDue = Shipment & { dueTimestamp: number }
const labels:Record<Page,string>={dashboard:'ภาพรวม',pending:'งานรอดำเนินการ',pod:'POD Completed',failed:'ไม่สามารถ POD',import:'นำเข้าข้อมูล',history:'ประวัติการนำเข้า',activity:'ประวัติการเปลี่ยนแปลง',settings:'สำรองข้อมูล'}
const money=(n:number|null)=>n===null?'-':n.toLocaleString('th-TH',{minimumFractionDigits:0,maximumFractionDigits:2})
const dateLabel=(s:string)=>s?new Date(s).toLocaleString('th-TH'):'-'
const statusLabel=(s:PodStatus)=>s==='POD'?'POD':s==='FAILED'?'ไม่สามารถ POD':'รอดำเนินการ'

// แปลงวันที่รูปแบบ DD/MM/YYYY, HH:mm:ss เป็น timestamp ตามเวลาไทย (UTC+7)

/**
 * แปลง Due Date เป็น Timestamp ตามเวลาไทย (UTC+7)
 * รองรับ:
 * 1. DD/MM/YYYY, HH:mm:ss
 * 2. YYYY-MM-DD HH:mm:ss
 * 3. YYYY-MM-DDTHH:mm:ss
 */
function parseDueDate(value: string | null | undefined): number | null {
  if (!value) return null

  const input = value.trim()

  // รูปแบบ DD/MM/YYYY, HH:mm:ss
  const thaiFormat = input.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/
  )

  // รูปแบบ YYYY-MM-DD HH:mm:ss หรือ YYYY-MM-DDTHH:mm:ss
const isoFormat = input.match(
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/
)

  let day: string
  let month: string
  let year: string
  let hour: string
  let minute: string
  let second: string

  if (thaiFormat) {
    [, day, month, year, hour, minute, second = '0'] = thaiFormat
  } else if (isoFormat) {
    [, year, month, day, hour, minute, second = '0'] = isoFormat
  } else {
    return null
  }

  const d = Number(day)
  const m = Number(month)
  const y = Number(year)
  const h = Number(hour)
  const min = Number(minute)
  const sec = Number(second)

  // ตรวจสอบช่วงวันที่และเวลา
  if (
    m < 1 || m > 12 ||
    d < 1 || d > 31 ||
    h < 0 || h > 23 ||
    min < 0 || min > 59 ||
    sec < 0 || sec > 59
  ) return null

  // แปลงเวลาไทย UTC+7 เป็น UTC Timestamp
  const timestamp = Date.UTC(y, m - 1, d, h - 7, min, sec)

  // ตรวจสอบว่าวันที่มีอยู่จริง
  const check = new Date(timestamp + 7 * 60 * 60 * 1000)

  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== min ||
    check.getUTCSeconds() !== sec
  ) return null

  return timestamp
}

// แสดงวันที่เป็น DD/MM/YYYY HH:mm:ss ตามเวลาไทย (UTC+7)
function formatDueDate(value: string | null | undefined): string {
  const timestamp = parseDueDate(value)

  if (timestamp === null) return '-'

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp))

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '00'

  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`
}


function bangkokDateParts(timestamp:number){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(timestamp))
  const get=(type:string)=>parts.find(p=>p.type===type)?.value||'00'
  return {year:Number(get('year')),month:Number(get('month')),day:Number(get('day'))}
}
function bangkokWindow(timestamp:number){
  const {year,month,day}=bangkokDateParts(timestamp)
  const start=Date.UTC(year,month-1,day,-7,0,0)
  const tomorrow=Date.UTC(year,month-1,day+1,-7,10,0)
  return {start,end:tomorrow}
}
function formatRemaining(milliseconds:number){
  const total=Math.max(0,Math.floor(milliseconds/1000))
  const hours=Math.floor(total/3600)
  const minutes=Math.floor((total%3600)/60)
  const seconds=total%60
  return [hours,minutes,seconds].map(v=>String(v).padStart(2,'0')).join(':')
}
function formatBangkokDate(timestamp:number){
  return new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(timestamp))
}
export default function App(){
  const [page,setPage]=useState<Page>('dashboard')
  const [workDate,setWorkDate]=useState(todayLocal())
  const [shipments,setShipments]=useState<Shipment[]>([])
  const [batches,setBatches]=useState<ImportBatch[]>([])
  const [activities,setActivities]=useState<Activity[]>([])
  const [query,setQuery]=useState('')
  const [payment,setPayment]=useState('ALL')
  const [paste,setPaste]=useState('')
  const [preview,setPreview]=useState<ImportPreview|null>(null)
  const [result,setResult]=useState<{added:number;updated:number;unchanged:number;total:number;duplicates:number}|null>(null)
  const [busy,setBusy]=useState(false)
  const [notice,setNotice]=useState('')
  const [showArchived,setShowArchived]=useState(false)
  const [allShipments,setAllShipments]=useState<Shipment[]>([])
  const [clockNow,setClockNow]=useState(()=>Date.now())
  useEffect(()=>{const timer=window.setInterval(()=>setClockNow(Date.now()),1000);return()=>window.clearInterval(timer)},[])
async function refresh() {
  const [all, b, a] = await Promise.all([
    db.shipments.toArray(),
    db.batches.orderBy('importedAt').reverse().toArray(),
    db.activities.orderBy('at').reverse().limit(500).toArray(),
  ])

  // ปรับข้อมูลเก่าให้ Due Date ตรงกับ Source Date
  const needsUpdate = all.filter(
    (x) => x.dueDate !== x.sourceDate
  )

  if (needsUpdate.length > 0) {
    await db.shipments.bulkPut(
      needsUpdate.map((x) => ({
        ...x,
        dueDate: x.sourceDate,
      }))
    )
  }

  // ใช้ข้อมูลหลังปรับปรุงแล้ว
  const updatedAll =
    needsUpdate.length > 0
      ? all.map((x) =>
          x.dueDate !== x.sourceDate
            ? { ...x, dueDate: x.sourceDate }
            : x
        )
      : all

  const selectedShipments = updatedAll
    .filter((x) => x.workDate === workDate)
    .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt))

  setShipments(selectedShipments)
  setBatches(b)
  setActivities(a)
  setAllShipments(updatedAll)
}
  useEffect(()=>{refresh().catch(e=>setNotice(String(e)))},[workDate])
  const current=shipments
  const counts=useMemo(()=>({total:current.length,pending:current.filter(x=>x.status==='PENDING').length,pod:current.filter(x=>x.status==='POD').length,failed:current.filter(x=>x.status==='FAILED').length,cod:current.filter(x=>x.payment.toUpperCase()==='COD').length,noncod:current.filter(x=>x.payment.toUpperCase().includes('NON')).length,codAmount:current.filter(x=>x.payment.toUpperCase()==='COD').reduce((a,x)=>a+(x.amount??0),0)}),[current])
  const filtered=useMemo(()=>current.filter(x=>{
    const q=query.toLowerCase()
    return (page==='pending'?x.status==='PENDING':page==='pod'?x.status==='POD':page==='failed'?x.status==='FAILED':true) &&
      (!q||[x.tracking,x.address,x.carrier,x.code].some(v=>v.toLowerCase().includes(q))) &&
      (payment==='ALL'||x.payment.toUpperCase()===payment)
  }),[current,page,query,payment])
  // ใช้ฐานข้อมูลทุกวัน ไม่จำกัด workDate ที่เลือกด้านบน
  const deadlineGroups=useMemo(()=>{
    const {start,end}=bangkokWindow(clockNow)
    const pending=allShipments
      .filter(x=>x.status==='PENDING')
      .map(x=>({...x,dueTimestamp:parseDueDate(x.dueDate || x.sourceDate)}))
    const parsedPending:ShipmentWithDue[]=pending.filter((x):x is ShipmentWithDue=>x.dueTimestamp!==null)
    const inWindow=parsedPending.filter(x=>x.dueTimestamp>=start&&x.dueTimestamp<=end)
      .sort((a,b)=>a.dueTimestamp-b.dueTimestamp)
    const urgent=inWindow.filter(x=>x.dueTimestamp>=clockNow&&x.dueTimestamp-clockNow<=3*60*60*1000)
    const overdue=inWindow.filter(x=>x.dueTimestamp<clockNow)
    return {inWindow,urgent,overdue,invalidCount:allShipments.filter(x=>x.status==='PENDING'&&!parseDueDate(x.dueDate || x.sourceDate)).length}
  },[allShipments,clockNow])
  async function copyDeadlineRows(rows:Shipment[],label:string){
    if(!rows.length){setNotice(`ไม่มีรายการ${label}ให้คัดลอก`);return}
    const header=['Tracking','Payment','ยอดเงิน','กำหนดส่ง','ที่อยู่']
    const lines=rows.map(x=>[
      x.tracking,
      x.payment||'-',
      x.amount===null||x.amount===undefined?'-':String(x.amount),
      formatDueDate(x.dueDate || x.sourceDate),
      (x.address||'-').replace(/[\t\r\n]+/g,' ')
    ].join('\t'))
    try{
      await navigator.clipboard.writeText([header.join('\t'),...lines].join('\n'))
      setNotice(`คัดลอก${label}สำเร็จ ${rows.length.toLocaleString()} รายการ`)
    }catch{
      setNotice('คัดลอกไม่สำเร็จ กรุณาใช้งานผ่าน HTTPS หรือ localhost')
    }
  }
async function makePreview() {
  setResult(null)

  const p = parseRows(paste)

  console.log('========== IMPORT DEBUG ==========')
  console.log('จำนวนบรรทัดต้นฉบับ:', paste.trim().split(/\r?\n/).filter(Boolean).length)
  console.log('จำนวนรายการที่อ่านได้:', p.rows.length)
  console.log('จำนวน Tracking ซ้ำ:', p.duplicateCount)
  console.log('จำนวน POD Overrides:', p.podOverrides)
  console.log('จำนวนข้อผิดพลาด:', p.errors.length)
  console.log('รายการที่อ่านได้ทั้งหมด:', p.rows)
  console.log('ข้อผิดพลาด:', p.errors)
  console.log('==================================')

  setPreview(p)

  if (!p.rows.length) {
    setNotice('ไม่พบรายการที่มี Tracking ถูกต้อง กรุณาตรวจรูปแบบข้อมูลหรือ Column Mapping')
  }
}
async function doImport() {
  if (!preview?.rows.length) return

  setBusy(true)

  try {
    const rows = preview.rows.map((row) => ({
      ...row,
      dueDate: row.sourceDate,
    }))

    const r = await commitImport(
      rows,
      preview.duplicateCount,
      workDate
    )

    setResult(r)
    setPaste('')
    setPreview(null)
    setNotice('นำเข้าข้อมูลเรียบร้อย')
    await refresh()
  } catch (e) {
    setNotice(`นำเข้าไม่สำเร็จ: ${String(e)}`)
  } finally {
    setBusy(false)
  }
}
  // คัดลอก Tracking ของงานรอดำเนินการทั้งหมดในวันที่เลือก (ไม่ขึ้นกับตัวกรองค้นหา/Payment)
  async function copyAllPendingTracking(){
    const trackingList=current
      .filter(x=>x.status==='PENDING')
      .map(x=>x.tracking.trim())
      .filter(Boolean)

    if(!trackingList.length){
      setNotice('ไม่พบ Tracking ในงานรอดำเนินการ')
      return
    }

    try{
      await navigator.clipboard.writeText(trackingList.join('\n'))
      setNotice(`คัดลอก Tracking สำเร็จ ${trackingList.length.toLocaleString()} รายการ`)
    }catch{
      setNotice('คัดลอกไม่สำเร็จ กรุณาใช้งานผ่าน HTTPS หรือ localhost แล้วลองอีกครั้ง')
    }
  }
  function exportRows(rows:Shipment[],name:string){
    const data=rows.map(x=>({'Tracking':x.tracking,'Carrier':x.carrier,'Code':x.code,'Date':formatDueDate(x.sourceDate),'POD Status':statusLabel(x.status),'Remark':x.remark,'Priority':x.priority,'Payment':x.payment,'Ref':x.ref,'Amount':x.amount,'Due Date':formatDueDate(x.dueDate || x.sourceDate),'Address':x.address,'Work Date':x.workDate}))
    const ws=XLSX.utils.json_to_sheet(data);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Shipments');XLSX.writeFile(wb,name)
  }
  async function backup(){
    const payload={app:'POD Management',version:1,exportedAt:new Date().toISOString(),shipments:await db.shipments.toArray(),batches:await db.batches.toArray(),activities:await db.activities.toArray()}
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})
    downloadBlob(blob,`pod-backup-${todayLocal()}.json`)
  }
  async function restore(file:File){
    try{
      const obj=JSON.parse(await file.text())
      if(obj.app!=='POD Management'||!Array.isArray(obj.shipments)||!Array.isArray(obj.batches)||!Array.isArray(obj.activities))throw new Error('รูปแบบไฟล์ Backup ไม่ถูกต้อง')
      if(!confirm('การกู้คืนจะแทนที่ข้อมูลปัจจุบันทั้งหมด ต้องการดำเนินการหรือไม่?'))return
      await db.transaction('rw',db.shipments,db.batches,db.activities,async()=>{
        await db.shipments.clear();await db.batches.clear();await db.activities.clear()
        await db.shipments.bulkAdd(obj.shipments);await db.batches.bulkAdd(obj.batches);await db.activities.bulkAdd(obj.activities)
      })
      setNotice('กู้คืนข้อมูลสำเร็จ');await refresh()
    }catch(e){setNotice(`กู้คืนไม่สำเร็จ: ${String(e)}`)}
  }
  async function clearAll(){
    if(!confirm('ยืนยันลบข้อมูลทั้งหมดจาก Browser นี้? แนะนำให้สำรองข้อมูลก่อน'))return
    await db.transaction('rw',db.shipments,db.batches,db.activities,async()=>{await db.shipments.clear();await db.batches.clear();await db.activities.clear()})
    setNotice('ล้างข้อมูลเรียบร้อย');await refresh()
  }
  const navGroups=[
    {title:'WORKSPACE',items:[['dashboard',LayoutDashboard],['pending',ListTodo],['pod',CheckCircle2],['failed',CircleAlert]] as const},
    {title:'DATA MANAGEMENT',items:[['import',ClipboardPaste],['history',History],['activity',ActivityIcon],['settings',Settings]] as const}
  ]
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><PackageCheck size={22}/></div><div><b>POD MANAGEMENT</b><small>DELIVERY WORKSPACE</small></div></div>
      <div className="side-label">MENU</div>
      {navGroups.map(group=><div key={group.title}><div className="side-label">{group.title}</div>{group.items.map(([key,Icon])=><button key={key} className={`nav-item ${page===key?'active':''}`} onClick={()=>{setPage(key);setQuery('')}}><Icon size={18}/><span>{labels[key]}</span>{key==='pending'&&<em>{counts.pending}</em>}</button>)}</div>)}
      <div className="sidebar-bottom"><ShieldCheck size={16}/><span>ข้อมูลจัดเก็บในเครื่องนี้เท่านั้น</span></div>
    </aside>
    <main className="main">
      <header className="topbar"><div><div className="eyebrow">DELIVERY OPERATIONS / {labels[page].toUpperCase()}</div><h1>{labels[page]}</h1></div><div className="top-actions"><label className="date-control"><span>วันที่ทำงาน</span><input type="date" value={workDate} onChange={e=>setWorkDate(e.target.value)}/></label><button className="icon-btn" title="Refresh" onClick={()=>refresh()}><RefreshCw size={17}/></button></div></header>
      {notice&&<div className="notice"><span>{notice}</span><button onClick={()=>setNotice('')}><X size={16}/></button></div>}
      {page==='dashboard'&&<div className="page-content">
        <div className="welcome-row"><div><h2>สรุปงานประจำวัน</h2><p>ภาพรวมรายการพัสดุของวันที่ {new Date(workDate+'T00:00:00').toLocaleDateString('th-TH',{dateStyle:'long'})}</p></div><button className="btn primary" onClick={()=>setPage('import')}><Upload size={16}/> นำเข้าข้อมูล</button></div>
        <div className="stats-grid">
          <Stat icon={<PackageCheck/>} label="พัสดุทั้งหมด" value={counts.total} tone="blue"/>
          <Stat icon={<Clock3/>} label="รอดำเนินการ" value={counts.pending} tone="amber"/>
          <Stat icon={<CheckCircle2/>} label="POD สำเร็จ" value={counts.pod} tone="green"/>
          <Stat icon={<CircleAlert/>} label="ไม่สามารถ POD" value={counts.failed} tone="red"/>
        </div>
        <div className="stats-grid secondary-stats">
          <Stat icon={<FileSpreadsheet/>} label="COD" value={counts.cod} tone="blue"/>
          <Stat icon={<Archive/>} label="Non-COD" value={counts.noncod} tone="gray"/>
          <Stat icon={<Download/>} label="ยอด COD รวม" value={`${money(counts.codAmount)} ฿`} tone="green"/>
          <Stat icon={<History/>} label="วันทำงานที่มีข้อมูล" value={new Set(allShipments.map(x=>x.workDate)).size} tone="gray"/>
        </div>
        <div className="content-grid"><section className="panel"><div className="panel-head"><div><h3>สถานะงานวันนี้</h3><p>สัดส่วนสถานะจากรายการทั้งหมด</p></div></div><div className="status-bars">{[['Pending',counts.pending,'blue'],['POD',counts.pod,'green'],['Failed',counts.failed,'red']].map(([name,val,color])=><div className="bar-row" key={String(name)}><div><span>{name}</span><b>{val}</b></div><div className="bar-track"><i className={String(color)} style={{width:`${counts.total?Number(val)/counts.total*100:0}%`}}/></div></div>)}</div></section>
        <section className="panel"><div className="panel-head"><div><h3>นำเข้าล่าสุด</h3><p>ประวัติการนำเข้าล่าสุด</p></div><button className="text-btn" onClick={()=>setPage('history')}>ดูทั้งหมด</button></div>{batches.slice(0,4).map(b=><div className="batch-mini" key={b.id}><div><b>{b.workDate}</b><small>{dateLabel(b.importedAt)}</small></div><strong>{b.totalRows} รายการ</strong></div>)}{!batches.length&&<Empty text="ยังไม่มีประวัติการนำเข้า"/>}</section></div>
        <section className="panel"><div className="panel-head"><div><h3>งานที่ต้องติดตาม</h3><p>รายการ Pending ล่าสุด</p></div><button className="text-btn" onClick={()=>setPage('pending')}>ดูรายการทั้งหมด</button></div><ShipmentTable rows={current.filter(x=>x.status==='PENDING').slice(0,6)} onExport={()=>exportRows(current.filter(x=>x.status==='PENDING'),'pending.xlsx')}/></section>
      </div>}
      {page==='import'&&<div className="page-content narrow"><div className="panel import-panel"><div className="panel-head"><div><h3>วางข้อมูลพัสดุ</h3><p>คัดลอกแถวจาก Google Sheets แล้ววางในช่องด้านล่าง โดยไม่ต้องมี Header</p></div><span className="safe-tag"><ShieldCheck size={14}/> Local only</span></div><textarea className="paste-area" value={paste} onChange={e=>{setPaste(e.target.value);setPreview(null);setResult(null)}} placeholder="วางข้อมูลจาก Google Sheets ที่นี่... รองรับการคัดลอกตารางแบบ Tab-separated หรือคั่นด้วย |"/><div className="import-actions"><span>{paste.trim()?paste.trim().split(/\r?\n/).filter(Boolean).length:0} บรรทัด</span><div><button className="btn ghost" onClick={()=>{setPaste('');setPreview(null);setResult(null)}}><Trash2 size={15}/> ล้างช่อง</button><button className="btn primary" disabled={!paste.trim()} onClick={makePreview}><ClipboardPaste size={16}/> ตรวจสอบข้อมูล</button></div></div></div>
        {preview&&<div className="panel"><div className="panel-head"><div><h3>ตรวจสอบก่อนนำเข้า</h3><p>ระบบอ่านวันที่แบบ วัน/เดือน/ปี และใช้แถวสุดท้ายชนะ ยกเว้น POD</p></div></div><div className="preview-stats"><Mini label="รายการหลังรวมซ้ำ" value={preview.rows.length}/><Mini label="แถวซ้ำ" value={preview.duplicateCount}/><Mini label="POD ชนะ" value={preview.podOverrides}/><Mini label="ข้อผิดพลาด" value={preview.errors.length}/></div>{preview.errors.length>0&&<div className="error-list">{preview.errors.slice(0,8).map((e,i)=><div key={i}>{e}</div>)}</div>}<div className="table-wrap"><table><thead><tr><th>Tracking</th><th>สถานะ</th><th>Payment</th><th>Amount</th><th>Address</th></tr></thead><tbody>{preview.rows.slice(0,12).map(r=><tr key={r.tracking}><td className="mono">{r.tracking}</td><td><Status status={r.status}/></td><td>{r.payment||'-'}</td><td>{money(r.amount)}</td><td className="address-cell">{r.address||'-'}</td></tr>)}</tbody></table></div><div className="confirm-row"><span>จะนำเข้า {preview.rows.length} รายการ ในวันที่ทำงาน {workDate}</span><button className="btn primary" disabled={!preview.rows.length||busy} onClick={doImport}>{busy?'กำลังบันทึก...':'ยืนยันนำเข้า'}</button></div></div>}
        {result&&<div className="panel"><h3>ผลการนำเข้าเรียบร้อย</h3><div className="preview-stats"><Mini label="เพิ่มใหม่" value={result.added}/><Mini label="อัปเดต" value={result.updated}/><Mini label="ไม่เปลี่ยนแปลง" value={result.unchanged}/><Mini label="รายการซ้ำในข้อมูล" value={result.duplicates}/></div></div>}
        <div className="info-note"><ShieldCheck size={18}/><div><b>ข้อมูลต้นฉบับปลอดภัย</b><p>ระบบนี้รับเฉพาะข้อความที่คุณวาง ไม่เชื่อมต่อ Google Sheets และไม่ส่งข้อมูลไปยัง Server ภายนอก</p></div></div>
      </div>}
      {(page==='pending'||page==='pod'||page==='failed')&&<div className="page-content"><div className="toolbar"><div className="search-box"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="ค้นหา Tracking, ที่อยู่, Carrier..."/></div><select value={payment} onChange={e=>setPayment(e.target.value)}><option value="ALL">ทุกประเภทการชำระ</option><option value="COD">COD</option><option value="NON COD">Non COD</option></select>{page==='pending'&&<button className="btn ghost" onClick={copyAllPendingTracking} disabled={!counts.pending}><Copy size={16}/> Copy All Tracking ({counts.pending})</button>}<button className="btn ghost" onClick={()=>exportRows(filtered,`${page}-${workDate}.xlsx`)}><Download size={16}/> Export Excel</button></div>{page==='pending'&&<div className="deadline-dashboard">
        <div className="deadline-heading"><div><h2>ติดตามเวลาตาย</h2><p>คำนวณตามเวลาไทย · อัปเดตทุกวินาที · ใช้ข้อมูล Pending ทุกวัน</p></div><span className="deadline-clock">เวลาปัจจุบัน {formatBangkokDate(clockNow)}</span></div>
        <div className="deadline-grid">
          <section className="panel deadline-panel">
            <div className="panel-head"><div><h3>พัสดุที่จะตาย</h3><p>ตั้งแต่วันนี้ 00:00 น. ถึงวันถัดไป 10:00 น.</p></div><strong className="deadline-count warning-count">{deadlineGroups.inWindow.length}</strong></div>
            <div className="deadline-actions"><button className="btn ghost" onClick={()=>copyDeadlineRows(deadlineGroups.inWindow,'พัสดุที่จะตาย')} disabled={!deadlineGroups.inWindow.length}><Copy size={16}/> Copy All ({deadlineGroups.inWindow.length})</button></div>
            <DeadlineTable rows={deadlineGroups.inWindow} now={clockNow}/>
          </section>
          <section className="panel deadline-panel urgent-panel">
            <div className="panel-head"><div><h3>เหลือเวลาไม่เกิน 3 ชั่วโมง</h3><p>นับจากเวลาปัจจุบันจริง · ไม่รวมรายการที่หมดเวลาแล้ว</p></div><strong className="deadline-count danger-count">{deadlineGroups.urgent.length}</strong></div>
            <div className="deadline-actions"><button className="btn ghost" onClick={()=>copyDeadlineRows(deadlineGroups.urgent,'พัสดุเหลือไม่เกิน 3 ชั่วโมง')} disabled={!deadlineGroups.urgent.length}><Copy size={16}/> Copy All ({deadlineGroups.urgent.length})</button></div>
            <DeadlineTable rows={deadlineGroups.urgent} now={clockNow} showRemaining/>
          </section>
        </div>
        {deadlineGroups.overdue.length>0&&<section className="panel overdue-panel"><div className="panel-head"><div><h3>เลยกำหนดแล้ว</h3><p>ยังเป็นสถานะ Pending และกำหนดส่งอยู่ในช่วงที่ติดตาม</p></div><strong className="deadline-count danger-count">{deadlineGroups.overdue.length}</strong></div><div className="deadline-actions"><button className="btn ghost" onClick={()=>copyDeadlineRows(deadlineGroups.overdue,'รายการเลยกำหนด')}><Copy size={16}/> Copy All ({deadlineGroups.overdue.length})</button></div><DeadlineTable rows={deadlineGroups.overdue} now={clockNow} showOverdue/></section>}
        {deadlineGroups.invalidCount>0&&<div className="deadline-note"><CircleAlert size={16}/> มี Pending {deadlineGroups.invalidCount} รายการที่ Source Date ไม่ถูกต้องหรือไม่มีข้อมูล จึงยังนำมาคำนวณกำหนดส่งไม่ได้</div>}
      </div>}<div className="panel"><div className="panel-head"><div><h3>{labels[page]}</h3><p>{filtered.length.toLocaleString()} รายการ · วันที่ทำงาน {workDate}</p></div></div><ShipmentTable rows={filtered} onExport={()=>exportRows(filtered,`${page}.xlsx`)}/></div></div>}
      {page==='history'&&<div className="page-content"><div className="panel"><div className="panel-head"><div><h3>ประวัติการนำเข้าทั้งหมด</h3><p>ข้อมูลย้อนหลังไม่ถูกลบเมื่อขึ้นวันใหม่</p></div></div><div className="table-wrap"><table><thead><tr><th>วันที่ทำงาน</th><th>เวลานำเข้า</th><th>ทั้งหมด</th><th>เพิ่มใหม่</th><th>อัปเดต</th><th>ไม่เปลี่ยน</th><th>ซ้ำ</th></tr></thead><tbody>{batches.map(b=><tr key={b.id}><td>{b.workDate}</td><td>{dateLabel(b.importedAt)}</td><td>{b.totalRows}</td><td>{b.added}</td><td>{b.updated}</td><td>{b.unchanged}</td><td>{b.duplicates}</td></tr>)}</tbody></table>{!batches.length&&<Empty text="ยังไม่มีประวัติการนำเข้า"/>}</div></div><div className="panel"><div className="panel-head"><div><h3>รายการจากวันอื่น</h3><p>เลือกวันที่ด้านบนเพื่อเปิดดูรายการของวันนั้น</p></div></div><div className="archive-list">{Array.from(new Set(allShipments.map(x=>x.workDate))).sort().reverse().filter(d=>d!==workDate).map(d=><button key={d} className="archive-day" onClick={()=>setWorkDate(d)}><Archive size={16}/>{d}<span>{allShipments.filter(x=>x.workDate===d).length} รายการ</span></button>)}</div></div></div>}
      {page==='activity'&&<div className="page-content"><div className="panel"><div className="panel-head"><div><h3>ประวัติการเปลี่ยนแปลง</h3><p>บันทึกการเพิ่มและอัปเดต Tracking</p></div></div>{activities.map(a=><div className="activity-row" key={a.id}><div className="activity-dot"/><div><b>{a.tracking}</b><p>{a.message}</p><small>{a.workDate} · {dateLabel(a.at)}</small></div><span>{a.type}</span></div>)}{!activities.length&&<Empty text="ยังไม่มีประวัติ"/>}</div></div>}
      {page==='settings'&&<div className="page-content narrow"><div className="panel"><div className="panel-head"><div><h3>สำรองและกู้คืนข้อมูล</h3><p>ข้อมูลทั้งหมดอยู่ใน IndexedDB ของ Browser นี้</p></div></div><div className="setting-row"><div><b>สำรองข้อมูลทั้งหมด</b><p>ดาวน์โหลดรายการพัสดุ ประวัติการนำเข้า และ Activity เป็น JSON</p></div><button className="btn primary" onClick={backup}><Download size={16}/> Backup JSON</button></div><div className="setting-row"><div><b>กู้คืนจากไฟล์ Backup</b><p>การกู้คืนจะแทนที่ข้อมูลเดิมทั้งหมด</p></div><label className="btn ghost upload-label"><Upload size={16}/> เลือกไฟล์ JSON<input type="file" accept="application/json" hidden onChange={e=>e.target.files?.[0]&&restore(e.target.files[0])}/></label></div><div className="setting-row danger-row"><div><b>ล้างข้อมูลทั้งหมด</b><p>ลบรายการและประวัติจาก Browser เครื่องนี้อย่างถาวร</p></div><button className="btn danger" onClick={clearAll}><Trash2 size={16}/> ล้างข้อมูล</button></div><div className="info-note"><ShieldCheck size={18}/><div><b>คำแนะนำ</b><p>สำรองข้อมูลเป็น JSON เป็นประจำ และอย่าล้างข้อมูลเว็บไซต์หรือ Browser โดยไม่มีไฟล์ Backup</p></div></div></div><div className="panel"><h3>รายละเอียดระบบ</h3><p className="muted">POD Management v1.0.0 · React · TypeScript · Dexie / IndexedDB</p><p className="muted">ไม่มี Backend, ไม่มี Login, ไม่มีการเชื่อมต่อ Google Sheets</p></div></div>}

      <style>{`
        .deadline-dashboard{display:flex;flex-direction:column;gap:14px;margin-bottom:18px}
        .deadline-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap}
        .deadline-heading h2{margin:0;font-size:20px}
        .deadline-heading p,.deadline-panel .panel-head p,.overdue-panel .panel-head p{margin:4px 0 0;color:var(--muted,#64748b);font-size:12px}
        .deadline-clock{font-size:12px;color:var(--muted,#64748b)}
        .deadline-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
        .deadline-panel,.overdue-panel{min-width:0;overflow:hidden}
        .deadline-count{font-size:22px;padding:4px 10px;border-radius:9px}
        .warning-count{color:#b7791f;background:#fff7e6}
        .danger-count{color:#dc2626;background:#fef2f2}
        .deadline-actions{display:flex;justify-content:flex-end;padding:0 16px 12px}
        .deadline-table{min-width:720px}
        .deadline-table th,.deadline-table td{white-space:nowrap}
        .deadline-table .address-cell{max-width:260px;overflow:hidden;text-overflow:ellipsis}
        .remaining-time{font-weight:700;color:#d97706;font-variant-numeric:tabular-nums}\n        .critical-time{font-weight:800;color:#dc2626;font-variant-numeric:tabular-nums}
        .overdue-time{font-weight:700;color:#dc2626;font-variant-numeric:tabular-nums}
        .overdue-panel{border:1px solid #fecaca}
        .deadline-note{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:8px;background:#fff7ed;color:#9a3412;font-size:12px}
        @media(max-width:900px){.deadline-grid{grid-template-columns:1fr}}
      `}</style>
      <footer>© 2026 POD Management <span>LOCAL DATA · NO GOOGLE SHEETS CONNECTION</span></footer>
    </main>
  </div>
}
function Stat({icon,label,value,tone}:{icon:React.ReactNode;label:string;value:string|number;tone:string}){return <div className="stat-card"><div className={`stat-icon ${tone}`}>{icon}</div><div><small>{label}</small><strong>{value}</strong></div></div>}
function Mini({label,value}:{label:string;value:string|number}){return <div className="mini-stat"><small>{label}</small><b>{value}</b></div>}
function Status({status}:{status:PodStatus}){return <span className={`status-pill ${status.toLowerCase()}`}><i/>{statusLabel(status)}</span>}
function Empty({text}:{text:string}){return <div className="empty-state"><PackageCheck size={26}/><span>{text}</span></div>}
function DeadlineTable({rows,now,showRemaining=false,showOverdue=false}:{rows:(Shipment & {dueTimestamp?:number})[];now:number;showRemaining?:boolean;showOverdue?:boolean}){
  return <div className="table-wrap"><table className="deadline-table"><thead><tr><th>Tracking</th><th>Payment</th><th>ยอดเงิน</th><th>กำหนดส่ง</th><th>ที่อยู่</th>{(showRemaining||showOverdue)&&<th>{showOverdue?'เลยมาแล้ว':'เวลาที่เหลือ'}</th>}</tr></thead><tbody>{rows.map(x=>{
    const due=x.dueTimestamp??parseDueDate(x.dueDate || x.sourceDate)
    return <tr key={x.id}><td className="mono">{x.tracking}</td><td>{x.payment||'-'}</td><td className="amount">{money(x.amount)}</td><td>{formatDueDate(x.dueDate || x.sourceDate)}</td><td className="address-cell" title={x.address}>{x.address||'-'}</td>{(showRemaining||showOverdue)&&<td className={showOverdue?'overdue-time':showRemaining&&due!==null&&due-now<=60*60*1000?'critical-time':'remaining-time'}>{due===null?'-':showOverdue?formatRemaining(now-due):formatRemaining(due-now)}</td>}</tr>
  })}</tbody></table>{!rows.length&&<Empty text="ไม่มีพัสดุในช่วงเวลานี้"/>}</div>
}
function ShipmentTable({rows,onExport}:{rows:Shipment[];onExport:()=>void}){return <div className="table-wrap"><table><thead><tr><th>Tracking</th><th>สถานะ</th><th>Carrier</th><th>Payment</th><th>ยอดเงิน</th><th>กำหนดส่ง</th><th>ที่อยู่</th></tr></thead><tbody>{rows.map(x=><tr key={x.id}><td className="mono">{x.tracking}</td><td><Status status={x.status}/></td><td>{x.carrier||'-'}</td><td>{x.payment||'-'}</td><td className="amount">{money(x.amount)}</td><td>{formatDueDate(x.dueDate || x.sourceDate)}</td><td className="address-cell" title={x.address}>{x.address||'-'}</td></tr>)}</tbody></table>{!rows.length&&<Empty text="ไม่พบรายการในหมวดนี้"/>}</div>}
function downloadBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
