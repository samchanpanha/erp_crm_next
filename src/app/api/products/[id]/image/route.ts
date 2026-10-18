import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePerm } from '@/lib/auth'
import { PRODUCT_IMAGE_MAX_BYTES, PRODUCT_IMAGE_MIME, clearProductImage, writeProductImage } from '@/lib/product-image'

export const dynamic = 'force-dynamic'

// /api/products/[id]/image — static image for one product.
//   POST   — FormData(file): replaces the single static file
//            (public/products/product-<id>.<ext>) and stores the cache-busted
//            URL on Product.imageUrl. Requires products.edit.
//   DELETE — removes the file and clears Product.imageUrl. Requires products.edit.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('products.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const product = await db.product.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'Choose an image file to upload.' }, { status: 400 })
    }
    const ext = PRODUCT_IMAGE_MIME[file.type]
    if (!ext) {
      return NextResponse.json({ error: 'Only PNG, JPEG, WebP or GIF images are supported.' }, { status: 400 })
    }
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      return NextResponse.json({ error: 'The image must be 5 MB or smaller.' }, { status: 400 })
    }

    const saved = await writeProductImage(id, ext, Buffer.from(await file.arrayBuffer()))
    const imageUrl = `/products/product-${id}.${saved.ext}?v=${Math.round(saved.mtimeMs)}`
    const updated = await db.product.update({
      where: { id },
      data: { imageUrl },
      include: { _count: { select: { stockMovements: true } } },
    })
    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('POST /api/products/[id]/image failed', err)
    return NextResponse.json({ error: 'Failed to upload the product image' }, { status: 500 })
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requirePerm('products.edit')
    if (ctx instanceof NextResponse) return ctx
    const { user } = ctx

    const { id } = await params
    const product = await db.product.findFirst({ where: { id, tenantId: user.tenantId } })
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    await clearProductImage(id)
    const updated = await db.product.update({
      where: { id },
      data: { imageUrl: null },
      include: { _count: { select: { stockMovements: true } } },
    })
    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('DELETE /api/products/[id]/image failed', err)
    return NextResponse.json({ error: 'Failed to remove the product image' }, { status: 500 })
  }
}
