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
  font(ctx, card.currency ? 20 : 13, 800)
  const width = ctx.measureText(card.summary).width + (card.currency ? 54 : 0)
  const x = 388 - width
  if (card.currency) {
    ctx.fillStyle = `${palette.blue}1a`
    rounded(ctx, x - 6, 12, width + 6, 24, 3)
    ctx.fill()
    ctx.fillStyle = palette.blue
    ctx.save()
    ctx.translate(x, 15)
    ctx.scale(18 / 24, 18 / 24)
    ctx.fill(new Path2D(SUI_LOGO_PATH))
    ctx.restore()
    ctx.fillText(card.summary, x + 23, 14)
    font(ctx, 10, 700)
    ctx.fillText('SUI', 370, 20)
  } else {
    ctx.fillStyle = accent
    ctx.fillText(card.summary, x, 12)
  }
  return width + 10
}
const stat_icon = async (ctx: SKRSContext2D, key: string, color: string, top: number) => {
  if (key.endsWith('_resistance')) {
    ctx.save()
    ctx.translate(87.5, top + 8.5)
    ctx.scale(19 / 24, 19 / 24)
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
  if (identity) picture(ctx, await loadImage(identity.icon), 87, top + 8, 20)
  else {
    ctx.fillStyle = color
    ctx.fillRect(93, top + 14, 8, 8)
  }
}
const stat_rows = async (ctx: SKRSContext2D, card: VisualCard, palette: Palette, y: number) => {
  for (const [index, stat] of card.stats.entries()) {
    const top = y + index * 36
    const color = stat.value < 0 ? '#ff5555' : (stat_colors[stat.key] ?? palette.ink)
    await stat_icon(ctx, stat.key, color, top)
    font(ctx, 10)
    ctx.fillStyle = color
    const value = `${stat.value < 0 ? '' : '+'}${stat.value}`
    ctx.fillText(value, 116, top + 12)
    const { width } = ctx.measureText(value)
    ctx.fillStyle = palette.ink
    line(ctx, stat.label, 124 + width, top + 12, 264 - width)
  }
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
    const canvas = createCanvas(400, 100)
    const measure = canvas.getContext('2d')
    font(measure, 10)
    const party = wrap(measure, card.party.join(' · '), 310)
    const { stats } = card
    const meta_height = card.currency ? 24 : 13
    const base = 73 + meta_height
    const height = base + (stats.length ? 12 + stats.length * 36 : 0) + (party.length ? 14 + party.length * 16 : 0)
    canvas.height = height
    const ctx = canvas.getContext('2d')
    const accent = card.tone === 'gold' ? palette.orange : palette.blue
    rounded(ctx, 0.5, 0.5, 399, height - 1, 5)
    ctx.fillStyle = palette.surface
    ctx.fill()
    ctx.save()
    ctx.clip()
    ctx.globalCompositeOperation = 'soft-light'
    ctx.fillStyle = ctx.createPattern(grain, 'repeat')!
    ctx.fillRect(0, 0, 400, height)
    ctx.restore()
    ctx.strokeStyle = `${accent}55`
    ctx.lineWidth = 1
    ctx.stroke()
    const image = await artwork(card.image)
    picture(ctx, image, 12, (base - 58) / 2, 58)
    const summary_width = summary(ctx, card, palette, accent)
    font(ctx, 9, 800)
    ctx.fillStyle = accent
    line(ctx, card.type.toUpperCase(), 82, 12 + (meta_height - 9) / 2, 306 - summary_width)
    font(ctx, 16, 800)
    ctx.fillStyle = palette.ink
    line(ctx, card.title, 82, 16 + meta_height, 306)
    font(ctx, 11)
    ctx.fillStyle = palette.muted
    line(ctx, card.subtitle, 82, 40 + meta_height, 306)
    if (party.length + stats.length > 0) {
      ctx.strokeStyle = '#ffffff0a'
      ctx.beginPath()
      ctx.moveTo(76, base - 1)
      ctx.lineTo(388, base - 1)
      ctx.stroke()
    }
    font(ctx, 10)
    ctx.fillStyle = palette.muted
    party.forEach((row, index) => line(ctx, row, 76, base + 7 + index * 16, 312))
    await stat_rows(ctx, card, palette, base + 4)
    return canvas.encode('png')
  }
}
