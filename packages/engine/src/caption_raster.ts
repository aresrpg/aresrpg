// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { CAPTION_STYLE, type WorldCaption } from './caption_types.ts'
import { NAMEPLATE_STYLES, paint_nameplate_frame } from './nameplate_frame.ts'
import { create_nameplate_artwork } from './nameplate_artwork.ts'

const MAX_SPEECH_LINES = 7
const SPEECH_WIDTH = 216
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Prefer whole words; long unbroken text falls back to intact graphemes, including CJK and emoji. */
export const wrap_caption = (text: string, measure: (text: string) => number, width: number): readonly string[] => {
  const lines: string[] = []
  let line = ''
  const segments = text
    .split(/(\n|[^\S\n]+)/u)
    .flatMap((word) => (measure(word) > width ? [...segmenter.segment(word)].map(({ segment }) => segment) : [word]))
  for (const segment of segments) {
    if (segment === '\n' || (line && measure(line + segment) > width)) {
      lines.push(line.trimEnd())
      line = ''
    }
    if (segment !== '\n') line += line ? segment : segment.trimStart()
  }
  lines.push(line.trimEnd())
  if (lines.length <= MAX_SPEECH_LINES) return lines
  return [
    ...lines.slice(0, MAX_SPEECH_LINES - 1),
    `${[...segmenter.segment(lines[MAX_SPEECH_LINES - 1]!)]
      .slice(0, -1)
      .map(({ segment }) => segment)
      .join('')}…`,
  ]
}

export const caption_raster_key = ({
  name,
  suffix,
  lines,
  speech,
  color,
  health,
  variant,
  tone,
}: WorldCaption): string => JSON.stringify([name, suffix, lines, speech, color, !!health, variant, tone])

const text_y = (context: CanvasRenderingContext2D, text: string, y: number, centered: boolean) => {
  if (!centered) return y
  const metrics = context.measureText(text)
  return y + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2
}

export const create_caption_raster = (changed: () => void = () => undefined) => {
  const artwork = create_nameplate_artwork(changed)
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Caption canvas is unavailable')

  const layout = (caption: WorldCaption) => {
    const style = caption.variant === 'nameplate' ? NAMEPLATE_STYLES[caption.tone] : CAPTION_STYLE
    const lines = (caption.lines ?? []).slice(0, 6)
    context.textBaseline = style.baseline
    context.letterSpacing = style.name_spacing
    context.font = `${style.name_weight} ${style.font_size}px ${style.font}`
    const title = [{ text: style.format_name(caption.name), color: caption.color }, ...(caption.suffix ?? [])]
    const title_width = title.reduce((sum, line) => sum + context.measureText(line.text).width, 0)
    context.letterSpacing = style.line_spacing
    context.font = `${style.line_weight} ${style.line_size}px ${style.font}`
    const detail_width = Math.max(0, ...lines.map(({ text }) => context.measureText(text).width))
    context.letterSpacing = '0px'
    context.font = '500 11px sans-serif'
    const speech = caption.speech
      ? wrap_caption(caption.speech, (text) => context.measureText(text).width, SPEECH_WIDTH)
      : []
    const bubble_width = Math.max(0, ...speech.map((text) => context.measureText(text).width + 24))
    const frame_width = Math.min(
      248 - style.side_padding * 2,
      Math.max(style.min_width, title_width + style.padding_x, detail_width + style.padding_x)
    )
    const body_width = frame_width + style.side_padding * 2
    const width = Math.max(body_width, bubble_width)
    const body_left = (width - body_width) / 2
    const bubble_height = speech.length ? speech.length * 14 + 16 : 0
    const top = bubble_height ? bubble_height + style.top_padding + 2 : style.top_padding
    const box_height = style.body_height + lines.length * style.line_height + (caption.health ? 8 : 0)
    const height = top + box_height + 8
    return {
      style,
      lines,
      title,
      title_width,
      speech,
      width,
      body_width,
      body_left,
      frame_width,
      bubble_height,
      top,
      box_height,
      height,
    }
  }
  const card = (caption: WorldCaption) => {
    const {
      style,
      lines,
      title,
      title_width,
      speech,
      width,
      body_width,
      body_left,
      frame_width,
      bubble_height,
      top,
      box_height,
      height,
    } = layout(caption)
    const frame_left = body_left + style.side_padding
    if (speech.length) {
      context.textBaseline = 'top'
      context.fillStyle = '#ffffff'
      context.beginPath()
      context.roundRect(2, 0, width - 4, bubble_height, 10)
      context.fill()
      context.beginPath()
      context.moveTo(width / 2 - 5, bubble_height - 1)
      context.lineTo(width / 2, bubble_height + 5)
      context.lineTo(width / 2 + 5, bubble_height - 1)
      context.fill()
      context.fillStyle = '#171a24'
      speech.forEach((text, index) => context.fillText(text, width / 2, 8 + index * 14, width - 24))
    }
    if (caption.variant === 'nameplate') {
      paint_nameplate_frame(
        context,
        { left: frame_left, top, width: frame_width, height: box_height },
        caption.tone,
        artwork.get(caption.tone)
      )
    } else {
      context.fillStyle = CAPTION_STYLE.background
      context.strokeStyle = 'rgba(200,150,60,0.25)'
      context.lineWidth = 1
      context.beginPath()
      context.roundRect(body_left + 2.5, top + 0.5, body_width - 5, box_height, 5)
      context.fill()
      context.stroke()
      context.strokeStyle = CAPTION_STYLE.border
      for (const [x, y, dx, dy] of [
        [body_left + 3, top + 1, 1, 1],
        [body_left + body_width - 3, top + 1, -1, 1],
        [body_left + 3, top + box_height, 1, -1],
        [body_left + body_width - 3, top + box_height, -1, -1],
      ]) {
        context.beginPath()
        context.moveTo(x! + dx! * 7, y!)
        context.lineTo(x!, y!)
        context.lineTo(x!, y! + dy! * 7)
        context.stroke()
      }
      context.save()
      context.translate(width / 2, top)
      context.rotate(Math.PI / 4)
      context.fillRect(-3, -3, 6, 6)
      context.strokeRect(-3, -3, 6, 6)
      context.restore()
    }
    context.textBaseline = style.baseline
    context.letterSpacing = style.name_spacing
    context.font = `${style.name_weight} ${style.font_size}px ${style.font}`
    context.fillStyle = caption.color ?? style.color
    context.save()
    const title_scale = Math.min(1, (frame_width - 24) / Math.max(1, title_width))
    context.translate(
      (width - title_width * title_scale) / 2,
      top + text_y(context, title.map(({ text }) => text).join(''), style.name_y, style.center_text)
    )
    context.scale(title_scale, 1)
    context.textAlign = 'left'
    let left = 0
    title.forEach((line) => {
      context.fillStyle = line.color ?? caption.color ?? style.color
      context.fillText(line.text, left, 0)
      left += context.measureText(line.text).width
    })
    context.restore()
    context.letterSpacing = style.line_spacing
    context.font = `${style.line_weight} ${style.line_size}px ${style.font}`
    lines.forEach((line, index) => {
      context.fillStyle = line.color ?? style.muted
      context.fillText(
        line.text,
        width / 2,
        top + text_y(context, line.text, style.line_y + index * style.line_height, style.center_text),
        frame_width - 24
      )
    })
    if (caption.health) {
      context.fillStyle = '#303039'
      context.fillRect(body_left + 12, height - 15, body_width - 24, 4)
    }
    return { width, height, body_width }
  }
  return {
    canvas,
    revision: artwork.revision,
    dispose: artwork.dispose,
    measure: (caption: WorldCaption) =>
      caption.variant === 'float' ? { width: 256, height: 64, body_width: 256 } : layout(caption),
    paint: (caption: WorldCaption, ratio: number): Readonly<{ width: number; height: number; body_width: number }> => {
      context.resetTransform()
      context.clearRect(0, 0, 512, 512)
      context.scale(ratio, ratio)
      context.textAlign = 'center'
      context.textBaseline = 'top'
      if (caption.variant !== 'float') return card(caption)
      context.letterSpacing = '0px'
      context.textBaseline = 'middle'
      context.font = `600 38px ${CAPTION_STYLE.font}`
      context.lineJoin = 'round'
      context.lineWidth = 6
      context.strokeStyle = 'rgba(5,6,10,0.92)'
      context.strokeText(caption.name, 128, 32)
      context.fillStyle = caption.color ?? CAPTION_STYLE.color
      context.fillText(caption.name, 128, 32)
      return { width: 256, height: 64, body_width: 256 }
    },
  }
}
