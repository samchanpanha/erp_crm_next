import { NextResponse } from 'next/server'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

/** '' | null -> null; undefined stays undefined (partial update) */
const optionalText = (max: number) =>
  z.preprocess(
    (v) => {
      if (v === undefined) return undefined
      if (v === null) return null
      if (typeof v === 'string') {
        const t = v.trim()
        return t.length ? t.slice(0, max) : null
      }
      return v
    },
    z.string().max(max).nullable().optional(),
  )

const optionalEmail = z.preprocess(
  (v) => {
    if (v === undefined) return undefined
    if (v === null) return null
    if (typeof v === 'string') {
      const t = v.trim().toLowerCase()
      return t.length ? t : null
    }
    return v
  },
  z.email('Invalid email address').max(200).nullable().optional(),
)

const optionalThirdPartyId = z.preprocess(
  (v) => {
    if (v === undefined) return undefined
    if (v === null) return null
    if (typeof v === 'string') {
      const t = v.trim()
      return t.length ? t : null
    }
    return v
  },
  z.string().min(1).nullable().optional(),
)

const updateSchema = z.object({
  thirdPartyId: optionalThirdPartyId,
  firstName: z.string().trim().min(1, 'First name is required').max(100).optional(),
  lastName: z.string().trim().min(1, 'Last name is required').max(100).optional(),
  position: optionalText(100),
  email: optionalEmail,
  phone: optionalText(50),
  mobile: optionalText(50),
  isPrimary: z.boolean().optional(),
  notes: optionalText(2000),
})

const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status })

function firstIssueMessage(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input'
}

const contactInclude = {
  thirdParty: { select: { id: true, name: true, code: true } },
} as const

// ---------------------------------------------------------------------------
// PUT /api/contacts/:id → { data: Contact }
// ---------------------------------------------------------------------------
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.contact.findUnique({ where: { id } })
    if (!existing) return bad('Not found', 404)

    const body = await req.json().catch(() => null)
    if (body === null || typeof body !== 'object') return bad('Invalid request body')

    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) return bad(firstIssueMessage(parsed.error))

    const { thirdPartyId: nextThirdPartyId, ...rest } = parsed.data
    const sentCount = Object.values(parsed.data).filter((v) => v !== undefined).length
    if (sentCount === 0) return bad('No fields to update')

    // Validate third party link when explicitly provided (string or null)
    if (nextThirdPartyId) {
      const tp = await db.thirdParty.findUnique({
        where: { id: nextThirdPartyId },
        select: { id: true },
      })
      if (!tp) return bad('Third party not found')
    }

    const finalThirdPartyId =
      nextThirdPartyId !== undefined ? nextThirdPartyId : existing.thirdPartyId

    const updated = await db.$transaction(async (tx) => {
      if (rest.isPrimary === true && finalThirdPartyId) {
        await tx.contact.updateMany({
          where: { thirdPartyId: finalThirdPartyId, isPrimary: true, id: { not: id } },
          data: { isPrimary: false },
        })
      }

      return tx.contact.update({
        where: { id },
        // undefined fields are ignored by Prisma; null clears the column
        data: { ...rest, thirdPartyId: nextThirdPartyId } as Prisma.ContactUncheckedUpdateInput,
        include: contactInclude,
      })
    })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('PUT /api/contacts/[id] failed', err)
    return bad('Failed to update contact', 500)
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/contacts/:id → { data: { ok: true } }
// ---------------------------------------------------------------------------
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.contact.findUnique({ where: { id }, select: { id: true } })
    if (!existing) return bad('Not found', 404)

    await db.contact.delete({ where: { id } })
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    console.error('DELETE /api/contacts/[id] failed', err)
    return bad('Failed to delete contact', 500)
  }
}
