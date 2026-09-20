// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { CAPTION_STYLE, type WorldCaption } from './caption_types.ts'

const MAX_SPEECH_LINES = 7
const SPEECH_WIDTH = 216
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Browser font shaping handles CJK, combining marks and emoji; wrapping never splits a grapheme. */
export const wrap_caption = (text: string, measure: (text: string) => number, width: number): readonly string[] => {
  const lines: string[] = []
  let line = ''
  for (const { segment } of segmenter.segment(text)) {
    if (segment === '\n' || (line && measure(line + segment) > width)) {
      lines.push(line)
      line = ''
    }
    if (segment !== '\n') line += segment
  }
  lines.push(line)
  if (lines.length <= MAX_SPEECH_LINES) return lines
  return [
    ...lines.slice(0, MAX_SPEECH_LINES - 1),
    `${[...segmenter.segment(lines[MAX_SPEECH_LINES - 1]!)]
      .slice(0, -1)
      .map(({ segment }) => segment)
      .join('')}…`,
  ]
}

export const caption_raster_key = ({ name, suffix, lines, speech, color, health, variant }: WorldCaption): string =>
  JSON.stringify([name, suffix, lines, speech, color, !!health, variant])

export const create_caption_raster = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Caption canvas is unavailable')

  const layout = (caption: WorldCaption) => {
    const lines = (caption.lines ?? []).slice(0, 6)
    context.letterSpacing = '1.6px'
    context.font = `400 ${CAPTION_STYLE.font_size}px ${CAPTION_STYLE.font}`
    const title = [{ text: caption.name.toUpperCase(), color: caption.color }, ...(caption.suffix ?? [])]
    const title_width = title.reduce((sum, line) => sum + context.measureText(line.text).width, 0)
    context.letterSpacing = '1px'
    context.font = `400 ${CAPTION_STYLE.line_size}px ${CAPTION_STYLE.font}`
    const detail_width = Math.max(0, ...lines.map(({ text }) => context.measureText(text).width))
    context.letterSpacing = '0px'
    context.font = '500 11px sans-serif'
    const speech = caption.speech
      ? wrap_caption(caption.speech, (text) => context.measureText(text).width, SPEECH_WIDTH)
      : []
    const bubble_width = Math.max(0, ...speech.map((text) => context.measureText(text).width)) + 24
    const body_width = Math.min(248, Math.max(60, title_width + 26, detail_width + 26))
    const width = Math.max(body_width, speech.length ? bubble_width : 0)
    const body_left = (width - body_width) / 2
    const bubble_height = speech.length ? speech.length * 14 + 16 : 0
    const top = bubble_height ? bubble_height + 10 : 8
    const box_height = 26 + lines.length * 11 + (caption.health ? 8 : 0)
    const height = top + box_height + 8
    return { lines, title, title_width, speech, width, body_width, body_left, bubble_height, top, box_height, height }
  }
  const card = (caption: WorldCaption) => {
    const { lines, title, title_width, speech, width, body_width, body_left, bubble_height, top, box_height, height } =
      layout(caption)
    if (speech.length) {
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
    context.letterSpacing = '1.6px'
    context.font = `400 ${CAPTION_STYLE.font_size}px ${CAPTION_STYLE.font}`
    context.fillStyle = caption.color ?? CAPTION_STYLE.color
    context.save()
    const title_scale = Math.min(1, (body_width - 24) / Math.max(1, title_width))
    context.translate((width - title_width * title_scale) / 2, top + 8)
    context.scale(title_scale, 1)
    context.textAlign = 'left'
    let left = 0
    title.forEach((line) => {
      context.fillStyle = line.color ?? caption.color ?? CAPTION_STYLE.color
      context.fillText(line.text, left, 0)
      left += context.measureText(line.text).width
    })
    context.restore()
    context.letterSpacing = '1px'
    context.font = `400 ${CAPTION_STYLE.line_size}px ${CAPTION_STYLE.font}`
    lines.forEach((line, index) => {
      context.fillStyle = line.color ?? CAPTION_STYLE.muted
      context.fillText(line.text, width / 2, top + 23 + index * 11, body_width - 24)
    })
    if (caption.health) {
      context.fillStyle = '#303039'
      context.fillRect(body_left + 12, height - 15, body_width - 24, 4)
    }
    return { width, height, body_width }
  }
  return {
    canvas,
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
