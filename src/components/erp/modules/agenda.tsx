'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  CalendarCheck,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Trash2,
  User,
  UserX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { get, post, put, del } from '@/components/erp/lib/api'
import { PageHeader, EmptyState } from '@/components/erp/shared/page-header'
import { DocStatusBadge } from '@/components/erp/shared/status-badge'
import { StatCard } from '@/components/erp/shared/stat-card'
import {
  formatDate,
  formatDateTime,
  toDateInput,
  toDateTimeInput,
  relativeDays,
} from '@/components/erp/shared/format'
import { useToast } from '@/hooks/use-toast'

// ---------------------------------------------------------------------------
// Types (mirroring API payloads)
// ---------------------------------------------------------------------------
interface ThirdPartyLite {
  id: string
  name: string
  code: string
}

interface AgendaEventRow {
  id: string
  title: string
  description: string | null
  type: string // MEETING | CALL | TASK | REMINDER | OTHER
  start: string
  end: string | null
  allDay: boolean
  location: string | null
  thirdPartyId: string | null
  thirdParty?: { id: string; name: string; code: string } | null
  projectId: string | null
  owner: string | null
}

const EVENT_TYPES = [
  { value: 'MEETING', label: 'Meeting' },
  { value: 'CALL', label: 'Call' },
  { value: 'TASK', label: 'Task' },
  { value: 'REMINDER', label: 'Reminder' },
  { value: 'OTHER', label: 'Other' },
] as const

const NO_TP = '__none__'
const DAY_MS = 86_400_000

function startOfToday(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

function timeRange(e: AgendaEventRow): string {
  if (e.allDay) return 'All day'
  const start = formatDateTime(e.start)
  if (!e.end) return start
  return `${start} – ${formatDateTime(e.end)}`
}

// ---------------------------------------------------------------------------
// Create / edit dialog
// ---------------------------------------------------------------------------
function EventFormDialog({
  open,
  onOpenChange,
  editEvent,
  thirdParties,
  toast,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editEvent: AgendaEventRow | null
  thirdParties: ThirdPartyLite[]
  toast: ReturnType<typeof useToast>['toast']
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(editEvent?.title ?? '')
  const [type, setType] = useState(editEvent?.type ?? 'MEETING')
  const [allDay, setAllDay] = useState(editEvent?.allDay ?? false)
  const [startDateTime, setStartDateTime] = useState(
    editEvent ? toDateTimeInput(editEvent.start) : toDateTimeInput(new Date())
  )
  const [startDate, setStartDate] = useState(
    editEvent ? toDateInput(editEvent.start) : toDateInput(new Date())
  )
  const [endDateTime, setEndDateTime] = useState(
    editEvent?.end ? toDateTimeInput(editEvent.end) : ''
  )
  const [endDate, setEndDate] = useState(editEvent?.end ? toDateInput(editEvent.end) : '')
  const [location, setLocation] = useState(editEvent?.location ?? '')
  const [thirdPartyId, setThirdPartyId] = useState(editEvent?.thirdParty?.id ?? NO_TP)
  const [owner, setOwner] = useState(editEvent?.owner ?? '')
  const [description, setDescription] = useState(editEvent?.description ?? '')

  const saveMutation = useMutation({
    mutationFn: (payload: unknown) =>
      editEvent
        ? put<AgendaEventRow>(`/api/agenda/${editEvent.id}`, payload)
        : post<AgendaEventRow>('/api/agenda', payload),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['agenda'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: editEvent ? 'Event updated' : 'Event created', description: saved.title })
      onOpenChange(false)
    },
    onError: (e: Error) =>
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  })

  const startRaw = allDay ? startDate : startDateTime
  const endRaw = allDay ? endDate : endDateTime
  const startDateObj = startRaw ? new Date(startRaw) : null
  const endDateObj = endRaw ? new Date(endRaw) : null
  const invalid =
    !title.trim() ||
    !startDateObj ||
    Number.isNaN(startDateObj.getTime()) ||
    (allDay && !startDate) ||
    (!allDay && !startDateTime) ||
    (endDateObj !== null && startDateObj !== null && endDateObj < startDateObj)

  const submit = () => {
    if (!startDateObj || Number.isNaN(startDateObj.getTime())) return
    saveMutation.mutate({
      title: title.trim(),
      type,
      allDay,
      start: startDateObj.toISOString(),
      end: endDateObj && !Number.isNaN(endDateObj.getTime()) ? endDateObj.toISOString() : null,
      location: location || null,
      thirdPartyId: thirdPartyId === NO_TP ? null : thirdPartyId,
      owner: owner || null,
      description: description || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editEvent ? 'Edit event' : 'New event'}</DialogTitle>
          <DialogDescription>
            Agenda events cover meetings, calls, tasks and reminders.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ev-title">Title *</Label>
            <Input
              id="ev-title"
              placeholder="e.g. Quarterly business review"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="ev-type" aria-label="Event type" className="min-h-[40px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end pb-1">
            <div className="flex items-center gap-2">
              <Switch id="ev-allday" checked={allDay} onCheckedChange={setAllDay} />
              <Label htmlFor="ev-allday" className="cursor-pointer">
                All day
              </Label>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev-start">Start *</Label>
            <Input
              id="ev-start"
              type={allDay ? 'date' : 'datetime-local'}
              value={allDay ? startDate : startDateTime}
              onChange={(e) =>
                allDay ? setStartDate(e.target.value) : setStartDateTime(e.target.value)
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-end">End</Label>
            <Input
              id="ev-end"
              type={allDay ? 'date' : 'datetime-local'}
              value={allDay ? endDate : endDateTime}
              onChange={(e) =>
                allDay ? setEndDate(e.target.value) : setEndDateTime(e.target.value)
              }
            />
            {endDateObj && startDateObj && endDateObj < startDateObj && (
              <p className="text-xs font-medium text-rose-600">End is before start</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ev-location">Location</Label>
            <Input
              id="ev-location"
              placeholder="e.g. Video call"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ev-owner">Owner</Label>
            <Input
              id="ev-owner"
              placeholder="e.g. Alice Martin"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ev-tp">Third party</Label>
            <Select value={thirdPartyId} onValueChange={setThirdPartyId}>
              <SelectTrigger id="ev-tp" aria-label="Third party" className="min-h-[40px]">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TP}>None</SelectItem>
                {thirdParties.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ev-description">Description</Label>
            <Textarea
              id="ev-description"
              rows={2}
              placeholder="Optional details"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={saveMutation.isPending || invalid}
            className="min-h-[40px] min-w-[120px]"
          >
            {saveMutation.isPending ? 'Saving…' : editEvent ? 'Save changes' : 'Create event'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Event card (upcoming list)
// ---------------------------------------------------------------------------
function EventCard({
  event,
  onEdit,
  onDelete,
}: {
  event: AgendaEventRow
  onEdit: (e: AgendaEventRow) => void
  onDelete: (e: AgendaEventRow) => void
}) {
  const d = new Date(event.start)
  const day = new Intl.DateTimeFormat('en-US', { day: 'numeric' }).format(d)
  const month = new Intl.DateTimeFormat('en-US', { month: 'short' }).format(d)

  return (
    <Card className="py-0 gap-0">
      <CardContent className="flex gap-4 p-4">
        <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/5 py-2">
          <span className="text-xl font-bold tabular-nums">{day}</span>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {month}
          </span>
          <span className="mt-1 whitespace-nowrap text-[10px] font-medium text-primary">
            {relativeDays(event.start)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <DocStatusBadge status={event.type} />
                {event.allDay && (
                  <span className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-600">
                    All day
                  </span>
                )}
              </div>
              <p className="mt-1 truncate font-semibold">{event.title}</p>
              <p className="text-xs text-muted-foreground">{timeRange(event)}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`Edit ${event.title}`}
                title="Edit event"
                onClick={() => onEdit(event)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                aria-label={`Delete ${event.title}`}
                title="Delete event"
                onClick={() => onDelete(event)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {event.thirdParty && (
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                {event.thirdParty.name}
              </span>
            )}
            {event.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {event.location}
              </span>
            )}
            {event.owner && (
              <span className="inline-flex items-center gap-1">
                <User className="h-3.5 w-3.5" aria-hidden="true" />
                {event.owner}
              </span>
            )}
          </div>
          {event.description && (
            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
              {event.description}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
export default function AgendaModule() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [formOpen, setFormOpen] = useState(false)
  const [editEvent, setEditEvent] = useState<AgendaEventRow | null>(null)
  const [deleteEvent, setDeleteEvent] = useState<AgendaEventRow | null>(null)
  const [pastOpen, setPastOpen] = useState(false)

  // ---- Data ---------------------------------------------------------------
  const listQuery = useQuery({
    queryKey: ['agenda'],
    queryFn: () => get<AgendaEventRow[]>('/api/agenda'),
  })

  const thirdPartiesQuery = useQuery({
    queryKey: ['third-parties'],
    queryFn: () => get<ThirdPartyLite[]>('/api/third-parties'),
  })

  const events = listQuery.data ?? []
  const thirdParties = thirdPartiesQuery.data ?? []

  // ---- Split upcoming / past ------------------------------------------------
  const { upcoming, past } = useMemo(() => {
    const today = startOfToday().getTime()
    const sorted = [...events].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()
    )
    return {
      upcoming: sorted.filter((e) => new Date(e.start).getTime() >= today),
      past: sorted.filter((e) => new Date(e.start).getTime() < today).reverse(),
    }
  }, [events])

  // ---- Stats ---------------------------------------------------------------
  const stats = useMemo(() => {
    const today = startOfToday()
    const tomorrow = new Date(today.getTime() + DAY_MS)
    const weekEnd = new Date(today.getTime() + 7 * DAY_MS)
    let todayCount = 0
    let weekCount = 0
    let callsCount = 0
    let unassigned = 0
    for (const e of events) {
      const s = new Date(e.start)
      if (s >= today && s < tomorrow) todayCount += 1
      if (s >= today && s < weekEnd) weekCount += 1
      if (e.type === 'CALL' && s >= today) callsCount += 1
      if (!e.owner) unassigned += 1
    }
    return { todayCount, weekCount, callsCount, unassigned }
  }, [events])

  // ---- Mutations -----------------------------------------------------------
  const deleteMutation = useMutation({
    mutationFn: (id: string) => del<{ id: string }>(`/api/agenda/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agenda'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: 'Event deleted' })
      setDeleteEvent(null)
    },
    onError: (e: Error) => {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' })
      setDeleteEvent(null)
    },
  })

  const openCreate = () => {
    setEditEvent(null)
    setFormOpen(true)
  }

  const openEdit = (e: AgendaEventRow) => {
    setEditEvent(e)
    setFormOpen(true)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={CalendarDays}
        title="Agenda"
        description="Meetings, calls, tasks and reminders"
        actions={
          <Button className="min-h-[40px]" onClick={openCreate}>
            <Plus className="h-4 w-4" /> New event
          </Button>
        }
      />

      {/* ---- Stats ---- */}
      {listQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[92px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="Today's events" value={stats.todayCount} icon={CalendarCheck} />
          <StatCard title="This week" value={stats.weekCount} icon={CalendarRange} hint="Next 7 days" />
          <StatCard
            title="Calls scheduled"
            value={stats.callsCount}
            icon={Phone}
            hint="Upcoming calls"
          />
          <StatCard
            title="Unassigned owner"
            value={stats.unassigned}
            icon={UserX}
            tone="warning"
            hint="Events without an owner"
          />
        </div>
      )}

      {/* ---- Upcoming ---- */}
      <section aria-label="Upcoming events" className="space-y-3">
        <h2 className="text-sm font-semibold">Upcoming ({upcoming.length})</h2>
        {listQuery.isLoading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-[110px] rounded-xl" />
            ))}
          </div>
        ) : upcoming.length === 0 ? (
          <EmptyState
            icon={CalendarDays}
            title="No upcoming events"
            description="Plan your next meeting, call or task."
            actionLabel="New event"
            onAction={openCreate}
          />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {upcoming.map((e) => (
              <EventCard key={e.id} event={e} onEdit={openEdit} onDelete={setDeleteEvent} />
            ))}
          </div>
        )}
      </section>

      {/* ---- Past ---- */}
      {past.length > 0 && (
        <Collapsible open={pastOpen} onOpenChange={setPastOpen}>
          <Card className="py-0 gap-0">
            <CardContent className="p-0">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  className="flex w-full items-center justify-between px-4 py-3"
                  aria-expanded={pastOpen}
                >
                  <span className="text-sm font-semibold">Past events ({past.length})</span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${pastOpen ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="overflow-x-auto border-t">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">Date</TableHead>
                        <TableHead className="whitespace-nowrap">Type</TableHead>
                        <TableHead className="min-w-[200px]">Title</TableHead>
                        <TableHead className="whitespace-nowrap">Third party</TableHead>
                        <TableHead className="whitespace-nowrap">Owner</TableHead>
                        <TableHead className="whitespace-nowrap text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {past.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatDate(e.start)}
                            {e.allDay && (
                              <span className="ml-1.5 text-[10px] font-semibold uppercase text-zinc-500">
                                All day
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <DocStatusBadge status={e.type} />
                          </TableCell>
                          <TableCell className="max-w-[280px]">
                            <p className="truncate font-medium" title={e.title}>
                              {e.title}
                            </p>
                            {e.description && (
                              <p
                                className="truncate text-xs text-muted-foreground"
                                title={e.description}
                              >
                                {e.description}
                              </p>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {e.thirdParty?.name ?? '—'}
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {e.owner ?? '—'}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`Edit ${e.title}`}
                                title="Edit event"
                                onClick={() => openEdit(e)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                aria-label={`Delete ${e.title}`}
                                title="Delete event"
                                onClick={() => setDeleteEvent(e)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CollapsibleContent>
            </CardContent>
          </Card>
        </Collapsible>
      )}

      {/* ---- Dialogs ---- */}
      {formOpen && (
        <EventFormDialog
          open
          onOpenChange={setFormOpen}
          editEvent={editEvent}
          thirdParties={thirdParties}
          toast={toast}
        />
      )}
      <AlertDialog
        open={!!deleteEvent}
        onOpenChange={(o) => {
          if (!o) setDeleteEvent(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleteEvent?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This agenda event will be permanently removed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (deleteEvent) deleteMutation.mutate(deleteEvent.id)
              }}
            >
              {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
