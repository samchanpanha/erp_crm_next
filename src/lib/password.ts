import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Password hashing with Node's built-in scrypt (no external dependencies).
 * Stored format: "s1:<salt-hex>:<hash-hex>".
 *
 * Kept free of next/imports so scripts (scripts/seed-auth.ts) can import it too.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `s1:${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [version, salt, hash] = stored.split(':')
    if (version !== 's1' || !salt || !hash) return false
    const candidate = scryptSync(password, salt, 64)
    const expected = Buffer.from(hash, 'hex')
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  } catch {
    return false
  }
}
