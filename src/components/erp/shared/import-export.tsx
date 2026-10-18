'use client'

import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, CheckCircle2, Download, FileDown, FileUp, Loader2, Upload,
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
import { parseCsv, stringifyCsv, downloadTextFile, type ParsedCsv } from '@/lib/csv'
import { post } from '@/components/erp/lib/api'
import { useToast } from '@/hooks/use-toast'

// ---------------------------------------------------------------------------
// ImportExportButtons — shared CSV export/import toolbar group.
// Export streams /api/export/[entity]; Import opens a wizard dialog that
// parses the file client-side, previews it, then posts rows to
// /api/import/[entity] (server re-validates everything, dry run supported).
// ---------------------------------------------------------------------------

type Entity = 'third-parties' | 'products'

interface ImportResult {
  imported: number
  updated: number
  skipped: number
  errors: { row: number; message: string }[]
}

const MAX_FILE_BYTES = 400 * 1024 // 400 KB client-side guard
const PREVIEW_ROWS = 5

const CONFIG: Record<Entity, {
  label: string
  keyColumn: string
  headers: string[]
  required: string[]
  templateRows: Record<string, string>[]
}> = {
  'third-parties': {
    label: 'third parties',
    keyColumn: 'code',
    headers: [
      'code', 'name', 'type', 'status', 'email', 'phone', 'website', 'address',
      'zip', 'city', 'country', 'vatNumber', 'currency', 'paymentTerms', 'notes',
    ],
    required: ['name'],
    templateRows: [
      {
        code: '',
        name: 'Globex Corporation',
        type: 'CUSTOMER',
        status: 'ACTIVE',
        email: 'contact@globex.com',
        phone: '+1 555 234 1180',
        website: 'https://globex.com',
        address: '123 Market Street',
        zip: '94105',
        city: 'San Francisco',
        country: 'USA',
        vatNumber: 'US-987654321',
        currency: 'USD',
        paymentTerms: 'NET30',
        notes: 'Key enterprise account',
      },
      {
        code: '',
        name: 'Acme Supplies Ltd.',
        type: 'SUPPLIER',
        status: 'ACTIVE',
        email: 'sales@acmesupplies.co.uk',
        phone: '+44 20 7946 0958',
        website: 'https://acmesupplies.co.uk',
        address: '45 Harbour Lane',
        zip: 'EH6 6QQ',
        city: 'Edinburgh',
        country: 'UK',
        vatNumber: 'GB-123456789',
        currency: 'EUR',
        paymentTerms: 'NET15',
        notes: 'Leave code empty to auto-generate',
      },
    ],
  },
  products: {
    label: 'products & services',
    keyColumn: 'ref',
    headers: [
      'ref', 'label', 'type', 'description', 'unit', 'sellPrice', 'costPrice',
      'vatRate', 'barcode', 'manageStock', 'stockQty', 'minStock', 'status',
    ],
    required: ['label'],
    templateRows: [
      {
        ref: '',
        label: 'Ergonomic Office Chair',
        type: 'PRODUCT',
        description: 'Mesh back, adjustable lumbar support',
        unit: 'unit',
        sellPrice: '249.00',
        costPrice: '140.50',
        vatRate: '20',
        barcode: '9780201379624',
        manageStock: 'yes',
        stockQty: '25',
        minStock: '5',
        status: 'ACTIVE',
      },
      {
        ref: '',
        label: 'Onsite Installation Service',
        type: 'SERVICE',
        description: 'On-site setup by a certified technician (per hour)',
        unit: 'hour',
        sellPrice: '80',
        costPrice: '45',
        vatRate: '20',
        barcode: '',
        manageStock: 'no',
        stockQty: '0',
        minStock: '0',
        status: 'ACTIVE',
      },
    ],
  },
}

export function ImportExportButtons({
  entity,
  queryKeysToInvalidate,
}: {
  entity: Entity
  queryKeysToInvalidate: string[][]
}) {
  const cfg = CONFIG[entity]
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dryRun, setDryRun] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [ranDryRun, setRanDryRun] = useState(false)

  const missingRequired = parsed
    ? cfg.required.filter((h) => !parsed.headers.includes(h))
    : []
  const canImport =
    !!parsed && parsed.rows.length > 0 && missingRequired.length === 0 && !error

  function reset() {
    setFileName('')
    setParsed(null)
    setError(null)
    setDryRun(false)
    setResult(null)
    setRanDryRun(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function downloadTemplate() {
    downloadTextFile(`template-${entity}.csv`, stringifyCsv(cfg.headers, cfg.templateRows))
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    setParsed(null)
    setError(null)
    setResult(null)
    if (!file) {
      setFileName('')
      return
    }
    setFileName(file.name)
    if (file.size > MAX_FILE_BYTES) {
      setError(
        `"${file.name}" is ${Math.round(file.size / 1024)} KB — the limit is 400 KB. Split the file or remove unneeded rows/columns.`,
      )
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      if (!text.trim()) {
        setError('The file appears to be empty.')
        return
      }
      const p = parseCsv(text)
      if (!p.headers.length) {
        setError('Could not detect a CSV header row.')
        return
      }
      setParsed(p)
    }
    reader.onerror = () => setError('Failed to read the file.')
    reader.readAsText(file)
  }

  const importMutation = useMutation({
    mutationFn: (payload: { rows: Record<string, string>[]; dryRun: boolean }) =>
      post<ImportResult>(`/api/import/${entity}`, payload),
    onSuccess: (data) => {
      setResult(data)
      setRanDryRun(dryRun)
      setError(null)
      if (!dryRun) {
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
  const rowCount = parsed?.rows.length ?? 0

  return (
    <div className="flex items-center gap-2">
      {/* Export — plain anchor download of the server-generated CSV */}
      <Button variant="outline" size="sm" asChild className="min-h-11 sm:min-h-9">
        <a href={`/api/export/${entity}`} download aria-label="Export CSV">
          <Download className="h-4 w-4" aria-hidden />
          Export
        </a>
      </Button>

      {/* Import — opens the wizard dialog */}
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 sm:min-h-9"
        onClick={() => setOpen(true)}
        aria-label="Import CSV"
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
            reset()
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import {cfg.label}</DialogTitle>
            <DialogDescription>
              Bulk-create or update {cfg.label} from a CSV file. Rows are matched by{' '}
              <span className="font-medium text-foreground">{cfg.keyColumn}</span> — leave it
              empty to auto-generate one.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
            {/* Step 1 — template */}
            <section className="space-y-1.5" aria-label="Step 1: download template">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">1. Get the template</p>
                <Button variant="outline" size="sm" onClick={downloadTemplate} className="min-h-9">
                  <FileDown className="h-4 w-4" aria-hidden />
                  Download template
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Column headers must match exactly. Numbers accept{' '}
                <code className="rounded bg-muted px-1">1,234.56</code> or{' '}
                <code className="rounded bg-muted px-1">1234.56</code>.
              </p>
            </section>

            {/* Step 2 — file */}
            <section className="space-y-2" aria-label="Step 2: choose a CSV file">
              <p className="text-sm font-medium">2. Choose a CSV file</p>
              <div className="flex items-center gap-2 rounded-lg border border-dashed p-3">
                <FileUp className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={onFileChange}
                  aria-label="CSV file to import"
                  className="cursor-pointer text-sm"
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertTriangle aria-hidden />
                  <AlertTitle>Cannot import</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {parsed && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground" role="status">
                    <span className="font-medium text-foreground">{fileName}</span> —{' '}
                    {rowCount} row{rowCount === 1 ? '' : 's'}, {parsed.headers.length} columns
                    detected
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

                  {parsed.rows.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No data rows found — the file only contains a header.
                    </p>
                  )}

                  {parsed.rows.length > 0 && (
                    <div className="max-h-48 overflow-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="sticky left-0 z-10 bg-background">#</TableHead>
                            {parsed.headers.map((h) => (
                              <TableHead key={h} className="whitespace-nowrap">
                                {h}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {parsed.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
                            <TableRow key={i}>
                              <TableCell className="sticky left-0 z-10 bg-background font-medium text-muted-foreground">
                                {i + 1}
                              </TableCell>
                              {parsed.headers.map((h) => (
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
                  {parsed.rows.length > PREVIEW_ROWS && (
                    <p className="text-xs text-muted-foreground">
                      Showing first {PREVIEW_ROWS} of {rowCount} rows.
                    </p>
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
              disabled={!canImport || pending}
              onClick={() => parsed && importMutation.mutate({ rows: parsed.rows, dryRun })}
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
