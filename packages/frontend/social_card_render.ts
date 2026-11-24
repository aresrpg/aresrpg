// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one link-card painter ("Site window", the owner's pick 2026-11-24). Every card wears the site's bar over the
// Tide ground: the page's words on the left, its object in hairline carbon cards on the right, its address at the
// bottom. The build paints the pages and every docs entry; the portrait service paints a hero's poster on request.
// Its inputs are the site's own: the token sheet, the font files, the helmet, the bar's pages and their copy.
/* eslint-disable no-param-reassign -- Canvas2D helpers paint only the call-owned surface at this rendering boundary. */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { createCanvas, GlobalFonts, loadImage, Path2D, type Canvas, type Image } from '@napi-rs/canvas'
import { parse } from 'yaml'

import { SITE_PAGES, type SitePage } from './src/site/routes.ts'
import {
  art_frame,
  block,
  carbon,
  clipped,
  contain,
  fit,
  frame,
  hex_alpha,
  kicker,
  load_art,
  paint_object,
  read_ui_colors,
  rrect,
  say,
  set_font,
  tile,
  TYPE,
  veil,
  weave_tile,
  type CardArt,
  type Colors,
  type Kit,
  type PageObject,
} from './social_card_parts.ts'

export type { ArtCard, CardArt, PageObject } from './social_card_parts.ts'

export const SOCIAL_CARD_WIDTH = 1200
export const SOCIAL_CARD_HEIGHT = 630

/** The cloud's colour held at one moment: cold for staking and the sale, warm for the AI page and the heroes. */
export type CardTone = 'bone' | 'sky' | 'ember'
/** The bar's middle: the site's pages with one lit (or none), or a crumb where a generated card stands. */
export type CardBar = Readonly<{ lit: SitePage | null }> | Readonly<{ crumb: readonly string[] }>
type Framed = Readonly<{ tone: CardTone; bar: CardBar; address: string }>
export type PageCard = Framed & Readonly<{ kind: 'page'; headline: string; sub: string; object: PageObject }>
export type EntityCard = Framed &
  Readonly<{
    kind: 'entity'
    accent: string
    detail: string
    name: string
    rows: readonly (readonly [label: string, value: string])[]
    art: CardArt
    /** A character stands on the card's floor; an object is centred in it. */
    bust: boolean
  }>
export type HeroCard = Framed &
  Readonly<{
    kind: 'hero'
    classe: string
    level: number
    name: string
    power: number
    gear: readonly (CardArt | null)[]
    portrait: CardArt
  }>
export type Card = PageCard | EntityCard | HeroCard

const UI = new URL('../ui/src/', import.meta.url)
const FONT_FILES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [TYPE.title]: ['space-grotesk.ttf'],
  [TYPE.ui]: ['nunito-400.ttf', 'nunito-700.ttf', 'nunito-800.ttf'],
  [TYPE.mono]: ['jetbrains-mono.ttf'],
  [TYPE.pixel]: ['pixelify-sans.ttf'],
})
// Card colour name -> the `--aui-*` token in packages/ui/src/base.css that owns it.
const COLOR_TOKENS: Readonly<Record<keyof Colors, string>> = Object.freeze({
  void: 'void',
  bg: 'bg',
  surface: 'surface',
  raised: 'raised',
  lifted: 'lifted',
  steel: 'steel',
  faint: 'faint',
  muted: 'muted',
  soft: 'soft',
  ink: 'ink',
  brass: 'brass',
  brass_hi: 'brass-hi',
  brass_lo: 'brass-lo',
  orange: 'orange',
  sui: 'sui',
})
const BAR = Object.freeze({ x: 40, y: 30, width: 1120, height: 76 })
const HELMET_HEIGHT = 116
/** Lucide's crossed swords, the icon on the site's Play key. */
const SWORDS =
  'M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M14.5 6.5 18 3h3v3l-3.5 3.5M5 14l4 4M7 17l-3 3M3 19l2 2'
const ART_CARD = Object.freeze([676, 150, 472, 438] as const)
const WORDS: Readonly<{ left: number; width: number; floor: number }> = { left: 64, width: 548, floor: 548 }

const register_fonts = (): void =>
  Object.entries(FONT_FILES).forEach(([family, files]) => {
    if (GlobalFonts.has(family)) return
    files.forEach((file) => {
      if (!GlobalFonts.registerFromPath(fileURLToPath(new URL(`assets/font/${file}`, UI)), family))
        throw new Error(`Card font failed to load: ${file}`)
    })
  })

/* ---------- The Tide ground: the `Ground` shader's formula (packages/ui/src/components/Ground.tsx) evaluated once on
   the CPU at its opening moment, in its 3px cells. The shader is the source; a change to it changes this still. ---------- */
const COLUMNS = 400
const ROWS = 210
const CLOCK = 40
/** The colour wave's phase: the site's opening frame (bone), or the moment it is coldest or warmest. */
const HUES: Readonly<Record<CardTone, number>> = Object.freeze({ bone: CLOCK * 0.05, sky: 3.55, ember: 0.45 })
const fract = (value: number): number => value - Math.floor(value)
const hash = (x: number, y: number): number => {
  const [px, py] = [fract(x * 123.34), fract(y * 456.21)]
  const dot = px * (px + 45.32) + py * (py + 45.32)
  return fract((px + dot) * (py + dot))
}
const noise = (x: number, y: number): number => {
  const [ix, iy] = [Math.floor(x), Math.floor(y)]
  const [fx, fy] = [x - ix, y - iy]
  const [ux, uy] = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)]
  const top = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * ux
  const bottom = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * ux
  return top + (bottom - top) * uy
}
const fbm = (x: number, y: number): number =>
  [0.5, 0.25, 0.125, 0.0625].reduce(
    ({ sum, px, py }, weight) => ({
      sum: sum + weight * noise(px, py),
      px: 1.6 * px - 1.2 * py + 3.1,
      py: 1.2 * px + 1.6 * py + 3.1,
    }),
    { sum: 0, px: x, py: y }
  ).sum / 0.9375
const smooth = (from: number, to: number, value: number): number => {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)))
  return t * t * (3 - 2 * t)
}
const bayer2 = (x: number, y: number): number => fract(Math.floor(x) * 0.5 + Math.floor(y) ** 2 * 0.75)
const bayer4 = (x: number, y: number): number => bayer2(x * 0.5, y * 0.5) * 0.25 + bayer2(x, y)
const bayer8 = (x: number, y: number): number => bayer4(x * 0.5, y * 0.5) * 0.25 + bayer2(x, y)
const rgb = (hex: string): readonly [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
]

/** The cloud's level (0 to 1, in fifths) at one cell; `fy` counts from the bottom, as the shader's does. */
const cloud_level = (fx: number, fy: number): number => {
  const t = CLOCK * 0.02
  const [nx, ny] = [fx / COLUMNS, fy / ROWS]
  const [px, py] = [(fx / ROWS) * 2.4, (fy / ROWS) * 2.4]
  const [qx, qy] = [fbm(px + t, py - 0.7 * t), fbm(px + 4.1 - 0.6 * t, py + 1.7 + 0.4 * t)]
  const density = smooth(0.36, 0.9, fbm(px * 1.1 + 1.8 * qx - 0.5 * t, py * 1.1 + 1.8 * qy + 0.3 * t))
  const weight = Math.max(0.42 + 0.58 * smooth(0.1, 0.95, ny), 0.85 * smooth(0.62, 1, nx))
  const breath = 0.78 + 0.22 * (0.5 + 0.5 * Math.sin(CLOCK * 0.42))
  const level = density * weight * breath * smooth(0.1, 0.28, ny)
  return Math.max(0, Math.min(1, Math.floor(level * 5 + bayer8(fx, fy)) / 5))
}

/** One still of the cloud, 400 × 210 cells; `gain` lifts it a little, as the approved cards do. */
const tide = (colors: Colors, tone: CardTone, gain = 1.2): Canvas => {
  const canvas = createCanvas(COLUMNS, ROWS)
  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(COLUMNS, ROWS)
  const [bg, low, cold, warm] = [colors.bg, colors.brass_lo, colors.sui, colors.orange].map(rgb)
  for (let row = 0; row < ROWS; row++)
    for (let column = 0; column < COLUMNS; column++) {
      const [fx, fy] = [column + 0.5, ROWS - row - 0.5]
      const level = cloud_level(fx, fy)
      const wave = 0.5 + 0.5 * Math.sin(HUES[tone] + (fx / COLUMNS) * 2.4)
      const glow = Math.min(1, smooth(0, 0.6, level) * 0.38 * gain)
      const peak = Math.min(1, smooth(0.55, 1, level) * 0.2 * gain)
      const lift = 0.09 + 0.08 * (fy / ROWS)
      const offset = (row * COLUMNS + column) * 4
      for (let channel = 0; channel < 3; channel++) {
        const core = cold![channel]! + (warm![channel]! - cold![channel]!) * wave
        const floor = bg![channel]! + (low![channel]! - bg![channel]!) * lift
        const shade = floor + (bg![channel]! + (core - bg![channel]!) * 0.55 - floor) * glow
        image.data[offset + channel] = Math.round((shade + (core - shade) * peak) * 255)
      }
      image.data[offset + 3] = 255
    }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/* ---------- The bar: the site's own, the helmet rising from its left edge and cropped by its lower edge ---------- */
/** The site's Play key: a raised key of lighter steel with the crossed swords. Returns its width. */
const play_key = ({ ctx, colors }: Kit, x: number, label: string): number => {
  const height = 46
  const y = BAR.y + (BAR.height - height) / 2
  set_font(ctx, 800, 20, TYPE.ui)
  const [icon, pad_left, pad_right, gap] = [height * 0.5, height * 0.3, height * 0.4, height * 0.2]
  const width = pad_left + icon + gap + ctx.measureText(label).width + pad_right
  ctx.save()
  rrect(ctx, x - 1, y - 1, width + 2, height + 2, 5)
  ctx.fillStyle = colors.void
  // eslint-disable-next-line fp-law/no-mutating-methods -- Canvas2D fill paints the path; it is no array method.
  ctx.fill()
  rrect(ctx, x, y, width, height, 4)
  ctx.clip()
  const steel = ctx.createLinearGradient(0, y, 0, y + height)
  steel.addColorStop(0, '#5f5e5f')
  steel.addColorStop(0.48, colors.steel)
  steel.addColorStop(1, '#404044')
  ctx.fillStyle = steel
  ctx.fillRect(x, y, width, height)
  ctx.fillStyle = hex_alpha(colors.ink, 0.03)
  for (let line = y; line < y + height; line += 3) ctx.fillRect(x, line, width, 1)
  ctx.fillStyle = hex_alpha(colors.ink, 0.32)
  ctx.fillRect(x, y, width, 1)
  ctx.fillStyle = colors.void
  ctx.fillRect(x, y + height - 1, width, 1)
  ctx.restore()
  ctx.save()
  ctx.translate(x + pad_left, y + (height - icon) / 2)
  ctx.scale(icon / 24, icon / 24)
  ctx.strokeStyle = colors.ink
  ctx.lineWidth = 1.9
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(new Path2D(SWORDS))
  ctx.restore()
  set_font(ctx, 800, 20, TYPE.ui)
  const baseline = y + height / 2 + 20 * 0.36
  ctx.fillStyle = colors.void
  ctx.fillText(label, x + pad_left + icon + gap, baseline + 1)
  ctx.fillStyle = colors.ink
  ctx.fillText(label, x + pad_left + icon + gap, baseline)
  return width
}
/** One entry of the bar; returns where the next one starts. A lit entry carries the site's underline. */
const entry = ({ ctx, colors }: Kit, x: number, label: string, lit: boolean): number => {
  set_font(ctx, 700, 20, TYPE.ui)
  const { width } = ctx.measureText(label)
  ctx.fillStyle = lit ? colors.ink : colors.muted
  ctx.fillText(label, x + 16, BAR.y + BAR.height / 2 + 7)
  ctx.fillStyle = colors.brass_hi
  if (lit) ctx.fillRect(x + 16, BAR.y + BAR.height - 3, width, 3)
  return x + width + 34
}
const crumb = (kit: Kit, x: number, parts: readonly string[]): number =>
  parts.reduce((left, part, index) => {
    if (!index) return entry(kit, left, part, parts.length === 1)
    set_font(kit.ctx, 700, 20, TYPE.ui)
    kit.ctx.fillStyle = kit.colors.steel
    kit.ctx.fillText('/', left + 2, BAR.y + BAR.height / 2 + 7)
    return entry(kit, left + 12, part, index === parts.length - 1)
  }, x)
/** The site's pages in the bar's order: the home, the Play key, then the others. */
const nav = (kit: Kit, x: number, lit: SitePage | null): number => {
  const [home, ...others] = SITE_PAGES
  const after_home = entry(kit, x, kit.labels[home.key], home.key === lit) + 8
  const after_play = after_home + play_key(kit, after_home, kit.labels.play) + 16
  return others.reduce((left, { key }) => entry(kit, left, kit.labels[key], key === lit), after_play)
}
const paint_bar = (kit: Kit, bar: CardBar): void => {
  const { ctx, colors, helmet } = kit
  const { x, y, width, height } = BAR
  ctx.fillStyle = hex_alpha(colors.void, 0.6)
  rrect(ctx, x - 1, y - 1, width + 2, height + 2, 7)
  // eslint-disable-next-line fp-law/no-mutating-methods -- Canvas2D fill paints the path; it is no array method.
  ctx.fill()
  carbon(kit, [x, y, width, height], 6)
  frame(ctx, [x, y, width, height], 6, colors.brass, 0.16)
  const helmet_width = (HELMET_HEIGHT * helmet.width) / helmet.height
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, SOCIAL_CARD_WIDTH, y + height - 1)
  ctx.clip()
  ctx.drawImage(helmet, x + 12, y + height + 12 - HELMET_HEIGHT, helmet_width, HELMET_HEIGHT)
  ctx.restore()
  const mark = x + 24 + helmet_width
  set_font(ctx, 700, 32, TYPE.pixel)
  ctx.fillStyle = colors.ink
  ctx.fillText('AresRPG', mark, y + height / 2 + 11)
  const start = mark + ctx.measureText('AresRPG').width + 26
  if ('crumb' in bar) crumb(kit, start, bar.crumb)
  else nav(kit, start, bar.lit)
}

/* ---------- The three layouts under the bar: words x 64 to 612, the object x 640 to 1160 ---------- */
const in_art_card = async (kit: Kit, art: CardArt, place: (image: Image | Canvas) => void): Promise<void> => {
  art_frame(kit, ART_CARD)
  const image = await load_art(art)
  clipped(kit.ctx, ART_CARD, () => place(image))
}
const is_figure = (value: string): boolean => /^[\d\s–\-·.,APM]+$/.test(value)
const ROW_PITCH = Object.freeze({ most: 48, least: 34 })
/** Dotted-leader rows: the label left, the value right (mono when it is a figure), dots between. */
const leaders = ({ ctx, colors }: Kit, rows: EntityCard['rows'], top: number, pitch: number): void =>
  rows.forEach(([label, value], index) => {
    const y = top + index * pitch
    const width = WORDS.width + 12
    const label_width = say(ctx, label, WORDS.left, y, { size: 21, color: colors.soft, max_width: width / 2 })
    const figure = is_figure(value)
    const value_width = say(ctx, value, WORDS.left + width, y, {
      size: figure ? 21 : 20,
      weight: figure ? 500 : 700,
      family: figure ? TYPE.mono : TYPE.ui,
      max_width: width - label_width - 36,
      align: 'right',
      color: colors.ink,
      sui: colors.sui,
    })
    ctx.fillStyle = hex_alpha(colors.faint, 0.6)
    for (let dot = WORDS.left + label_width + 12; dot < WORDS.left + width - value_width - 12; dot += 7)
      ctx.fillRect(Math.round(dot), Math.round(y - 1), 2, 2)
  })

const paint_entity = async (kit: Kit, card: EntityCard): Promise<void> => {
  const { ctx, colors } = kit
  kicker(ctx, [card.accent, card.detail], WORDS.left, 196, [colors.orange, colors.muted], 560)
  const name = fit(ctx, card.name, { width: 560, sizes: [76, 68, 60, 54, 48, 42], lines: 2, track: -0.02 })
  const top = block(ctx, name, WORDS.left, 222, { line_height: 1.04, color: colors.ink, sui: colors.sui }) + 64
  // Rows tighten to stay above the address, never past their floor; the ones that still cannot fit are left out.
  const room = WORDS.floor - top
  const shown = card.rows.slice(0, Math.max(1, Math.floor(room / ROW_PITCH.least) + 1))
  const pitch =
    shown.length < 2 ? ROW_PITCH.most : Math.max(ROW_PITCH.least, Math.min(ROW_PITCH.most, room / (shown.length - 1)))
  leaders(kit, shown, top, pitch)
  const [x, y, width, height] = ART_CARD
  await in_art_card(kit, card.art, (image) =>
    card.bust
      ? contain(ctx, image, x, y + 20, width, height - 20, 0.5, 1)
      : contain(ctx, image, x + 40, y + 36, width - 80, height - 72)
  )
}

const GEAR_GAP = 8
const paint_hero = async (kit: Kit, card: HeroCard): Promise<void> => {
  const { ctx, colors } = kit
  kicker(ctx, [card.classe, `Level ${card.level}`], WORDS.left, 200, [colors.soft], 560)
  const name = fit(ctx, card.name, {
    width: WORDS.width,
    sizes: [132, 116, 100, 88, 76, 64, 56, 48],
    lines: 1,
    track: -0.035,
  })
  const base = block(ctx, name, WORDS.left, 226, { line_height: 1.05, color: colors.ink, sui: colors.sui })
  const label = say(ctx, 'POWER', WORDS.left, base + 78, { weight: 800, size: 22, color: colors.muted, track: 0.12 })
  say(ctx, card.power.toLocaleString('en-US'), WORDS.left + label + 18, base + 80, {
    weight: 600,
    size: 48,
    family: TYPE.mono,
    color: colors.orange,
    max_width: WORDS.width - label - 18,
  })
  // Every worn item gets a frame; the frames shrink so that all of them fit the words' column.
  const count = Math.max(1, card.gear.length)
  const size = Math.min(58, (WORDS.width - (count - 1) * GEAR_GAP) / count)
  const gear = await Promise.all(card.gear.map((art) => (art ? load_art(art) : null)))
  gear.forEach((image, index) => tile(kit, image, WORDS.left + index * (size + GEAR_GAP), 478, size))
  const [x, y, width, height] = ART_CARD
  await in_art_card(kit, card.portrait, (image) => contain(ctx, image, x - 16, y + 18, width + 32, height - 18, 0.5, 1))
}

const counts_row = ({ ctx, colors }: Kit, counts: readonly (readonly [number, string])[], baseline: number): void =>
  void counts.reduce<number>((x, [count, label]) => {
    const count_width = say(ctx, String(count), x, baseline, {
      weight: 600,
      size: 40,
      family: TYPE.mono,
      color: colors.brass_hi,
    })
    const label_width = say(ctx, label, x, baseline + 28, {
      weight: 800,
      size: 14,
      color: colors.muted,
      track: 0.14,
      caps: true,
    })
    return x + Math.max(count_width, label_width) + 30
  }, WORDS.left)

const paint_page = async (kit: Kit, card: PageCard): Promise<void> => {
  const { ctx, colors } = kit
  const headline = fit(ctx, card.headline, { width: WORDS.width, sizes: [72, 66, 60, 54, 48], lines: 3, track: -0.02 })
  const last = block(ctx, headline, WORDS.left, 170, { line_height: 1.06, color: colors.ink, sui: colors.sui })
  if (card.object.kind === 'mosaic') counts_row(kit, card.object.counts, last + 104)
  else {
    const sub = fit(ctx, card.sub, { width: 520, sizes: [24, 22], lines: 3, weight: 400, family: TYPE.ui })
    block(ctx, sub, WORDS.left, last + 34, { line_height: 1.42, color: colors.soft, cap: 0.7, sui: colors.sui })
  }
  await paint_object(kit, card.object)
}

/** The world capture fills the card, held a little under its middle, behind a veil that keeps the words legible. */
const capture = (kit: Kit, image: Image | Canvas): void => {
  const scale = Math.max(SOCIAL_CARD_WIDTH / image.width, SOCIAL_CARD_HEIGHT / image.height)
  const [width, height] = [SOCIAL_CARD_WIDTH / scale, SOCIAL_CARD_HEIGHT / scale]
  const [left, top] = [(image.width - width) * 0.5, (image.height - height) * 0.55]
  kit.ctx.drawImage(image, left, top, width, height, 0, 0, SOCIAL_CARD_WIDTH, SOCIAL_CARD_HEIGHT)
  veil(
    kit.ctx,
    kit.colors.void,
    [
      [0, 0.9],
      [0.4, 0.66],
      [0.72, 0.12],
      [1, 0.15],
    ],
    false
  )
}

const paint_layout = (kit: Kit, card: Card): Promise<void> => {
  switch (card.kind) {
    case 'page':
      return paint_page(kit, card)
    case 'entity':
      return paint_entity(kit, card)
    case 'hero':
      return paint_hero(kit, card)
  }
}

type SiteCopy = Readonly<{ site: Kit['labels'] }>

/**
 * Loads what every card shares (fonts, colours, the helmet, the bar's labels) and returns the painter. Each card is a
 * fresh 1200 × 630 canvas the caller encodes. The ground of each tone is computed once per painter.
 */
export const create_card_painter = async () => {
  register_fonts()
  const [colors, helmet, copy] = await Promise.all([
    read_ui_colors(fileURLToPath(new URL('base.css', UI)), COLOR_TOKENS),
    loadImage(fileURLToPath(new URL('./public/logo-192.png', import.meta.url))),
    readFile(new URL('./src/i18n/locales/en.yaml', import.meta.url), 'utf8').then(
      (source) => parse(source) as SiteCopy
    ),
  ])
  const weave = weave_tile(colors)
  const grounds = new Map<CardTone, Canvas>()
  const ground = (tone: CardTone): Canvas => grounds.get(tone) ?? grounds.set(tone, tide(colors, tone)).get(tone)!

  const paint = async (card: Card): Promise<Canvas> => {
    const canvas = createCanvas(SOCIAL_CARD_WIDTH, SOCIAL_CARD_HEIGHT)
    const ctx = canvas.getContext('2d')
    const kit: Kit = { ctx, colors, helmet, labels: copy.site, weave: ctx.createPattern(weave, 'repeat')! }
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(ground(card.tone), 0, 0, SOCIAL_CARD_WIDTH, SOCIAL_CARD_HEIGHT)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    if (card.kind === 'page' && card.object.kind === 'capture') capture(kit, await load_art(card.object.art))
    veil(
      ctx,
      colors.void,
      [
        [0.62, 0],
        [1, 0.7],
      ],
      true
    )
    paint_bar(kit, card.bar)
    say(ctx, card.address, WORDS.left, 596, {
      weight: 500,
      size: 16,
      family: TYPE.mono,
      color: colors.faint,
      max_width: WORDS.width,
    })
    await paint_layout(kit, card)
    return canvas
  }
  return Object.freeze({ paint })
}
