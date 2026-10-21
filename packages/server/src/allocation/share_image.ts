// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable no-param-reassign -- Canvas is a call-owned drawing surface at the image effect boundary. */
import { fileURLToPath } from 'node:url'

import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from '@napi-rs/canvas'

const path = (value: string): string => fileURLToPath(new URL(value, import.meta.url))
const fit = (context: SKRSContext2D, value: string, x: number, y: number, size: number, width: number): void => {
  context.font = `800 ${size}px "Allocation"`
  const scale = Math.min(1, width / Math.max(1, context.measureText(value).width))
  context.font = `800 ${Math.floor(size * scale)}px "Allocation"`
  context.fillText(value, x, y)
}
export const render_card = async (
  card: Readonly<{ tier: string; title: string; amount: string; cap: string; before: string; buy_up_to: string }>
): Promise<ArrayBuffer> => {
  if (!GlobalFonts.has('Allocation'))
    GlobalFonts.registerFromPath(path('../../../ui/src/assets/font/nunito-800.ttf'), 'Allocation')
  const [helmet, kares] = await Promise.all([
    loadImage(path('../../../../seed/icons/journal/helmet-favicon.png')),
    loadImage(path('../../../../seed/icons/currency/kares.png')),
  ])
  const canvas = createCanvas(1200, 630)
  const context = canvas.getContext('2d')
  context.fillStyle = '#faf8f2'
  context.fillRect(0, 0, 1200, 630)
  const palette: Readonly<Record<string, readonly [string, string]>> = {
    veteran: ['#0b4a35', '#65e5ac'],
    member: ['#133b85', '#7cb6ff'],
  }
  const [surface, accent] = palette[card.tier] ?? ['#1f252d', '#e2c895']
  context.fillStyle = surface
  context.beginPath()
  context.roundRect(160, 45, 880, 540, 32)
  context.fill()
  context.save()
  context.clip()
  context.strokeStyle = '#ffffff0b'
  context.lineWidth = 3
  for (let x = -600; x < 1400; x += 12) {
    context.beginPath()
    context.moveTo(x, 45)
    context.lineTo(x + 600, 645)
    context.stroke()
  }
  context.fillStyle = accent
  context.globalAlpha = 0.16
  context.beginPath()
  context.moveTo(820, 45)
  context.lineTo(1000, 45)
  context.lineTo(740, 585)
  context.lineTo(560, 585)
  context.closePath()
  context.fill()
  context.restore()
  context.imageSmoothingEnabled = false
  context.drawImage(helmet, 205, 88, 42, 42)
  context.fillStyle = '#ffffff'
  fit(context, 'KARES / AresRPG', 265, 122, 28, 650)
  context.fillStyle = '#e2bd62'
  context.beginPath()
  context.roundRect(208, 206, 86, 65, 10)
  context.fill()
  context.strokeStyle = '#8a6d2f'
  context.lineWidth = 2
  context.strokeRect(236, 206, 30, 65)
  context.strokeRect(208, 226, 86, 25)
  context.fillStyle = '#ffffff'
  fit(context, card.title, 322, 257, 58, 670)
  context.fillStyle = accent
  fit(context, card.amount || card.title, 208, 410, 48, 740)
  context.fillStyle = '#ffffffb3'
  fit(context, card.amount ? card.before : 'aresrpg.world', 208, 450, 23, 740)
  if (card.cap) {
    context.fillStyle = '#ffffff'
    fit(context, `${card.buy_up_to} ${card.cap}`, 208, 520, 28, 630)
  }
  context.imageSmoothingEnabled = true
  context.drawImage(kares, 885, 465, 80, 80)
  return new Uint8Array(await canvas.encode('png')).buffer
}
