// ตรรกะวันที่ส่วนกลาง: Source Date → Due Date (เวลาไทย UTC+7)
const TH_OFFSET_MS = 7 * 60 * 60 * 1000
const p2 = (n: number | string) => String(n).padStart(2, '0')

/** แปลงข้อความวันที่เป็น YYYY-MM-DDTHH:mm:ss (ไม่ขยับเวลา) ถ้าอ่านไม่ได้คืนค่าเดิม */
export function normalizeDateTime(value: string | null | undefined): string {
  if (!value) return ''
  const s = value.trim()
  let y: string, mo: string, d: string, h = '0', mi = '0', se = '0'
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/)
  if (m) {
    ;[, d, mo, y, h = '0', mi = '0', se = '0'] = m
  } else {
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/)
    if (!m) return s
    ;[, y, mo, d, h, mi, se = '0'] = m
  }
  let year = Number(y)
  if (year > 2400) year -= 543 // ปี พ.ศ. → ค.ศ.
  return `${year}-${p2(mo)}-${p2(d)}T${p2(h)}:${p2(mi)}:${p2(se)}`
}

/** แปลงเป็น timestamp (ms) โดยตีความเป็นเวลาไทย; วันที่ไม่ถูกต้องคืน null */
export function parseDueDate(value: string | null | undefined): number | null {
  const iso = normalizeDateTime(value)
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return null
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number)
  const ts = Date.UTC(y, mo - 1, d, h, mi, se) - TH_OFFSET_MS
  const c = new Date(ts + TH_OFFSET_MS)
  if (c.getUTCFullYear() !== y || c.getUTCMonth() !== mo - 1 || c.getUTCDate() !== d ||
      c.getUTCHours() !== h || c.getUTCMinutes() !== mi || c.getUTCSeconds() !== se) return null
  return ts
}

/** timestamp → DD/MM/YYYY HH:mm:ss (เวลาไทย, ปี ค.ศ.) */
export function formatThaiDateTime(ts: number): string {
  const t = new Date(ts + TH_OFFSET_MS)
  return `${p2(t.getUTCDate())}/${p2(t.getUTCMonth() + 1)}/${t.getUTCFullYear()} ${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}:${p2(t.getUTCSeconds())}`
}

/** 2026-11-05T22:05:04 → 05/11/2026 22:05:04 */
export function formatDueDate(value: string | null | undefined): string {
  const ts = parseDueDate(value)
  return ts === null ? '-' : formatThaiDateTime(ts)
}
