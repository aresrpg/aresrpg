// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIVE-WORLDS hand-composed schematics: PALM trees (Paradise) built
// from the reference corpus's palm materials (palm_log/palm_leaves blocks) + MANGROVE trees (Everglades) that
// water-anchor. Appends entries to assets/schematics/schematics.json in the same compact house format the
// loader consumes: { category, size:[W,H,L], anchor:[ax,ay(base),az], palette:[names], voxels:[x,y,z,idx,...] }.
// Idempotent: re-running removes any prior PALM_*/MANGROVE_* entries first, so it never duplicates.
//
// Run:  bun packages/engine/scripts/compose_palms_mangroves.mjs

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(here, '..', 'assets', 'schematics', 'schematics.json')

/** Build a house-format entry from a list of centered [x,y,z,paletteIndex] voxels + a palette. */
function make_entry(category, palette, voxels) {
  let minx = Infinity
  let minz = Infinity
  let maxx = -Infinity
  let maxy = -Infinity
  let maxz = -Infinity
  for (const [x, y, z] of voxels) {
    if (x < minx) minx = x
    if (z < minz) minz = z
    if (x > maxx) maxx = x
    if (y > maxy) maxy = y
    if (z > maxz) maxz = z
  }
  // Shift so all coords are >= 0; the anchor (pivot) is the trunk base (original 0,0,0) after the shift.
  const ax = -minx
  const az = -minz
  const flat = []
  for (const [x, y, z, idx] of voxels) flat.push(x - minx, y, z - minz, idx)
  return {
    category,
    size: [maxx - minx + 1, maxy + 1, maxz - minz + 1],
    anchor: [ax, 0, az],
    palette,
    voxels: flat,
  }
}

/** A palm: STRAIGHT vertical trunk (grounded, planted) + drooping frond crown. h = trunk height.
 *  The trunk is a single column at x=0 — a curved/leaning voxel trunk staircases across neighbour columns
 *  and its diagonal blocks hover with air beneath (a "flying palms" visual defect). A vertical column grounds
 *  cleanly from base to crown. The base voxel is sunk 1 block into the ground (y=-1, mode:overwrite) so the
 *  palm reads PLANTED rather than perched on the sand. The drooping fronds keep the palm silhouette. */
function palm(h) {
  const LOG = 0
  const LEAF = 1
  /** @type {number[][]} */
  const v = []
  // Vertical trunk, base embedded 1 block (y=-1) into the surface so it always makes ground contact.
  for (let y = -1; y < h; y += 1) v.push([0, y, 0, LOG])
  const cy = h // crown sits just above the trunk top
  // Apex tuft.
  v.push([0, cy, 0, LEAF])
  // 8 drooping fronds radiating from the crown, each 3-4 leaves long, dropping 1 block per 2 out.
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]
  const flen = h >= 11 ? 4 : 3
  for (const [dx, dz] of dirs) {
    for (let r = 1; r <= flen; r += 1) {
      const fy = cy - Math.floor((r - 1) / 2) // droop
      v.push([dx * r, fy, dz * r, LEAF])
    }
  }
  return make_entry('tree', ['palm_log', 'palm_leaves'], v)
}

/** A mangrove: splayed prop-roots (stilts) + trunk + a leaf ball. Water-anchors (roots flood, canopy above). */
function mangrove(h) {
  const LOG = 0
  const LEAF = 1
  /** @type {number[][]} */
  const v = []
  // Trunk.
  for (let y = 0; y < h; y += 1) v.push([0, y, 0, LOG])
  // Prop roots: four diagonal stilts from y=2 down to the seabed, splaying one block out.
  const rdirs = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]
  for (const [dx, dz] of rdirs) {
    v.push([dx, 1, dz, LOG])
    v.push([dx, 0, dz, LOG])
    v.push([dx * 2, 0, dz * 2, LOG])
  }
  // Leaf ball crown (radius ~2) centered above the trunk top.
  const cy = h + 1
  for (let dy = -1; dy <= 2; dy += 1) {
    const rad = dy === 2 ? 1 : 2
    for (let dx = -rad; dx <= rad; dx += 1) {
      for (let dz = -rad; dz <= rad; dz += 1) {
        if (dx * dx + dz * dz > rad * rad + 1) continue
        v.push([dx, cy + dy, dz, LEAF])
      }
    }
  }
  return make_entry('tree', ['mangrove_log', 'mangrove_leaves'], v)
}

const bundle = JSON.parse(readFileSync(BUNDLE, 'utf8'))

// Purge any prior composed entries (idempotent re-run).
for (const name of Object.keys(bundle.schematics)) {
  if (name.startsWith('PALM_TREE_') || name.startsWith('MANGROVE_')) delete bundle.schematics[name]
}
bundle.categories.tree = bundle.categories.tree.filter((n) => !n.startsWith('PALM_TREE_') && !n.startsWith('MANGROVE_'))

const palms = { PALM_TREE_G1: palm(7), PALM_TREE_G2: palm(9), PALM_TREE_G3: palm(11), PALM_TREE_G4: palm(13) }
const mangroves = { MANGROVE_G1: mangrove(6), MANGROVE_G2: mangrove(8) }

for (const [name, entry] of Object.entries({ ...palms, ...mangroves })) {
  bundle.schematics[name] = entry
  bundle.categories.tree.push(name)
}
bundle.categories.tree.sort()

bundle.pools = bundle.pools ?? {}
bundle.pools.pool_palms = Object.keys(palms)
bundle.pools.pool_mangrove = Object.keys(mangroves)
// FIVE-WORLDS: pools whose members may water-anchor. The loader reads this → per-schematic water_anchor.
//   pool_mangrove — Everglades trees rooting at the waterline (roots flooded, canopy above).
//   pool_coral    — Paradise submerged reef (category ROCK; the decorator's rock branch places a water-
//                   anchor rock ONLY where real water is present above the column — matte coral cubes).
bundle.water_anchor_pools = ['pool_mangrove', 'pool_coral']

writeFileSync(BUNDLE, JSON.stringify(bundle) + '\n')
const reach = (e) => {
  let r = 0
  for (let i = 0; i < e.voxels.length; i += 4) {
    const dx = Math.abs(e.voxels[i] - e.anchor[0])
    const dz = Math.abs(e.voxels[i + 2] - e.anchor[2])
    r = Math.max(r, dx, dz)
  }
  return r
}
console.log(
  'composed palms + mangroves. reaches:',
  Object.fromEntries(Object.entries({ ...palms, ...mangroves }).map(([n, e]) => [n, reach(e)]))
)
console.log(
  'tree count now',
  bundle.categories.tree.length,
  '| pool_palms',
  bundle.pools.pool_palms,
  '| water_anchor_pools',
  bundle.water_anchor_pools
)
