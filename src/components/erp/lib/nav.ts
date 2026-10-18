'use client'

/** Hash-based navigation between ERP modules (SPA lives on the single / route) */
export function navigate(key: string) {
  window.location.hash = `#/${key}`
}
