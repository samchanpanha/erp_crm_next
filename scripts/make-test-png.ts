// Generates a 120x120 QR-like test PNG (dark modules on white) for E2E uploads.
// Zero dependencies — hand-rolled PNG encoder (zlib deflate + CRC32).
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

const W = 120
const H = 120

function crc32(buf: Buffer): number {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 2 // color type RGB

// deterministic pseudo-QR pattern: finder squares + hash noise
const px: boolean[][] = []
for (let y = 0; y < H; y++) {
  px[y] = []
  for (let x = 0; x < W; x++) {
    const finder =
      (x < 30 && y < 30) || (x >= W - 30 && y < 30) || (x < 30 && y >= H - 30)
    if (finder) {
      const lx = x < 30 ? x : x - (W - 30)
      const ly = y < 30 ? y : y - (H - 30)
      const ring = lx >= 4 && lx < 26 && ly >= 4 && ly < 26 && !(lx >= 8 && lx < 22 && ly >= 8 && ly < 22)
      px[y][x] = ring || (lx >= 10 && lx < 20 && ly >= 10 && ly < 20)
    } else {
      px[y][x] = ((x * 7 + y * 13 + ((x * y) % 17)) % 3) === 0
    }
  }
}

const raw = Buffer.alloc(H * (1 + W * 3))
let o = 0
for (let y = 0; y < H; y++) {
  raw[o++] = 0 // filter none
  for (let x = 0; x < W; x++) {
    const v = px[y][x] ? 40 : 255
    raw[o++] = v
    raw[o++] = v
    raw[o++] = x < 4 ? 200 : v // hint of orange edge
  }
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])

writeFileSync('guard-tmp/khqr-test.png', png)
console.log(`wrote guard-tmp/khqr-test.png (${png.length} bytes)`)
