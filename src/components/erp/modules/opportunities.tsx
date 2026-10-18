'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Eye, Loader2, Pencil, Plus, Search, Target, Trash2, Trophy, XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
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
import { formatMoney, formatDate, relativeDays, toDateInput } from '@/components/erp/shared/format'
import { formatMoneyCompact } from '@/components/erp/shared/stat-card'
import { get, post, put, del } from '@/components/erp/lib/api'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types (mirror API payloads)
// ---------------------------------------------------------------------------
type OpportunityStage = 'NEW' | 'QUALIFIED' | 'PROPOSAL' | 'NEGOTIATION' | 'WON' | 'LOST'

interface OpportunityRow {
  id: string
  title: string
  stage: OpportunityStage
  amount: number
  probability: number
  expectedCloseDate: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  thirdParty: { id: string; name: string; code: string }
}

interface ThirdPartyOption {
  id: string
  name: string
  code: string
}

const STAGES: OpportunityStage[] = ['NEW', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST']

const STAGE_LABEL: Record<OpportunityStage, string> = {
  NEW: 'New',
  QUALIFIED: 'Qualified',
  PROPOSAL: 'Proposal sent',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
}

const emptyOppForm = {
  title: '',
  thirdPartyId: '',
  stage: 'NEW' as OpportunityStage,
  amount: '',
  probability: '10',
  expectedCloseDate: '',
  notes: '',
}

type OppFormState = typeof emptyOppForm

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
export default function OpportunitiesModule() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<string>('ALL')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<OpportunityRow | null>(null)
  const [form, setForm] = useState<OppFormState>(emptyOppForm)
  const [deleteTarget, setDeleteTarget] = useState<OpportunityRow | null>(null)

  const listQuery = useQuery({
    queryKey: ['opportunities'],
    queryFn: () => get<OpportunityRow[]>('/api/opportunities'),
  })

  // Shared cache with the Third Parties module ('third-parties' query key)
  const thirdPartiesQuery = useQuery({
    queryKey: ['third-parties'],
    queryFn: () => get<ThirdPartyOption[]>('/api/third-parties'),
  })

  const data = listQuery.data ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter((o) => {
      if (stageFilter !== 'ALL' && o.stage !== stageFilter) return false
      if (!q) return true
      return [o.title, o.thirdParty.name, o.thirdParty.code].some((v) =>
        v.toLowerCase().includes(q),
      )
    })
  }, [data, search, stageFilter])

  const stageSummaries = useMemo(
    () =>
      STAGES.map((stage) => {
        const items = data.filter((o) => o.stage === stage)
        return {
          stage,
          count: items.length,
          total: items.reduce((s, o) => s + o.amount, 0),
        }
      }),
    [data],
  )

  const weightedPipeline = useMemo(
    () =>
      data
        .filter((o) => o.stage !== 'WON' && o.stage !== 'LOST')
        .reduce((s, o) => s + (o.amount * o.probability) / 100, 0),
    [data],
  )

  const sortedThirdParties = useMemo(
    () => [...(thirdPartiesQuery.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [thirdPartiesQuery.data],
  )

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['opportunities'] })
  }

  // ---- mutations ----------------------------------------------------------
  const saveMutation = useMutation({
    mutationFn: async () => {
      const amount = Number(form.amount === '' ? 0 : form.amount)
      const probability = Math.max(0, Math.min(100, Number(form.probability === '' ? 10 : form.probability)))
      const payload = {
        title: form.title.trim(),
        thirdPartyId: form.thirdPartyId,
        stage: form.stage,
        amount: Number.isFinite(amount) ? amount : 0,
        probability: Number.isFinite(probability) ? Math.round(probability) : 10,
        expectedCloseDate: form.expectedCloseDate,
        notes: form.notes,
      }
      if (editing) return put(`/api/opportunities/${editing.id}`, payload)
      return post('/api/opportunities', payload)
    },
    onSuccess: () => {
      toast({
        title: editing ? 'Opportunity updated' : 'Opportunity created',
        description: form.title.trim(),
      })
      invalidate()
      setFormOpen(false)
      setEditing(null)
    },
    onError: (err: Error) =>
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' }),
  })

  const quickStageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: 'WON' | 'LOST' }) =>
      put(`/api/opportunities/${id}`, {
        stage,
        probability: stage === 'WON' ? 100 : 0,
      }),
    onSuccess: (_res, vars) => {
      toast({
        title: vars.stage === 'WON' ? 'Opportunity won' : 'Opportunity marked as lost',
        description: 'The pipeline summary has been refreshed.',
      })
      invalidate()
    },
    onError: (err: Error) =>
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => del(`/api/opportunities/${id}`),
    onSuccess: () => {
      toast({ title: 'Opportunity deleted' })
      invalidate()
    },
    onError: (err: Error) =>
      toast({ title: 'Could not delete', description: err.message, variant: 'destructive' }),
  })

  // ---- dialog helpers -----------------------------------------------------
  const openCreate = () => {
    setEditing(null)
    setForm(emptyOppForm)
    setFormOpen(true)
  }

  const openEdit = (o: OpportunityRow) => {
    setEditing(o)
    setForm({
      title: o.title,
      thirdPartyId: o.thirdParty.id,
      stage: o.stage,
      amount: String(o.amount),
      probability: String(o.probability),
      expectedCloseDate: toDateInput(o.expectedCloseDate),
      notes: o.notes ?? '',
    })
    setFormOpen(true)
  }

  const canSave =
    form.title.trim().length > 0 && form.thirdPartyId !== '' && !saveMutation.isPending

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Target}
        title="Opportunities"
        description="Track your sales pipeline from first contact to close"
        actions={
          <Button onClick={openCreate} className="min-h-11 sm:min-h-9">
            <Plus className="h-4 w-4" aria-hidden />
            New opportunity
          </Button>
        }
      />

      {/* Pipeline summary */}
      {listQuery.isPending ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {stageSummaries.map((s) => {
            const active = stageFilter === s.stage
            return (
              <button
                key={s.stage}
                type="button"
                onClick={() => setStageFilter(active ? 'ALL' : s.stage)}
                aria-pressed={active}
                aria-label={`Filter by stage ${STAGE_LABEL[s.stage]}`}
                className={cn(
                  'rounded-lg border bg-card p-3 text-left shadow-xs transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active && 'border-primary ring-1 ring-primary',
                )}
              >
                <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {STAGE_LABEL[s.stage]}
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">{s.count}</p>
                <p className="truncate text-xs text-muted-foreground">{formatMoneyCompact(s.total)}</p>
              </button>
            )
          })}
          <div className="rounded-lg border border-primary bg-primary/5 p-3 shadow-xs">
            <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-primary">
              Weighted pipeline
            </p>
            <p className="mt-1 text-xl font-bold tabular-nums text-primary">
              {formatMoneyCompact(weightedPipeline)}
            </p>
            <p className="truncate text-xs text-muted-foreground">amount × probability</p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or third party…"
            className="pl-8"
            aria-label="Search opportunities"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-full sm:w-48" aria-label="Filter by stage">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All stages</SelectItem>
            {STAGES.map((s) => (
              <SelectItem key={s} value={s}>
                {STAGE_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {stageFilter !== 'ALL' && (
          <Button variant="ghost" size="sm" onClick={() => setStageFilter('ALL')}>
            Clear stage filter
          </Button>
        )}
      </div>

      {/* Table */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {listQuery.isError && (
            <p className="p-4 text-sm text-destructive">
              Failed to load opportunities: {listQuery.error.message}
            </p>
          )}
          <div className="overflow-x-auto">
            <Table className="min-w-[880px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Third party</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Probability</TableHead>
                  <TableHead>Expected close</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isPending &&
                  Array.from({ length: 5 }).map((_, i) => (
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
                          icon={Target}
                          title={data.length === 0 ? 'No opportunities yet' : 'No opportunities match your filters'}
                          description={
                            data.length === 0
                              ? 'Create your first opportunity to start tracking the pipeline.'
                              : 'Try another search term or clear the stage filter.'
                          }
                          actionLabel={data.length === 0 ? 'New opportunity' : undefined}
                          onAction={data.length === 0 ? openCreate : undefined}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((o) => {
                  const closed = o.stage === 'WON' || o.stage === 'LOST'
                  return (
                    <TableRow key={o.id}>
                      <TableCell className="max-w-[240px]">
                        <p className="truncate font-medium" title={o.title}>
                          {o.title}
                        </p>
                        {o.notes && (
                          <p className="truncate text-xs text-muted-foreground" title={o.notes}>
                            {o.notes}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="whitespace-nowrap text-sm">{o.thirdParty.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{o.thirdParty.code}</p>
                      </TableCell>
                      <TableCell>
                        <DocStatusBadge status={o.stage} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums">
                        {formatMoney(o.amount)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress
                            value={o.probability}
                            className={cn('h-2 w-16', closed && (o.stage === 'LOST' ? 'opacity-40' : ''))}
                            aria-label={`Probability ${o.probability}%`}
                          />
                          <span className="text-xs tabular-nums text-muted-foreground">{o.probability}%</span>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">
                        {o.expectedCloseDate ? (
                          <>
                            {formatDate(o.expectedCloseDate)}
                            <p className="text-xs text-muted-foreground">{relativeDays(o.expectedCloseDate)}</p>
                          </>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          {!closed && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700 sm:h-8 sm:w-8"
                                onClick={() => quickStageMutation.mutate({ id: o.id, stage: 'WON' })}
                                disabled={quickStageMutation.isPending}
                                aria-label={`Mark ${o.title} as won`}
                                title="Mark as won"
                              >
                                <Trophy className="h-4 w-4" aria-hidden />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-8 sm:w-8"
                                onClick={() => quickStageMutation.mutate({ id: o.id, stage: 'LOST' })}
                                disabled={quickStageMutation.isPending}
                                aria-label={`Mark ${o.title} as lost`}
                                title="Mark as lost"
                              >
                                <XCircle className="h-4 w-4" aria-hidden />
                              </Button>
                            </>
                          )}
                          {closed && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-9 w-9 sm:h-8 sm:w-8"
                              onClick={() => openEdit(o)}
                              aria-label={`View ${o.title}`}
                              title="View"
                            >
                              <Eye className="h-4 w-4" aria-hidden />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 sm:h-8 sm:w-8"
                            onClick={() => openEdit(o)}
                            aria-label={`Edit ${o.title}`}
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9 text-muted-foreground hover:text-destructive sm:h-8 sm:w-8"
                            onClick={() => setDeleteTarget(o)}
                            aria-label={`Delete ${o.title}`}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          {!listQuery.isPending && filtered.length > 0 && (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              {filtered.length} of {data.length} opportunit{data.length === 1 ? 'y' : 'ies'} ·
              open value {formatMoney(
                filtered
                  .filter((o) => o.stage !== 'WON' && o.stage !== 'LOST')
                  .reduce((s, o) => s + o.amount, 0),
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Create / edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit opportunity' : 'New opportunity'}</DialogTitle>
            <DialogDescription>
              {editing
                ? `Linked to ${editing.thirdParty.name} — update the deal details below.`
                : 'Create a deal and track it through the pipeline stages.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="opp-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="opp-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Acme — Annual hardware renewal"
                autoFocus
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="opp-tp">
                Third party <span className="text-destructive">*</span>
              </Label>
              <Select
                value={form.thirdPartyId}
                onValueChange={(v) => setForm({ ...form, thirdPartyId: v })}
              >
                <SelectTrigger id="opp-tp" className="w-full">
                  <SelectValue placeholder="Select a third party" />
                </SelectTrigger>
                <SelectContent>
                  {sortedThirdParties.length === 0 && (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      No third parties available
                    </div>
                  )}
                  {sortedThirdParties.map((tp) => (
                    <SelectItem key={tp.id} value={tp.id}>
                      {tp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-stage">Stage</Label>
              <Select
                value={form.stage}
                onValueChange={(v) => setForm({ ...form, stage: v as OpportunityStage })}
              >
                <SelectTrigger id="opp-stage" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STAGE_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-amount">Amount (USD)</Label>
              <Input
                id="opp-amount"
                type="number"
                min={0}
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-probability">Probability (0–100 %)</Label>
              <Input
                id="opp-probability"
                type="number"
                min={0}
                max={100}
                step={1}
                value={form.probability}
                onChange={(e) => setForm({ ...form, probability: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="opp-date">Expected close date</Label>
              <Input
                id="opp-date"
                type="date"
                value={form.expectedCloseDate}
                onChange={(e) => setForm({ ...form, expectedCloseDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="opp-notes">Notes</Label>
              <Textarea
                id="opp-notes"
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Context, next steps, competitors…"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!canSave}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {editing ? 'Save changes' : 'Create opportunity'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this opportunity?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `"${deleteTarget.title}" (${deleteTarget.thirdParty.name}) will be permanently removed. This cannot be undone.`
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
