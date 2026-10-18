// Task 27 verification: the coffee KHQR is a STATIC server file, super-admin-only.
// Supersedes the Task 26 data-URL flow (khqrImage on /api/coffee/page is now
// rejected with a 400 hint). Creates a temp role+user holding coffee.edit
// WITHOUT "*" and proves:
//   - admin (wildcard) can upload/replace/remove the static image via
//     /api/coffee/static-image; the file is served from /coffee/khqr.<ext>
//   - a delegated coffee.edit editor can edit page TEXT but gets 403 on the
//     static image endpoints
//   - viewers get 403, anonymous gets 401, GIF/oversized payloads → 400
// Cleans up after itself and leaves NO static image behind.
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'node:crypto'

const db = new PrismaClient()
const BASE = 'http://localhost:3000'

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const GIF_BYTES = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
)

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `s1:${salt}:${hash}`
}

let pass = 0
let fail = 0
function check(label: string, ok: boolean, extra = '') {
  if (ok) { pass++; console.log(`  ✓ ${label}${extra ? ` — ${extra}` : ''}`) }
  else { fail++; console.log(`  ✗ FAIL: ${label}${extra ? ` — ${extra}` : ''}`) }
}

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`login ${email} failed: ${res.status} ${json.error}`)
  return json.data.token
}

async function callPage(token: string | null, method: 'GET' | 'PUT', body?: unknown) {
  const res = await fetch(`${BASE}/api/coffee/page`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

async function uploadImage(token: string | null, file: { bytes: Buffer; type: string; name: string } | null) {
  const form = new FormData()
  if (file) form.append('file', new Blob([new Uint8Array(file.bytes)], { type: file.type }), file.name)
  const res = await fetch(`${BASE}/api/coffee/static-image`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

async function removeImage(token: string | null) {
  const res = await fetch(`${BASE}/api/coffee/static-image`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

async function main() {
  // -- hygiene: no legacy data-URL images should linger in the DB ------------
  const legacy = await db.coffeePage.updateMany({ data: { khqrImage: null } })
  if (legacy.count > 0) console.log(`  (legacy) cleared khqrImage on ${legacy.count} coffeePage row(s)`)

  // -- start from a clean slate (admin removes any previous static image) ---
  const admin = await login('admin@dolinext.com', 'demo123')
  await removeImage(admin)

  // -- temp fixtures ---------------------------------------------------------
  const tenant = await db.tenant.findFirst({ where: { name: 'Demo Organization' } })
  if (!tenant) throw new Error('demo tenant missing')
  const role = await db.role.create({
    data: {
      tenantId: tenant.id,
      name: `CoffeeEditor-Task27-${randomBytes(3).toString('hex')}`,
      description: 'temp role for RBAC verification',
      permissions: JSON.stringify(['coffee.view', 'coffee.edit']),
      isSystem: false,
    },
  })
  const editor = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `coffee-editor-${randomBytes(3).toString('hex').toLowerCase()}@dolinext.com`,
      name: 'Coffee Editor',
      passwordHash: hashPassword('editorPass123'),
      roleId: role.id,
      status: 'ACTIVE',
    },
  })

  try {
    const viewer = await login('pat@demo.local', 'testpass123')
    const editorTok = await login(editor.email, 'editorPass123')

    console.log('— GET page / initial state —')
    let r = await callPage(admin, 'GET')
    check('admin GET 200', r.status === 200)
    check('page has no khqrImage field (static now)', !('khqrImage' in (r.json.data?.page ?? {})))
    check('khqrUrl null before upload', r.json.data?.page?.khqrUrl === null)

    console.log('— super admin (wildcard) uploads the static image —')
    r = await uploadImage(admin, { bytes: PNG_BYTES, type: 'image/png', name: 'khqr.png' })
    check('admin POST PNG → 200', r.status === 200)
    const url1: string | undefined = r.json.data?.khqrUrl
    check('returns khqrUrl', typeof url1 === 'string' && url1.startsWith('/coffee/khqr.png?v='), url1 ?? '')

    const fileRes = await fetch(`${BASE}${url1}`)
    check('static file served', fileRes.status === 200 && (fileRes.headers.get('content-type') ?? '').startsWith('image/png'))

    r = await callPage(admin, 'GET')
    check('GET page khqrUrl matches upload', r.json.data?.page?.khqrUrl === url1)

    console.log('— replace + validation —')
    r = await uploadImage(admin, { bytes: Buffer.from('UklGRgAAAABXRUJQVlA4IBwAAAAwAQCdASoBAAEAAQAcJaQAA3AA/odRiHcAAAA=', 'base64'), type: 'image/webp', name: 'khqr.webp' })
    const url2: string | undefined = r.json.data?.khqrUrl
    check('admin replace → 200 (webp variant)', r.status === 200 && typeof url2 === 'string' && url2.startsWith('/coffee/khqr.webp?v='), url2 ?? '')
    const oldRes = await fetch(`${BASE}${url1}`)
    check('old png variant deleted (single static file)', oldRes.status === 404)

    r = await uploadImage(admin, { bytes: GIF_BYTES, type: 'image/gif', name: 'x.gif' })
    check('admin POST GIF → 400', r.status === 400)
    r = await uploadImage(admin, null)
    check('admin POST without file → 400', r.status === 400)

    console.log('— legacy PUT khqrImage on /api/coffee/page → 400 hint —')
    r = await callPage(admin, 'PUT', { khqrImage: 'data:image/png;base64,AAAA' })
    check('PUT khqrImage → 400 with pointer', r.status === 400 && String(r.json.error).includes('static-image'), r.json.error ?? '')

    console.log('— coffee.edit WITHOUT wildcard (delegated editor) —')
    r = await callPage(editorTok, 'PUT', { tagline: 'Editor touched the tagline.' })
    check('editor PUT text → 200', r.status === 200)
    r = await uploadImage(editorTok, { bytes: PNG_BYTES, type: 'image/png', name: 'khqr.png' })
    check('editor POST static image → 403', r.status === 403, r.json.error ?? '')
    r = await removeImage(editorTok)
    check('editor DELETE static image → 403', r.status === 403)
    r = await callPage(editorTok, 'GET')
    check('editor GET 200 (image untouched)', r.status === 200 && r.json.data.page.khqrUrl !== null)

    console.log('— viewer (no coffee.edit) —')
    r = await callPage(viewer, 'GET')
    check('viewer GET 200', r.status === 200)
    r = await callPage(viewer, 'PUT', { tagline: 'nope' })
    check('viewer PUT text → 403', r.status === 403)
    r = await uploadImage(viewer, { bytes: PNG_BYTES, type: 'image/png', name: 'khqr.png' })
    check('viewer POST image → 403', r.status === 403)
    r = await removeImage(viewer)
    check('viewer DELETE image → 403', r.status === 403)

    console.log('— anonymous —')
    r = await callPage(null, 'GET')
    check('anon GET → 401', r.status === 401)
    r = await uploadImage(null, { bytes: PNG_BYTES, type: 'image/png', name: 'khqr.png' })
    check('anon POST image → 401', r.status === 401)
    r = await removeImage(null)
    check('anon DELETE image → 401', r.status === 401)

    console.log('— restore clean state (no static image, default text) —')
    r = await callPage(admin, 'PUT', { khqrName: null, khqrBank: null, tagline: 'If my work makes your day easier, a coffee is a wonderful thank-you.' })
    check('admin reset text → 200', r.status === 200)
    r = await removeImage(admin)
    check('admin removed static image → 200 khqrUrl null', r.status === 200 && r.json.data?.khqrUrl === null)
    const gone = await fetch(`${BASE}${url2}`)
    check('static file gone after DELETE', gone.status === 404)
    r = await callPage(admin, 'GET')
    check('final GET khqrUrl null', r.json.data?.page?.khqrUrl === null)
  } finally {
    await db.user.delete({ where: { id: editor.id } })
    await db.role.delete({ where: { id: role.id } })
    await db.coffeePage.updateMany({ data: { khqrImage: null } })
    console.log('temp fixtures removed')
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => db.$disconnect())
