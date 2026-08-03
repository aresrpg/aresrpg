// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAST-TRAVEL PILOT — the browserful flight EDGE (plan §3.4). Owns the dragon-ride LOOP: while the store is in
// a flying/landing phase it spawns the dragon (injected mount_dragon), integrates the PURE flight_step each
// frame and hard-places the body (injected teleport = ctl.teleport, mirroring the TR-1 creative-fly branch,
// embed_voxel_player.js:427-435), live-retargets to a same-world peer, and on arrival FORCE-UNMOUNTS (the drop)
// so the next ctl.tick's gravity settles the body (TR-1 exit; no fall damage §4-B6). Every effect is injected →
// headless-drivable; the flight MATH lives in fast_travel_flight.js (unit-tested), the phase machine in the store.
//
// v2 (#370) — OWN FACING: ctl.teleport() zeroes the controller's velocity, and the controller's facing_yaw is
// only ever recomputed inside step_controller() (called from tick(), which flight never calls — see the #175
// note on MOUNT_MOVE_THRESHOLD in fast_travel_flight.js for the identical frozen-state class of bug). So
// facing_yaw is frozen at whatever it was the instant before takeoff for the WHOLE flight — the reported "the
// dragon renders sideways/backwards" defect. The pilot tracks its OWN heading from flight_step's segment
// direction instead of trusting the frozen controller transform, eased frame-to-frame (smooth turns) via the
// same shortest-arc idiom character_controller.js's (private) turn_toward uses — vendored here rather than
// exported across the engine/frontend package boundary for one 3-line generic math helper.

import { ft_flight_target } from '../world-shell/fast_travel_store.js'

import { flight_step } from './fast_travel_flight.js'

const RETARGET_EPS = 0.5 // only dispatch a live retarget once the peer moved this far (m) — no per-frame churn
const YAW_TURN_RATE = 12 // rad/s-ish ease lambda — matches the ground controller's own turn feel (same constant)

/** Shortest-arc exponential ease toward a target yaw. @param {number} current @param {number} target @param {number} dt */
function ease_yaw(current, target, dt) {
  let delta = target - current
  while (delta > Math.PI) delta -= 2 * Math.PI
  while (delta < -Math.PI) delta += 2 * Math.PI
  return current + delta * (1 - Math.exp(-YAW_TURN_RATE * dt))
}

/**
 * @param {{
 *   get_ft: () => any,                                   // fast_travel_store.getState()
 *   dispatch: (input:any) => void,                       // fast_travel_store input door
 *   get_pos: () => ArrayLike<number>,                    // live feet [x,y,z]
 *   sample_ground: (x:number, z:number) => number|null,  // ground top under (x,z), null = column not streamed
 *   mount_dragon: () => void,                             // spawn the rig + broadcast (embed: mirrors mount_up)
 *   unmount_dragon: () => void,                           // dispose the rig + broadcast (embed: mirrors mount_down)
 *   teleport: (pos:[number,number,number]) => void,      // hard-place the body (ctl.teleport)
 *   live_pos_of?: (character_id:string|null) => ({x:number,z:number}|null), // same-world peer live pos (retarget)
 *   can_fly?: () => boolean,                              // false aborts takeoff (in-fight — the board owns the body)
 * }} deps
 */
export function create_fast_travel_pilot({
  get_ft,
  dispatch,
  get_pos,
  sample_ground,
  mount_dragon,
  unmount_dragon,
  teleport,
  live_pos_of,
  can_fly = () => true,
}) {
  let mounted = false
  let fly_pos = [0, 0, 0]
  // v2 (#370): the pilot's OWN flight heading — null means "not flying" and snaps (no ease) on the first frame
  // of a new flight, so a stale heading from a PREVIOUS flight never bleeds into this one.
  let fly_yaw = null

  const drop = () => {
    if (mounted) unmount_dragon()
    mounted = false
    fly_yaw = null
  }

  /** One frame. Self-gated: teleports only while flying/landing, tears the rig down otherwise (cancel/arrival). */
  const update = (/** @type {number} */ dt) => {
    const state = get_ft()
    const flight = ft_flight_target(state) // non-null only in flying/landing
    if (!flight) {
      if (mounted) drop() // cancel / refusal / reset mid-flight → the dragon leaves
      return
    }
    if (!mounted) {
      if (!can_fly()) {
        dispatch({ type: 'cancel' }) // in-fight at takeoff — abort honestly, no dragon
        return
      }
      const p = get_pos() // snapshot the launch point so the integration is drift-free (like set_fly)
      fly_pos = [Number(p[0]), Number(p[1]), Number(p[2])]
      mount_dragon()
      mounted = true
    }
    // LIVE RETARGET — a same-world peer's fresh position drives the flight (routing law: only post same-world,
    // which the store proved by being in 'flying'). Dispatch through the reducer, never a direct write.
    if (state.phase === 'flying' && live_pos_of) {
      const lp = live_pos_of(state.target?.character_id)
      if (lp && (Math.abs(lp.x - flight.x) > RETARGET_EPS || Math.abs(lp.z - flight.z) > RETARGET_EPS))
        dispatch({ type: 'retarget', x: lp.x, z: lp.z })
    }
    const ground_y = sample_ground(fly_pos[0], fly_pos[2])
    const stepped = flight_step({ pos: fly_pos, target: { x: flight.x, z: flight.z }, ground_y, dt })
    fly_pos = [...stepped.pos]
    fly_yaw = fly_yaw == null ? stepped.yaw : ease_yaw(fly_yaw, stepped.yaw, dt)
    teleport([fly_pos[0], fly_pos[1], fly_pos[2]])
    if (state.phase === 'flying') {
      if (stepped.arrived) dispatch({ type: 'arrived' }) // → landing; the descent already brought us to ground+3
    } else {
      // phase === 'landing': FORCE UNMOUNT (drop the mount via a hard unmount). We are ~ground+3 (the
      // approach descended us); the next ctl.tick's gravity settles the last metres (TR-1 exit). reset → idle.
      drop()
      dispatch({ type: 'reset' })
    }
  }

  return {
    update,
    active: () => mounted,
    /** v2 (#370): the pilot's own smoothed flight heading (radians) — the caller poses the mount rig with THIS
     *  while flying, never the controller's frozen facing_yaw. 0 when no flight has stepped yet. */
    yaw: () => fly_yaw ?? 0,
    cancel: () => drop(),
    dispose: () => drop(),
  }
}
