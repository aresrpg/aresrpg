// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPATIALLY-COHERENT per-block atlas VARIANT + ROTATION pick — the fix for grass texture reading too
// repetitive, lacking connected textures to form ground gradients instead of repeating the same block
// everywhere. terrain_material.js's generic per-cell hash (`h_variant`) picks a fresh atlas variant on
// EVERY block — statistically decorrelated, which reads as salt-and-pepper confetti, never "connected
// ground". This module gives a LOW-FREQUENCY world-XZ PATCH hash — the SAME "coarse world-XZ bucket
// hash" technique terrain_leaf.js's CANOPY_VARIETY already uses for per-tree/per-patch hue — so a run of
// neighbouring blocks shares one phase-variant (a patch) that drifts into its neighbours, PLUS an
// independent FINE per-block hash that (a) jitters the patch boundary so it isn't a razor-straight grid
// line and (b) drives a 4-way ROTATION per block so tiles WITHIN one patch still decorrelate (a shared
// variant with zero rotation variety would read as one stamped tile repeated — rotation alone kills half
// that read, same reasoning D159 already applied to dirt/sand/stone's baked `rotations`).
//
// Pure TSL, deliberately independent of terrain_tint.js (a parallel macro-gradient lane owns that file
// concurrently) — `cell_hash` is the shared, already-exported hash primitive (registry_nodes.js) so this
// stays the same PRNG family as the rest of the material (h_variant/h_jitter, CANOPY_VARIETY, YAW_SALT).
// Generic (phase_count/rotation_count are call-site parameters, not hardcoded to grass) so dirt/sand/
// snow can adopt the same mechanism later without duplicating it — only the grass TOP face wires it up
// today (terrain_material.js `is_grass_top` gate); every other block/face is untouched.

import { float, floor } from 'three/tsl'

import { cell_hash } from './registry_nodes.js'

/** World-XZ blocks per PATCH — the "connected ground gradient" scale. Bigger reads as fewer, larger
 *  swards (more "connected", less local variety); smaller reads as busier confetti (closer to the old
 *  per-block hash). 6 gives several tiles of visible connectedness per patch while a 10-15 block close-up
 *  still crosses 1-2 patch boundaries (the proof shot's variety bar). @type {number} */
export const VARIANT_PATCH_SIZE = 6

/** How far (as a FRACTION of one patch cell) the fine per-block hash may nudge a block across a patch
 *  boundary — the razor-straight-edge killer (mirrors op_grass_rim's "a clean rim line reads as the
 *  grid" reasoning, applied to the patch boundary instead of a rim). 0 ⇒ a perfect grid; too high smears
 *  patches into confetti and defeats the "connected" read. @type {number} */
export const PATCH_BORDER_JITTER = 0.22

// Salts distinct from every existing cell_hash call site (terrain_material.js h_variant=1/h_jitter=2,
// terrain_flora.js YAW_SALT=11/TILT_SALT=21/TILT_DIR_SALT=22, terrain_leaf.js CANOPY_VARIETY 31/32/41/42)
// so this mechanism's hashes never accidentally correlate with an unrelated per-block effect.
const SALT_PATCH_JITTER_X = 50
const SALT_PATCH_JITTER_Z = 51
const SALT_PATCH_PHASE = 52
const SALT_ROTATION = 53

/**
 * Coherent atlas-layer OFFSET (0..phase_count*rotation_count−1) for one fragment: a low-freq PATCH pick
 * (phase) that reads as connected ground gradients, plus an independent fine per-block ROTATION pick —
 * combined to match the baker's contiguous phase-major/rotation-minor layout (texture_baker.js
 * `bake_block_textures`: layer = base + phase·rotation_count + rotation).
 * @param {object} p
 * @param {*} p.world_x world-space X node (positionWorld.x) — patch coherence needs the RAW world coord,
 *   never a chunk-local one, so patches stay stable across chunk borders (cf. terrain_tint.js's own
 *   no-chunk-term continuity law)
 * @param {*} p.world_z world-space Z node (positionWorld.z, PRE the (1−v) sample flip — raw world Z)
 * @param {*} p.block_cell_x integer per-block cell X (float node, already floored — e.g. the material's
 *   own `cell.x`) — the FINE hash key (rotation + boundary jitter)
 * @param {*} p.block_cell_z integer per-block cell Z (float node, already floored — e.g. `cell.y`)
 * @param {number} p.phase_count baked phase-variant count for this recipe (grass_vn / grass_rot)
 * @param {number} p.rotation_count baked rotation count for this recipe (grass_rot)
 * @returns {*} float node — the final variant OFFSET to add to the recipe's base layer
 */
export function coherent_variant_offset_node({
  world_x,
  world_z,
  block_cell_x,
  block_cell_z,
  phase_count,
  rotation_count,
}) {
  const patch = float(VARIANT_PATCH_SIZE)
  // Fine per-block nudge (±PATCH_BORDER_JITTER/2 of one patch cell) BEFORE flooring into a patch index —
  // only blocks near a boundary have enough nudge magnitude to cross into the neighbour patch, so patch
  // interiors stay stable while the edge reads ragged instead of a straight grid line.
  const jitter_x = cell_hash(block_cell_x, block_cell_z, SALT_PATCH_JITTER_X)
    .sub(float(0.5))
    .mul(float(PATCH_BORDER_JITTER))
  const jitter_z = cell_hash(block_cell_x, block_cell_z, SALT_PATCH_JITTER_Z)
    .sub(float(0.5))
    .mul(float(PATCH_BORDER_JITTER))
  const patch_x = floor(world_x.div(patch).add(jitter_x))
  const patch_z = floor(world_z.div(patch).add(jitter_z))
  const phase = cell_hash(patch_x, patch_z, SALT_PATCH_PHASE)
    .mul(float(phase_count))
    .floor()
    .min(float(phase_count - 1))
    .max(float(0))
  // Rotation is keyed on the FINE per-block cell (never the patch cell) so it varies tile-to-tile even
  // deep inside one patch — independent of which phase-variant the patch picked.
  const rotation =
    rotation_count > 1
      ? cell_hash(block_cell_x, block_cell_z, SALT_ROTATION)
          .mul(float(rotation_count))
          .floor()
          .min(float(rotation_count - 1))
          .max(float(0))
      : float(0)
  return phase.mul(float(rotation_count)).add(rotation)
}
