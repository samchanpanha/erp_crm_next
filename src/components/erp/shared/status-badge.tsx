'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'muted'

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-primary/10 text-primary border-primary/25',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger: 'bg-rose-50 text-rose-700 border-rose-200',
  info: 'bg-orange-50 text-orange-700 border-orange-200',
  muted: 'bg-zinc-100 text-zinc-600 border-zinc-200',
}

export function StatusBadge({
  status,
  label,
  tone = 'muted',
  className,
}: {
  status?: string
  label?: string
  tone?: Tone
  className?: string
}) {
  const text = (label ?? status ?? '').replaceAll('_', ' ')
  return (
    <Badge variant="outline" className={cn('font-medium whitespace-nowrap', toneClasses[tone], className)}>
      {text}
    </Badge>
  )
}

/** Central status → tone + label registry shared by all modules */
export const STATUS: Record<string, { tone: Tone; label: string }> = {
  // generic lifecycle
  DRAFT: { tone: 'muted', label: 'Draft' },
  CANCELLED: { tone: 'muted', label: 'Cancelled' },
  CLOSED: { tone: 'muted', label: 'Closed' },
  ARCHIVED: { tone: 'muted', label: 'Archived' },
  // documents
  VALIDATED: { tone: 'info', label: 'Validated' },
  ACCEPTED: { tone: 'success', label: 'Accepted' },
  REFUSED: { tone: 'danger', label: 'Refused' },
  // invoices / payments
  UNPAID: { tone: 'warning', label: 'Unpaid' },
  PARTIAL: { tone: 'warning', label: 'Partially paid' },
  PAID: { tone: 'success', label: 'Paid' },
  // orders
  IN_PROGRESS: { tone: 'warning', label: 'In progress' },
  DELIVERED: { tone: 'info', label: 'Delivered' },
  BILLED: { tone: 'success', label: 'Billed' },
  RECEIVED: { tone: 'success', label: 'Received' },
  // third parties / products / employees
  ACTIVE: { tone: 'success', label: 'Active' },
  SUSPENDED: { tone: 'muted', label: 'Suspended' },
  // opportunity stages
  NEW: { tone: 'neutral', label: 'New' },
  QUALIFIED: { tone: 'info', label: 'Qualified' },
  PROPOSAL: { tone: 'info', label: 'Proposal sent' },
  NEGOTIATION: { tone: 'warning', label: 'Negotiation' },
  WON: { tone: 'success', label: 'Won' },
  LOST: { tone: 'danger', label: 'Lost' },
  // tickets
  ASSIGNED: { tone: 'info', label: 'Assigned' },
  RESOLVED: { tone: 'success', label: 'Resolved' },
  // priorities
  LOW: { tone: 'muted', label: 'Low' },
  MEDIUM: { tone: 'info', label: 'Medium' },
  HIGH: { tone: 'warning', label: 'High' },
  URGENT: { tone: 'danger', label: 'Urgent' },
  // projects/tasks
  OPEN: { tone: 'info', label: 'Open' },
  SUSPENDED_P: { tone: 'muted', label: 'Suspended' },
  TODO: { tone: 'muted', label: 'To do' },
  DONE: { tone: 'success', label: 'Done' },
  // HR
  PENDING: { tone: 'warning', label: 'Pending' },
  APPROVED: { tone: 'success', label: 'Approved' },
  REJECTED: { tone: 'danger', label: 'Rejected' },
  SUBMITTED: { tone: 'info', label: 'Submitted' },
  // contracts
  EXPIRED: { tone: 'muted', label: 'Expired' },
  // tasks
  MEETING: { tone: 'info', label: 'Meeting' },
  CALL: { tone: 'neutral', label: 'Call' },
  TASK: { tone: 'warning', label: 'Task' },
  REMINDER: { tone: 'muted', label: 'Reminder' },
  OTHER: { tone: 'muted', label: 'Other' },
}

export function DocStatusBadge({ status, className }: { status: string; className?: string }) {
  const s = STATUS[status] ?? { tone: 'muted' as Tone, label: status }
  return <StatusBadge status={status} label={s.label} tone={s.tone} className={className} />
}

export function PriorityBadge({ priority, className }: { priority: string; className?: string }) {
  const s = STATUS[priority] ?? { tone: 'muted' as Tone, label: priority }
  return <StatusBadge status={priority} label={s.label} tone={s.tone} className={className} />
}
