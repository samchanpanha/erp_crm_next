'use client'

import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function PageHeader({
  title,
  description,
  actions,
  icon: Icon,
  className,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
  icon?: LucideIcon
  className?: string
}) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center justify-between gap-3', className)}>
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-5 w-5" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold truncate">{title}</h1>
          {description && <p className="text-sm text-muted-foreground truncate">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 px-6 text-center">
      {Icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Icon className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
        </div>
      )}
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {actionLabel && onAction && (
        <Button className="mt-4" onClick={onAction}>{actionLabel}</Button>
      )}
    </div>
  )
}
