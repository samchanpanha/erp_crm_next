'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Coffee, Download, ImagePlus, Loader2, QrCode, ScanLine, ShieldCheck, Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/erp/shared/page-header'
import { fetchApi } from '@/components/erp/lib/api'
import { authHeaders } from '@/components/erp/lib/session-token'
import { canView, isSuperAdmin } from '@/lib/permissions'
import type { SessionUser } from '@/lib/auth-store'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Shared types (mirror the /api/coffee/page payloads) — used by the coffee
// module and the top-bar quick-access button.
//
// `khqrUrl` is the STATIC image: one fixed file on the server set by the super
// administrator (never a DB value), served as /coffee/khqr.<ext>?v=<mtime> so
// a plain <img src> works everywhere — including the cookie-blocked iframe.
// ---------------------------------------------------------------------------
export type Currency = 'USD' | 'KHR'

export interface CoffeePageCfg {
  displayName: string
  tagline: string
  currency: Currency
  presetAmounts: string
  khqrUrl: string | null
  khqrName: string | null
  khqrBank: string | null
  updatedAt?: string
}

export interface CoffeeSupportRow {
  id: string
  name: string
  amount: number
  currency: Currency
  message: string | null
  date: string
}

export interface CoffeePayload {
  page: CoffeePageCfg
  supporters: CoffeeSupportRow[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024
export const SYMBOL: Record<Currency, string> = { USD: '$', KHR: '៛' }

export function money(n: number, currency: Currency): string {
  if (currency === 'KHR') {
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n)} KHR`
  }
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export function parsePresets(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => Number.parseFloat(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 8)
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

export function khqrFileExtension(url: string): string {
  const m = /\.(\w+)(?:\?|$)/.exec(url)?.[1]?.toLowerCase()
  if (m === 'jpeg') return 'jpg'
  return m === 'png' || m === 'jpg' || m === 'webp' ? m : 'png'
}

/** Download a served (static) file via fetch→blob so it also works in iframes. */
export async function downloadUrl(url: string, filename: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  const blob = await res.blob()
  const objUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objUrl)
}

// ---------------------------------------------------------------------------
// Static-image API helpers.
// Upload/remove go to /api/coffee/static-image (super-administrator only).
// FormData goes through plain fetch + authHeaders — the browser must set the
// multipart Content-Type itself (same pattern as the importer).
// ---------------------------------------------------------------------------
export async function uploadStaticKhqr(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/coffee/static-image', {
    method: 'POST',
    body: form,
    headers: authHeaders(),
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string; data?: { khqrUrl?: string } }
  if (!res.ok || !json.data?.khqrUrl) {
    throw new Error(json.error ?? `Upload failed (${res.status})`)
  }
  return json.data.khqrUrl
}

export async function removeStaticKhqr(): Promise<void> {
  const res = await fetch('/api/coffee/static-image', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(json.error ?? `Remove failed (${res.status})`)
}

export const scrollbarCls =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 hover:[&::-webkit-scrollbar-thumb]:bg-zinc-400'

// ---------------------------------------------------------------------------
// API helpers — single client (fetchApi) so the Bearer session always rides
// along, even inside the cookie-blocked preview iframe.
// ---------------------------------------------------------------------------
export function fetchCoffeePage(): Promise<CoffeePayload> {
  return fetchApi<CoffeePayload>('/api/coffee/page')
}

export async function putCoffeePage(patch: Record<string, unknown>): Promise<CoffeePageCfg> {
  const res = await fetchApi<{ page: CoffeePageCfg }>('/api/coffee/page', {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
  return res.page
}

// ---------------------------------------------------------------------------
// Shared UI atoms
// ---------------------------------------------------------------------------
export function KhqrPanel({ src, alt, size = 'md' }: { src: string; alt: string; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'sm' ? 'h-40 w-40' : size === 'lg' ? 'h-56 w-56' : 'h-44 w-44'
  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm">
      <img src={src} alt={alt} className={cn(dim, 'object-contain')} />
    </div>
  )
}

export function ScanSteps() {
  return (
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
  )
}

// ---------------------------------------------------------------------------
// Top-bar "Buy me a coffee" quick access — sits right next to Quick create.
//
// Everyone with coffee.view can open it to scan the STATIC KHQR image (the
// only image ever shown is the one fixed file the super administrator set).
// The super administrator can additionally upload / replace / remove that
// static file right inside the dialog — enforced again server-side.
// ---------------------------------------------------------------------------
function goCoffeePage() {
  window.location.hash = '#/coffee'
}

export function CoffeeQuickButton({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const queryClient = useQueryClient()

  const mayUpload = isSuperAdmin(user.permissions)
  const maySee = canView(user.permissions, 'coffee')
  const q = useQuery({ queryKey: ['coffee'], queryFn: fetchCoffeePage, enabled: open })
  const page = q.data?.page

  if (!maySee) return null

  function setPageKhqr(khqrUrl: string | null) {
    queryClient.setQueryData<CoffeePayload>(['coffee'], (old) =>
      old ? { ...old, page: { ...old.page, khqrUrl } } : old,
    )
  }

  async function handleFile(file: File) {
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
      const khqrUrl = await uploadStaticKhqr(file)
      setPageKhqr(khqrUrl)
      toast.success('Static KHQR image saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not upload that image')
    } finally {
      setUploading(false)
    }
  }

  async function handleRemove() {
    setUploading(true)
    try {
      await removeStaticKhqr()
      setPageKhqr(null)
      toast.success('KHQR image removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the image')
    } finally {
      setUploading(false)
    }
  }

  async function handleDownload() {
    if (!page?.khqrUrl) return
    try {
      await downloadUrl(page.khqrUrl, `khqr-${page.khqrName ? page.khqrName.toLowerCase().replace(/\s+/g, '-') : 'code'}.${khqrFileExtension(page.khqrUrl)}`)
    } catch {
      toast.error('Could not download the image')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        className="h-9 gap-1.5 border-amber-600/40 text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Coffee className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">Buy me a coffee</span>
      </Button>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coffee className="h-5 w-5 text-amber-600" aria-hidden="true" />
            {page?.displayName ?? 'Buy me a coffee'}
          </DialogTitle>
          <DialogDescription>
            {page?.tagline ?? 'Scan the KHQR code with any supported banking app to send a coffee.'}
          </DialogDescription>
        </DialogHeader>

        {q.isLoading && (
          <div className="flex flex-col items-center gap-3 py-8" role="status" aria-live="polite">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">Loading the coffee page…</p>
          </div>
        )}

        {q.isError && (
          <div className="space-y-3 py-4 text-center">
            <p className="text-sm text-destructive">{(q.error as Error).message}</p>
            <Button variant="outline" size="sm" onClick={() => void q.refetch()}>Retry</Button>
          </div>
        )}

        {q.isSuccess && page && (
          <div className="flex flex-col items-center gap-4">
            {page.khqrUrl ? (
              <>
                <KhqrPanel
                  src={page.khqrUrl}
                  alt={`KHQR payment QR code for ${page.khqrName ?? page.displayName}`}
                  size="lg"
                />
                {(page.khqrName || page.khqrBank) && (
                  <p className="text-center text-sm text-muted-foreground">
                    {[page.khqrName, page.khqrBank].filter(Boolean).join(' · ')}
                  </p>
                )}
                <ScanSteps />
                <div className="flex w-full flex-col gap-2 border-t pt-3 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => void handleDownload()}
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download QR
                  </Button>
                  <Button type="button" size="sm" className="gap-2 bg-amber-600 text-white hover:bg-amber-700" onClick={() => { setOpen(false); goCoffeePage() }}>
                    <Coffee className="h-4 w-4" aria-hidden="true" />
                    Open coffee page
                  </Button>
                </div>
              </>
            ) : (
              <EmptyState
                icon={QrCode}
                title="No KHQR image yet"
                description={
                  mayUpload
                    ? 'Upload your KHQR payment image — it is saved as the one static image shown here and on the coffee page.'
                    : 'Only the super administrator can upload the KHQR image. Please ask them to add it.'
                }
              />
            )}

            {mayUpload && (
              <div className="flex w-full flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                  Super administrator only — you are the only one who can change this image.
                </p>
                <div className="flex shrink-0 gap-2">
                  <label className="block">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      aria-label={page.khqrUrl ? 'Replace KHQR image' : 'Upload KHQR image'}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        e.target.value = ''
                        if (file) void handleFile(file)
                      }}
                    />
                    <span
                      className={cn(
                        'flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-amber-600 px-3 text-xs font-medium text-white transition-colors hover:bg-amber-700',
                        (uploading || q.isFetching) && 'pointer-events-none opacity-70',
                      )}
                      aria-busy={uploading}
                    >
                      {uploading
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        : <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" />}
                      {uploading ? 'Uploading…' : page.khqrUrl ? 'Replace image' : 'Upload image'}
                    </span>
                  </label>
                  {page.khqrUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={uploading}
                      onClick={() => void handleRemove()}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Remove
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
