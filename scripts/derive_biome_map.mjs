// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE BIOME MAP DERIVATION — one biome id per zone, sampled by the ENGINE'S OWN world
// compiler (parity with what players see is by construction, never a second implementation).
// The seeding ceremony feeds the output to the `seed` module's biome doors; nothing is
// committed — the recipe in seed/content/worlds.json is the fact, this grid is its derivation.
//
// Run: `bun scripts/derive_biome_map.mjs [world_name]` — prints one JSON document per world
// that has a terrain recipe: { world, zone_x0, zone_z0, side, biomes, cell_chunks } with
// `cell_chunks` base64 slices of the row-major u8 biome grid (id = index in the recipe's
// biome array). The map covers the WHOLE bounded world, so the chain's biome truth is total.
//
// Coordinate law (world.move): worlds are BOUNDED at 100k × 100k; chain coords are u32 with
// center 50_000 = client 0;0 (the corner-bug law); zones are 512 blocks (zone.move ZONE_SIZE).
// Each cell samples the climate at its zone's CENTER, converted to client coords.
//
// Ceremony contract: one PTB per world — `set_world_biome_window(0, 0, side)` then one
// `append_world_biome_cells` per chunk, in order. Each chunk is sliced to Sui's 16,384-byte
// pure-argument cap; a half-uploaded map aborts every read, so never split across PTBs.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sample_biome_grid } from '../packages/engine/src/index.ts'
import { world_center as WORLD_CENTER, world_size as WORLD_SIZE } from '../packages/immutable/src/index.ts'
import { ZONE_SIZE } from '../packages/protocol/src/packets.ts'

const SIDE = Math.ceil(WORLD_SIZE / ZONE_SIZE) // 196 — every zone of the bounded world
const MAX_PURE_ARGUMENT_SIZE = 16_384

const repo_dir = dirname(dirname(fileURLToPath(import.meta.url)))
const worlds = JSON.parse(readFileSync(join(repo_dir, 'seed', 'content', 'worlds.json'), 'utf8'))
const [, , only] = process.argv

const derive = (world) => {
  const { side, cells } = sample_biome_grid(world.terrain, {
    world_size: WORLD_SIZE,
    world_center: WORLD_CENTER,
    cell_size: ZONE_SIZE,
  })
  if (side !== SIDE) throw new Error(`${world.world}: derived side ${side}, expected ${SIDE}`)
  const cell_chunks = []
  for (let start = 0; start < cells.length; start += MAX_PURE_ARGUMENT_SIZE - 3)
    cell_chunks.push(Buffer.from(cells.subarray(start, start + MAX_PURE_ARGUMENT_SIZE - 3)).toString('base64'))
  return {
    world: world.world,
    zone_x0: 0,
    zone_z0: 0,
    side: SIDE,
    biomes: world.terrain.biomes.map(({ name }) => name),
    cell_chunks,
  }
}

const targets = worlds.filter((world) => world.terrain && (!only || world.world === only))
if (targets.length === 0)
  throw new Error(only ? `world "${only}" has no terrain recipe` : 'no world has a terrain recipe')
for (const world of targets) console.log(JSON.stringify(derive(world)))
