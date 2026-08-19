// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Ground scatter — the deterministic clutter a surface column grows (tall grass, flowers,
// mushrooms, twigs, pebbles, ice spikes). Placement is a pure function of the compiled world and
// a chunk origin: the column's VISIBLE top material (the same terrain_material_id call the mesher
// uses) picks the kind family through its preset, and every color derives from the authored
// material colors — nothing here owns a palette. Rendering lives in scatter_layer.ts.

import type { MaterialPreset } from './material_presets.ts'
import type { StructurePlacement } from './structure_placement.ts'
import type { Vec3 } from './types.ts'
import { CHUNK_EDGE } from './voxel_data.ts'
import { field_value, hash_position } from './world_noise.ts'
import { sample_world_column, terrain_material_id, terrain_slope, type CompiledWorld } from './world_recipe.ts'

export type ScatterKind = 'tuft' | 'bush' | 'flower' | 'mushroom' | 'twig' | 'pebble' | 'spike'
/** Pre-built geometry variants per kind (scatter_layer bakes them; placement only picks an index). */
export const RECIPE_VARIANTS = 8
type Rgb = readonly [number, number, number]
export type ScatterInstance = Readonly<{
  x: number
  y: number
  z: number
  kind: ScatterKind
  /** Picks one of the pre-built geometry variants so neighbours never repeat a silhouette. */
  variant: number
  yaw: number
  scale: number
  color: Rgb
  accent: Rgb
  /** 1 when the shader must apply the terrain's climate tint (living growth on tinted ground). */
  climate_tint: 0 | 1
}>

type ScatterRule = Readonly<{ kind: ScatterKind; chance_bp: number; humidity_scaled?: boolean }>

/** Rarest kind first — one plant per column, the first winning rule takes it. */
const PRESET_RULES: Readonly<Record<MaterialPreset, readonly ScatterRule[]>> = Object.freeze({
  grass: [
    { kind: 'flower', chance_bp: 240, humidity_scaled: true },
    { kind: 'bush', chance_bp: 380, humidity_scaled: true },
    { kind: 'tuft', chance_bp: 3400, humidity_scaled: true },
  ],
  earth: [
    { kind: 'mushroom', chance_bp: 200, humidity_scaled: true },
    { kind: 'twig', chance_bp: 260 },
    { kind: 'tuft', chance_bp: 550, humidity_scaled: true },
  ],
  sand: [
    { kind: 'pebble', chance_bp: 220 },
    { kind: 'tuft', chance_bp: 160 },
  ],
  snow: [
    { kind: 'twig', chance_bp: 100 },
    { kind: 'pebble', chance_bp: 140 },
  ],
  ice: [{ kind: 'spike', chance_bp: 240 }],
  stone: [
    { kind: 'spike', chance_bp: 70 },
    { kind: 'pebble', chance_bp: 340 },
  ],
  wood: [],
  foliage: [],
  water: [],
})

const SALT_SPAWN = 0x51afd7e9
const SALT_PATCH = 0x3f6b8d21
const SALT_JITTER_X = 0x6d2e4b17
const SALT_JITTER_Z = 0x9b4f27e5
const SALT_YAW = 0x2c1b3a9f
const SALT_SCALE = 0x7a5e11c3
const SALT_COLOR = 0x165667b1
const SALT_VARIANT = 0xd3a2646d
const SALT_PATCH_BROAD = 0x27d4eb2e

const smoothstep_01 = (low: number, high: number, value: number): number => {
  const amount = Math.max(0, Math.min(1, (value - low) / (high - low)))
  return amount * amount * (3 - 2 * amount)
}

/** Two octaves + a sharpening band: broad meadow waves with true bare gaps, never a linear
 * gradient (an even sprinkle reads as poles; a single smooth field reads as a slow fade). */
const PATCH_PERIOD_BROAD = 96
const PATCH_PERIOD_FINE = 24
/** Cliff faces stay bare — the mesher already swapped their cover for filler well before this. */
const MAX_SLOPE = 4

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

const scale_rgb = ([r, g, b]: Rgb, factor: number): Rgb => [r * factor, g * factor, b * factor]

const lighten = ([r, g, b]: Rgb, amount: number): Rgb => [
  r + (1 - r) * amount,
  g + (1 - g) * amount,
  b + (1 - b) * amount,
]

const rgb_to_hsv = ([r, g, b]: Rgb): readonly [number, number, number] => {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const hue =
    delta === 0
      ? 0
      : max === r
        ? (((g - b) / delta + 6) % 6) / 6
        : max === g
          ? ((b - r) / delta + 2) / 6
          : ((r - g) / delta + 4) / 6
  return [hue, max === 0 ? 0 : delta / max, max]
}

const hsv_to_rgb = ([hue, saturation, value]: readonly [number, number, number]): Rgb => {
  const channel = (offset: number): number => {
    const k = (offset + hue * 6) % 6
    return value - value * saturation * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [channel(5), channel(3), channel(1)]
}

const hue_rotate = (color: Rgb, degrees: number): Rgb => {
  const [hue, saturation, value] = rgb_to_hsv(color)
  return hsv_to_rgb([(hue + degrees / 360 + 1) % 1, saturation, value])
}

const saturate = (color: Rgb, amount: number): Rgb => {
  const [hue, saturation, value] = rgb_to_hsv(color)
  return hsv_to_rgb([hue, clamp01(saturation + amount), value])
}

type ColumnColors = Readonly<{ surface: Rgb; subsurface: Rgb; filler: Rgb }>

/** Every scatter color is a transform of the authored block colors — the biome recolors its own clutter. */
const derive_colors = (
  kind: ScatterKind,
  colors: ColumnColors,
  roll: number
): Readonly<{ color: Rgb; accent: Rgb }> => {
  switch (kind) {
    case 'tuft': {
      // Dark rooted base, brighter saturated tip — the gradient reads as depth inside the clump.
      const body = scale_rgb(colors.surface, 0.5 + roll * 0.25)
      return { color: body, accent: saturate(scale_rgb(colors.surface, 1.2 + roll * 0.25), 0.12) }
    }
    case 'bush': {
      // Deeper green than the carpet — a bush is denser foliage than the ground it sits on.
      const body = scale_rgb(colors.surface, 0.4 + roll * 0.2)
      return { color: body, accent: saturate(scale_rgb(colors.surface, 0.95 + roll * 0.25), 0.15) }
    }
    case 'flower': {
      // Only the HUE derives from the ground — petals force full saturation and brightness,
      // otherwise a muted meadow breeds grey blooms (owner 2026-08-19: "grey, feels a bit sad").
      const [surface_hue] = rgb_to_hsv(colors.surface)
      const petal_hue = (surface_hue + (100 + roll * 200) / 360) % 1
      return { color: scale_rgb(colors.surface, 0.55), accent: hsv_to_rgb([petal_hue, 0.85, 0.95]) }
    }
    case 'mushroom':
      return {
        color: lighten(colors.subsurface, 0.45),
        accent: saturate(hue_rotate(colors.subsurface, -40 + roll * 60), 0.2),
      }
    case 'twig': {
      const wood = scale_rgb(colors.subsurface, 0.45 + roll * 0.25)
      return { color: wood, accent: wood }
    }
    case 'pebble': {
      const body = scale_rgb(colors.filler, 0.75 + roll * 0.35)
      return { color: body, accent: lighten(body, 0.18) }
    }
    case 'spike':
      return { color: scale_rgb(colors.surface, 0.9), accent: lighten(colors.surface, 0.5) }
  }
}

/** Deterministic clutter for the chunk at `origin` — only columns whose top solid voxel lies in
 * this chunk's vertical slab spawn here, so every (x,z) has exactly one owning chunk. Columns
 * inside a structure's overlap footprint stay bare (nothing grows through a trunk or a ruin). */
export const chunk_scatter = (
  world: CompiledWorld,
  origin: Vec3,
  structures: readonly StructurePlacement[] = []
): readonly ScatterInstance[] => {
  const edge = CHUNK_EDGE + 2
  const columns = Array.from({ length: edge * edge }, (_, index) =>
    sample_world_column(world, origin[0] + (index % edge) - 1, origin[2] + Math.floor(index / edge) - 1)
  )
  const instances: ScatterInstance[] = []
  const roll_01 = (kind: string, x: number, z: number, salt: number): number =>
    hash_position(world.decoration_seed, `scatter:${kind}`, x, z, salt) / 0x1_0000_0000
  for (let z = 0; z < CHUNK_EDGE; z += 1)
    for (let x = 0; x < CHUNK_EDGE; x += 1) {
      const index = (z + 1) * edge + x + 1
      const column = columns[index]!
      const top_y = column.surface_y - 1
      if (top_y < origin[1] || top_y >= origin[1] + CHUNK_EDGE) continue
      if (column.surface_y <= world.recipe.sea_level) continue
      const slope = terrain_slope(column.surface_y, [
        columns[index - 1]!.surface_y,
        columns[index + 1]!.surface_y,
        columns[index - edge]!.surface_y,
        columns[index + edge]!.surface_y,
      ])
      if (slope >= MAX_SLOPE) continue
      const material = world.materials.entries[terrain_material_id(column, 0, slope)]!
      const world_x = origin[0] + x
      const world_z = origin[2] + z
      if (
        structures.some(
          ({ overlap_bounds }) =>
            world_x >= overlap_bounds.min_x &&
            world_x <= overlap_bounds.max_x &&
            world_z >= overlap_bounds.min_z &&
            world_z <= overlap_bounds.max_z
        )
      )
        continue
      for (const rule of PRESET_RULES[material.preset]) {
        const broad = field_value(
          world.decoration_seed,
          `scatter:${rule.kind}`,
          world_x,
          world_z,
          PATCH_PERIOD_BROAD,
          SALT_PATCH_BROAD
        )
        const fine = field_value(
          world.decoration_seed,
          `scatter:${rule.kind}`,
          world_x,
          world_z,
          PATCH_PERIOD_FINE,
          SALT_PATCH
        )
        const density = smoothstep_01(0.32, 0.72, broad * 0.6 + fine * 0.4)
        const humidity = rule.humidity_scaled ? 0.25 + 0.75 * column.climate.humidity : 1
        const chance = rule.chance_bp * (0.12 + 0.88 * density) * humidity
        if (
          hash_position(world.decoration_seed, `scatter:${rule.kind}`, world_x, world_z, SALT_SPAWN) % 10_000 >=
          chance
        )
          continue
        const column_colors: ColumnColors = {
          surface: material.color,
          subsurface: world.materials.entries[column.subsurface_id]!.color,
          filler: world.materials.entries[column.filler_id]!.color,
        }
        instances.push(
          Object.freeze({
            x: world_x + 0.1 + roll_01(rule.kind, world_x, world_z, SALT_JITTER_X) * 0.8,
            y: column.surface_y,
            z: world_z + 0.1 + roll_01(rule.kind, world_x, world_z, SALT_JITTER_Z) * 0.8,
            kind: rule.kind,
            variant:
              hash_position(world.decoration_seed, `scatter:${rule.kind}`, world_x, world_z, SALT_VARIANT) %
              RECIPE_VARIANTS,
            yaw: roll_01(rule.kind, world_x, world_z, SALT_YAW) * Math.PI * 2,
            // Dense patches also grow TALLER — height rides the same field as presence.
            scale: (0.7 + roll_01(rule.kind, world_x, world_z, SALT_SCALE) * 0.5) * (0.85 + density * 0.45),
            // Flowers stay OUT of the climate tint — the green-leaning field muddies petals.
            climate_tint:
              material.climate_tint && (rule.kind === 'tuft' || rule.kind === 'bush') ? (1 as const) : (0 as const),
            ...derive_colors(rule.kind, column_colors, roll_01(rule.kind, world_x, world_z, SALT_COLOR)),
          })
        )
        break
      }
    }
  return Object.freeze(instances)
}
