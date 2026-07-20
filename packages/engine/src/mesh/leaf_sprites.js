// D164 REFERENCE-STYLE LEAF SPRITE CLUSTERS + SNOW-ON-LEAF DEPOSITS (addendum 3), extracted from
// mesher.js so it stays under the ≤600-LoC law. Leaf voxels DON'T render as cubes: every SURFACE leaf cell
// (≥1 exposed non-solid neighbour) emits a sprite CLUSTER — K crossed pairs (faces 6/7, leaf id → CUTOUT
// class) of yaw-scattered ~1.2 m billboards reading as an organic mass; INTERIOR leaves emit NOTHING
// (hollow canopy shell = the budget saver). [D164-B] Canopy snow is a baked WHITE-TOP leaf texture + a
// mesher cube-suppression — NOT a deposit sprite (target: "remove the snow blocks directly, white on top").
// Occupancy/collision stay exact 1 m cubes (gen sets occupancy; leaves keep theirs, cube faces suppressed
// in the mesher's solid pass). Pure geometry — no determinism/p2p surface. The caller passes its staging
// `write` closure + a `solid` probe (isolation/halo-aware) so this module owns no chunk-format knowledge.

import { CHUNK_SIZE } from '../config/world_config.js'
import { local_index } from '../chunks/format.js'
import { BLOCK_REGISTRY, is_leaf_sprite_block } from '../config/block_registry.js'

/** Leaf block ids that render as sprite clusters — resolved once via the shared `is_leaf_sprite_block`
 *  predicate (broadleaf/conifer/dry/palm; the SINGLE home for leaf-render-ness). Leaves keep OCCUPANCY
 *  (collision + neighbour culling) but their cube faces are suppressed. @type {Set<number>} */
export const LEAF_SPRITE_IDS = new Set(BLOCK_REGISTRY.filter(is_leaf_sprite_block).map((b) => b.id))
/** Snow block id (−1 if absent) — exported for the mesher's canopy-snow cube SUPPRESSION (D164-B: the cube
 *  is hidden and the taiga leaf texture bakes a white top; no deposit sprite). @type {number} */
export const SNOW_ID = /** @type {number} */ (BLOCK_REGISTRY.find((b) => b.name === 'snow')?.id ?? -1)
/** Independent crossed PAIRS per surface leaf cell when terrain_displacement is ON = 2K yaw-scattered planes
 *  (the flora chaos ordinal 0..K-1). 2 (=4 planes) judged: a fuller organic tangle than a rigid 3-plane
 *  hexagon, cheaper, reuses flora exactly. OFF ⇒ 1 pair (a cheap single X) — never a cube, never empty. */
export const LEAF_SPRITE_PAIRS = 1 // [D176 — fps must hold constant at 120] one big fully-oriented pair per cell — half the canopy planes; the 1.9×1.8 all-direction planes carry the volume
/** Leaf sprite wire height (blocks). 2 = the ceil envelope; the material's height_frac (registry_nodes
 *  LEAF_SPRITE_FRAC) scales the true ~1.3 m puff so a cell-filling blob overlaps neighbours into a mass. */
export const LEAF_SPRITE_H = 2
/** Hard per-chunk cap on leaf/snow sprite PAIRS (2 quads each) — bounds a pathological crown; a runaway is
 *  capped, never dropped-with-holes (an over-cap leaf simply loses a sprite that frame). */
export const MAX_LEAF_SPRITES = 3072

/** Faces 6/7 = the crossed billboard plane pair (mirrors mesher.js CROSS_FACE_A/B). */
const FACE_A = 6
const FACE_B = 7

/** [D164-B A/B] Debug lever: render leaves + canopy-snow as OPAQUE CUBES (the PRE-WAVE baseline) instead of
 *  sprite clusters — the mesher reads `leaf_cubes_debug()` to skip its leaf/snow cube-face SUPPRESSION and
 *  emit_leaf_sprites no-ops. For the headless quad-budget A/B ONLY (meshing runs in a worker, so set this in
 *  the SAME process that calls mesh_chunk, before meshing). Default false = the ship sprite path. @type {boolean} */
let _leaf_cubes = false
/** @param {boolean} on */
export function set_leaf_cubes_debug(on) {
  _leaf_cubes = !!on
}
/** @returns {boolean} */
export function leaf_cubes_debug() {
  return _leaf_cubes
}

/**
 * BENT (spherical) FOLIAGE-NORMAL bucket for one surface leaf cell — the occupancy GRADIENT toward air,
 * quantized to the 27 (=3³) sign-vectors {−1,0,1}³. Each open (non-solid) neighbour pushes the outward
 * normal that way; opposite-open axes cancel; a fully-buried cell is 0 (never emitted anyway). The shader
 * shades the crown as ONE puffy VOLUME off this per-cell normal instead of flat up-lit cards — reference-corpus
 * chunk without extra geometry, baked once here at mesh build (zero runtime cost). Rides the free cross-AO
 * bits 23-27 (`ord | index<<3`); the ordinal keeps 20-22. terrain_material.js MIRRORS the decode:
 * gx = idx%3−1, gy = ⌊idx/3⌋%3−1, gz = ⌊idx/9⌋%3−1. @returns {number} 0..26
 * @param {boolean} px @param {boolean} nx @param {boolean} py @param {boolean} ny @param {boolean} pz @param {boolean} nz
 */
export function leaf_normal_index(px, nx, py, ny, pz, nz) {
  const gx = (px ? 1 : 0) - (nx ? 1 : 0)
  const gy = (py ? 1 : 0) - (ny ? 1 : 0)
  const gz = (pz ? 1 : 0) - (nz ? 1 : 0)
  return gx + 1 + (gy + 1) * 3 + (gz + 1) * 9
}

/**
 * @callback SpriteWrite the caller's staging writer (mesher.js `write`) — encodes one billboard quad.
 * @param {number} x @param {number} y @param {number} z @param {number} w @param {number} h
 * @param {number} face @param {number} block_id @param {number} s0 @param {number} s1 @param {number} s2
 * @param {number} s3 @param {number} ao_packed (the flora ORDINAL for cross faces)
 * @returns {void}
 */

/**
 * Emits the leaf sprite clusters for a chunk. Surface leaf cells sprout `pairs_per` crossed
 * pairs (leaf id → cutout). Capped by
 * MAX_LEAF_SPRITES (shared budget). Scan-ordered so it appends AFTER the caller's solid/liquid/cross passes.
 * @param {import('../chunks/format.js').ChunkRecord} chunk
 * @param {(x: number, y: number, z: number) => boolean} solid whether local (x,y,z) is solid-opaque (halo-aware)
 * @param {SpriteWrite} write the caller's staging writer
 * @param {boolean} render_fins terrain_displacement — ON ⇒ LEAF_SPRITE_PAIRS clusters, OFF ⇒ 1 pair
 */
export function emit_leaf_sprites(chunk, solid, write, render_fins) {
  if (LEAF_SPRITE_IDS.size === 0 || _leaf_cubes) return // A/B: cube mode emits no sprites (mesher keeps cube faces)
  const pairs_per = render_fins ? LEAF_SPRITE_PAIRS : 1
  let n = 0
  for (let y = 0; y < CHUNK_SIZE && n < MAX_LEAF_SPRITES; y += 1) {
    for (let z = 0; z < CHUNK_SIZE && n < MAX_LEAF_SPRITES; z += 1) {
      for (let x = 0; x < CHUNK_SIZE && n < MAX_LEAF_SPRITES; x += 1) {
        const idx = local_index(x, y, z)
        const block_id = chunk.ids[idx]
        if (!LEAF_SPRITE_IDS.has(block_id)) continue
        // Surface leaf = any of the 6 neighbours is NOT solid (an exposed canopy cell). Interior leaves
        // (fully buried in the crown) emit nothing — the sprite would be invisible inside the mass. The
        // SAME 6 open-probes give the cell's OUTWARD canopy direction (leaves are class 'solid', so a
        // non-solid neighbour is real air) → the bent-normal bucket below, for volumetric leaf shading.
        const px = !solid(x + 1, y, z)
        const nx = !solid(x - 1, y, z)
        const py = !solid(x, y + 1, z)
        const ny = !solid(x, y - 1, z)
        const pz = !solid(x, y, z + 1)
        const nz = !solid(x, y, z - 1)
        if (!(px || nx || py || ny || pz || nz)) continue
        const sun = ((chunk.light[idx] >> 4) & 0xf) >> 1
        // Outward-gradient bucket in the free cross-AO bits 23-27 (ordinal keeps 20-22) → the shader
        // shades the crown as one puffy volume instead of flat cards. See leaf_normal_index.
        const nrm = leaf_normal_index(px, nx, py, ny, pz, nz) << 3
        for (let ord = 0; ord < pairs_per && n < MAX_LEAF_SPRITES; ord += 1) {
          write(x, y, z, 1, LEAF_SPRITE_H, FACE_A, block_id, sun, sun, sun, sun, ord | nrm)
          write(x, y, z, 1, LEAF_SPRITE_H, FACE_B, block_id, sun, sun, sun, sun, ord | nrm)
          n += 1
        }
      }
    }
  }
  // [D164-B, 2026-07-05: "remove the snow blocks directly … white on top"] Canopy snow is NO LONGER a
  // deposit SPRITE — the taiga species leaf texture (leaves_conifer) bakes a snow-dusted WHITE TOP instead,
  // and the mesher SUPPRESSES the canopy-snow cube (visual removal; occupancy/collision untouched). So this
  // pass emits leaf clusters only; SNOW_ID stays exported for the mesher's suppression test.
}
