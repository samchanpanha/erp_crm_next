'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  FolderKanban,
  ListChecks,
  Loader2,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
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
import { StatCard } from '@/components/erp/shared/stat-card'
import { DocStatusBadge, PriorityBadge } from '@/components/erp/shared/status-badge'
import {
  formatMoney, formatDate, formatNumber, relativeDays, toDateInput,
} from '@/components/erp/shared/format'
import { get, post, put, del } from '@/components/erp/lib/api'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types (mirror API payloads)
// ---------------------------------------------------------------------------
type ProjectStatus = 'OPEN' | 'SUSPENDED' | 'CLOSED'
type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'
type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

interface TaskSummary {
  status: TaskStatus
  progress: number
}

interface ProjectRow {
  id: string
  ref: string
  title: string
  description: string | null
  status: ProjectStatus
  startDate: string | null
  endDate: string | null
  budget: number
  createdAt: string
  updatedAt: string
  thirdParty: { id: string; name: string; code: string } | null
  tasks: TaskSummary[]
  _count: { tasks: number }
  loggedHours: number
}

interface DetailTask {
  id: string
  ref: string
  label: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  progress: number
  plannedHours: number
  startDate: string | null
  endDate: string | null
  loggedHours: number
  entriesCount: number
}

interface ProjectDetail {
  id: string
  ref: string
  title: string
  description: string | null
  status: ProjectStatus
  startDate: string | null
  endDate: string | null
  budget: number
  thirdParty: { id: string; name: string; code: string } | null
  tasks: DetailTask[]
}

interface ThirdPartyOption {
  id: string
  name: string
  code: string
}

interface EmployeeLite {
  id: string
  firstName: string
  lastName: string
}

interface TimeEntryRow {
  id: string
  date: string
  hours: number
  note: string | null
  employee: { id: string; firstName: string; lastName: string } | null
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------
const PROJECT_STATUSES: ProjectStatus[] = ['OPEN', 'SUSPENDED', 'CLOSED']
const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  OPEN: 'Open',
  SUSPENDED: 'Suspended',
  CLOSED: 'Closed',
}

const TASK_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELLED']
const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
}

const TASK_PRIORITIES: TaskPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
}

/** Sentinel values — Radix SelectItem cannot use an empty string. */
const INTERNAL_TP = 'INTERNAL'
const NO_EMPLOYEE = 'NONE'

const clampProgress = (n: number) => Math.max(0, Math.min(100, Math.round(n)))

/** Average progress over non-cancelled tasks (0 when none). */
function rowProgress(p: ProjectRow): number {
  const active = p.tasks.filter((t) => t.status !== 'CANCELLED')
  if (active.length === 0) return 0
  return Math.round(active.reduce((s, t) => s + t.progress, 0) / active.length)
}

function rowDone(p: ProjectRow): number {
  return p.tasks.filter((t) => t.status === 'DONE').length
}

/** Invalidate every query this module owns (safe no-op for unrelated modules). */
function useInvalidateProjects() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['projects'] })
    void queryClient.invalidateQueries({ queryKey: ['project'] })
    void queryClient.invalidateQueries({ queryKey: ['task-time'] })
  }
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
export default function ProjectsModule() {
  const { toast } = useToast()
  const invalidate = useInvalidateProjects()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ProjectRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProjectRow | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const listQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => get<ProjectRow[]>('/api/projects'),
  })

  const data = listQuery.data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter((p) => {
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false
      if (!q) return true
      return [p.ref, p.title, p.description ?? '', p.thirdParty?.name ?? '']
        .some((v) => v.toLowerCase().includes(q))
    })
  }, [data, search, statusFilter])

  const stats = useMemo(
    () => ({
      activeProjects: data.filter((p) => p.status === 'OPEN').length,
      totalBudget: data
        .filter((p) => p.status !== 'CLOSED')
        .reduce((s, p) => s + p.budget, 0),
      loggedHours: data.reduce((s, p) => s + p.loggedHours, 0),
      openTasks: data.reduce(
        (s, p) => s + p.tasks.filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS').length,
        0,
      ),
    }),
    [data],
  )

  const openCreate = () => {
    setEditing(null)
    setFormOpen(true)
  }

  const openEdit = (p: ProjectRow) => {
    setEditing(p)
    setFormOpen(true)
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => del(`/api/projects/${id}`),
    onSuccess: () => {
      toast({ title: 'Project deleted', description: 'Tasks and time entries were removed with it.' })
      invalidate()
    },
    onError: (err: Error) =>
      toast({ title: 'Could not delete', description: err.message, variant: 'destructive' }),
  })

  return (
    <div className="space-y-5">
      <PageHeader
        icon={FolderKanban}
        title="Projects & Tasks"
        description="Plan projects, track tasks and log worked hours"
        actions={
          <Button onClick={openCreate} className="min-h-11 sm:min-h-9">
            <Plus className="h-4 w-4" aria-hidden />
            New project
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
          <StatCard
            title="Active projects"
            value={stats.activeProjects}
            hint={`${data.length} total`}
            icon={FolderKanban}
          />
          <StatCard
            title="Total budget"
            value={stats.totalBudget}
            hint="non-closed projects"
            icon={Wallet}
            isMoney
          />
          <StatCard
            title="Logged hours"
            value={Math.round(stats.loggedHours)}
            hint={`${formatNumber(stats.loggedHours, 1)} h on all tasks`}
            icon={Clock}
          />
          <StatCard
            title="Open tasks"
            value={stats.openTasks}
            hint="to do + in progress"
            icon={ListChecks}
          />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ref, title or client…"
            className="pl-8"
            aria-label="Search projects"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {PROJECT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {statusFilter !== 'ALL' && (
          <Button variant="ghost" size="sm" onClick={() => setStatusFilter('ALL')}>
            Clear status filter
          </Button>
        )}
      </div>

      {/* Table */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {listQuery.isError && (
            <p className="p-4 text-sm text-destructive">
              Failed to load projects: {listQuery.error.message}
            </p>
          )}
          <div className="overflow-x-auto">
            <Table className="min-w-[1040px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Ref</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead className="text-center">Tasks</TableHead>
                  <TableHead className="text-right">Budget</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isPending &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={9}>
                        <Skeleton className="h-9 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                {!listQuery.isPending && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="p-0">
                      <div className="p-6">
                        <EmptyState
                          icon={FolderKanban}
                          title={data.length === 0 ? 'No projects yet' : 'No projects match your filters'}
                          description={
                            data.length === 0
                              ? 'Create your first project to start planning tasks and timesheets.'
                              : 'Try another search term or clear the status filter.'
                          }
                          actionLabel={data.length === 0 ? 'New project' : undefined}
                          onAction={data.length === 0 ? openCreate : undefined}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {p.ref}
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <p className="truncate font-medium" title={p.title}>{p.title}</p>
                      {p.description && (
                        <p className="truncate text-xs text-muted-foreground" title={p.description}>
                          {p.description}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {p.thirdParty ? p.thirdParty.name : <span className="text-muted-foreground">Internal</span>}
                    </TableCell>
                    <TableCell>
                      <DocStatusBadge status={p.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress
                          value={rowProgress(p)}
                          className="h-2 w-16"
                          aria-label={`Average progress ${rowProgress(p)}%`}
                        />
                        <span className="text-xs tabular-nums text-muted-foreground">{rowProgress(p)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-sm tabular-nums">
                      {rowDone(p)}/{p._count.tasks}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                      {formatMoney(p.budget)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {p.startDate || p.endDate ? (
                        <>
                          <p className="text-xs">{formatDate(p.startDate)} → {formatDate(p.endDate)}</p>
                          <p className="text-xs text-muted-foreground">{relativeDays(p.endDate)}</p>
                        </>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 sm:h-8 sm:w-8"
                          onClick={() => setDetailId(p.id)}
                          aria-label={`View ${p.title}`}
                          title="View details"
                        >
                          <Eye className="h-4 w-4" aria-hidden />
                        </Button>
                        {p.status === 'OPEN' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-11 w-11 sm:h-8 sm:w-8"
                            onClick={() => openEdit(p)}
                            aria-label={`Edit ${p.title}`}
                            title="Edit (open projects only)"
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 text-muted-foreground hover:text-destructive sm:h-8 sm:w-8"
                          onClick={() => setDeleteTarget(p)}
                          aria-label={`Delete ${p.title}`}
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
          {!listQuery.isPending && filtered.length > 0 && (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              {filtered.length} of {data.length} project{data.length === 1 ? '' : 's'} ·
              open tasks {filtered.reduce(
                (s, p) => s + p.tasks.filter((t) => t.status === 'TODO' || t.status === 'IN_PROGRESS').length,
                0,
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Create / edit dialog (remounts per target so form state resets) */}
      {formOpen && (
        <ProjectFormDialog
          key={editing?.id ?? 'new'}
          editing={editing}
          onClose={() => {
            setFormOpen(false)
            setEditing(null)
          }}
        />
      )}

      {/* Project detail */}
      {detailId && (
        <ProjectDetailDialog projectId={detailId} onClose={() => setDetailId(null)} />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => { if (!o) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `"${deleteTarget.title}" (${deleteTarget.ref}) will be permanently removed, together with its ${deleteTarget._count.tasks} task${deleteTarget._count.tasks === 1 ? '' : 's'} and all logged time entries. This cannot be undone.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
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
// Project create / edit dialog
// ---------------------------------------------------------------------------
function ProjectFormDialog({
  editing,
  onClose,
}: {
  editing: ProjectRow | null
  onClose: () => void
}) {
  const { toast } = useToast()
  const invalidate = useInvalidateProjects()

  const [title, setTitle] = useState(editing?.title ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [thirdPartyId, setThirdPartyId] = useState(editing?.thirdParty?.id ?? INTERNAL_TP)
  const [status, setStatus] = useState<ProjectStatus>(editing?.status ?? 'OPEN')
  const [startDate, setStartDate] = useState(toDateInput(editing?.startDate))
  const [endDate, setEndDate] = useState(toDateInput(editing?.endDate))
  const [budget, setBudget] = useState(editing ? String(editing.budget) : '')

  // Shared cache with the Third Parties module ('third-parties' query key)
  const thirdPartiesQuery = useQuery({
    queryKey: ['third-parties'],
    queryFn: () => get<ThirdPartyOption[]>('/api/third-parties'),
  })
  const sortedThirdParties = useMemo(
    () => [...(thirdPartiesQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [thirdPartiesQuery.data],
  )

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim(),
        description,
        thirdPartyId: thirdPartyId === INTERNAL_TP ? '' : thirdPartyId,
        status,
        startDate,
        endDate,
        budget: budget === '' ? 0 : Number(budget),
      }
      return editing ? put(`/api/projects/${editing.id}`, payload) : post('/api/projects', payload)
    },
    onSuccess: () => {
      toast({
        title: editing ? 'Project updated' : 'Project created',
        description: title.trim(),
      })
      invalidate()
      onClose()
    },
    onError: (err: Error) =>
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' }),
  })

  const budgetNum = budget === '' ? 0 : Number(budget)
  const canSave =
    title.trim().length > 0 && Number.isFinite(budgetNum) && budgetNum >= 0 && !saveMutation.isPending

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit project' : 'New project'}</DialogTitle>
          <DialogDescription>
            {editing
              ? `${editing.ref} — update the project details below.`
              : 'Create a project, then add tasks and log time from its detail view.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="proj-title">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="proj-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Acme — Factory sensor rollout"
              autoFocus
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="proj-client">Client</Label>
            <Select value={thirdPartyId} onValueChange={setThirdPartyId}>
              <SelectTrigger id="proj-client" className="w-full">
                <SelectValue placeholder="Select a client" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INTERNAL_TP}>Internal</SelectItem>
                {sortedThirdParties.map((tp) => (
                  <SelectItem key={tp.id} value={tp.id}>{tp.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ProjectStatus)}>
              <SelectTrigger id="proj-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-budget">Budget (USD)</Label>
            <Input
              id="proj-budget"
              type="number"
              min={0}
              step="0.01"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-start">Start date</Label>
            <Input
              id="proj-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proj-end">End date</Label>
            <Input
              id="proj-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="proj-desc">Description</Label>
            <Textarea
              id="proj-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Scope, goals, stakeholders…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => saveMutation.mutate()} disabled={!canSave}>
            {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {editing ? 'Save changes' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Project detail dialog — meta, lifecycle actions, task board, log time
// ---------------------------------------------------------------------------
function ProjectDetailDialog({
  projectId,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
  const { toast } = useToast()
  const invalidate = useInvalidateProjects()

  const [addTaskOpen, setAddTaskOpen] = useState(false)
  const [logTimeTask, setLogTimeTask] = useState<DetailTask | null>(null)
  const [deleteTask, setDeleteTask] = useState<DetailTask | null>(null)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)

  const detailQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => get<ProjectDetail>(`/api/projects/${projectId}`),
  })

  const statusMutation = useMutation({
    mutationFn: (status: ProjectStatus) => put(`/api/projects/${projectId}`, { status }),
    onSuccess: (_res, status) => {
      toast({
        title:
          status === 'OPEN'
            ? 'Project reopened'
            : status === 'SUSPENDED'
              ? 'Project suspended'
              : 'Project closed',
      })
      invalidate()
    },
    onError: (err: Error) =>
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' }),
  })

  const taskUpdateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: { status?: TaskStatus; progress?: number } }) =>
      put<DetailTask>(`/api/tasks/${id}`, payload),
    onSuccess: () => invalidate(),
    onError: (err: Error) =>
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' }),
  })

  const taskDeleteMutation = useMutation({
    mutationFn: (id: string) => del(`/api/tasks/${id}`),
    onSuccess: () => {
      toast({ title: 'Task deleted', description: 'Its time entries were removed with it.' })
      setDeleteTask(null)
      invalidate()
    },
    onError: (err: Error) =>
      toast({ title: 'Could not delete task', description: err.message, variant: 'destructive' }),
  })

  const changeTaskStatus = (task: DetailTask, status: TaskStatus) => {
    if (status === task.status) return
    // Leaving DONE resets progress (DONE itself forces 100 server-side);
    // cancelled work keeps its recorded progress.
    const payload: { status: TaskStatus; progress?: number } = { status }
    if (task.status === 'DONE' && (status === 'TODO' || status === 'IN_PROGRESS')) {
      payload.progress = 0
    }
    toast({ title: 'Task updated', description: `${task.ref} → ${TASK_STATUS_LABEL[status]}` })
    taskUpdateMutation.mutate({ id: task.id, payload })
  }

  const changeTaskProgress = (task: DetailTask, value: number) => {
    const progress = clampProgress(value)
    if (progress === task.progress) return
    taskUpdateMutation.mutate({ id: task.id, payload: { progress } })
  }

  const p = detailQuery.data
  const plannedTotal = p ? p.tasks.reduce((s, t) => s + t.plannedHours, 0) : 0
  const loggedTotal = p ? p.tasks.reduce((s, t) => s + t.loggedHours, 0) : 0
  const doneCount = p ? p.tasks.filter((t) => t.status === 'DONE').length : 0
  const overBudgetHours = plannedTotal > 0 && loggedTotal > plannedTotal

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          {detailQuery.isPending && (
            <div className="space-y-4 py-2" aria-busy="true">
              <DialogTitle className="sr-only">Project details (loading)</DialogTitle>
              <Skeleton className="h-8 w-2/3" />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-lg" />
                ))}
              </div>
              <Skeleton className="h-40 w-full rounded-lg" />
            </div>
          )}

          {detailQuery.isError && (
            <p className="py-6 text-sm text-destructive">
              Failed to load project: {detailQuery.error.message}
            </p>
          )}

          {p && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
                  <span className="font-mono text-sm text-muted-foreground">{p.ref}</span>
                  <span className="min-w-0 truncate">{p.title}</span>
                  <DocStatusBadge status={p.status} />
                </DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{p.thirdParty ? p.thirdParty.name : 'Internal project'}</span>
                  <span aria-hidden>·</span>
                  <span>{formatDate(p.startDate)} → {formatDate(p.endDate)}</span>
                </DialogDescription>
              </DialogHeader>

              {/* Meta row */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MetaBox label="Budget" value={formatMoney(p.budget)} />
                <MetaBox label="Planned hours" value={`${formatNumber(plannedTotal, 1)} h`} />
                <MetaBox
                  label="Logged hours"
                  value={`${formatNumber(loggedTotal, 1)} h`}
                  tone={overBudgetHours ? 'danger' : 'default'}
                />
                <MetaBox label="Tasks done" value={`${doneCount}/${p.tasks.length}`} />
              </div>

              {/* Lifecycle actions */}
              <div className="flex flex-wrap items-center gap-2">
                {p.status === 'OPEN' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-9"
                    onClick={() => statusMutation.mutate('SUSPENDED')}
                    disabled={statusMutation.isPending}
                  >
                    <Pause className="h-4 w-4" aria-hidden /> Suspend
                  </Button>
                )}
                {p.status !== 'CLOSED' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="min-h-11 sm:min-h-9"
                    onClick={() => statusMutation.mutate('CLOSED')}
                    disabled={statusMutation.isPending}
                  >
                    <Archive className="h-4 w-4" aria-hidden /> Close project
                  </Button>
                )}
                {p.status !== 'OPEN' && (
                  <Button
                    size="sm"
                    className="min-h-11 sm:min-h-9"
                    onClick={() => statusMutation.mutate('OPEN')}
                    disabled={statusMutation.isPending}
                  >
                    <Play className="h-4 w-4" aria-hidden /> Reopen
                  </Button>
                )}
              </div>

              <Separator />

              {/* Tasks */}
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Tasks ({p.tasks.length})</h3>
                <Button
                  size="sm"
                  className="min-h-11 sm:min-h-9"
                  onClick={() => setAddTaskOpen(true)}
                >
                  <Plus className="h-4 w-4" aria-hidden /> Add task
                </Button>
              </div>

              <div className="-mx-1 max-h-[60vh] space-y-3 overflow-y-auto px-1 pb-1">
                {p.tasks.length === 0 && (
                  <EmptyState
                    icon={ListChecks}
                    title="No tasks yet"
                    description="Add the first task to start tracking work and logged hours."
                    actionLabel="Add task"
                    onAction={() => setAddTaskOpen(true)}
                  />
                )}
                {p.tasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    pending={taskUpdateMutation.isPending}
                    expanded={expandedTaskId === t.id}
                    onToggleEntries={() =>
                      setExpandedTaskId(expandedTaskId === t.id ? null : t.id)
                    }
                    onStatusChange={changeTaskStatus}
                    onProgressChange={changeTaskProgress}
                    onDelete={setDeleteTask}
                    onLogTime={setLogTimeTask}
                  />
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Nested dialogs stay outside the parent content to stack cleanly */}
      {p && addTaskOpen && (
        <TaskFormDialog key="add-task" projectId={p.id} onClose={() => setAddTaskOpen(false)} />
      )}
      {p && logTimeTask && (
        <LogTimeDialog
          key={`log-${logTimeTask.id}`}
          task={logTimeTask}
          onClose={() => setLogTimeTask(null)}
        />
      )}
      {p && deleteTask && (
        <AlertDialog open onOpenChange={(o) => { if (!o) setDeleteTask(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this task?</AlertDialogTitle>
              <AlertDialogDescription>
                {`"${deleteTask.label}" (${deleteTask.ref}) and its ${deleteTask.entriesCount} time entr${deleteTask.entriesCount === 1 ? 'y' : 'ies'} will be permanently removed. This cannot be undone.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-white hover:bg-destructive/90"
                onClick={() => taskDeleteMutation.mutate(deleteTask.id)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  )
}

function MetaBox({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  tone?: 'default' | 'danger'
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-sm font-bold tabular-nums', tone === 'danger' && 'text-rose-600')}>
        {value}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Task row inside the project detail
// ---------------------------------------------------------------------------
function TaskRow({
  task,
  pending,
  expanded,
  onToggleEntries,
  onStatusChange,
  onProgressChange,
  onDelete,
  onLogTime,
}: {
  task: DetailTask
  pending: boolean
  expanded: boolean
  onToggleEntries: () => void
  onStatusChange: (task: DetailTask, status: TaskStatus) => void
  onProgressChange: (task: DetailTask, progress: number) => void
  onDelete: (task: DetailTask) => void
  onLogTime: (task: DetailTask) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  const commitDraft = () => {
    if (draft === null) return
    const raw = draft
    setDraft(null)
    const n = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(n)) return
    onProgressChange(task, n)
  }

  const overPlanned = task.plannedHours > 0 && task.loggedHours > task.plannedHours

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {/* Identity */}
        <div className="min-w-[180px] max-w-full flex-1 basis-48">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{task.ref}</span>
            <PriorityBadge priority={task.priority} />
          </div>
          <p className="mt-0.5 text-sm font-medium leading-snug">{task.label}</p>
          {task.description && (
            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground" title={task.description}>
              {task.description}
            </p>
          )}
        </div>

        {/* Status */}
        <Select
          value={task.status}
          onValueChange={(v) => onStatusChange(task, v as TaskStatus)}
        >
          <SelectTrigger className="h-9 w-full sm:w-40" aria-label={`Status of ${task.label}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TASK_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{TASK_STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Progress */}
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 sm:h-8 sm:w-8"
            onClick={() => onProgressChange(task, task.progress - 10)}
            disabled={pending || task.progress <= 0}
            aria-label={`Decrease progress of ${task.label} by 10%`}
            title="-10%"
          >
            <Minus className="h-4 w-4" aria-hidden />
          </Button>
          <Progress
            value={task.progress}
            className="h-2 w-16 sm:w-20"
            aria-label={`Progress ${task.progress}%`}
          />
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 sm:h-8 sm:w-8"
            onClick={() => onProgressChange(task, task.progress + 10)}
            disabled={pending || task.progress >= 100}
            aria-label={`Increase progress of ${task.label} by 10%`}
            title="+10%"
          >
            <Plus className="h-4 w-4" aria-hidden />
          </Button>
          <div className="relative">
            <Input
              type="number"
              min={0}
              max={100}
              className="h-9 w-16 pr-5 text-xs"
              value={draft ?? String(task.progress)}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              disabled={pending}
              aria-label={`Set progress of ${task.label} in percent`}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              %
            </span>
          </div>
        </div>

        {/* Hours */}
        <div className="whitespace-nowrap text-xs tabular-nums">
          <p className="text-muted-foreground">{formatNumber(task.plannedHours, 1)} h planned</p>
          <p className={cn('font-medium', overPlanned && 'text-rose-600')}>
            {formatNumber(task.loggedHours, 1)} h logged
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-11 gap-1.5 sm:h-8"
            onClick={() => onLogTime(task)}
            aria-label={`Log time on ${task.label}`}
          >
            <Clock className="h-4 w-4" aria-hidden /> Log time
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 sm:h-8 sm:w-8"
            onClick={onToggleEntries}
            aria-expanded={expanded}
            aria-label={`Time entries of ${task.label} (${task.entriesCount})`}
            title={`${task.entriesCount} entr${task.entriesCount === 1 ? 'y' : 'ies'}`}
          >
            {expanded ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 text-muted-foreground hover:text-destructive sm:h-8 sm:w-8"
            onClick={() => onDelete(task)}
            aria-label={`Delete task ${task.label}`}
            title="Delete task"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 border-t pt-2">
          <TaskTimeEntries taskId={task.id} />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Expandable time entries for one task
// ---------------------------------------------------------------------------
function TaskTimeEntries({ taskId }: { taskId: string }) {
  const entriesQuery = useQuery({
    queryKey: ['task-time', taskId],
    queryFn: () => get<TimeEntryRow[]>(`/api/tasks/${taskId}/time`),
  })

  if (entriesQuery.isPending) {
    return (
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-3/4" />
      </div>
    )
  }
  if (entriesQuery.isError) {
    return (
      <p className="text-xs text-destructive">
        Failed to load time entries: {entriesQuery.error.message}
      </p>
    )
  }
  if (entriesQuery.data.length === 0) {
    return <p className="text-xs text-muted-foreground">No time entries logged yet.</p>
  }

  return (
    <div className="divide-y rounded-md border bg-muted/20">
      {entriesQuery.data.map((e) => (
        <div key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-xs">
          <span className="w-24 shrink-0 text-muted-foreground">{formatDate(e.date)}</span>
          <span className="w-32 shrink-0 truncate font-medium">
            {e.employee ? `${e.employee.firstName} ${e.employee.lastName}` : 'Unassigned'}
          </span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={e.note ?? ''}>
            {e.note ?? ''}
          </span>
          <span className="shrink-0 font-semibold tabular-nums">{formatNumber(e.hours, 2)} h</span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Log time dialog
// ---------------------------------------------------------------------------
function LogTimeDialog({
  task,
  onClose,
}: {
  task: DetailTask
  onClose: () => void
}) {
  const { toast } = useToast()
  const invalidate = useInvalidateProjects()

  const [employeeId, setEmployeeId] = useState(NO_EMPLOYEE)
  const [date, setDate] = useState(toDateInput(new Date()))
  const [hours, setHours] = useState('1')
  const [note, setNote] = useState('')

  // The Employees module may not be populated yet — degrade to unassigned.
  const employeesQuery = useQuery({
    queryKey: ['employees'],
    queryFn: () => get<EmployeeLite[]>('/api/employees'),
    retry: false,
    staleTime: 60_000,
  })
  const employees = employeesQuery.data ?? []

  const mutation = useMutation({
    mutationFn: () =>
      post<TimeEntryRow>(`/api/tasks/${task.id}/time`, {
        employeeId: employeeId === NO_EMPLOYEE ? '' : employeeId,
        date,
        hours: Number(hours),
        note,
      }),
    onSuccess: (entry) => {
      toast({
        title: 'Time logged',
        description: `${formatNumber(entry.hours, 2)} h on ${task.ref}${entry.employee ? ` — ${entry.employee.firstName} ${entry.employee.lastName}` : ''}`,
      })
      invalidate()
      onClose()
    },
    onError: (err: Error) =>
      toast({ title: 'Could not log time', description: err.message, variant: 'destructive' }),
  })

  const hoursNum = Number(hours)
  const canSave = Number.isFinite(hoursNum) && hoursNum > 0 && !mutation.isPending

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log time — {task.ref}</DialogTitle>
          <DialogDescription className="line-clamp-2">{task.label}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="log-employee">Employee</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger id="log-employee" className="w-full">
                <SelectValue placeholder="Select an employee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_EMPLOYEE}>Unassigned</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.firstName} {e.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {employeesQuery.isError && (
              <p className="text-xs text-muted-foreground">
                Employees list unavailable — the entry will be recorded as unassigned.
              </p>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="log-date">Date</Label>
              <Input
                id="log-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="log-hours">
                Hours <span className="text-destructive">*</span>
              </Label>
              <Input
                id="log-hours"
                type="number"
                min={0.01}
                max={24}
                step="0.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                placeholder="0.5"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="log-note">Note</Label>
            <Input
              id="log-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What was worked on?"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSave}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Log time
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Add task dialog
// ---------------------------------------------------------------------------
function TaskFormDialog({
  projectId,
  onClose,
}: {
  projectId: string
  onClose: () => void
}) {
  const { toast } = useToast()
  const invalidate = useInvalidateProjects()

  const [label, setLabel] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('MEDIUM')
  const [plannedHours, setPlannedHours] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const mutation = useMutation({
    mutationFn: () =>
      post<DetailTask>('/api/tasks', {
        projectId,
        label: label.trim(),
        description,
        priority,
        plannedHours: plannedHours === '' ? 0 : Number(plannedHours),
        startDate,
        endDate,
      }),
    onSuccess: (task) => {
      toast({ title: 'Task added', description: `${task.ref} — ${task.label}` })
      invalidate()
      onClose()
    },
    onError: (err: Error) =>
      toast({ title: 'Could not add task', description: err.message, variant: 'destructive' }),
  })

  const plannedNum = plannedHours === '' ? 0 : Number(plannedHours)
  const canSave = label.trim().length > 0 && Number.isFinite(plannedNum) && plannedNum >= 0 && !mutation.isPending

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add task</DialogTitle>
          <DialogDescription>
            A reference (TSyymm-####) is generated automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="task-label">
              Label <span className="text-destructive">*</span>
            </Label>
            <Input
              id="task-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Install 40 sensor nodes"
              autoFocus
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-priority">Priority</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
                <SelectTrigger id="task-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((pr) => (
                    <SelectItem key={pr} value={pr}>{TASK_PRIORITY_LABEL[pr]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-planned">Planned hours</Label>
              <Input
                id="task-planned"
                type="number"
                min={0}
                step="0.5"
                value={plannedHours}
                onChange={(e) => setPlannedHours(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-start">Start date</Label>
              <Input
                id="task-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-end">End date</Label>
              <Input
                id="task-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-desc">Description</Label>
            <Textarea
              id="task-desc"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Details, acceptance criteria…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSave}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Add task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
