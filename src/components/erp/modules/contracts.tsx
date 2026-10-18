'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  Ban,
  CalendarClock,
  Coins,
  FileSignature,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
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
import { DocStatusBadge, StatusBadge } from '@/components/erp/shared/status-badge'
import type { Tone } from '@/components/erp/shared/status-badge'
import { StatCard } from '@/components/erp/shared/stat-card'
import {
  formatMoney,
  formatDate,
  toDateInput,
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
  type?: string
  status?: string
}

interface ContractRow {
  id: string
  ref: string
  thirdPartyId: string
  thirdParty: { id: string; name: string; code: string }
  label: string
  status: string // DRAFT | ACTIVE | EXPIRED | CANCELLED
  startDate: string
  endDate: string | null
  amount: number
  billingCycle: string // ONE_TIME | MONTHLY | QUARTERLY | YEARLY
  notes: string | null
}

const CYCLES = [
  { value: 'ONE_TIME', label: 'One time', tone: 'muted' as Tone },
  { value: 'MONTHLY', label: 'Monthly', tone: 'info' as Tone },
  { value: 'QUARTERLY', label: 'Quarterly', tone: 'neutral' as Tone },
  { value: 'YEARLY', label: 'Yearly', tone: 'warning' as Tone },
] as const

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'CANCELLED', label: 'Cancelled' },
] as const

const DAY_MS = 86_400_000

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Normalize a contract amount to a monthly figure (active contracts only) */
function monthlyAmount(c: ContractRow): number {
  if (c.billingCycle === 'MONTHLY') return c.amount
  if (c.billingCycle === 'QUARTERLY') return c.amount / 3
  if (c.billingCycle === 'YEARLY') return c.amount / 12
  return 0
}

function isExpiringSoon(c: ContractRow, now = Date.now()): boolean {
  if (c.status !== 'ACTIVE' || !c.endDate) return false
  const end = new Date(c.endDate).getTime()
  return end >= now - DAY_MS && end <= now + 60 * DAY_MS
}

// ---------------------------------------------------------------------------
// Create / edit dialog
// ---------------------------------------------------------------------------
function ContractFormDialog({
  open,
  onOpenChange,
  editContract,
  thirdParties,
  toast,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editContract: ContractRow | null
  thirdParties: ThirdPartyLite[]
  toast: ReturnType<typeof useToast>['toast']
}) {
  const queryClient = useQueryClient()
  const [thirdPartyId, setThirdPartyId] = useState(editContract?.thirdParty.id ?? '')
  const [label, setLabel] = useState(editContract?.label ?? '')
  const [billingCycle, setBillingCycle] = useState(editContract?.billingCycle ?? 'MONTHLY')
  const [amount, setAmount] = useState(editContract ? String(editContract.amount) : '0')
  const [startDate, setStartDate] = useState(
    editContract ? toDateInput(editContract.startDate) : toDateInput(new Date())
  )
  const [endDate, setEndDate] = useState(
    editContract?.endDate ? toDateInput(editContract.endDate) : ''
  )
  const [notes, setNotes] = useState(editContract?.notes ?? '')

  const saveMutation = useMutation({
    mutationFn: (payload: unknown) =>
      editContract
        ? put<ContractRow>(`/api/contracts/${editContract.id}`, payload)
        : post<ContractRow>('/api/contracts', payload),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] })
      queryClient.invalidateQueries({ queryKey: ['contract'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({
        title: editContract ? 'Contract updated' : 'Contract created',
        description: saved.ref,
      })
      onOpenChange(false)
    },
    onError: (e: Error) =>
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  })

  const nAmount = Number(amount) || 0
  const invalid = !thirdPartyId || !label.trim() || nAmount < 0

  const submit = () => {
    saveMutation.mutate({
      thirdPartyId,
      label: label.trim(),
      billingCycle,
      amount: nAmount,
      startDate: startDate || undefined,
      endDate: endDate || null,
      notes: notes || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editContract ? `Edit ${editContract.ref}` : 'New contract'}
          </DialogTitle>
          <DialogDescription>
            {editContract
              ? 'Editing is offered for draft contracts.'
              : 'Contracts are created as drafts — activate them from the list when signed.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ct-tp">Third party *</Label>
            <Select value={thirdPartyId} onValueChange={setThirdPartyId}>
              <SelectTrigger id="ct-tp" aria-label="Third party" className="min-h-[40px]">
                <SelectValue placeholder="Select third party" />
              </SelectTrigger>
              <SelectContent>
                {thirdParties.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} ({t.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ct-label">Label *</Label>
            <Input
              id="ct-label"
              placeholder="e.g. Premium Support & Maintenance 2026"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-cycle">Billing cycle</Label>
            <Select value={billingCycle} onValueChange={setBillingCycle}>
              <SelectTrigger id="ct-cycle" aria-label="Billing cycle" className="min-h-[40px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CYCLES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-amount">Amount ({billingCycle === 'ONE_TIME' ? 'one-off' : 'per period'})</Label>
            <Input
              id="ct-amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-start">Start date</Label>
            <Input
              id="ct-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ct-end">End date</Label>
            <Input
              id="ct-end"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="ct-notes">Notes</Label>
            <Textarea
              id="ct-notes"
              rows={2}
              placeholder="Internal notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
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
            {saveMutation.isPending ? 'Saving…' : editContract ? 'Save changes' : 'Create draft'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
export default function ContractsModule() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [formOpen, setFormOpen] = useState(false)
  const [editContract, setEditContract] = useState<ContractRow | null>(null)
  const [deleteContract, setDeleteContract] = useState<ContractRow | null>(null)

  // ---- Data ---------------------------------------------------------------
  const listQuery = useQuery({
    queryKey: ['contracts'],
    queryFn: () => get<ContractRow[]>('/api/contracts'),
  })

  const thirdPartiesQuery = useQuery({
    queryKey: ['third-parties'],
    queryFn: () => get<ThirdPartyLite[]>('/api/third-parties'),
  })

  const contracts = listQuery.data ?? []
  const thirdParties = thirdPartiesQuery.data ?? []

  // ---- Stats --------------------------------------------------------------
  const stats = useMemo(() => {
    const now = Date.now()
    let active = 0
    let mrr = 0
    let totalValue = 0
    let expiringSoon = 0
    for (const c of contracts) {
      if (c.status === 'ACTIVE') {
        active += 1
        mrr += monthlyAmount(c)
        if (isExpiringSoon(c, now)) expiringSoon += 1
      }
      if (c.status !== 'CANCELLED') totalValue += c.amount
    }
    return { active, mrr: round2(mrr), totalValue: round2(totalValue), expiringSoon }
  }, [contracts])

  // ---- Filtering ----------------------------------------------------------
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return contracts.filter((c) => {
      if (statusFilter !== 'ALL' && c.status !== statusFilter) return false
      if (!q) return true
      return (
        c.ref.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        c.thirdParty.name.toLowerCase().includes(q)
      )
    })
  }, [contracts, search, statusFilter])

  // ---- Mutations ----------------------------------------------------------
  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'activate' | 'expire' | 'cancel' }) =>
      put<ContractRow>(`/api/contracts/${id}`, { action }),
    onSuccess: (updated, vars) => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({
        title:
          vars.action === 'activate'
            ? 'Contract activated'
            : vars.action === 'expire'
              ? 'Contract expired'
              : 'Contract cancelled',
        description: updated.ref,
      })
    },
    onError: (e: Error) =>
      toast({ title: 'Action failed', description: e.message, variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => del<{ id: string }>(`/api/contracts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: 'Contract deleted' })
      setDeleteContract(null)
    },
    onError: (e: Error) => {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' })
      setDeleteContract(null)
    },
  })

  const openCreate = () => {
    setEditContract(null)
    setFormOpen(true)
  }

  const openEdit = (c: ContractRow) => {
    setEditContract(c)
    setFormOpen(true)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={FileSignature}
        title="Contracts"
        description="Subscriptions and recurring agreements"
        actions={
          <Button className="min-h-[40px]" onClick={openCreate}>
            <Plus className="h-4 w-4" /> New contract
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
          <StatCard
            title="Active contracts"
            value={stats.active}
            icon={FileSignature}
            hint="Currently running"
          />
          <StatCard
            title="Monthly recurring revenue"
            value={stats.mrr}
            icon={RefreshCw}
            isMoney
            hint="Active contracts, normalized to monthly"
          />
          <StatCard
            title="Total contract value"
            value={stats.totalValue}
            icon={Coins}
            isMoney
            hint="Excluding cancelled"
          />
          <StatCard
            title="Expiring soon"
            value={stats.expiringSoon}
            icon={CalendarClock}
            tone="warning"
            hint="Active, ends within 60 days"
          />
        </div>
      )}

      {/* ---- Toolbar ---- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative w-full lg:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            placeholder="Search ref, label, third party…"
            aria-label="Search contracts"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger aria-label="Filter by status" className="min-h-[40px] lg:w-48">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ---- Table ---- */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={FileSignature}
                title="No contracts found"
                description={
                  contracts.length === 0
                    ? 'Create your first contract to track recurring agreements.'
                    : 'Try adjusting the search or status filter.'
                }
                actionLabel={contracts.length === 0 ? 'New contract' : undefined}
                onAction={contracts.length === 0 ? openCreate : undefined}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Ref</TableHead>
                    <TableHead className="min-w-[200px]">Label</TableHead>
                    <TableHead className="whitespace-nowrap">Third party</TableHead>
                    <TableHead className="whitespace-nowrap">Cycle</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Amount</TableHead>
                    <TableHead className="whitespace-nowrap">Period</TableHead>
                    <TableHead className="whitespace-nowrap">Status</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => {
                    const cycle = CYCLES.find((x) => x.value === c.billingCycle)
                    const expiring = isExpiringSoon(c)
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="whitespace-nowrap font-mono text-xs font-medium text-primary">
                          {c.ref}
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <p className="truncate font-medium" title={c.label}>
                            {c.label}
                          </p>
                          {c.notes && (
                            <p className="truncate text-xs text-muted-foreground" title={c.notes}>
                              {c.notes}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <p className="font-medium">{c.thirdParty.name}</p>
                          <p className="font-mono text-xs text-muted-foreground">
                            {c.thirdParty.code}
                          </p>
                        </TableCell>
                        <TableCell>
                          {cycle ? (
                            <StatusBadge status={cycle.value} label={cycle.label} tone={cycle.tone} />
                          ) : (
                            <span className="text-muted-foreground">{c.billingCycle}</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                          {formatMoney(c.amount)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(c.startDate)} → {c.endDate ? formatDate(c.endDate) : '—'}
                          {expiring && c.endDate && (
                            <span className="block text-xs font-medium text-amber-600">
                              ends {relativeDays(c.endDate)}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <DocStatusBadge status={c.status} />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            {c.status === 'DRAFT' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                                aria-label={`Activate ${c.ref}`}
                                title="Activate"
                                disabled={actionMutation.isPending}
                                onClick={() =>
                                  actionMutation.mutate({ id: c.id, action: 'activate' })
                                }
                              >
                                <Play className="h-4 w-4" />
                              </Button>
                            )}
                            {c.status === 'ACTIVE' && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-amber-600 hover:bg-amber-50 hover:text-amber-700"
                                  aria-label={`Expire ${c.ref}`}
                                  title="Mark expired"
                                  disabled={actionMutation.isPending}
                                  onClick={() =>
                                    actionMutation.mutate({ id: c.id, action: 'expire' })
                                  }
                                >
                                  <Archive className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
                                  aria-label={`Cancel ${c.ref}`}
                                  title="Cancel contract"
                                  disabled={actionMutation.isPending}
                                  onClick={() =>
                                    actionMutation.mutate({ id: c.id, action: 'cancel' })
                                  }
                                >
                                  <Ban className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                            {c.status === 'DRAFT' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={`Edit ${c.ref}`}
                                title="Edit (draft only)"
                                onClick={() => openEdit(c)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                              aria-label={`Delete ${c.ref}`}
                              title="Delete"
                              onClick={() => setDeleteContract(c)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---- Dialogs ---- */}
      {formOpen && (
        <ContractFormDialog
          open
          onOpenChange={setFormOpen}
          editContract={editContract}
          thirdParties={thirdParties}
          toast={toast}
        />
      )}
      <AlertDialog
        open={!!deleteContract}
        onOpenChange={(o) => {
          if (!o) setDeleteContract(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteContract?.ref}?</AlertDialogTitle>
            <AlertDialogDescription>
              The contract “{deleteContract?.label}” will be permanently removed. This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (deleteContract) deleteMutation.mutate(deleteContract.id)
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
