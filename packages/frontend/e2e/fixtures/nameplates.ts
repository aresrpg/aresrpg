// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_caption_raster, type WorldCaption } from '@aresrpg/engine'

import '../../../ui/src/base.css'
import { items } from '../../src/content/items.ts'
import { player_caption } from '../../src/components/player_caption.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import type { Locale } from '../../src/i18n/locale.ts'

const locales: Locale[] = ['en', 'fr', 'de', 'es', 'pt', 'uk', 'ru', 'ja', 'ko', 'zh', 'vi']
const copies = await Promise.all(locales.map(load_app_copy))
await Promise.all([document.fonts.load('800 12px "Ares UI"'), document.fonts.load('700 9px "Ares UI"')])
await document.fonts.ready
const rows = items
  .filter(({ category }) => category === 'title')
  .map((item) => {
    const canvas = document.createElement('canvas')
    const root = document.createElement('section')
    root.append(document.createTextNode(item.item_type), canvas)
    document.querySelector('main')!.append(root)
    return { item, canvas }
  })
let current_locale = 0
let long_name = false
let override: string | undefined
const caption_for = (item_type: string): WorldCaption => {
  const copy = copies[current_locale]!
  const caption = player_caption({
    name: long_name ? 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW' : 'Ares Adventurer',
    title: item_type,
    owner: null,
    admin_label: copy.admin,
    title_names: copy.title_names,
  })
  return override === undefined ? caption : { ...caption, variant: 'nameplate', artwork_url: override || undefined }
}
const draw = () =>
  rows.forEach(({ item, canvas }) => {
    const { width, height } = raster.paint(caption_for(item.item_type), 2)
    canvas.width = Math.ceil(width * 2)
    canvas.height = Math.ceil(height * 2)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    canvas.getContext('2d')!.drawImage(raster.canvas, 0, 0)
  })
const raster = create_caption_raster(draw)
draw()
window.nameplate_probe = {
  revision: raster.revision,
  titles: rows.map(({ item }) => item.item_type),
  select: (locale: number, long = false) => {
    current_locale = locale
    long_name = long
    draw()
  },
  artwork: (url?: string) => {
    override = url
    draw()
  },
  dispose: raster.dispose,
  measure: () =>
    rows.map(({ item }) => {
      const caption = caption_for(item.item_type)
      const layout = raster.measure(caption)
      if (!('style' in layout)) throw new Error('Expected nameplate layout')
      const { style, top, frame_width, box_height } = layout
      const art_width = frame_width + style.side_padding * 2
      const art_height = art_width / 3
      const art_top = top - 28 + (box_height + 36 - art_height) / 2
      const context = raster.canvas.getContext('2d')!
      const ink = (text: string, name: boolean) => {
        context.font = `${name ? style.name_weight : style.line_weight} ${name ? style.font_size : style.line_size}px ${style.font}`
        context.letterSpacing = name ? style.name_spacing : style.line_spacing
        const metrics = context.measureText(text)
        const center = top + (name ? style.name_y : style.line_y)
        const half_height = (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) / 2
        const half_width = Math.min(metrics.width, frame_width - style.padding_x) / 2
        return {
          x_min: 0.5 - half_width / art_width,
          x_max: 0.5 + half_width / art_width,
          y_min: (center - half_height - art_top) / art_height,
          y_max: (center + half_height - art_top) / art_height,
        }
      }
      return {
        title: item.item_type,
        artwork: caption.artwork_url,
        name: ink(caption.name, true),
        subtitle: ink(caption.lines?.[0]?.text ?? '', false),
        width: layout.width,
        height: layout.height,
      }
    }),
}
declare global {
  interface Window {
    nameplate_probe: {
      revision: () => number
      titles: string[]
      select: (locale: number, long?: boolean) => void
      artwork: (url?: string) => void
      dispose: () => void
      measure: () => unknown[]
    }
  }
}
