// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

import { raster_portrait_coverage } from './portrait_coverage.mjs'

const require = createRequire(new URL('../packages/frontend/package.json', import.meta.url))
const { createCanvas, loadImage } = require('@napi-rs/canvas')
const root = new URL('../seed/portraits/', import.meta.url)
const regions = JSON.parse(await readFile(new URL('regions.json', root), 'utf8'))
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const smooth = (low, high, value) => Math.max(0, Math.min(1, (value - low) / (high - low)))
const filters = {
  any: () => 1,
  // Red armor highlights stay colored while neutral metal sleeves remain fixed.
  armor_red: ([r, g]) => smooth(1.15, 1.25, r / Math.max(g, 0.001)),
  // Keep tattoo pigment separate from warm skin shadows.
  tattoo_red: ([r, g, b]) =>
    smooth(1.45, 1.7, r / Math.max(g, 0.001)) *
    (1 - smooth(1.25, 1.45, g / Math.max(b, 0.001))) *
    smooth(0.25, 0.35, (Math.max(r, g, b) - Math.min(r, g, b)) / Math.max(r, g, b, 0.001)),
  red: ([r, g, b]) => smooth(0.12, 0.22, r - Math.max(g, b)) * smooth(0.035, 0.085, r - g - (g - b) * 1.4),
  blue: ([r, g, b]) => smooth(0.015, 0.06, b - r) * smooth(-0.03, 0.015, b - g),
  cyan: ([r, g, b]) => smooth(0.025, 0.08, Math.min(g, b) - r),
  green: ([r, g, b]) => smooth(0.025, 0.07, g - Math.max(r, b)),
  metal_gold: ([r, g, b]) => smooth(0.035, 0.1, g - b) * smooth(0.02, 0.08, g - b - (r - g) * 1.3),
  gold: ([r, g, b]) => smooth(0.045, 0.12, g - b) * smooth(0.1, 0.25, r - b),
  warm: ([r, g, b]) => smooth(0.02, 0.075, r - b) * smooth(-0.02, 0.025, g - b),
  dark: (rgb) => 1 - smooth(0.33, 0.65, Math.max(...rgb)),
  ivory: (rgb) => smooth(0.45, 0.7, Math.max(...rgb)),
}
const save_artifact = async (url, bytes) => {
  if (process.argv.includes('--check')) {
    if (!Buffer.from(await readFile(url)).equals(Buffer.from(bytes))) throw new Error(`Stale portrait artifact: ${url}`)
  } else await writeFile(url, bytes)
}
const rows = {}
for (const [name, rules] of Object.entries(regions.portraits)) {
  const source_bytes = await readFile(new URL(`../icons/characters/${name}_hd.png`, root))
  const canvas = createCanvas(1024, 1024),
    ctx = canvas.getContext('2d')
  ctx.drawImage(await loadImage(source_bytes), 0, 0)
  const source = ctx.getImageData(0, 0, 1024, 1024).data
  const mask = ctx.createImageData(1024, 1024)
  const coverage = rules.map(raster_portrait_coverage)
  const shades = [[], [], []]
  for (let pixel = 0; pixel < 1024 * 1024; pixel++) {
    const offset = pixel * 4
    const rgb = Array.from(source.slice(offset, offset + 3), (v) => v / 255)
    mask.data[offset + 3] = 255
    if (!source[offset + 3]) continue
    let selected_slot = -1
    for (const [index, rule] of rules.entries()) {
      const weight = (coverage[index][pixel] / 255) * filters[rule.filter](rgb) * smooth(0.12, 0.28, Math.max(...rgb))
      if (weight <= 0) continue
      // Retain authored slot priority, but union overlapping regions of that slot.
      // An antialiased polygon edge must not hide a fully covered hair/horn region.
      if (selected_slot !== -1 && selected_slot !== rule.slot - 1) continue
      selected_slot = rule.slot - 1
      mask.data[offset + selected_slot] = Math.max(mask.data[offset + selected_slot], Math.round(weight * 255))
    }
    if (selected_slot !== -1 && mask.data[offset + selected_slot] > 204)
      shades[selected_slot].push((Math.max(...rgb) + Math.min(...rgb)) / 2)
  }
  ctx.putImageData(mask, 0, 0)
  const bytes = canvas.toBuffer('image/png')
  await save_artifact(new URL(`${name}.png`, root), bytes)
  const centers = shades.map((values) => values.toSorted((a, b) => a - b)[Math.floor(values.length * 0.6)] ?? 0.5)
  rows[name] = {
    source_sha256: digest(source_bytes),
    mask_sha256: digest(bytes),
    centers,
    gains: regions.gains?.[name] ?? [0.86, 0.86, 0.86],
    model_sha256: digest(await readFile(new URL(`../models/characters/${name}.glb`, root))),
    hair_sha256: digest(await readFile(new URL(`../models/characters/${name}_hair.glb`, root))),
  }
}
const version = digest(JSON.stringify({ algorithm: 2, rows })).slice(0, 16)
await save_artifact(
  new URL('manifest.json', root),
  JSON.stringify({ version, source_commit: regions.source_commit, portraits: rows }, null, 2) + '\n'
)
console.log(`Prepared ${Object.keys(rows).length} portrait masks, revision ${version}`)
