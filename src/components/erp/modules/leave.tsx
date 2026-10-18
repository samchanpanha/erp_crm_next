'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarCheck2, CalendarClock, CalendarX2, Check, Palmtree, Pencil, Plus, Trash2, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
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
import { DocStatusBadge, StatusBadge, type Tone } from '@/components/erp/shared/status-badge'
import { StatCard } from '@/components/erp/shared/stat-card'
import { formatDate, toDateInput } from '@/components/erp/shared/format'
import { get, post, put, del } from '@/components/erp/lib/api'
import { useToast } from '@/hooks/use-toast'

// ---------------------------------------------------------------------------
// Types (mirror API payloads)
// ---------------------------------------------------------------------------
interface EmployeeMini {
  id: string
  firstName: string
  lastName: string
  employeeCode: string
}

interface LeaveRow {
  id: string
  type: 'PAID' | 'SICK' | 'UNPAID' | 'OTHER'
  startDate: string
  endDate: string
  days: number
  reason: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED'
  createdAt: string
  employee: EmployeeMini
}

interface EmployeeOption {
  id: string
  firstName: string
  lastName: string
  employeeCode: string
  status: string
}

const TYPES = ['PAID', 'SICK', 'UNPAID', 'OTHER'] as const
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const

const TYPE_TONE: Record<(typeof TYPES)[number], Tone> = {
  PAID: 'info',
  SICK: 'danger',
  UNPAID: 'muted',
  OTHER: 'warning',
}

const TYPE_LABEL: Record<(typeof TYPES)[number], string> = {
  PAID: 'Paid',
  SICK: 'Sick',
  UNPAID: 'Unpaid',
  OTHER: 'Other',
}

const emptyForm = {
  employeeId: '',
  type: 'PAID' as (typeof TYPES)[number],
  startDate: '',
  endDate: '',
  reason: '',
}

type FormState = typeof emptyForm

/** Auto days = (end - start) in days + 1 (same formula as the API) */
function computeDays(start: string, end: string): number {
  if (!start || !end) return 0
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  if (Number.isNaN(s) || Number.isNaN(e) || e < s) return 0
  return Math.round((e - s) / 86400000 + 1)
}

const sameMonth = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

const sameYear = (iso: string) => new Date(iso).getFullYear() === new Date().getFullYear()

const empName = (e: Pick<EmployeeMini, 'firstName' | 'lastName'>) => `${e.firstName} ${e.lastName}`

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
export default function LeaveModule() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [statusFilter, setStatusFilter] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState('ALL')
  const [employeeFilter, setEmployeeFilter] = useState('ALL')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<LeaveRow | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [deleteTarget, setDeleteTarget] = useState<LeaveRow | null>(null)

  const listQuery = useQuery({
    queryKey: ['leave-requests'],
    queryFn: () => get<LeaveRow[]>('/api/leave'),
  })

  // Shared employee cache with the Employees module
  const employeesQuery = useQuery({
    queryKey: ['employees'],
    queryFn: () => get<EmployeeOption[]>('/api/employees'),
  })

  const data = listQuery.data ?? []

  const filtered = useMemo(() => {
    return data.filter((l) => {
      if (statusFilter !== 'ALL' && l.status !== statusFilter) return false
      if (typeFilter !== 'ALL' && l.type !== typeFilter) return false
      if (employeeFilter !== 'ALL' && l.employee.id !== employeeFilter) return false
      return true
    })
  }, [data, statusFilter, typeFilter, employeeFilter])

  const stats = useMemo(() => {
    const pending = data.filter((l) => l.status === 'PENDING').length
    const approvedThisMonth = data.filter(
      (l) => l.status === 'APPROVED' && sameMonth(l.startDate),
    ).length
    const daysYtd = data
      .filter((l) => l.status === 'APPROVED' && sameYear(l.startDate))
      .reduce((s, l) => s + l.days, 0)
    const rejected = data.filter((l) => l.status === 'REJECTED').length
    return { pending, approvedThisMonth, daysYtd, rejected }
  }, [data])

  const employees = useMemo(
    () => [...(employeesQuery.data ?? [])].sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
    ),
    [employeesQuery.data],
  )

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['leave-requests'] })
  }

  // ---- mutations ----------------------------------------------------------
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        employeeId: form.employeeId,
        type: form.type,
        startDate: form.startDate,
        endDate: form.endDate,
        reason: form.reason.trim(),
      }
      if (editing) return put(`/api/leave/${editing.id}`, payload)
      return post('/api/leave', payload)
    },
    onSuccess: () => {
      toast({
        title: editing ? 'Leave request updated' : 'Leave request created',
        description: `${TYPE_LABEL[form.type]} · ${computeDays(form.startDate, form.endDate)} day(s)`,
      })
      invalidate()
      setFormOpen(false)
      setEditing(null)
    },
    onError: (err: Error) =>
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' }),
  })

  const decisionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      put(`/api/leave/${id}`, { action }),
    onSuccess: (_res, vars) => {
      toast({
        title: vars.action === 'approve' ? 'Leave approved' : 'Leave rejected',
        description: 'The employee has been notified.',
      })
      invalidate()
    },
    onError: (err: Error) =>
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => del(`/api/leave/${id}`),
    onSuccess: () => {
      toast({ title: 'Leave request deleted' })
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

  const openEdit = (l: LeaveRow) => {
    setEditing(l)
    setForm({
      employeeId: l.employee.id,
      type: l.type,
      startDate: toDateInput(l.startDate),
      endDate: toDateInput(l.endDate),
      reason: l.reason ?? '',
    })
    setFormOpen(true)
  }

  const canSave =
    form.employeeId !== '' &&
    form.startDate !== '' &&
    form.endDate !== '' &&
    computeDays(form.startDate, form.endDate) > 0 &&
    !saveMutation.isPending

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Palmtree}
        title="Leave requests"
        description="Approve or reject time-off requests from your team"
        actions={
          <Button onClick={openCreate} className="min-h-11 sm:min-h-9">
            <Plus className="h-4 w-4" aria-hidden />
            New request
          </Button>
        }
      />

      {/* Stats */}
      {listQuery.isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            title="Pending approvals"
            value={stats.pending}
            hint="Awaiting decision"
            icon={CalendarClock}
            tone={stats.pending > 0 ? 'warning' : 'default'}
          />
          <StatCard
            title="Approved this month"
            value={stats.approvedThisMonth}
            hint="Starts in current month"
            icon={CalendarCheck2}
            tone="success"
          />
          <StatCard
            title="Days taken YTD"
            value={stats.daysYtd}
            hint="Σ approved days"
            icon={Palmtree}
          />
          <StatCard
            title="Rejected"
            value={stats.rejected}
            hint="All time"
            icon={CalendarX2}
            tone={stats.rejected > 0 ? 'danger' : 'default'}
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'PENDING' ? 'Pending' : s === 'APPROVED' ? 'Approved' : s === 'REJECTED' ? 'Rejected' : 'Cancelled'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Filter by type">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            {TYPES.map((t) => (
              <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
          <SelectTrigger className="w-full sm:w-52" aria-label="Filter by employee">
            <SelectValue placeholder="Employee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All employees</SelectItem>
            {employees.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {empName(e)} · {e.employeeCode}
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
              Failed to load leave requests: {listQuery.error.message}
            </p>
          )}
          <div className="overflow-x-auto">
            <Table className="min-w-[880px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isPending &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={7}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                {!listQuery.isPending && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="p-0">
                      <div className="p-6">
                        <EmptyState
                          icon={Palmtree}
                          title={data.length === 0 ? 'No leave requests yet' : 'No requests match your filters'}
                          description={
                            data.length === 0
                              ? 'Create a leave request to start tracking time off.'
                              : 'Try clearing the status, type or employee filters.'
                          }
                          actionLabel={data.length === 0 ? 'New request' : undefined}
                          onAction={data.length === 0 ? openCreate : undefined}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((l) => {
                  const pending = l.status === 'PENDING'
                  return (
                    <TableRow key={l.id}>
                      <TableCell>
                        <p className="whitespace-nowrap font-medium">{empName(l.employee)}</p>
                        <p className="font-mono text-xs text-muted-foreground">{l.employee.employeeCode}</p>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={l.type} label={TYPE_LABEL[l.type]} tone={TYPE_TONE[l.type]} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {formatDate(l.startDate)}
                        <span className="mx-1 text-muted-foreground">→</span>
                        {formatDate(l.endDate)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{l.days}</TableCell>
                      <TableCell className="max-w-[200px]">
                        {l.reason ? (
                          <p className="truncate text-sm text-muted-foreground" title={l.reason}>
                            {l.reason}
                          </p>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <DocStatusBadge status={l.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {pending && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 sm:h-8 sm:w-8"
                                onClick={() => decisionMutation.mutate({ id: l.id, action: 'approve' })}
                                disabled={decisionMutation.isPending}
                                aria-label={`Approve leave of ${empName(l.employee)}`}
                                title="Approve"
                              >
                                <Check className="h-4 w-4" aria-hidden />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-8 sm:w-8"
                                onClick={() => decisionMutation.mutate({ id: l.id, action: 'reject' })}
                                disabled={decisionMutation.isPending}
                                aria-label={`Reject leave of ${empName(l.employee)}`}
                                title="Reject"
                              >
                                <XCircle className="h-4 w-4" aria-hidden />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 sm:h-8 sm:w-8"
                                onClick={() => openEdit(l)}
                                aria-label={`Edit leave of ${empName(l.employee)}`}
                                title="Edit (pending only)"
                              >
                                <Pencil className="h-4 w-4" aria-hidden />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-8 sm:w-8"
                                onClick={() => setDeleteTarget(l)}
                                aria-label={`Delete leave of ${empName(l.employee)}`}
                                title="Delete (pending only)"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </Button>
                            </>
                          )}
                          {!pending && (
                            <span className="text-xs text-muted-foreground">Locked</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit leave request' : 'New leave request'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Pending requests only — the request stays PENDING after edit.'
                : 'Days are computed automatically from the date range.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label>Employee *</Label>
              <Select
                value={form.employeeId}
                onValueChange={(v) => setForm({ ...form, employeeId: v })}
                disabled={Boolean(editing)}
              >
                <SelectTrigger aria-label="Employee">
                  <SelectValue placeholder="Select an employee" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {empName(e)} · {e.employeeCode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v as (typeof TYPES)[number] })}
              >
                <SelectTrigger aria-label="Leave type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="leave-start">Start date *</Label>
                <Input
                  id="leave-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="leave-end">End date *</Label>
                <Input
                  id="leave-end"
                  type="date"
                  value={form.endDate}
                  min={form.startDate || undefined}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                />
              </div>
            </div>
            {form.startDate && form.endDate && (
              <p
                className={`text-xs ${computeDays(form.startDate, form.endDate) > 0 ? 'text-muted-foreground' : 'text-destructive'}`}
                role="status"
              >
                {computeDays(form.startDate, form.endDate) > 0
                  ? `Duration: ${computeDays(form.startDate, form.endDate)} day(s)`
                  : 'End date must be on or after start date.'}
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="leave-reason">Reason</Label>
              <Textarea
                id="leave-reason"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Family vacation, sick leave…"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!canSave}>
              {saveMutation.isPending && (
                <span className="mr-1 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
              )}
              {editing ? 'Save changes' : 'Create request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete leave request?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  This will permanently remove the {TYPE_LABEL[deleteTarget.type].toLowerCase()} leave
                  of <strong>{empName(deleteTarget.employee)}</strong>{' '}
                  ({formatDate(deleteTarget.startDate)} → {formatDate(deleteTarget.endDate)}). Only
                  pending requests can be deleted.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
                setDeleteTarget(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
