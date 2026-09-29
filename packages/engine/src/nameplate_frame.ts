// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { WorldCaption } from './caption_types.ts'

type Tone = NonNullable<WorldCaption['tone']>
const ART_SIDE_MARGIN = 56
const NAMEPLATE_STYLE = Object.freeze({
  font: '"Ares UI", Arial, sans-serif',
  color: '#f5f3f1',
  muted: '#b2b2bd',
  font_size: 13,
  line_size: 10,
  name_weight: 800,
  format_name: (name: string) => name,
  line_weight: 700,
  name_spacing: '0.3px',
  line_spacing: '0.6px',
  line_height: 18,
  name_y: 12,
  line_y: 25,
  body_height: 34,
  padding_x: 28,
  side_padding: ART_SIDE_MARGIN,
  top_padding: 28,
  min_width: 124,
  baseline: 'alphabetic' as const,
  center_text: true,
})

export const NAMEPLATE_STYLES = {
  neutral: {
    ...NAMEPLATE_STYLE,
    side_padding: 0,
    top_padding: 8,
    min_width: 100,
    font_size: 14,
    name_y: 17,
    line_y: 35,
  },
  green: { ...NAMEPLATE_STYLE, muted: '#a9f5cb' },
  red: { ...NAMEPLATE_STYLE, muted: '#ffb8b9' },
} as const

const frame_path = (context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => {
  context.beginPath()
  context.moveTo(x + 7, y)
  context.lineTo(x + width - 7, y)
  context.lineTo(x + width, y + 7)
  context.lineTo(x + width, y + height - 7)
  context.lineTo(x + width - 7, y + height)
  context.lineTo(x + 7, y + height)
  context.lineTo(x, y + height - 7)
  context.lineTo(x, y + 7)
  context.closePath()
}

/** Ranked plates are single authored images; only neutral identity uses a drawn frame. */
export const paint_nameplate_frame = (
  context: CanvasRenderingContext2D,
  box: Readonly<{ left: number; top: number; width: number; height: number }>,
  tone: Tone,
  artwork: HTMLImageElement | null
) => {
  const { left, top, width, height } = box
  if (tone !== 'neutral') {
    if (artwork) {
      const art_width = width + ART_SIDE_MARGIN * 2
      const art_height = (art_width * artwork.naturalHeight) / artwork.naturalWidth
      const art_top = top - 28 + (height + 36 - art_height) / 2
      context.drawImage(artwork, left - ART_SIDE_MARGIN, art_top, art_width, art_height)
    }
    return
  }
  context.fillStyle = '#0a0d12'
  frame_path(context, left, top + 3, width, height)
  context.fill()
  const paint = context.createLinearGradient(0, top, 0, top + height)
  paint.addColorStop(0, '#30353e')
  paint.addColorStop(0.12, '#1b2026')
  paint.addColorStop(1, '#12161d')
  context.fillStyle = paint
  context.strokeStyle = '#606a75'
  context.lineWidth = 1
  frame_path(context, left + 0.5, top + 0.5, width - 1, height - 1)
  context.fill()
  context.stroke()
  context.strokeStyle = '#ffffff12'
  frame_path(context, left + 3.5, top + 3.5, width - 7, height - 7)
  context.stroke()
  context.strokeStyle = '#a6b2be'
  context.globalAlpha = 0.55
  context.beginPath()
  context.moveTo(left + 9, top + 2.5)
  context.lineTo(left + width - 9, top + 2.5)
  context.stroke()
  context.globalAlpha = 1
}
