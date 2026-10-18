'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftRight,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  Circle,
  Landmark,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wallet,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { StatusBadge } from '@/components/erp/shared/status-badge'
import type { Tone } from '@/components/erp/shared/status-badge'
import { StatCard } from '@/components/erp/shared/stat-card'
import { formatMoney, formatDate, toDateInput } from '@/components/erp/shared/format'
import { useToast } from '@/hooks/use-toast'

// ---------------------------------------------------------------------------
// Types (mirroring API payloads)
// ---------------------------------------------------------------------------
interface BankAccountRow {
  id: string
  name: string
  bank: string | null
  accountNumber: string | null
  currency: string
  type: string // BANK | CASH
  openingBalance: number
  currentBalance: number
  _count: { transactions: number }
}

interface BankTxRow {
  id: string
  accountId: string
  date: string
  label: string
  amount: number // signed: + credit / − debit
  category: string | null
  reference: string | null
  reconciled: boolean
  account?: { id: string; name: string; type: string; currency: string }
}

interface BankOverview {
  accounts: BankAccountRow[]
  recentTransactions: BankTxRow[]
  totals: { bank: number; cash: number; overall: number }
}

const CATEGORIES = [
  { value: 'SALES', label: 'Sales', tone: 'success' as Tone },
  { value: 'PURCHASES', label: 'Purchases', tone: 'warning' as Tone },
  { value: 'SALARIES', label: 'Salaries', tone: 'danger' as Tone },
  { value: 'EXPENSES', label: 'Expenses', tone: 'muted' as Tone },
  { value: 'TRANSFER', label: 'Transfer', tone: 'info' as Tone },
  { value: 'OTHER', label: 'Other', tone: 'muted' as Tone },
] as const

const NO_CATEGORY = '__none__'

const scrollClasses =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-track]:bg-transparent'

// ---------------------------------------------------------------------------
// Account create / edit dialog
// ---------------------------------------------------------------------------
function AccountFormDialog({
  open,
  onOpenChange,
  editAccount,
  toast,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  editAccount: BankAccountRow | null
  toast: ReturnType<typeof useToast>['toast']
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(editAccount?.name ?? '')
  const [bank, setBank] = useState(editAccount?.bank ?? '')
  const [accountNumber, setAccountNumber] = useState(editAccount?.accountNumber ?? '')
  const [type, setType] = useState(editAccount?.type ?? 'BANK')
  const [openingBalance, setOpeningBalance] = useState(
    editAccount ? String(editAccount.openingBalance) : '0'
  )

  const saveMutation = useMutation({
    mutationFn: (payload: unknown) =>
      editAccount
        ? put<BankAccountRow>(`/api/bank/accounts/${editAccount.id}`, payload)
        : post<BankAccountRow>('/api/bank/accounts', payload),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ['bank'] })
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({
        title: editAccount ? 'Account updated' : 'Account created',
        description: saved.name,
      })
      onOpenChange(false)
    },
    onError: (e: Error) =>
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  })

  const nOpening = Number(openingBalance) || 0
  const invalid = !name.trim() || nOpening < 0

  const submit = () => {
    saveMutation.mutate({
      name: name.trim(),
      bank: bank || null,
      accountNumber: accountNumber || null,
      type,
      openingBalance: nOpening,
      currency: 'USD',
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editAccount ? `Edit ${editAccount.name}` : 'New account'}</DialogTitle>
          <DialogDescription>
            {editAccount
              ? 'Changing the opening balance recomputes the current balance (opening + Σ transactions).'
              : 'The current balance starts equal to the opening balance.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="acc-name">Name *</Label>
            <Input
              id="acc-name"
              placeholder="e.g. Savings Account"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-type">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="acc-type" aria-label="Account type" className="min-h-[40px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BANK">Bank</SelectItem>
                <SelectItem value="CASH">Cash</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-currency">Currency</Label>
            <Input id="acc-currency" value="USD" disabled aria-readonly />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-bank">Bank</Label>
            <Input
              id="acc-bank"
              placeholder="e.g. First National Bank"
              value={bank}
              onChange={(e) => setBank(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-number">Account number</Label>
            <Input
              id="acc-number"
              placeholder="e.g. **** 4821"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="acc-opening">Opening balance</Label>
            <Input
              id="acc-opening"
              type="number"
              min="0"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
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
            {saveMutation.isPending ? 'Saving…' : editAccount ? 'Save changes' : 'Create account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// New transaction dialog
// ---------------------------------------------------------------------------
function TransactionFormDialog({
  open,
  onOpenChange,
  accounts,
  defaultAccountId,
  toast,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  accounts: BankAccountRow[]
  defaultAccountId: string
  toast: ReturnType<typeof useToast>['toast']
}) {
  const queryClient = useQueryClient()
  const [accountId, setAccountId] = useState(defaultAccountId || accounts[0]?.id || '')
  const [direction, setDirection] = useState<'IN' | 'OUT'>('IN')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(toDateInput(new Date()))
  const [label, setLabel] = useState('')
  const [category, setCategory] = useState(NO_CATEGORY)
  const [reference, setReference] = useState('')

  const createMutation = useMutation({
    mutationFn: (payload: unknown) => post<BankTxRow>('/api/bank/transactions', payload),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['bank'] })
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({
        title: 'Transaction recorded',
        description: `${created.label} · ${formatMoney(created.amount)}`,
      })
      onOpenChange(false)
    },
    onError: (e: Error) =>
      toast({ title: 'Save failed', description: e.message, variant: 'destructive' }),
  })

  const nAmount = Number(amount)
  const invalid = !accountId || !label.trim() || !Number.isFinite(nAmount) || nAmount <= 0

  const submit = () => {
    createMutation.mutate({
      accountId,
      direction,
      amount: nAmount,
      date: date || undefined,
      label: label.trim(),
      category: category === NO_CATEGORY ? null : category,
      reference: reference || null,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New transaction</DialogTitle>
          <DialogDescription>
            The amount is recorded as a credit (money in) or debit (money out) on the selected
            account and its balance is updated immediately.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tx-account">Account *</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger id="tx-account" aria-label="Account" className="min-h-[40px]">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} ({a.type === 'CASH' ? 'Cash' : 'Bank'})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {accounts.length === 0 && (
              <p className="text-xs text-rose-600">Create an account first.</p>
            )}
          </div>

          <div className="space-y-1.5 sm:col-span-2" role="group" aria-label="Direction">
            <Label>Direction *</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={direction === 'IN' ? 'default' : 'outline'}
                aria-pressed={direction === 'IN'}
                className={
                  direction === 'IN'
                    ? 'min-h-[40px] bg-emerald-600 text-white hover:bg-emerald-700'
                    : 'min-h-[40px]'
                }
                onClick={() => setDirection('IN')}
              >
                <ArrowDownLeft className="h-4 w-4" /> Money in
              </Button>
              <Button
                type="button"
                variant={direction === 'OUT' ? 'default' : 'outline'}
                aria-pressed={direction === 'OUT'}
                className={
                  direction === 'OUT'
                    ? 'min-h-[40px] bg-rose-600 text-white hover:bg-rose-700'
                    : 'min-h-[40px]'
                }
                onClick={() => setDirection('OUT')}
              >
                <ArrowUpRight className="h-4 w-4" /> Money out
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tx-amount">Amount *</Label>
            <Input
              id="tx-amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            {Number.isFinite(nAmount) && nAmount > 0 && (
              <p
                className={`text-xs font-medium ${
                  direction === 'IN' ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                Will record {direction === 'IN' ? '+' : '−'}
                {formatMoney(nAmount)} ({direction === 'IN' ? 'credit' : 'debit'})
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx-date">Date</Label>
            <Input id="tx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="tx-label">Label *</Label>
            <Input
              id="tx-label"
              placeholder="e.g. Office rent — November"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx-category">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="tx-category" aria-label="Category" className="min-h-[40px]">
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>None</SelectItem>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tx-reference">Reference</Label>
            <Input
              id="tx-reference"
              placeholder="e.g. IN2610-0001"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={createMutation.isPending || invalid}
            className="min-h-[40px] min-w-[140px]"
          >
            {createMutation.isPending ? 'Recording…' : 'Record transaction'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
export default function BankModule() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState('ALL')
  const [categoryFilter, setCategoryFilter] = useState('ALL')
  const [txDialogOpen, setTxDialogOpen] = useState(false)
  const [txDefaultAccount, setTxDefaultAccount] = useState('')
  const [accountDialogOpen, setAccountDialogOpen] = useState(false)
  const [editAccount, setEditAccount] = useState<BankAccountRow | null>(null)
  const [deleteAccount, setDeleteAccount] = useState<BankAccountRow | null>(null)

  // ---- Data ---------------------------------------------------------------
  const overviewQuery = useQuery({
    queryKey: ['bank'],
    queryFn: () => get<BankOverview>('/api/bank'),
  })

  const transactionsQuery = useQuery({
    queryKey: ['bank-transactions'],
    queryFn: () => get<BankTxRow[]>('/api/bank/transactions'),
  })

  const accounts = overviewQuery.data?.accounts ?? []
  const overview = overviewQuery.data
  const transactions = transactionsQuery.data ?? []

  // ---- Stats --------------------------------------------------------------
  const monthTxCount = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    return transactions.filter((t) => new Date(t.date) >= monthStart).length
  }, [transactions])

  const monthLabel = useMemo(
    () => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date()),
    []
  )

  // ---- Filtering ----------------------------------------------------------
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return transactions.filter((t) => {
      if (accountFilter !== 'ALL' && t.accountId !== accountFilter) return false
      if (categoryFilter !== 'ALL' && t.category !== categoryFilter) return false
      if (!q) return true
      return (
        t.label.toLowerCase().includes(q) ||
        (t.reference ?? '').toLowerCase().includes(q) ||
        (t.account?.name ?? '').toLowerCase().includes(q)
      )
    })
  }, [transactions, search, accountFilter, categoryFilter])

  // ---- Account delete -----------------------------------------------------
  const deleteMutation = useMutation({
    mutationFn: (id: string) => del<{ id: string }>(`/api/bank/accounts/${id}`),
    onSuccess: (_res, id) => {
      queryClient.invalidateQueries({ queryKey: ['bank'] })
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast({ title: 'Account deleted' })
      setDeleteAccount(null)
      if (accountFilter === id) setAccountFilter('ALL')
    },
    onError: (e: Error) => {
      toast({ title: 'Delete failed', description: e.message, variant: 'destructive' })
      setDeleteAccount(null)
    },
  })

  const openNewTransaction = (accountId?: string) => {
    setTxDefaultAccount(accountId ?? '')
    setTxDialogOpen(true)
  }

  const openEditAccount = (account: BankAccountRow) => {
    setEditAccount(account)
    setAccountDialogOpen(true)
  }

  const loading = overviewQuery.isLoading || transactionsQuery.isLoading

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Landmark}
        title="Bank & Cash"
        description="Accounts, transactions and balances"
        actions={
          <>
            <Button className="min-h-[40px]" onClick={() => openNewTransaction()}>
              <Plus className="h-4 w-4" /> New transaction
            </Button>
            <Button
              variant="outline"
              className="min-h-[40px]"
              onClick={() => {
                setEditAccount(null)
                setAccountDialogOpen(true)
              }}
            >
              <Plus className="h-4 w-4" /> New account
            </Button>
          </>
        }
      />

      {/* ---- Stats ---- */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[92px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Total balance"
            value={overview?.totals.overall ?? 0}
            icon={Wallet}
            isMoney
            hint="All accounts"
          />
          <StatCard
            title="Bank balance"
            value={overview?.totals.bank ?? 0}
            icon={Landmark}
            isMoney
            hint="Bank accounts"
          />
          <StatCard
            title="Cash balance"
            value={overview?.totals.cash ?? 0}
            icon={Banknote}
            isMoney
            hint="Cash accounts"
          />
          <StatCard
            title="Transactions this month"
            value={monthTxCount}
            icon={ArrowLeftRight}
            hint={monthLabel}
          />
        </div>
      )}

      {/* ---- Account cards ---- */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[150px] rounded-xl" />
          <Skeleton className="h-[150px] rounded-xl" />
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Landmark}
          title="No bank accounts yet"
          description="Create your first bank or cash account to start recording transactions."
          actionLabel="New account"
          onAction={() => {
            setEditAccount(null)
            setAccountDialogOpen(true)
          }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {accounts.map((a) => (
            <Card key={a.id} className="py-0 gap-0">
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{a.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[a.bank, a.accountNumber].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  <StatusBadge
                    status={a.type}
                    label={a.type === 'CASH' ? 'Cash' : 'Bank'}
                    tone={a.type === 'CASH' ? 'warning' : 'neutral'}
                  />
                </div>
                <p
                  className={`mt-3 text-2xl font-bold tabular-nums ${
                    a.currentBalance < 0 ? 'text-rose-600' : ''
                  }`}
                >
                  {formatMoney(a.currentBalance)}
                </p>
                <div className="mt-3 flex items-center justify-between border-t pt-3">
                  <p className="text-xs text-muted-foreground">
                    {a._count.transactions} transaction{a._count.transactions === 1 ? '' : 's'}
                  </p>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label={`Edit ${a.name}`}
                      title="Edit account"
                      onClick={() => openEditAccount(a)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {a._count.transactions === 0 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                        aria-label={`Delete ${a.name}`}
                        title="Delete account"
                        onClick={() => setDeleteAccount(a)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
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
            placeholder="Search label, reference, account…"
            aria-label="Search transactions"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={accountFilter} onValueChange={setAccountFilter}>
          <SelectTrigger aria-label="Filter by account" className="min-h-[40px] lg:w-56">
            <SelectValue placeholder="All accounts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All accounts</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger aria-label="Filter by category" className="min-h-[40px] lg:w-48">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ---- Transactions table ---- */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          <div className="border-b px-4 py-3 sm:px-5">
            <h2 className="text-sm font-semibold">Transactions</h2>
            <p className="text-xs text-muted-foreground">
              {filtered.length} of {transactions.length} — latest first
            </p>
          </div>
          {transactionsQuery.isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={ArrowLeftRight}
                title="No transactions found"
                description={
                  transactions.length === 0
                    ? 'Record your first transaction to see it here.'
                    : 'Try adjusting the search or filters.'
                }
                actionLabel={transactions.length === 0 ? 'New transaction' : undefined}
                onAction={transactions.length === 0 ? () => openNewTransaction() : undefined}
              />
            </div>
          ) : (
            <div className={`max-h-96 overflow-auto ${scrollClasses}`}>
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Date</TableHead>
                    <TableHead className="min-w-[220px]">Label</TableHead>
                    <TableHead className="whitespace-nowrap">Account</TableHead>
                    <TableHead className="whitespace-nowrap">Category</TableHead>
                    <TableHead className="whitespace-nowrap">Reference</TableHead>
                    <TableHead className="whitespace-nowrap text-right">Amount</TableHead>
                    <TableHead
                      className="whitespace-nowrap text-center"
                      title="Reconciliation is display-only in this release"
                    >
                      Rec.
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((t) => {
                    const cat = CATEGORIES.find((c) => c.value === t.category)
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(t.date)}
                        </TableCell>
                        <TableCell className="font-medium">{t.label}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {t.account?.name ?? '—'}
                        </TableCell>
                        <TableCell>
                          {cat ? (
                            <StatusBadge status={cat.value} label={cat.label} tone={cat.tone} />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs">
                          {t.reference ?? '—'}
                        </TableCell>
                        <TableCell
                          className={`whitespace-nowrap text-right font-semibold tabular-nums ${
                            t.amount < 0 ? 'text-rose-600' : 'text-emerald-600'
                          }`}
                        >
                          {t.amount < 0 ? '−' : '+'}
                          {formatMoney(Math.abs(t.amount))}
                        </TableCell>
                        <TableCell className="text-center">
                          {t.reconciled ? (
                            <CheckCircle2
                              className="mx-auto h-4 w-4 text-emerald-600"
                              aria-label="Reconciled"
                            />
                          ) : (
                            <Circle
                              className="mx-auto h-4 w-4 text-zinc-300"
                              aria-label="Not reconciled"
                            />
                          )}
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

      {/* ---- Dialogs (mounted on open so forms always start fresh) ---- */}
      {txDialogOpen && (
        <TransactionFormDialog
          open
          onOpenChange={setTxDialogOpen}
          accounts={accounts}
          defaultAccountId={txDefaultAccount}
          toast={toast}
        />
      )}
      {accountDialogOpen && (
        <AccountFormDialog
          open
          onOpenChange={setAccountDialogOpen}
          editAccount={editAccount}
          toast={toast}
        />
      )}
      <AlertDialog
        open={!!deleteAccount}
        onOpenChange={(o) => {
          if (!o) setDeleteAccount(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteAccount?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This account has no transactions, so it can be removed safely. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                if (deleteAccount) deleteMutation.mutate(deleteAccount.id)
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
