'use client'

/**
 * Minimal API client for the ERP SPA.
 * All backend responses follow: { data: T } on success, { error: string } on failure.
 */
export async function fetchApi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`)
  }
  return (json as { data: T }).data
}

export const get = <T,>(url: string) => fetchApi<T>(url)
export const post = <T,>(url: string, body: unknown) =>
  fetchApi<T>(url, { method: 'POST', body: JSON.stringify(body) })
export const put = <T,>(url: string, body: unknown) =>
  fetchApi<T>(url, { method: 'PUT', body: JSON.stringify(body) })
export const del = <T,>(url: string) => fetchApi<T>(url, { method: 'DELETE' })
