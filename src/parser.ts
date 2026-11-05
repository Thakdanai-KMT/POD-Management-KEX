import { normalizeDateTime, formatDueDate } from './dateUtils'
import type { ParsedRow, PodStatus, ImportPreview } from './types'

const DEFAULT_MAP = {
  tracking: 0,
  carrier: 1,
  code: 2,
  sourceDate: 3,
  status: 4,
  remark: 5,
  priority: 6,
  payment: 7,
  ref: 8,
  amount: 12,
  dueDate: 13,
  address: 14,
}

export type ColumnMap = typeof DEFAULT_MAP
export const defaultColumnMap = DEFAULT_MAP

// แยกข้อมูลแต่ละคอลัมน์ รองรับ Tab, Comma และ Pipe
function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === '|') {
    return line
      .trim()
      .replace(/^\s*\|\s*/, '')
      .replace(/\s*\|\s*$/, '')
      .split('|')
      .map((value) => value.trim())
  }

  return line.split(delimiter).map((value) => value.trim())
}

// ตรวจสอบตัวคั่นข้อมูลจากบรรทัดแรก
function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find((line) => line.trim()) ?? ''

  if (first.includes('\t')) return '\t'
  if (first.includes('|')) return '|'

  return ','
}

// อ่านค่าในคอลัมน์
function cell(row: string[], index: number): string {
  return (row[index] ?? '')
    .trim()
    .replace(/^<br\s*\/?>$/i, '')
}

// แปลงข้อความสถานะเป็นสถานะของระบบ
function parseStatus(value: string): PodStatus {
  const v = value.trim().toLowerCase()

  if (
    v === 'pod' ||
    v.includes('ส่งสำเร็จ') ||
    v.includes('delivered')
  ) {
    return 'POD'
  }

  if (
    v.includes('ไม่สามารถ pod') ||
    v.includes('unable') ||
    v.includes('failed')
  ) {
    return 'FAILED'
  }

  return 'PENDING'
}

// แปลงจำนวนเงิน
function parseAmount(value: string): number | null {
  const cleaned = value.replace(/[,฿\s]/g, '')

  if (
    !cleaned ||
    cleaned.startsWith('#') ||
    !/^-?\d+(\.\d+)?$/.test(cleaned)
  ) {
    return null
  }

  const amount = Number(cleaned)

  return Number.isFinite(amount) ? amount : null
}

export const parseDateTime = normalizeDateTime


const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}(?:[ ,T]+\d{1,2}:\d{2}(?::\d{2})?)?$|^\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}:\d{2}/
const STATUS_RE = /^(pod|pending|delivered|failed|unable.*|รอดำเนินการ|ส่งสำเร็จ|ไม่สามารถ.*)$/i
const PAYMENT_RE = /^(non[\s-]?cod|cod)$/i

// ถ้าคอลัมน์ไม่ตรงตามตำแหน่งมาตรฐาน (เช่น วางมาแบบสั้น) ให้จับคอลัมน์จากเนื้อหาแทน
function remapIfNeeded(raw: string[], map: ColumnMap): string[] {
  if (DATE_RE.test(cell(raw, map.sourceDate))) return raw
  const used = new Set<number>([map.tracking])
  const find = (re: RegExp, from = 1) => {
    for (let i = from; i < raw.length; i++) if (!used.has(i) && re.test(cell(raw, i))) { used.add(i); return i }
    return -1
  }
  const dateIdx = find(DATE_RE)
  if (dateIdx < 0) return raw
  const statusIdx = find(STATUS_RE)
  const payIdx = find(PAYMENT_RE)
  let amountIdx = -1
  if (payIdx >= 0 && !used.has(payIdx + 1) && /^[\d,.\-฿\s]*$/.test(cell(raw, payIdx + 1))) { amountIdx = payIdx + 1; used.add(amountIdx) }
  const rest = raw.map((v, i) => ({ v: v.trim(), i })).filter((x) => !used.has(x.i) && x.v)
  const addr = rest.reduce<{ v: string; i: number } | null>((b, x) => (!b || x.v.length > b.v.length ? x : b), null)
  const carrier = rest.find((x) => x !== addr && x.v.length <= 12)
  const out: string[] = []
  out[map.tracking] = raw[map.tracking]
  out[map.sourceDate] = raw[dateIdx]
  if (statusIdx >= 0) out[map.status] = raw[statusIdx]
  if (payIdx >= 0) out[map.payment] = raw[payIdx]
  if (amountIdx >= 0) out[map.amount] = raw[amountIdx]
  if (addr) out[map.address] = addr.v
  if (carrier) out[map.carrier] = carrier.v
  return out
}


// รวมแถวที่ถูกตัดข้ามบรรทัด (Tracking อยู่บรรทัดเดียว ข้อมูลที่เหลืออยู่บรรทัดถัดไป)
function mergeSplitRows(lines: string[], delimiter: string): string[] {
  const isTracking = (v: string) => /^[A-Za-z0-9-]{6,}$/.test(v.trim().replace(/^["']|["']$/g, ''))
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i]
    const cells = cur.split(delimiter === '|' ? '|' : delimiter).map((v) => v.trim()).filter(Boolean)
    const next = lines[i + 1]
    if (next !== undefined && cells.length === 1 && isTracking(cells[0]) &&
        !isTracking(next.split(delimiter)[0] ?? '')) {
      out.push(cur.replace(/\s+$/, '') + delimiter + next.replace(/^\s+/, ''))
      i++
    } else out.push(cur)
  }
  return out
}

// อ่านข้อมูลทั้งหมดและรวม Tracking ที่ซ้ำกัน
export function parseRows(
  input: string,
  map: ColumnMap = DEFAULT_MAP
): ImportPreview {
  const delimiter = detectDelimiter(input)

  const lines = mergeSplitRows(
    input
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((line) => line.trim()),
    delimiter
  )

  const parsed: ParsedRow[] = []
  const errors: string[] = []
  const lastByTracking = new Map<string, ParsedRow>()

  let duplicateCount = 0
  let podOverrides = 0

  lines.forEach((line, index) => {
    const raw = remapIfNeeded(splitLine(line, delimiter), map)

    // ข้ามเส้นแบ่งตาราง
    if (delimiter === '|' && /^[-:\s|]+$/.test(line.trim())) {
      return
    }

    const tracking = cell(raw, map.tracking)
      .replace(/^["']|["']$/g, '')
      .trim()

    if (!tracking || !/^[A-Za-z0-9-]{6,}$/.test(tracking)) {
      errors.push(`แถว ${index + 1}: ไม่พบ Tracking ที่ถูกต้อง`)
      return
    }

    const status = parseStatus(cell(raw, map.status))

    // อ่าน sourceDate เป็นข้อมูลต้นทางของเวลากำหนดส่ง
    const sourceDate = parseDateTime(cell(raw, map.sourceDate))

    const row: ParsedRow = {
      tracking,
      carrier: cell(raw, map.carrier),
      code: cell(raw, map.code),

      sourceDate,
      dueDate: sourceDate,

      status,
      remark: cell(raw, map.remark),
      priority: cell(raw, map.priority),
      payment: cell(raw, map.payment),
      ref: cell(raw, map.ref),
      amount: parseAmount(cell(raw, map.amount)),
      address: cell(raw, map.address),

      raw,
      rowNumber: index + 1,
    }

    const key = tracking.toUpperCase()
    const previous = lastByTracking.get(key)

    if (previous) {
      duplicateCount++

      // ถ้ามีรายการ POD ให้รักษาสถานะ POD ไว้
      const winningStatus =
        previous.status === 'POD' || row.status === 'POD'
          ? 'POD'
          : row.status

      if (winningStatus === 'POD' && row.status !== 'POD') {
        podOverrides++
      }

      row.status = winningStatus
    }

    lastByTracking.set(key, row)
  })

  parsed.push(...lastByTracking.values())

  return {
    rows: parsed,
    errors,
    duplicateCount,
    podOverrides,
  }
}

// วันที่ทำงานตามเวลาของเครื่อง
export function todayLocal(): string {
  const date = new Date()

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function formatDateTime(value: string): string {
  return value ? formatDueDate(value) : ''
}