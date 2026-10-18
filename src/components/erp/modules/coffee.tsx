'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  CalendarDays, Coffee, Coins, Download, HeartHandshake, ImagePlus, Loader2,
  Pencil, Plus, QrCode, ScanLine, Trash2, Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader, EmptyState } from '@/components/erp/shared/page-header'
import { fetchApi as api } from '@/components/erp/lib/api'
import { canEdit } from '@/lib/permissions'
import { useAuthStore } from '@/lib/auth-store'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types (mirror API payloads)
// ---------------------------------------------------------------------------
type Currency = 'USD' | 'KHR'

interface CoffeePageCfg {
  displayName: string
  tagline: string
  currency: Currency
  presetAmounts: string
  khqrImage: string | null
  khqrName: string | null
  khqrBank: string | null
  updatedAt?: string
}

interface CoffeeSupportRow {
  id: string
  name: string
  amount: number
  currency: Currency
  message: string | null
  date: string
}

interface CoffeePayload {
  page: CoffeePageCfg
  supporters: CoffeeSupportRow[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MAX_IMAGE_BYTES = 2 * 1024 * 1024
const SYMBOL: Record<Currency, string> = { USD: '$', KHR: '៛' }

function money(n: number, currency: Currency): string {
  if (currency === 'KHR') {
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)} KHR`
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function parsePresets(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => Number.parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 8)
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

function khqrFileExtension(dataUrl: string): string {
  const mime = /^data:image\/(\w+)[;,]/.exec(dataUrl)?.[1] ?? 'png'
  return mime === 'jpeg' ? 'jpg' : mime === 'svg+xml' ? 'svg' : mime
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

const scrollbarCls =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 hover:[&::-webkit-scrollbar-thumb]:bg-zinc-400'

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
export default function CoffeeModule() {
  const user = useAuthStore((s) => s.user)
  const mayEdit = user ? canEdit(user.permissions, 'coffee') : false
  const [tab, setTab] = useState('page')
  const queryClient = useQueryClient()

  const q = useQuery({ queryKey: ['coffee'], queryFn: () => api<CoffeePayload>('/api/coffee/page') })

  // Shared config saver — writes the page config and refreshes the cache.
  const [savingPage, setSavingPage] = useState(false)
  async function savePage(patch: Record<string, unknown>, successMsg: string): Promise<boolean> {
    setSavingPage(true)
    try {
      const res = await api<{ page: CoffeePageCfg }>('/api/coffee/page', {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      queryClient.setQueryData<CoffeePayload>(['coffee'], (old) =>
        old ? { ...old, page: res.page } : old,
      )
      toast.success(successMsg)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save the coffee page')
      return false
    } finally {
      setSavingPage(false)
    }
  }

  // KHQR image upload / removal — saved immediately (server config is the base).
  const [uploading, setUploading] = useState(false)
  async function handleImageFile(file: File) {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error('Only PNG, JPG or WebP images are supported.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error('Image is too large — the maximum size is 2 MB.')
      return
    }
    setUploading(true)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      await savePage({ khqrImage: dataUrl }, 'KHQR image uploaded')
    } catch {
      toast.error('Could not read that file — please try another image.')
    } finally {
      setUploading(false)
    }
  }
  async function removeImage() {
    setUploading(true)
    try {
      await savePage({ khqrImage: null }, 'KHQR image removed')
    } finally {
      setUploading(false)
    }
  }

  // Support log mutations
  const [deletingId, setDeletingId] = useState<string | null>(null)
  async function deleteSupport(id: string) {
    setDeletingId(id)
    try {
      await api(`/api/coffee/supports/${id}`, { method: 'DELETE' })
      toast.success('Support entry removed')
      await queryClient.invalidateQueries({ queryKey: ['coffee'] })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete the support entry')
    } finally {
      setDeletingId(null)
    }
  }
  async function addSupport(body: {
    name: string
    amount: number
    currency: Currency
    message: string | null
    date: string
  }): Promise<boolean> {
    try {
      await api('/api/coffee/supports', { method: 'POST', body: JSON.stringify(body) })
      toast.success('Support recorded — it now shows on your page')
      await queryClient.invalidateQueries({ queryKey: ['coffee'] })
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record the support')
      return false
    }
  }

  const page = q.data?.page
  const supporters = q.data?.supporters ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Buy Me a Coffee"
        description="A friendly supporter page with your KHQR payment QR — scan to send a coffee."
        icon={Coffee}
        actions={
          page ? (
            page.khqrImage ? (
              <Badge variant="outline" className="gap-1.5 border-emerald-600/30 text-emerald-700 dark:text-emerald-400">
                <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                KHQR ready
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1.5 border-amber-600/40 text-amber-700 dark:text-amber-400">
                <QrCode className="h-3.5 w-3.5" aria-hidden="true" />
                QR not set yet
              </Badge>
            )
          ) : undefined
        }
      />

      {q.isLoading && (
        <div className="space-y-4">
          <Skeleton className="h-64 w-full rounded-xl" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-40 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </div>
        </div>
      )}

      {q.isError && (
        <Alert variant="destructive">
          <Coffee className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Failed to load the coffee page</AlertTitle>
          <AlertDescription>{(q.error as Error).message}</AlertDescription>
          <Button variant="outline" size="sm" className="mt-3 w-fit" onClick={() => void q.refetch()}>
            Retry
          </Button>
        </Alert>
      )}

      {q.isSuccess && page && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="page" className="gap-1.5">
              <Coffee className="h-4 w-4" aria-hidden="true" />
              Coffee page
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-1.5">
              <ImagePlus className="h-4 w-4" aria-hidden="true" />
              Settings
            </TabsTrigger>
            <TabsTrigger value="log" className="gap-1.5">
              <HeartHandshake className="h-4 w-4" aria-hidden="true" />
              Support log
            </TabsTrigger>
          </TabsList>

          <TabsContent value="page" className="mt-4">
            <CoffeePageView
              key={page.updatedAt ?? 'default'}
              page={page}
              supporters={supporters}
              mayEdit={mayEdit}
              onGoSettings={() => setTab('settings')}
            />
          </TabsContent>

          <TabsContent value="settings" className="mt-4">
            <CoffeeSettingsTab
              key={page.updatedAt ?? 'default'}
              page={page}
              savingPage={savingPage}
              uploading={uploading}
              mayEdit={mayEdit}
              onImageFile={(f) => void handleImageFile(f)}
              onRemoveImage={() => void removeImage()}
              onSavePatch={(patch, msg) => savePage(patch, msg)}
            />
          </TabsContent>

          <TabsContent value="log" className="mt-4">
            <SupportLogTab
              page={page}
              supporters={supporters}
              mayEdit={mayEdit}
              onAdd={addSupport}
              onDelete={deleteSupport}
              deletingId={deletingId}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Coffee page tab — the supporter-facing view
// ---------------------------------------------------------------------------
function CoffeePageView({
  page, supporters, mayEdit, onGoSettings,
}: {
  page: CoffeePageCfg
  supporters: CoffeeSupportRow[]
  mayEdit: boolean
  onGoSettings: () => void
}) {
  const presets = parsePresets(page.presetAmounts)
  const [selected, setSelected] = useState<number | null>(presets[0] ?? null)
  const [custom, setCustom] = useState('')
  const [payOpen, setPayOpen] = useState(false)

  const customNum = custom.trim() === '' ? NaN : Number(custom)
  const payAmount = Number.isFinite(customNum) && customNum > 0 ? customNum : selected
  const total = supporters
    .filter((s) => s.currency === page.currency)
    .reduce((sum, s) => sum + s.amount, 0)
  const otherCurrencyCount = supporters.filter((s) => s.currency !== page.currency).length

  return (
    <div className="space-y-6">
      {/* Hero */}
      <Card className="overflow-hidden border-amber-600/20">
        <div className="bg-gradient-to-br from-amber-500/15 via-orange-500/10 to-transparent px-6 py-10 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-700 dark:text-amber-400 shadow-inner">
            <Coffee className="h-8 w-8" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">{page.displayName}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">{page.tagline}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Badge variant="outline" className="gap-1.5 bg-background/70">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {supporters.length} {supporters.length === 1 ? 'supporter' : 'supporters'}
            </Badge>
            <Badge variant="outline" className="gap-1.5 bg-background/70">
              <Coins className="h-3.5 w-3.5" aria-hidden="true" />
              {money(total, page.currency)} raised
            </Badge>
            {otherCurrencyCount > 0 && (
              <Badge variant="outline" className="bg-background/70">
                + {otherCurrencyCount} in other currencies
              </Badge>
            )}
          </div>
        </div>

        <CardContent className="flex flex-col items-center gap-4 pt-6">
          {presets.length > 0 && (
            <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Preset amounts">
              {presets.map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant={selected === n ? 'default' : 'outline'}
                  aria-pressed={selected === n}
                  onClick={() => { setSelected(n); setCustom('') }}
                  className={cn(
                    'min-h-11 gap-1.5',
                    selected === n ? 'bg-amber-600 hover:bg-amber-700' : 'hover:border-amber-600/40',
                  )}
                >
                  <Coffee className="h-4 w-4" aria-hidden="true" />
                  {money(n, page.currency)}
                </Button>
              ))}
            </div>
          )}

          <div className="flex flex-col items-center gap-3 sm:flex-row">
            <div className="relative w-44">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">
                {SYMBOL[page.currency]}
              </span>
              <Input
                type="number"
                min="0"
                step="any"
                placeholder="Custom amount"
                aria-label={`Custom amount in ${page.currency}`}
                className="min-h-11 pl-8"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            </div>
            <Button
              type="button"
              disabled={!payAmount || payAmount <= 0}
              onClick={() => setPayOpen(true)}
              className="min-h-11 gap-2 bg-amber-600 text-white hover:bg-amber-700"
            >
              <Coffee className="h-4 w-4" aria-hidden="true" />
              Buy me a coffee{payAmount ? ` · ${money(payAmount, page.currency)}` : ''}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Payments run through KHQR — scan with any supported banking app.</p>
        </CardContent>
      </Card>

      {/* KHQR card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <QrCode className="h-4 w-4 text-amber-600" aria-hidden="true" />
            KHQR payment
          </CardTitle>
          <CardDescription>Scan with any KHQR-supported app (Bakong, ACLEDA, ABA, Wing…)</CardDescription>
        </CardHeader>
        <CardContent>
          {page.khqrImage ? (
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              <div className="rounded-xl border bg-white p-3 shadow-sm">
                { }
                <img
                  src={page.khqrImage}
                  alt={`KHQR payment QR code for ${page.khqrName ?? page.displayName}`}
                  className="h-40 w-40 object-contain"
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 text-center sm:text-left">
                {page.khqrName && (
                  <p className="text-sm"><span className="font-medium">Account:</span> {page.khqrName}</p>
                )}
                {page.khqrBank && (
                  <p className="text-sm"><span className="font-medium">Bank:</span> {page.khqrBank}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  KHQR is Cambodia&apos;s unified QR standard — one code works across all participating banks.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 gap-2"
                  onClick={() => downloadDataUrl(page.khqrImage!, `khqr-${page.khqrName ? page.khqrName.toLowerCase().replace(/\s+/g, '-') : 'code'}.${khqrFileExtension(page.khqrImage!)}`)}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                  Download QR
                </Button>
              </div>
            </div>
          ) : (
            <EmptyState
              icon={QrCode}
              title="No KHQR code uploaded yet"
              description={
                mayEdit
                  ? 'Upload your KHQR payment image in Settings and it will appear here for supporters to scan.'
                  : 'The page owner has not uploaded a KHQR payment image yet.'
              }
              actionLabel={mayEdit ? 'Open Settings' : undefined}
              onAction={mayEdit ? onGoSettings : undefined}
            />
          )}
        </CardContent>
      </Card>

      {/* Supporters wall */}
      {supporters.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HeartHandshake className="h-4 w-4 text-amber-600" aria-hidden="true" />
              Recent supporters
            </CardTitle>
            <CardDescription>Thank you to everyone who bought a coffee</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {supporters.slice(0, 12).map((s) => (
              <div key={s.id} className="flex items-start gap-3 rounded-lg border p-3">
                <Avatar className="h-9 w-9 shrink-0">
                  <AvatarFallback className="bg-amber-500/15 text-amber-700 text-xs font-semibold dark:text-amber-400">
                    {initials(s.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    <Badge variant="outline" className="shrink-0 border-amber-600/30 text-amber-700 dark:text-amber-400">
                      {money(s.amount, s.currency)}
                    </Badge>
                  </div>
                  {s.message && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.message}</p>}
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <CalendarDays className="h-3 w-3" aria-hidden="true" />
                    {format(new Date(s.date), 'MMM d, yyyy')}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Pay dialog */}
      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Coffee className="h-5 w-5 text-amber-600" aria-hidden="true" />
              Buy me a coffee{payAmount ? ` · ${money(payAmount, page.currency)}` : ''}
            </DialogTitle>
            <DialogDescription>
              Scan this KHQR code with your banking app to send {payAmount ? money(payAmount, page.currency) : 'your support'}.
            </DialogDescription>
          </DialogHeader>

          {page.khqrImage ? (
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-xl border bg-white p-3 shadow-sm">
                { }
                <img
                  src={page.khqrImage}
                  alt={`KHQR payment QR code for ${page.khqrName ?? page.displayName}`}
                  className="h-56 w-56 object-contain"
                />
              </div>
              {(page.khqrName || page.khqrBank) && (
                <p className="text-center text-sm text-muted-foreground">
                  {[page.khqrName, page.khqrBank].filter(Boolean).join(' · ')}
                </p>
              )}
              <ol className="w-full space-y-2 text-sm">
                <li className="flex items-center gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-bold text-amber-700 dark:text-amber-400">1</span>
                  Open any KHQR-supported banking app
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-bold text-amber-700 dark:text-amber-400">2</span>
                  <span className="flex items-center gap-1.5"><ScanLine className="h-4 w-4 text-amber-600" aria-hidden="true" /> Scan the QR code</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-xs font-bold text-amber-700 dark:text-amber-400">3</span>
                  Confirm the payment — thank you for the coffee!
                </li>
              </ol>
            </div>
          ) : (
            <EmptyState
              icon={QrCode}
              title="No KHQR code yet"
              description={
                mayEdit
                  ? 'Upload your KHQR payment image in Settings first.'
                  : 'The page owner has not uploaded a KHQR payment image yet.'
              }
              actionLabel={mayEdit ? 'Open Settings' : undefined}
              onAction={mayEdit ? () => { setPayOpen(false); onGoSettings() } : undefined}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Settings tab — KHQR upload + page details
// ---------------------------------------------------------------------------
function CoffeeSettingsTab({
  page, savingPage, uploading, mayEdit, onImageFile, onRemoveImage, onSavePatch,
}: {
  page: CoffeePageCfg
  savingPage: boolean
  uploading: boolean
  mayEdit: boolean
  onImageFile: (file: File) => void
  onRemoveImage: () => void
  onSavePatch: (patch: Record<string, unknown>, successMsg: string) => Promise<boolean>
}) {
  const [displayName, setDisplayName] = useState(page.displayName)
  const [tagline, setTagline] = useState(page.tagline)
  const [currency, setCurrency] = useState<Currency>(page.currency)
  const [presetsInput, setPresetsInput] = useState(page.presetAmounts)
  const [khqrName, setKhqrName] = useState(page.khqrName ?? '')
  const [khqrBank, setKhqrBank] = useState(page.khqrBank ?? '')

  async function handleSave() {
    const name = displayName.trim()
    if (!name) { toast.error('Display name is required'); return }
    if (tagline.trim().length > 200) { toast.error('Keep the tagline under 200 characters'); return }

    const parts = presetsInput.split(',').map((p) => p.trim()).filter(Boolean)
    if (parts.length === 0) { toast.error('Add at least one preset amount, e.g. 1,3,5,10'); return }
    if (parts.length > 8) { toast.error('Use at most 8 preset amounts'); return }
    for (const p of parts) {
      const n = Number(p)
      if (!Number.isFinite(n) || n <= 0) { toast.error(`"${p}" is not a valid amount`); return }
    }

    const ok = await onSavePatch(
      {
        displayName: name,
        tagline: tagline.trim(),
        currency,
        presetAmounts: parts.join(','),
        khqrName: khqrName.trim() || null,
        khqrBank: khqrBank.trim() || null,
      },
      'Coffee page saved',
    )
    if (ok) setPresetsInput(parts.join(','))
  }

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* KHQR image */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <QrCode className="h-4 w-4 text-amber-600" aria-hidden="true" />
            KHQR payment QR
          </CardTitle>
          <CardDescription>Your personal QR image from any Cambodian banking app.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-center">
            {page.khqrImage ? (
              <div className="rounded-xl border bg-white p-3 shadow-sm">
                { }
                <img
                  src={page.khqrImage}
                  alt="Current KHQR payment QR code"
                  className="h-44 w-44 object-contain"
                />
              </div>
            ) : (
              <div className="flex h-44 w-44 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center text-muted-foreground">
                <QrCode className="h-8 w-8" aria-hidden="true" />
                <p className="px-4 text-xs">No QR image yet</p>
              </div>
            )}
          </div>

          {mayEdit && (
            <>
              <label className="block">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  aria-label="Upload KHQR image"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) onImageFile(file)
                  }}
                />
                <span
                  className={cn(
                    'flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md bg-amber-600 px-4 text-sm font-medium text-white transition-colors hover:bg-amber-700',
                    uploading && 'pointer-events-none opacity-70',
                  )}
                  aria-busy={uploading}
                >
                  {uploading
                    ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                  {uploading ? 'Uploading…' : page.khqrImage ? 'Replace image' : 'Upload KHQR image'}
                </span>
              </label>
              {page.khqrImage && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full min-h-11 border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={uploading}
                  onClick={onRemoveImage}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  Remove image
                </Button>
              )}
            </>
          )}
          <p className="text-xs text-muted-foreground">
            PNG, JPG or WebP · up to 2 MB · square images work best. Changes are saved immediately.
          </p>
        </CardContent>
      </Card>

      {/* Page details */}
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Pencil className="h-4 w-4 text-amber-600" aria-hidden="true" />
            Page details
          </CardTitle>
          <CardDescription>These details appear on your public coffee page.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="coffee-name">Display name</Label>
              <Input
                id="coffee-name"
                value={displayName}
                maxLength={80}
                disabled={!mayEdit}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Buy me a coffee"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coffee-currency">Currency</Label>
              <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)} disabled={!mayEdit}>
                <SelectTrigger id="coffee-currency" className="w-full">
                  <SelectValue placeholder="Choose a currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD — US Dollar</SelectItem>
                  <SelectItem value="KHR">KHR — Cambodian Riel</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="coffee-tagline">Tagline</Label>
            <Textarea
              id="coffee-tagline"
              rows={2}
              maxLength={200}
              value={tagline}
              disabled={!mayEdit}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="A short thank-you message for supporters"
            />
            <p className="text-xs text-muted-foreground">{tagline.length}/200 characters</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="coffee-presets">Preset amounts ({SYMBOL[currency]})</Label>
            <Input
              id="coffee-presets"
              value={presetsInput}
              disabled={!mayEdit}
              onChange={(e) => setPresetsInput(e.target.value)}
              placeholder="1,3,5,10"
              inputMode="decimal"
            />
            <p className="text-xs text-muted-foreground">Comma separated, up to 8 amounts — shown as coffee buttons.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="coffee-khqr-name">KHQR account name</Label>
              <Input
                id="coffee-khqr-name"
                value={khqrName}
                maxLength={80}
                disabled={!mayEdit}
                onChange={(e) => setKhqrName(e.target.value)}
                placeholder="e.g. DARA CHAN"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="coffee-khqr-bank">Bank / app label</Label>
              <Input
                id="coffee-khqr-bank"
                value={khqrBank}
                maxLength={80}
                disabled={!mayEdit}
                onChange={(e) => setKhqrBank(e.target.value)}
                placeholder="e.g. Bakong · ACLEDA"
              />
            </div>
          </div>

          {mayEdit && (
            <div className="flex justify-end border-t pt-4">
              <Button
                type="button"
                onClick={() => void handleSave()}
                disabled={savingPage}
                aria-busy={savingPage}
                className="min-h-11 gap-2 bg-amber-600 text-white hover:bg-amber-700"
              >
                {savingPage
                  ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  : null}
                {savingPage ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Support log tab — record KHQR payments received
// ---------------------------------------------------------------------------
function SupportLogTab({
  page, supporters, mayEdit, onAdd, onDelete, deletingId,
}: {
  page: CoffeePageCfg
  supporters: CoffeeSupportRow[]
  mayEdit: boolean
  onAdd: (body: { name: string; amount: number; currency: Currency; message: string | null; date: string }) => Promise<boolean>
  onDelete: (id: string) => Promise<void>
  deletingId: string | null
}) {
  const [addOpen, setAddOpen] = useState(false)

  const total = supporters
    .filter((s) => s.currency === page.currency)
    .reduce((sum, s) => sum + s.amount, 0)
  const otherCurrencyCount = supporters.filter((s) => s.currency !== page.currency).length
  const latest = supporters[0]

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total raised</p>
            <p className="mt-1 text-2xl font-bold">{money(total, page.currency)}</p>
            {otherCurrencyCount > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">+ {otherCurrencyCount} entries in other currencies</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Supporters</p>
            <p className="mt-1 text-2xl font-bold">{supporters.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Latest support</p>
            <p className="mt-1 text-sm font-semibold">
              {latest
                ? `${latest.name} · ${money(latest.amount, latest.currency)}`
                : '—'}
            </p>
            {latest && (
              <p className="mt-1 text-xs text-muted-foreground">{format(new Date(latest.date), 'MMM d, yyyy')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <HeartHandshake className="h-4 w-4 text-amber-600" aria-hidden="true" />
              Support received
            </CardTitle>
            <CardDescription>
              Record KHQR payments you receive — they power the supporters wall on your page.
            </CardDescription>
          </div>
          {mayEdit && (
            <Button type="button" size="sm" className="min-h-11 gap-1.5 bg-amber-600 text-white hover:bg-amber-700" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Record support</span>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {supporters.length === 0 ? (
            <EmptyState
              icon={HeartHandshake}
              title="No coffee yet"
              description={
                mayEdit
                  ? 'When someone scans your KHQR and sends a coffee, record it here to thank them on your page.'
                  : 'No support has been recorded yet.'
              }
              actionLabel={mayEdit ? 'Record first support' : undefined}
              onAction={mayEdit ? () => setAddOpen(true) : undefined}
            />
          ) : (
            <div className={cn('max-h-[480px] space-y-2 overflow-y-auto pr-1', scrollbarCls)}>
              {supporters.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-lg border p-3">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarFallback className="bg-amber-500/15 text-xs font-semibold text-amber-700 dark:text-amber-400">
                      {initials(s.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.name}</p>
                    {s.message && <p className="line-clamp-2 text-xs text-muted-foreground">{s.message}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold">{money(s.amount, s.currency)}</p>
                    <p className="text-xs text-muted-foreground">{format(new Date(s.date), 'MMM d, yyyy')}</p>
                  </div>
                  {mayEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={deletingId === s.id}
                      aria-busy={deletingId === s.id}
                      aria-label={`Delete support entry from ${s.name}`}
                      onClick={() => void onDelete(s.id)}
                    >
                      {deletingId === s.id
                        ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {addOpen && (
        <AddSupportDialog
          defaultCurrency={page.currency}
          onClose={() => setAddOpen(false)}
          onSubmit={async (body) => {
            const ok = await onAdd(body)
            if (ok) setAddOpen(false)
          }}
        />
      )}
    </div>
  )
}

/** Keyed conditional mount (fresh state per open) — add a support log entry. */
function AddSupportDialog({
  defaultCurrency, onClose, onSubmit,
}: {
  defaultCurrency: Currency
  onClose: () => void
  onSubmit: (body: { name: string; amount: number; currency: Currency; message: string | null; date: string }) => Promise<void>
}) {
  const [name, setName] = useState('Anonymous')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>(defaultCurrency)
  const [message, setMessage] = useState('')
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [saving, setSaving] = useState(false)

  async function handleSubmit() {
    const n = Number(amount)
    if (!name.trim()) { toast.error('Name is required'); return }
    if (!Number.isFinite(n) || n <= 0) { toast.error('Enter an amount greater than zero'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast.error('Pick a valid date'); return }
    setSaving(true)
    try {
      await onSubmit({
        name: name.trim(),
        amount: n,
        currency,
        message: message.trim() || null,
        date,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record support received</DialogTitle>
          <DialogDescription>
            Log a coffee payment you received via KHQR scan.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="support-name">Supporter name</Label>
              <Input
                id="support-name"
                value={name}
                maxLength={60}
                onChange={(e) => setName(e.target.value)}
                placeholder="Anonymous"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="support-date">Date</Label>
              <Input id="support-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="support-amount">Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">
                  {SYMBOL[currency]}
                </span>
                <Input
                  id="support-amount"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  className="pl-8"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="3"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="support-currency">Currency</Label>
              <Select value={currency} onValueChange={(v) => setCurrency(v as Currency)}>
                <SelectTrigger id="support-currency" className="w-full">
                  <SelectValue placeholder="Currency" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD — US Dollar</SelectItem>
                  <SelectItem value="KHR">KHR — Cambodian Riel</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="support-message">Message (optional)</Label>
            <Textarea
              id="support-message"
              rows={2}
              maxLength={200}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="A few kind words from your supporter"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving}
            aria-busy={saving}
            className="gap-2 bg-amber-600 text-white hover:bg-amber-700"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {saving ? 'Saving…' : 'Record support'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
