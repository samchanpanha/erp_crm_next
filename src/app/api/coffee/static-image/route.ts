import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/permissions'
import {
  STATIC_KHQR_MAX_BYTES, STATIC_KHQR_MIME, clearStaticKhqr, findStaticKhqr, staticKhqrUrl, writeStaticKhqr,
} from '@/lib/static-khqr'

export const dynamic = 'force-dynamic'

// ---------------------------------------------------------------------------
// /api/coffee/static-image — the STATIC "Buy me a coffee" KHQR image.
//
// The image is one fixed file on the server (public/coffee/khqr.<ext>) served
// as a plain static URL — the ONLY image the coffee feature ever shows.
//
//   POST   FormData(file) — replace the static image
//   DELETE — remove the static image
//
// BOTH mutations are super-administrator-only ("*" permission). The file is
// public/static by design (supporters scan it), but only the account owner
// can ever set or change it.
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  try {
    const ctx = await requireAuth()
    if (ctx instanceof NextResponse) return ctx
    if (!isSuperAdmin(ctx.user.permissions)) {
      return NextResponse.json(
        { error: 'Only the super administrator can upload the KHQR image.' },
        { status: 403 },
      )
    }

    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Attach the image as a "file" form field.' }, { status: 400 })
    }
    const ext = STATIC_KHQR_MIME[file.type]
    if (!ext) {
      return NextResponse.json({ error: 'Only PNG, JPG or WebP images are supported.' }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'The selected file is empty.' }, { status: 400 })
    }
    if (file.size > STATIC_KHQR_MAX_BYTES) {
      return NextResponse.json({ error: 'Image is too large — the maximum size is 2 MB.' }, { status: 400 })
    }

    const saved = await writeStaticKhqr(ext, Buffer.from(await file.arrayBuffer()))
    return NextResponse.json({
      data: {
        khqrUrl: staticKhqrUrl(saved),
        updatedAt: new Date(saved.mtimeMs).toISOString(),
      },
    })
  } catch (err) {
    console.error('POST /api/coffee/static-image failed', err)
    return NextResponse.json({ error: 'Failed to save the static KHQR image' }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const ctx = await requireAuth()
    if (ctx instanceof NextResponse) return ctx
    if (!isSuperAdmin(ctx.user.permissions)) {
      return NextResponse.json(
        { error: 'Only the super administrator can remove the KHQR image.' },
        { status: 403 },
      )
    }

    await clearStaticKhqr()
    const remaining = await findStaticKhqr()
    return NextResponse.json({ data: { khqrUrl: staticKhqrUrl(remaining) } })
  } catch (err) {
    console.error('DELETE /api/coffee/static-image failed', err)
    return NextResponse.json({ error: 'Failed to remove the static KHQR image' }, { status: 500 })
  }
}
