'use client'

import { create } from 'zustand'

/**
 * Session user payload returned by the auth APIs ({ data: { user } } envelope).
 * Must stay in sync with buildUserPayload() in src/lib/auth.ts (server).
 */
export interface SessionUser {
  id: string
  tenantId: string
  email: string
  name: string
  status: string
  role: { id: string; name: string; permissions: string[]; isSystem: boolean } | null
  tenant: { id: string; name: string }
  /** e.g. ["*"] for Administrator or ["invoices.view", ...] */
  permissions: string[]
}

export interface RegisterInput {
  organization: string
  name: string
  email: string
  password: string
}

export interface AuthResult {
  ok: boolean
  error?: string
}

interface AuthState {
  status: 'loading' | 'anon' | 'authed'
  user: SessionUser | null
  /** Bootstrap: GET /api/auth/me → 'authed' | 'anon' (network/parse errors → 'anon') */
  init(): Promise<void>
  login(email: string, password: string): Promise<AuthResult>
  register(p: RegisterInput): Promise<AuthResult>
  /** POST /api/auth/logout, then always drop to 'anon' */
  logout(): Promise<void>
  /** Immediate sign-out without a server round-trip (session expired / 401 watchdog) */
  forceSignOut(): void
}

interface AuthEnvelope {
  data?: { user?: SessionUser }
  error?: string
}

const NETWORK_ERROR = 'Cannot reach the server. Check your connection and try again.'

async function readEnvelope(res: Response): Promise<AuthEnvelope> {
  try {
    return (await res.json()) as AuthEnvelope
  } catch {
    return {}
  }
}

function sessionFrom(json: AuthEnvelope): SessionUser | null {
  return json.data?.user ?? null
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  user: null,

  init: async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
      const json = await readEnvelope(res)
      const user = res.ok ? sessionFrom(json) : null
      set(user ? { status: 'authed', user } : { status: 'anon', user: null })
    } catch {
      set({ status: 'anon', user: null })
    }
  },

  login: async (email, password) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const json = await readEnvelope(res)
      if (!res.ok) {
        return { ok: false, error: json.error ?? `Sign in failed (${res.status})` }
      }
      const user = sessionFrom(json)
      if (!user) return { ok: false, error: 'Sign in failed: malformed server response.' }
      set({ status: 'authed', user })
      return { ok: true }
    } catch {
      return { ok: false, error: NETWORK_ERROR }
    }
  },

  register: async (p) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
      })
      const json = await readEnvelope(res)
      if (!res.ok) {
        return { ok: false, error: json.error ?? `Registration failed (${res.status})` }
      }
      const user = sessionFrom(json)
      if (!user) return { ok: false, error: 'Registration failed: malformed server response.' }
      set({ status: 'authed', user }) // register auto-signs-in
      return { ok: true }
    } catch {
      return { ok: false, error: NETWORK_ERROR }
    }
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    } catch {
      // even if the request fails, drop the local session
    }
    set({ status: 'anon', user: null })
  },

  forceSignOut: () => set({ status: 'anon', user: null }),
}))
