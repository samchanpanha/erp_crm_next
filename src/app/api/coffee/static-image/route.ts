import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/permissions'
import {
  STATIC_KHQR_MAX_BYTES, STATIC_KHQR_MIME, clearStaticKhqr, findStaticKhqr, staticKhqrUrl, writeStaticKhqr,
} from '@/lib/static-khqr'

export const dynamic = 'force-dynamic'

// /api/coffee/static-image — the STATIC "Buy me a coffee" KHQR image.
//
// The image is one fixed file on the server (public/coffee/khqr.<ext>) served
// as a plain static URL — the ONLY image the coffee dialog ever shows.
//   GET    — any signed-in user: { khqrUrl } (null when not set yet)
//   POST   — super administrator only: FormData(file) replaces the file
//   DELETE — super administrator only: removes it
// Writes by anyone else get 403 "Only the super administrator can …".

export async function GET() {
  const ctx = await requireAuth()
  if (ctx instanceof NextResponse) return ctx
  try {
    const khqr = await findStaticKhqr()
    return NextResponse.json({ data: { khqrUrl: staticKhqrUrl(khqr) } })
  } catch (err) {
    console.error('GET /api/coffee/static-image failed', err)
    return NextResponse.json({ error: 'Failed to load the KHQR image' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const ctx = await requireAuth()
  if (ctx instanceof NextResponse) return ctx
  if (!isSuperAdmin(ctx.user.permissions)) {
    return NextResponse.json({ error: 'Only the super administrator can upload the KHQR image.' }, { status: 403 })
  }
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: 'Choose an image file to upload.' }, { status: 400 })
    }
    const ext = STATIC_KHQR_MIME[file.type]
    if (!ext) {
      return NextResponse.json({ error: 'Only PNG, JPEG or WebP images are supported.' }, { status: 400 })
    }
    if (file.size > STATIC_KHQR_MAX_BYTES) {
      return NextResponse.json({ error: 'The image must be 2 MB or smaller.' }, { status: 400 })
    }
    const saved = await writeStaticKhqr(ext, Buffer.from(await file.arrayBuffer()))
    return NextResponse.json({
      data: { khqrUrl: staticKhqrUrl(saved), updatedAt: new Date().toISOString() },
    })
  } catch (err) {
    console.error('POST /api/coffee/static-image failed', err)
    return NextResponse.json({ error: 'Failed to save the static KHQR image' }, { status: 500 })
  }
}

export async function DELETE() {
  const ctx = await requireAuth()
  if (ctx instanceof NextResponse) return ctx
  if (!isSuperAdmin(ctx.user.permissions)) {
    return NextResponse.json({ error: 'Only the super administrator can remove the KHQR image.' }, { status: 403 })
  }
  try {
    await clearStaticKhqr()
    const remaining = await findStaticKhqr()
    return NextResponse.json({ data: { khqrUrl: staticKhqrUrl(remaining) } })
  } catch (err) {
    console.error('DELETE /api/coffee/static-image failed', err)
    return NextResponse.json({ error: 'Failed to remove the static KHQR image' }, { status: 500 })
  }
}
