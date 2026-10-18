/**
 * Static KHQR image storage for "Buy me a coffee".
 *
 * The coffee QR is a single STATIC file on disk (public/coffee/khqr.<ext>) —
 * not a database row. The super administrator replaces it via
 * /api/coffee/static-image; every reader just gets the URL.
 *
 * Public URL: `/coffee/khqr.<ext>?v=<mtime>` (cache-busted on replace).
 */
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const COFFEE_DIR = path.join(process.cwd(), 'public', 'coffee')
const BASE_NAME = 'khqr'
const EXTS = ['png', 'jpg', 'jpeg', 'webp'] as const

export type StaticKhqrExt = (typeof EXTS)[number]

export const STATIC_KHQR_MIME: Record<string, StaticKhqrExt> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
}

export const STATIC_KHQR_MAX_BYTES = 2 * 1024 * 1024

export interface StaticKhqrFile {
  ext: StaticKhqrExt
  mtimeMs: number
  bytes: number
}

/** Find the current static KHQR file (first whitelisted variant present), or null. */
export async function findStaticKhqr(): Promise<StaticKhqrFile | null> {
  let names: string[]
  try {
    names = await readdir(COFFEE_DIR)
  } catch {
    return null
  }
  for (const ext of EXTS) {
    if (!names.includes(`${BASE_NAME}.${ext}`)) continue
    try {
      const st = await stat(path.join(COFFEE_DIR, `${BASE_NAME}.${ext}`))
      return { ext, mtimeMs: st.mtimeMs, bytes: st.size }
    } catch {
      // raced delete — keep scanning
    }
  }
  return null
}

/** Public, cache-busted URL for a stored static KHQR file (or null). */
export function staticKhqrUrl(img: StaticKhqrFile | null): string | null {
  if (!img) return null
  return `/coffee/${BASE_NAME}.${img.ext}?v=${Math.round(img.mtimeMs)}`
}

/**
 * Write (replace) the static KHQR image. Removes every other whitelisted
 * variant first so exactly ONE file is ever present.
 */
export async function writeStaticKhqr(ext: StaticKhqrExt, data: Buffer): Promise<StaticKhqrFile> {
  await mkdir(COFFEE_DIR, { recursive: true })
  await clearStaticKhqr()
  await writeFile(path.join(COFFEE_DIR, `${BASE_NAME}.${ext}`), data)
  const st = await stat(path.join(COFFEE_DIR, `${BASE_NAME}.${ext}`))
  return { ext, mtimeMs: st.mtimeMs, bytes: st.size }
}

/** Remove every static KHQR variant (idempotent). */
export async function clearStaticKhqr(): Promise<void> {
  await Promise.all(
    EXTS.map((ext) => rm(path.join(COFFEE_DIR, `${BASE_NAME}.${ext}`), { force: true }).catch(() => undefined)),
  )
}
