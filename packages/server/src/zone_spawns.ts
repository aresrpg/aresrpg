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
import { ZONE_SIZE as ZONE_BLOCKS, type MobGroupRow, type ResourcePackRow } from '@aresrpg/protocol'
import { archimob_appearance_bp, archimob_rows, type ArchimobRow } from '@aresrpg/immutable'

import mobs_source from '../../../seed/content/mobs.json'
import worlds_source from '../../../seed/content/worlds.json'

/** the wire's zone unit, not a second opinion — protocol is this side's one home */
const ZONE_SIZE = BigInt(ZONE_BLOCKS)
const WORLD_SIZE = 100_000
const WORLD_CENTER = 50_000n
const GROUPS_MIN = 48n
const GROUPS_MAX = 64n
const RES_PACKS_MIN = 24n
const RES_PACKS_MAX = 42n
const CITY_RESOURCE_NODE_NUMERATOR = 3n
const CITY_RESOURCE_NODE_DENOMINATOR = 2n
const GROUP_SIZE_FULL_AT = 10_000n
const GROUP_SIZE_AVG3_AT = 2_000n
const LEVEL_RAMP_AT = 20_000n
const LEVEL_LOW_CAP = 75n
const LEVEL_HIGH_CAP = 100n
const NODES_RAMP_AT = 20_000n
const HOMOGENEOUS_BP = 5_000n
const ARCHIMOB_BP = BigInt(archimob_appearance_bp)

type MobRow = Readonly<{ mob_type: string; weight_bp: bigint; biomes: readonly number[]; cities: readonly number[] }>
type ResourceRow = Readonly<{ item_type: string; biomes: readonly number[]; cities: readonly number[] }>
type CityRow = Readonly<{ city: string; dungeon: string; x: number; z: number }>
type WorldPopulation = Readonly<{
  mobs: readonly MobRow[]
  resources: readonly ResourceRow[]
  cities: readonly CityRow[]
  archis: readonly ArchimobRow[]
  map: BiomeGrid
}>

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
  const cities = (source.cities as readonly CityRow[]).map(({ city, dungeon, x, z }) =>
    Object.freeze({ city, dungeon, x, z })
  )
  const city_id = (name: string): number => cities.findIndex((city) => city.city === name)
  const mobs = (
    source.mobs as readonly {
      mob_type: string
      weight_bp: number
      biomes: readonly string[]
      cities?: readonly string[]
    }[]
  ).map((row) =>
    Object.freeze({
      mob_type: row.mob_type,
      weight_bp: BigInt(row.weight_bp),
      biomes: Object.freeze(row.biomes.map(biome_id)),
      cities: Object.freeze((row.cities ?? []).map(city_id)),
    })
  )
  const archis = archimob_rows(
    mobs_source,
    mobs.map(({ mob_type }) => mob_type)
  )
  const resources = (
    source.resources as readonly {
      item_type: string
      biomes: readonly string[]
      cities?: readonly string[]
    }[]
  ).map((row) =>
    Object.freeze({
      item_type: row.item_type,
      biomes: Object.freeze(row.biomes.map(biome_id)),
      cities: Object.freeze((row.cities ?? []).map(city_id)),
    })
  )
  const map = sample_biome_grid(parse_world_recipe(source.terrain), {
    world_size: WORLD_SIZE,
    world_center: Number(WORLD_CENTER),
    cell_size: Number(ZONE_SIZE),
  })
  const population = Object.freeze({
    mobs: Object.freeze(mobs),
    resources: Object.freeze(resources),
    cities: Object.freeze(cities),
    archis,
    map,
  })
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

export const mob_group_size_bounds = (distance: bigint): readonly [bigint, bigint] => {
  const low = ramp(distance, GROUP_SIZE_FULL_AT, 1n, 6n)
  // At 2,000 blocks low=2 and high=4: uniform 2..4 has the authored average of three.
  const high = ramp(distance, (GROUP_SIZE_AVG3_AT * 5n) / 3n, 1n, 6n)
  return Object.freeze([low, high < low ? low : high])
}

export const mob_level_scalar_bounds = (distance: bigint): readonly [bigint, bigint] =>
  Object.freeze([ramp(distance, LEVEL_RAMP_AT, 0n, LEVEL_LOW_CAP), ramp(distance, LEVEL_RAMP_AT, 0n, LEVEL_HIGH_CAP)])

const city_index_at = (population: WorldPopulation, zx: number, zz: number): number =>
  population.cities.findIndex(
    ({ x, z }) => Math.abs(zx - Math.floor(x / ZONE_BLOCKS)) <= 1 && Math.abs(zz - Math.floor(z / ZONE_BLOCKS)) <= 1
  )

const population_rows = <Row extends Readonly<{ biomes: readonly number[]; cities: readonly number[] }>>(
  population: WorldPopulation,
  rows: readonly Row[],
  zx: number,
  zz: number
): readonly Row[] => {
  const city = city_index_at(population, zx, zz)
  if (city >= 0) return rows.filter((row) => row.cities.includes(city))
  const biome = biome_of_zone(population.map, zx, zz)
  return rows.filter((row) => row.biomes.includes(biome))
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

export const archimob_type_for_roll = (ordinary_type: string, archis: readonly ArchimobRow[], roll: bigint): string => {
  if (roll >= ARCHIMOB_BP) return ordinary_type
  const replacement = archis.find((row) => row.ordinary_type === ordinary_type)
  return replacement?.archi_type ?? ordinary_type
}

/** zone_math::mob_groups, MINUS its taken filter: every group the seed draws, in draw order.
 *  zone_math itself draws them all and only skips the taken ones on the way out — so emitting
 *  the whole stream is the same derivation, not a looser one. Liveness is the caller's job
 *  (a set bit in the zone's `mob_taken`), because the population is worth sending once per
 *  seed while consumption changes constantly. */
export const mob_groups = (
  population: WorldPopulation,
  zx: number,
  zz: number,
  seed: bigint
): readonly MobGroupRow[] => {
  const rows = population_rows(population, population.mobs, zx, zz)
  if (rows.length === 0) return []
  const total = rows.reduce((sum, row) => sum + row.weight_bp, 0n)
  const distance = distance_blocks(BigInt(zx), BigInt(zz))
  const cursor = { state: rng_seed(mix(seed, 2n)) }
  const archi_cursor = { state: rng_seed(mix(seed, 4n)) }
  const count = GROUPS_MIN + (draw(cursor) % (GROUPS_MAX - GROUPS_MIN + 1n))
  const [size_lo, size_hi] = mob_group_size_bounds(distance)
  const [level_lo, level_hi] = mob_level_scalar_bounds(distance)
  const groups: MobGroupRow[] = []
  for (let index = 0n; index < count; index += 1n) {
    const x = BigInt(zx) * ZONE_SIZE + (draw(cursor) % ZONE_SIZE)
    const z = BigInt(zz) * ZONE_SIZE + (draw(cursor) % ZONE_SIZE)
    const size = size_lo + (draw(cursor) % (size_hi - size_lo + 1n))
    const homogeneous = draw(cursor) % 10_000n < HOMOGENEOUS_BP
    const family = weighted_family(rows, total, cursor)
    const members: MobGroupRow['members'] = []
    for (let member = 0n; member < size; member += 1n) {
      const ordinary_type = homogeneous ? family : weighted_family(rows, total, cursor)
      const scalar = level_lo + (draw(cursor) % (level_hi - level_lo + 1n))
      const mob_type = archimob_type_for_roll(ordinary_type, population.archis, draw(archi_cursor) % 10_000n)
      members.push({ mob_type, level_scalar: Number(scalar) })
    }
    groups.push({ index: Number(index), x: Number(x), z: Number(z), members })
  }
  return groups
}

/** zone_math::resource_packs, MINUS its consumption filter: every pack the seed draws with its
 *  TOTAL node count. What is left of a pack is `nodes - res_taken[index]`, derived by whoever
 *  holds the zone's state — same reason as `mob_groups`. */
export const resource_packs = (
  population: WorldPopulation,
  zx: number,
  zz: number,
  seed: bigint
): readonly ResourcePackRow[] => {
  const rows = population_rows(population, population.resources, zx, zz)
  if (rows.length === 0) return []
  const city = city_index_at(population, zx, zz) >= 0
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
    const ordinary_nodes = nodes_lo + (draw(cursor) % (nodes_hi - nodes_lo + 1n))
    const nodes = city
      ? (ordinary_nodes * CITY_RESOURCE_NODE_NUMERATOR) / CITY_RESOURCE_NODE_DENOMINATOR
      : ordinary_nodes
    packs.push({ index: Number(index), x: Number(x), z: Number(z), item_type: row.item_type, nodes: Number(nodes) })
  }
  return packs
}
