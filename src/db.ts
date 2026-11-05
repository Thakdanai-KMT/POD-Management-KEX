import Dexie, { type Table } from 'dexie'
import type { Shipment, ImportBatch, Activity } from './types'

class PodDatabase extends Dexie {
  shipments!: Table<Shipment, number>
  batches!: Table<ImportBatch, number>
  activities!: Table<Activity, number>
  constructor() {
    super('pod-management-local')
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