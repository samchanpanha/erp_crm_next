'use client'

export function formatMoney(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : 0
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(v)
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  const v = typeof n === 'number' ? n : 0
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(v)
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date)
}

export function formatDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** yyyy-mm-dd for <input type="date"> */
export function toDateInput(d: string | Date | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toISOString().slice(0, 10)
}

export function toDateTimeInput(d: string | Date | null | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16)
}

export function relativeDays(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const date = typeof d === 'string' ? new Date(d) : d
  const diff = Math.round((date.getTime() - Date.now()) / 86400000)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  return diff > 0 ? `in ${diff} days` : `${Math.abs(diff)} days ago`
}
