import Dexie, { type Table } from 'dexie'
import type { Shipment, ImportBatch, Activity } from './types'

class PodDatabase extends Dexie {
  shipments!: Table<Shipment, number>
  batches!: Table<ImportBatch, number>
  activities!: Table<Activity, number>
  constructor() {
    // ห้ามเปลี่ยนชื่อฐานข้อมูลนี้ เพราะจะทำให้ Browser มองเป็นฐานข้อมูลคนละชุด
    super('pod-management-local')
    // Schema v1 เดิมต้องคงไว้; หากเพิ่ม/เปลี่ยน Store ให้เพิ่ม version(2), version(3)...
    // และใช้ upgrade(tx => ...) สำหรับย้ายข้อมูล ห้ามลบฐานข้อมูลระหว่างอัปเดตแอป
    this.version(1).stores({
      shipments: '++id, tracking, workDate, status, [workDate+status], updatedAt',
      batches: '++id, workDate, importedAt',
      activities: '++id, tracking, workDate, at, type'
    })
  }
}
export const db = new PodDatabase()
export async function getEverPodTracking(): Promise<Set<string>> {
  const rows = await db.shipments.where('status').equals('POD').toArray()
  return new Set(rows.map(x => x.tracking.trim().toUpperCase()))
}