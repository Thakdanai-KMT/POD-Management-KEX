import { db, getEverPodTracking } from './db'
import type { ParsedRow, Shipment, ImportBatch, Activity, PodStatus } from './types'
import { todayLocal } from './parser'
import { normalizeDateTime } from './dateUtils'

export interface ImportResult { added:number; updated:number; unchanged:number; errors:number; total:number; duplicates:number }
function sameData(a:Shipment,b:ParsedRow,status:PodStatus):boolean {
  return a.carrier===b.carrier && a.code===b.code && a.sourceDate===b.sourceDate &&
    a.status===status && a.remark===b.remark && a.priority===b.priority &&
    a.payment===b.payment && a.ref===b.ref && a.amount===b.amount &&
    a.dueDate===b.dueDate && a.address===b.address
}
export async function commitImport(rows:ParsedRow[], duplicateCount:number, workDate=todayLocal()):Promise<ImportResult> {
  let added=0,updated=0,unchanged=0
  const now=new Date().toISOString()
  await db.transaction('rw',db.shipments,db.batches,db.activities,async()=>{
    const everPod=await getEverPodTracking()
    // โหลดรายการของวันทำงานครั้งเดียว (เร็วกว่าค้นทีละแถว) โดยให้ PENDING มาก่อน
    const sameDay=await db.shipments.where('workDate').equals(workDate).toArray()
    const byTracking=new Map<string,Shipment>()
    for (const x of sameDay) {
      const k=x.tracking.trim().toUpperCase()
      const p=byTracking.get(k)
      if (!p || (p.status!=='PENDING' && x.status==='PENDING')) byTracking.set(k,x)
    }
    for (const row of rows) {
      const tracking=row.tracking.trim().toUpperCase()
      const existing=byTracking.get(tracking)
      const status:PodStatus=everPod.has(tracking) || row.status==='POD' ? 'POD' : row.status
      // Due Date = Source Date เสมอ
      const src=normalizeDateTime(row.sourceDate)
      const data:ParsedRow={...row,sourceDate:src,dueDate:src}
      const record:Shipment={tracking,carrier:data.carrier,code:data.code,sourceDate:src,status,remark:data.remark,priority:data.priority,payment:data.payment,ref:data.ref,amount:data.amount,dueDate:src,address:data.address,workDate,createdAt:existing?.createdAt??now,updatedAt:now}
      if (!existing) {
        const id=await db.shipments.add(record); added++
        byTracking.set(tracking,{...record,id})
        await db.activities.add({tracking,workDate,at:now,type:'CREATED',message:`เพิ่มรายการใหม่ สถานะ ${status}`,afterStatus:status})
      } else if (sameData(existing,data,status)) {
        unchanged++
      } else {
        await db.shipments.update(existing.id!,{...record,id:existing.id})
        updated++
        await db.activities.add({tracking,workDate,at:now,type:'UPDATED',message:'อัปเดตข้อมูลจากการนำเข้า',beforeStatus:existing.status,afterStatus:status})
      }
      if (status==='POD') everPod.add(tracking)
    }
    const batch:ImportBatch={workDate,importedAt:now,totalRows:rows.length,added,updated,unchanged,duplicates:duplicateCount,errors:0}
    await db.batches.add(batch)
  })
  return {added,updated,unchanged,errors:0,total:rows.length,duplicates:duplicateCount}
}
export async function changeStatus(id:number,status:PodStatus):Promise<void> {
  const item=await db.shipments.get(id)
  if (!item) return
  if (item.status==='POD' && status!=='POD') throw new Error('รายการนี้เคย POD แล้ว ระบบไม่อนุญาตให้เปลี่ยนกลับอัตโนมัติ')
  const now=new Date().toISOString()
  await db.transaction('rw',db.shipments,db.activities,async()=>{
    await db.shipments.update(id,{status,updatedAt:now})
    await db.activities.add({tracking:item.tracking,workDate:item.workDate,at:now,type:'MANUAL_STATUS',message:`เปลี่ยนสถานะ ${item.status} → ${status} ด้วยตนเอง`,beforeStatus:item.status,afterStatus:status})
  })
}
