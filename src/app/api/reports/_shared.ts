/**
 * Shared helpers for the /api/reports/* read-only endpoints.
 * Not a route file — only route.ts files are exposed by the App Router.
 */
import { z } from 'zod'

import { round2 } from '@/lib/doc-math'

export { round2 }

/** Invoice statuses that keep a document open (receivables / payables). */
export const OPEN_STATUSES = ['UNPAID', 'PARTIAL'] as const

/** Zod refinement for optional ISO / yyyy-mm-dd date strings. */
export const optionalDateParam = (label: string) =>
  z
    .string()
    .optional()
    .refine((v) => !v || !Number.isNaN(new Date(v).getTime()), `Invalid ${label} date`)

/** Parse an optional date query param, returning null when absent/empty/invalid. */
export function parseDateParam(raw: string | null | undefined): Date | null {
  if (!raw || !raw.trim()) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

/** 23:59:59.999 of the given date (local server time) so `to` is inclusive. */
export function dayEnd(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
}

/** Jan 1st of the given date's year (local server time). */
export function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1)
}

/** 'YYYY-MM' month key (local server time, consistent with the dashboard series). */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Inclusive ascending list of 'YYYY-MM' keys covered by [start, end]. */
export function monthKeysBetween(start: Date, end: Date): string[] {
  const keys: string[] = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cursor <= last) {
    keys.push(monthKey(cursor))
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return keys
}

/** Days past due: max(0, floor((now - dueDate) / 86400000)); 0 when no dueDate. */
export function daysOverdueOf(dueDate: Date | null, now: Date): number {
  if (!dueDate) return 0
  return Math.max(0, Math.floor((now.getTime() - dueDate.getTime()) / 86400000))
}

export type AgingBucket = 'CURRENT' | '1-30' | '31-60' | '61-90' | '90+'

export const BUCKET_ORDER: AgingBucket[] = ['CURRENT', '1-30', '31-60', '61-90', '90+']

export function bucketFor(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'CURRENT'
  if (daysOverdue <= 30) return '1-30'
  if (daysOverdue <= 60) return '31-60'
  if (daysOverdue <= 90) return '61-90'
  return '90+'
}
