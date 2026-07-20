// Chunk → quad buffer (§3.5). Orchestrates binary_greedy.js (face culling + rectangle merge)
// per material class, computes per-corner vertex AO from neighbor occupancy, and encodes the
// result via the frozen quad_buffer.js wire format. Three passes into the SAME buffer:
//   (1) solid/opaque greedy pass — registry `class === 'solid'`, faces 0-5.
//   (2) liquid boundary pass — registry `class === 'liquid'`, all 6 faces, greedy-merged per
//       (face, block_id, light): a liquid voxel emits a face wherever its neighbor in that
//       direction is OPEN — air (id 0) OR foliage (class 'foliage', cross-quad vegetation: kelp,
//       coral, reeds — a thin billboard with no occupancy, so it never covers the cell it sits in) —
//       top (2) at the surface, plus sides (0,1,4,5) and bottom (3) wherever water meets open space.
//       This makes sloped/terraced rivers WATERTIGHT (the terrace-step riser + floor are drawn,
//       killing the "disconnected sheet with dark voids" defect) and keeps vegetated water cells
//       LIDDED (WATER-VEGETATION MESH HOLES fix: a foliage neighbor used to cull like a solid,
//       punching a square hole in the surface at every kelp/coral tuft). Faces against SOLID emit
//       nothing (the solid draws its own face); water|water interfaces emit nothing (internal).
//       Liquids carry no occupancy bit so they never occlude the solids beneath them (sand under
//       water stays fully meshed). The +1 positive-face plane offset for faces 0/2/4 lives GPU-side
//       (terrain_material.js positive_push) exactly as for solids — the mesher writes each face at
//       the water voxel's OWN local coords.
//   (3) cross-shape billboard pass — registry `shape === 'cross'`, faces 6/7: K un-merged, un-culled
//       PAIRS (2 quads each) per foliage cross block (grass tufts, flowers), K = registry `cross_pairs`
//       (default 1). Each pair carries an ORDINAL 0..K-1 in its (otherwise-flat) AO byte so the material
//       can scatter the K stamps into a tangle — the FLORA-CHAOS fix (quad_buffer.js AO-bit overlay).
// Non-cross foliage is a later material pass (see block_registry.js `class`/`shape`).
//
// ALLOCATION DIET (playbook #4). The hot path is object-/string-free: `cull_faces` streams visible
// faces as packed ints through a callback (no per-face object); each is classified into a numeric
// bucket key (solid: block_id | sun_corners<<12 | ao<<24; liquid: block_id | light<<12 | face<<20)
// instead of a `${...}` string; AO + the 4 SMOOTH-LIGHTING corner sun values are computed with the
// SAME precomputed per-face sampling basis (no per-call array algebra); and merged quads are encoded
// DIRECTLY into a growable staging buffer through a callback (no intermediate `encoded_fields` object
// array). The liquid + cross passes share ONE 32³ scan instead of two.
//
// SMOOTH LIGHTING (ENG-10 phase 1): the solid pass now emits FOUR per-corner sun values per quad
// (Minecraft smooth lighting — quad_buffer.js word-B v2), averaged from the light field over the same
// 8-neighborhood the AO sampler walks, and folds them into the merge key so a run merges only across
// cells with IDENTICAL corner light. Uniform-lit terrain (open sky, sun=15 everywhere) merges exactly
// as before (all corners 7 → same key), so mesh growth is confined to light GRADIENTS (canopy dapple,
// cave mouths, AO-shaded slopes) — precisely where the flat-patch artifact lived. Light-field goldens
// re-blessed (visual domain; block ids / positions / faces / AO byte-identical to the previous impl).

import { CHUNK_SIZE } from '../config/world_config.js'
import { get_occupancy_bit, local_index, set_occupancy_bit } from '../chunks/format.js'
import { get_block_by_id } from '../config/block_registry.js'

import { cull_faces, greedy_merge } from './binary_greedy.js'
import { emit_leaf_sprites, leaf_cubes_debug, leaf_normal_index, LEAF_SPRITE_IDS, SNOW_ID } from './leaf_sprites.js'
import { allocate_quad_buffer, grow_quad_buffer } from './quad_buffer.js'

/** @typedef {import('../chunks/format.js').ChunkRecord} ChunkRecord */
/** @typedef {import('./quad_buffer.js').QuadFace} QuadFace */
/** @typedef {import('./quad_buffer.js').CubeFace} CubeFace */

/**
 * @typedef {object} NeighborHalos cross-chunk boundary lookups that let a chunk mesh against its
 *   real neighbors instead of empty air — supplied by the chunk store (store.js `neighbor_halos`)
 *   once neighbor records are resident, and omitted entirely when a chunk is meshed in isolation
 *   (unit tests / any caller that hasn't wired the store yet), in which case every out-of-range
 *   voxel reads as air: geometry stays correct, just with a few extra quads at the chunk seams.
 *
 *   Both probes take LOCAL voxel coords where ≥1 axis lies OUTSIDE 0..31 and resolve them to the
 *   correct neighbor — edges, corners AND diagonals alike. A single world-space probe is required,
 *   not six per-face ones: `face_corner_ao` samples the 8-neighborhood one step past a face, so a
 *   corner face's AO reads a cell out of range on TWO axes at once (a diagonal neighbor chunk); a
 *   lookup keyed only by the face normal would route it to the wrong chunk. (This replaces the
 *   earlier six optional per-face solidity closures, which had no producer and were AO-incorrect.)
 * @property {(x: number, y: number, z: number) => number} [block] block id at the out-of-range
 *   voxel — 0 (air) when the neighbor chunk isn't resident. Drives face culling + AO (solid =
 *   registry class 'solid') and liquid-face detection (emit a face wherever a neighbor is open —
 *   air or foliage, `class === 'foliage'`).
 * @property {(x: number, y: number, z: number) => number} [light] packed light byte (sun<<4|block)
 *   at the out-of-range voxel, so a boundary face reads the neighbor air-cell's light exactly like
 *   an interior face; returns -1 when the neighbor isn't resident so `face_light` falls back to the
 *   owning voxel's own light.
 * @property {(x: number, y: number, z: number) => boolean} [resident] whether the neighbor CHUNK
 *   covering the out-of-range voxel is loaded. Lets the liquid pass tell a genuine world/edge AIR
 *   neighbor (resident, `block`→0) apart from a not-yet-streamed one (`block` also →0 but the chunk
 *   is simply absent). A liquid SIDE/BOTTOM face against a NOT-resident neighbor is a STREAMING SEAM,
 *   not a real water|air edge — emitting one paints a phantom vertical water wall floating mid-ocean
 *   (reported: "chunk hiccup … like an old TV" — two striped panels). So such faces are suppressed:
 *   oceans/rivers are continuous across a seam, and the real neighbor (water OR a solid drawing its
 *   own face) fills the edge the instant it streams in — a sub-frame transient, never a persistent
 *   wall. Absent (isolation / any caller not threading it) ⇒ old behavior: out-of-range reads air.
 */

/**
 * @typedef {object} MeshResult
 * @property {Uint32Array} quad_buffer packed quad instances (§ quad_buffer.js), length = quad_count * 2
 * @property {number} quad_count number of encoded quads
 */

/** Foliage cross billboard faces. */
const CROSS_FACE_A = /** @type {QuadFace} */ (6)
const CROSS_FACE_B = /** @type {QuadFace} */ (7)
/** Max billboard PAIRS a cross cell may emit (FLORA-CHAOS). The per-pair ORDINAL rides the 3-bit low
 *  slice of the freed cross AO byte (word_b bits 20-22), so K is capped at 2³ = 8; every registry
 *  `cross_pairs` sits well under this (grass 3, accents 2). */
const MAX_CROSS_PAIRS = 8

// D164 REFERENCE-STYLE LEAF SPRITE CLUSTERS + snow deposits live in leaf_sprites.js (≤600-LoC split). The
// mesher only needs LEAF_SPRITE_IDS here to SUPPRESS leaf cube faces in the solid pass (leaves keep
// occupancy for collision/culling but render as sprites), then delegates the sprite emission below.
/**
 * The 6 liquid faces the boundary pass may emit, each with the neighbor offset it tests for OPEN.
 * A liquid voxel emits face `f` iff the block one step along `(dx,dy,dz)` is open — air (id 0) or
 * foliage (registry `class === 'foliage'`, no occupancy) — see `liquid_face_opens_to_air`. The face
 * id is written at the water voxel's OWN local coords; the +1 positive-face plane shift for 0/2/4 is
 * applied GPU-side (terrain_material.js), identical to the solid pass. Order is deterministic so the
 * emitted liquid quad stream is stable (goldens re-blessed for the v3 hydrology support fix).
 * @type {{ face: QuadFace, dx: number, dy: number, dz: number }[]}
 */
const LIQUID_FACES = [
  { face: /** @type {QuadFace} */ (2), dx: 0, dy: 1, dz: 0 }, // +y top (the surface — emitted first)
  { face: /** @type {QuadFace} */ (0), dx: 1, dy: 0, dz: 0 }, // +x
  { face: /** @type {QuadFace} */ (1), dx: -1, dy: 0, dz: 0 }, // -x
  { face: /** @type {QuadFace} */ (4), dx: 0, dy: 0, dz: 1 }, // +z
  { face: /** @type {QuadFace} */ (5), dx: 0, dy: 0, dz: -1 }, // -z
  { face: /** @type {QuadFace} */ (3), dx: 0, dy: -1, dz: 0 }, // -y bottom
]
/** Packed AO byte for a flat, fully-open quad ([3,3,3,3] → 0b11111111). Used by liquid + cross. */
const AO_FLAT = 0xff

/**
 * Per-face AO sampling basis, precomputed ONCE at module load so `face_corner_ao_packed` does pure
 * integer arithmetic with zero allocation (the old version rebuilt ~a dozen little arrays per face).
 * For face `f`: axis = f>>1; sign = f even ? +1 : -1; normal = sign·e_axis; the two in-plane unit
 * vectors are u = e_{u_axis}, v = e_{v_axis} with u_axis = axis===0?1:0 and v_axis = axis===2?1:2.
 * @type {{nx:number,ny:number,nz:number,ux:number,uy:number,uz:number,vx:number,vy:number,vz:number}[]}
 */
const FACE_AO_BASIS = (() => {
  const basis = []
  for (let face = 0; face < 6; face += 1) {
    const axis = face >> 1
    const sign = face % 2 === 0 ? 1 : -1
    const normal = [0, 0, 0]
    normal[axis] = sign
    const u_axis = axis === 0 ? 1 : 0
    const v_axis = axis === 2 ? 1 : 2
    const u = [0, 0, 0]
    u[u_axis] = 1
    const v = [0, 0, 0]
    v[v_axis] = 1
    basis.push({
      nx: normal[0],
      ny: normal[1],
      nz: normal[2],
      ux: u[0],
      uy: u[1],
      uz: u[2],
      vx: v[0],
      vy: v[1],
      vz: v[2],
    })
  }
  return basis
})()

/**
 * Reads the block id at local (x,y,z), routing out-of-range coords through the neighbor `block`
 * halo (or treating them as air when no halo is supplied — isolation default).
 * @param {ChunkRecord} chunk
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {NeighborHalos} [halos]
 * @returns {number} block id (0 = air)
 */
function block_id_at(chunk, x, y, z, halos) {
  if (x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || y >= CHUNK_SIZE || z >= CHUNK_SIZE) {
    return halos && halos.block ? halos.block(x, y, z) : 0
  }
  return chunk.ids[local_index(x, y, z)]
}

/**
 * Whether the voxel at local (x,y,z) is solid-opaque (registry class 'solid'), honoring
 * out-of-range coords via the neighbor halo (air when no halo — isolation default).
 * @param {ChunkRecord} chunk
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {NeighborHalos} [halos]
 * @returns {boolean}
 */
function solid_at(chunk, x, y, z, halos) {
  const block_id = block_id_at(chunk, x, y, z, halos)
  return block_id !== 0 && get_block_by_id(block_id)?.class === 'solid'
}

/**
 * FACE-CULLING occlusion probe (D164-B): does the block at (x,y,z) HIDE an adjacent solid face? Opaque
 * solids do; LEAVES do NOT — their cube face is now a sprite cluster, so a trunk/log/ground face behind the
 * lacework must still render or it reads as a HOLE (reported 05:22: "big holes in trunks and canopy interiors").
 * Non-occluding like air/water for CULLING only; `solid_at` (occupancy) is unchanged for collision / BFS
 * light / leaf-EXPOSURE (interior leaves stay hidden). In the A/B cube mode (leaf_cubes_debug) leaves DO
 * render cubes, so they occlude again — the pre-wave baseline.
 * @param {ChunkRecord} chunk @param {number} x @param {number} y @param {number} z @param {NeighborHalos} [halos] @returns {boolean}
 */
function occludes_at(chunk, x, y, z, halos) {
  const block_id = block_id_at(chunk, x, y, z, halos)
  if (block_id === 0) return false
  if (LEAF_SPRITE_IDS.has(block_id) && !leaf_cubes_debug()) return false // lacework leaves don't cull neighbours
  return get_block_by_id(block_id)?.class === 'solid'
}

/**
 * Builds the FACE-CULLING occupancy VIEW (D164-B): the chunk's real occupancy with LEAF bits CLEARED so the
 * greedy cull treats leaves as air for face VISIBILITY — the trunk/log/ground faces INSIDE a crown render
 * instead of being culled by the (now-sprited) leaf cube (reported 05:22: "big holes in trunks and canopy
 * interiors"). cull_faces is the ONLY mesher consumer of chunk.occupancy (AO + leaf-exposure use the block-id
 * `solid_at`), so this throwaway clone leaves the real occupancy — read by collision + BFS light OUTSIDE the
 * mesher — untouched. Returns the chunk AS-IS when it has no leaves (⇒ zero alloc, the common case) or in the
 * cube A/B mode (leaves render as cubes ⇒ they occlude, the pre-wave baseline). @param {ChunkRecord} chunk @returns {ChunkRecord} */
function build_cull_chunk(chunk) {
  if (LEAF_SPRITE_IDS.size === 0 || leaf_cubes_debug()) return chunk
  let any = false
  for (let i = 0; i < chunk.ids.length; i += 1)
    if (LEAF_SPRITE_IDS.has(chunk.ids[i])) {
      any = true
      break
    }
  if (!any) return chunk
  const cull = /** @type {ChunkRecord} */ ({
    ...chunk,
    occupancy: [chunk.occupancy[0].slice(), chunk.occupancy[1].slice(), chunk.occupancy[2].slice()],
  })
  for (let y = 0; y < CHUNK_SIZE; y += 1)
    for (let z = 0; z < CHUNK_SIZE; z += 1)
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        if (!LEAF_SPRITE_IDS.has(chunk.ids[local_index(x, y, z)])) continue
        set_occupancy_bit(cull, 0, y * CHUNK_SIZE + z, x, false)
        set_occupancy_bit(cull, 1, x * CHUNK_SIZE + z, y, false)
        set_occupancy_bit(cull, 2, x * CHUNK_SIZE + y, z, false)
      }
  return cull
}

/**
 * Computes 0-3 ambient occlusion for one quad corner using the classic 3-neighbor rule
 * (two edge-adjacent cells + the diagonal): `ao = (side1 && side2) ? 0 : 3 - (side1+side2+corner)`.
 * @param {boolean} side1
 * @param {boolean} side2
 * @param {boolean} corner
 * @returns {number} 0 (fully occluded) .. 3 (fully open)
 */
function corner_ao(side1, side2, corner) {
  if (side1 && side2) return 0
  return 3 - (Number(side1) + Number(side2) + Number(corner))
}

/**
 * Computes the 4 corner AO values for one unit face at local (x,y,z) facing `face`, PACKED into a
 * byte `ao0 | ao1<<2 | ao2<<4 | ao3<<6` (each 0..3). Corner order matches the quad's (u,v) winding:
 * [(0,0),(1,0),(0,1),(1,1)] — terrain_material.js must expand vertices in the same order. Uses the
 * precomputed `FACE_AO_BASIS`, sampling the 8-neighborhood one step out along the face normal with
 * no allocation.
 * @param {ChunkRecord} chunk
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {CubeFace} face
 * @param {NeighborHalos} [halos]
 * @returns {number} packed AO byte
 */
function face_corner_ao_packed(chunk, x, y, z, face, halos) {
  const b = FACE_AO_BASIS[face]
  const bx = x + b.nx
  const by = y + b.ny
  const bz = z + b.nz
  const side_nu = solid_at(chunk, bx - b.ux, by - b.uy, bz - b.uz, halos)
  const side_pu = solid_at(chunk, bx + b.ux, by + b.uy, bz + b.uz, halos)
  const side_nv = solid_at(chunk, bx - b.vx, by - b.vy, bz - b.vz, halos)
  const side_pv = solid_at(chunk, bx + b.vx, by + b.vy, bz + b.vz, halos)
  const corner_nu_nv = solid_at(chunk, bx - b.ux - b.vx, by - b.uy - b.vy, bz - b.uz - b.vz, halos)
  const corner_pu_nv = solid_at(chunk, bx + b.ux - b.vx, by + b.uy - b.vy, bz + b.uz - b.vz, halos)
  const corner_nu_pv = solid_at(chunk, bx - b.ux + b.vx, by - b.uy + b.vy, bz - b.uz + b.vz, halos)
  const corner_pu_pv = solid_at(chunk, bx + b.ux + b.vx, by + b.uy + b.vy, bz + b.uz + b.vz, halos)
  const ao0 = corner_ao(side_nu, side_nv, corner_nu_nv)
  const ao1 = corner_ao(side_pu, side_nv, corner_pu_nv)
  const ao2 = corner_ao(side_nu, side_pv, corner_nu_pv)
  const ao3 = corner_ao(side_pu, side_pv, corner_pu_pv)
  return ao0 | (ao1 << 2) | (ao2 << 4) | (ao3 << 6)
}

/**
 * Sun nibble (0-15) of the light field at local (x,y,z), routing out-of-range coords through the
 * neighbor `light` halo. Falls back to `fallback` when out-of-range and the neighbor isn't resident,
 * so boundary corners degrade to the front-cell value (a flat seam) rather than to black.
 * @param {ChunkRecord} chunk @param {number} x @param {number} y @param {number} z
 * @param {NeighborHalos|undefined} halos @param {number} fallback sun nibble to use when unresolved
 * @returns {number} sun nibble 0-15
 */
function sun_at(chunk, x, y, z, halos, fallback) {
  if (x < 0 || y < 0 || z < 0 || x >= CHUNK_SIZE || y >= CHUNK_SIZE || z >= CHUNK_SIZE) {
    const neighbor_light = halos && halos.light ? halos.light(x, y, z) : -1
    return neighbor_light >= 0 ? (neighbor_light >> 4) & 0xf : fallback
  }
  return (chunk.light[local_index(x, y, z)] >> 4) & 0xf
}

/**
 * Four per-corner SMOOTH sun values (0-7 each) for one unit face at (x,y,z) — the Minecraft "smooth
 * lighting" corner average. Each corner is the mean of the 4 light cells touching it in the AIR plane
 * one step out along the face normal (base cell `b`), reusing the SAME precomputed `FACE_AO_BASIS`
 * 8-neighborhood the AO sampler walks but reading `chunk.light`'s sun nibble instead of solidity.
 * Corner order matches `face_corner_ao_packed`: [(0,0),(1,0),(0,1),(1,1)] — so the GPU can select the
 * sun and AO for a vertex with the same `corner` index. Averaging 4 nibbles (0-60) then `>>3` quantizes
 * to 0-7 (open sky 15→7 → shader 7/7 = 1.0, brightness-identical to the old flat sun=15). Opaque cells
 * read sun 0 (the BFS never lights them), so a corner beside a wall darkens — the light half of the
 * contact shade the AO gives geometrically. The front cell `b`'s value is every neighbor sample's
 * fallback, so an isolation-boundary face reads flat (== the old single face-light) instead of dark.
 * @param {ChunkRecord} chunk @param {number} x @param {number} y @param {number} z
 * @param {CubeFace} face @param {NeighborHalos} [halos]
 * @returns {[number, number, number, number]} four corner sun values, 0-7
 */
function face_corner_sun(chunk, x, y, z, face, halos) {
  const b = FACE_AO_BASIS[face]
  const bx = x + b.nx
  const by = y + b.ny
  const bz = z + b.nz
  const owner_sun = (chunk.light[local_index(x, y, z)] >> 4) & 0xf
  const s_b = sun_at(chunk, bx, by, bz, halos, owner_sun)
  const s_nu = sun_at(chunk, bx - b.ux, by - b.uy, bz - b.uz, halos, s_b)
  const s_pu = sun_at(chunk, bx + b.ux, by + b.uy, bz + b.uz, halos, s_b)
  const s_nv = sun_at(chunk, bx - b.vx, by - b.vy, bz - b.vz, halos, s_b)
  const s_pv = sun_at(chunk, bx + b.vx, by + b.vy, bz + b.vz, halos, s_b)
  const s_nunv = sun_at(chunk, bx - b.ux - b.vx, by - b.uy - b.vy, bz - b.uz - b.vz, halos, s_b)
  const s_punv = sun_at(chunk, bx + b.ux - b.vx, by + b.uy - b.vy, bz + b.uz - b.vz, halos, s_b)
  const s_nupv = sun_at(chunk, bx - b.ux + b.vx, by - b.uy + b.vy, bz - b.uz + b.vz, halos, s_b)
  const s_pupv = sun_at(chunk, bx + b.ux + b.vx, by + b.uy + b.vy, bz + b.uz + b.vz, halos, s_b)
  return [
    (s_b + s_nu + s_nv + s_nunv) >> 3,
    (s_b + s_pu + s_nv + s_punv) >> 3,
    (s_b + s_nu + s_pv + s_nupv) >> 3,
    (s_b + s_pu + s_pv + s_pupv) >> 3,
  ]
}

/** Liquid top face id (+y surface) — always emitted against air; never suppressed at a seam (a
 *  suppressed top would punch a hole in the ocean surface). Sides/bottom (0/1/4/5/3) are the seam-
 *  sensitive walls. */
const LIQUID_TOP_FACE = 2

/**
 * Whether a liquid voxel should emit face `lf` — i.e. its neighbor in that direction is OPEN (air
 * or foliage) rather than something that covers the boundary. True iff the neighbor does NOT cull —
 * opaque solids (their own face draws instead) and same-fluid water (internal boundary) cull; real
 * air (id 0) AND FOLIAGE (cross-quad vegetation — kelp/coral/reeds, registry `class === 'foliage'`,
 * no occupancy bit) do NOT — a foliage cell is a thin billboard that never covers its cell, so the
 * water's face against it must still render (the standard voxel rule: only same-fluid or opaque-
 * solid neighbors cull). WATER-VEGETATION MESH HOLES fix: before this, ANY non-air neighbor id culled
 * the face — including foliage — so every water cell touching kelp/coral lost its face (top cap when
 * vegetation sat at the water's own top layer, side walls when it sat beside/within the body),
 * punching a square hole in the surface exactly where underwater vegetation grows.
 * — AND it is NOT a streaming-seam phantom: a SIDE/BOTTOM face whose neighbor lies in a NOT-yet-
 * resident chunk is treated as water (return false), because oceans/rivers are continuous across a
 * seam and a wall drawn into an unknown neighbor is the "old-TV" phantom panel that was reported.
 * The TOP face is never suppressed (the surface against the sky is always real). Isolation (no
 * `resident` probe) keeps the old air behavior. A foliage neighbor can never be a streaming phantom —
 * the halo's "unknown neighbor" placeholder is always air (id 0), so a non-zero foliage read is
 * always genuine resident data and skips the seam guard outright.
 * @param {ChunkRecord} chunk
 * @param {number} x @param {number} y @param {number} z
 * @param {{ face: QuadFace, dx: number, dy: number, dz: number }} lf
 * @param {NeighborHalos} [halos]
 * @returns {boolean}
 */
function liquid_face_opens_to_air(chunk, x, y, z, lf, halos) {
  const nx = x + lf.dx
  const ny = y + lf.dy
  const nz = z + lf.dz
  const neighbor_id = block_id_at(chunk, nx, ny, nz, halos)
  if (neighbor_id !== 0) {
    if (get_block_by_id(neighbor_id)?.class !== 'foliage') return false // solid or water neighbor → no face
    return true // foliage neighbor is open, and (being non-zero) is never an unresolved streaming phantom
  }
  // Neighbor reads air. Guard the streaming-seam phantom: a side/bottom face into an out-of-range,
  // not-yet-resident neighbor is a seam, not a real water|air edge → suppress (treat as water).
  const out_of_range = nx < 0 || ny < 0 || nz < 0 || nx >= CHUNK_SIZE || ny >= CHUNK_SIZE || nz >= CHUNK_SIZE
  if (lf.face !== LIQUID_TOP_FACE && out_of_range && halos && halos.resident && !halos.resident(nx, ny, nz)) {
    return false
  }
  return true
}

/**
 * Reads the packed light byte at a local voxel, treated as air-adjacent light for a face:
 * we sample the light value of the AIR cell the face opens into (the voxel just outside the
 * solid owner along the face normal) so surfaces read the light of the space they illuminate
 * into, matching Minecraft's convention.
 * @param {ChunkRecord} chunk
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {QuadFace} face
 * @param {NeighborHalos} [halos]
 * @returns {number} packed light byte (sun<<4 | block)
 */
function face_light(chunk, x, y, z, face, halos) {
  const axis = Math.floor(face / 2)
  const sign = face % 2 === 0 ? 1 : -1
  const nx = x + (axis === 0 ? sign : 0)
  const ny = y + (axis === 1 ? sign : 0)
  const nz = z + (axis === 2 ? sign : 0)
  if (nx < 0 || ny < 0 || nz < 0 || nx >= CHUNK_SIZE || ny >= CHUNK_SIZE || nz >= CHUNK_SIZE) {
    // The face opens into a neighbor chunk — read that air-cell's light so seam faces match the
    // interior; fall back to the owning voxel's own light when no halo / neighbor not resident.
    const neighbor_light = halos && halos.light ? halos.light(nx, ny, nz) : -1
    return neighbor_light >= 0 ? neighbor_light : chunk.light[local_index(x, y, z)]
  }
  return chunk.light[local_index(nx, ny, nz)]
}

/**
 * Meshes one chunk into a packed quad buffer: a binary-greedy pass over solid-class blocks
 * (registry `class === 'solid'`, faces 0-5), a liquid surface pass (top faces of liquid voxels
 * whose cell above is air, greedy-merged), and a cross-shape pass that emits K crossed billboard
 * PAIRS (faces 6/7, K = registry `cross_pairs`) for every `shape === 'cross'` block. Cross blocks are non-solid and carry no
 * occupancy bit, so the greedy/cull pass never sees them and `solid_at` treats them as air — they
 * never suppress a neighbor face or contribute AO. Non-cross foliage is a later material pass.
 *
 * @param {ChunkRecord} chunk
 * @param {NeighborHalos} [neighbor_halos] optional cross-chunk boundary lookups (see the
 *   `NeighborHalos` typedef) — with them, seam faces between two equally-solid neighbor columns
 *   are culled and boundary AO/light match the interior; omitted safely (isolation → air outside).
 * @param {boolean} [render_fins] D164: emit sparse capped BUSHY LEAF FINS on surface leaf cells
 *   (faces 6/7, leaf id → cutout class) to break the cube canopy silhouette. Default false (the mesh
 *   topology stays tier-independent for the pool; the demo/loader passes the tier's `terrain_displacement`
 *   flag). Off ⇒ byte-identical to the pre-D164 fin-free mesh.
 * @returns {MeshResult}
 */
export function mesh_chunk(chunk, neighbor_halos, render_fins = false) {
  // Growable staging buffer written directly by the passes below (no per-quad object). Trimmed to an
  // exactly-sized fresh buffer on return (matches the previous `allocate_quad_buffer(count)` shape,
  // so `quad_buffer.length === quad_count*2` and downstream storage nodes see a tight buffer).
  let staging = allocate_quad_buffer(1024)
  let count = 0

  /**
   * Encodes one quad DIRECTLY into staging (mirrors quad_buffer.js `encode_quad` bit-for-bit), from
   * the packed AO byte + the 4 per-corner sun values (SMOOTH LIGHTING), growing the buffer when needed.
   * sun3 straddles the AO block (low 2 bits at 18-19, high bit at 31) — see quad_buffer.js word-B v2.
   * @param {number} x @param {number} y @param {number} z @param {number} w @param {number} h
   * @param {number} face @param {number} block_id
   * @param {number} s0 @param {number} s1 @param {number} s2 @param {number} s3 corner sun 0-7 each
   * @param {number} ao_packed 4×2-bit corner AO (ao0 | ao1<<2 | ao2<<4 | ao3<<6)
   */
  const write = (x, y, z, w, h, face, block_id, s0, s1, s2, s3, ao_packed) => {
    if ((count + 1) * 2 > staging.length) staging = grow_quad_buffer(staging, count + 1)
    const off = count * 2
    staging[off] =
      ((x & 0x3f) |
        ((y & 0x3f) << 6) |
        ((z & 0x3f) << 12) |
        (((w - 1) & 0x1f) << 18) |
        (((h - 1) & 0x1f) << 23) |
        ((face & 0x7) << 28)) >>>
      0
    staging[off + 1] =
      ((block_id & 0xfff) |
        ((s0 & 0x7) << 12) |
        ((s1 & 0x7) << 15) |
        ((s3 & 0x3) << 18) |
        ((ao_packed & 0x3) << 20) |
        (((ao_packed >> 2) & 0x3) << 22) |
        (((ao_packed >> 4) & 0x3) << 24) |
        (((ao_packed >> 6) & 0x3) << 26) |
        ((s2 & 0x7) << 28) |
        (((s3 >> 2) & 0x1) << 31)) >>>
      0
    count += 1
  }

  // One face-agnostic occlusion probe covers all six directions (see the NeighborHalos typedef). D164-B:
  // uses occludes_at (NOT solid_at) so lacework LEAVES don't cull the trunk/ground faces behind them.
  const neighbor_solid = neighbor_halos
    ? /** @type {(x: number, y: number, z: number) => boolean} */ (
        (x, y, z) => occludes_at(chunk, x, y, z, neighbor_halos)
      )
    : undefined

  // [D164-B] leaf-free occupancy for the cull walk (interior trunk/ground faces behind lacework render);
  // real occupancy untouched for collision/BFS. neighbor_solid (occludes_at) covers cross-chunk leaf halos.
  const cull_chunk = build_cull_chunk(chunk)

  /**
   * ONE greedy cube-face pass (faces 0-5) over `cull_src`'s occupancy: cull_faces streams visible faces →
   * bucket by (block_id, per-corner sun, AO) via a NUMERIC key → greedy_merge → encode straight to staging.
   * `accept(block_id, x, y, z)` filters which culled faces emit — the seam that lets the SOLID pass drop
   * leaves (they render as sprites + the Rung-2 dual-emit cube shell) while the LEAF pass keeps only them.
   * AO/sun always sample the REAL `chunk` + full `neighbor_halos` (the occupancy view only changes which
   * faces are VISIBLE, never their shading). Composite key block_id(12b)|sun_corners(12b)|ao(8b) is built
   * with arithmetic (not `|`, which is 32-bit-signed and would corrupt the top AO bit); Map keys are exact
   * to 2^53 and first-insertion order keeps bucket iteration deterministic (goldens stay stable).
   * @param {ChunkRecord} cull_src occupancy view for the cull walk (leaf-cleared for solids, real for leaves)
   * @param {((x: number, y: number, z: number) => boolean) | undefined} neighbor_fn boundary occlusion halo
   * @param {(block_id: number, x: number, y: number, z: number) => boolean} accept per-face emit filter
   * @param {(x: number, y: number, z: number) => number} [ao_byte_of] optional per-CELL override of the
   *   quad's AO byte (the canopy pass repurposes it for the LEAF-VOLUME bent-normal bucket — see below);
   *   omitted ⇒ the real per-corner face AO. Joins the merge key either way, so a merged quad is always
   *   homogeneous in whatever the byte carries.
   */
  const run_cube_pass = (cull_src, neighbor_fn, accept, ao_byte_of) => {
    for (let face = /** @type {CubeFace} */ (0); face < 6; face += 1) {
      const axis = /** @type {0|1|2} */ (Math.floor(face / 2))
      const positive_direction = face % 2 === 0

      /** @type {Map<number, number[]>} */
      const buckets = new Map()
      /** @type {Map<number, {block_id: number, ao_packed: number, sun_packed: number}>} */
      const bucket_meta = new Map()

      cull_faces(cull_src, axis, positive_direction, neighbor_fn, (packed) => {
        const x = packed & 0x3f
        const y = (packed >> 6) & 0x3f
        const z = (packed >> 12) & 0x3f
        const block_id = chunk.ids[local_index(x, y, z)]
        if (!accept(block_id, x, y, z)) return
        const ao_packed = ao_byte_of
          ? ao_byte_of(x, y, z)
          : face_corner_ao_packed(chunk, x, y, z, /** @type {CubeFace} */ (face), neighbor_halos)
        // SMOOTH LIGHTING (ENG-10 phase 1): four per-corner sun values (0-7) go in the merge key so a
        // greedy run merges ONLY across cells with IDENTICAL corner light; uniform-lit terrain (every
        // corner 7) shares one key → merges as the old single-`sun` classing did (growth confined to
        // light gradients — canopy dapple, cave mouths, AO-shaded slopes). Packed s0|s1<<3|s2<<6|s3<<9.
        const [c0, c1, c2, c3] = face_corner_sun(chunk, x, y, z, /** @type {CubeFace} */ (face), neighbor_halos)
        const sun_packed = c0 | (c1 << 3) | (c2 << 6) | (c3 << 9)
        const key = block_id + sun_packed * 0x1000 + ao_packed * 0x1000000
        let bucket = buckets.get(key)
        if (!bucket) {
          bucket = []
          buckets.set(key, bucket)
          bucket_meta.set(key, { block_id, ao_packed, sun_packed })
        }
        bucket.push(packed)
      })

      for (const [key, bucket] of buckets) {
        const meta = /** @type {{block_id: number, ao_packed: number, sun_packed: number}} */ (bucket_meta.get(key))
        const sp = meta.sun_packed
        greedy_merge(bucket, /** @type {QuadFace} */ (face), (ox, oy, oz, w, h) =>
          write(
            ox,
            oy,
            oz,
            w,
            h,
            face,
            meta.block_id,
            sp & 0x7,
            (sp >> 3) & 0x7,
            (sp >> 6) & 0x7,
            (sp >> 9) & 0x7,
            meta.ao_packed
          )
        )
      }
    }
  }

  // ── SOLID pass: opaque terrain + tree trunks/ground. D164 LEAF cube faces are SUPPRESSED here (they keep
  // occupancy for collision/culling but render as SPRITE clusters below + the Rung-2 dual-emit cube shell);
  // a canopy-SNOW cube resting on a leaf is suppressed too (the taiga leaf texture bakes the white top —
  // "remove the snow blocks directly, white on top"). The leaf_cubes_debug A/B keeps BOTH = the pre-wave
  // opaque cube baseline. The cull walks the leaf-CLEARED occupancy so trunk/ground faces behind the lacework
  // still render (reported 05:22 "big holes in trunks and canopy interiors").
  run_cube_pass(cull_chunk, neighbor_solid, (block_id, x, y, z) => {
    if (leaf_cubes_debug()) return true // A/B cube baseline — leaves + canopy snow keep their cubes
    if (LEAF_SPRITE_IDS.has(block_id)) return false // ship: leaf cubes come from the dual-emit pass below
    if (block_id === SNOW_ID && y > 0 && LEAF_SPRITE_IDS.has(chunk.ids[local_index(x, y - 1, z)])) return false // canopy snow
    return true
  })

  // ── [LEAVES-2X Rung 2] DUAL-EMIT leaf CUBE shell — the opaque far-canopy representation (faces 0-5, leaf
  // ids), emitted ALONGSIDE the D164 sprites. Culled over the REAL occupancy (leaves + solids both occlude)
  // so it is exactly the cube-mode SHELL (~3675 q/forest-chunk, not the hollow interior); partition_quads
  // routes it to the discard-free 'canopy' pool (leaf id + face<6) for early-Z, and the canopy vertex stage
  // collapses it to a degenerate quad when NEAR (< band) so the near canopy stays the airy sprites. Skipped
  // in the cube A/B (the solid pass already emitted the cubes there) and when the world has no leaf blocks.
  //
  // [LEAF-SEAM fix] The canopy quads REPURPOSE the AO byte exactly like their sprites do: bits 20-22 = 0
  // (the sprites' plane ordinal — cubes have none), bits 23-27 = the SAME per-cell LEAF-VOLUME bent-normal
  // bucket the sprite pass bakes (leaf_normal_index over the 6 halo-aware open-probes), so the material
  // shades the far cube shell as the SAME puffy volume as the near sprites. Root cause this cures: canopy
  // cube up-normals caught full HemisphereLight sky irradiance the sprites escape via bent normals — the
  // pixel-proven near/far tone seam at the band. Real face AO is DROPPED for canopy (no free bits; the
  // material forces AO=3 there, matching the AO-less sprites the cube impersonates). The bucket rides the
  // merge key (via the ao byte), so merged quads stay bucket-homogeneous — merge granularity now follows
  // the crown's outward gradient instead of AO, which is why the cube-mode baseline is no longer quad-
  // count-identical (coverage still is — mesher.test.js pins both).
  if (!leaf_cubes_debug() && LEAF_SPRITE_IDS.size > 0) {
    const leaf_neighbor = neighbor_halos
      ? /** @type {(x: number, y: number, z: number) => boolean} */ (
          (x, y, z) => solid_at(chunk, x, y, z, neighbor_halos)
        )
      : undefined
    /** Same open-probe the sprite pass uses (leaves are class 'solid', so open = real air/cross/liquid). */
    const open = /** @type {(x: number, y: number, z: number) => boolean} */ (
      (x, y, z) => !solid_at(chunk, x, y, z, neighbor_halos)
    )
    run_cube_pass(
      chunk,
      leaf_neighbor,
      (block_id) => LEAF_SPRITE_IDS.has(block_id),
      (x, y, z) =>
        leaf_normal_index(
          open(x + 1, y, z),
          open(x - 1, y, z),
          open(x, y + 1, z),
          open(x, y - 1, z),
          open(x, y, z + 1),
          open(x, y, z - 1)
        ) << 3
    )
  }

  // ── Liquid + cross share ONE 32³ scan (they never coexist on a voxel). A liquid voxel emits a face
  // in every direction whose neighbor is OPEN — air (id 0) or foliage (class 'foliage', no occupancy):
  // buckets keyed by (face, block_id, light) so each face greedy-merges on its own plane. Cross
  // positions are collected in scan order and emitted AFTER all liquid, so emission order stays:
  // solids → liquid → cross (crosses byte-identical; the liquid stream now carries sides/bottom too —
  // goldens re-blessed for the v3 hydrology support fix).
  /** @type {Map<number, number[]>} keyed by block_id | light<<12 | face<<20 */
  const liquid_buckets = new Map()
  /** @type {Map<number, {block_id: number, light: number, face: QuadFace}>} */
  const liquid_meta = new Map()
  /** @type {number[]} packed cross-block positions, in scan order */
  const cross_positions = []

  for (let y = 0; y < CHUNK_SIZE; y += 1) {
    for (let z = 0; z < CHUNK_SIZE; z += 1) {
      for (let x = 0; x < CHUNK_SIZE; x += 1) {
        const block_id = chunk.ids[local_index(x, y, z)]
        if (block_id === 0) continue
        const def = get_block_by_id(block_id)
        if (!def) continue
        if (def.class === 'liquid') {
          // Emit a face wherever the neighbor is OPEN (air or foliage): top at the surface, sides/
          // bottom where water meets open space (watertight terraced rivers; lidded vegetated cells).
          // Against solid/water → nothing. Side/bottom faces into a not-yet-streamed neighbor are
          // suppressed (seam phantom) — see the helper.
          for (let i = 0; i < LIQUID_FACES.length; i += 1) {
            const lf = LIQUID_FACES[i]
            if (!liquid_face_opens_to_air(chunk, x, y, z, lf, neighbor_halos)) continue
            const light = face_light(chunk, x, y, z, lf.face, neighbor_halos)
            const key = block_id | (light << 12) | (lf.face << 20)
            let bucket = liquid_buckets.get(key)
            if (!bucket) {
              bucket = []
              liquid_buckets.set(key, bucket)
              liquid_meta.set(key, { block_id, light, face: lf.face })
            }
            bucket.push(x | (y << 6) | (z << 12))
          }
        } else if (def.shape === 'cross') {
          cross_positions.push(x | (y << 6) | (z << 12))
        }
      }
    }
  }

  // Liquid faces (flat AO), greedy-merged per (face, block_id, light) bucket. Water is FLAT-lit — one
  // face_light per quad — so all 4 SMOOTH-LIGHTING corners carry the same sun (0-7 = sun-nibble>>1);
  // no per-corner gradient (a water surface has no AO/normal variation to dapple). block_light dropped.
  for (const [key, bucket] of liquid_buckets) {
    const meta = /** @type {{block_id: number, light: number, face: QuadFace}} */ (liquid_meta.get(key))
    const sun = ((meta.light >> 4) & 0xf) >> 1
    greedy_merge(bucket, meta.face, (ox, oy, oz, w, h) =>
      write(ox, oy, oz, w, h, meta.face, meta.block_id, sun, sun, sun, sun, AO_FLAT)
    )
  }

  // Cross billboards (FLORA-CHAOS): K INDEPENDENT crossed PAIRS per cross block — K = registry
  // `cross_pairs` (default 1, clamped ≤ MAX_CROSS_PAIRS). Each pair is two un-culled/un-merged quads
  // (faces 6/7) tagged with an ORDINAL 0..K-1 that RIDES THE AO BYTE: crosses carry no real AO, so the
  // write() packing lands ordinal∈0..7 in word_b bits 20-22 (see quad_buffer.js), where the material
  // reads it and hashes (cell, ordinal) into a per-plane yaw / XZ jitter / scale / base-height / wind-
  // phase / variant — K stamps become a scattered tangle instead of one repeated X. Wire height =
  // ceil(registry `cross_height`) (default 1) — the integer sprite/sway ENVELOPE; the flora vertex scales
  // the true fraction. A chest-high tall_grass (2.2→ceil 3) / marsh reed (3) stretches that many blocks up
  // the cross v-axis; width 1; h ≤ 3 ≪ the 5-bit wire field. Sun = the cell's OWN nibble,
  // flat across corners (no dapple on a sprite). Scan-order (solids → liquid → cross) is preserved.
  for (let i = 0; i < cross_positions.length; i += 1) {
    const packed = cross_positions[i]
    const x = packed & 0x3f
    const y = (packed >> 6) & 0x3f
    const z = (packed >> 12) & 0x3f
    const idx = local_index(x, y, z)
    const block_id = chunk.ids[idx]
    const def = get_block_by_id(block_id)
    // cross_height MAY be fractional (registry) — the wire quad_h is a 5-bit INT, so write the ceil
    // ENVELOPE here (sprite-UV bound); the flora vertex scales the true fraction (height_frac). Integer
    // heights (reeds=3, flowers=1) ceil to themselves ⇒ byte-identical wire.
    const height = Math.ceil(def?.cross_height ?? 1)
    // [D182 owner ×5: "the grass is too dense…"] RENDER-SIDE THINNING: ~30% of grass-carpet cells emit
    // nothing (deterministic world-cell hash — no gen change, no world fork; accents/flowers exempt so
    // meadows keep their punctuation). Composes with pairs (below) for ~half the old carpet planes.
    const wx = chunk.cx * CHUNK_SIZE + x
    const wz = chunk.cz * CHUNK_SIZE + z
    if (def?.name === 'grass_tuft') {
      const h01 = (((Math.imul(wx, 374761393) + Math.imul(wz, 668265263)) ^ 0x5bf03635) >>> 0) / 4294967296
      if (h01 < 0.3) continue
    }
    const pairs = Math.min(MAX_CROSS_PAIRS, Math.max(1, def?.cross_pairs ?? 1))
    const sun = ((chunk.light[idx] >> 4) & 0xf) >> 1
    for (let ord = 0; ord < pairs; ord += 1) {
      // ordinal (0..K-1) rides the AO byte's low 3 bits (→ word_b 20-22); the material reads it back
      // there and derives every per-plane variation by hash(cell, ordinal). AO is inert on crosses.
      write(x, y, z, 1, height, CROSS_FACE_A, block_id, sun, sun, sun, sun, ord)
      write(x, y, z, 1, height, CROSS_FACE_B, block_id, sun, sun, sun, sun, ord)
    }
  }

  // D164 LEAF SPRITE CLUSTERS + SNOW-ON-LEAF DEPOSITS (addendum 3) - leaf_sprites.js. Surface leaf
  // cells emit yaw-scattered billboard clusters (leaf id -> cutout, wind, backlight); interior leaves emit
  // nothing (hollow shell = budget saver); a snow cube on a leaf emits a soft white deposit. Emitted LAST so
  // scan order stays solids -> liquid -> cross -> leaf/snow sprites. The `solid` probe is halo-aware
  // (isolation => out-of-range reads air), so an edge leaf's exposure matches the interior as neighbours stream.
  emit_leaf_sprites(chunk, (x, y, z) => solid_at(chunk, x, y, z, neighbor_halos), write, render_fins)

  // Trim to an exactly-sized fresh buffer (matches the old return shape; slice copies out the live
  // words so a downstream transfer/storage node never sees the over-allocated tail).
  return { quad_buffer: staging.slice(0, count * 2), quad_count: count }
}

// Re-exported so callers/tests that only need occupancy-bit plumbing don't have to reach into
// chunks/format.js directly for this one helper.
export { get_occupancy_bit }
