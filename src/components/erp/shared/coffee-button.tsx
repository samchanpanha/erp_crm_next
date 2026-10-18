'use client'

/**
 * "Buy me a coffee" — top-bar quick access beside Quick create.
 *
 * Opens a dialog that loads the app's KHQR payment image (a MANUAL image URL
 * set by the super administrator — no upload) and explains how to scan it.
 * Only the super administrator ("*" wildcard) can set/remove the URL; everyone
 * else sees the QR and the scan instructions.
 */

import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Coffee, Download, Link2, Loader2, QrCode, ScanLine, ShieldCheck, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { SessionUser } from '@/lib/auth-store'
import { isSuperAdmin } from '@/lib/permissions'
import { fetchApi } from '@/components/erp/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'

interface KhqrInfo {
  khqrUrl: string | null
}

function fetchKhqr(): Promise<KhqrInfo> {
  return fetchApi<KhqrInfo>('/api/coffee/image-url')
}

function saveKhqrUrl(url: string | null): Promise<KhqrInfo> {
  return fetchApi<KhqrInfo>('/api/coffee/image-url', {
    method: 'PUT',
    body: JSON.stringify({ url }),
  })
}

/** fetch → blob anchor: works inside the cross-site preview iframe for same-origin images. */
async function downloadKhqr(url: string) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    const ext = (url.split('?')[0].split('.').pop() ?? 'png').slice(0, 5)
    a.download = `khqr-buy-me-a-coffee.${ext}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  } catch {
    toast.error('Could not download the image (cross-origin URLs may block downloads)')
  }
}

const SCAN_STEPS = [
  {
    icon: QrCode,
    title: 'Open your banking app',
    text: 'Any KHQR-supported app works — Bakong, ACLEDA, ABA, Wing…',
  },
  {
    icon: ScanLine,
    title: 'Scan the QR code',
    text: 'Point your camera at the code and the payment opens instantly.',
  },
  {
    icon: Coffee,
    title: 'Confirm the payment',
    text: 'That is it — thank you for keeping the coffee brewing!',
  },
] as const

export function CoffeeQuickButton({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const urlRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const mayManage = isSuperAdmin(user.permissions)

  const q = useQuery({ queryKey: ['coffee-khqr'], queryFn: fetchKhqr, enabled: open })
  const khqrUrl = q.data?.khqrUrl ?? null

  async function handleSave() {
    setSaving(true)
    try {
      const url = urlRef.current?.value.trim() || null
      const data = await saveKhqrUrl(url)
      queryClient.setQueryData<KhqrInfo>(['coffee-khqr'], data)
      toast.success(url ? 'KHQR image URL saved' : 'KHQR image URL removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save the KHQR image URL')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Buy me a coffee"
          className="h-9 gap-1.5 border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 hover:text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 dark:hover:bg-amber-500/20 dark:hover:text-amber-300"
        >
          <Coffee className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Buy me a coffee</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/15">
              <Coffee className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            </span>
            Buy me a coffee
          </DialogTitle>
          <DialogDescription>
            ERP &amp; CRM is free and open source. If it helped you, a coffee keeps the next free tool brewing.
          </DialogDescription>
        </DialogHeader>

        {q.isLoading ? (
          <div className="flex h-44 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading KHQR code…
          </div>
        ) : q.isError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-center text-sm text-destructive" role="alert">
            Failed to load the KHQR code. Please close and reopen this dialog.
          </div>
        ) : khqrUrl ? (
          <div className="space-y-5">
            {/* QR panel */}
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-xl border bg-white p-3 shadow-sm">
                <img
                  src={khqrUrl}
                  alt="KHQR payment QR code — scan to buy me a coffee"
                  className="h-44 w-44 object-contain"
                  onError={(e) => { e.currentTarget.style.opacity = '0.25' }}
                  onLoad={(e) => { e.currentTarget.style.opacity = '1' }}
                />
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => downloadKhqr(khqrUrl)}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download QR
              </Button>
            </div>

            {/* How to scan */}
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                How to send a coffee
              </p>
              <ol className="space-y-3">
                {SCAN_STEPS.map((step, i) => (
                  <li key={step.title} className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                      <step.icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">
                        {i + 1}. {step.title}
                      </p>
                      <p className="text-xs text-muted-foreground">{step.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        ) : (
          /* Empty state — no image URL set yet */
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-500/15">
              <Coffee className="h-6 w-6 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            </span>
            <p className="text-sm font-medium">No KHQR image yet</p>
            <p className="max-w-[300px] text-xs text-muted-foreground">
              {mayManage
                ? 'Paste your KHQR payment image URL below — it will appear here for everyone to scan.'
                : 'The payment code will appear here once the super administrator adds it.'}
            </p>
          </div>
        )}

        {/* Super-admin URL management */}
        {mayManage && (
          <div className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                Image URL
              </p>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Super admin
              </span>
            </div>
            <div className="flex gap-2">
              {/* key remounts the input when the stored URL changes, keeping defaultValue in sync */}
              <Input
                key={khqrUrl ?? 'none'}
                ref={urlRef}
                defaultValue={khqrUrl ?? ''}
                placeholder="https://example.com/khqr.png"
                inputMode="url"
                aria-label="KHQR image URL"
                className="h-9 flex-1"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleSave()
                  }
                }}
              />
              <Button size="sm" className="h-9" disabled={saving} onClick={() => void handleSave()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : 'Save'}
              </Button>
              {khqrUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-destructive hover:text-destructive"
                  disabled={saving}
                  aria-label="Remove KHQR image URL"
                  onClick={() => {
                    if (urlRef.current) urlRef.current.value = ''
                    void handleSave()
                  }}
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Paste a direct image URL (https://…) or a path to a file dropped into /public (e.g. /khqr.png).
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
