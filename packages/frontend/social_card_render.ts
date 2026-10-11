// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Paints the data-bearing social cards. Hand-composed page cards are authored art under
// seed/icons/social; anything quoting content derives here so a content change cannot go stale.
/* eslint-disable no-param-reassign -- Canvas2D helpers paint only the call-owned surface at this rendering boundary. */

import { readFile } from 'node:fs/promises'

import { createCanvas, GlobalFonts, loadImage, type Canvas, type Image, type SKRSContext2D } from '@napi-rs/canvas'

export const SOCIAL_CARD_WIDTH = 1200
export const SOCIAL_CARD_HEIGHT = 630
const PAD = 72
const FONT = 'Ares Social'
const PROBE = 64
const TEXT_X = 540
const TEXT_WIDTH = SOCIAL_CARD_WIDTH - PAD - TEXT_X
const TITLE_SIZES = Object.freeze([52, 46, 40, 34])
const PALETTE_NAMES = Object.freeze([
  'bg',
  'surface',
  'surface-raised',
  'border',
  'gold',
  'gold-light',
  'text',
  'muted',
])

type Palette = Readonly<Record<(typeof PALETTE_NAMES)[number], string>>
type Type = Readonly<{ size: number; weight: number; tracking?: number }>
export type EntityCard = Readonly<{
  accent: string
  art_path: string
  crumb: string
  detail: string
  rows: readonly (readonly [label: string, value: string])[]
  title: string
}>
export type EncyclopediaCard = Readonly<{
  art_paths: readonly string[]
  counts: readonly (readonly [count: number, label: string])[]
}>

const MICRO: Type = Object.freeze({ size: 17, weight: 500, tracking: 3.74 })

const set_type = (ctx: SKRSContext2D, { size, weight, tracking = 0 }: Type) => {
  ctx.font = `${weight} ${size}px "${FONT}"`
  ctx.letterSpacing = `${tracking}px`
  ctx.textBaseline = 'top'
}
/** Draws one line, shortening with an ellipsis when it exceeds `width`; returns the drawn width. */
const line = (ctx: SKRSContext2D, text: string, x: number, y: number, width: number, align: 'left' | 'right') => {
  const points = Array.from(text)
  while (points.length > 1 && ctx.measureText(points.join('')).width > width) points.splice(-2, 2, '…')
  const fitted = points.join('')
  const drawn = ctx.measureText(fitted).width
  ctx.fillText(fitted, align === 'left' ? x : x - drawn, y)
  return drawn
}
/** Opaque source rectangle, so icons authored with wide transparent margins still fill their tile. */
const opaque_bounds = (image: Image) => {
  const probe = createCanvas(PROBE, PROBE).getContext('2d')
  probe.drawImage(image, 0, 0, PROBE, PROBE)
  const { data } = probe.getImageData(0, 0, PROBE, PROBE)
  const cells = Array.from({ length: PROBE * PROBE }, (_, cell) => cell).filter((cell) => data[cell * 4 + 3]! > 16)
  if (!cells.length) return { x: 0, y: 0, width: image.width, height: image.height }
  const columns = cells.map((cell) => cell % PROBE)
  const rows = cells.map((cell) => Math.floor(cell / PROBE))
  const [left, top] = [Math.min(...columns), Math.min(...rows)]
  const unit = { x: image.width / PROBE, y: image.height / PROBE }
  return {
    x: left * unit.x,
    y: top * unit.y,
    width: (Math.max(...columns) + 1 - left) * unit.x,
    height: (Math.max(...rows) + 1 - top) * unit.y,
  }
}
const contain = (ctx: SKRSContext2D, image: Image, x: number, y: number, size: number) => {
  const source = opaque_bounds(image)
  const scale = size / Math.max(source.width, source.height)
  const width = source.width * scale
  const height = source.height * scale
  ctx.drawImage(
    image,
    source.x,
    source.y,
    source.width,
    source.height,
    x + (size - width) / 2,
    y + (size - height) / 2,
    width,
    height
  )
}
const surface = (ctx: SKRSContext2D, palette: Palette) => {
  ctx.fillStyle = palette.bg
  ctx.fillRect(0, 0, SOCIAL_CARD_WIDTH, SOCIAL_CARD_HEIGHT)
  const glow = ctx.createRadialGradient(1020, 63, 0, 1020, 63, 640)
  glow.addColorStop(0, '#4a3e8c47')
  glow.addColorStop(1, '#4a3e8c00')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, SOCIAL_CARD_WIDTH, SOCIAL_CARD_HEIGHT)
  ctx.fillStyle = '#ffffff06'
  for (let x = 0; x < SOCIAL_CARD_WIDTH; x += 40) ctx.fillRect(x, 0, 1, SOCIAL_CARD_HEIGHT)
  for (let y = 0; y < SOCIAL_CARD_HEIGHT; y += 40) ctx.fillRect(0, y, SOCIAL_CARD_WIDTH, 1)
}
const tile = (ctx: SKRSContext2D, palette: Palette, x: number, y: number, size: number) => {
  const shade = ctx.createRadialGradient(x + size / 2, y + size * 0.45, 0, x + size / 2, y + size * 0.45, size * 0.7)
  shade.addColorStop(0, palette['surface-raised'])
  shade.addColorStop(1, palette.surface)
  ctx.fillStyle = shade
  ctx.fillRect(x, y, size, size)
  ctx.strokeStyle = palette.border
  ctx.lineWidth = 1
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1)
}
const stat_rows = (ctx: SKRSContext2D, palette: Palette, rows: EntityCard['rows']) => {
  rows.forEach(([label, value], index) => {
    const y = 236 + index * 49
    set_type(ctx, { size: 24, weight: 400 })
    ctx.fillStyle = palette.text
    const label_width = line(ctx, label, TEXT_X, y, TEXT_WIDTH / 2, 'left')
    set_type(ctx, { size: 24, weight: 600 })
    ctx.fillStyle = palette['gold-light']
    line(ctx, value, SOCIAL_CARD_WIDTH - PAD, y, TEXT_WIDTH - label_width - 24, 'right')
    ctx.fillStyle = palette.border
    ctx.fillRect(TEXT_X, y + 38, TEXT_WIDTH, 1)
  })
}

export const create_social_renderer = async ({
  font_path,
  logo_path,
  tokens_path,
}: Readonly<{ font_path: string; logo_path: string; tokens_path: string }>) => {
  const tokens = await readFile(tokens_path, 'utf8')
  const palette = Object.fromEntries(
    PALETTE_NAMES.map((name) => {
      const value = tokens.match(new RegExp(`--color-${name}:\\s*(#[0-9a-f]+);`, 'i'))?.[1]
      if (!value) throw new Error(`Missing frontend color token: ${name}`)
      return [name, value]
    })
  ) as Palette
  if (!GlobalFonts.registerFromPath(font_path, FONT)) throw new Error('Social card font failed to load')
  const logo = await loadImage(logo_path)
  const logo_height = (150 * logo.height) / logo.width
  const encode = (canvas: Canvas): Promise<Uint8Array> => canvas.encode('jpeg', 84)
  const blank = () => {
    const canvas = createCanvas(SOCIAL_CARD_WIDTH, SOCIAL_CARD_HEIGHT)
    const ctx = canvas.getContext('2d')
    surface(ctx, palette)
    return { canvas, ctx }
  }

  const entity = async (card: EntityCard): Promise<Uint8Array> => {
    const { canvas, ctx } = blank()
    tile(ctx, palette, PAD, 112, 406)
    contain(ctx, await loadImage(card.art_path), PAD + 28, 140, 350)
    set_type(ctx, MICRO)
    ctx.fillStyle = palette.gold
    const accent_width = line(ctx, card.accent.toUpperCase(), TEXT_X, 106, TEXT_WIDTH, 'left')
    ctx.fillStyle = palette.muted
    line(ctx, ` · ${card.detail}`.toUpperCase(), TEXT_X + accent_width, 106, TEXT_WIDTH - accent_width, 'left')
    const fits = (size: number) => {
      set_type(ctx, { size, weight: 700, tracking: -1 })
      return ctx.measureText(card.title).width <= TEXT_WIDTH
    }
    set_type(ctx, { size: TITLE_SIZES.find(fits) ?? TITLE_SIZES.at(-1)!, weight: 700, tracking: -1 })
    ctx.fillStyle = palette.text
    line(ctx, card.title, TEXT_X, 142, TEXT_WIDTH, 'left')
    stat_rows(ctx, palette, card.rows)
    ctx.drawImage(logo, TEXT_X, SOCIAL_CARD_HEIGHT - 62 - logo_height, 150, logo_height)
    set_type(ctx, MICRO)
    ctx.fillStyle = palette.muted
    line(
      ctx,
      card.crumb.toUpperCase(),
      SOCIAL_CARD_WIDTH - PAD,
      SOCIAL_CARD_HEIGHT - 62 - 20,
      TEXT_WIDTH - 180,
      'right'
    )
    return encode(canvas)
  }

  const encyclopedia = async (card: EncyclopediaCard): Promise<Uint8Array> => {
    const { canvas, ctx } = blank()
    const art = await Promise.all(card.art_paths.map((path) => loadImage(path)))
    ctx.save()
    ctx.translate(590, 20)
    ctx.rotate((-4 * Math.PI) / 180)
    art.forEach((image, index) => {
      const x = (index % 5) * 130
      const y = Math.floor(index / 5) * 130
      tile(ctx, palette, x, y, 120)
      contain(ctx, image, x + 13, y + 13, 94)
    })
    ctx.restore()
    const fade = ctx.createLinearGradient(0, 0, SOCIAL_CARD_WIDTH, 0)
    fade.addColorStop(0.38, palette.bg)
    fade.addColorStop(0.56, `${palette.bg}bf`)
    fade.addColorStop(0.8, `${palette.bg}00`)
    ctx.fillStyle = fade
    ctx.fillRect(0, 0, SOCIAL_CARD_WIDTH, SOCIAL_CARD_HEIGHT)
    ctx.drawImage(logo, PAD, 62, 150, logo_height)
    set_type(ctx, MICRO)
    ctx.fillStyle = palette.gold
    ctx.fillText('ENCYCLOPEDIA', PAD, 196)
    set_type(ctx, { size: 76, weight: 700, tracking: -1.5 })
    ctx.fillStyle = palette.text
    ctx.fillText('Everything in', PAD, 232)
    ctx.fillText('the world.', PAD, 312)
    card.counts.reduce((x, [count, label]) => {
      set_type(ctx, { size: 42, weight: 700 })
      ctx.fillStyle = palette['gold-light']
      const count_width = line(ctx, String(count), x, 436, 200, 'left')
      set_type(ctx, MICRO)
      ctx.fillStyle = palette.muted
      const label_width = line(ctx, label.toUpperCase(), x, 492, 200, 'left')
      return x + Math.max(count_width, label_width) + 34
    }, PAD)
    ctx.fillText('ARESRPG.WORLD/ENCYCLOPEDIA', PAD, SOCIAL_CARD_HEIGHT - 62 - 20)
    return encode(canvas)
  }

  return Object.freeze({ encyclopedia, entity })
}
