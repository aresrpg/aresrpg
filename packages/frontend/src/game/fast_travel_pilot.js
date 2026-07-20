// FAST-TRAVEL PILOT — the browserful flight EDGE (plan §3.4). Owns the dragon-ride LOOP: while the store is in
// a flying/landing phase it spawns the dragon (injected mount_dragon), integrates the PURE flight_step each
// frame and hard-places the body (injected teleport = ctl.teleport, mirroring the TR-1 creative-fly branch,
// embed_voxel_player.js:427-435), live-retargets to a same-world peer, and on arrival FORCE-UNMOUNTS (the drop)
// so the next ctl.tick's gravity settles the body (TR-1 exit; no fall damage §4-B6). Every effect is injected →
// headless-drivable; the flight MATH lives in fast_travel_flight.js (unit-tested), the phase machine in the store.

import { ft_flight_target } from '../world-shell/fast_travel_store.js'

import { flight_step } from './fast_travel_flight.js'

const RETARGET_EPS = 0.5 // only dispatch a live retarget once the peer moved this far (m) — no per-frame churn

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
  const fly_pos = [0, 0, 0]

  const drop = () => {
    if (mounted) unmount_dragon()
    mounted = false
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
      fly_pos[0] = Number(p[0])
      fly_pos[1] = Number(p[1])
      fly_pos[2] = Number(p[2])
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
    fly_pos[0] = stepped.pos[0]
    fly_pos[1] = stepped.pos[1]
    fly_pos[2] = stepped.pos[2]
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
    cancel: () => drop(),
    dispose: () => drop(),
  }
}
