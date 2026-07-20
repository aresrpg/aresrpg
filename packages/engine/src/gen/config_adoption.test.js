// CONFIG-ADOPTION GATE (BIOMES_EXECUTION_PLAN Phase 0 keystone). Proves three things:
//   1. GOLDEN PARITY — with the DEFAULT recipe, the full DECORATED gen pipeline (generate_world_chunk:
//      terrain core + beach flatten + decoration + relight) is BYTE-IDENTICAL to before config adoption.
//      The goldens below were captured from the PRE-adoption pipeline; if adoption moved a single block
//      this fails. This is the load-bearing proof that threading the config changed no behaviour.
//   2. SENSITIVITY — a MODIFIED recipe genuinely changes the generated world (the adoption is REAL, not
//      a no-op): the gen modules read the config, so flipping splines / sky / seed moves blocks.
//   3. WORLD SELECTION — every named world validates, and its config_hash differs from DEFAULT and from
//      every sibling (the world identity peers agree on), and set_gen_config (the worker's MSG_GEN_CONFIG
//      handshake) switches worlds and reverts cleanly.
//
// Determinism law (§3.7): pure arithmetic gen; same recipe ⇒ same world on every peer.

import { createHash } from 'node:crypto'

import { test, expect, describe, afterAll } from 'bun:test'

import { CHUNKS_PER_COLUMN } from '../config/world_config.js'
import { local_index } from '../chunks/format.js'
import {
  DEFAULT_WORLD_GEN_CONFIG,
  config_hash,
  config_hash_hex,
  validate_world_gen_config,
} from '../config/world_gen_config.js'
import { WORLD_CONFIGS, WORLD_NAMES, world_config_for_biome } from '../config/worlds/index.js'

import { generate_world_chunk, world_surface_y, set_gen_config } from './world_gen.js'
import { create_gen_context, generate_column } from './column_gen.js'

/** The canonical coord set hashed for the golden (spawn, mid, cave/river-ish, far, alpine-belt-ish). */
const COORDS = [
  [0, 0],
  [3, 3],
  [60, 60],
  [200, 200],
  [-49, -49],
]

/**
 * Combined sha256 over the full DECORATED chunk records (ids + biome + height + light) of every cy of
 * every canonical column. Same method the pre-adoption capture used, so the digest is directly
 * comparable. Reads the module's ACTIVE recipe (set via set_gen_config; DEFAULT when unset).
 * @returns {string} sha256 hex
 */
function hash_decorated_columns() {
  const h = createHash('sha256')
  for (const [cx, cz] of COORDS) {
    for (let cy = 0; cy < CHUNKS_PER_COLUMN; cy += 1) {
      const c = generate_world_chunk(cx, cy, cz)
      h.update(new Uint8Array(c.ids.buffer))
      h.update(c.biome)
      h.update(new Uint8Array(c.height.buffer))
      h.update(new Uint8Array(c.light.buffer))
    }
  }
  return h.digest('hex')
}

// Blessed digests captured from the PRE-adoption pipeline (2026-07-06). A move here means adoption
// changed the world — bump intentionally (a declared world fork, §4), never silently.
// RE-CUT 2026-07-07 (lead-approved, the ONE declared pre-launch world fork): the SCHEMATIC GROUNDING LAW
// (surface_decorator.grounded_placement — median-anchor + sink-1 + talus pedestal) moves every sloped
// schematic's decorated voxels. GOLDEN_SURFACE is unchanged (grounding moves DECORATION, not terrain).
// RE-CUT 2026-07-07 (TERRAIN REALISM BASELINE fork, GEN_VERSION 7 — docs/TERRAIN_REALISM_BASELINE.md):
// the DEFAULT relief ladder (crag base/roll/micro on everywhere) moves terrain world-wide; decorated
// digest re-blessed from the new pipeline (6f357a2a…a93a → 34242175…5e09). GOLDEN_SURFACE is unmoved —
// world_surface_y is deliberately the SMOOTH spline probe (mountain_relief/ladder excluded by design).
// RE-CUT 2026-07-11 (PROCEDURAL-TREES-DEFAULT fork, GEN_VERSION 8 — ENGINE_AAA_PLAN C4): trees.procedural
// flips true, so the DEFAULT world grows synthesized species skeletons instead of the retired schematic tree
// stamps; the decorated digest moves world-wide (34242175…5e09 → 02ca0682…c2ca). GOLDEN_SURFACE is UNMOVED
// (decoration is outside the terrain core; surface_y/spawn/chain-object coords stay valid — a decoration-only fork).
// RE-CUT 2026-07-11 (fixed: spawn water walls + glow mushrooms): TWO changes move the decorated
// digest — (1) hydrology.js river-containment clamp (fewer/lower water voxels where rivers cross a grade),
// (2) mushroom_giant (emissive azure caps) removed from the DEFAULT overworld tree_species. 02ca0682…c2ca
// → 6dc67d9f…6229. Deliberate re-bless (pre-mainnet, no peers). GOLDEN_SURFACE unmoved (spline probe).
// RE-CUT 2026-07-12 (BAKE-THEN-STAMP fork, GEN_VERSION 9 — pregenerate a lot
// of different trees and use them as schematics): trees.baked_variants=32 in the DEFAULT recipe — forest
// columns stamp a hash-picked pre-baked variant + quarter-turn rotation instead of per-column synthesis,
// so every tree voxel placement moves (6dc67d9f…6229 → 68685878…3662). GOLDEN_SURFACE is UNMOVED
// (decoration-only fork, same envelope as v8: terrain core/surface_y/spawn/chain coords stay valid).
// RE-CUT 2026-07-12 (FLAT-SMOOTH, GEN_VERSION 12 — the granular plains needed to read as smooth,
// DEFAULT byte-freeze LIFTED): crag.flat_lo/flat_hi damp the roll+micro jitter on low-relief plains (measured:
// flat-column roughness 0.412→0.227, steep unchanged 0.805). Both decorated AND surface move — but ONLY on
// flat columns (relief≤0); the coords that shifted are the plains ones (spawn-safety re-probed dry).
// RE-CUT 2026-07-13 (SPAWN-CLEARING fork, GEN_VERSION 13 — every world's INITIAL spawn region must be
// walkable, never a tree wall; the verdant_hollow repro). DECO_DEFAULTS.spawn_clear_radius (18) + falloff
// (16) SUPPRESS trees within ~18-34 blocks of the world spawn anchor (origin) on EVERY world, so the [0,0]
// chunk loses its near-origin trees (b864ac4b…95ce5 → 5621159c…eca5a). Decoration-only: GOLDEN_SURFACE is
// UNMOVED (terrain/surface_y/spawn/chain coords stay valid — the clearing removes trees, never terrain).
// RE-CUT 2026-07-13 (SPAWN DRY-FLOOR, GEN_VERSION 14 — the water-locked-spawn guarantee, coordinator ruling):
// hydrology.spawn_dry (code defaults radius 24 / falloff 24 / margin 2) lifts land within the spawn glade to
// ≥ sea_level+2 on EVERY world, DEFAULT included — the [0,0] chunk's wet near-origin columns rise to 130
// (5621159c…eca5a → af46937b…acff). GOLDEN_SURFACE is UNMOVED (world_surface_y is the smooth spline probe,
// raw_land excluded by design); on-chain spawn x/z stay valid (Y surface-sampled at render — round-1 verdict).
const GOLDEN_DECORATED = 'af46937bedbd390fd9dbbb9b478bb5897320872997d568fed06d3f67a0ebacff'
const GOLDEN_SURFACE = [131, 130, 122, 147, 137]

// Every test that switches the module's active recipe restores DEFAULT so nothing leaks across files.
afterAll(() => set_gen_config(DEFAULT_WORLD_GEN_CONFIG))

describe('config adoption: golden parity (DEFAULT ⇒ byte-identical world)', () => {
  test('the decorated pipeline reproduces the pre-adoption golden byte-for-byte', () => {
    set_gen_config(DEFAULT_WORLD_GEN_CONFIG)
    expect(hash_decorated_columns()).toBe(GOLDEN_DECORATED)
  })

  test('main-thread surface probes are unchanged', () => {
    set_gen_config(DEFAULT_WORLD_GEN_CONFIG)
    expect(COORDS.map(([cx, cz]) => world_surface_y(cx * 32, cz * 32))).toEqual(GOLDEN_SURFACE)
  })

  test('create_gen_context(DEFAULT) and create_gen_context() agree (default is the DEFAULT recipe)', () => {
    const a = generate_column(create_gen_context(), 3, 3)
    const b = generate_column(create_gen_context(DEFAULT_WORLD_GEN_CONFIG), 3, 3)
    for (let cy = 0; cy < a.length; cy += 1) expect(b[cy].ids).toEqual(a[cy].ids)
  })
})

/** Count blocks that differ between two columns (same coords, two recipes). */
function column_diff(a, b) {
  let diff = 0
  for (let cy = 0; cy < a.length; cy += 1)
    for (let i = 0; i < a[cy].ids.length; i += 1) if (a[cy].ids[i] !== b[cy].ids[i]) diff += 1
  return diff
}

describe('config adoption: sensitivity (a modified recipe changes the world — adoption is real)', () => {
  test('retuning the erosion→amplitude spline moves terrain', () => {
    const flat = {
      ...DEFAULT_WORLD_GEN_CONFIG,
      splines: {
        ...DEFAULT_WORLD_GEN_CONFIG.splines,
        erosion_to_amplitude: [
          [0, 8],
          [1, 3],
        ],
      },
    }
    const base = generate_column(create_gen_context(DEFAULT_WORLD_GEN_CONFIG), -49, -49)
    const moved = generate_column(create_gen_context(flat), -49, -49)
    expect(column_diff(base, moved)).toBeGreaterThan(0) // the shaper genuinely reads config.splines
  })

  test('a different master seed generates a different world (fields read config.seed)', () => {
    const base = generate_column(create_gen_context(DEFAULT_WORLD_GEN_CONFIG), 3, 3)
    const other = generate_column(create_gen_context({ ...DEFAULT_WORLD_GEN_CONFIG, seed: 'other-world' }), 3, 3)
    expect(column_diff(base, other)).toBeGreaterThan(0)
  })
})

describe('config adoption: world selection (registry + identity + worker handshake)', () => {
  test('every named world validates and its config_hash differs from DEFAULT + every sibling', () => {
    const default_h = config_hash(DEFAULT_WORLD_GEN_CONFIG)
    const hashes = new Set([default_h])
    for (const name of WORLD_NAMES) {
      const world = WORLD_CONFIGS[name]
      expect(validate_world_gen_config(world).ok, `${name} validates`).toBe(true)
      const h = config_hash(world)
      expect(h, `${name} hash differs from DEFAULT`).not.toBe(default_h)
      expect(hashes.has(h), `${name} hash is unique`).toBe(false)
      hashes.add(h)
    }
    expect(hashes.size).toBe(WORLD_NAMES.length + 1) // DEFAULT + 5 worlds, all distinct
  })

  test('world_config_for_biome resolves known names and falls back to DEFAULT on unknown', () => {
    expect(config_hash_hex(world_config_for_biome('everest'))).toBe(config_hash_hex(WORLD_CONFIGS.everest))
    expect(world_config_for_biome(null)).toBe(DEFAULT_WORLD_GEN_CONFIG)
    expect(world_config_for_biome('atlantis')).toBe(DEFAULT_WORLD_GEN_CONFIG) // unknown → default (warns)
  })

  test('set_gen_config (the worker MSG_GEN_CONFIG handshake) switches worlds and reverts cleanly', () => {
    set_gen_config(DEFAULT_WORLD_GEN_CONFIG)
    const golden = hash_decorated_columns()
    expect(golden).toBe(GOLDEN_DECORATED)
    // Switch to a distinct-seed world → the module now generates a different world.
    set_gen_config({ ...DEFAULT_WORLD_GEN_CONFIG, seed: 'other-world' })
    expect(hash_decorated_columns()).not.toBe(golden)
    // Revert → byte-identical to the golden again (no leaked state).
    set_gen_config(DEFAULT_WORLD_GEN_CONFIG)
    expect(hash_decorated_columns()).toBe(golden)
  })
})
