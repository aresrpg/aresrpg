// NAMEPLATE PROJECTION + OCCLUSION — the ONE shared home for turning an overhead plate's WORLD anchor into a
// screen pixel and testing whether terrain hides it. Every plate path (world_spawns.js mob cards,
// remote_players.js, local_nameplate.js) routes through `project_plate` so the two things that must be right
// EVERYWHERE are written ONCE: (1) the head-bob un-projection (world-lock — bob cancelled at the source so
// plates never swim; fixed 2026-07-10) and (2) the behind-camera cull (a point behind the eye projects
// to a flipped NDC that would otherwise draw a plate for a mob straight behind you). Per-path fade/occlusion
// stays with each caller.
//
// OCCLUSION is the CHEAP depth test the feel wave asked for: march the segment from the anchor toward the eye
// through the resident voxel field (engine.sample_block — a chunk-store lookup); a solid voxel strictly between
// them means the plate is behind geometry → the caller fades it. SCOPE: OVERWORLD plates only. The dungeon cave
// (cave_mobs.js) meshes its room through a SEPARATE sample source, so this oracle can't see its walls — and the
// room is a small flat combat floor where occlusion barely applies. Left out on purpose.

import { Vector3 } from 'three'

const SKIP_NEAR = 1.5 // ignore voxels this close to either endpoint — the block the head/eye sits against
const STEP = 1.0 // sample cadence in metres (voxels are unit-sized); coarse enough to stay ~cheap, fine
//                  enough to catch a 1-block wall. ~60 samples over a 60 m span, a few plates → negligible.

const _dir = new Vector3()
const _eye = new Vector3()
const _proj = new Vector3()
const _fwd = new Vector3()

/**
 * Project a plate's WORLD head anchor to a screen pixel — world-locked, behind-culled — or null when the plate
 * must be hidden. Cancels the shoulder rig's synthetic head-bob (`cam.userData.plate_bob`, published by
 * embed_voxel_player.js from camera_rig.js's get_bob_offset()) at the source so the plate never swims with the
 * stride, and rejects anchors BEHIND the eye (their projection flips past the near plane and would otherwise
 * land on-screen). The caller owns range-fade + occlusion opacity; this owns position + visibility.
 * @param {any} cam the live render camera (three PerspectiveCamera) @param {{left:number,top:number,width:number,height:number}} rect the world-canvas rect
 * @param {number} x anchor world X @param {number} y anchor world Y (head height) @param {number} z anchor world Z
 * @param {{left:number,top:number}} [out] retained hot-loop output; omitted callers receive a fresh result
 * @returns {{ left: number, top: number } | null} the screen pixel, or null = hide (behind camera / off-frustum)
 */
export function project_plate(cam, rect, x, y, z, out) {
  if (!cam) return null
  // behind-camera cull: forward · (anchor − eye) ≤ 0 → the anchor is at/behind the eye plane, hide.
  _fwd.set(0, 0, -1).applyQuaternion(cam.quaternion)
  if (_fwd.x * (x - cam.position.x) + _fwd.y * (y - cam.position.y) + _fwd.z * (z - cam.position.z) <= 0) return null
  // world-lock: add the synthetic bob to the anchor Y so it cancels the camera's baked-in bob at projection.
  _proj.set(x, y + (cam.userData?.plate_bob ?? 0), z).project(cam)
  if (!(_proj.z < 1 && _proj.x > -1.05 && _proj.x < 1.05 && _proj.y > -1.05 && _proj.y < 1.05)) return null
  const point = out ?? { left: 0, top: 0 }
  point.left = rect.left + ((_proj.x + 1) / 2) * rect.width
  point.top = rect.top + ((1 - _proj.y) / 2) * rect.height
  return point
}

/**
 * Is the plate anchor hidden from the camera by solid voxels?
 * @param {{ sample_block?: (x: number, y: number, z: number) => number }} engine  the live engine facade
 * @param {number} ax anchor world X @param {number} ay anchor world Y @param {number} az anchor world Z
 * @param {{ position: { x: number, y: number, z: number } } | null | undefined} cam the live camera
 * @returns {boolean} true = occluded (fade the plate); false = clear line of sight (or no oracle yet)
 */
export function plate_occluded(engine, ax, ay, az, cam) {
  const sample = engine?.sample_block
  if (typeof sample !== 'function' || !cam) return false
  _eye.set(cam.position.x, cam.position.y, cam.position.z)
  _dir.set(_eye.x - ax, _eye.y - ay, _eye.z - az)
  const dist = _dir.length()
  if (dist <= SKIP_NEAR * 2) return false // eye basically on top of the anchor — nothing can occlude
  _dir.multiplyScalar(1 / dist) // unit direction anchor → eye
  for (let d = SKIP_NEAR; d < dist - SKIP_NEAR; d += STEP) {
    const bx = Math.floor(ax + _dir.x * d)
    const by = Math.floor(ay + _dir.y * d)
    const bz = Math.floor(az + _dir.z * d)
    if ((sample(bx, by, bz) | 0) !== 0) return true // hit solid before reaching the eye → behind geometry
  }
  return false
}

// (The former damp_plate_y screen-Y smoother was DELETED 2026-07-10: it lagged plates against ALL camera
// motion — pans/jumps — so they visibly swam off their anchors. The head-bob is now cancelled at the SOURCE
// instead: camera_rig.js exposes get_bob_offset() and every plate adds it to its anchor Y before projecting,
// world-locking the plate with zero smoothing. See world_spawns.js / remote_players.js / local_nameplate.js.)
