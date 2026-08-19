// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ZONE POPULATION TWIN — a line-for-line mirror of aresrpg_math::zone_math (mob_groups /
// resource_packs): same prng (@aresrpg/fight's mulberry32 twin of aresrpg_math::prng), same
// draw ORDER (every group draws even when its taken-bit filters it out — the stream is the
// contract), same ramps, same biome window. A change in zone_math.move lands here in the same
// commit (triplet law). World content comes from the SAME homes the publish ceremony reads:
// seed/content/worlds.json rows + the engine's biome grid sampled with the published window
// (frontend/src/admin/seed_content.ts is the ceremony's identical derivation).

import { draw, mix, rng_seed } from '@aresrpg/fight/prng'
import { sample_biome_grid, type BiomeGrid } from '@aresrpg/engine/biomes'
import { parse_world_recipe } from '@aresrpg/engine/recipe'
import type { MobGroupRow, ResourcePackRow } from '@aresrpg/protocol'

import worlds_source from '../../../seed/content/worlds.json'

const ZONE_SIZE = 512n
const WORLD_SIZE = 100_000
const WORLD_CENTER = 50_000n
const GROUPS_MIN = 48n
const GROUPS_MAX = 64n
const RES_PACKS_MIN = 24n
const RES_PACKS_MAX = 42n
const GROUP_SIZE_FULL_AT = 10_000n
const GROUP_SIZE_AVG3_AT = 2_000n
const LEVEL_RAMP_AT = 20_000n
const LEVEL_FLOOR_CAP = 75n
const NODES_RAMP_AT = 20_000n
const HOMOGENEOUS_BP = 5_000n

type MobRow = Readonly<{ mob_type: string; weight_bp: bigint; biomes: readonly number[] }>
type ResourceRow = Readonly<{ item_type: string; job: string; tier: number; biomes: readonly number[] }>
type WorldPopulation = Readonly<{ mobs: readonly MobRow[]; resources: readonly ResourceRow[]; map: BiomeGrid }>

const populations = new Map<string, WorldPopulation | null>()

/** The authored content of one world, in the exact shape the chain holds (biome NAMES become
 *  the terrain's biome INDEXES — the publish ceremony's own conversion). Cached per world. */
export const world_population = (world: string): WorldPopulation | null => {
  if (populations.has(world)) return populations.get(world)!
  const source = (worlds_source as readonly Record<string, unknown>[]).find((row) => row.world === world)
  const terrain = source?.terrain as Readonly<{ biomes: readonly { name: string }[] }> | undefined
  if (!source || !terrain) {
    populations.set(world, null)
    return null
  }
  const biome_id = (name: string): number => terrain.biomes.findIndex((biome) => biome.name === name)
  const mobs = (source.mobs as readonly { mob_type: string; weight_bp: number; biomes: readonly string[] }[]).map(
    (row) =>
      Object.freeze({
        mob_type: row.mob_type,
        weight_bp: BigInt(row.weight_bp),
        biomes: Object.freeze(row.biomes.map(biome_id)),
      })
  )
  const resources = (
    source.resources as readonly { item_type: string; job: string; tier: number; biomes: readonly string[] }[]
  ).map((row) =>
    Object.freeze({
      item_type: row.item_type,
      job: row.job,
      tier: row.tier,
      biomes: Object.freeze(row.biomes.map(biome_id)),
    })
  )
  const map = sample_biome_grid(parse_world_recipe(source.terrain), {
    world_size: WORLD_SIZE,
    world_center: Number(WORLD_CENTER),
    cell_size: Number(ZONE_SIZE),
  })
  const population = Object.freeze({ mobs: Object.freeze(mobs), resources: Object.freeze(resources), map })
  populations.set(world, population)
  return population
}

/** world_map::biome_of_zone — the published window starts at zone (0,0). */
const biome_of_zone = (map: BiomeGrid, zx: number, zz: number): number => {
  if (map.side === 0) return 0
  const last = map.side - 1
  const cx = Math.min(Math.max(zx, 0), last)
  const cz = Math.min(Math.max(zz, 0), last)
  return map.cells[cz * map.side + cx]!
}

const distance_blocks = (zx: bigint, zz: bigint): bigint => {
  const px = zx * ZONE_SIZE + ZONE_SIZE / 2n
  const pz = zz * ZONE_SIZE + ZONE_SIZE / 2n
  const dx = px >= WORLD_CENTER ? px - WORLD_CENTER : WORLD_CENTER - px
  const dz = pz >= WORLD_CENTER ? pz - WORLD_CENTER : WORLD_CENTER - pz
  return dx >= dz ? dx : dz
}

const ramp = (distance: bigint, full_at: bigint, from: bigint, to: bigint): bigint => {
  const capped = distance > full_at ? full_at : distance
  return from + ((to - from) * capped) / full_at
}

const weighted_family = (rows: readonly MobRow[], total: bigint, cursor: { state: bigint }): string => {
  const roll = draw(cursor) % total
  let accumulated = 0n
  for (const row of rows) {
    accumulated += row.weight_bp
    if (roll < accumulated) return row.mob_type
  }
  return rows.at(-1)!.mob_type // unreachable when weights sum to total — Move loops forever here
}

/** zone_math::mob_groups — `taken` is the on-chain u128 consumption bitmap. */
export const mob_groups = (
  population: WorldPopulation,
  zx: number,
  zz: number,
  seed: bigint,
  taken: bigint
): readonly MobGroupRow[] => {
  const biome = biome_of_zone(population.map, zx, zz)
  const rows = population.mobs.filter((row) => row.biomes.includes(biome))
  if (rows.length === 0) return []
  const total = rows.reduce((sum, row) => sum + row.weight_bp, 0n)
  const distance = distance_blocks(BigInt(zx), BigInt(zz))
  const cursor = { state: rng_seed(mix(seed, 2n)) }
  const count = GROUPS_MIN + (draw(cursor) % (GROUPS_MAX - GROUPS_MIN + 1n))
  const size_lo = ramp(distance, GROUP_SIZE_FULL_AT, 1n, 6n)
  const size_hi_raw = ramp(distance, GROUP_SIZE_AVG3_AT * 3n, 1n, 6n)
  const size_hi = size_hi_raw < size_lo ? size_lo : size_hi_raw
  const level_floor = ramp(distance, LEVEL_RAMP_AT, 0n, LEVEL_FLOOR_CAP)
  const groups: MobGroupRow[] = []
  for (let index = 0n; index < count; index += 1n) {
    const x = BigInt(zx) * ZONE_SIZE + (draw(cursor) % ZONE_SIZE)
    const z = BigInt(zz) * ZONE_SIZE + (draw(cursor) % ZONE_SIZE)
    const size = size_lo + (draw(cursor) % (size_hi - size_lo + 1n))
    const homogeneous = draw(cursor) % 10_000n < HOMOGENEOUS_BP
    const family = weighted_family(rows, total, cursor)
    const members: MobGroupRow['members'] = []
    for (let member = 0n; member < size; member += 1n) {
      const mob_type = homogeneous ? family : weighted_family(rows, total, cursor)
      const scalar = level_floor + (draw(cursor) % (101n - level_floor))
      members.push({ mob_type, level_scalar: Number(scalar) })
    }
    if ((taken & (1n << index)) === 0n) groups.push({ index: Number(index), x: Number(x), z: Number(z), members })
  }
  return groups
}

/** zone_math::resource_packs — `taken[index]` is the pack's consumed-node count. */
export const resource_packs = (
  population: WorldPopulation,
  zx: number,
  zz: number,
  seed: bigint,
  taken: readonly number[]
): readonly ResourcePackRow[] => {
  const biome = biome_of_zone(population.map, zx, zz)
  const rows = population.resources.filter((row) => row.biomes.includes(biome))
  if (rows.length === 0) return []
  const distance = distance_blocks(BigInt(zx), BigInt(zz))
  const cursor = { state: rng_seed(mix(seed, 3n)) }
  const nodes_lo = ramp(distance, NODES_RAMP_AT, 2n, 16n)
  const nodes_hi = ramp(distance, NODES_RAMP_AT, 4n, 22n)
  const count = RES_PACKS_MIN + (draw(cursor) % (RES_PACKS_MAX - RES_PACKS_MIN + 1n))
  const packs: ResourcePackRow[] = []
  for (let index = 0n; index < count; index += 1n) {
    const x = BigInt(zx) * ZONE_SIZE + (draw(cursor) % ZONE_SIZE)
    const z = BigInt(zz) * ZONE_SIZE + (draw(cursor) % ZONE_SIZE)
    const row = rows[Number(draw(cursor) % BigInt(rows.length))]!
    const nodes = nodes_lo + (draw(cursor) % (nodes_hi - nodes_lo + 1n))
    const consumed = BigInt(taken[Number(index)] ?? 0)
    if (consumed < nodes)
      packs.push({
        index: Number(index),
        x: Number(x),
        z: Number(z),
        item_type: row.item_type,
        job: row.job,
        tier: row.tier,
        nodes: Number(nodes - consumed),
      })
  }
  return packs
}
