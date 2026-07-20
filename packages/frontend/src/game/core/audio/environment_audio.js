// ONE movement-tick hook for procedural world-ambience audio. embed_voxel_player.js's frame2 calls
// tick_environment_audio once per roam frame (never during a fight — see footstep_sfx.js's docblock);
// this fans out to the footstep engine so the player-movement code only grows a single audio call site.

import { tick_footsteps, reset_footsteps } from './footstep_sfx.js'

/**
 * @param {{ x: number, y: number, z: number, on_ground: boolean, block_id_at: (x:number,y:number,z:number) => number }} state
 * @param {number} dt seconds since the last tick
 * @returns {void}
 */
export function tick_environment_audio(state, dt) {
  tick_footsteps(state)
}

/** Tears down loop nodes/timers and resets accumulator/position memory — call on player session dispose. */
export function dispose_environment_audio() {
  reset_footsteps()
}
