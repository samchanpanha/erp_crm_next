// Task 26 verification: KHQR image changes are super-administrator-only.
// Creates a temp role+user holding coffee.edit WITHOUT "*", proves:
//   text edits still work for that editor, but khqrImage upload/remove → 403.
// Cleans up after itself and leaves the demo tenant without an image.
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'node:crypto'

const db = new PrismaClient()
const BASE = 'http://localhost:3000'
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const GIF_1PX =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

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

async function call(token: string | null, method: 'GET' | 'PUT', body?: unknown) {
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

async function main() {
  // -- temp fixtures ---------------------------------------------------------
  const tenant = await db.tenant.findFirst({ where: { name: 'Demo Organization' } })
  if (!tenant) throw new Error('demo tenant missing')
  const role = await db.role.create({
    data: {
      tenantId: tenant.id,
      name: `CoffeeEditor-Task26-${randomBytes(3).toString('hex')}`,
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
    const admin = await login('admin@dolinext.com', 'demo123')
    const viewer = await login('pat@demo.local', 'testpass123')
    const editorTok = await login(editor.email, 'editorPass123')

    console.log('— GET / super-admin view —')
    const g = await call(admin, 'GET')
    check('admin GET 200', g.status === 200)
    check('no image after cleanup', g.json.data?.page?.khqrImage === null)

    console.log('— super admin (wildcard) —')
    let r = await call(admin, 'PUT', { tagline: 'If this ERP helps you, a coffee is a lovely thank-you.' })
    check('admin PUT text-only → 200', r.status === 200)
    r = await call(admin, 'PUT', { khqrImage: PNG_1PX, khqrName: 'OWNER', khqrBank: 'Bakong · Test Bank' })
    check('admin PUT khqrImage → 200', r.status === 200, r.json.data?.page?.khqrImage ? 'image stored' : '')
    r = await call(admin, 'PUT', { khqrImage: GIF_1PX })
    check('admin PUT GIF rejected → 400', r.status === 400)

    console.log('— coffee.edit WITHOUT wildcard (delegated editor) —')
    r = await call(editorTok, 'PUT', { tagline: 'Editor touched the tagline.' })
    check('editor PUT text-only → 200', r.status === 200)
    r = await call(editorTok, 'PUT', { khqrImage: PNG_1PX })
    check('editor PUT khqrImage → 403 super-admin-only', r.status === 403, r.json.error ?? '')
    r = await call(editorTok, 'PUT', { khqrImage: null })
    check('editor REMOVE khqrImage → 403', r.status === 403)
    r = await call(editorTok, 'GET')
    check('editor GET 200 (image untouched)', r.status === 200 && r.json.data.page.khqrImage !== null)

    console.log('— viewer (no coffee.edit) —')
    r = await call(viewer, 'GET')
    check('viewer GET 200', r.status === 200)
    r = await call(viewer, 'PUT', { tagline: 'nope' })
    check('viewer PUT text → 403', r.status === 403)
    r = await call(viewer, 'PUT', { khqrImage: PNG_1PX })
    check('viewer PUT image → 403', r.status === 403)

    console.log('— anonymous —')
    r = await call(null, 'GET')
    check('anon GET → 401', r.status === 401)
    r = await call(null, 'PUT', { khqrImage: PNG_1PX })
    check('anon PUT → 401', r.status === 401)

    console.log('— restore clean state —')
    r = await call(admin, 'PUT', { khqrImage: null, khqrName: null, khqrBank: null, tagline: 'If my work makes your day easier, a coffee is a wonderful thank-you.' })
    check('admin cleared image → 200', r.status === 200 && r.json.data.page.khqrImage === null)
  } finally {
    await db.user.delete({ where: { id: editor.id } })
    await db.role.delete({ where: { id: role.id } })
    console.log('temp fixtures removed')
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => db.$disconnect())
