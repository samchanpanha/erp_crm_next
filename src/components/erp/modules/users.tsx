'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { toast } from 'sonner'
import {
  AlertCircle, Info, KeyRound, MoreHorizontal, Pencil, Plus, RefreshCw, Settings2,
  ShieldCheck, Trash2, UserCheck, UserPlus, Users, UserX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageHeader, EmptyState } from '@/components/erp/shared/page-header'
import { fetchApi as api } from '@/components/erp/lib/api'
import { PERMISSION_MODULES, canEdit } from '@/lib/permissions'
import { useAuthStore } from '@/lib/auth-store'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// API: shared fetchApi (src/components/erp/lib/api.ts) — sends the session
// Authorization header + { data } / { error } envelope handling.
// ---------------------------------------------------------------------------
// Types (mirror API payloads)
// ---------------------------------------------------------------------------
interface UserRow {
  id: string
  name: string
  email: string
  status: 'ACTIVE' | 'DISABLED'
  roleId: string | null
  role: { id: string; name: string; isSystem: boolean } | null
  lastLoginAt: string | null
  createdAt: string
}

interface RoleRow {
  id: string
  name: string
  description: string | null
  permissions: string[]
  isSystem: boolean
  userCount: number
  createdAt: string
}

const scrollbarCls =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 hover:[&::-webkit-scrollbar-thumb]:bg-zinc-400'

const ALL_PERMS = PERMISSION_MODULES.flatMap((m) => [`${m.module}.view`, `${m.module}.edit`])

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)

const formatLastLogin = (d: string | null) => {
  if (!d) return null
  const date = new Date(d)
  return Number.isNaN(date.getTime()) ? null : format(date, 'MMM d, yyyy · HH:mm')
}

/** Groups PERMISSION_MODULES by their .group, preserving catalog order. */
const PERMISSION_GROUPS = (() => {
  const map = new Map<string, typeof PERMISSION_MODULES>()
  for (const m of PERMISSION_MODULES) {
    const list = map.get(m.group) ?? []
    list.push(m)
    map.set(m.group, list)
  }
  return [...map.entries()]
})()

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------
export default function UsersRolesModule() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const canEditRoles = user ? canEdit(user.permissions, 'administration') : false

  // ---- data ---------------------------------------------------------------
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: () => api<UserRow[]>('/api/users') })
  const rolesQuery = useQuery({ queryKey: ['roles'], queryFn: () => api<RoleRow[]>('/api/roles') })

  const users = usersQuery.data ?? []
  const roles = rolesQuery.data ?? []

  const invalidateUsers = () => void queryClient.invalidateQueries({ queryKey: ['users'] })
  const invalidateRoles = () => void queryClient.invalidateQueries({ queryKey: ['roles'] })

  // ---- dialog state -------------------------------------------------------
  const [userDialogOpen, setUserDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<UserRow | null>(null)
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null)
  const [deleteUserTarget, setDeleteUserTarget] = useState<UserRow | null>(null)
  const [roleDialogOpen, setRoleDialogOpen] = useState(false)
  const [editingRole, setEditingRole] = useState<RoleRow | null>(null)
  const [deleteRoleTarget, setDeleteRoleTarget] = useState<RoleRow | null>(null)

  const openCreateUser = () => {
    setEditingUser(null)
    setUserDialogOpen(true)
  }

  const openEditUser = (u: UserRow) => {
    setEditingUser(u)
    setUserDialogOpen(true)
  }

  const openCreateRole = () => {
    setEditingRole(null)
    setRoleDialogOpen(true)
  }

  const openEditRole = (r: RoleRow) => {
    setEditingRole(r)
    setRoleDialogOpen(true)
  }

  // ---- row actions (direct mutations) --------------------------------------
  const toggleStatus = async (u: UserRow) => {
    const next = u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
    try {
      await api(`/api/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ status: next }) })
      toast.success(next === 'ACTIVE' ? 'User enabled' : 'User disabled')
      invalidateUsers()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const confirmDeleteUser = async () => {
    const target = deleteUserTarget
    if (!target) return
    try {
      await api(`/api/users/${target.id}`, { method: 'DELETE' })
      toast.success('User deleted')
      invalidateUsers()
    } catch (err) {
      toast.error((err as Error).message)
    }
    setDeleteUserTarget(null)
  }

  const confirmDeleteRole = async () => {
    const target = deleteRoleTarget
    if (!target) return
    try {
      await api(`/api/roles/${target.id}`, { method: 'DELETE' })
      toast.success('Role deleted')
      invalidateRoles()
    } catch (err) {
      toast.error((err as Error).message)
    }
    setDeleteRoleTarget(null)
  }

  // ---- dialog submits (return server error string for inline display) ------
  const submitUser = async (payload: Record<string, unknown>, id?: string): Promise<string | null> => {
    try {
      await api(id ? `/api/users/${id}` : '/api/users', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      toast.success(id ? 'User updated' : 'User created')
      invalidateUsers()
      return null
    } catch (err) {
      return (err as Error).message
    }
  }

  const submitPassword = async (target: UserRow, password: string): Promise<string | null> => {
    try {
      await api(`/api/users/${target.id}`, { method: 'PUT', body: JSON.stringify({ password }) })
      toast.success('Password reset')
      return null
    } catch (err) {
      return (err as Error).message
    }
  }

  const submitRole = async (payload: Record<string, unknown>, id?: string): Promise<string | null> => {
    try {
      await api(id ? `/api/roles/${id}` : '/api/roles', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      })
      toast.success(id ? 'Role updated' : 'Role created')
      invalidateRoles()
      invalidateUsers() // role names appear on users
      return null
    } catch (err) {
      return (err as Error).message
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Users}
        title="Users & Roles"
        description="Team accounts, roles and module permissions"
      />

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="roles">Roles</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------ TAB 1: Users -- */}
        <TabsContent value="users" className="mt-4 space-y-4">
          <Card className="py-0 gap-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold">Users</h2>
                {usersQuery.isPending ? (
                  <Skeleton className="h-5 w-8" />
                ) : (
                  <Badge variant="secondary">{users.length}</Badge>
                )}
              </div>
              <Button
                onClick={openCreateUser}
                disabled={!canEditRoles}
                title={canEditRoles ? 'Add a user account' : 'You need the "administration edit" permission to manage users'}
                className="min-h-11 sm:min-h-9"
              >
                <UserPlus className="h-4 w-4" aria-hidden />
                Add user
              </Button>
            </div>

            {usersQuery.isError && (
              <div className="p-4">
                <LoadErrorAlert message={usersQuery.error.message} onRetry={() => usersQuery.refetch()} />
              </div>
            )}

            <div className={cn('max-h-[480px] overflow-y-auto overflow-x-auto', scrollbarCls)}>
              <Table className="min-w-[760px]">
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last sign-in</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {usersQuery.isPending &&
                    Array.from({ length: 4 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={5}>
                          <Skeleton className="h-9 w-full" />
                        </TableCell>
                      </TableRow>
                    ))}

                  {!usersQuery.isPending && users.length === 0 && !usersQuery.isError && (
                    <TableRow>
                      <TableCell colSpan={5} className="p-0">
                        <div className="p-6">
                          <EmptyState
                            icon={Users}
                            title="No users yet"
                            description="Add your first team account to start collaborating."
                            actionLabel={canEditRoles ? 'Add user' : undefined}
                            onAction={canEditRoles ? openCreateUser : undefined}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  )}

                  {users.map((u) => {
                    const isSelf = user?.id === u.id
                    const lastLogin = formatLastLogin(u.lastLoginAt)
                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9">
                              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                                {initials(u.name)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 truncate font-medium">
                                <span className="truncate">{u.name}</span>
                                {isSelf && <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">You</Badge>}
                              </p>
                              <p className="truncate text-xs text-muted-foreground" title={u.email}>
                                {u.email}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {u.role ? (
                            <Badge variant="outline">{u.role.name}</Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {u.status === 'ACTIVE' ? (
                            <Badge className="border-transparent bg-emerald-600 text-white hover:bg-emerald-600">
                              Active
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              Disabled
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm">
                          {lastLogin ?? <span className="text-muted-foreground">Never</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          {canEditRoles ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-11 sm:size-9"
                                  aria-label={`Actions for ${u.name}`}
                                  title="Actions"
                                >
                                  <MoreHorizontal className="h-4 w-4" aria-hidden />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem onSelect={() => openEditUser(u)}>
                                  <Pencil aria-hidden />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => setResetTarget(u)}>
                                  <KeyRound aria-hidden />
                                  Reset password
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={isSelf}
                                  title={isSelf ? 'You cannot change your own status' : undefined}
                                  onSelect={() => void toggleStatus(u)}
                                >
                                  {u.status === 'ACTIVE' ? <UserX aria-hidden /> : <UserCheck aria-hidden />}
                                  {u.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  disabled={isSelf}
                                  title={isSelf ? 'You cannot delete your own account' : undefined}
                                  onSelect={() => setDeleteUserTarget(u)}
                                >
                                  <Trash2 aria-hidden />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <span className="pr-2 text-sm text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------ TAB 2: Roles -- */}
        <TabsContent value="roles" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">Roles</CardTitle>
                  {rolesQuery.isPending ? (
                    <Skeleton className="h-5 w-8" />
                  ) : (
                    <Badge variant="secondary">{roles.length}</Badge>
                  )}
                </div>
                <Button
                  onClick={openCreateRole}
                  disabled={!canEditRoles}
                  title={canEditRoles ? 'Create a custom role' : 'You need the "administration edit" permission to manage roles'}
                  className="min-h-11 sm:min-h-9"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  New role
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {rolesQuery.isError && (
                <LoadErrorAlert message={rolesQuery.error.message} onRetry={() => rolesQuery.refetch()} />
              )}

              {rolesQuery.isPending && (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-36 rounded-lg" />
                  ))}
                </div>
              )}

              {!rolesQuery.isPending && !rolesQuery.isError && roles.length === 0 && (
                <EmptyState
                  icon={ShieldCheck}
                  title="No roles yet"
                  description="Roles group module permissions that you can assign to users."
                  actionLabel={canEditRoles ? 'New role' : undefined}
                  onAction={canEditRoles ? openCreateRole : undefined}
                />
              )}

              {!rolesQuery.isPending && roles.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {roles.map((r) => (
                    <RoleCard
                      key={r.id}
                      role={r}
                      canEditRoles={canEditRoles}
                      onEdit={() => openEditRole(r)}
                      onDelete={() => setDeleteRoleTarget(r)}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ---- Add / edit user dialog ---- */}
      {userDialogOpen && (
        <UserFormDialog
          key={editingUser?.id ?? 'create'}
          editing={editingUser}
          roles={roles}
          rolesLoading={rolesQuery.isPending}
          selfId={user?.id ?? null}
          onSubmit={submitUser}
          onClose={() => setUserDialogOpen(false)}
        />
      )}

      {/* ---- Reset password dialog ---- */}
      {resetTarget && (
        <ResetPasswordDialog
          key={resetTarget.id}
          target={resetTarget}
          onSubmit={submitPassword}
          onClose={() => setResetTarget(null)}
        />
      )}

      {/* ---- Delete user confirm ---- */}
      <AlertDialog
        open={deleteUserTarget !== null}
        onOpenChange={(open) => !open && setDeleteUserTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteUserTarget && (
                <>
                  This permanently removes <strong>{deleteUserTarget.name}</strong>{' '}
                  ({deleteUserTarget.email}) and signs out all their sessions. This action
                  cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => void confirmDeleteUser()}
            >
              Delete user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Role editor dialog ---- */}
      {roleDialogOpen && (
        <RoleEditorDialog
          key={editingRole?.id ?? 'new'}
          editing={editingRole}
          onSubmit={submitRole}
          onClose={() => setRoleDialogOpen(false)}
        />
      )}

      {/* ---- Delete role confirm ---- */}
      <AlertDialog
        open={deleteRoleTarget !== null}
        onOpenChange={(open) => !open && setDeleteRoleTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete role?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRoleTarget && (
                <>
                  This permanently removes the custom role{' '}
                  <strong>{deleteRoleTarget.name}</strong>. Roles still assigned to users
                  cannot be deleted — reassign its users first.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              onClick={() => void confirmDeleteRole()}
            >
              Delete role
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared: load error alert with retry
// ---------------------------------------------------------------------------
function LoadErrorAlert({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden />
      <AlertTitle>Failed to load</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{message}</span>
        <Button variant="outline" size="sm" onClick={onRetry} className="min-h-11 sm:min-h-8">
          <RefreshCw aria-hidden />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  )
}

// ---------------------------------------------------------------------------
// Role card (grid item)
// ---------------------------------------------------------------------------
function RoleCard({
  role,
  canEditRoles,
  onEdit,
  onDelete,
}: {
  role: RoleRow
  canEditRoles: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-semibold leading-snug">{role.name}</CardTitle>
          {role.isSystem && <Badge variant="secondary">System</Badge>}
        </div>
      </CardHeader>
      <CardContent className="flex-1 pb-3">
        <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground">
          {role.description ?? 'No description.'}
        </p>
      </CardContent>
      <CardFooter className="justify-between gap-2 border-t pt-3!">
        <span className="text-xs text-muted-foreground">
          {role.userCount} user{role.userCount === 1 ? '' : 's'}
        </span>
        {canEditRoles && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-11 sm:size-8"
              onClick={onEdit}
              aria-label={`Edit role ${role.name}`}
              title="Edit role"
            >
              <Settings2 className="h-4 w-4" aria-hidden />
            </Button>
            {!role.isSystem && (
              <Button
                variant="ghost"
                size="icon"
                className="size-11 text-rose-600 hover:bg-rose-50 hover:text-rose-700 sm:size-8"
                onClick={onDelete}
                aria-label={`Delete role ${role.name}`}
                title="Delete role"
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
        )}
      </CardFooter>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Add / edit user dialog
// ---------------------------------------------------------------------------
function UserFormDialog({
  editing,
  roles,
  rolesLoading,
  selfId,
  onSubmit,
  onClose,
}: {
  editing: UserRow | null
  roles: RoleRow[]
  rolesLoading: boolean
  selfId: string | null
  onSubmit: (payload: Record<string, unknown>, id?: string) => Promise<string | null>
  onClose: () => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [email, setEmail] = useState(editing?.email ?? '')
  const [password, setPassword] = useState('')
  const [roleId, setRoleId] = useState(editing?.roleId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isSelf = Boolean(editing && selfId === editing.id)

  const handleSave = async () => {
    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    if (trimmedName.length < 2) return setError('Name must be at least 2 characters')
    if (!isEmail(trimmedEmail)) return setError('Enter a valid email address')
    if (password && password.length < 8) return setError('Password must be at least 8 characters')
    if (!editing && password.length < 8) return setError('Password must be at least 8 characters')
    if (!roleId) return setError('Please select a role')

    const payload: Record<string, unknown> = { name: trimmedName, email: trimmedEmail, roleId }
    if (password) payload.password = password

    setBusy(true)
    const serverError = await onSubmit(payload, editing?.id)
    setBusy(false)
    if (serverError) setError(serverError)
    else onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit user' : 'New user'}</DialogTitle>
          <DialogDescription>
            {editing
              ? `Update the account of ${editing.name}.`
              : 'Create a team account and pick the role it should have.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label htmlFor="usr-name">Name *</Label>
            <Input
              id="usr-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alice Martin"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="usr-email">Email *</Label>
            <Input
              id="usr-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alice@company.io"
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="usr-password">
              {editing ? 'Reset password (optional)' : 'Password *'}
            </Label>
            <Input
              id="usr-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={editing ? 'Leave blank to keep current password' : 'At least 8 characters'}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              {editing ? 'Leave blank to keep the current password.' : 'Minimum 8 characters.'}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="usr-role">Role *</Label>
            <Select
              value={roleId || '__none__'}
              onValueChange={(v) => setRoleId(v === '__none__' ? '' : v)}
              disabled={isSelf || rolesLoading}
            >
              <SelectTrigger id="usr-role" aria-label="Role" className="w-full">
                <SelectValue placeholder={rolesLoading ? 'Loading roles…' : 'Select a role'} />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                    {r.isSystem ? ' · System' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isSelf && (
              <p className="text-xs text-muted-foreground">You cannot change your own role.</p>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="min-h-11 sm:min-h-9">
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={busy} className="min-h-11 sm:min-h-9">
            {busy && (
              <span
                className="mr-1 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-hidden
              />
            )}
            {editing ? 'Save changes' : 'Create user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Reset password dialog (small)
// ---------------------------------------------------------------------------
function ResetPasswordDialog({
  target,
  onSubmit,
  onClose,
}: {
  target: UserRow
  onSubmit: (target: UserRow, password: string) => Promise<string | null>
  onClose: () => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const handleSave = async () => {
    if (password.length < 8) return setError('Password must be at least 8 characters')
    setBusy(true)
    const serverError = await onSubmit(target, password)
    setBusy(false)
    if (serverError) setError(serverError)
    else onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for {target.name} ({target.email}).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="usr-new-password">New password *</Label>
          <Input
            id="usr-new-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="min-h-11 sm:min-h-9">
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={busy} className="min-h-11 sm:min-h-9">
            {busy && (
              <span
                className="mr-1 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-hidden
              />
            )}
            Save password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Role editor dialog with the permission matrix
// ---------------------------------------------------------------------------
function RoleEditorDialog({
  editing,
  onSubmit,
  onClose,
}: {
  editing: RoleRow | null
  onSubmit: (payload: Record<string, unknown>, id?: string) => Promise<string | null>
  onClose: () => void
}) {
  const [name, setName] = useState(editing?.name ?? '')
  const [description, setDescription] = useState(editing?.description ?? '')
  const [perms, setPerms] = useState<Set<string>>(() => {
    const p = editing?.permissions ?? []
    return new Set(p.includes('*') ? ALL_PERMS : p)
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isSystem = editing?.isSystem ?? false
  const lockedAdmin = Boolean(editing && editing.isSystem && editing.permissions.includes('*'))

  const toggleView = (module: string, checked: boolean) => {
    setPerms((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(`${module}.view`)
      } else {
        next.delete(`${module}.view`)
        next.delete(`${module}.edit`) // unchecking View unchecks its Edit
      }
      return next
    })
  }

  const toggleEdit = (module: string, checked: boolean) => {
    setPerms((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(`${module}.view`) // checking Edit auto-checks its View
        next.add(`${module}.edit`)
      } else {
        next.delete(`${module}.edit`)
      }
      return next
    })
  }

  const handleSave = async () => {
    if (!isSystem && name.trim().length < 2) return setError('Role name must be at least 2 characters')

    const payload: Record<string, unknown> = { permissions: Array.from(perms) }
    if (!isSystem) {
      payload.name = name.trim()
      payload.description = description.trim()
    }

    setBusy(true)
    const serverError = await onSubmit(payload, editing?.id)
    setBusy(false)
    if (serverError) setError(serverError)
    else onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {editing ? (isSystem ? `System role: ${editing.name}` : 'Edit role') : 'New role'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? 'Adjust the identity and module permissions of this role.'
              : 'Name the role and pick which modules its users can view or edit.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Name *</Label>
              <Input
                id="role-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Operations"
                disabled={isSystem}
                maxLength={60}
              />
            </div>
            <div className="flex items-end">
              {isSystem && (
                <p className="flex w-full items-center gap-1.5 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  System role names and descriptions are locked.
                </p>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="role-desc">Description</Label>
            <Textarea
              id="role-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What can this role do?"
              rows={2}
              maxLength={300}
              disabled={isSystem}
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label>Module permissions</Label>
              {!lockedAdmin && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => setPerms(new Set(ALL_PERMS.filter((p) => p.endsWith('.view'))))}
                  >
                    All view
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => setPerms(new Set(ALL_PERMS))}
                  >
                    All edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => setPerms(new Set())}
                  >
                    Clear
                  </Button>
                </div>
              )}
            </div>

            {lockedAdmin && (
              <p className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4 shrink-0" aria-hidden />
                Administrator has unrestricted access.
              </p>
            )}

            <div
              className={cn(
                'space-y-3 rounded-lg border p-3',
                lockedAdmin && 'pointer-events-none opacity-60',
              )}
              aria-disabled={lockedAdmin}
            >
              {PERMISSION_GROUPS.map(([group, modules]) => (
                <div key={group}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {group}
                  </p>
                  <div className="space-y-1">
                    {modules.map((m) => {
                      const viewPerm = `${m.module}.view`
                      const editPerm = `${m.module}.edit`
                      return (
                        <div
                          key={m.module}
                          className="flex items-center justify-between gap-3 rounded-md border px-3 py-0.5"
                        >
                          <span className="min-w-0 truncate text-sm">{m.label}</span>
                          <div className="flex shrink-0 items-center gap-4">
                            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
                              <Checkbox
                                checked={perms.has(viewPerm)}
                                onCheckedChange={(c) => toggleView(m.module, c === true)}
                                disabled={lockedAdmin}
                                aria-label={`${m.label} — view`}
                              />
                              View
                            </label>
                            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm sm:min-h-9">
                              <Checkbox
                                checked={perms.has(editPerm)}
                                onCheckedChange={(c) => toggleEdit(m.module, c === true)}
                                disabled={lockedAdmin || !perms.has(viewPerm)}
                                aria-label={`${m.label} — edit`}
                              />
                              Edit
                            </label>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="min-h-11 sm:min-h-9">
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={busy || lockedAdmin}
            title={lockedAdmin ? 'The Administrator role cannot be modified' : undefined}
            className="min-h-11 sm:min-h-9"
          >
            {busy && (
              <span
                className="mr-1 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                aria-hidden
              />
            )}
            {editing ? 'Save role' : 'Create role'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
