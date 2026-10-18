'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  CheckCircle2,
  Eye,
  FileText,
  Loader2,
  Pencil,
  Plus,
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
import { StatusBadge, type Tone } from '@/components/erp/shared/status-badge'
import { StatCard } from '@/components/erp/shared/stat-card'
import { formatDate, formatDateTime, relativeDays } from '@/components/erp/shared/format'
import { get, post, put, del } from '@/components/erp/lib/api'
import { useToast } from '@/hooks/use-toast'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Types (mirror API payloads)
// ---------------------------------------------------------------------------
type KbStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

interface KnowledgeRow {
  id: string
  title: string
  category: string
  content: string
  status: KbStatus
  views: number
  createdAt: string
  updatedAt: string
}

const STATUSES: KbStatus[] = ['DRAFT', 'PUBLISHED', 'ARCHIVED']

const STATUS_LABEL: Record<KbStatus, string> = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  ARCHIVED: 'Archived',
}

const STATUS_TONE: Record<KbStatus, Tone> = {
  DRAFT: 'muted',
  PUBLISHED: 'success',
  ARCHIVED: 'muted',
}

/** Free-text category, with these suggestions offered via datalist */
const CATEGORY_SUGGESTIONS = ['General', 'Sales', 'Inventory', 'Finance', 'HR', 'IT']

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

const scrollbarCls =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 hover:[&::-webkit-scrollbar-thumb]:bg-zinc-400'

const emptyForm = {
  title: '',
  category: 'General',
  content: '',
  status: 'DRAFT' as KbStatus,
}

type KbFormState = typeof emptyForm

// ---------------------------------------------------------------------------
// Read dialog — opening it hits GET /api/knowledge/:id which increments views
// ---------------------------------------------------------------------------
function KnowledgeReadDialog({
  articleId,
  open,
  onOpenChange,
}: {
  articleId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const readQuery = useQuery({
    queryKey: ['knowledge-article', articleId],
    queryFn: () => get<KnowledgeRow>(`/api/knowledge/${articleId as string}`),
    enabled: open && articleId !== null,
  })

  const article = readQuery.data

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-2xl">
        {readQuery.isError && (
          <p className="text-sm text-destructive">
            Failed to load article: {readQuery.error.message}
          </p>
        )}
        {!article ? (
          <div className="space-y-3 py-4" aria-busy="true">
            <DialogTitle className="sr-only">Article (loading)</DialogTitle>
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : (
          <>
            <DialogHeader>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={article.category} tone="neutral" />
                <StatusBadge status={article.status} tone={STATUS_TONE[article.status]} label={STATUS_LABEL[article.status]} />
              </div>
              <DialogTitle className="text-left text-base sm:text-lg">{article.title}</DialogTitle>
              <DialogDescription className="text-left">
                {formatNumber(article.views)} views · Updated {formatDateTime(article.updatedAt)}
              </DialogDescription>
            </DialogHeader>
            <div className="rounded-lg bg-muted/50 p-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{article.content}</p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
export default function KnowledgeModule() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<KnowledgeRow | null>(null)
  const [form, setForm] = useState<KbFormState>(emptyForm)
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeRow | null>(null)

  const [readId, setReadId] = useState<string | null>(null)
  const [readOpen, setReadOpen] = useState(false)

  const listQuery = useQuery({
    queryKey: ['knowledge'],
    queryFn: () => get<KnowledgeRow[]>('/api/knowledge'),
  })

  const data = listQuery.data ?? []

  const stats = useMemo(
    () => ({
      published: data.filter((a) => a.status === 'PUBLISHED').length,
      drafts: data.filter((a) => a.status === 'DRAFT').length,
      views: data.reduce((s, a) => s + a.views, 0),
    }),
    [data],
  )

  const categories = useMemo(
    () => Array.from(new Set(data.map((a) => a.category))).sort((a, b) => a.localeCompare(b)),
    [data],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter((a) => {
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false
      if (categoryFilter !== 'ALL' && a.category !== categoryFilter) return false
      if (!q) return true
      return [a.title, a.content, a.category].some((v) => v.toLowerCase().includes(q))
    })
  }, [data, search, statusFilter, categoryFilter])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['knowledge'] })
  }

  const closeRead = (open: boolean) => {
    setReadOpen(open)
    if (!open) invalidate() // refresh the views counter in the list
  }

  // ---- mutations ----------------------------------------------------------
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title.trim(),
        category: form.category.trim() || 'General',
        content: form.content,
        status: form.status,
      }
      if (editing) return put<KnowledgeRow>(`/api/knowledge/${editing.id}`, payload)
      return post<KnowledgeRow>('/api/knowledge', payload)
    },
    onSuccess: () => {
      toast({
        title: editing ? 'Article updated' : 'Article created',
        description: form.title.trim(),
      })
      invalidate()
      setFormOpen(false)
      setEditing(null)
    },
    onError: (err: Error) =>
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => del(`/api/knowledge/${id}`),
    onSuccess: () => {
      toast({ title: 'Article deleted' })
      setDeleteTarget(null)
      invalidate()
    },
    onError: (err: Error) =>
      toast({ title: 'Could not delete', description: err.message, variant: 'destructive' }),
  })

  // ---- dialog helpers -----------------------------------------------------
  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (a: KnowledgeRow) => {
    setEditing(a)
    setForm({
      title: a.title,
      category: a.category,
      content: a.content,
      status: a.status,
    })
    setFormOpen(true)
  }

  const openRead = (id: string) => {
    setReadId(id)
    setReadOpen(true)
  }

  const canSave = form.title.trim().length > 0 && form.content.trim().length > 0 && !saveMutation.isPending

  return (
    <div className="space-y-5">
      <PageHeader
        icon={BookOpen}
        title="Knowledge Base"
        description="Internal documentation and how-to articles shared across teams"
        actions={
          <Button onClick={openCreate} className="min-h-11 sm:min-h-9">
            <Plus className="h-4 w-4" aria-hidden />
            New article
          </Button>
        }
      />

      {/* Stats */}
      {listQuery.isPending ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard title="Published" value={stats.published} hint="live articles" icon={CheckCircle2} tone="success" />
          <StatCard title="Drafts" value={stats.drafts} hint="work in progress" icon={FileText} tone="warning" />
          <StatCard title="Total views" value={stats.views} hint="across all articles" icon={Eye} />
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or content…"
            className="pl-8"
            aria-label="Search knowledge base"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-36" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card className="py-0 gap-0">
        <CardContent className="p-0">
          {listQuery.isError && (
            <p className="p-4 text-sm text-destructive">
              Failed to load knowledge base: {listQuery.error.message}
            </p>
          )}
          <div className="overflow-x-auto">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQuery.isPending &&
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={6}>
                        <Skeleton className="h-8 w-full" />
                      </TableCell>
                    </TableRow>
                  ))}
                {!listQuery.isPending && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="p-0">
                      <div className="p-6">
                        <EmptyState
                          icon={BookOpen}
                          title={data.length === 0 ? 'No articles yet' : 'No articles match your filters'}
                          description={
                            data.length === 0
                              ? 'Write your first knowledge base article to share know-how with the team.'
                              : 'Try another search term or clear the filters.'
                          }
                          actionLabel={data.length === 0 ? 'New article' : undefined}
                          onAction={data.length === 0 ? openCreate : undefined}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="max-w-[320px]">
                      <p className="truncate font-medium" title={a.title}>
                        {a.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground" title={a.content}>
                        {a.content.split('\n')[0]}
                      </p>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={a.category} tone="neutral" />
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        status={a.status}
                        tone={STATUS_TONE[a.status]}
                        label={STATUS_LABEL[a.status]}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(a.views)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {formatDate(a.updatedAt)}
                      <p className="text-xs text-muted-foreground">{relativeDays(a.updatedAt)}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 sm:h-8 sm:w-8"
                          onClick={() => openRead(a.id)}
                          aria-label={`Read ${a.title}`}
                          title="Read"
                        >
                          <Eye className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 sm:h-8 sm:w-8"
                          onClick={() => openEdit(a)}
                          aria-label={`Edit ${a.title}`}
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-11 w-11 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:h-8 sm:w-8"
                          onClick={() => setDeleteTarget(a)}
                          aria-label={`Delete ${a.title}`}
                          title="Delete"
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
        </CardContent>
      </Card>

      {/* Create / edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[70vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit article' : 'New article'}</DialogTitle>
            <DialogDescription>
              Articles can be kept as drafts until they are ready, then published for the whole team.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="kb-title">Title *</Label>
              <Input
                id="kb-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. How to create a commercial proposal"
                autoFocus
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="kb-category">Category</Label>
                <Input
                  id="kb-category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  list="kb-category-suggestions"
                  placeholder="General"
                />
                <datalist id="kb-category-suggestions">
                  {CATEGORY_SUGGESTIONS.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kb-status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v as KbStatus })}
                >
                  <SelectTrigger id="kb-status" aria-label="Status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kb-content">Content *</Label>
              <Textarea
                id="kb-content"
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                rows={8}
                placeholder={'Write the article in plain text. Line breaks are preserved.'}
                className={cn(scrollbarCls)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 sm:min-h-9"
              onClick={() => setFormOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="min-h-11 sm:min-h-9"
              disabled={!canSave}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {editing ? 'Save changes' : 'Create article'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Read dialog */}
      <KnowledgeReadDialog articleId={readId} open={readOpen} onOpenChange={closeRead} />

      {/* Delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete article?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove “{deleteTarget?.title}” from the knowledge base. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 sm:min-h-9">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
