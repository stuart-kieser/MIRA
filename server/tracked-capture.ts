import { open } from 'node:fs/promises'
import { z } from 'zod'

const intrinsics = z.tuple([z.number().positive(), z.number().positive(), z.number(), z.number()])
const metadataSchema = z.object({
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
  frames: z.array(z.object({
    bytes: z.number().int().min(4).max(8 * 1024 ** 2),
    intrinsics,
    rotation: z.tuple([z.number(), z.number(), z.number(), z.number()])
      .refine((values) => Math.abs(Math.hypot(...values) - 1) < 0.01),
    translation: z.tuple([z.number(), z.number(), z.number()]),
  })).min(12).max(1200),
})

export async function isTrackedCapture(path: string, size: number): Promise<boolean> {
  const file = await open(path, 'r')
  try {
    const header = Buffer.alloc(12)
    if ((await file.read(header)).bytesRead !== header.length || header.toString('ascii', 0, 8) !== 'MIRACAP1') return false
    const length = header.readUInt32LE(8)
    if (length < 1 || length > 1024 ** 2 || length > size - header.length) return false
    const metadata = Buffer.alloc(length)
    if ((await file.read(metadata)).bytesRead !== length) return false
    let value: unknown
    try {
      value = JSON.parse(metadata.toString('utf8'))
    } catch {
      return false
    }
    const result = metadataSchema.safeParse(value)
    if (!result.success) return false
    const { width, height, frames } = result.data
    let offset = header.length + length
    const marker = Buffer.alloc(2)
    for (const frame of frames) {
      const [fx, fy, cx, cy] = frame.intrinsics
      if (fx > width * 10 || fy > height * 10 || cx < 0 || cx > width || cy < 0 || cy > height) return false
      if (offset + frame.bytes > size) return false
      if ((await file.read(marker, 0, 2, offset)).bytesRead !== 2 || marker.readUInt16BE() !== 0xffd8) return false
      offset += frame.bytes
      if ((await file.read(marker, 0, 2, offset - 2)).bytesRead !== 2 || marker.readUInt16BE() !== 0xffd9) return false
    }
    return offset === size
  } finally {
    await file.close()
  }
}
