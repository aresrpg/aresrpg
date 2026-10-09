// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable no-param-reassign, fp-law/no-mutating-methods -- Canvas2D helpers paint only the call-owned surface at this rendering boundary. */
import { readFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { createCanvas, GlobalFonts, loadImage, Path2D, type SKRSContext2D, type Image } from '@napi-rs/canvas'
import { stat_colors, stat_identities, resistance_shape } from '@aresrpg/ui/identity'
import { SUI_LOGO_PATH } from '@aresrpg/ui/sui'

import type { VisualCard } from './model.ts'

type Palette = Readonly<Record<'bg' | 'surface' | 'raised' | 'ink' | 'muted' | 'orange' | 'blue', string>>
const ui_file = (path: string) => fileURLToPath(new URL(`../../ui/src/${path}`, import.meta.url))
// Discord shows a bare image attachment at up to 550 CSS pixels; twice that keeps it sharp.
const SCALE = 2
const WIDTH = 550
const PAD = 16
const ART = 100
const TEXT_X = PAD + ART + 16
const TEXT_WIDTH = WIDTH - PAD - TEXT_X
const HERO = PAD * 2 + ART
const STAT_ROW = 30
const STAT_COLUMN = (WIDTH - PAD * 2) / 2
const PARTY_ROW = 20
const rounded = (ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
}
const font = (ctx: SKRSContext2D, size: number, weight = 400) => {
  ctx.font = `${weight} ${size}px "Ares UI"`
  ctx.textBaseline = 'top'
}
const line = (ctx: SKRSContext2D, text: string, x: number, y: number, width: number) => {
  const points = Array.from(text)
  if (width <= 0) return
  while (points.length > 1 && ctx.measureText(points.join('')).width > width) points.splice(-2, 2, '…')
  ctx.fillText(points.join(''), x, y)
}
const wrap = (ctx: SKRSContext2D, text: string, width: number): readonly string[] =>
  text
    .split(' ')
    .filter(Boolean)
    .reduce<string[]>((lines, word) => {
      const last = lines.at(-1)
      if (last && ctx.measureText(`${last} ${word}`).width <= width) return [...lines.slice(0, -1), `${last} ${word}`]
      return [...lines, word]
    }, [])
const picture = (ctx: SKRSContext2D, image: Image, x: number, y: number, size: number) => {
  const scale = size / Math.max(image.width, image.height)
  const width = image.width * scale,
    height = image.height * scale
  ctx.drawImage(image, x + (size - width) / 2, y + (size - height) / 2, width, height)
}
const summary = (ctx: SKRSContext2D, card: VisualCard, palette: Palette, accent: string): number => {
  if (!card.summary) return 0
  font(ctx, 22, 800)
  const right = WIDTH - PAD
  if (!card.currency) {
    const { width } = ctx.measureText(card.summary)
    ctx.fillStyle = accent
    ctx.fillText(card.summary, right - width, 18)
    return width + 12
  }
  const amount = ctx.measureText(card.summary).width
  const width = amount + 68
  const x = right - width
  ctx.fillStyle = `${palette.blue}1f`
  rounded(ctx, x, 14, width, 32, 4)
  ctx.fill()
  ctx.fillStyle = palette.blue
  ctx.save()
  ctx.translate(x + 8, 20)
  ctx.scale(20 / 24, 20 / 24)
  ctx.fill(new Path2D(SUI_LOGO_PATH))
  ctx.restore()
  ctx.fillText(card.summary, x + 34, 18)
  font(ctx, 11, 700)
  ctx.fillText('SUI', x + 39 + amount, 27)
  return width + 12
}
const stat_icon = async (ctx: SKRSContext2D, key: string, color: string, x: number, top: number) => {
  if (key.endsWith('_resistance')) {
    ctx.save()
    ctx.translate(x + 0.5, top + 4.5)
    ctx.scale(21 / 24, 21 / 24)
    const shape = new Path2D(resistance_shape)
    ctx.fillStyle = color
    ctx.globalAlpha = 0.16
    ctx.fill(shape)
    ctx.globalAlpha = 1
    ctx.strokeStyle = color
    ctx.lineWidth = 1.7
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke(shape)
    ctx.restore()
    return
  }
  const identity = stat_identities[key]
  if (identity) picture(ctx, await loadImage(identity.icon), x, top + 4, 22)
  else {
    ctx.fillStyle = color
    ctx.fillRect(x + 7, top + 11, 8, 8)
  }
}
const stat_rows = async (ctx: SKRSContext2D, card: VisualCard, palette: Palette, y: number) => {
  for (const [index, stat] of card.stats.entries()) {
    const x = PAD + (index % 2) * STAT_COLUMN
    const top = y + Math.floor(index / 2) * STAT_ROW
    const color = stat.value < 0 ? '#ff5555' : (stat_colors[stat.key] ?? palette.ink)
    await stat_icon(ctx, stat.key, color, x, top)
    font(ctx, 14, 800)
    ctx.fillStyle = color
    const value = `${stat.value < 0 ? '' : '+'}${stat.value}`
    ctx.fillText(value, x + 30, top + 7)
    const { width } = ctx.measureText(value)
    font(ctx, 14)
    ctx.fillStyle = palette.ink
    line(ctx, stat.label, x + 37 + width, top + 7, STAT_COLUMN - 49 - width)
  }
}
/** Accent frame with brighter corner brackets; one rounded path stroked twice. */
const frame = (ctx: SKRSContext2D, height: number, accent: string) => {
  rounded(ctx, 1, 1, WIDTH - 2, height - 2, 8)
  ctx.strokeStyle = `${accent}66`
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.save()
  const corner = new Path2D()
  for (const x of [0, WIDTH - 22]) for (const y of [0, height - 22]) corner.rect(x, y, 22, 22)
  ctx.clip(corner)
  rounded(ctx, 1, 1, WIDTH - 2, height - 2, 8)
  ctx.strokeStyle = accent
  ctx.lineWidth = 2.5
  ctx.stroke()
  ctx.restore()
}
const surface = (ctx: SKRSContext2D, height: number, palette: Palette, accent: string, grain: Image) => {
  rounded(ctx, 1, 1, WIDTH - 2, height - 2, 8)
  ctx.save()
  ctx.clip()
  const shade = ctx.createLinearGradient(0, 0, 0, height)
  shade.addColorStop(0, palette.surface)
  shade.addColorStop(1, palette.bg)
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, WIDTH, height)
  const wash = ctx.createRadialGradient(PAD + ART / 2, PAD + ART / 2, 0, PAD + ART / 2, PAD + ART / 2, 260)
  wash.addColorStop(0, `${accent}24`)
  wash.addColorStop(1, `${accent}00`)
  ctx.fillStyle = wash
  ctx.fillRect(0, 0, WIDTH, height)
  ctx.globalCompositeOperation = 'soft-light'
  ctx.fillStyle = ctx.createPattern(grain, 'repeat')!
  ctx.fillRect(0, 0, WIDTH, height)
  ctx.restore()
}
const hero = (ctx: SKRSContext2D, card: VisualCard, palette: Palette, accent: string, image: Image) => {
  rounded(ctx, PAD, PAD, ART, ART, 6)
  ctx.fillStyle = `${palette.bg}cc`
  ctx.fill()
  ctx.strokeStyle = '#ffffff14'
  ctx.lineWidth = 1
  ctx.stroke()
  picture(ctx, image, PAD + 8, PAD + 8, ART - 16)
  const summary_width = summary(ctx, card, palette, accent)
  font(ctx, 11, 800)
  ctx.letterSpacing = '1.4px'
  ctx.fillStyle = accent
  line(ctx, card.type.toUpperCase(), TEXT_X, 25, TEXT_WIDTH - summary_width)
  ctx.letterSpacing = '0px'
  font(ctx, 24, 800)
  ctx.fillStyle = palette.ink
  line(ctx, card.title, TEXT_X, 50, TEXT_WIDTH)
  font(ctx, 14)
  ctx.fillStyle = palette.muted
  line(ctx, card.subtitle, TEXT_X, 86, TEXT_WIDTH)
}

export const create_renderer = async (warn: (message: string) => void = console.warn) => {
  const css = await readFile(ui_file('base.css'), 'utf8')
  const palette = Object.fromEntries(
    ['bg', 'surface', 'raised', 'ink', 'muted', 'orange', 'blue'].map((name) => {
      const value = css.match(new RegExp(`--aui-${name}:\\s*(#[0-9a-f]+);`, 'i'))?.[1]
      if (!value) throw new Error(`Missing shared UI color: ${name}`)
      return [name, value]
    })
  ) as Palette
  for (const weight of [400, 700, 800]) {
    if (!GlobalFonts.registerFromPath(ui_file(`assets/font/nunito-${weight}.ttf`), 'Ares UI'))
      throw new Error('Card font failed to load')
  }
  const grain = await loadImage(ui_file('assets/panel_grain.webp'))
  const fallback = await loadImage(ui_file('assets/carved_inventory.webp'))
  const artwork = async (path: string | null): Promise<Image> => {
    if (!path) return fallback
    try {
      await access(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      warn(`Notification artwork missing: ${path.split('/').at(-1)}`)
      return fallback
    }
    return loadImage(path)
  }
  return async (card: VisualCard): Promise<Uint8Array> => {
    const canvas = createCanvas(WIDTH * SCALE, HERO * SCALE)
    const measure = canvas.getContext('2d')
    font(measure, 14)
    const party = wrap(measure, card.party.join('  ·  '), WIDTH - PAD * 2)
    const stat_height = card.stats.length ? 20 + Math.ceil(card.stats.length / 2) * STAT_ROW : 0
    const height = HERO + stat_height + (party.length ? 24 + party.length * PARTY_ROW : 0)
    canvas.height = height * SCALE
    const ctx = canvas.getContext('2d')
    ctx.scale(SCALE, SCALE)
    const accent = card.tone === 'gold' ? palette.orange : palette.blue
    surface(ctx, height, palette, accent, grain)
    hero(ctx, card, palette, accent, await artwork(card.image))
    if (height > HERO) {
      const rule = ctx.createLinearGradient(PAD, 0, WIDTH - PAD, 0)
      rule.addColorStop(0, '#ffffff1f')
      rule.addColorStop(1, '#ffffff00')
      ctx.fillStyle = rule
      ctx.fillRect(PAD, HERO - 1, WIDTH - PAD * 2, 1)
    }
    font(ctx, 14, 700)
    ctx.fillStyle = palette.ink
    party.forEach((row, index) => line(ctx, row, PAD, HERO + 12 + index * PARTY_ROW, WIDTH - PAD * 2))
    await stat_rows(ctx, card, palette, HERO + 10)
    frame(ctx, height, accent)
    return canvas.encode('png')
  }
}
