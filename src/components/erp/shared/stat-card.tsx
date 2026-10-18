'use client'

import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import { formatNumber } from './format'

export function formatMoneyCompact(n: number): string {
  const abs = Math.abs(n)
  const sign = n < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= 100_000) return `${sign}$${Math.round(abs / 1000)}k`
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  isMoney = false,
}: {
  title: string
  value: number
  hint?: string
  icon: LucideIcon
  tone?: 'default' | 'success' | 'warning' | 'danger'
  isMoney?: boolean
}) {
  const toneClasses = {
    default: 'text-primary bg-primary/10',
    success: 'text-emerald-600 bg-emerald-50',
    warning: 'text-amber-600 bg-amber-50',
    danger: 'text-rose-600 bg-rose-50',
  } as const
  return (
    <Card className="py-0 gap-0">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
            <p className="mt-1.5 text-lg sm:text-2xl font-bold tabular-nums truncate">
              {isMoney ? formatMoneyCompact(value) : formatNumber(value)}
            </p>
            {hint && <p className="mt-1 text-xs text-muted-foreground truncate">{hint}</p>}
          </div>
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', toneClasses[tone])}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
