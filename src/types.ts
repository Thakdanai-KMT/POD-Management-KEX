export type PodStatus = 'PENDING' | 'POD' | 'FAILED'
export interface Shipment {
  id?: number
  tracking: string
  carrier: string
  code: string
  sourceDate: string
  status: PodStatus
  remark: string
  priority: string
  payment: string
  ref: string
  amount: number | null
  dueDate: string
  address: string
  workDate: string
  createdAt: string
  updatedAt: string
}
export interface ImportBatch {
  id?: number
  workDate: string
  importedAt: string
  totalRows: number
  added: number
  updated: number
  unchanged: number
  duplicates: number
  errors: number
}
export interface Activity {
  id?: number
  tracking: string
  workDate: string
  at: string
  type: string
  message: string
  beforeStatus?: PodStatus
  afterStatus?: PodStatus
}
export interface ParsedRow {
  tracking:string; carrier:string; code:string; sourceDate:string; status:PodStatus
  remark:string; priority:string; payment:string; ref:string; amount:number|null
  dueDate:string; address:string; raw:string[]; rowNumber:number
}
export interface ImportPreview {
  rows: ParsedRow[]
  errors: string[]
  duplicateCount: number
  podOverrides: number
}