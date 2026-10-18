import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Static KHQR image storage for "Buy me a coffee".
 *
 * The coffee QR is a single STATIC file on disk (public/coffee/khqr.<ext>) —
 * it is set once by the super administrator and then always served as a plain
 * static URL. Nothing about it lives in the database, so it survives DB
 * resets and never needs a data-URL round trip.
 *
 * Only this module may read/write the file — API routes call the helpers
 * below; the file itself is served by Next.js from /public as
 * `/coffee/khqr.<ext>` (public by design: supporters scan it).
 */

const COFFEE_DIR = path.join(process.cwd(), 'public', 'coffee')
const BASE_NAME = 'khqr'
const EXTS = ['png', 'jpg', 'jpeg', 'webp'] as const
export type StaticKhqrExt = (typeof EXTS)[number]

export const STATIC_KHQR_MIME: Record<string, StaticKhqrExt> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

export const STATIC_KHQR_MAX_BYTES = 2 * 1024 * 1024

export interface StaticKhqrFile {
  ext: StaticKhqrExt
  mtimeMs: number
}

/** Find the current static KHQR file (first whitelisted variant present), or null. */
export async function findStaticKhqr(): Promise<StaticKhqrFile | null> {
  let names: string[]
  try {
    names = await readdir(COFFEE_DIR)
  } catch {
    return null // directory does not exist yet
  }
  for (const ext of EXTS) {
    if (names.includes(`${BASE_NAME}.${ext}`)) {
      try {
        const st = await stat(path.join(COFFEE_DIR, `${BASE_NAME}.${ext}`))
        return { ext, mtimeMs: st.mtimeMs }
      } catch {
        // file vanished between readdir and stat — keep scanning
      }
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
 * variant first so exactly one static image exists at any time.
 */
export async function writeStaticKhqr(ext: StaticKhqrExt, data: Buffer): Promise<StaticKhqrFile> {
  await mkdir(COFFEE_DIR, { recursive: true })
  await clearStaticKhqr()
  await writeFile(path.join(COFFEE_DIR, `${BASE_NAME}.${ext}`), data)
  const st = await stat(path.join(COFFEE_DIR, `${BASE_NAME}.${ext}`))
  return { ext, mtimeMs: st.mtimeMs }
}

/** Remove every static KHQR variant (idempotent). */
export async function clearStaticKhqr(): Promise<void> {
  await Promise.all(
    EXTS.map((ext) => rm(path.join(COFFEE_DIR, `${BASE_NAME}.${ext}`), { force: true }).catch(() => undefined)),
  )
}
