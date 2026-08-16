// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// VIVID-WORLD sprite SHOWCASE — bakes every new flora sprite (texture_recipes_flora.js via the
// self-contained FLORA_OPS) into PNGs so the art is eyeball-verifiable WITHOUT wiring into the hot base
// baker files. Each sprite → its own named PNG (variants side by side over an alpha checker) + one combined
// biome-grouped grid. PPM→sips→PNG (macOS), the same headless pattern as everglades_raster.mjs.
//   Run:  bun packages/engine/scripts/sprites_vivid_raster.mjs
//   Out:  a local gitignored output dir (see OUT below)

import { writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { FLORA_OPS } from '../src/render/texture_ops_flora.js'
import { FLORA_RECIPES } from '../src/render/texture_recipes_flora.js'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scratchpad', 'sprites_vivid')
mkdirSync(OUT, { recursive: true })
const SIZE = 64
const SEED = 2026

// Which biome each sprite showcases (grid grouping + the legend). Order == the grid order.
const GROUPS = [
  ['UNIVERSAL', ['bush', 'dead_branch', 'pebbles', 'toadstool']],
  ['RAINFOREST', ['jungle_plant', 'orchid', 'young_shoot']],
  ['PARADISE', ['dune_grass', 'seashell', 'starfish', 'driftwood']],
  ['EVERGLADES', ['cattail', 'swamp_weed', 'moss_tuft']],
  ['EVEREST', ['frozen_shrub', 'alpine_flower', 'lichen']],
  ['RIVIERA', ['thistle', 'lavender', 'garrigue']],
  ['UNDERWATER (art-only)', ['seaweed', 'lily_pad']],
]
const RECIPE = new Map(FLORA_RECIPES.map((r) => [r.name, r]))

/** Bake one recipe variant into an RGBA Float32 buffer via the self-contained flora ops. */
function bake(recipe, layer) {
  const vc = Math.max(1, recipe.variants ?? 1)
  const vi = layer % vc
  const buf = new Float32Array(SIZE * SIZE * 4)
  const bg = recipe.alpha_clip ? 0 : (recipe.alpha ?? 255)
  for (let p = 0; p < SIZE * SIZE; p += 1) buf[p * 4 + 3] = bg
  for (const op of recipe.ops) FLORA_OPS[op.op]?.(buf, SIZE, SEED, layer, op, vi, vc)
  return buf
}

/** Alpha checker background (classic transparency preview). */
const checker = (x, y) => (((x >> 3) + (y >> 3)) & 1 ? [116, 118, 112] : [72, 74, 68])

/** Composite a baked buffer over the checker into an RGB get_rgb(px,py) at native SIZE. */
function composite(buf) {
  return (px, py) => {
    const i = (py * SIZE + px) * 4
    const a = buf[i + 3] / 255
    const bg = checker(px, py)
    return [
      Math.round(buf[i] * a + bg[0] * (1 - a)),
      Math.round(buf[i + 1] * a + bg[1] * (1 - a)),
      Math.round(buf[i + 2] * a + bg[2] * (1 - a)),
    ]
  }
}

/** PPM(P6)→PNG via sips; falls back to .ppm if sips is unavailable. */
function save_png(name, W, H, get_rgb, scale) {
  const w = W * scale,
    h = H * scale
  const body = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = get_rgb((x / scale) | 0, (y / scale) | 0)
      const i = (y * w + x) * 3
      body[i] = r
      body[i + 1] = g
      body[i + 2] = b
    }
  const ppm = join(OUT, name + '.ppm')
  writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${w} ${h}\n255\n`), body]))
  try {
    execSync(`sips -s format png "${ppm}" --out "${join(OUT, name + '.png')}"`, { stdio: 'ignore' })
    execSync(`rm -f "${ppm}"`)
    return name + '.png'
  } catch {
    return name + '.ppm'
  }
}

// ── 1. Per-sprite PNG: all variants side by side, 4× zoom (crisp silhouette read). ────────────────
const legend = []
for (const [group, names] of GROUPS) {
  for (const name of names) {
    const recipe = RECIPE.get(name)
    if (!recipe) {
      console.warn('MISSING recipe', name)
      continue
    }
    const vc = Math.max(1, recipe.variants ?? 1)
    const bufs = Array.from({ length: vc }, (_, v) => composite(bake(recipe, v)))
    const W = SIZE * vc,
      H = SIZE
    const file = save_png('sprite_' + name, W, H, (px, py) => bufs[(px / SIZE) | 0](px % SIZE, py), 4)
    legend.push(`${group.padEnd(22)} ${name.padEnd(14)} ${vc} variants  → ${file}`)
  }
}

// ── 2. Combined grid: one variant of every sprite, biome-grouped rows, 3× zoom. ───────────────────
{
  const cols = Math.max(...GROUPS.map(([, n]) => n.length))
  const rows = GROUPS.length
  const cell = SIZE + 4 // 2px gutter each side
  const W = cols * cell,
    H = rows * cell
  const tiles = GROUPS.map(([, names]) => names.map((n) => composite(bake(RECIPE.get(n), 0))))
  const file = save_png(
    '_all_sprites_grid',
    W,
    H,
    (px, py) => {
      const gx = (px / cell) | 0,
        gy = (py / cell) | 0
      const lx = px - gx * cell - 2,
        ly = py - gy * cell - 2
      if (lx < 0 || ly < 0 || lx >= SIZE || ly >= SIZE || gy >= tiles.length || gx >= tiles[gy].length)
        return [26, 28, 24]
      return tiles[gy][gx](lx, ly)
    },
    3
  )
  legend.unshift(`GRID (biome rows) → ${file}\n`)
}

writeFileSync(join(OUT, 'LEGEND.txt'), legend.join('\n') + '\n')
console.log('\nVIVID SPRITE SHOWCASE:')
for (const l of legend) console.log(' •', l)
console.log('\nsaved to', OUT)
console.log(
  `\n${FLORA_RECIPES.length} sprite recipes baked; ${FLORA_RECIPES.reduce((s, r) => s + Math.max(1, r.variants ?? 1), 0)} total variant layers.`
)
