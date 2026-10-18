'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BadgeDollarSign, Check, CircleDollarSign, Eye, FileCheck2, Loader2,
  MoreHorizontal, Pencil, Plus, ReceiptText, Search, Send, Trash2, Wallet, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { PageHeader, EmptyState } from '@/components/erp/shared/page-header'
import { DocStatusBadge, StatusBadge, type Tone } from '@/components/erp/shared/status-badge'
import { StatCard } from '@/components/erp/shared/stat-card'
import { formatMoney, formatDate, toDateInput } from '@/components/erp/shared/format'
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

interface ExpenseReportRow {
  id: string
  ref: string
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID'
  date: string
  notes: string | null
  total: number
  createdAt: string
  updatedAt: string
  employee: EmployeeMini
  _count: { lines: number }
}

interface ExpenseLineRow {
  id: string
  reportId: string
  category: 'MEAL' | 'TRAVEL' | 'HOTEL' | 'SUPPLIES' | 'OTHER'
  date: string
  amount: number
  note: string | null
}

interface ExpenseReportDetail extends Omit<ExpenseReportRow, '_count'> {
  lines: ExpenseLineRow[]
}

/** Common header fields shared by list rows and detail payloads */
type ReportCore = Pick<
  ExpenseReportRow,
  'id' | 'ref' | 'status' | 'date' | 'notes' | 'employee'
>

interface EmployeeOption {
  id: string
  firstName: string
  lastName: string
  employeeCode: string
  status: string
}

type ReportStatus = ExpenseReportRow['status']
type LineCategory = ExpenseLineRow['category']

const CATEGORIES: LineCategory[] = ['MEAL', 'TRAVEL', 'HOTEL', 'SUPPLIES', 'OTHER']

const CATEGORY_TONE: Record<LineCategory, Tone> = {
  MEAL: 'warning',
  TRAVEL: 'info',
  HOTEL: 'neutral',
  SUPPLIES: 'muted',
  OTHER: 'muted',
}

const CATEGORY_LABEL: Record<LineCategory, string> = {
  MEAL: 'Meal',
  TRAVEL: 'Travel',
  HOTEL: 'Hotel',
  SUPPLIES: 'Supplies',
  OTHER: 'Other',
}

const STATUSES: ReportStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID']

const sameMonth = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

const empName = (e: Pick<EmployeeMini, 'firstName' | 'lastName'>) => `${e.firstName} ${e.lastName}`

const emptyForm = { employeeId: '', date: '', notes: '' }

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
export default function ExpensesModule() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [employeeFilter, setEmployeeFilter] = useState('ALL')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ReportCore | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ReportCore | null>(null)

  const listQuery = useQuery({
    queryKey: ['expenses'],
    queryFn: () => get<ExpenseReportRow[]>('/api/expenses'),
  })

  // Shared employee cache with the Employees module
  const employeesQuery = useQuery({
    queryKey: ['employees'],
    queryFn: () => get<EmployeeOption[]>('/api/employees'),
  })

  const data = listQuery.data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter((r) => {
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false
      if (employeeFilter !== 'ALL' && r.employee.id !== employeeFilter) return false
      if (!q) return true
      return [r.ref, empName(r.employee), r.employee.employeeCode].some((v) =>
        v.toLowerCase().includes(q),
      )
    })
  }, [data, search, statusFilter, employeeFilter])

  const stats = useMemo(() => {
    const submitted = data.filter((r) => r.status === 'SUBMITTED')
    const approved = data.filter((r) => r.status === 'APPROVED')
    const paidThisMonth = data.filter((r) => r.status === 'PAID' && sameMonth(r.date))
    const drafts = data.filter((r) => r.status === 'DRAFT')
    return {
      awaiting: submitted.length,
      awaitingSum: submitted.reduce((s, r) => s + r.total, 0),
      approvedSum: approved.reduce((s, r) => s + r.total, 0),
      approvedCount: approved.length,
      paidSum: paidThisMonth.reduce((s, r) => s + r.total, 0),
      paidCount: paidThisMonth.length,
      drafts: drafts.length,
    }
  }, [data])

  const employees = useMemo(
    () => [...(employeesQuery.data ?? [])].sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
    ),
    [employeesQuery.data],
  )

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['expenses'] })
    void queryClient.invalidateQueries({ queryKey: ['expense'] })
  }

  // ---- mutations ----------------------------------------------------------
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        employeeId: form.employeeId,
        date: form.date,
        notes: form.notes.trim(),
      }
      if (editing) return put(`/api/expenses/${editing.id}`, payload)
      return post('/api/expenses', payload)
    },
    onSuccess: () => {
      toast({
        title: editing ? 'Report updated' : 'Expense report created',
        description: editing ? editing.ref : 'Add expense lines, then submit it for approval.',
      })
      invalidate()
      setFormOpen(false)
      setEditing(null)
    },
    onError: (err: Error) =>
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' }),
  })

  const workflowMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'submit' | 'approve' | 'reject' | 'mark_paid' }) =>
      put(`/api/expenses/${id}`, { action }),
    onSuccess: (_res, vars) => {
      const titles: Record<typeof vars.action, string> = {
        submit: 'Report submitted',
        approve: 'Report approved',
        reject: 'Report rejected',
        mark_paid: 'Report marked as paid',
      }
      toast({ title: titles[vars.action] })
      invalidate()
    },
    onError: (err: Error) =>
      toast({ title: 'Workflow failed', description: err.message, variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => del(`/api/expenses/${id}`),
    onSuccess: () => {
      toast({ title: 'Expense report deleted' })
      invalidate()
      setDetailId(null)
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

  const openEdit = (r: ReportCore) => {
    setEditing(r)
    setForm({ employeeId: r.employee.id, date: toDateInput(r.date), notes: r.notes ?? '' })
    setFormOpen(true)
  }

  /** Workflow actions available for a report, per status rules */
  const actionsFor = (status: ReportStatus) => ACTIONS_BY_STATUS[status] ?? []

  const canSave = form.employeeId !== '' && !saveMutation.isPending

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Wallet}
        title="Expense reports"
        description="Employee expense claims, from draft to reimbursement"
        actions={
          <Button onClick={openCreate} className="min-h-11 sm:min-h-9">
            <Plus className="h-4 w-4" aria-hidden />
            New report
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
            title="Awaiting approval"
            value={stats.awaiting}
            hint={`${formatMoney(stats.awaitingSum)} submitted`}
            icon={FileCheck2}
            tone={stats.awaiting > 0 ? 'warning' : 'default'}
          />
          <StatCard
            title="Approved (unpaid)"
            value={stats.approvedSum}
            isMoney
            hint={`${stats.approvedCount} report(s) to reimburse`}
            icon={CircleDollarSign}
            tone="success"
          />
          <StatCard
            title="Paid this month"
            value={stats.paidSum}
            isMoney
            hint={`${stats.paidCount} report(s) settled`}
            icon={BadgeDollarSign}
          />
          <StatCard
            title="Drafts"
            value={stats.drafts}
            hint="Still editable"
            icon={ReceiptText}
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ref or employee…"
            className="pl-8"
            aria-label="Search expense reports"
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
                {s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')}
              </SelectItem>
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
              Failed to load expense reports: {listQuery.error.message}
            </p>
          )}
          <div className="overflow-x-auto">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isPending &&
                  Array.from({ length: 3 }).map((_, i) => (
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
                          icon={Wallet}
                          title={data.length === 0 ? 'No expense reports yet' : 'No reports match your filters'}
                          description={
                            data.length === 0
                              ? 'Create an expense report, add lines, then submit it.'
                              : 'Try another search term or clear the filters.'
                          }
                          actionLabel={data.length === 0 ? 'New report' : undefined}
                          onAction={data.length === 0 ? openCreate : undefined}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((r) => {
                  const menuActions = actionsFor(r.status)
                  const draft = r.status === 'DRAFT'
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="whitespace-nowrap font-mono text-xs font-medium">
                        {r.ref}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{formatDate(r.date)}</TableCell>
                      <TableCell>
                        <p className="whitespace-nowrap text-sm font-medium">{empName(r.employee)}</p>
                        <p className="font-mono text-xs text-muted-foreground">{r.employee.employeeCode}</p>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{r._count.lines}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                        {formatMoney(r.total)}
                      </TableCell>
                      <TableCell>
                        <DocStatusBadge status={r.status} />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 sm:h-8 sm:w-8"
                            onClick={() => setDetailId(r.id)}
                            aria-label={`View ${r.ref}`}
                            title="View details"
                          >
                            <Eye className="h-4 w-4" aria-hidden />
                          </Button>
                          {draft && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 sm:h-8 sm:w-8"
                                onClick={() => openEdit(r)}
                                aria-label={`Edit ${r.ref}`}
                                title="Edit (draft only)"
                              >
                                <Pencil className="h-4 w-4" aria-hidden />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-8 sm:w-8"
                                onClick={() => setDeleteTarget(r)}
                                aria-label={`Delete ${r.ref}`}
                                title="Delete (draft only)"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </Button>
                            </>
                          )}
                          {menuActions.length > 0 && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-9 w-9 sm:h-8 sm:w-8"
                                  aria-label={`Workflow actions for ${r.ref}`}
                                  title="Workflow"
                                >
                                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {menuActions.map((a) => (
                                  <DropdownMenuItem
                                    key={a.action}
                                    onClick={() => workflowMutation.mutate({ id: r.id, action: a.action })}
                                    className={a.action === 'reject' ? 'text-rose-600 focus:text-rose-700' : ''}
                                  >
                                    <a.icon className="h-4 w-4" aria-hidden />
                                    {a.label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
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
            <DialogTitle>{editing ? 'Edit expense report' : 'New expense report'}</DialogTitle>
            <DialogDescription>
              {editing
                ? `Update the draft ${editing.ref}. Lines are managed in the detail view.`
                : 'The report starts as a draft — add expense lines, then submit it.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1">
            <div className="space-y-1.5">
              <Label>Employee *</Label>
              <Select
                value={form.employeeId}
                onValueChange={(v) => setForm({ ...form, employeeId: v })}
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
              <Label htmlFor="exp-date">Date</Label>
              <Input
                id="exp-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="exp-notes">Notes</Label>
              <Textarea
                id="exp-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Business trip, client visit…"
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
                <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
              )}
              {editing ? 'Save changes' : 'Create report'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <ReportDetailDialog
        reportId={detailId}
        onOpenChange={(open) => !open && setDetailId(null)}
        onWorkflow={(action) => {
          if (detailId) workflowMutation.mutate({ id: detailId, action })
        }}
        onEdit={(r) => {
          setDetailId(null)
          openEdit(r)
        }}
        onDelete={(r) => {
          setDetailId(null)
          setDeleteTarget(r)
        }}
        workflowPending={workflowMutation.isPending}
      />

      {/* Delete confirm */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete expense report?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  This will permanently remove <strong>{deleteTarget.ref}</strong> and all its
                  expense lines. Only draft reports can be deleted.
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

// ---------------------------------------------------------------------------
// Detail dialog (report header + lines table + inline add-line form)
// ---------------------------------------------------------------------------
function ReportDetailDialog({
  reportId,
  onOpenChange,
  onWorkflow,
  onEdit,
  onDelete,
  workflowPending,
}: {
  reportId: string | null
  onOpenChange: (open: boolean) => void
  onWorkflow: (action: 'submit' | 'approve' | 'reject' | 'mark_paid') => void
  onEdit: (r: ReportCore) => void
  onDelete: (r: ReportCore) => void
  workflowPending: boolean
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const detailQuery = useQuery({
    queryKey: ['expense', reportId],
    queryFn: () => get<ExpenseReportDetail>(`/api/expenses/${reportId}`),
    enabled: reportId !== null,
  })

  const report = detailQuery.data
  const isDraft = report?.status === 'DRAFT'

  const invalidateDetail = () => {
    void queryClient.invalidateQueries({ queryKey: ['expense', reportId] })
    void queryClient.invalidateQueries({ queryKey: ['expenses'] })
  }

  const [lineCategory, setLineCategory] = useState<LineCategory>('TRAVEL')
  const [lineDate, setLineDate] = useState('')
  const [lineAmount, setLineAmount] = useState('')
  const [lineNote, setLineNote] = useState('')

  const addLineMutation = useMutation({
    mutationFn: () => {
      const amount = Number(lineAmount)
      return post(`/api/expenses/${reportId}/lines`, {
        category: lineCategory,
        date: lineDate,
        amount: Number.isFinite(amount) ? amount : 0,
        note: lineNote.trim(),
      })
    },
    onSuccess: () => {
      toast({ title: 'Expense line added' })
      setLineAmount('')
      setLineNote('')
      invalidateDetail()
    },
    onError: (err: Error) =>
      toast({ title: 'Could not add line', description: err.message, variant: 'destructive' }),
  })

  const deleteLineMutation = useMutation({
    mutationFn: (lineId: string) => del(`/api/expenses/${reportId}/lines/${lineId}`),
    onSuccess: () => {
      toast({ title: 'Expense line removed' })
      invalidateDetail()
    },
    onError: (err: Error) =>
      toast({ title: 'Could not remove line', description: err.message, variant: 'destructive' }),
  })

  const canAddLine =
    isDraft &&
    Number(lineAmount) > 0 &&
    Number.isFinite(Number(lineAmount)) &&
    !addLineMutation.isPending

  const menuActions = report ? ACTIONS_BY_STATUS[report.status] ?? [] : []

  return (
    <Dialog open={reportId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {detailQuery.isPending || !report ? (
          <>
            <DialogHeader>
              <DialogTitle>Expense report</DialogTitle>
              <DialogDescription>Loading report details…</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{report.ref}</span>
                <DocStatusBadge status={report.status} />
              </DialogTitle>
              <DialogDescription>
                {empName(report.employee)} · {report.employee.employeeCode} · {formatDate(report.date)}
                {report.notes ? ` — ${report.notes}` : ''}
              </DialogDescription>
            </DialogHeader>

            {/* Header workflow actions */}
            <div className="flex flex-wrap items-center gap-2">
              {menuActions.map((a) => (
                <Button
                  key={a.action}
                  size="sm"
                  variant={a.action === 'reject' ? 'outline' : 'default'}
                  className={
                    a.action === 'reject'
                      ? 'min-h-9 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700'
                      : 'min-h-9'
                  }
                  onClick={() => onWorkflow(a.action)}
                  disabled={workflowPending}
                >
                  {workflowPending ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <a.icon className="mr-1 h-4 w-4" aria-hidden />
                  )}
                  {a.label}
                </Button>
              ))}
              {isDraft && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9"
                    onClick={() => onEdit(report)}
                  >
                    <Pencil className="mr-1 h-4 w-4" aria-hidden />
                    Edit header
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="min-h-9 border-rose-200 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                    onClick={() => onDelete(report)}
                  >
                    <Trash2 className="mr-1 h-4 w-4" aria-hidden />
                    Delete draft
                  </Button>
                </>
              )}
              {menuActions.length === 0 && !isDraft && (
                <p className="text-xs text-muted-foreground">
                  No actions available — this report is final.
                </p>
              )}
            </div>

            <Separator />

            {/* Lines table */}
            <div className="max-h-[40vh] overflow-y-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    {isDraft && <TableHead className="w-10"><span className="sr-only">Remove</span></TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.lines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={isDraft ? 5 : 4}>
                        <p className="py-6 text-center text-sm text-muted-foreground">
                          No expense lines yet{isDraft ? ' — add the first one below.' : '.'}
                        </p>
                      </TableCell>
                    </TableRow>
                  )}
                  {report.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell>
                        <StatusBadge status={l.category} label={CATEGORY_LABEL[l.category]} tone={CATEGORY_TONE[l.category]} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{formatDate(l.date)}</TableCell>
                      <TableCell className="max-w-[220px]">
                        {l.note ? (
                          <p className="truncate text-sm text-muted-foreground" title={l.note}>{l.note}</p>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                        {formatMoney(l.amount)}
                      </TableCell>
                      {isDraft && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-8 sm:w-8"
                            onClick={() => deleteLineMutation.mutate(l.id)}
                            disabled={deleteLineMutation.isPending}
                            aria-label={`Remove ${CATEGORY_LABEL[l.category]} line of ${formatMoney(l.amount)}`}
                            title="Remove line"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Add-line inline form (DRAFT only) */}
            {isDraft && (
              <div className="rounded-md border bg-muted/40 p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Add expense line
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="space-y-1">
                    <Label className="sr-only" htmlFor="line-category">Category</Label>
                    <Select
                      value={lineCategory}
                      onValueChange={(v) => setLineCategory(v as LineCategory)}
                    >
                      <SelectTrigger id="line-category" aria-label="Line category" className="min-h-11 sm:min-h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>{CATEGORY_LABEL[c]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="sr-only" htmlFor="line-date">Date</Label>
                    <Input
                      id="line-date"
                      type="date"
                      value={lineDate}
                      onChange={(e) => setLineDate(e.target.value)}
                      className="min-h-11 sm:min-h-9"
                      aria-label="Line date"
                    />
                  </div>
                  <div>
                    <Label className="sr-only" htmlFor="line-amount">Amount</Label>
                    <Input
                      id="line-amount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={lineAmount}
                      onChange={(e) => setLineAmount(e.target.value)}
                      placeholder="Amount $"
                      className="min-h-11 sm:min-h-9"
                      aria-label="Line amount"
                    />
                  </div>
                  <Button
                    onClick={() => addLineMutation.mutate()}
                    disabled={!canAddLine}
                    className="min-h-11 sm:min-h-9"
                  >
                    {addLineMutation.isPending ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Plus className="mr-1 h-4 w-4" aria-hidden />
                    )}
                    Add line
                  </Button>
                </div>
                <div className="mt-2">
                  <Label className="sr-only" htmlFor="line-note">Note</Label>
                  <Input
                    id="line-note"
                    value={lineNote}
                    onChange={(e) => setLineNote(e.target.value)}
                    placeholder="Note (optional) — e.g. taxi to client office"
                    className="min-h-11 sm:min-h-9"
                    aria-label="Line note"
                  />
                </div>
              </div>
            )}

            {/* Footer total */}
            <div className="flex items-center justify-between rounded-md bg-primary/5 px-4 py-3">
              <span className="text-sm font-medium text-muted-foreground">
                Total ({report.lines.length} line{report.lines.length === 1 ? '' : 's'})
              </span>
              <span className="text-lg font-bold tabular-nums text-primary">
                {formatMoney(report.total)}
              </span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Workflow menu items per report status */
const ACTIONS_BY_STATUS: Record<
  ReportStatus,
  { action: 'submit' | 'approve' | 'reject' | 'mark_paid'; label: string; icon: typeof Send }[]
> = {
  DRAFT: [{ action: 'submit', label: 'Submit for approval', icon: Send }],
  SUBMITTED: [
    { action: 'approve', label: 'Approve', icon: Check },
    { action: 'reject', label: 'Reject', icon: XCircle },
  ],
  APPROVED: [{ action: 'mark_paid', label: 'Mark as paid', icon: BadgeDollarSign }],
  REJECTED: [],
  PAID: [],
}
