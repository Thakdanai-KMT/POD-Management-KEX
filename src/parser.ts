
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

/**
 * แปลงวันที่เป็นรูปแบบ ISO โดยไม่เปลี่ยนเวลาไทย
 *
 * รองรับ:
 * 1. DD/MM/YYYY
 * 2. DD/MM/YYYY, HH:mm:ss
 * 3. YYYY-MM-DD HH:mm:ss
 * 4. YYYY-MM-DDTHH:mm:ss
 */
export function parseDateTime(value: string): string {
  if (!value) return ''

  const input = value.trim()

  // รูปแบบ DD/MM/YYYY หรือ DD/MM/YYYY, HH:mm:ss
  const thaiFormat = input.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  )

  if (thaiFormat) {
    const [, day, month, year, hour = '00', minute = '00', second = '00'] =
      thaiFormat

    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`
  }

  // รูปแบบ ISO วันที่และเวลา
  const isoFormat = input.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/
  )

  if (isoFormat) {
    const [, year, month, day, hour, minute, second = '00'] = isoFormat

    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`
  }

  return input
}

// อ่านข้อมูลทั้งหมดและรวม Tracking ที่ซ้ำกัน
export function parseRows(
  input: string,
  map: ColumnMap = DEFAULT_MAP
): ImportPreview {
  const delimiter = detectDelimiter(input)

  const lines = input
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim())

  const parsed: ParsedRow[] = []
  const errors: string[] = []
  const lastByTracking = new Map<string, ParsedRow>()

  let duplicateCount = 0
  let podOverrides = 0

  lines.forEach((line, index) => {
    const raw = splitLine(line, delimiter)

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
  if (!value) return ''

  const normalized = parseDateTime(value)

  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/
  )

  if (!match) return value

  const [, year, month, day, hour, minute, second] = match

  return `${day}/${month}/${year} ${hour}:${minute}:${second}`
}