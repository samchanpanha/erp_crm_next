'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CheckCircle2,
  Eye,
  Inbox,
  LifeBuoy,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Send,
  Trash2,
  UserX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { PageHeader, EmptyState } from '@/components/erp/shared/page-header'
import {
  DocStatusBadge, PriorityBadge, StatusBadge, type Tone,
} from '@/components/erp/shared/status-badge'
import { StatCard } from '@/components/erp/shared/stat-card'
import { formatDateTime, relativeDays } from '@/components/erp/shared/format'
import { get, post, put, del } from '@/components/erp/lib/api'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types (mirror API payloads)
// ---------------------------------------------------------------------------
type TicketStatus = 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
type TicketCategory = 'SALES' | 'BILLING' | 'TECHNICAL' | 'OTHER'

interface ThirdPartyRef {
  id: string
  name: string
  code: string
}

interface TicketRow {
  id: string
  ref: string
  subject: string
  status: TicketStatus
  priority: TicketPriority
  category: TicketCategory | null
  assignedTo: string | null
  description: string | null
  resolution: string | null
  createdAt: string
  updatedAt: string
  thirdParty: ThirdPartyRef | null
}

interface TicketMessageRow {
  id: string
  ticketId: string
  author: string
  content: string
  isInternal: boolean
  createdAt: string
}

interface TicketDetail extends TicketRow {
  messages: TicketMessageRow[]
}

interface ThirdPartyOption {
  id: string
  name: string
  code: string
}

interface EmployeeRow {
  id: string
  firstName: string
  lastName: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const STATUSES: TicketStatus[] = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']
const PRIORITIES: TicketPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
const CATEGORIES: TicketCategory[] = ['SALES', 'BILLING', 'TECHNICAL', 'OTHER']

const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: 'New',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
}

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
}

const CATEGORY_LABEL: Record<TicketCategory, string> = {
  SALES: 'Sales',
  BILLING: 'Billing',
  TECHNICAL: 'Technical',
  OTHER: 'Other',
}

const CATEGORY_TONE: Record<TicketCategory, Tone> = {
  SALES: 'neutral',
  BILLING: 'info',
  TECHNICAL: 'warning',
  OTHER: 'muted',
}

/** Forward-only lifecycle (skipping allowed); CLOSED can only be reopened to IN_PROGRESS */
const NEXT_STATUSES: Record<TicketStatus, TicketStatus[]> = {
  NEW: ['ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  ASSIGNED: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED'],
  CLOSED: ['IN_PROGRESS'],
}

const OPEN_STATUSES = new Set<TicketStatus>(['NEW', 'ASSIGNED', 'IN_PROGRESS'])

const REPLY_AUTHOR = 'Alice Martin — Support'
const NONE = '__none' // Select sentinel for "no value" (empty strings break Radix Select)

const scrollbarCls =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 hover:[&::-webkit-scrollbar-thumb]:bg-zinc-400'

const emptyForm = {
  subject: '',
  thirdPartyId: NONE,
  category: NONE,
  priority: 'MEDIUM' as TicketPriority,
  assignedTo: '',
  description: '',
}

type TicketFormState = typeof emptyForm

// ---------------------------------------------------------------------------
// Detail dialog (conversation view)
// ---------------------------------------------------------------------------
function TicketDetailDialog({
  ticketId,
  open,
  onOpenChange,
  assigneeOptions,
}: {
  ticketId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  assigneeOptions: string[]
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [showResolution, setShowResolution] = useState(false)
  const [resolutionDraft, setResolutionDraft] = useState('')
  const [replyContent, setReplyContent] = useState('')
  const [replyInternal, setReplyInternal] = useState(false)
  const threadRef = useRef<HTMLDivElement | null>(null)

  const detailQuery = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: () => get<TicketDetail>(`/api/tickets/${ticketId as string}`),
    enabled: open && ticketId !== null,
  })

  const detail = detailQuery.data

  /** Event-driven local reset (instead of an effect) when the dialog closes */
  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setShowResolution(false)
      setReplyContent('')
      setReplyInternal(false)
    }
    onOpenChange(o)
  }

  useEffect(() => {
    // keep the newest message in view
    const el = threadRef.current
    if (el && detail) el.scrollTop = el.scrollHeight
  }, [detail])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tickets'] })
    if (ticketId) void queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] })
  }

  const statusMutation = useMutation({
    mutationFn: (payload: { status: TicketStatus; resolution?: string }) =>
      put<TicketDetail>(`/api/tickets/${ticketId as string}`, payload),
    onSuccess: (_res, vars) => {
      toast({
        title: vars.status === 'RESOLVED' ? 'Ticket resolved' : `Status updated to ${STATUS_LABEL[vars.status]}`,
        description: vars.resolution ? 'Resolution notes saved.' : undefined,
      })
      setShowResolution(false)
      invalidate()
    },
    onError: (err: Error) =>
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' }),
  })

  const quickEditMutation = useMutation({
    mutationFn: (patch: Record<string, string>) =>
      put<TicketDetail>(`/api/tickets/${ticketId as string}`, patch),
    onSuccess: () => {
      toast({ title: 'Ticket updated' })
      invalidate()
    },
    onError: (err: Error) =>
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' }),
  })

  const replyMutation = useMutation({
    mutationFn: () =>
      post<TicketMessageRow>(`/api/tickets/${ticketId as string}/messages`, {
        author: REPLY_AUTHOR,
        content: replyContent.trim(),
        isInternal: replyInternal,
      }),
    onSuccess: () => {
      toast({ title: 'Reply added', description: replyInternal ? 'Visible to agents only.' : undefined })
      setReplyContent('')
      setReplyInternal(false)
      invalidate()
    },
    onError: (err: Error) =>
      toast({ title: 'Could not add reply', description: err.message, variant: 'destructive' }),
  })

  const handleStatusClick = (target: TicketStatus) => {
    if (!detail) return
    if (target === 'RESOLVED') {
      setResolutionDraft(detail.resolution ?? '')
      setShowResolution(true)
      return
    }
    statusMutation.mutate({ status: target })
  }

  // (React Compiler auto-memoizes this — no manual useMemo needed)
  const assigneeSet = new Set(assigneeOptions)
  if (detail?.assignedTo) assigneeSet.add(detail.assignedTo)
  const assigneeChoices = Array.from(assigneeSet).sort((a, b) => a.localeCompare(b))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-3xl">
        {detailQuery.isError && (
          <p className="text-sm text-destructive">Failed to load ticket: {detailQuery.error.message}</p>
        )}
        {!detail ? (
          <div className="space-y-3 py-4" aria-busy="true">
            <DialogTitle className="sr-only">Ticket details (loading)</DialogTitle>
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{detail.ref}</span>
                <DocStatusBadge status={detail.status} />
                <PriorityBadge priority={detail.priority} />
                {detail.category && (
                  <StatusBadge status={detail.category} tone={CATEGORY_TONE[detail.category]} />
                )}
              </div>
              <DialogTitle className="text-left text-base sm:text-lg">{detail.subject}</DialogTitle>
              <DialogDescription className="text-left">
                {detail.thirdParty ? detail.thirdParty.name : 'No third party'} · Created{' '}
                {formatDateTime(detail.createdAt)} ({relativeDays(detail.createdAt)}) · Updated{' '}
                {formatDateTime(detail.updatedAt)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-5">
              {/* Description */}
              {detail.description && (
                <div className="rounded-lg bg-muted/50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Description
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{detail.description}</p>
                </div>
              )}

              {/* Resolution */}
              {detail.resolution && !showResolution && (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Resolution
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{detail.resolution}</p>
                </div>
              )}

              {/* Status stepper — only allowed forward moves (+ reopen) */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Status
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <DocStatusBadge status={detail.status} />
                  <span className="text-xs text-muted-foreground" aria-hidden>→</span>
                  {NEXT_STATUSES[detail.status].map((s) => (
                    <Button
                      key={s}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-9 gap-1.5"
                      disabled={statusMutation.isPending}
                      onClick={() => handleStatusClick(s)}
                    >
                      {s === 'IN_PROGRESS' && detail.status === 'CLOSED' && (
                        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {s === 'IN_PROGRESS' && detail.status === 'CLOSED' ? 'Reopen' : STATUS_LABEL[s]}
                    </Button>
                  ))}
                  {statusMutation.isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
                </div>
                {showResolution && (
                  <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                    <Label htmlFor="ticket-resolution" className="text-emerald-800">
                      Resolution notes
                    </Label>
                    <Textarea
                      id="ticket-resolution"
                      value={resolutionDraft}
                      onChange={(e) => setResolutionDraft(e.target.value)}
                      rows={3}
                      placeholder="Describe how the issue was fixed…"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-9"
                        onClick={() => setShowResolution(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="min-h-9"
                        disabled={statusMutation.isPending}
                        onClick={() => statusMutation.mutate({ status: 'RESOLVED', resolution: resolutionDraft.trim() })}
                      >
                        {statusMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                        Mark resolved
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {/* Quick edit: assignee / category / priority */}
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ticket-assignee">Assignee</Label>
                  <Select
                    value={detail.assignedTo ?? NONE}
                    onValueChange={(v) =>
                      quickEditMutation.mutate({ assignedTo: v === NONE ? '' : v })
                    }
                    disabled={quickEditMutation.isPending}
                  >
                    <SelectTrigger id="ticket-assignee" aria-label="Change assignee">
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Unassigned</SelectItem>
                      {assigneeChoices.map((name) => (
                        <SelectItem key={name} value={name}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ticket-category">Category</Label>
                  <Select
                    value={detail.category ?? NONE}
                    onValueChange={(v) =>
                      quickEditMutation.mutate({ category: v === NONE ? '' : v })
                    }
                    disabled={quickEditMutation.isPending}
                  >
                    <SelectTrigger id="ticket-category" aria-label="Change category">
                      <SelectValue placeholder="No category" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No category</SelectItem>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ticket-priority">Priority</Label>
                  <Select
                    value={detail.priority}
                    onValueChange={(v) => quickEditMutation.mutate({ priority: v })}
                    disabled={quickEditMutation.isPending}
                  >
                    <SelectTrigger id="ticket-priority" aria-label="Change priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PRIORITIES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {PRIORITY_LABEL[p]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Message thread */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Conversation ({detail.messages.length})
                  </p>
                </div>
                <div
                  ref={threadRef}
                  className={cn('max-h-96 space-y-3 overflow-y-auto pr-1', scrollbarCls)}
                >
                  {detail.messages.length === 0 && (
                    <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                      No messages yet — reply below to start the conversation.
                    </p>
                  )}
                  {detail.messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        'rounded-lg border p-3',
                        m.isInternal
                          ? 'border-l-4 border-l-amber-400 bg-amber-50/50'
                          : 'bg-card',
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                        <p className="text-sm font-medium">{m.author}</p>
                        <p className="text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</p>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{m.content}</p>
                      {m.isInternal && (
                        <Badge
                          variant="outline"
                          className="mt-2 border-amber-200 bg-amber-50 text-amber-700"
                        >
                          Internal
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Reply form */}
              <div className="space-y-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="ticket-reply">Reply as {REPLY_AUTHOR}</Label>
                  <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-0">
                    <Checkbox
                      checked={replyInternal}
                      onCheckedChange={(v) => setReplyInternal(v === true)}
                      aria-label="Mark reply as internal note"
                    />
                    Internal note
                  </label>
                </div>
                <Textarea
                  id="ticket-reply"
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                  rows={3}
                  placeholder="Write a reply…"
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    className="min-h-9"
                    disabled={!replyContent.trim() || replyMutation.isPending}
                    onClick={() => replyMutation.mutate()}
                  >
                    {replyMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Send className="h-4 w-4" aria-hidden />
                    )}
                    Send reply
                  </Button>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
export default function TicketsModule() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL')
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<TicketRow | null>(null)
  const [form, setForm] = useState<TicketFormState>(emptyForm)
  const [deleteTarget, setDeleteTarget] = useState<TicketRow | null>(null)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const listQuery = useQuery({
    queryKey: ['tickets'],
    queryFn: () => get<TicketRow[]>('/api/tickets'),
  })

  // Shared cache with the Third Parties module
  const thirdPartiesQuery = useQuery({
    queryKey: ['third-parties'],
    queryFn: () => get<ThirdPartyOption[]>('/api/third-parties'),
  })

  // /api/employees belongs to the HR module and may not exist yet — degrade to
  // a plain text input by returning an empty list on failure.
  const employeesQuery = useQuery({
    queryKey: ['employees'],
    queryFn: async () => {
      try {
        return await get<EmployeeRow[]>('/api/employees')
      } catch {
        return [] as EmployeeRow[]
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  })

  const data = listQuery.data ?? []

  const stats = useMemo(() => {
    const periodMs = 30 * 86_400_000
    const now = Date.now()
    const open = data.filter((t) => OPEN_STATUSES.has(t.status))
    return {
      total: data.length,
      open: open.length,
      unassigned: open.filter((t) => !t.assignedTo).length,
      highUrgent: open.filter((t) => t.priority === 'HIGH' || t.priority === 'URGENT').length,
      resolvedPeriod: data.filter(
        (t) =>
          (t.status === 'RESOLVED' || t.status === 'CLOSED') &&
          now - new Date(t.updatedAt).getTime() <= periodMs,
      ).length,
    }
  }, [data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter((t) => {
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false
      if (priorityFilter !== 'ALL' && t.priority !== priorityFilter) return false
      if (categoryFilter !== 'ALL' && t.category !== categoryFilter) return false
      if (!q) return true
      return [t.ref, t.subject, t.thirdParty?.name ?? '', t.assignedTo ?? ''].some((v) =>
        v.toLowerCase().includes(q),
      )
    })
  }, [data, search, statusFilter, priorityFilter, categoryFilter])

  const sortedThirdParties = useMemo(
    () => [...(thirdPartiesQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [thirdPartiesQuery.data],
  )

  /** Employee names (when HR module is live) + assignees already used on tickets */
  const assigneeOptions = useMemo(() => {
    const names = (employeesQuery.data ?? []).map((e) => `${e.firstName} ${e.lastName}`)
    const used = data.map((t) => t.assignedTo).filter((v): v is string => !!v)
    return Array.from(new Set([...names, ...used])).sort((a, b) => a.localeCompare(b))
  }, [employeesQuery.data, data])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['tickets'] })
  }

  // ---- mutations ----------------------------------------------------------
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        subject: form.subject.trim(),
        thirdPartyId: form.thirdPartyId === NONE ? '' : form.thirdPartyId,
        category: form.category === NONE ? '' : form.category,
        priority: form.priority,
        assignedTo: form.assignedTo.trim(),
        description: form.description,
      }
      if (editing) return put<TicketRow>(`/api/tickets/${editing.id}`, payload)
      return post<TicketRow>('/api/tickets', payload)
    },
    onSuccess: () => {
      toast({
        title: editing ? 'Ticket updated' : 'Ticket created',
        description: form.subject.trim(),
      })
      invalidate()
      setFormOpen(false)
      setEditing(null)
    },
    onError: (err: Error) =>
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => del(`/api/tickets/${id}`),
    onSuccess: () => {
      toast({ title: 'Ticket deleted' })
      setDeleteTarget(null)
      invalidate()
    },
    onError: (err: Error) =>
      toast({ title: 'Could not delete', description: err.message, variant: 'destructive' }),
  })

  // ---- dialog helpers -----------------------------------------------------
  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (t: TicketRow) => {
    setEditing(t)
    setForm({
      subject: t.subject,
      thirdPartyId: t.thirdParty?.id ?? NONE,
      category: t.category ?? NONE,
      priority: t.priority,
      assignedTo: t.assignedTo ?? '',
      description: t.description ?? '',
    })
    setFormOpen(true)
  }

  const openDetail = (id: string) => {
    setDetailId(id)
    setDetailOpen(true)
  }

  const canSave = form.subject.trim().length > 0 && !saveMutation.isPending

  return (
    <div className="space-y-5">
      <PageHeader
        icon={LifeBuoy}
        title="Tickets"
        description="Help desk — track customer support requests from intake to resolution"
        actions={
          <Button onClick={openCreate} className="min-h-11 sm:min-h-9">
            <Plus className="h-4 w-4" aria-hidden />
            New ticket
          </Button>
        }
      />

      {/* Stats */}
      {listQuery.isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard title="Open tickets" value={stats.open} hint="new · assigned · in progress" icon={Inbox} />
          <StatCard title="Unassigned" value={stats.unassigned} hint="open without an assignee" icon={UserX} tone="warning" />
          <StatCard title="High & urgent" value={stats.highUrgent} hint="open, high priority" icon={LifeBuoy} tone="danger" />
          <StatCard title="Resolved (30d)" value={stats.resolvedPeriod} hint="resolved or closed recently" icon={CheckCircle2} tone="success" />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ref, subject, third party…"
            className="pl-8"
            aria-label="Search tickets"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Filter by priority">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All priorities</SelectItem>
            {PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Filter by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {listQuery.isError && (
            <p className="p-4 text-sm text-destructive">
              Failed to load tickets: {listQuery.error.message}
            </p>
          )}
          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isPending &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                {!listQuery.isPending && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="p-0">
                      <div className="p-6">
                        <EmptyState
                          icon={LifeBuoy}
                          title={data.length === 0 ? 'No tickets yet' : 'No tickets match your filters'}
                          description={
                            data.length === 0
                              ? 'Create your first support ticket to start helping customers.'
                              : 'Try another search term or clear the filters.'
                          }
                          actionLabel={data.length === 0 ? 'New ticket' : undefined}
                          onAction={data.length === 0 ? openCreate : undefined}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {t.ref}
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <p className="truncate font-medium" title={t.subject}>
                        {t.subject}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {t.thirdParty ? t.thirdParty.name : 'No third party'}
                      </p>
                    </TableCell>
                    <TableCell>
                      {t.category ? (
                        <StatusBadge status={t.category} tone={CATEGORY_TONE[t.category]} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={t.priority} />
                    </TableCell>
                    <TableCell>
                      <DocStatusBadge status={t.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {t.assignedTo ?? <span className="text-muted-foreground">Unassigned</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {relativeDays(t.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 sm:h-8 sm:w-8"
                          onClick={() => openDetail(t.id)}
                          aria-label={`Open ticket ${t.ref}`}
                          title="Open ticket"
                        >
                          <Eye className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 sm:h-8 sm:w-8"
                          onClick={() => openEdit(t)}
                          aria-label={`Edit ticket ${t.ref}`}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-8 sm:w-8"
                          onClick={() => setDeleteTarget(t)}
                          aria-label={`Delete ticket ${t.ref}`}
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create / edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ticket ${editing.ref}` : 'New ticket'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Update the ticket details. Status changes are made from the ticket view.'
                : 'Log a new support request. It starts with status "New".'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ticket-subject">Subject *</Label>
              <Input
                id="ticket-subject"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="e.g. Gateway loses connection every night"
                autoFocus
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ticket-tp">Third party</Label>
                <Select
                  value={form.thirdPartyId}
                  onValueChange={(v) => setForm({ ...form, thirdPartyId: v })}
                >
                  <SelectTrigger id="ticket-tp" aria-label="Third party">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No third party</SelectItem>
                    {sortedThirdParties.map((tp) => (
                      <SelectItem key={tp.id} value={tp.id}>
                        {tp.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ticket-form-category">Category</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) => setForm({ ...form, category: v })}
                >
                  <SelectTrigger id="ticket-form-category" aria-label="Category">
                    <SelectValue placeholder="No category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>No category</SelectItem>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {CATEGORY_LABEL[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ticket-form-priority">Priority</Label>
                <Select
                  value={form.priority}
                  onValueChange={(v) => setForm({ ...form, priority: v as TicketPriority })}
                >
                  <SelectTrigger id="ticket-form-priority" aria-label="Priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {PRIORITY_LABEL[p]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ticket-form-assignee">Assigned to</Label>
                <Input
                  id="ticket-form-assignee"
                  value={form.assignedTo}
                  onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
                  placeholder="Leave empty to assign later"
                  list="ticket-assignee-options"
                />
                <datalist id="ticket-assignee-options">
                  {assigneeOptions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-form-description">Description</Label>
              <Textarea
                id="ticket-form-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={4}
                placeholder="Describe the issue reported by the customer…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="min-h-11 sm:min-h-9"
              disabled={!canSave}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {editing ? 'Save changes' : 'Create ticket'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <TicketDetailDialog
        ticketId={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        assigneeOptions={assigneeOptions}
      />

      {/* Delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ticket?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{' '}
              <span className="font-mono text-xs">{deleteTarget?.ref}</span> “{deleteTarget?.subject}”
              and its full message history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 sm:min-h-9">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
