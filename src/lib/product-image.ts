/**
 * Static product image storage.
 *
 * Each product's image is ONE file on disk (public/products/product-<id>.<ext>)
 * — not a data URL — so list payloads stay tiny. The public URL is stored on
 * the Product.imageUrl column (cache-busted with the file mtime) by the
 * upload endpoint /api/products/[id]/image.
 */
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const PRODUCTS_DIR = path.join(process.cwd(), 'public', 'products')
const PREFIX = 'product-'
const EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const

export type ProductImageExt = (typeof EXTS)[number]

export const PRODUCT_IMAGE_MIME: Record<string, ProductImageExt> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024

export interface ProductImageFile {
  ext: ProductImageExt
  mtimeMs: number
  bytes: number
}

function variantsFor(id: string): string[] {
  return EXTS.map((ext) => path.join(PRODUCTS_DIR, `${PREFIX}${id}.${ext}`))
}

/** Find the current image file for a product (first whitelisted variant), or null. */
export async function findProductImage(id: string): Promise<ProductImageFile | null> {
  for (const file of variantsFor(id)) {
    try {
      const st = await stat(file)
      return { ext: path.extname(file).slice(1) as ProductImageExt, mtimeMs: st.mtimeMs, bytes: st.size }
    } catch {
      // try next variant
    }
  }
  return null
}

/** Public, cache-busted URL for a stored product image (or null). */
export function productImageUrl(id: string, img: ProductImageFile | null): string | null {
  if (!img) return null
  return `/products/${PREFIX}${id}.${img.ext}?v=${Math.round(img.mtimeMs)}`
}

/**
 * Write (replace) a product image. Removes every other whitelisted variant
 * first so exactly ONE file per product is ever present.
 */
export async function writeProductImage(id: string, ext: ProductImageExt, data: Buffer): Promise<ProductImageFile> {
  await mkdir(PRODUCTS_DIR, { recursive: true })
  await clearProductImage(id)
  const file = path.join(PRODUCTS_DIR, `${PREFIX}${id}.${ext}`)
  await writeFile(file, data)
  const st = await stat(file)
  return { ext, mtimeMs: st.mtimeMs, bytes: st.size }
}

/** Remove every image variant for a product (idempotent). */
export async function clearProductImage(id: string): Promise<void> {
  await Promise.all(variantsFor(id).map((f) => rm(f, { force: true }).catch(() => undefined)))
}

/** Best-effort directory listing (used to purge orphaned files on delete). */
export async function listProductImageFiles(): Promise<string[]> {
  try {
    return await readdir(PRODUCTS_DIR)
  } catch {
    return []
  }
}
