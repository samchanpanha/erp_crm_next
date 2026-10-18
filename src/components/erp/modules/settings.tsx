'use client'

/**
 * Settings module (V2) — company identity, preferences, document numbering
 * and the document template designer with live preview.
 *
 * Tabs:
 *  1. Company        — identity fields + logo upload (data URL, ≤400 KB)
 *  2. Preferences    — sales defaults + localization
 *  3. Numbering      — read-only document counters (GET /api/sequences)
 *  4. Document templates — full designer (accent, paper, texts with
 *     {{token}} variables, field toggles) with a live synthetic preview.
 *
 * State patterns (react-compiler friendly): forms are mounted only once the
 * settings store has loaded and seed themselves from useState initializers;
 * the designer is remounted per selected template via a React key, so no
 * setState-in-effect / setState-in-render is needed anywhere.
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Braces, Building2, Copy, Eye, FileText, Hash, ImageOff, Info, Loader2, Plus,
  RotateCcw, Save, Settings, SlidersHorizontal, Star, Trash2, Upload,
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { get, post, put, del } from '@/components/erp/lib/api'
import { PageHeader, EmptyState } from '@/components/erp/shared/page-header'
import { formatDate } from '@/components/erp/shared/format'
import { useSettingsStore } from '@/lib/settings-store'
import {
  DEFAULT_TEMPLATE_CONFIG, PLACEHOLDERS, SETTING_META, TEMPLATE_TYPES,
  TEMPLATE_TYPE_LABELS, resolvePlaceholders, templateConfigSchema,
  type PlaceholderDef, type TemplateConfig, type TemplateType,
} from '@/lib/template-schema'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const SCROLLBAR_CLS =
  '[&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30'

const MAX_LOGO_BYTES = 400 * 1024

type SettingsMap = Record<string, string>

interface SequenceRow {
  key: string
  value: number
}

/** Friendly label for each ref prefix (fallback: raw key). */
const SEQ_LABELS: Record<string, string> = {
  CU: 'Third parties',
  PD: 'Products & services',
  PR: 'Commercial proposals',
  SO: 'Sale orders',
  IN: 'Customer invoices',
  PO: 'Purchase orders',
  SI: 'Supplier invoices',
  CT: 'Contracts',
  PJ: 'Projects',
  TS: 'Tasks',
  TK: 'Tickets',
  ER: 'Expense reports',
}

function CardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Card aria-busy="true">
      <CardHeader>
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-4 w-64" />
      </CardHeader>
      <CardContent className="space-y-4">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </CardContent>
    </Card>
  )
}

const pickSettings = (keys: readonly string[], settings: SettingsMap): SettingsMap =>
  Object.fromEntries(keys.map((k) => [k, settings[k] ?? '']))

/** Save a settings patch through the zustand store with toasts + pending state. */
function useSaveSettings() {
  const save = useSettingsStore((s) => s.save)
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)

  const savePatch = async (patch: SettingsMap) => {
    setSaving(true)
    try {
      await save(patch)
      toast({ title: 'Settings saved' })
    } catch (e) {
      toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return { saving, savePatch }
}

/** Renders its children only once the settings store has been hydrated. */
function SettingsGate({ children, rows = 5 }: { children: React.ReactNode; rows?: number }) {
  const loaded = useSettingsStore((s) => s.loaded)
  return <>{loaded ? children : <CardSkeleton rows={rows} />}</>
}

// ---------------------------------------------------------------------------
// Tab 1 — Company
// ---------------------------------------------------------------------------

const COMPANY_KEYS = SETTING_META.filter((m) => m.group === 'company').map((m) => m.key)
const COMPANY_META = SETTING_META.filter((m) => m.group === 'company')

function CompanyForm() {
  const { toast } = useToast()
  const settings = useSettingsStore((s) => s.settings)
  const [draft, setDraft] = useState<SettingsMap>(() => pickSettings(COMPANY_KEYS, settings))
  const { saving, savePatch } = useSaveSettings()
  const fileRef = useRef<HTMLInputElement>(null)

  const update = (key: string, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const changedKeys = COMPANY_KEYS.filter((k) => (draft[k] ?? '') !== (settings[k] ?? ''))
  const dirty = changedKeys.length > 0
  const logoValue = draft['company.logoDataUrl'] ?? ''

  const onFile = (file: File | null | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Unsupported file',
        description: 'Please choose an image (PNG, JPG, SVG…).',
        variant: 'destructive',
      })
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast({
        title: 'Logo too large',
        description: `The logo is stored in the database — please pick an image under ${Math.round(MAX_LOGO_BYTES / 1024)} KB (selected: ${(file.size / 1024).toFixed(0)} KB).`,
        variant: 'destructive',
      })
      return
    }
    const reader = new FileReader()
    reader.onload = () => update('company.logoDataUrl', String(reader.result ?? ''))
    reader.onerror = () =>
      toast({ title: 'Could not read file', description: 'Please try another image.', variant: 'destructive' })
    reader.readAsDataURL(file)
  }

  const onSave = async () => {
    if (!draft['company.name']?.trim()) {
      toast({ title: 'Company name is required', variant: 'destructive' })
      return
    }
    await savePatch(Object.fromEntries(changedKeys.map((k) => [k, draft[k] ?? ''])))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company identity</CardTitle>
        <CardDescription>
          Used across the app and printed on documents (invoices, receipts, proposals…).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {COMPANY_META.filter((m) => m.type === 'text' || m.type === 'textarea').map((m) => (
            <div key={m.key} className={cn('space-y-1.5', m.type === 'textarea' && 'sm:col-span-2')}>
              <Label htmlFor={`set-${m.key}`}>{m.label}</Label>
              {m.type === 'textarea' ? (
                <Textarea
                  id={`set-${m.key}`}
                  rows={2}
                  value={draft[m.key] ?? ''}
                  onChange={(e) => update(m.key, e.target.value)}
                />
              ) : (
                <Input
                  id={`set-${m.key}`}
                  type={m.key === 'company.email' ? 'email' : m.key === 'company.phone' ? 'tel' : 'text'}
                  value={draft[m.key] ?? ''}
                  onChange={(e) => update(m.key, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>

        {/* Logo */}
        <div className="space-y-3 rounded-lg border p-4">
          <Label htmlFor="set-company-logo">Company logo</Label>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {logoValue ? (
              <div className="flex h-16 items-center justify-center rounded-md border bg-white p-2">
                <img
                  src={logoValue}
                  alt="Company logo preview"
                  className="h-full w-auto max-w-[180px] object-contain"
                />
              </div>
            ) : (
              <div className="flex h-16 w-40 items-center justify-center gap-2 rounded-md border border-dashed text-sm text-muted-foreground">
                <ImageOff className="h-4 w-4" aria-hidden="true" /> No logo yet
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" /> Upload logo
              </Button>
              {logoValue && (
                <Button
                  type="button"
                  variant="ghost"
                  className="min-h-11 text-destructive hover:text-destructive"
                  onClick={() => update('company.logoDataUrl', '')}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground sm:ml-auto sm:max-w-[230px]">
              PNG, JPG or SVG — max 400 KB (stored inline with your settings).
            </p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            aria-label="Upload company logo"
            onChange={(e) => {
              onFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t px-6">
        <span className="mr-auto hidden text-xs text-muted-foreground sm:block" role="status">
          {dirty ? `${changedKeys.length} unsaved change${changedKeys.length > 1 ? 's' : ''}` : 'All changes saved'}
        </span>
        <Button className="min-h-11" disabled={!dirty || saving} onClick={onSave}>
          {saving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
          )}
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </CardFooter>
    </Card>
  )
}

function CompanyTab() {
  return (
    <SettingsGate rows={6}>
      <CompanyForm />
    </SettingsGate>
  )
}

// ---------------------------------------------------------------------------
// Tab 2 — Preferences (sales + app)
// ---------------------------------------------------------------------------

const PREF_SALES_META = SETTING_META.filter((m) => m.group === 'sales')
const PREF_APP_META = SETTING_META.filter((m) => m.group === 'app')
const PREF_KEYS = [...PREF_SALES_META, ...PREF_APP_META].map((m) => m.key)

function PreferenceFields({
  draft,
  meta,
  onDraftChange,
  idPrefix,
}: {
  draft: SettingsMap
  meta: typeof SETTING_META
  onDraftChange: (key: string, value: string) => void
  idPrefix: string
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {meta.map((m) => (
        <div key={m.key} className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-${m.key}`}>{m.label}</Label>
          {m.type === 'select' ? (
            <Select value={draft[m.key] ?? ''} onValueChange={(v) => onDraftChange(m.key, v)}>
              <SelectTrigger id={`${idPrefix}-${m.key}`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(m.options ?? []).map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id={`${idPrefix}-${m.key}`}
              type={m.key === 'sales.defaultVatRate' ? 'number' : 'text'}
              step={m.key === 'sales.defaultVatRate' ? '0.1' : undefined}
              min={m.key === 'sales.defaultVatRate' ? 0 : undefined}
              max={m.key === 'sales.defaultVatRate' ? 100 : undefined}
              inputMode={m.key === 'sales.defaultVatRate' ? 'decimal' : undefined}
              value={draft[m.key] ?? ''}
              onChange={(e) => onDraftChange(m.key, e.target.value)}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function PreferencesForm() {
  const { toast } = useToast()
  const settings = useSettingsStore((s) => s.settings)
  const [draft, setDraft] = useState<SettingsMap>(() => pickSettings(PREF_KEYS, settings))
  const { saving, savePatch } = useSaveSettings()

  const update = (key: string, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }))

  const changedKeys = PREF_KEYS.filter((k) => (draft[k] ?? '') !== (settings[k] ?? ''))
  const dirty = changedKeys.length > 0

  const onSave = async () => {
    const vat = Number(draft['sales.defaultVatRate'])
    if (!Number.isFinite(vat) || vat < 0 || vat > 100) {
      toast({
        title: 'Invalid VAT rate',
        description: 'The default VAT rate must be a number between 0 and 100.',
        variant: 'destructive',
      })
      return
    }
    await savePatch(Object.fromEntries(changedKeys.map((k) => [k, draft[k] ?? ''])))
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Sales defaults</CardTitle>
          <CardDescription>Pre-filled on new proposals, orders and invoices.</CardDescription>
        </CardHeader>
        <CardContent>
          <PreferenceFields draft={draft} meta={PREF_SALES_META} onDraftChange={update} idPrefix="set-sales" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Localization</CardTitle>
          <CardDescription>Currency and date display used across the workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <PreferenceFields draft={draft} meta={PREF_APP_META} onDraftChange={update} idPrefix="set-app" />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <span className="mr-auto hidden text-xs text-muted-foreground sm:block" role="status">
          {dirty ? `${changedKeys.length} unsaved change${changedKeys.length > 1 ? 's' : ''}` : 'All changes saved'}
        </span>
        <Button className="min-h-11" disabled={!dirty || saving} onClick={onSave}>
          {saving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
          )}
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </div>
  )
}

function PreferencesTab() {
  return (
    <SettingsGate rows={4}>
      <PreferencesForm />
    </SettingsGate>
  )
}

// ---------------------------------------------------------------------------
// Tab 3 — Numbering (read-only)
// ---------------------------------------------------------------------------

function NumberingTab() {
  const q = useQuery<SequenceRow[]>({
    queryKey: ['sequences'],
    queryFn: () => get<SequenceRow[]>('/api/sequences'),
  })
  const rows = q.data ?? []

  // yymm is composed client-side for the example column only — the server
  // stores per-prefix counters; the real ref format is prefix + YYMM + seq.
  const yymm = useMemo(() => {
    const now = new Date()
    return `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}`
  }, [])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Document numbering</CardTitle>
        <CardDescription>
          Automatic counters — one per document family. “Next number” is what the next created
          document of that family will use.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="border-border bg-muted/40 [&>svg]:text-muted-foreground">
          <Info aria-hidden="true" />
          <AlertTitle>References are generated automatically</AlertTitle>
          <AlertDescription>
            Document references follow the pattern{' '}
            <span className="font-mono text-xs">prefix + YYMM + sequence</span> — e.g.{' '}
            <span className="font-mono text-xs">IN2601-0042</span>. They are assigned when a document is
            created and cannot be edited manually, which keeps numbering unique and gap-free. Counters
            below are read-only (v2 scope).
          </AlertDescription>
        </Alert>

        {q.isLoading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        ) : q.isError ? (
          <EmptyState
            icon={Hash}
            title="Could not load counters"
            description={(q.error as Error)?.message ?? 'Please try again.'}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Hash}
            title="No counters yet"
            description="Counters appear automatically the first time each document type is created."
          />
        ) : (
          <div className={cn('max-h-96 overflow-y-auto rounded-md border', SCROLLBAR_CLS)}>
            <Table>
              <TableHeader className="sticky top-0 bg-background">
                <TableRow>
                  <TableHead>Prefix</TableHead>
                  <TableHead className="text-right">Next number</TableHead>
                  <TableHead className="text-right">Example reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const next = r.value + 1
                  return (
                    <TableRow key={r.key}>
                      <TableCell>
                        <div className="font-mono text-sm font-semibold">{r.key}</div>
                        <div className="text-xs text-muted-foreground">{SEQ_LABELS[r.key] ?? 'Documents'}</div>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{next}</TableCell>
                      <TableCell className="text-right">
                        <span className="font-mono text-xs text-muted-foreground">
                          {r.key}
                          {yymm}-{String(next).padStart(4, '0')}
                        </span>
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
  )
}

// ---------------------------------------------------------------------------
// Tab 4 — Document templates + designer
// ---------------------------------------------------------------------------

interface TemplateRow {
  id: string
  name: string
  type: TemplateType
  isDefault: boolean
  config: string
  createdAt: string
  updatedAt: string
}

function parseTemplateConfig(raw: string): TemplateConfig {
  try {
    return templateConfigSchema.parse(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_TEMPLATE_CONFIG, fields: { ...DEFAULT_TEMPLATE_CONFIG.fields } }
  }
}

const FIELD_TOGGLES: { key: keyof TemplateConfig['fields']; label: string }[] = [
  { key: 'showLogo', label: 'Show logo' },
  { key: 'showQty', label: 'Quantity column' },
  { key: 'showUnitPrice', label: 'Unit price column' },
  { key: 'showDiscount', label: 'Discount column' },
  { key: 'showVat', label: 'VAT column' },
  { key: 'showDescription', label: 'Line descriptions' },
  { key: 'showPaymentTerms', label: 'Payment terms' },
  { key: 'showBankDetails', label: 'Bank details' },
  { key: 'showSignature', label: 'Signature line' },
  { key: 'showNotes', label: 'Notes' },
  { key: 'showPaidBadge', label: 'Paid stamp' },
]

const PLACEHOLDER_GROUPS: PlaceholderDef['group'][] = computePlaceholderGroups()
function computePlaceholderGroups(): PlaceholderDef['group'][] {
  const groups: PlaceholderDef['group'][] = []
  for (const p of PLACEHOLDERS) if (!groups.includes(p.group)) groups.push(p.group)
  return groups
}

// ---- Synthetic sample data for the live preview (kept coherent) ----

const SAMPLE_VALUES: Record<string, string> = {
  // Company (fallbacks — live settings win where available)
  'company.name': 'DoliNext Demo Ltd',
  'company.legalName': 'DoliNext Demo Ltd — a demo company',
  'company.address': '12 Commerce Street, 12000 Phnom Penh, Cambodia',
  'company.phone': '+855 12 345 678',
  'company.email': 'billing@dolinext.example',
  'company.website': 'www.dolinext.example',
  'company.taxId': 'VAT-KH-001234567',
  'company.bankDetails': 'ACME Bank · IBAN KH00 1234 5678 9012 345 · SWIFT ABCDKHPP',
  // Document — 3 sample lines: 520 + 360 + 200 = 1080 subtotal, 20% VAT = 216
  'doc.type': 'Invoice',
  'doc.ref': 'IN2610-0004',
  'doc.date': '15/10/2026',
  'doc.dueDate': '14/11/2026',
  'doc.status': 'Paid',
  'doc.subtotal': '$1,080.00',
  'doc.discountTotal': '$0.00',
  'doc.vatTotal': '$216.00',
  'doc.total': '$1,296.00',
  'doc.paidAmount': '$1,296.00',
  'doc.dueAmount': '$0.00',
  'doc.notes': 'Thank you for your business. Late payments may incur a 1% monthly fee.',
  // Customer
  'customer.name': 'Globex Corporation',
  'customer.code': 'CU2601-0002',
  'customer.address': '88 Harbor Road, 45000 Siem Reap, Cambodia',
  'customer.email': 'ap@globex.example',
  'customer.phone': '+855 98 765 432',
  'customer.taxId': 'VAT-KH-765432109',
  // Payment
  'payment.amount': '$1,296.00',
  'payment.method': 'Bank transfer',
  'payment.date': '16/10/2026',
  'payment.reference': 'TR-8842',
  'payment.invoiceRef': 'IN2610-0004',
  'payment.remaining': '$0.00',
}

const PREVIEW_LINES = [
  {
    description: 'IoT Valve V-22 — smart flow controller',
    qty: '2',
    unitPrice: '$260.00',
    discount: '0%',
    vat: '20%',
    total: '$624.00',
  },
  {
    description: 'Installation & calibration (on-site)',
    qty: '1',
    unitPrice: '$360.00',
    discount: '0%',
    vat: '20%',
    total: '$432.00',
  },
  {
    description: 'Sensor probe SP-1 (spare part)',
    qty: '2',
    unitPrice: '$100.00',
    discount: '0%',
    vat: '20%',
    total: '$240.00',
  },
]

/** "Insert variable" dropdown — grouped list of all {{tokens}}. */
function InsertVariableMenu({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0"
          aria-label="Insert variable placeholder"
        >
          <Braces className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Insert variable</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn('max-h-80 w-72 overflow-y-auto', SCROLLBAR_CLS)}>
        {PLACEHOLDER_GROUPS.map((group) => (
          <Fragment key={group}>
            <DropdownMenuLabel className="text-xs text-muted-foreground">{group}</DropdownMenuLabel>
            {PLACEHOLDERS.filter((p) => p.group === group).map((p) => (
              <DropdownMenuItem key={p.token} onSelect={() => onInsert(p.token)}>
                <span className="font-mono text-[11px] text-primary">{`{{${p.token}}}`}</span>
                <span className="ml-1 truncate text-muted-foreground">{p.label}</span>
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Reference table of every available parameter field. */
function PlaceholdersReference() {
  return (
    <Collapsible>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-9 px-2 text-muted-foreground">
          <span className="text-xs font-medium underline-offset-2 hover:underline">
            Available parameter fields ({PLACEHOLDERS.length})
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className={cn('mt-2 max-h-64 overflow-y-auto rounded-md border', SCROLLBAR_CLS)}>
          <Table>
            <TableHeader className="sticky top-0 bg-background">
              <TableRow>
                <TableHead>Token</TableHead>
                <TableHead>Label</TableHead>
                <TableHead className="hidden sm:table-cell">Example</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {PLACEHOLDERS.map((p) => (
                <TableRow key={p.token}>
                  <TableCell className="whitespace-nowrap font-mono text-[11px]">{`{{${p.token}}}`}</TableCell>
                  <TableCell className="text-xs">{p.label}</TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                    {p.example}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Use tokens in the title, header note or footer note via “Insert variable”. Tokens that cannot
          be resolved on a document print as “—”.
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}

type TextFieldKey = 'titlePattern' | 'headerNote' | 'footerNote'

/** Presentational designer: name, accent, paper, texts with variables, field toggles. */
function TemplateDesigner({
  name,
  config,
  onNameChange,
  onConfigChange,
}: {
  name: string
  config: TemplateConfig
  onNameChange: (name: string) => void
  onConfigChange: (config: TemplateConfig) => void
}) {
  const { toast } = useToast()
  const titleRef = useRef<HTMLInputElement>(null)
  const headerRef = useRef<HTMLTextAreaElement>(null)
  const footerRef = useRef<HTMLTextAreaElement>(null)

  // Hex text box: while focused/typing we keep a local draft so partial input
  // like "#ea5" is not clobbered; null = follow the committed config value.
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const hexValue = hexDraft ?? config.accentColor

  const patchConfig = (patch: Partial<TemplateConfig>) =>
    onConfigChange({ ...config, ...patch })

  const patchField = (key: keyof TemplateConfig['fields'], value: boolean) =>
    onConfigChange({ ...config, fields: { ...config.fields, [key]: value } })

  /** Insert a {{token}} at the caret of the given field; falls back to append. */
  const makeInsert =
    (field: TextFieldKey, refObj: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>) =>
    (token: string) => {
      const el = refObj.current
      const wrap = `{{${token}}}`
      const current = config[field]
      let next = current
      let caret: number | null = null
      if (el && typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
        const start = el.selectionStart
        const end = el.selectionEnd
        next = current.slice(0, start) + wrap + current.slice(end)
        caret = start + wrap.length
      } else {
        next = current + wrap
      }
      patchConfig({ [field]: next } as Partial<TemplateConfig>)
      if (el && caret !== null) {
        requestAnimationFrame(() => {
          el.focus()
          try {
            el.setSelectionRange(caret, caret)
          } catch {
            /* some input types ignore selection — ignore */
          }
        })
      }
    }

  const onHexInput = (value: string) => {
    setHexDraft(value)
    if (/^#[0-9a-fA-F]{6}$/.test(value)) patchConfig({ accentColor: value })
  }

  const onNameBlur = () => {
    if (!name.trim()) {
      toast({ title: 'Template name is required', variant: 'destructive' })
    }
  }

  const textFields: {
    field: TextFieldKey
    label: string
    id: string
    multiline?: boolean
    refObj: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  }[] = [
    { field: 'titlePattern', label: 'Document title pattern', id: 'tpl-title', refObj: titleRef },
    { field: 'headerNote', label: 'Header note', id: 'tpl-header', multiline: true, refObj: headerRef },
    { field: 'footerNote', label: 'Footer note', id: 'tpl-footer', multiline: true, refObj: footerRef },
  ]

  return (
    <div className="min-w-0 space-y-4">
      {/* Identity & layout */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Identity &amp; layout</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Template name</Label>
              <Input
                id="tpl-name"
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                onBlur={onNameBlur}
                placeholder="e.g. Classic invoice"
                aria-required="true"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-paper">Paper size</Label>
              <Select
                value={config.paperSize}
                onValueChange={(v) => patchConfig({ paperSize: v as TemplateConfig['paperSize'] })}
              >
                <SelectTrigger id="tpl-paper" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="A4">A4 (210 × 297 mm)</SelectItem>
                  <SelectItem value="LETTER">US Letter (8.5 × 11 in)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Accent color</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={config.accentColor}
                onChange={(e) => patchConfig({ accentColor: e.target.value })}
                className="h-10 w-14 cursor-pointer rounded-md border border-input bg-transparent p-1"
                aria-label="Accent color picker"
              />
              <Input
                value={hexValue}
                onChange={(e) => onHexInput(e.target.value)}
                onBlur={() => setHexDraft(null)}
                maxLength={7}
                placeholder="#ea580c"
                aria-label="Accent color hex value"
                className="w-28 font-mono text-sm"
              />
              <span
                className="ml-1 inline-block h-6 w-6 rounded-full border"
                style={{ backgroundColor: config.accentColor }}
                aria-hidden="true"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Texts & variables */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Texts &amp; variables</CardTitle>
          <CardDescription>
            Compose the document title, header and footer notes from parameter fields.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {textFields.map((tf) => (
            <div key={tf.field} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={tf.id}>{tf.label}</Label>
                <InsertVariableMenu onInsert={makeInsert(tf.field, tf.refObj)} />
              </div>
              {tf.multiline ? (
                <Textarea
                  id={tf.id}
                  ref={tf.refObj as React.Ref<HTMLTextAreaElement>}
                  rows={2}
                  value={config[tf.field]}
                  onChange={(e) => patchConfig({ [tf.field]: e.target.value } as Partial<TemplateConfig>)}
                  placeholder={
                    tf.field === 'headerNote'
                      ? 'e.g. Please pay by {{doc.dueDate}} — {{company.name}} thanks you.'
                      : 'e.g. Bank transfer to {{company.bankDetails}}'
                  }
                />
              ) : (
                <Input
                  id={tf.id}
                  ref={tf.refObj as React.Ref<HTMLInputElement>}
                  value={config[tf.field]}
                  onChange={(e) => patchConfig({ [tf.field]: e.target.value } as Partial<TemplateConfig>)}
                  placeholder="{{doc.type}} {{doc.ref}}"
                />
              )}
            </div>
          ))}

          <PlaceholdersReference />
        </CardContent>
      </Card>

      {/* Field toggles */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Fields shown on document</CardTitle>
          <CardDescription>Toggle columns and blocks — the preview updates instantly.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {FIELD_TOGGLES.map((f) => (
              <div key={f.key} className="flex min-h-11 items-center justify-between gap-3 rounded-md border px-3">
                <Label htmlFor={`tpl-field-${f.key}`} className="cursor-pointer text-sm font-normal">
                  {f.label}
                </Label>
                <Switch
                  id={`tpl-field-${f.key}`}
                  checked={config.fields[f.key]}
                  onCheckedChange={(v) => patchField(f.key, v)}
                  aria-label={f.label}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/** Live preview: synthetic document rendered through the current local config. */
function PreviewPaper({ config }: { config: TemplateConfig }) {
  const settings = useSettingsStore((s) => s.settings)
  const f = config.fields
  const accent = config.accentColor

  const values = useMemo<Record<string, string>>(() => {
    const liveAddress = [
      settings['company.address'],
      [settings['company.zip'], settings['company.city']].filter(Boolean).join(' '),
      settings['company.country'],
    ]
      .filter(Boolean)
      .join(', ')
    return {
      ...SAMPLE_VALUES,
      'company.name': settings['company.name'] || SAMPLE_VALUES['company.name'],
      'company.legalName': settings['company.legalName'] || SAMPLE_VALUES['company.legalName'],
      'company.address': liveAddress || SAMPLE_VALUES['company.address'],
      'company.phone': settings['company.phone'] || SAMPLE_VALUES['company.phone'],
      'company.email': settings['company.email'] || SAMPLE_VALUES['company.email'],
      'company.website': settings['company.website'] || SAMPLE_VALUES['company.website'],
      'company.taxId': settings['company.taxId'] || SAMPLE_VALUES['company.taxId'],
      'company.bankDetails': settings['company.bankDetails'] || SAMPLE_VALUES['company.bankDetails'],
    }
  }, [settings])

  const title = resolvePlaceholders(config.titlePattern, values)
  const headerNote = config.headerNote.trim() ? resolvePlaceholders(config.headerNote, values) : ''
  const footerNote = config.footerNote.trim() ? resolvePlaceholders(config.footerNote, values) : ''
  const logoUrl = f.showLogo ? settings['company.logoDataUrl'] : ''

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Eye className="h-4 w-4 text-primary" aria-hidden="true" /> Live preview
        </p>
        <p className="text-xs text-muted-foreground">
          {config.paperSize === 'A4' ? 'A4' : 'US Letter'} · updates as you type
        </p>
      </div>

      <div
        className="relative max-w-[560px] rounded-lg border border-zinc-200 bg-white p-6 text-[12px] leading-relaxed text-zinc-800 shadow-sm"
        aria-label="Document template live preview"
      >
        {f.showPaidBadge && (
          <div
            className="absolute right-5 top-5 rotate-6 rounded border-2 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.2em] opacity-70"
            style={{ color: accent, borderColor: accent }}
          >
            Paid
          </div>
        )}

        {/* Header: company block + title/meta */}
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
          <div className="min-w-0 sm:max-w-[55%]">
            {logoUrl && (
              <img src={logoUrl} alt="Company logo" className="mb-2 h-10 w-auto max-w-[140px] object-contain" />
            )}
            <p className="text-sm font-bold text-zinc-900">{values['company.name']}</p>
            <p className="whitespace-pre-line text-zinc-500">{values['company.address']}</p>
            <p className="text-zinc-500">
              {values['company.phone']} · {values['company.email']}
            </p>
            <p className="text-zinc-500">Tax ID: {values['company.taxId']}</p>
          </div>
          <div className="sm:text-right">
            <p className="text-xl font-extrabold" style={{ color: accent }}>
              {title}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5 sm:justify-end">
              <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                Ref {values['doc.ref']}
              </span>
              <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                Date {values['doc.date']}
              </span>
              <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                Due {values['doc.dueDate']}
              </span>
              <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                {values['doc.status']}
              </span>
            </div>
            {f.showPaymentTerms && <p className="mt-1.5 text-zinc-500">Payment terms: Net 30 days</p>}
          </div>
        </div>

        {headerNote && (
          <div
            className="mt-4 rounded border-l-2 bg-zinc-50 px-3 py-2 text-zinc-600"
            style={{ borderColor: accent }}
          >
            {headerNote}
          </div>
        )}

        {/* Customer */}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-between">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Bill to</p>
            <p className="font-semibold text-zinc-900">{values['customer.name']}</p>
            <p className="text-zinc-500">{values['customer.address']}</p>
            <p className="text-zinc-500">
              {values['customer.email']} · {values['customer.phone']}
            </p>
          </div>
          <div className="shrink-0 text-zinc-500 sm:text-right">
            <p>
              <span className="text-zinc-400">Customer code: </span>
              {values['customer.code']}
            </p>
            <p>
              <span className="text-zinc-400">Tax ID: </span>
              {values['customer.taxId']}
            </p>
          </div>
        </div>

        {/* Lines */}
        <table className="mt-4 w-full border-collapse">
          <thead>
            <tr
              className="border-b-2 text-left text-[10px] uppercase tracking-wider"
              style={{ borderColor: accent, color: accent }}
            >
              {f.showDescription && <th className="py-1.5 pr-2 font-semibold">Description</th>}
              {f.showQty && <th className="py-1.5 pr-2 text-right font-semibold">Qty</th>}
              {f.showUnitPrice && <th className="py-1.5 pr-2 text-right font-semibold">Unit price</th>}
              {f.showDiscount && <th className="py-1.5 pr-2 text-right font-semibold">Discount</th>}
              {f.showVat && <th className="py-1.5 pr-2 text-right font-semibold">VAT</th>}
              <th className="py-1.5 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {PREVIEW_LINES.map((l) => (
              <tr key={l.description} className="border-b border-zinc-100">
                {f.showDescription && <td className="py-1.5 pr-2">{l.description}</td>}
                {f.showQty && <td className="py-1.5 pr-2 text-right tabular-nums">{l.qty}</td>}
                {f.showUnitPrice && <td className="py-1.5 pr-2 text-right tabular-nums">{l.unitPrice}</td>}
                {f.showDiscount && <td className="py-1.5 pr-2 text-right tabular-nums">{l.discount}</td>}
                {f.showVat && <td className="py-1.5 pr-2 text-right tabular-nums">{l.vat}</td>}
                <td className="py-1.5 text-right font-medium tabular-nums">{l.total}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="mt-3 flex justify-end">
          <div className="w-48 space-y-1 sm:w-56">
            <div className="flex justify-between">
              <span className="text-zinc-500">Subtotal</span>
              <span className="tabular-nums">{values['doc.subtotal']}</span>
            </div>
            {f.showDiscount && (
              <div className="flex justify-between">
                <span className="text-zinc-500">Discount</span>
                <span className="tabular-nums">{values['doc.discountTotal']}</span>
              </div>
            )}
            {f.showVat && (
              <div className="flex justify-between">
                <span className="text-zinc-500">VAT (20%)</span>
                <span className="tabular-nums">{values['doc.vatTotal']}</span>
              </div>
            )}
            <div
              className="flex justify-between border-t pt-1 text-sm font-extrabold"
              style={{ color: accent, borderColor: accent }}
            >
              <span>TOTAL</span>
              <span className="tabular-nums">{values['doc.total']}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">Paid</span>
              <span className="tabular-nums">{values['doc.paidAmount']}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Amount due</span>
              <span className="tabular-nums">{values['doc.dueAmount']}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {f.showNotes && (
          <div className="mt-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Notes</p>
            <p className="text-zinc-600">{values['doc.notes']}</p>
          </div>
        )}

        {/* Footer */}
        {(footerNote || f.showBankDetails) && (
          <div className="mt-5 border-t border-zinc-200 pt-3">
            {footerNote && <p className="text-center italic text-zinc-500">{footerNote}</p>}
            {f.showBankDetails && (
              <p className="mt-2 break-words text-zinc-500">
                <span className="font-semibold text-zinc-700">Bank details: </span>
                {values['company.bankDetails']}
              </p>
            )}
          </div>
        )}
        {f.showSignature && (
          <div className="mt-9 flex justify-end">
            <div className="w-44 border-t border-zinc-300 pt-1 text-right text-[10px] text-zinc-400">
              Authorised signature
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Owns the designer's local (unsaved) state for one template.
 * Remounted via key={template.id} whenever the selection changes, so state
 * initialization happens through useState — no effects needed.
 */
function DesignerPanel({ template }: { template: TemplateRow }) {
  const qc = useQueryClient()
  const { toast } = useToast()

  const [name, setName] = useState(template.name)
  const [config, setConfig] = useState<TemplateConfig>(() => parseTemplateConfig(template.config))
  const [saved, setSaved] = useState<{ name: string; config: TemplateConfig }>(() => ({
    name: template.name,
    config: parseTemplateConfig(template.config),
  }))

  const dirty = name !== saved.name || JSON.stringify(config) !== JSON.stringify(saved.config)

  const saveMutation = useMutation({
    mutationFn: () =>
      put<TemplateRow>(`/api/doc-templates/${template.id}`, { name: name.trim(), config }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ['doc-templates'] })
      const next = { name: t.name, config: parseTemplateConfig(t.config) }
      setName(next.name)
      setConfig(next.config)
      setSaved(next)
      toast({ title: 'Template saved', description: t.name })
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  })

  const onRevert = () => {
    setName(saved.name)
    setConfig(saved.config)
  }

  return (
    <div className="min-w-0 space-y-4">
      {/* Editor header */}
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{name || 'Untitled template'}</p>
          <p className="text-xs text-muted-foreground">
            {TEMPLATE_TYPE_LABELS[template.type]} ·{' '}
            <span role="status">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" className="min-h-11" disabled={!dirty} onClick={onRevert}>
            <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" /> Revert
          </Button>
          <Button
            className="min-h-11"
            disabled={!dirty || saveMutation.isPending || !name.trim()}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            {saveMutation.isPending ? 'Saving…' : 'Save template'}
          </Button>
        </div>
      </div>

      {/* Designer + live preview (stacked below xl, side-by-side from xl) */}
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,36rem)]">
        <TemplateDesigner
          name={name}
          config={config}
          onNameChange={setName}
          onConfigChange={setConfig}
        />
        <div className="min-w-0">
          <PreviewPaper config={config} />
        </div>
      </div>
    </div>
  )
}

/** Tab 4 shell: template list + designer + preview. */
function TemplatesTab() {
  const { toast } = useToast()
  const qc = useQueryClient()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<TemplateType>('INVOICE')
  const [deleteTarget, setDeleteTarget] = useState<TemplateRow | null>(null)

  const q = useQuery<TemplateRow[]>({
    queryKey: ['doc-templates'],
    queryFn: () => get<TemplateRow[]>('/api/doc-templates'),
  })
  const templates = useMemo(() => q.data ?? [], [q.data])

  // Derived selection — no setState-in-effect needed:
  // a stale id (deleted template) or no selection falls back to the default
  // INVOICE template (or the first one).
  const effectiveSelected = useMemo(() => {
    if (templates.length === 0) return null
    const byId = selectedId ? templates.find((t) => t.id === selectedId) : null
    if (byId) return byId
    return (
      templates.find((t) => t.type === 'INVOICE' && t.isDefault) ??
      templates.find((t) => t.type === 'INVOICE') ??
      templates[0]
    )
  }, [templates, selectedId])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['doc-templates'] })

  // ---- Mutations ----
  const createMutation = useMutation({
    mutationFn: (input: { name: string; type: TemplateType }) =>
      post<TemplateRow>('/api/doc-templates', input),
    onSuccess: (t) => {
      invalidate()
      setCreateOpen(false)
      setNewName('')
      setSelectedId(t.id)
      toast({ title: 'Template created', description: `${t.name} — ${TEMPLATE_TYPE_LABELS[t.type]}` })
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  })

  const setDefaultMutation = useMutation({
    mutationFn: (t: TemplateRow) => put<TemplateRow>(`/api/doc-templates/${t.id}`, { isDefault: true }),
    onSuccess: (t) => {
      invalidate()
      toast({
        title: 'Default template updated',
        description: `${t.name} is now the default for ${TEMPLATE_TYPE_LABELS[t.type]}.`,
      })
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  })

  const duplicateMutation = useMutation({
    mutationFn: (t: TemplateRow) =>
      post<TemplateRow>('/api/doc-templates', {
        name: `${t.name} (copy)`.slice(0, 120),
        type: t.type,
        isDefault: false,
        config: parseTemplateConfig(t.config),
      }),
    onSuccess: (t) => {
      invalidate()
      setSelectedId(t.id)
      toast({ title: 'Template duplicated', description: t.name })
    },
    onError: (e) => toast({ title: 'Error', description: (e as Error).message, variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => del<{ ok: boolean }>(`/api/doc-templates/${id}`),
    onSuccess: (_data, id) => {
      invalidate()
      setDeleteTarget(null)
      if (selectedId === id) setSelectedId(null)
      toast({
        title: 'Template deleted',
        description: 'Documents without a template of this type fall back to the built-in default style.',
      })
    },
    onError: (e) => {
      toast({ title: 'Cannot delete', description: (e as Error).message, variant: 'destructive' })
      setDeleteTarget(null)
    },
  })

  const grouped = TEMPLATE_TYPES.map((type) => ({
    type,
    label: TEMPLATE_TYPE_LABELS[type],
    items: templates.filter((t) => t.type === type),
  })).filter((g) => g.items.length > 0)

  const rowActions = (t: TemplateRow) => (
    <div className="flex items-center gap-0.5">
      {t.isDefault ? (
        <Badge className="shrink-0" aria-label="Default template">
          <Star className="h-3 w-3" aria-hidden="true" /> Default
        </Badge>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          aria-label={`Set ${t.name} as default`}
          title="Set as default"
          onClick={() => setDefaultMutation.mutate(t)}
          disabled={setDefaultMutation.isPending}
        >
          <Star className="h-4 w-4" aria-hidden="true" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        aria-label={`Duplicate ${t.name}`}
        title="Duplicate"
        onClick={() => duplicateMutation.mutate(t)}
        disabled={duplicateMutation.isPending}
      >
        <Copy className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 text-muted-foreground hover:text-destructive"
        aria-label={`Delete ${t.name}`}
        title="Delete"
        onClick={() => setDeleteTarget(t)}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  )

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      {/* Left column — template list */}
      <aside className="min-w-0 lg:w-72 lg:shrink-0">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Templates</CardTitle>
            <CardDescription>One default per document type — used by the print engine.</CardDescription>
            <Button className="mt-2 min-h-11 w-full" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> New template
            </Button>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {q.isLoading ? (
              <div className="space-y-2 px-3" aria-busy="true">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : q.isError ? (
              <p className="px-3 pb-3 text-sm text-destructive">
                {(q.error as Error)?.message ?? 'Failed to load templates.'}
              </p>
            ) : grouped.length === 0 ? (
              <div className="px-3 pb-4">
                <EmptyState
                  icon={FileText}
                  title="No templates"
                  description="Create your first template — documents fall back to the built-in style until then."
                  actionLabel="New template"
                  onAction={() => setCreateOpen(true)}
                />
              </div>
            ) : (
              <div
                className={cn(
                  'max-h-[420px] space-y-4 overflow-y-auto px-3 pb-3 lg:max-h-[560px]',
                  SCROLLBAR_CLS,
                )}
              >
                {grouped.map((g) => (
                  <section key={g.type}>
                    <p className="px-1 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {g.label}
                    </p>
                    <div className="space-y-1.5">
                      {g.items.map((t) => (
                        <div
                          key={t.id}
                          className={cn(
                            'flex items-center gap-1 rounded-md border px-1.5 py-1 transition-colors',
                            effectiveSelected?.id === t.id
                              ? 'border-primary bg-primary/5'
                              : 'border-transparent hover:bg-muted/60',
                          )}
                        >
                          <button
                            type="button"
                            className="min-h-11 min-w-0 flex-1 px-1.5 py-1.5 text-left"
                            onClick={() => setSelectedId(t.id)}
                            aria-pressed={effectiveSelected?.id === t.id}
                          >
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-medium">{t.name}</span>
                              {t.isDefault && (
                                <Badge className="shrink-0">
                                  <Star className="h-3 w-3" aria-hidden="true" /> Default
                                </Badge>
                              )}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              Updated {formatDate(t.updatedAt)}
                            </span>
                          </button>
                          {rowActions(t)}
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </aside>

      {/* Right column — designer + preview */}
      <div className="min-w-0">
        {!q.isSuccess ? (
          <CardSkeleton rows={5} />
        ) : !effectiveSelected ? (
          <EmptyState
            icon={FileText}
            title="No document templates yet"
            description="Create a template to control how your invoices, receipts and proposals print."
            actionLabel="New template"
            onAction={() => setCreateOpen(true)}
          />
        ) : (
          <DesignerPanel key={effectiveSelected.id} template={effectiveSelected} />
        )}
      </div>

      {/* New template dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New document template</DialogTitle>
            <DialogDescription>
              Starts from the default configuration — customise everything afterwards.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-new-name">Name</Label>
              <Input
                id="tpl-new-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Compact invoice"
                autoFocus
                aria-required="true"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-new-type">Document type</Label>
              <Select value={newType} onValueChange={(v) => setNewType(v as TemplateType)}>
                <SelectTrigger id="tpl-new-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TEMPLATE_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="min-h-11" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              className="min-h-11"
              disabled={!newName.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate({ name: newName.trim(), type: newType })}
            >
              {createMutation.isPending && (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Create template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete template “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Documents printed without a template of this type fall back to the
              built-in default style.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-11 bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Module root
// ---------------------------------------------------------------------------

type SettingsTabKey = 'company' | 'preferences' | 'numbering' | 'templates'

const TABS: { key: SettingsTabKey; label: string; icon: typeof Settings }[] = [
  { key: 'company', label: 'Company', icon: Building2 },
  { key: 'preferences', label: 'Preferences', icon: SlidersHorizontal },
  { key: 'numbering', label: 'Numbering', icon: Hash },
  { key: 'templates', label: 'Document templates', icon: FileText },
]

export default function SettingsModule() {
  const [tab, setTab] = useState<SettingsTabKey>('company')
  const loadSettings = useSettingsStore((s) => s.load)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Settings}
        title="Settings"
        description="Company identity, preferences, numbering and document templates"
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as SettingsTabKey)}>
        <div className="w-full overflow-x-auto pb-1">
          <TabsList className="min-w-max">
            {TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key} className="gap-1.5 px-3">
                <t.icon className="h-4 w-4" aria-hidden="true" />
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="company" className="mt-4">
          <CompanyTab />
        </TabsContent>
        <TabsContent value="preferences" className="mt-4">
          <PreferencesTab />
        </TabsContent>
        <TabsContent value="numbering" className="mt-4">
          <NumberingTab />
        </TabsContent>
        <TabsContent value="templates" className="mt-4">
          <TemplatesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
