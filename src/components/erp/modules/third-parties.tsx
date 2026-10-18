'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2, Eye, FileText, Globe, Loader2, Mail, MapPin, Pencil, Phone,
  Plus, Search, Star, Target, Trash2, Truck, Users,
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
import { StatusBadge, DocStatusBadge, type Tone } from '@/components/erp/shared/status-badge'
import { StatCard } from '@/components/erp/shared/stat-card'
import { formatDate } from '@/components/erp/shared/format'
import { get, post, put, del } from '@/components/erp/lib/api'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types (mirror API payloads)
// ---------------------------------------------------------------------------
type ThirdPartyType = 'CUSTOMER' | 'PROSPECT' | 'SUPPLIER' | 'CUSTOMER_SUPPLIER'
type ThirdPartyStatus = 'ACTIVE' | 'SUSPENDED'
type PaymentTerms = 'ON_ORDER' | 'NET15' | 'NET30' | 'NET60'

interface ThirdPartyCounts {
  contacts: number
  opportunities: number
  proposals: number
  saleOrders: number
  invoices: number
}

interface ThirdPartyRow {
  id: string
  code: string
  name: string
  type: ThirdPartyType
  status: ThirdPartyStatus
  email: string | null
  phone: string | null
  website: string | null
  address: string | null
  zip: string | null
  city: string | null
  country: string | null
  vatNumber: string | null
  paymentTerms: PaymentTerms
  notes: string | null
  createdAt: string
  _count: ThirdPartyCounts
}

interface ContactRow {
  id: string
  thirdPartyId: string | null
  firstName: string
  lastName: string
  position: string | null
  email: string | null
  phone: string | null
  mobile: string | null
  isPrimary: boolean
  createdAt: string
}

interface DetailCounts extends ThirdPartyCounts {
  contracts: number
  purchaseOrders: number
  supplierInvoices: number
  tickets: number
  projects: number
  agendaEvents: number
}

interface ThirdPartyDetail extends Omit<ThirdPartyRow, '_count'> {
  contacts: ContactRow[]
  _count: DetailCounts
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TYPE_TONE: Record<ThirdPartyType, Tone> = {
  CUSTOMER: 'success',
  PROSPECT: 'info',
  SUPPLIER: 'muted',
  CUSTOMER_SUPPLIER: 'neutral',
}

const TYPE_LABEL: Record<ThirdPartyType, string> = {
  CUSTOMER: 'Customer',
  PROSPECT: 'Prospect',
  SUPPLIER: 'Supplier',
  CUSTOMER_SUPPLIER: 'Customer + Supplier',
}

const PAYMENT_TERMS_LABEL: Record<PaymentTerms, string> = {
  ON_ORDER: 'On order',
  NET15: 'Net 15',
  NET30: 'Net 30',
  NET60: 'Net 60',
}

const emptyContactForm = { firstName: '', lastName: '', position: '', email: '', phone: '' }

const emptyTpForm = {
  name: '',
  type: 'CUSTOMER' as ThirdPartyType,
  status: 'ACTIVE' as ThirdPartyStatus,
  email: '',
  phone: '',
  website: '',
  address: '',
  zip: '',
  city: '',
  country: '',
  vatNumber: '',
  paymentTerms: 'NET30' as PaymentTerms,
  notes: '',
}

type TpFormState = typeof emptyTpForm
type ContactFormState = typeof emptyContactForm

type ConfirmState =
  | { kind: 'tp'; tp: ThirdPartyRow }
  | { kind: 'contact'; contact: ContactRow; thirdPartyId: string }
  | null

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
export default function ThirdPartiesModule() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // filters
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('ALL')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')

  // dialogs
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<ThirdPartyRow | null>(null)
  const [form, setForm] = useState<TpFormState>(emptyTpForm)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const [contactForm, setContactForm] = useState<ContactFormState>(emptyContactForm)

  const listQuery = useQuery({
    queryKey: ['third-parties'],
    queryFn: () => get<ThirdPartyRow[]>('/api/third-parties'),
  })

  const detailQuery = useQuery({
    queryKey: ['third-party', detailId],
    queryFn: () => get<ThirdPartyDetail>(`/api/third-parties/${detailId}`),
    enabled: detailId !== null,
  })

  const data = listQuery.data ?? []
  const totalCounts = useMemo(
    () => ({
      CUSTOMER: data.filter((t) => t.type === 'CUSTOMER').length,
      PROSPECT: data.filter((t) => t.type === 'PROSPECT').length,
      SUPPLIER: data.filter((t) => t.type === 'SUPPLIER').length,
    }),
    [data],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter((tp) => {
      if (typeFilter !== 'ALL' && tp.type !== typeFilter) return false
      if (statusFilter !== 'ALL' && tp.status !== statusFilter) return false
      if (!q) return true
      return [tp.name, tp.code, tp.email ?? '', tp.city ?? ''].some((v) =>
        v.toLowerCase().includes(q),
      )
    })
  }, [data, search, typeFilter, statusFilter])

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['third-parties'] })
    void queryClient.invalidateQueries({ queryKey: ['third-party'] })
  }

  // ---- mutations ----------------------------------------------------------
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { ...form, name: form.name.trim() }
      if (editing) return put(`/api/third-parties/${editing.id}`, payload)
      return post('/api/third-parties', payload)
    },
    onSuccess: () => {
      toast({
        title: editing ? 'Third party updated' : 'Third party created',
        description: form.name.trim(),
      })
      invalidateAll()
      setFormOpen(false)
      setEditing(null)
    },
    onError: (err: Error) =>
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' }),
  })

  const deleteTpMutation = useMutation({
    mutationFn: (id: string) => del(`/api/third-parties/${id}`),
    onSuccess: (_res, id) => {
      toast({ title: 'Third party deleted' })
      if (detailId === id) setDetailId(null)
      invalidateAll()
    },
    onError: (err: Error) =>
      toast({ title: 'Cannot delete', description: err.message, variant: 'destructive' }),
  })

  const addContactMutation = useMutation({
    mutationFn: () =>
      post('/api/contacts', { thirdPartyId: detailId, ...contactForm }),
    onSuccess: () => {
      toast({ title: 'Contact added', description: `${contactForm.firstName} ${contactForm.lastName}`.trim() })
      setContactForm(emptyContactForm)
      invalidateAll()
    },
    onError: (err: Error) =>
      toast({ title: 'Could not add contact', description: err.message, variant: 'destructive' }),
  })

  const deleteContactMutation = useMutation({
    mutationFn: (id: string) => del(`/api/contacts/${id}`),
    onSuccess: () => {
      toast({ title: 'Contact deleted' })
      invalidateAll()
    },
    onError: (err: Error) =>
      toast({ title: 'Could not delete contact', description: err.message, variant: 'destructive' }),
  })

  // ---- dialog helpers -----------------------------------------------------
  const openCreate = () => {
    setEditing(null)
    setForm(emptyTpForm)
    setFormOpen(true)
  }

  const openEdit = (tp: ThirdPartyRow) => {
    setEditing(tp)
    setForm({
      name: tp.name,
      type: tp.type,
      status: tp.status,
      email: tp.email ?? '',
      phone: tp.phone ?? '',
      website: tp.website ?? '',
      address: tp.address ?? '',
      zip: tp.zip ?? '',
      city: tp.city ?? '',
      country: tp.country ?? '',
      vatNumber: tp.vatNumber ?? '',
      paymentTerms: tp.paymentTerms,
      notes: tp.notes ?? '',
    })
    setFormOpen(true)
  }

  const detail = detailQuery.data
  const canSaveTp = form.name.trim().length > 0 && !saveMutation.isPending
  const canAddContact =
    contactForm.firstName.trim().length > 0 &&
    contactForm.lastName.trim().length > 0 &&
    !addContactMutation.isPending

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Building2}
        title="Third Parties"
        description="Customers, prospects and suppliers — the heart of the CRM"
        actions={
          <Button onClick={openCreate} className="min-h-11 sm:min-h-9">
            <Plus className="h-4 w-4" aria-hidden />
            New third party
          </Button>
        }
      />

      {/* Summary chips */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard title="Customers" value={totalCounts.CUSTOMER} icon={Building2} />
        <StatCard title="Prospects" value={totalCounts.PROSPECT} icon={Target} />
        <StatCard title="Suppliers" value={totalCounts.SUPPLIER} icon={Truck} />
        <StatCard title="All third parties" value={data.length} icon={Users} hint="incl. customer + supplier" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, code, email, city…"
            className="pl-8"
            aria-label="Search third parties"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by type">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            <SelectItem value="CUSTOMER">Customer</SelectItem>
            <SelectItem value="PROSPECT">Prospect</SelectItem>
            <SelectItem value="SUPPLIER">Supplier</SelectItem>
            <SelectItem value="CUSTOMER_SUPPLIER">Customer + Supplier</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="SUSPENDED">Suspended</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {listQuery.isError && (
            <p className="p-4 text-sm text-destructive">
              Failed to load third parties: {listQuery.error.message}
            </p>
          )}
          <div className="overflow-x-auto">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>City / Country</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Payment terms</TableHead>
                  <TableHead className="text-center">Docs</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isPending &&
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={9}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                {!listQuery.isPending && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="p-0">
                      <div className="p-6">
                        <EmptyState
                          icon={Building2}
                          title={data.length === 0 ? 'No third parties yet' : 'No third parties match your filters'}
                          description={
                            data.length === 0
                              ? 'Create your first customer, prospect or supplier to get started.'
                              : 'Try clearing the search box or switching the type/status filters.'
                          }
                          actionLabel={data.length === 0 ? 'New third party' : undefined}
                          onAction={data.length === 0 ? openCreate : undefined}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((tp) => (
                  <TableRow key={tp.id} className="group">
                    <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {tp.code}
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <button
                        type="button"
                        onClick={() => setDetailId(tp.id)}
                        className="rounded text-left font-medium hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`View details of ${tp.name}`}
                      >
                        {tp.name}
                      </button>
                      {tp.email && (
                        <p className="truncate text-xs text-muted-foreground">{tp.email}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={tp.type} label={TYPE_LABEL[tp.type]} tone={TYPE_TONE[tp.type]} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {[tp.city, tp.country].filter(Boolean).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{tp.phone ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {PAYMENT_TERMS_LABEL[tp.paymentTerms] ?? tp.paymentTerms}
                    </TableCell>
                    <TableCell className="text-center">
                      <span
                        className="inline-flex items-center gap-1 text-sm tabular-nums"
                        title="Proposals, sale orders and invoices"
                      >
                        <FileText className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                        {tp._count.proposals + tp._count.saleOrders + tp._count.invoices}
                      </span>
                    </TableCell>
                    <TableCell>
                      <DocStatusBadge status={tp.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 sm:h-8 sm:w-8"
                          onClick={() => setDetailId(tp.id)}
                          aria-label={`View ${tp.name}`}
                        >
                          <Eye className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 sm:h-8 sm:w-8"
                          onClick={() => openEdit(tp)}
                          aria-label={`Edit ${tp.name}`}
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 text-muted-foreground hover:text-destructive sm:h-8 sm:w-8"
                          onClick={() => setConfirm({ kind: 'tp', tp })}
                          aria-label={`Delete ${tp.name}`}
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
              {filtered.length} of {data.length} third part{data.length === 1 ? 'y' : 'ies'}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Create / edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : 'New third party'}</DialogTitle>
            <DialogDescription>
              {editing
                ? `Reference ${editing.code} — update the company details below.`
                : 'Register a customer, prospect or supplier. A reference code is generated automatically.'}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tp-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tp-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Acme Manufacturing"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tp-type">Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm({ ...form, type: v as ThirdPartyType })}
              >
                <SelectTrigger id="tp-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CUSTOMER">Customer</SelectItem>
                  <SelectItem value="PROSPECT">Prospect</SelectItem>
                  <SelectItem value="SUPPLIER">Supplier</SelectItem>
                  <SelectItem value="CUSTOMER_SUPPLIER">Customer + Supplier</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tp-status">Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm({ ...form, status: v as ThirdPartyStatus })}
              >
                <SelectTrigger id="tp-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="SUSPENDED">Suspended</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tp-email">Email</Label>
              <Input
                id="tp-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="contact@company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tp-phone">Phone</Label>
              <Input
                id="tp-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+1 555 010 0000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tp-website">Website</Label>
              <Input
                id="tp-website"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="https://company.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tp-vat">VAT number</Label>
              <Input
                id="tp-vat"
                value={form.vatNumber}
                onChange={(e) => setForm({ ...form, vatNumber: e.target.value })}
                placeholder="US-0000000"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tp-address">Address</Label>
              <Input
                id="tp-address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="100 Corporate Ave"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tp-zip">ZIP / Postal code</Label>
              <Input
                id="tp-zip"
                value={form.zip}
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tp-city">City</Label>
              <Input
                id="tp-city"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tp-country">Country</Label>
              <Input
                id="tp-country"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tp-terms">Payment terms</Label>
              <Select
                value={form.paymentTerms}
                onValueChange={(v) => setForm({ ...form, paymentTerms: v as PaymentTerms })}
              >
                <SelectTrigger id="tp-terms" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ON_ORDER">On order</SelectItem>
                  <SelectItem value="NET15">Net 15</SelectItem>
                  <SelectItem value="NET30">Net 30</SelectItem>
                  <SelectItem value="NET60">Net 60</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tp-notes">Notes</Label>
              <Textarea
                id="tp-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                placeholder="Internal notes about this third party…"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!canSaveTp}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {editing ? 'Save changes' : 'Create third party'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <Dialog open={detailId !== null} onOpenChange={(o) => !o && setDetailId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {detailQuery.isPending && (
            <div className="space-y-4" aria-busy="true">
              <DialogTitle className="sr-only">Third party details (loading)</DialogTitle>
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
          {detailQuery.isError && (
            <p className="text-sm text-destructive">
              Failed to load details: {detailQuery.error.message}
            </p>
          )}
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
                  {detail.name}
                  <span className="font-mono text-xs font-normal text-muted-foreground">{detail.code}</span>
                </DialogTitle>
                <DialogDescription className="flex flex-wrap items-center gap-2 pt-1">
                  <StatusBadge status={detail.type} label={TYPE_LABEL[detail.type]} tone={TYPE_TONE[detail.type]} />
                  <DocStatusBadge status={detail.status} />
                  <StatusBadge status={detail.paymentTerms} label={PAYMENT_TERMS_LABEL[detail.paymentTerms] ?? detail.paymentTerms} tone="muted" />
                </DialogDescription>
              </DialogHeader>

              {/* Contact info block */}
              <div className="grid gap-x-6 gap-y-2 rounded-lg border p-4 text-sm sm:grid-cols-2">
                <InfoLine icon={Mail} label="Email" value={detail.email} />
                <InfoLine icon={Phone} label="Phone" value={detail.phone} />
                <InfoLine
                  icon={Globe}
                  label="Website"
                  value={detail.website}
                  href={detail.website ?? undefined}
                />
                <InfoLine
                  icon={MapPin}
                  label="Address"
                  value={[detail.address, [detail.zip, detail.city].filter(Boolean).join(' '), detail.country]
                    .filter((v) => v && v.trim().length > 0)
                    .join(' · ')}
                />
                <InfoLine icon={FileText} label="VAT number" value={detail.vatNumber} />
                <InfoLine icon={Building2} label="Created" value={formatDate(detail.createdAt)} />
                {detail.notes && (
                  <p className="whitespace-pre-line rounded bg-muted/60 p-2 text-xs text-muted-foreground sm:col-span-2">
                    {detail.notes}
                  </p>
                )}
              </div>

              {/* Related doc counts */}
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                <CountBox label="Contacts" value={detail._count.contacts} />
                <CountBox label="Opportunities" value={detail._count.opportunities} />
                <CountBox label="Proposals" value={detail._count.proposals} />
                <CountBox label="Sale orders" value={detail._count.saleOrders} />
                <CountBox label="Invoices" value={detail._count.invoices} />
              </div>

              {/* Contacts section */}
              <section aria-label={`Contacts of ${detail.name}`} className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="h-4 w-4 text-primary" aria-hidden />
                  Contacts
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    {detail.contacts.length}
                  </span>
                </h3>

                {detail.contacts.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No contacts yet — add the first one below.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {detail.contacts.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-start justify-between gap-2 rounded-md border p-3"
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-sm font-medium">
                            {c.firstName} {c.lastName}
                            {c.isPrimary && (
                              <Star
                                className="h-3.5 w-3.5 fill-amber-400 text-amber-400"
                                aria-label="Primary contact"
                              />
                            )}
                          </p>
                          {c.position && (
                            <p className="text-xs text-muted-foreground">{c.position}</p>
                          )}
                          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            {c.email && (
                              <span className="inline-flex items-center gap-1">
                                <Mail className="h-3 w-3" aria-hidden />
                                {c.email}
                              </span>
                            )}
                            {c.phone && (
                              <span className="inline-flex items-center gap-1">
                                <Phone className="h-3 w-3" aria-hidden />
                                {c.phone}
                              </span>
                            )}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive sm:h-8 sm:w-8"
                          onClick={() =>
                            setConfirm({ kind: 'contact', contact: c, thirdPartyId: detail.id })
                          }
                          aria-label={`Delete contact ${c.firstName} ${c.lastName}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Inline add-contact form */}
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Add a contact
                  </p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={contactForm.firstName}
                      onChange={(e) => setContactForm({ ...contactForm, firstName: e.target.value })}
                      placeholder="First name *"
                      aria-label="Contact first name"
                    />
                    <Input
                      value={contactForm.lastName}
                      onChange={(e) => setContactForm({ ...contactForm, lastName: e.target.value })}
                      placeholder="Last name *"
                      aria-label="Contact last name"
                    />
                    <Input
                      value={contactForm.position}
                      onChange={(e) => setContactForm({ ...contactForm, position: e.target.value })}
                      placeholder="Position"
                      aria-label="Contact position"
                    />
                    <Input
                      type="email"
                      value={contactForm.email}
                      onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                      placeholder="Email"
                      aria-label="Contact email"
                    />
                    <Input
                      value={contactForm.phone}
                      onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                      placeholder="Phone"
                      aria-label="Contact phone"
                      className="sm:col-span-1"
                    />
                    <Button
                      className="min-h-11 sm:min-h-9"
                      onClick={() => addContactMutation.mutate()}
                      disabled={!canAddContact}
                    >
                      {addContactMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Plus className="h-4 w-4" aria-hidden />
                      )}
                      Add contact
                    </Button>
                  </div>
                </div>
              </section>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation (third party + contact) */}
      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'contact' ? 'Delete this contact?' : `Delete ${confirm?.tp.name ?? ''}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'contact'
                ? `${confirm.contact.firstName} ${confirm.contact.lastName} will be permanently removed.`
                : 'This will permanently remove the third party along with its contacts and opportunities. Third parties linked to proposals, orders or invoices cannot be deleted.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (!confirm) return
                if (confirm.kind === 'tp') deleteTpMutation.mutate(confirm.tp.id)
                else deleteContactMutation.mutate(confirm.contact.id)
                setConfirm(null)
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
// Small local building blocks
// ---------------------------------------------------------------------------
function InfoLine({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Mail
  label: string
  value: string | null
  href?: string
}) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        {value ? (
          href ? (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="break-all text-sm text-primary hover:underline"
            >
              {value}
            </a>
          ) : (
            <p className="break-all text-sm">{value}</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">—</p>
        )}
      </div>
    </div>
  )
}

function CountBox({ label, value }: { label: string; value: number }) {
  return (
    <div
      className={cn(
        'rounded-md border px-2 py-2 text-center',
        value === 0 && 'opacity-50',
      )}
    >
      <p className="text-base font-bold tabular-nums">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}
