'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, CheckCircle2, Download, FileDown, FileSpreadsheet, FileUp, Loader2, Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { IMPORT_CONFIG, type ImportEntity } from '@/lib/import-config'
import { authHeaders } from '@/components/erp/lib/session-token'
import { useToast } from '@/hooks/use-toast'

// ---------------------------------------------------------------------------
// ImportExportButtons — shared Excel export/import toolbar group.
// Export streams /api/export/[entity] (.xlsx). Import opens a wizard dialog:
// picking a file triggers a server-side preview (?mode=preview — parse +
// header check only), then the import posts the file to /api/import/[entity]
// (server re-validates every row, dry run supported).
// ---------------------------------------------------------------------------

interface ImportResult {
  imported: number
  updated: number
  skipped: number
  errors: { row: number; message: string }[]
}

interface PreviewData {
  headers: string[]
  rowCount: number
  rows: Record<string, string>[]
  missingRequired: string[]
  kind: 'xlsx' | 'csv'
}

const PREVIEW_ROWS = 5

/** Fetch an Excel endpoint with the auth header and save it as a file download. */
async function downloadExcel(url: string) {
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(json.error ?? `Export failed (${res.status})`)
  }
  const cd = res.headers.get('content-disposition') ?? ''
  const match = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd)
  const filename = match ? decodeURIComponent(match[1]) : `${url.split('/').pop() ?? 'export'}.xlsx`
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

export function ImportExportButtons({
  entity,
  queryKeysToInvalidate,
}: {
  entity: ImportEntity
  queryKeysToInvalidate: string[][]
}) {
  const cfg = IMPORT_CONFIG[entity]
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dryRun, setDryRun] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [ranDryRun, setRanDryRun] = useState(false)
  const [exporting, setExporting] = useState(false)

  const missingRequired = preview?.missingRequired ?? []
  const canImport =
    !!preview && preview.rowCount > 0 && missingRequired.length === 0 && !error

  function reset() {
    setFile(null)
    setPreview(null)
    setError(null)
    setDryRun(false)
    setResult(null)
    setRanDryRun(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null
    setPreview(null)
    setError(null)
    setResult(null)
    setFile(picked)
  }

  // Parse + validate the chosen file on the server as soon as it is selected.
  const previewMutation = useMutation({
    mutationFn: async (f: File) => {
      const form = new FormData()
      form.append('file', f)
      const res = await fetch(`/api/import/${entity}?mode=preview`, {
        method: 'POST',
        body: form,
        headers: authHeaders(),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((json as { error?: string }).error ?? `Preview failed (${res.status})`)
      return (json as { data: PreviewData }).data
    },
    onSuccess: (data) => {
      setPreview(data)
      setError(null)
    },
    onError: (err: Error) => {
      setPreview(null)
      setError(err.message)
    },
  })

  useEffect(() => {
    if (!file) return
    previewMutation.mutate(file)
  }, [file])

  const importMutation = useMutation({
    mutationFn: async (payload: { f: File; dryRun: boolean }) => {
      const form = new FormData()
      form.append('file', payload.f)
      form.append('dryRun', String(payload.dryRun))
      const res = await fetch(`/api/import/${entity}`, {
        method: 'POST',
        body: form,
        headers: authHeaders(),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((json as { error?: string }).error ?? `Import failed (${res.status})`)
      return (json as { data: ImportResult }).data
    },
    onSuccess: (data, payload) => {
      setResult(data)
      setRanDryRun(payload.dryRun)
      setError(null)
      if (!payload.dryRun) {
        for (const key of queryKeysToInvalidate) {
          void queryClient.invalidateQueries({ queryKey: key })
        }
        toast({
          title: 'Import complete',
          description: `${data.imported} created, ${data.updated} updated${data.skipped ? `, ${data.skipped} skipped` : ''}.`,
        })
      }
    },
    onError: (err: Error) => {
      setError(err.message)
    },
  })

  const pending = importMutation.isPending
  const previewing = previewMutation.isPending
  const rowCount = preview?.rowCount ?? 0

  async function runExport(url: string) {
    setExporting(true)
    try {
      await downloadExcel(url)
    } catch (err) {
      toast({ title: 'Export failed', description: err instanceof Error ? err.message : undefined, variant: 'destructive' })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      {/* Export — authenticated fetch → file download (cookie-safe in iframe preview) */}
      <Button
        variant="outline"
        size="sm"
        disabled={exporting}
        className="min-h-11 sm:min-h-9"
        onClick={() => void runExport(`/api/export/${entity}`)}
        aria-label={`Export ${cfg.label} to Excel`}
      >
        {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
        Export
      </Button>

      {/* Import — opens the wizard dialog */}
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 sm:min-h-9"
        onClick={() => setOpen(true)}
        aria-label={`Import ${cfg.label} from Excel`}
      >
        <Upload className="h-4 w-4" aria-hidden />
        Import
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) {
            importMutation.reset()
            previewMutation.reset()
            reset()
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import {cfg.label}</DialogTitle>
            <DialogDescription>
              Bulk-create or update {cfg.label} from an Excel file (.xlsx) — CSV also works. Rows
              are matched by <span className="font-medium text-foreground">{cfg.keyColumn}</span> —
              leave it empty to auto-generate one.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
            {/* Step 1 — template */}
            <section className="space-y-1.5" aria-label="Step 1: download template">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">1. Get the Excel template</p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting}
                  className="min-h-9"
                  onClick={() => void runExport(`/api/export/${entity}?template=1`)}
                >
                  <FileDown className="h-4 w-4" aria-hidden />
                  Download template (.xlsx)
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Column headers must match exactly. Numbers accept{' '}
                <code className="rounded bg-muted px-1">1,234.56</code> or{' '}
                <code className="rounded bg-muted px-1">1234.56</code>.
              </p>
            </section>

            {/* Step 2 — file */}
            <section className="space-y-2" aria-label="Step 2: choose a spreadsheet file">
              <p className="text-sm font-medium">2. Choose a spreadsheet</p>
              <div className="flex items-center gap-2 rounded-lg border border-dashed p-3">
                <FileUp className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                  onChange={onFileChange}
                  aria-label="Excel or CSV file to import"
                  className="cursor-pointer text-sm"
                />
              </div>

              {file && previewing && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Reading {file.name}…
                </p>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertTriangle aria-hidden />
                  <AlertTitle>Cannot import</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {preview && !previewing && (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground" role="status">
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600" aria-hidden />
                    <span className="font-medium text-foreground">{file?.name}</span> —{' '}
                    {preview.rowCount} row{preview.rowCount === 1 ? '' : 's'},{' '}
                    {preview.headers.length} columns · {preview.kind.toUpperCase()}
                  </p>

                  {missingRequired.length > 0 && (
                    <Alert variant="destructive">
                      <AlertTriangle aria-hidden />
                      <AlertTitle>Missing required column: {missingRequired.join(', ')}</AlertTitle>
                      <AlertDescription>
                        Add the column to your file (see the template) and try again.
                      </AlertDescription>
                    </Alert>
                  )}

                  {preview.rowCount === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No data rows found — the file only contains a header.
                    </p>
                  )}

                  {preview.rows.length > 0 && (
                    <div className="max-h-48 overflow-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="sticky left-0 z-10 bg-background">#</TableHead>
                            {preview.headers.map((h) => (
                              <TableHead key={h} className="whitespace-nowrap">
                                {h}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preview.rows.map((row, i) => (
                            <TableRow key={i}>
                              <TableCell className="sticky left-0 z-10 bg-background font-medium text-muted-foreground">
                                {i + 1}
                              </TableCell>
                              {preview.headers.map((h) => (
                                <TableCell
                                  key={h}
                                  className="max-w-40 truncate whitespace-nowrap text-muted-foreground"
                                  title={row[h]}
                                >
                                  {row[h] || <span className="text-muted-foreground/50">—</span>}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Step 3 — run */}
            <section className="space-y-2" aria-label="Step 3: run the import">
              <p className="text-sm font-medium">3. Run the import</p>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="dry-run-switch">Validate only (dry run)</Label>
                  <p className="text-xs text-muted-foreground">
                    Check every row and report problems without writing anything.
                  </p>
                </div>
                <Switch
                  id="dry-run-switch"
                  checked={dryRun}
                  onCheckedChange={setDryRun}
                  aria-label="Toggle dry run"
                />
              </div>
            </section>

            {/* Results */}
            {result && (
              <section className="space-y-2" aria-label="Import results" aria-live="polite">
                <Alert className="border-emerald-600/40 text-emerald-700 dark:text-emerald-400 [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400">
                  <CheckCircle2 aria-hidden />
                  <AlertTitle>{ranDryRun ? 'Validation finished' : 'Import finished'}</AlertTitle>
                  <AlertDescription>
                    {ranDryRun
                      ? `${result.imported} row${result.imported === 1 ? '' : 's'} would be created, ${result.updated} updated${result.skipped ? `, ${result.skipped} skipped` : ''}.`
                      : `Imported ${result.imported}, updated ${result.updated}${result.skipped ? `, skipped ${result.skipped}` : ''}.`}
                  </AlertDescription>
                </Alert>

                {result.errors.length > 0 ? (
                  <div className="overflow-hidden rounded-md border border-destructive/40">
                    <div className="max-h-40 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-16 text-destructive">Row</TableHead>
                            <TableHead className="text-destructive">Problem</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {result.errors.map((e, i) => (
                            <TableRow key={i}>
                              <TableCell className="font-medium text-destructive">
                                {e.row > 0 ? e.row : '—'}
                              </TableCell>
                              <TableCell className="text-destructive/90">{e.message}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No errors — every row passed validation.
                  </p>
                )}
              </section>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Close
            </Button>
            <Button
              disabled={!canImport || pending || previewing}
              onClick={() => file && importMutation.mutate({ f: file, dryRun })}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="h-4 w-4" aria-hidden />
              )}
              {dryRun ? `Validate ${rowCount} row${rowCount === 1 ? '' : 's'}` : `Import ${rowCount} row${rowCount === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
