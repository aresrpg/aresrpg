// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import { createCanvas, loadImage, type Canvas, type Image } from '@napi-rs/canvas'

import { parse_portrait_query, portrait_name, type PortraitAppearance } from '../../immutable/src/portrait.ts'
import {
  parse_portrait_layout,
  TRANSPARENT_PORTRAIT,
  type PortraitLayout,
  type PortraitPoster,
  type PortraitStyle,
} from '../src/components/portrait_share.ts'
import { create_card_painter } from '../social_card_render.ts'
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

const paint_portrait = async (appearance: PortraitAppearance, style: PortraitStyle): Promise<Canvas> => {
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
  if (style.background) {
    ctx.globalCompositeOperation = 'destination-over'
    const background = await readFile(
      new URL(`../public/portrait-share/backgrounds/${style.background}.png`, import.meta.url)
    ).then(loadImage)
    ctx.drawImage(background, 0, 0)
  }
  return canvas
}

export const render_portrait = async (
  appearance: PortraitAppearance,
  style: PortraitStyle = TRANSPARENT_PORTRAIT
): Promise<Buffer> => (await paint_portrait(appearance, style)).toBuffer('image/png')

// The poster: the card a shared hero post shows, painted by the site's one card painter with the Portfolio page lit.
/** A worn item's icon, or null when the item has no icon file: the poster then shows its empty frame. */
const gear_icon = (item_type: string): Promise<Image | null> =>
  readFile(new URL(`../../../seed/icons/items/${item_type}.png`, import.meta.url))
    .then(loadImage)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })

const render_poster = async (appearance: PortraitAppearance, poster: PortraitPoster, host: string): Promise<Buffer> => {
  const [painter, portrait, gear] = await Promise.all([
    create_card_painter(),
    paint_portrait(appearance, TRANSPARENT_PORTRAIT),
    Promise.all(poster.gear.map(gear_icon)),
  ])
  const card = await painter.paint({
    kind: 'hero',
    tone: 'ember',
    bar: { lit: 'portfolio' },
    address: host,
    classe: appearance.classe,
    level: poster.level,
    name: poster.name,
    power: poster.power,
    gear,
    portrait,
  })
  return card.toBuffer('image/png')
}

const render_layout = (appearance: PortraitAppearance, layout: PortraitLayout, host: string): Promise<Buffer> =>
  layout.kind === 'poster' ? render_poster(appearance, layout.poster, host) : render_portrait(appearance, layout.style)

export const serve_portrait = async (request: Request): Promise<Response> => {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } })
  const { host, searchParams: query } = new URL(request.url)
  const appearance = parse_portrait_query(query)
  const layout = parse_portrait_layout(query)
  if (!appearance || !layout)
    return new Response('Unknown portrait, revision or palette', {
      status: 400,
      headers: { 'Cache-Control': 'no-store' },
    })
  try {
    const png = await render_layout(appearance, layout, host)
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
