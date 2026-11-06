// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { createCanvas, loadImage } from '@napi-rs/canvas'

import { parse_portrait_query, portrait_name, type PortraitAppearance } from '../../immutable/src/portrait.ts'
import manifest from '../../../seed/portraits/manifest.json' with { type: 'json' }

const linear_channel = (value: number): number => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
const palette_channel = (color: number, channel: number): number =>
  linear_channel(((color >> (16 - channel * 8)) & 255) / 255)

// Painted lightness is retained inside authored masks. Alpha and unmasked pixels are copied
// byte for byte. The linear palette matches the engine's color texture multiplication.
export const color_portrait_pixels = (
  source: Uint8ClampedArray,
  mask: Uint8ClampedArray,
  centers: readonly number[],
  colors: readonly number[],
  gains: readonly number[] = [0.86, 0.86, 0.86]
): Uint8ClampedArray => {
  const output = new Uint8ClampedArray(source)
  const palette = colors.map((color) => [0, 1, 2].map((channel) => palette_channel(color, channel)))
  for (let offset = 0; offset < source.length; offset += 4) {
    const rgb = [source[offset]!, source[offset + 1]!, source[offset + 2]!]
    const lightness = (Math.max(...rgb) + Math.min(...rgb)) / 510
    const highlight = Math.max(0, Math.min(1, (lightness - 0.8) / 0.19)) * 0.13
    for (let slot = 0; slot < 3; slot++) {
      const weight = mask[offset + slot]! / 255
      if (!weight) continue
      for (let channel = 0; channel < 3; channel++) {
        const shade = Math.min(1, ((palette[slot]![channel]! * lightness) / centers[slot]!) * gains[slot]!)
        output[offset + channel] =
          source[offset + channel]! * (1 - weight) + 255 * (shade * (1 - highlight) + highlight) * weight
      }
    }
  }
  return output
}

export const render_portrait = async (appearance: PortraitAppearance): Promise<Buffer> => {
  const name = portrait_name(appearance)
  if (!name) throw new Error('Unknown portrait')
  const entry = manifest.portraits[name as keyof typeof manifest.portraits]
  const [source_image, mask_image] = await Promise.all([
    readFile(new URL(`../../../seed/icons/characters/${name}_hd.png`, import.meta.url)).then(loadImage),
    readFile(new URL(`../../../seed/portraits/${name}.png`, import.meta.url)).then(loadImage),
  ])
  const canvas = createCanvas(source_image.width, source_image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source_image, 0, 0)
  const source = ctx.getImageData(0, 0, canvas.width, canvas.height)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(mask_image, 0, 0)
  const mask = ctx.getImageData(0, 0, canvas.width, canvas.height)
  source.data.set(
    color_portrait_pixels(
      source.data,
      mask.data,
      entry.centers,
      [appearance.color_1, appearance.color_2, appearance.color_3],
      entry.gains
    )
  )
  ctx.putImageData(source, 0, 0)
  return canvas.toBuffer('image/png')
}

export const serve_portrait = async (request: Request): Promise<Response> => {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
  const appearance = parse_portrait_query(new URL(request.url).searchParams)
  if (!appearance)
    return new Response('Unknown portrait, revision or palette', {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    })
  try {
    const png = await render_portrait(appearance)
    const etag = `"${createHash('sha256').update(png).digest('hex')}"`
    const headers = {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
    }
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(png), { headers })
  } catch (error) {
    console.error('Portrait rendering failed', error)
    return new Response('Portrait unavailable', { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
