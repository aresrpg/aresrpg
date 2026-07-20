// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ============================================================================================
// D141 — CAVE ROOM SCENE WRAPPER. 2026-07-04.
// ============================================================================================
//
// The one dapp-facing surface for the cave-room generator: create_cave_room({ config, seed }) →
// { mount(engine): Promise, board_anchor, mob_spawn, bounds, teardown }. It is the thin bridge
// between the PURE generator (gen/cave_room.js — no engine/three) and the live engine:
//
//   • generate the room's ChunkRecords deterministically (gen/cave_room.js);
//   • mount(): mesh each chunk against its resident neighbours (cross-chunk seam culling via a
//     private chunk store's neighbor_halos — no interior wall quads between the room's own chunks),
//     upload the geometry into the SAME terrain_renderer seam load_synthetic_chunks uses, and feed
//     the room's records to the froxel god-ray pass via atmo.set_resident_provider (the ceiling holes
//     → cathedral shafts read straight off this sun-occupancy volume — see the froxel study);
//   • place a PLACEHOLDER mob mesh at mob_spawn (the dapp drives real mobs — this is a stand-in so the
//     combat-scene screenshot has an occupant);
//   • expose board_anchor (the flat central floor corner the sealed board contract mounts at),
//     mob_spawn, bounds (the controller's soft-clamp extents), and the room's own sample_block (the
//     character controller's collision oracle for this room — wired instead of engine.sample_block,
//     which sees the ring's world, not this standalone room);
//   • teardown(): remove every uploaded chunk + the mob, and detach the resident provider.
//
// WHY STANDALONE (not the ring): see gen/cave_room.js header — the ring owns outdoor streaming with
// no public block-write seam; a standalone set lets the board + controller + lighting + god rays all
// work UNCHANGED because each already consumes a records/oracle input we simply point at the room.

import { mesh_chunk } from '../mesh/mesher.js'
import { create_chunk_store } from '../chunks/store.js'
import { generate_cave_room } from '../gen/cave_room.js'

/** @typedef {import('../engine.js').EngineApi} EngineApi */
/** @typedef {import('../gen/cave_room.js').CaveRoomConfig} CaveRoomConfig */
/** @typedef {import('../gen/cave_room.js').CaveRoom} CaveRoom */

/**
 * @typedef {object} CaveRoomHandle
 * @property {(engine: EngineApi) => Promise<void>} mount builds the room into the engine (async: waits
 *   for the renderer to boot, then meshes + uploads + wires the god-ray provider + places the mob).
 * @property {[number, number, number]} board_anchor world min-corner of cell (0,0) for a MAX board
 *   centred on the flat floor region (board.js origin contract; y = floor top).
 * @property {[number, number, number]} mob_spawn centred, combat-accessible mob feet position (world).
 * @property {[number, number, number]} player_spawn a clear floor stand inside the room (world, feet).
 * @property {{ min_x: number, min_z: number, max_x: number, max_z: number, floor_y: number, ceiling_y: number }} bounds
 *   invisible-barrier extents the controller soft-clamps against (interior walkable box).
 * @property {(wx: number, wy: number, wz: number) => number} sample_block the room's collision oracle —
 *   world-voxel block id from the room's own records (0 outside the room). Feed make_block_env with this.
 * @property {() => void} teardown removes all uploaded chunks + the mob mesh and detaches the god-ray
 *   provider. Idempotent.
 */

/**
 * Creates a cave-room handle from a serializable recipe. Generation runs eagerly (deterministic, ~30 ms
 * for the default 56×56 room); the engine wiring happens in mount().
 * @param {object} [args]
 * @param {Partial<CaveRoomConfig>} [args.config] partial cave recipe (merged over DEFAULT_CAVE_CONFIG).
 * @param {number} [args.seed] convenience override of config.seed.
 * @param {boolean} [args.placeholder_mob] mount the stand-in mob box at mob_spawn (default true — the
 *   demo's visual anchor). The dapp passes false when it drives REAL mobs (D224): the designed swap.
 * @returns {CaveRoomHandle}
 */
export function create_cave_room({ config = {}, seed, placeholder_mob = true } = {}) {
  /** @type {CaveRoom} */
  const room = generate_cave_room({ config, seed })

  /** @type {EngineApi | null} */
  let mounted_engine = null
  /** @type {import('three').Object3D | null} */
  let mob = null
  /** Uploaded chunk coords, for teardown. @type {[number, number, number][]} */
  const uploaded = []

  const mount = async (/** @type {EngineApi} */ engine) => {
    mounted_engine = engine
    await wait_for_engine(engine)

    // Build a private store so mesh_chunk can read cross-chunk neighbour halos (the room spans several
    // chunks — without halos, every interior chunk seam would emit a full wall of spurious quads and
    // the room's inner faces against its own neighbours would not cull). Same pattern as island_loader.
    const store = create_chunk_store({ capacity: Math.max(1, room.chunks.size) })
    for (const rec of room.chunks.values()) store.put(rec)

    const tr = engine.get_terrain_renderer()
    for (const rec of room.chunks.values()) {
      const { quad_buffer, quad_count } = mesh_chunk(rec, store.neighbor_halos(rec.cx, rec.cy, rec.cz))
      if (quad_count === 0) continue
      const coord = /** @type {[number, number, number]} */ ([rec.cx, rec.cy, rec.cz])
      tr?.upload_chunk(coord, quad_buffer, quad_count)
      uploaded.push(coord)
    }

    // KILL THE OUTDOOR DISTANCE FOG for the sealed room. scene.fog (THREE.Fog near≈200/far≈900) exists
    // to dissolve the OUTDOOR horizon into sky haze — inside a 56 m enclosed cave it only washes the
    // dark interior toward the light sky-haze colour (measured: a grey milk over the whole room, killing
    // the black-cave mood + the emissive-glow contrast). The froxel volumetric fog below is the RIGHT
    // in-cave atmosphere (enclosure-gated, dark, beam-carrying); the range fog is not. Push it far out of
    // the room so it never tints interior pixels (kept non-null so any downstream fog-node read is safe).
    const scene = /** @type {any} */ (engine.get_scene())
    if (scene?.fog) {
      scene.fog.near = 4000
      scene.fog.far = 8000
    }

    // GOD-RAY SUN OCCUPANCY: feed the froxel voxel-sun volume the room's records so the ceiling holes
    // occlude the shaft march (sealed roof = dark, hole columns = beams). The pass reads only
    // {cx,cy,cz,ids} and treats class:'solid' voxels as occluders (see froxel study). No-op when the
    // tier has no froxels (atmo null / voxel_sun null) or ?froxels=0.
    engine.get_atmosphere()?.set_resident_provider?.(
      /** @param {(rec: import('../chunks/format.js').ChunkRecord) => void} cb */ (cb) => {
        for (const rec of room.chunks.values()) cb(rec)
      }
    )

    // PLACEHOLDER MOB: a dark, faintly-emissive box at the centred spawn (the dapp swaps in real mobs —
    // it passes placeholder_mob:false and mounts the room roster's creature GLBs itself, D224).
    if (placeholder_mob) {
      mob = await build_placeholder_mob(room.mob_spawn)
      if (mob) engine.add_to_scene(mob)
    }

    // AMBIENCE FIXTURES REMOVED — no ambience fixtures are mounted by default. No FlameFX bonfire/
    // candle props are mounted — bare floating flames with no physical fire camp read as smoke out of nowhere.
    // The room still lights itself HONESTLY from its own emissive geometry: the lava-ravine glow + glow-mushroom
    // caps (material emissiveNode) + ceiling-hole sun shafts / froxel god rays. cave_room.fixtures anchors stay
    // as inert pure-data, ready for a future world-building wave that composes a real scene (never bare smoke).
  }

  const teardown = () => {
    const engine = mounted_engine
    if (!engine) return
    const tr = engine.get_terrain_renderer()
    for (const coord of uploaded) tr?.remove_chunk(coord)
    uploaded.length = 0
    if (mob) {
      engine.remove_from_scene(mob)
      dispose_object(mob)
      mob = null
    }
    // detach the god-ray provider (feed an empty iterator so the volume clears on its next rebuild).
    engine.get_atmosphere()?.set_resident_provider?.(() => {})
    mounted_engine = null
  }

  return {
    mount,
    board_anchor: room.board_anchor,
    mob_spawn: room.mob_spawn,
    player_spawn: room.player_spawn,
    bounds: room.bounds,
    sample_block: room.sample_block,
    teardown,
  }
}

// ---- Engine boot wait -------------------------------------------------------------------------
/** Wait (bounded, on rAF) for the engine's async boot to expose a live scene + terrain renderer, so
 *  uploads land in a real pool. @param {EngineApi} engine */
function wait_for_engine(engine) {
  return new Promise((resolve) => {
    const start = (typeof performance !== 'undefined' ? performance : Date).now()
    const poll = () => {
      const ready = engine.get_scene() !== null && engine.get_terrain_renderer() !== null
      const timed_out = (typeof performance !== 'undefined' ? performance : Date).now() - start > 20000
      if (ready || timed_out) return resolve(undefined)
      if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(poll)
      else resolve(undefined)
    }
    poll()
  })
}

// ---- Placeholder mob (a simple three mesh — the dapp drives real mobs) ------------------------
/**
 * Builds a lightweight placeholder mob: a dark, faintly self-lit box standing at the spawn (so the
 * combat-scene screenshot has an occupant). Kept a bare Mesh (no GLB rig) — it is explicitly a
 * placeholder and coupling to the character-avatar rig would be gold-plating. Async signature so a
 * future GLB swap is drop-in. @param {[number, number, number]} feet world feet position
 * @returns {Promise<import('three').Object3D | null>}
 */
async function build_placeholder_mob(feet) {
  if (typeof window === 'undefined') return null // headless (tests): no three scene object
  const THREE = await import('three')
  const h = 2.2
  const geo = new THREE.BoxGeometry(1.2, h, 1.2)
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a1420,
    emissive: 0x6a1f2a, // faint blood-red self-glow so it reads in the dark cave
    emissiveIntensity: 0.6,
    roughness: 0.8,
    metalness: 0.0,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.set(feet[0], feet[1] + h / 2, feet[2]) // box centre = feet + half height
  mesh.name = 'cave_placeholder_mob'
  return mesh
}

/** Disposes a three Object3D's geometry + material(s). @param {import('three').Object3D} obj */
function dispose_object(obj) {
  const any = /** @type {any} */ (obj)
  any.geometry?.dispose?.()
  const mat = any.material
  if (Array.isArray(mat)) mat.forEach((/** @type {any} */ m) => m?.dispose?.())
  else mat?.dispose?.()
}
