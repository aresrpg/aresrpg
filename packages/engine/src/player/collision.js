// Capsule-vs-voxel collision resolution (ENG-8). PURE MATH — no three.js, no engine coupling: it
// takes the player as an axis-aligned box (a vertical capsule approximated by its AABB, which is
// what voxel worlds want — the corners never need the rounded cap and an AABB never tunnels) plus
// a `solid(x,y,z)` occupancy predicate, and returns the collision-resolved position + the residual
// velocity + ground/ceiling flags. This is the single home for the "don't walk through blocks,
// climb a 1-block step, slide along walls, don't tunnel at sprint" logic, and it is unit-tested
// against a synthetic block world (collision.test.js) with no renderer in the loop.
//
// WHY AABB not a true swept capsule: our blocks are unit cubes on an integer grid, the player is a
// thin vertical box (radius 0.4 → 0.8 wide, collider height 1.9 — a hair under the 2.0 visual crown so a
// 2-block body clears a 2-block gap; see CHARACTER_COLLIDER_HEIGHT). Axis-separated resolution of a box against
// the integer voxel grid is exact for cube geometry (a capsule's rounded corners only matter against
// sloped/rounded colliders, which voxels never are) and is branch-cheap. The dapp's engine used a
// library sweep (VoxelmapCollisions.entityMovement); we reproduce its *observable feel* — smooth
// step-up, wall slide, no tunneling — with a self-contained sub-stepped axis solver.
//
// FRAME MODEL: position `p` is the player's FEET centre (x,z centre of the box, y = bottom). The box
// spans [px-r, px+r] × [py, py+h] × [pz-r, pz+r]. Callers (controller.js) integrate velocity and
// hand us the *desired* delta; we move axis-by-axis, and on a blocked axis we zero that velocity
// component (so gravity resets on landing, forward speed dies into a wall) unless a step-up rescued it.

import { CHARACTER_COLLIDER_HEIGHT, CHARACTER_RADIUS } from '../config/world_config.js'

/** Max vertical block-height the player auto-climbs without jumping (a 1-block terrace). Slightly
 *  over 1.0 so a full unit step (feet 0 → block top 1.0) always clears with float headroom. */
export const AUTO_STEP_HEIGHT = 1.05

/** Corner forgiveness (2026-07-07 pro-feel pass — tight spaces were hard to control): when a
 *  horizontal move is blocked by no more than this much lateral overlap with a block corner/doorway
 *  edge, the solver SLIPS the body sideways around it instead of dead-stopping. The body is 0.8 wide
 *  vs 1.0-block gaps — without this, threading a 1-block doorway needed pixel-perfect alignment. */
export const CORNER_NUDGE = 0.3

/** Lateral probe granularity (m) for the corner nudge search. */
const NUDGE_PROBE = 0.05

/** Skin width — a tiny gap kept between the box and the blocks it resolves against, so a resolved
 *  face doesn't sit exactly ON the grid line (which flickers between "just inside"/"just outside"
 *  the neighbouring solid cell under float error, re-triggering collision every frame). */
const SKIN = 1e-3

/** Sub-step ceiling per axis move: a move longer than (1 − skin) block is split so a fast sprint or a
 *  big frame-hitch delta can never leap over a 1-block-thin wall between two samples (anti-tunnel). */
const MAX_STEP_M = 0.5

/**
 * @typedef {(x: number, y: number, z: number) => boolean} SolidFn occupancy oracle: true iff the
 *   voxel whose integer floor-cell is (x,y,z) is a SOLID collider (foliage/liquid/air → false).
 */

/**
 * @typedef {object} CapsuleSpec the moving body as an AABB around a feet-centre.
 * @property {number} [radius] half-width on x and z (default CHARACTER_RADIUS)
 * @property {number} [height] full height feet→head (default CHARACTER_COLLIDER_HEIGHT)
 */

/**
 * @typedef {object} MoveResult
 * @property {[number, number, number]} position resolved feet-centre position
 * @property {[number, number, number]} velocity residual velocity (blocked components zeroed)
 * @property {boolean} on_ground true iff a downward move was stopped by ground this call (or the
 *   body is resting on solid within the skin) — the controller uses this for coyote-time + jump.
 * @property {boolean} hit_ceiling true iff an upward move was stopped by a solid block overhead.
 * @property {boolean} stepped true iff a horizontal move auto-climbed a step this call (drives the
 *   controller's step-smoothing so the camera doesn't pop on a terrace).
 */

/**
 * Tests whether the player AABB at feet-centre (px,py,pz) overlaps ANY solid voxel. Scans the
 * integer cells the box covers on each axis (inclusive floor→ceil), early-outs on the first solid.
 * The box is shrunk by SKIN so a body resting flush against a wall isn't reported as overlapping it.
 * @param {SolidFn} solid
 * @param {number} px feet-centre x
 * @param {number} py feet y (box bottom)
 * @param {number} pz feet-centre z
 * @param {number} r half-width
 * @param {number} h full height
 * @returns {boolean}
 */
export function box_overlaps_solid(solid, px, py, pz, r, h) {
  const min_x = Math.floor(px - r + SKIN)
  const max_x = Math.floor(px + r - SKIN)
  const min_y = Math.floor(py + SKIN)
  const max_y = Math.floor(py + h - SKIN)
  const min_z = Math.floor(pz - r + SKIN)
  const max_z = Math.floor(pz + r - SKIN)
  for (let y = min_y; y <= max_y; y += 1) {
    for (let z = min_z; z <= max_z; z += 1) {
      for (let x = min_x; x <= max_x; x += 1) {
        if (solid(x, y, z)) return true
      }
    }
  }
  return false
}

/**
 * Moves the body along ONE axis by `delta`, sub-stepped so it can't tunnel, stopping at the last
 * position before an overlap. Returns the achieved position on that axis plus whether it was blocked.
 * @param {SolidFn} solid
 * @param {[number, number, number]} pos feet-centre [x,y,z] (mutated-free; we copy per probe)
 * @param {0|1|2} axis 0=x 1=y 2=z
 * @param {number} delta signed distance to travel on `axis`
 * @param {number} r half-width
 * @param {number} h full height
 * @returns {{ value: number, blocked: boolean }} achieved coord on `axis`, and if a block stopped it
 */
function move_axis(solid, pos, axis, delta, r, h) {
  if (delta === 0) return { value: pos[axis], blocked: false }
  const sign = Math.sign(delta)
  let remaining = Math.abs(delta)
  const probe = /** @type {[number, number, number]} */ ([pos[0], pos[1], pos[2]])
  let blocked = false
  while (remaining > 0) {
    const step = Math.min(remaining, MAX_STEP_M)
    remaining -= step
    const next = probe[axis] + sign * step
    const saved = probe[axis]
    probe[axis] = next
    if (box_overlaps_solid(solid, probe[0], probe[1], probe[2], r, h)) {
      // Overlap: snap to the block face (leave a skin gap) and stop this axis.
      probe[axis] = snap_to_face(solid, saved, next, axis, sign, probe, r, h)
      blocked = true
      break
    }
  }
  return { value: probe[axis], blocked }
}

/**
 * Binary-refines the axis position between the last-good `from` and the overlapping `to` down to the
 * grid face, then backs off by SKIN. A few iterations converge well under a millimetre — cheaper and
 * more robust than analytically computing the exact face (which axis/cell it hit depends on the whole
 * box footprint), and it's what keeps the resolved body flush without jitter.
 * @param {SolidFn} solid
 * @param {number} from last non-overlapping coord on `axis`
 * @param {number} to first overlapping coord on `axis`
 * @param {0|1|2} axis
 * @param {number} sign travel direction
 * @param {[number, number, number]} probe scratch position (its `axis` component is overwritten)
 * @param {number} r
 * @param {number} h
 * @returns {number} the resolved coord (last non-overlapping, minus skin)
 */
function snap_to_face(solid, from, to, axis, sign, probe, r, h) {
  let lo = from // known clear
  let hi = to // known blocked
  for (let i = 0; i < 12; i += 1) {
    const mid = (lo + hi) / 2
    probe[axis] = mid
    if (box_overlaps_solid(solid, probe[0], probe[1], probe[2], r, h)) hi = mid
    else lo = mid
  }
  probe[axis] = lo
  void sign
  return lo
}

/**
 * Resolves a full movement step: applies the desired delta axis-separated (X, then Z, then Y — the
 * classic order that lets a horizontal move try a step-up before Y settles), performs auto-step for
 * blocked horizontal moves, and reports ground/ceiling. Blocked axes zero their velocity component so
 * the controller sees "I hit a wall" / "I landed". This is deterministic and side-effect-free.
 *
 * @param {SolidFn} solid occupancy oracle
 * @param {[number, number, number]} position feet-centre start
 * @param {[number, number, number]} velocity current velocity (m/s) — copied, blocked axes zeroed
 * @param {number} dt seconds
 * @param {CapsuleSpec} [spec]
 * @returns {MoveResult}
 */
export function resolve_movement(solid, position, velocity, dt, spec = {}) {
  const r = spec.radius ?? CHARACTER_RADIUS
  const h = spec.height ?? CHARACTER_COLLIDER_HEIGHT
  const vel = /** @type {[number, number, number]} */ ([velocity[0], velocity[1], velocity[2]])
  const pos = /** @type {[number, number, number]} */ ([position[0], position[1], position[2]])

  let stepped = false

  // ── horizontal X ────────────────────────────────────────────────────────────────────────────
  const dx = vel[0] * dt
  const rx = move_axis(solid, pos, 0, dx, r, h)
  if (rx.blocked) {
    const climbed = try_step_up(solid, pos, 0, dx, r, h)
    if (climbed !== null) {
      pos[0] = climbed.x
      pos[1] = climbed.y
      stepped = true
    } else {
      const nudged = try_corner_nudge(solid, pos, 0, dx, r, h)
      if (nudged !== null) {
        ;[pos[0], , pos[2]] = nudged
        // velocity preserved — slipping around a corner, not hitting a wall
      } else {
        pos[0] = rx.value
        vel[0] = 0 // ran into a wall → kill forward-on-X, letting Z still slide (wall slide)
      }
    }
  } else {
    pos[0] = rx.value
  }

  // ── horizontal Z ────────────────────────────────────────────────────────────────────────────
  const dz = vel[2] * dt
  const rz = move_axis(solid, pos, 2, dz, r, h)
  if (rz.blocked) {
    const climbed = try_step_up(solid, pos, 2, dz, r, h)
    if (climbed !== null) {
      pos[2] = climbed.z
      pos[1] = climbed.y
      stepped = true
    } else {
      const nudged = try_corner_nudge(solid, pos, 2, dz, r, h)
      if (nudged !== null) {
        ;[pos[0], , pos[2]] = nudged
      } else {
        pos[2] = rz.value
        vel[2] = 0
      }
    }
  } else {
    pos[2] = rz.value
  }

  // ── vertical Y ──────────────────────────────────────────────────────────────────────────────
  const dy = vel[1] * dt
  const ry = move_axis(solid, pos, 1, dy, r, h)
  let on_ground = false
  let hit_ceiling = false
  if (ry.blocked) {
    pos[1] = ry.value
    if (dy < 0)
      on_ground = true // stopped while descending → landed
    else if (dy > 0) hit_ceiling = true // stopped while rising → bonked head
    vel[1] = 0
  } else {
    pos[1] = ry.value
  }

  // Resting contact: even with ~0 vertical velocity, report on_ground when solid sits directly
  // beneath the feet within the skin — otherwise a body that damped to rest on a floor would read
  // airborne (breaking jump + idle anim). Probe a hair below the feet across the full footprint.
  if (!on_ground && vel[1] <= 0 && box_overlaps_solid(solid, pos[0], pos[1] - 2 * SKIN, pos[2], r, h)) {
    on_ground = true
  }

  return { position: pos, velocity: vel, on_ground, hit_ceiling, stepped }
}

/**
 * Attempts to auto-climb a step for a horizontal move that just got blocked: lift the body up to
 * AUTO_STEP_HEIGHT, retry the same horizontal delta, and if it now clears AND has solid ground under
 * the landing (not a lip into the void), accept the raised+advanced position. Returns null if no
 * legal step exists (a ≥2-block wall, or the raised path is also blocked, or nothing to stand on).
 * @param {SolidFn} solid
 * @param {[number, number, number]} pos current feet-centre (post-other-horizontal-axis)
 * @param {0|2} axis the horizontal axis being moved (0=x, 2=z)
 * @param {number} delta the (blocked) desired horizontal delta on `axis`
 * @param {number} r
 * @param {number} h
 * @returns {{ x: number, y: number, z: number } | null}
 */
function try_step_up(solid, pos, axis, delta, r, h) {
  // 1. Can we even rise into headroom by the step height at the current x/z?
  const lifted = /** @type {[number, number, number]} */ ([pos[0], pos[1] + AUTO_STEP_HEIGHT, pos[2]])
  if (box_overlaps_solid(solid, lifted[0], lifted[1], lifted[2], r, h)) return null // low ceiling — no step

  // 2. From the lifted height, retry the horizontal move; it must fully clear (not blocked).
  const horiz = move_axis(solid, lifted, axis, delta, r, h)
  if (horiz.blocked) return null // still a wall even one block up ⇒ it's a ≥2-block wall, not a step
  lifted[axis] = horiz.value

  // 3. Settle back down onto the step: drop until we touch solid (within the step height). If there's
  //    no ground within the climbed height, it was a gap/lip, not a step — reject (don't float).
  const drop = move_axis(solid, lifted, 1, -AUTO_STEP_HEIGHT, r, h)
  if (!drop.blocked) return null // nothing solid under the advanced position within step range → gap
  lifted[1] = drop.value
  return { x: lifted[0], y: lifted[1], z: lifted[2] }
}

/**
 * Corner forgiveness (2026-07-07 pro-feel pass): a horizontal move blocked by a block CORNER (or a
 * doorway edge) probes sideways up to CORNER_NUDGE for a lateral offset from which the same move
 * clears; if found, this frame's motion budget is spent slipping toward that clearance (never faster
 * than the intended move), advancing on the blocked axis with whatever budget remains. Over a few
 * frames the body slides around the corner / into the 1-block gap instead of dead-stopping. Returns
 * the adjusted [x,y,z] (y untouched) or null when it's a real wall (probes exhausted on both sides).
 * @param {SolidFn} solid
 * @param {[number, number, number]} pos current feet-centre (post-step-up rejection)
 * @param {0|2} axis the blocked horizontal axis
 * @param {number} delta the (blocked) desired delta on `axis`
 * @param {number} r
 * @param {number} h
 * @returns {[number, number, number] | null}
 */
function try_corner_nudge(solid, pos, axis, delta, r, h) {
  const budget = Math.abs(delta)
  if (budget < 1e-6) return null
  const perp = axis === 0 ? 2 : 0
  for (const sign of [1, -1]) {
    for (let off = NUDGE_PROBE; off <= CORNER_NUDGE + 1e-9; off += NUDGE_PROBE) {
      const probe = /** @type {[number, number, number]} */ ([pos[0], pos[1], pos[2]])
      probe[perp] += sign * off
      if (box_overlaps_solid(solid, probe[0], probe[1], probe[2], r, h)) break // wall on this side
      if (move_axis(solid, probe, axis, delta, r, h).blocked) continue // not enough clearance yet
      // Clearance found `off` to the side — apply the capped slip, then the leftover axis advance.
      const lateral = Math.min(off, budget)
      const out = /** @type {[number, number, number]} */ ([pos[0], pos[1], pos[2]])
      out[perp] += sign * lateral
      if (box_overlaps_solid(solid, out[0], out[1], out[2], r, h)) return null // partial spot fouled
      const ahead = move_axis(solid, out, axis, Math.sign(delta) * (budget - lateral), r, h)
      out[axis] = ahead.value
      return out
    }
  }
  return null
}

/**
 * Finds the ground height directly under a feet-centre by scanning downward for the first solid
 * voxel top within `max_drop` blocks — used to SPAWN the player flush on the terrain (demo spawn) and
 * as a safety re-ground. Returns the y of the top face of that block (where the feet should rest), or
 * null if no ground is found within range.
 * @param {SolidFn} solid
 * @param {number} px feet-centre x
 * @param {number} py start feet y (scan starts here and goes down)
 * @param {number} pz feet-centre z
 * @param {number} [max_drop] blocks to scan (default 64)
 * @returns {number | null}
 */
export function ground_height_below(solid, px, py, pz, max_drop = 64) {
  const start = Math.floor(py)
  for (let y = start; y >= start - max_drop; y -= 1) {
    // A cell is "ground under the feet" if it's solid; the feet rest on its TOP face (y+1).
    if (solid(Math.floor(px), y, Math.floor(pz))) return y + 1
  }
  return null
}

/** Max cells the eject scan climbs OUT of solid before trying laterally (the buried-depth ceiling). */
export const EJECT_MAX_UP = 32
/** Lateral half-extent (blocks) of the fallback ring when the whole column is blocked — a 5×5 ring. */
export const EJECT_RING = 2

/** The 5×5 lateral ring offsets (excluding the centre), pre-sorted NEAREST-first by squared distance,
 *  so a lateral eject always picks the closest clear column. Built once at module load. */
const EJECT_LATERAL_OFFSETS = (() => {
  /** @type {[number, number][]} */
  const out = []
  for (let dx = -EJECT_RING; dx <= EJECT_RING; dx += 1)
    for (let dz = -EJECT_RING; dz <= EJECT_RING; dz += 1) if (dx || dz) out.push([dx, dz])
  out.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]))
  return out
})()

/**
 * STUCK-IN-BLOCK auto-eject (BACKLOG). Given a feet-centre position, returns the nearest position whose
 * capsule holds NO solid voxel — so a spawn / teleport / snapshot-adopt never leaves the camera inside
 * geometry. Reuses the SAME box_overlaps_solid occupancy query the movement solver uses (one solidity
 * oracle), so "stuck" here means exactly what "collides" means everywhere else. Pure, no side effects
 * beyond a single give-up warning.
 *
 * Search order (nearest-air, deterministic): if already clear → the position UNCHANGED (the common
 * path, one AABB test). Else scan UP the same column (the minimal un-bury — stand on top of what you're
 * stuck in) up to EJECT_MAX_UP; if the column is blocked to the cap, scan the EJECT_RING (5×5) lateral
 * columns nearest-first, each from the current y upward. If nothing clears within the caps, leave the
 * position and log ONE warning (never an infinite search).
 *
 * @param {SolidFn} solid occupancy oracle (the controller's env.solid_at — cave/world-swappable)
 * @param {[number, number, number]} position feet-centre [x,y,z] to correct
 * @param {CapsuleSpec} [spec] capsule radius/height (defaults to the character collider)
 * @returns {[number, number, number]} a clear feet-centre position (the input, unchanged, when already clear)
 */
export function eject_from_solid(solid, position, spec = {}) {
  const r = spec.radius ?? CHARACTER_RADIUS
  const h = spec.height ?? CHARACTER_COLLIDER_HEIGHT
  const [px, py, pz] = position
  // Already clear — the overwhelmingly common case (every non-buried adoption). One overlap test.
  if (!box_overlaps_solid(solid, px, py, pz, r, h)) return position
  // 1) Up the SAME column: the minimal, deterministic un-bury.
  for (let dy = 1; dy <= EJECT_MAX_UP; dy += 1) {
    if (!box_overlaps_solid(solid, px, py + dy, pz, r, h)) return [px, py + dy, pz]
  }
  // 2) Column blocked to the cap → the nearest lateral column (5×5 ring). Scan HEIGHT-first (minimal
  //    rise), and at each height take the nearest clear ring column — the closest air overall, never a
  //    32-block fling into a random column when air sits one step up-and-over.
  for (let dy = 0; dy <= EJECT_MAX_UP; dy += 1) {
    for (const [dx, dz] of EJECT_LATERAL_OFFSETS) {
      if (!box_overlaps_solid(solid, px + dx, py + dy, pz + dz, r, h)) return [px + dx, py + dy, pz + dz]
    }
  }
  // 3) Give up — leave the position, one honest warning. Never loop forever (search is bounded above).
  console.warn(
    `[voxel] eject failed: capsule at [${position.map((v) => +v.toFixed(1)).join(', ')}] found no air within ` +
      `${EJECT_MAX_UP} up / ${EJECT_RING * 2 + 1}² ring — left in place`
  )
  return position
}
