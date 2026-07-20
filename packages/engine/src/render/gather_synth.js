// GATHER-NODE SPRITE SYNTHESIS — the frontend resource-node prop's procedural art, built from the SAME
// grass-idiom synthesis the world's flora uses. A node is NOT an item-icon card (the dead B8 approach that was
// rejected: "that's the wheat ITEM icon — procedurally generate real wheat like you did for grass textures");
// it renders REAL procedural wheat/herb/ore via the authored gather ops (texture_ops_gather.js
// op_wheat_sheaf/ore_vein/herb_cluster) run through the baker's bake_layer — whose OP_TABLE already carries
// GATHER_OPS and whose alpha-clip pass RGB-dilates the cut edges (clean blade/facet silhouettes, no dark fringe).
//
// DATA-FIRST: per-id colour is the authored 11-step level ramp (texture_recipes_gather.js WHEAT/ORE/HERB_RAMP —
// the ΔE-spaced single home; a hue lives in exactly one place). PURE + headless (no three): returns a raw RGBA
// byte buffer the frontend wraps in a DataTexture, so this whole module unit-tests without a GPU. Magical ids
// (arcane/bioluminescent/cursed) bake a BRIGHT albedo glow accent via the op's own glow_rgb path; the matching
// SELF-glow the frontend adds (an additive halo / ore emissive) is capped by emission_from_glow (the
// no-white-halo law, GATHER_EMISSION_LUMA_CEILING) so albedo+glow stays under the 2.05 MEDIUM bloom threshold.

import { bake_layer } from './texture_baker.js'
import { GATHER_RECIPES, ORE_RAMP, GLOW, emission_from_glow } from './texture_recipes_gather.js'

const SEED = 0x5eed // one fixed synth seed ⇒ a stable sprite per id (a node's own spawn_id jitters PLACEMENT, not art)
export const GATHER_TEX_SIZE = 64 // matches the atlas sprite res — the op silhouettes are tuned to read at 64px AND 32px

// ── GATHER NIGHT DIM (2026-07-19 screenshot: "glowing gatherables" — reed/gatherable billboards render
//    self-lit at night) — the gather node prop is an UNLIT MeshBasicMaterial(toneMapped:false), so it never took
//    the day/night light term terrain takes (couple_lighting dims the scene lights; water dims via sky_day_factor;
//    waterfalls via set_sky_dim). This is the ONE home for the gather night-dim scalar, consumed by BOTH the real
//    frontend prop (spawn_rigs.js create_gather_layer) AND the engine gather_demo.js replica, so the sprite darkens
//    at night off the SAME sky day/night level (engine.day_factor = sky_day_factor(sun.y)). The sprite is unlit
//    full-albedo, so it scales toward a night FLOOR that reads in the same band as moonlit terrain (couple_lighting's
//    AMBIENT_NIGHT_FLOOR) — never pitch black, never glowing. Day (day_factor 1) ⇒ ×1 = byte-identical to the tuned
//    day look; night (day_factor 0) ⇒ ×GATHER_NIGHT_FLOOR. The legitimate self-glow (apex gold halo / magical
//    bioluminescence) is NOT dimmed here — bioluminescence and the lantern read AT night by design.
export const GATHER_NIGHT_FLOOR = 0.4
/**
 * The gather-prop night-dim multiplier for a sky day/night level — 1 across daylight, GATHER_NIGHT_FLOOR below the
 * horizon (a linear ramp on the same day_factor the near water reflects). Pure; unit-testable without a GPU.
 * @param {number} day_factor 1 in daylight → 0 below the horizon (engine.day_factor / sky_day_factor(sun.y))
 * @returns {number} albedo multiplier in [GATHER_NIGHT_FLOOR, 1]
 */
export function gather_night_tint(day_factor) {
  const d = day_factor < 0 ? 0 : day_factor > 1 ? 1 : day_factor
  return GATHER_NIGHT_FLOOR + (1 - GATHER_NIGHT_FLOOR) * d
}

/** Resource id → its single-op gather recipe (wheat_sheaf | ore_vein | herb_cluster + the ramp-authored colours).
 *  @type {Record<string, import('./texture_recipes_gather.js').GatherRecipe>} */
const RECIPE_BY_ID = /** @type {any} */ (Object.fromEntries(GATHER_RECIPES.map((r) => [r.name, r])))

// MAGICAL self-glow — the ids whose ramp reads as arcane / bioluminescent / molten / cursed get a hued glow: a
// bright BAKED albedo accent (below, via the op's glow_rgb) + a capped frontend self-glow (node_glow). Mundane
// ids get none. The apex T11 of every family keeps the sanctioned GOLD halo (frontend), which supersedes this hue.
/** @type {Record<string, number[]>} */
const MAGICAL_GLOW = {
  // herbalist — the luminous plants
  nightcap: GLOW.spectral, // azure bioluminescent
  phantom_spore: GLOW.spectral, // pale ghost-cyan
  arcaneshroom: GLOW.arcane, // arcane violet
  dragonlily: GLOW.ember, // coral-red lily
  cursed_fungus: GLOW.cursed, // dark sickly (apex — gold halo wins, accent still cursed)
  // miner — the warm-glint + magical ores
  amber: GLOW.gold, // amber gold — a warm glint
  arcanite: GLOW.spectral, // arcane-cyan
  draconite: GLOW.ember, // draconic-orange
  cursed_gem: GLOW.cursed, // cursed toxic-green (apex — gold halo wins)
}

/**
 * The capped SELF-glow rgb for a resource id (the additive halo the frontend adds / an ore's emissive), or null
 * for a mundane id. `emission_from_glow` clamps luma to the no-white-halo ceiling; the BAKED albedo accent stays
 * bright (that lives in synth_gather_buffer). @param {string} id @returns {[number,number,number]|null}
 */
export function node_glow(id) {
  const g = MAGICAL_GLOW[id]
  return g ? emission_from_glow(g) : null
}

/**
 * Synthesize the procedural sprite for a resource id as a raw RGBA byte buffer — PURE + headless (the frontend
 * wraps it in a DataTexture). Reuses the baker's `bake_layer` (its OP_TABLE carries the gather ops) so the node
 * art is the exact grass-idiom synthesis with the authored per-id ramp colour; magical ids bake a bright albedo
 * glow accent (the op's glow_rgb — albedo only, never emission). Returns null for an unknown id so the caller can
 * render the node untextured rather than crash on a drifted chain row. @param {string} id @param {number} [size]
 * @returns {{ data: Uint8Array, size: number } | null}
 */
export function synth_gather_buffer(id, size = GATHER_TEX_SIZE) {
  const base = RECIPE_BY_ID[id]
  if (!base) return null
  const glow = MAGICAL_GLOW[id] // the BRIGHT hue for the albedo accent (not the capped self-glow)
  const recipe = glow ? { ...base, ops: [{ ...base.ops[0], glow_rgb: glow }] } : base
  const buf = bake_layer(recipe, size, SEED, 0) // Float32 RGBA 0..255, alpha-clip dilated (clean cut edges)
  const data = new Uint8Array(size * size * 4)
  for (let i = 0; i < data.length; i += 1) data[i] = buf[i] // 0..255 already; the typed array clamps + floors
  return { data, size }
}

// ORE identity tint — the crystalline vein colour (ORE_RAMP is the single home) + the magical emissive, for the
// frontend to tint the ore prop's grounding rock/crystal + drive the gentle pulse on the magical ores.
/** @type {Record<string, number[]>} */
const ORE_RGB = Object.fromEntries(ORE_RAMP.map((e) => [e.id, e.rgb]))
/** Ore id → { rgb (identity vein colour), emissive (capped self-glow rgb or null) }. @param {string} id */
export function ore_visual(id) {
  return { rgb: ORE_RGB[id] ?? [180, 200, 220], emissive: node_glow(id) }
}

// The shared wind gust (particles.js — the ONE handle) re-exported for the frontend gather layer: its tick
// drives `advance_gust(dt)` (the single-CPU-gust-value seam) and reads `GUST.value` to swell/calm the wheat+herb
// sway together with any GUST-reading motes. Kept here so the frontend has ONE gather-render import surface.
export { GUST, advance_gust } from './particles.js'
