'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Building2, Pencil, Plus, Search, Trash2, Users, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { DocStatusBadge } from '@/components/erp/shared/status-badge'
import { StatCard } from '@/components/erp/shared/stat-card'
import { formatMoney, formatDate, toDateInput } from '@/components/erp/shared/format'
import { get, post, put, del } from '@/components/erp/lib/api'
import { useToast } from '@/hooks/use-toast'

// ---------------------------------------------------------------------------
// Types (mirror API payloads)
// ---------------------------------------------------------------------------
interface EmployeeRow {
  id: string
  employeeCode: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  position: string | null
  department: string | null
  hireDate: string | null
  salary: number
  status: 'ACTIVE' | 'SUSPENDED'
  createdAt: string
  updatedAt: string
  _count: {
    leaveRequests: number
    expenseReports: number
    timeEntries: number
  }
}

const STATUSES = ['ACTIVE', 'SUSPENDED'] as const

const emptyForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  position: '',
  department: '',
  hireDate: '',
  salary: '',
  status: 'ACTIVE' as 'ACTIVE' | 'SUSPENDED',
}

type FormState = typeof emptyForm

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
export default function EmployeesModule() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState('ALL')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<EmployeeRow | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [deleteTarget, setDeleteTarget] = useState<EmployeeRow | null>(null)

  const listQuery = useQuery({
    queryKey: ['employees'],
    queryFn: () => get<EmployeeRow[]>('/api/employees'),
  })

  const data = listQuery.data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter((e) => {
      if (departmentFilter !== 'ALL' && (e.department ?? '') !== departmentFilter) return false
      if (statusFilter !== 'ALL' && e.status !== statusFilter) return false
      if (!q) return true
      return [
        e.firstName, e.lastName, e.employeeCode, e.email ?? '', e.position ?? '', e.department ?? '',
      ].some((v) => v.toLowerCase().includes(q))
    })
  }, [data, search, departmentFilter, statusFilter])

  const departments = useMemo(
    () =>
      Array.from(
        new Set(data.map((e) => e.department).filter((d): d is string => Boolean(d))),
      ).sort((a, b) => a.localeCompare(b)),
    [data],
  )

  const stats = useMemo(() => {
    const active = data.filter((e) => e.status === 'ACTIVE')
    const payroll = data.reduce((s, e) => s + e.salary, 0)
    const hires90 = data.filter((e) => {
      if (!e.hireDate) return false
      return Date.now() - new Date(e.hireDate).getTime() <= 90 * 86400000
    }).length
    return {
      headcount: active.length,
      payroll,
      departments: departments.length,
      hires90,
    }
  }, [data, departments.length])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['employees'] })
  }

  // ---- mutations ----------------------------------------------------------
  const saveMutation = useMutation({
    mutationFn: async () => {
      const salary = Number(form.salary === '' ? 0 : form.salary)
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        position: form.position.trim(),
        department: form.department.trim(),
        hireDate: form.hireDate,
        salary: Number.isFinite(salary) ? salary : 0,
        status: form.status,
      }
      if (editing) return put(`/api/employees/${editing.id}`, payload)
      return post('/api/employees', payload)
    },
    onSuccess: () => {
      toast({
        title: editing ? 'Employee updated' : 'Employee created',
        description: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
      })
      invalidate()
      setFormOpen(false)
      setEditing(null)
    },
    onError: (err: Error) =>
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => del(`/api/employees/${id}`),
    onSuccess: () => {
      toast({ title: 'Employee deleted' })
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

  const openEdit = (e: EmployeeRow) => {
    setEditing(e)
    setForm({
      firstName: e.firstName,
      lastName: e.lastName,
      email: e.email ?? '',
      phone: e.phone ?? '',
      position: e.position ?? '',
      department: e.department ?? '',
      hireDate: toDateInput(e.hireDate),
      salary: String(e.salary),
      status: e.status,
    })
    setFormOpen(true)
  }

  const fullName = (e: Pick<EmployeeRow, 'firstName' | 'lastName'>) =>
    `${e.firstName} ${e.lastName}`

  const canSave =
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    (form.email.trim() === '' || isEmail(form.email.trim())) &&
    !saveMutation.isPending

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Users}
        title="Employees"
        description="Manage your workforce, positions and payroll"
        actions={
          <Button onClick={openCreate} className="min-h-11 sm:min-h-9">
            <Plus className="h-4 w-4" aria-hidden />
            New employee
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
            title="Headcount"
            value={stats.headcount}
            hint={`${data.length} total`}
            icon={Users}
          />
          <StatCard
            title="Monthly payroll"
            value={stats.payroll}
            isMoney
            hint="Σ base salaries"
            icon={Wallet}
          />
          <StatCard
            title="Departments"
            value={stats.departments}
            hint="Distinct teams"
            icon={Building2}
          />
          <StatCard
            title="New hires"
            value={stats.hires90}
            hint="Last 90 days"
            icon={CalendarClock}
            tone={stats.hires90 > 0 ? 'success' : 'default'}
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
            placeholder="Search name, code, email…"
            className="pl-8"
            aria-label="Search employees"
          />
        </div>
        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by department">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d} value={d}>{d}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s === 'ACTIVE' ? 'Active' : 'Suspended'}
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
              Failed to load employees: {listQuery.error.message}
            </p>
          )}
          <div className="overflow-x-auto">
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Hire date</TableHead>
                  <TableHead className="text-right">Salary (monthly)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isPending &&
                  Array.from({ length: 4 }).map((_, i) => (
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
                          icon={Users}
                          title={data.length === 0 ? 'No employees yet' : 'No employees match your filters'}
                          description={
                            data.length === 0
                              ? 'Add your first employee to start managing HR.'
                              : 'Try another search term or clear the filters.'
                          }
                          actionLabel={data.length === 0 ? 'New employee' : undefined}
                          onAction={data.length === 0 ? openCreate : undefined}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {e.employeeCode}
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <p className="truncate font-medium">{fullName(e)}</p>
                      {e.email && (
                        <p className="truncate text-xs text-muted-foreground" title={e.email}>
                          {e.email}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">{e.position ?? '—'}</TableCell>
                    <TableCell className="text-sm">{e.department ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{formatDate(e.hireDate)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                      {formatMoney(e.salary)}
                    </TableCell>
                    <TableCell>
                      <DocStatusBadge status={e.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 sm:h-8 sm:w-8"
                          onClick={() => openEdit(e)}
                          aria-label={`Edit ${fullName(e)}`}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-8 sm:w-8"
                          onClick={() => setDeleteTarget(e)}
                          aria-label={`Delete ${fullName(e)}`}
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

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit employee' : 'New employee'}</DialogTitle>
            <DialogDescription>
              {editing
                ? `Update the profile of ${fullName(editing)} (${editing.employeeCode}).`
                : 'A code (EM####) will be generated automatically.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid max-h-[70vh] gap-4 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="emp-first">First name *</Label>
                <Input
                  id="emp-first"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                  placeholder="Alice"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-last">Last name *</Label>
                <Input
                  id="emp-last"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                  placeholder="Martin"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="emp-email">Email</Label>
                <Input
                  id="emp-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="alice@company.io"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-phone">Phone</Label>
                <Input
                  id="emp-phone"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+1 555 010 2030"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="emp-position">Position</Label>
                <Input
                  id="emp-position"
                  value={form.position}
                  onChange={(e) => setForm({ ...form, position: e.target.value })}
                  placeholder="Project Manager"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-department">Department</Label>
                <Input
                  id="emp-department"
                  value={form.department}
                  onChange={(e) => setForm({ ...form, department: e.target.value })}
                  placeholder="Operations"
                  list="emp-departments"
                />
                <datalist id="emp-departments">
                  {departments.map((d) => <option key={d} value={d} />)}
                </datalist>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="emp-hire">Hire date</Label>
                <Input
                  id="emp-hire"
                  type="date"
                  value={form.hireDate}
                  onChange={(e) => setForm({ ...form, hireDate: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="emp-salary">Monthly salary ($)</Label>
                <Input
                  id="emp-salary"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.salary}
                  onChange={(e) => setForm({ ...form, salary: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as 'ACTIVE' | 'SUSPENDED' })}
              >
                <SelectTrigger aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="SUSPENDED">Suspended</SelectItem>
                </SelectContent>
              </Select>
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
              {editing ? 'Save changes' : 'Create employee'}
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
            <AlertDialogTitle>Delete employee?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  This will permanently remove <strong>{fullName(deleteTarget)}</strong>{' '}
                  ({deleteTarget.employeeCode}). Employees with linked leave requests or
                  expense reports cannot be deleted.
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
