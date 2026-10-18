'use client'

/**
 * Client-side session-token storage.
 *
 * Why: the app preview runs inside a cross-site iframe, where browsers block
 * SameSite=Lax cookies entirely. The httpOnly session cookie still works in
 * normal same-site tabs, but inside the iframe the only reliable transport
 * for the session token is the `Authorization: Bearer <token>` header.
 *
 * Storage strategy: localStorage when available (survives reloads), with an
 * in-memory fallback for environments that block storage access entirely.
 */

const TOKEN_KEY = 'dolinext_session_token'

let memoryToken: string | null = null

function storageGet(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY)
  } catch {
    return null // storage blocked — fall back to memory
  }
}

function storageSet(token: string) {
  try {
    window.localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // storage blocked — memory fallback keeps the current tab working
  }
}

function storageClear() {
  try {
    window.localStorage.removeItem(TOKEN_KEY)
  } catch {
    // ignore
  }
}

export function getStoredToken(): string | null {
  if (memoryToken) return memoryToken
  const t = storageGet()
  if (t) memoryToken = t
  return t
}

export function storeToken(token: string) {
  memoryToken = token
  storageSet(token)
}

export function clearStoredToken() {
  memoryToken = null
  storageClear()
}

/** Authorization header for the stored session token, or {} when signed out. */
export function authHeaders(): Record<string, string> {
  const token = getStoredToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}
