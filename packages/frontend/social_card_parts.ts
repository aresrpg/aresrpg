// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The link-card painter's parts: type that fits its box, the site's hairline carbon cards, and the objects a page card
// shows beside its words. Only `social_card_render.ts` composes them into a card.
/* eslint-disable no-param-reassign -- Canvas2D helpers paint only the call-owned surface at this rendering boundary. */

import { readFile } from 'node:fs/promises'

import {
  createCanvas,
  loadImage,
  type Canvas,
  type CanvasPattern,
  type Image,
  type SKRSContext2D,
} from '@napi-rs/canvas'

import type { SitePage } from './src/site/routes.ts'

/** A file path, or art already in hand (a hero's coloured portrait). */
export type CardArt = string | Image | Canvas
export type Colors = Readonly<
  Record<
    | 'void'
    | 'bg'
    | 'surface'
    | 'raised'
    | 'lifted'
    | 'steel'
    | 'faint'
    | 'muted'
    | 'soft'
    | 'ink'
    | 'brass'
    | 'brass_hi'
    | 'brass_lo'
    | 'orange'
    | 'sui',
    string
  >
>
/** What one card's painting shares: its surface, the palette, the helmet, the bar's labels and the bar's weave. */
export type Kit = Readonly<{
  ctx: SKRSContext2D
  colors: Colors
  helmet: Image
  labels: Readonly<Record<SitePage | 'play', string>>
  weave: CanvasPattern
}>
/** The families the painter registers from the site's font files. */
export const TYPE = Object.freeze({
  title: 'Ares Title',
  ui: 'Ares UI',
  mono: 'Ares Mono',
  pixel: 'Ares Pixel',
})

/** Reads the named `--aui-*` colors from the UI's token sheet, so a card paints with the site's own palette. */
export const read_ui_colors = async <Name extends string>(
  tokens_path: string,
  tokens: Readonly<Record<Name, string>>
): Promise<Readonly<Record<Name, string>>> => {
  const css = await readFile(tokens_path, 'utf8')
  return Object.fromEntries(
    Object.entries<string>(tokens).map(([name, token]) => {
      const value = css.match(new RegExp(`--aui-${token}:\\s*(#[0-9a-f]+);`, 'i'))?.[1]
      if (!value) throw new Error(`Missing UI color token: ${token}`)
      return [name, value]
    })
  ) as Record<Name, string>
}
export const load_art = (art: CardArt): Promise<Image | Canvas> =>
  typeof art === 'string' ? loadImage(art) : Promise.resolve(art)
export const hex_alpha = (hex: string, alpha: number): string =>
  hex +
  Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')

/* ---------- Type ---------- */
export const set_font = (ctx: SKRSContext2D, weight: number, size: number, family: string, track = 0): void => {
  ctx.font = `${weight} ${size}px "${family}"`
  ctx.letterSpacing = `${(track * size).toFixed(2)}px`
}
const width_of = (ctx: SKRSContext2D, text: string): number => ctx.measureText(text).width
/** The text as is when it fits, else shortened with an ellipsis. */
export const fit_one = (ctx: SKRSContext2D, text: string, width: number): string => {
  if (width_of(ctx, text) <= width) return text
  const points = Array.from(text)
  while (points.length > 1 && width_of(ctx, `${points.join('')}…`) > width) points.pop()
  return `${points.join('').trimEnd()}…`
}
const wrap = (ctx: SKRSContext2D, text: string, width: number): readonly string[] =>
  text.split(' ').reduce<readonly string[]>((lines, word) => {
    const current = lines.at(-1)
    if (current === undefined) return [word]
    const next = `${current} ${word}`
    return width_of(ctx, next) > width ? [...lines, word] : [...lines.slice(0, -1), next]
  }, [])
/** The narrowest width that keeps `count` lines: a title breaks into even lines, never a one-word widow. */
const balance = (ctx: SKRSContext2D, text: string, width: number, count: number): readonly string[] => {
  const [, narrowest] = Array.from({ length: 14 }).reduce<readonly [number, number]>(
    ([low, high]) => {
      const middle = (low + high) / 2
      return wrap(ctx, text, middle).length <= count ? [low, middle] : [middle, high]
    },
    [width * 0.4, width]
  )
  return wrap(ctx, text, narrowest)
}
export type Fitted = Readonly<{ size: number; lines: readonly string[]; weight: number; family: string; track: number }>
type FitOptions = Readonly<{
  width: number
  sizes: readonly number[]
  lines: number
  weight?: number
  family?: string
  track?: number
}>
/** The largest size at which the text fits its lines; below the smallest size, the last line ends in an ellipsis. */
export const fit = (ctx: SKRSContext2D, text: string, options: FitOptions): Fitted => {
  const { width, sizes, lines, weight = 700, family = TYPE.title, track = 0 } = options
  const fits = (size: number): boolean => {
    set_font(ctx, weight, size, family, track)
    const wrapped = wrap(ctx, text, width)
    return wrapped.length <= lines && wrapped.every((line) => width_of(ctx, line) <= width)
  }
  const size = sizes.find(fits)
  if (size !== undefined) {
    set_font(ctx, weight, size, family, track)
    const wrapped = wrap(ctx, text, width)
    const shown = family === TYPE.title && wrapped.length > 1 ? balance(ctx, text, width, wrapped.length) : wrapped
    return { size, lines: shown, weight, family, track }
  }
  const floor = sizes.at(-1)!
  set_font(ctx, weight, floor, family, track)
  const wrapped = wrap(ctx, text, width)
  const kept = [...wrapped.slice(0, lines - 1), wrapped.slice(lines - 1).join(' ')]
  return { size: floor, lines: kept.map((line) => fit_one(ctx, line, width)), weight, family, track }
}
/** Text where the word SUI takes the Sui blue. */
const rich = (ctx: SKRSContext2D, text: string, x: number, y: number, color: string, sui: string): void =>
  void text
    .split(/(SUI)/)
    .filter(Boolean)
    .reduce((left, part) => {
      ctx.fillStyle = part === 'SUI' ? sui : color
      ctx.fillText(part, left, y)
      return left + width_of(ctx, part)
    }, x)
type BlockOptions = Readonly<{ line_height: number; color: string; sui: string; cap?: number }>
/** Draws a fitted block from its top; returns the last line's baseline. */
export const block = (ctx: SKRSContext2D, fitted: Fitted, x: number, top: number, options: BlockOptions): number => {
  const { line_height, color, sui, cap = 0.72 } = options
  set_font(ctx, fitted.weight, fitted.size, fitted.family, fitted.track)
  const first = top + fitted.size * cap
  fitted.lines.forEach((line, index) => rich(ctx, line, x, first + index * fitted.size * line_height, color, sui))
  return first + (fitted.lines.length - 1) * fitted.size * line_height
}
type SayOptions = Readonly<{
  weight?: number
  size: number
  family?: string
  color: string
  sui?: string
  track?: number
  max_width?: number
  align?: 'left' | 'right' | 'center'
  caps?: boolean
}>
/** One line at a baseline, shortened to its width; returns the drawn width. */
export const say = (ctx: SKRSContext2D, text: string, x: number, y: number, options: SayOptions): number => {
  const { weight = 400, size, family = TYPE.ui, color, track = 0, max_width = 4000, align = 'left' } = options
  set_font(ctx, weight, size, family, track)
  const shown = fit_one(ctx, options.caps ? text.toUpperCase() : text, max_width)
  const width = width_of(ctx, shown)
  const left = { left: x, right: x - width, center: x - width / 2 }[align]
  rich(ctx, shown, left, y, color, options.sui ?? color)
  return width
}
/** Small capitals joined by middle dots: the first part in the first colour, the rest in the last. */
export const kicker = (
  ctx: SKRSContext2D,
  parts: readonly string[],
  x: number,
  y: number,
  colors: readonly string[],
  max_width: number
): void =>
  void parts.reduce((left, part, index) => {
    set_font(ctx, 800, 17, TYPE.ui, 0.14)
    ctx.fillStyle = colors[Math.min(index, colors.length - 1)]!
    const shown = fit_one(ctx, `${index ? ' · ' : ''}${part.toUpperCase()}`, Math.max(10, x + max_width - left))
    ctx.fillText(shown, left, y)
    return left + width_of(ctx, shown)
  }, x)

/* ---------- Art ---------- */
const PROBE = 64
/** Opaque source rectangle, so art authored with wide transparent margins still fills its box. */
const opaque_bounds = (image: Image | Canvas) => {
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
/** Draws the art's opaque part inside the box, keeping its proportions; `ax` and `ay` place it (0.5 centres it). */
export const contain = (
  ctx: SKRSContext2D,
  image: Image | Canvas,
  x: number,
  y: number,
  width: number,
  height: number,
  ax = 0.5,
  ay = 0.5
): void => {
  const source = opaque_bounds(image)
  const scale = Math.min(width / source.width, height / source.height)
  const [drawn_width, drawn_height] = [source.width * scale, source.height * scale]
  ctx.drawImage(
    image,
    source.x,
    source.y,
    source.width,
    source.height,
    x + (width - drawn_width) * ax,
    y + (height - drawn_height) * ay,
    drawn_width,
    drawn_height
  )
}

/* ---------- Surfaces ---------- */
export const rrect = (ctx: SKRSContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  ctx.beginPath()
  ctx.roundRect(x, y, width, height, radius)
}
export const frame = (
  ctx: SKRSContext2D,
  [x, y, width, height]: readonly number[],
  radius: number,
  hex: string,
  alpha: number
): void => {
  rrect(ctx, x! + 0.5, y! + 0.5, width! - 1, height! - 1, radius)
  ctx.strokeStyle = hex_alpha(hex, alpha)
  ctx.lineWidth = 1
  ctx.stroke()
}
/** A 1px line that fades to nothing at both ends: the house hairline. */
export const hairline = (ctx: SKRSContext2D, from: number, to: number, y: number, hex: string, alpha: number) => {
  const fade = ctx.createLinearGradient(from, 0, to, 0)
  fade.addColorStop(0, hex_alpha(hex, 0))
  fade.addColorStop(0.22, hex_alpha(hex, alpha))
  fade.addColorStop(0.78, hex_alpha(hex, alpha))
  fade.addColorStop(1, hex_alpha(hex, 0))
  ctx.fillStyle = fade
  ctx.fillRect(from, Math.round(y), to - from, 1)
}
/** A void veil across the card: stops are [position, alpha], across or down. */
export const veil = (ctx: SKRSContext2D, hex: string, stops: readonly (readonly [number, number])[], down: boolean) => {
  const gradient = down ? ctx.createLinearGradient(0, 0, 0, 630) : ctx.createLinearGradient(0, 0, 1200, 0)
  stops.forEach(([position, alpha]) => gradient.addColorStop(position, hex_alpha(hex, alpha)))
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 1200, 630)
}
/** The bar's woven carbon: two 45° threads every 3px, as site_shell.css draws it. */
export const weave_tile = (colors: Colors): Canvas => {
  const tile_canvas = createCanvas(3, 3)
  const ctx = tile_canvas.getContext('2d')
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 3; x++) {
      const thread =
        (x + y) % 3 === 0 ? hex_alpha(colors.ink, 0.035) : (x - y + 3) % 3 === 0 ? hex_alpha(colors.void, 0.5) : null
      if (!thread) continue
      ctx.fillStyle = thread
      ctx.fillRect(x, y, 1, 1)
    }
  return tile_canvas
}
type Box = readonly [x: number, y: number, width: number, height: number]
/** The site's carbon: a lifted gradient, the weave, and a lit upper hairline. */
export const carbon = (kit: Kit, box: Box, radius: number, top = kit.colors.lifted, bottom = kit.colors.surface) => {
  const { ctx } = kit
  const [x, y, width, height] = box
  ctx.save()
  rrect(ctx, x, y, width, height, radius)
  ctx.clip()
  const gradient = ctx.createLinearGradient(0, y, 0, y + height)
  gradient.addColorStop(0, top)
  gradient.addColorStop(0.85, bottom)
  gradient.addColorStop(1, bottom)
  ctx.fillStyle = gradient
  ctx.fillRect(x, y, width, height)
  ctx.fillStyle = kit.weave
  ctx.fillRect(x, y, width, height)
  hairline(ctx, x, x + width, y, kit.colors.ink, 0.12)
  ctx.restore()
}
/** The hairline carbon card every piece of art sits in. */
export const art_frame = (kit: Kit, box: Box): void => {
  carbon(kit, box, 5, kit.colors.raised, kit.colors.surface)
  frame(kit.ctx, box, 5, kit.colors.brass, 0.18)
}
/** Draws `place` clipped to the card's rounded box. */
export const clipped = (ctx: SKRSContext2D, [x, y, width, height]: Box, place: () => void): void => {
  ctx.save()
  rrect(ctx, x, y, width, height, 5)
  ctx.clip()
  place()
  ctx.restore()
}
/** A square slot: a dark well with a brass hairline and the art inside its padding, or empty. */
export const tile = (kit: Kit, image: Image | Canvas | null, x: number, y: number, size: number, faint = false) => {
  const { ctx, colors } = kit
  ctx.fillStyle = hex_alpha(colors.void, faint ? 0.45 : 0.55)
  ctx.fillRect(x, y, size, size)
  frame(ctx, [x, y, size, size], 2, colors.brass, faint ? 0.2 : 0.3)
  const pad = size * (faint ? 0.13 : 0.12)
  if (image) contain(ctx, image, x + pad, y + pad, size - 2 * pad, size - 2 * pad)
}

/* ---------- The objects a page card shows beside its words, inside x 640 to 1160 ---------- */
/** One piece of art in its carbon card, captioned. `fill` stands it on the caption (a character, a crate). */
export type ArtCard = Readonly<{ art: string; name: string; caption: string; fill: boolean }>
export type PageObject =
  | Readonly<{ kind: 'shelf'; cards: readonly ArtCard[] }>
  | Readonly<{ kind: 'capture'; art: string }>
  | Readonly<{
      kind: 'facts'
      tabs: readonly string[]
      lit: number
      art: string
      facts: readonly (readonly [title: string, text: string])[]
    }>
  | Readonly<{ kind: 'coin'; art: string }>
  | Readonly<{ kind: 'podium'; arts: readonly [first: string, second: string, third: string] }>
  | Readonly<{ kind: 'bag'; tabs: readonly string[]; lit: number; arts: readonly string[] }>
  | Readonly<{ kind: 'mosaic'; arts: readonly string[]; counts: readonly (readonly [count: number, label: string])[] }>
  | Readonly<{ kind: 'sale'; cards: readonly (readonly [art: string, tier: string])[]; mark: string }>

const AREA = Object.freeze({ left: 640, top: 152, right: 1160, bottom: 588 })
const WHOLE: Box = [AREA.left, AREA.top, AREA.right - AREA.left, AREA.bottom - AREA.top]

const shelf_card = async (kit: Kit, card: ArtCard, box: Box): Promise<void> => {
  const { ctx, colors } = kit
  const [x, y, width, height] = box
  art_frame(kit, box)
  const image = await load_art(card.art)
  if (card.fill) clipped(ctx, box, () => contain(ctx, image, x + 10, y + 8, width - 20, height - 74, 0.5, 1))
  else contain(ctx, image, x + 22, y + 18, width - 44, height - 96)
  ctx.fillStyle = hex_alpha(colors.surface, 0.92)
  ctx.fillRect(x + 1, y + height - 68, width - 2, 67)
  hairline(ctx, x, x + width, y + height - 68, colors.brass, 0.2)
  say(ctx, card.name, x + 18, y + height - 38, { weight: 800, size: 19, color: colors.ink, max_width: width - 36 })
  say(ctx, card.caption, x + 18, y + height - 15, {
    weight: 500,
    size: 13,
    family: TYPE.mono,
    color: colors.faint,
    track: 0.08,
    caps: true,
    max_width: width - 36,
  })
}
/** One card stands alone, inset; up to four share the area two by two. */
const shelf = async (kit: Kit, cards: readonly ArtCard[]): Promise<void> => {
  const [x, y, width, height] = WHOLE
  if (cards.length === 1) return shelf_card(kit, cards[0]!, [x + 40, y, width - 80, height])
  const [cell_width, cell_height] = [(width - 16) / 2, (height - 16) / 2]
  await Promise.all(
    cards
      .slice(0, 4)
      .map((card, index) =>
        shelf_card(kit, card, [
          x + (index % 2) * (cell_width + 16),
          y + Math.floor(index / 2) * (cell_height + 16),
          cell_width,
          cell_height,
        ])
      )
  )
}
/** The site's tab row inside a card: the lit tab underlined, a hairline under the row. */
const tab_row = (kit: Kit, labels: readonly string[], lit: number): void => {
  const { ctx, colors } = kit
  labels.reduce((x, label, index) => {
    const width = say(ctx, label, x, AREA.top + 42, {
      weight: 700,
      size: 19,
      color: index === lit ? colors.ink : colors.muted,
    })
    ctx.fillStyle = colors.brass_hi
    if (index === lit) ctx.fillRect(x, AREA.top + 58, width, 2)
    return x + width + 28
  }, AREA.left + 24)
  hairline(ctx, AREA.left, AREA.right, AREA.top + 60, colors.brass, 0.25)
}
const facts = async (kit: Kit, object: Extract<PageObject, { kind: 'facts' }>): Promise<void> => {
  const { ctx, colors } = kit
  const [x, y, width, height] = WHOLE
  art_frame(kit, WHOLE)
  tab_row(kit, object.tabs, object.lit)
  const image = await load_art(object.art)
  clipped(ctx, WHOLE, () => contain(ctx, image, x + 6, y + 84, 250, height - 84, 0.5, 1))
  object.facts.forEach(([title, text], index) => {
    const top = y + 118 + index * 118
    say(ctx, title, x + 276, top, { weight: 800, size: 22, color: colors.ink, max_width: width - 300 })
    const lines = fit(ctx, text, { width: width - 300, sizes: [16], lines: 2, weight: 400, family: TYPE.ui })
    block(ctx, lines, x + 276, top + 14, { line_height: 1.4, color: colors.muted, sui: colors.sui })
    if (index < object.facts.length - 1) hairline(ctx, x + 276, AREA.right - 20, top + 72, colors.brass, 0.18)
  })
}
const coin = async (kit: Kit, art: string): Promise<void> => {
  const { ctx, colors } = kit
  ctx.save()
  ctx.translate(905, 556)
  ctx.scale(190, 22)
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  shadow.addColorStop(0, hex_alpha(colors.void, 0.75))
  shadow.addColorStop(1, hex_alpha(colors.void, 0))
  ctx.fillStyle = shadow
  ctx.beginPath()
  ctx.arc(0, 0, 1, 0, Math.PI * 2)
  // eslint-disable-next-line fp-law/no-mutating-methods -- Canvas2D fill paints the path; it is no array method.
  ctx.fill()
  ctx.restore()
  contain(ctx, await load_art(art), 735, 200, 340, 340)
}
/** The three leaders: the first raised in the middle, the second on its left, the third on its right. */
const podium = async (kit: Kit, [first, second, third]: readonly [string, string, string]): Promise<void> => {
  const { ctx, colors } = kit
  const steps = [
    [second, 650, 330, '2'],
    [first, 822, 280, '1'],
    [third, 994, 330, '3'],
  ] as const
  const images = await Promise.all(steps.map(([art]) => load_art(art)))
  steps.forEach(([, x, y, rank], index) => {
    const box: Box = [x, y, 160, AREA.bottom - y]
    art_frame(kit, box)
    clipped(ctx, box, () => contain(ctx, images[index]!, x + 4, y + 10, 152, AREA.bottom - y - 70, 0.5, 1))
    ctx.fillStyle = hex_alpha(colors.surface, 0.94)
    ctx.fillRect(x + 1, AREA.bottom - 62, 158, 61)
    hairline(ctx, x, x + 160, AREA.bottom - 62, colors.brass, 0.2)
    say(ctx, rank, x + 80, AREA.bottom - 18, {
      weight: 600,
      size: 34,
      family: TYPE.mono,
      color: rank === '1' ? colors.orange : colors.soft,
      align: 'center',
    })
  })
}
const bag = async (kit: Kit, object: Extract<PageObject, { kind: 'bag' }>): Promise<void> => {
  art_frame(kit, WHOLE)
  tab_row(kit, object.tabs, object.lit)
  const [size, gap] = [108, 12]
  const left = AREA.left + (AREA.right - AREA.left - 4 * size - 3 * gap) / 2
  const images = await Promise.all(object.arts.slice(0, 12).map(load_art))
  images.forEach((image, index) =>
    tile(
      kit,
      image,
      left + (index % 4) * (size + gap),
      AREA.top + 84 + Math.floor(index / 4) * (size + gap),
      size,
      true
    )
  )
}
const mosaic = async (kit: Kit, arts: readonly string[]): Promise<void> => {
  const [size, gap] = [112, 12]
  const images = await Promise.all(arts.slice(0, 12).map(load_art))
  images.forEach((image, index) => {
    const [x, y] = [AREA.left + 8 + (index % 4) * (size + gap), AREA.top + 26 + Math.floor(index / 4) * (size + gap)]
    art_frame(kit, [x, y, size, size])
    contain(kit.ctx, image, x + 14, y + 14, size - 28, size - 28)
  })
}
/** A tilted sale card: its authored art, its tier top left, the helmet and the mark bottom left. */
const sale_card = async (kit: Kit, [art, tier]: readonly [string, string], mark: string, place: Box): Promise<void> => {
  const { ctx, colors, helmet } = kit
  const [x, y, width, degrees] = place
  const image = await load_art(art)
  const height = (width * image.height) / image.width
  const [left, top] = [-width / 2, -height / 2]
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.save()
  rrect(ctx, left, top, width, height, 7)
  ctx.clip()
  ctx.drawImage(image, left, top, width, height)
  say(ctx, tier, left + width * 0.06, top + height * 0.27, { weight: 800, size: height * 0.17, color: colors.ink })
  const helmet_height = height * 0.13
  const helmet_width = (helmet_height * helmet.width) / helmet.height
  ctx.drawImage(helmet, left + width * 0.06, height / 2 - height * 0.21, helmet_width, helmet_height)
  say(ctx, mark, left + width * 0.085 + helmet_width, height / 2 - height * 0.11, {
    weight: 800,
    size: height * 0.085,
    color: colors.ink,
    track: 0.08,
  })
  ctx.restore()
  frame(ctx, [left, top, width, height], 7, colors.ink, 0.16)
  ctx.restore()
}
const SALE_PLACES: readonly Box[] = Object.freeze([
  [820, 292, 360, -6],
  [990, 452, 360, 5],
])

/** Paints a page card's object. The world capture is the card's backdrop, so it has nothing to add here. */
export const paint_object = async (kit: Kit, object: PageObject): Promise<void> => {
  switch (object.kind) {
    case 'shelf':
      return shelf(kit, object.cards)
    case 'capture':
      return undefined
    case 'facts':
      return facts(kit, object)
    case 'coin':
      return coin(kit, object.art)
    case 'podium':
      return podium(kit, object.arts)
    case 'bag':
      return bag(kit, object)
    case 'mosaic':
      return mosaic(kit, object.arts)
    case 'sale':
      for (const [index, card] of object.cards.slice(0, 2).entries())
        await sale_card(kit, card, object.mark, SALE_PLACES[index]!)
      return undefined
  }
}
