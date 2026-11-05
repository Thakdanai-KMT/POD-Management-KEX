import { db, getEverPodTracking } from './db'
import type { ParsedRow, Shipment, ImportBatch, Activity, PodStatus } from './types'
import { todayLocal } from './parser'

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
    for (const row of rows) {
      const tracking=row.tracking.trim().toUpperCase()
      const existing=await db.shipments.where('[workDate+status]').equals([workDate,'PENDING']).filter(x=>x.tracking.toUpperCase()===tracking).first()
        ?? await db.shipments.where('workDate').equals(workDate).filter(x=>x.tracking.toUpperCase()===tracking).first()
      const priorPod=everPod.has(tracking) || (await db.shipments.where('tracking').equals(tracking).filter(x=>x.status==='POD').count())>0
      const status:PodStatus=priorPod || row.status==='POD' ? 'POD' : row.status
      const record:Shipment={tracking,carrier:row.carrier,code:row.code,sourceDate:row.sourceDate,status,remark:row.remark,priority:row.priority,payment:row.payment,ref:row.ref,amount:row.amount,dueDate:row.dueDate,address:row.address,workDate,createdAt:existing?.createdAt??now,updatedAt:now}
      if (!existing) {
        await db.shipments.add(record); added++
        await db.activities.add({tracking,workDate,at:now,type:'CREATED',message:`เพิ่มรายการใหม่ สถานะ ${status}`,afterStatus:status})
      } else if (sameData(existing,row,status)) {
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
