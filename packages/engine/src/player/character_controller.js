// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-24 / D160 (2026-07-05) — the PUBLIC character-controller facade: the engine owns walk PHYSICS,
// the app sends INPUT and reads the TRANSFORM. Promoted surface over the already-proven src/player
// physics (controller.js step_controller + block_solidity env — the demo's walk mode and the D141
// cave drive the very same code), so ground movement has ONE home across the streamed world, the
// fixed world, the cave room, and the WebGL heightmap floor (any `sample_block` oracle works).
//
// CONTRACT (sealed with cto's D160 lane, mirrors the tactical-board philosophy):
//   • the APP owns the avatar (GLB, anim playback) + its camera + its input devices;
//   • the ENGINE owns gravity / ground collision / step-up smoothing / water state — one physics home;
//   • the app calls set_input() whenever its input changes, tick(dt) once per frame from ITS loop
//     (physics is fixed-step internally — dt is accumulated, so any caller cadence is stable), and
//     reads get_transform() to pose its avatar + camera. No engine.js coupling, no hidden loops.
//
// The spawn helpers (find_open_spawn / ground_surface_y — the "never in a tree, never in a lake"
// column scan) are re-exported here as the ONE home; the demo and the dapp both consume these
// (replacing cto's app-side duplicate id sets, per the one-home swap agreed on ENG-23/D156v2.1).

import { create_controller_state, step_controller } from './controller.js'
import { make_block_env } from './block_solidity.js'
import { eject_from_solid } from './collision.js'

export { find_open_spawn, ground_surface_y, seat_surface_y, topmost_solid_id } from './spawn.js'
export { CONTROLLER_CONSTANTS } from './controller.js' // the ONE speed/physics home — fast-travel flight reads RUN_SPEED here (never a literal)
export { create_character_avatar, compose_pixels } from './character_avatar.js' // D193 — lit/grounded/recolored avatar (ONE home)
// [one-mob-sdk 2026-07-13] the single mob-render home: DRACO loader + metalness gold-kill (D224/D242) + mob-only
// pixel-art sampler/emissive-floor (S-82) + the cached clone factory + the height-normalise policy every mob path
// (roam spawn_rigs / dungeon cave_mobs / fight board_entities) shares.
export {
  get_glb_loader,
  apply_avatar_material,
  apply_pixel_filter,
  create_mob_model,
  load_glb_checked,
  prepare_mob_render,
} from './mob_model.js'
// D195 — the dapp consumes the DEMO's exact camera feel + collision oracle (walk_mode.js wiring):
export { create_shoulder_camera } from './camera_rig.js'
export { make_block_env } from './block_solidity.js'
// AUDIO (footstep ground-class + water proximity): the block registry's per-block `sounds.step` tag
// (block_registry.js — already authored on every entry, previously unconsumed) is the ONE home for
// "what does this block sound like underfoot"; re-exported here (not `./config/*`, unreachable from the
// app) so the frontend resolves it via a block id without a second id→material table.
export { get_block_by_id } from '../config/block_registry.js'
export { create_title_aura, aura_quad_layout } from '../render/title_aura.js' // TR-5 — the veteran-title flame aura (ROAM avatar)
export {
  create_worn_cosmetics,
  compute_worn_head_scale,
  measure_head_box,
  HEAD_FIT,
  WORN_ROUGHNESS,
  WORN_METALNESS,
} from './worn_cosmetics.js' // worn visible-slot GLBs on the roam skeleton (head/back; no modeled hand seed slot)

/** Physics fixed step (s) — matches the demo's feel; tick(dt) accumulates toward this. */
const FIXED_STEP = 1 / 60
/** Max accumulated steps per tick — a background tab returning after seconds must not explode. */
const MAX_STEPS_PER_TICK = 8

/**
 * @typedef {object} CharacterInput
 * @property {number} [forward] -1..1 (forward positive)
 * @property {number} [strafe] -1..1 (right positive)
 * @property {boolean} [jump]
 * @property {boolean} [walk] slow-walk modifier (run is the default gait)
 * @property {number} [speed_scale] roam ground-speed multiplier (default 1) — the app's ONE knob for
 *   equip-driven movement bonuses (the mount slot rides ×1.5); merged like any other held input.
 * @property {number} [yaw] the CAMERA yaw (radians) the movement axes are relative to — the app's
 *   camera owns facing intent; the controller derives the avatar's facing from actual motion.
 */

/**
 * @typedef {object} CharacterTransform
 * @property {[number, number, number]} position feet, world space (x/z centred, y = feet)
 * @property {number} visual_y step-up-SMOOTHED feet y — pose the avatar at THIS y (position[1] is the
 *   physics truth; visual_y eases over steps so stairs don't teleport the mesh)
 * @property {number} facing_yaw radians — the direction the avatar should face (derived from motion)
 * @property {boolean} on_ground
 * @property {boolean} in_water
 * @property {boolean} air_jumped TRUE for the one frame a mid-air DOUBLE-JUMP fired — the app's input-agnostic
 *   cue to spawn the bounce puff at the feet. Reflects the latest tick's steps; falsy again next tick.
 * @property {number} speed horizontal speed (m/s) — drives the app's anim blend
 * @property {string} anim the controller's suggested clip (UPPERCASE vocabulary): 'IDLE' | 'WALK' |
 *   'RUN' | 'JUMP' | 'JUMP_RUN' | 'FALL' | 'SWIM'. Stationary underwater is surfaced as IDLE;
 *   moving underwater remains SWIM so the avatar can prefer SWIM then fall back to WALK.
 * @property {number} gait_scale loco-clip cadence multiplier (actual speed ÷ clip-authored speed) —
 *   pass `dt × gait_scale` to avatar.update so feet never slide during accel ramps (the tactical
 *   board's D303 dt-scaling pattern, now on the roam path too). 1 for non-loco states.
 * @property {[number, number, number]} velocity
 */

/**
 * @typedef {object} CharacterController
 * @property {(input: CharacterInput) => void} set_input merge-updates the held input state
 * @property {(dt: number) => void} tick advance physics (fixed-step internally); call once per frame
 * @property {() => CharacterTransform} get_transform
 * @property {(position: [number, number, number], opts?: { eject?: boolean }) => void} teleport hard-place
 *   (velocity zeroed). Auto-ejects to the nearest air if the target buries the capsule (never leaves the
 *   camera inside geometry); pass `{ eject: false }` for creative-fly's per-frame move-through-solids.
 * @property {() => void} dispose
 */

/**
 * @param {object} opts
 * @param {(x: number, y: number, z: number) => number} opts.sample_block world block-id oracle —
 *   pass engine.sample_block for the live world (streamed OR fixed OR the webgl floor), or a cave
 *   room's own sampler (the D141 pattern). The controller never reaches into engine internals.
 * @param {[number, number, number]} opts.position spawn feet position (use find_open_spawn to get one)
 * @param {number} [opts.yaw] initial facing (radians)
 * @param {(() => ({ min_x: number, min_z: number, max_x: number, max_z: number } | null)) | undefined} [opts.get_bounds]
 *   [D204 — the walkable clamp only governed the camera, never the BODY, letting it cross the border]
 *   zone-box callback (pass () => engine.get_zone_bounds()). When armed, EVERY fixed step hard-clamps
 *   the body inside the fence on ALL states (walking, JUMP ARCS, falling): the crossing axis stops at
 *   the wall (velocity zeroed on that axis — slide, never cross). Doubles as the OOB RESCUE net: a
 *   body found far outside (pre-fix escapees) snaps back with a console.warn on the same path.
 * @returns {CharacterController}
 */
export function create_character_controller({ sample_block, position, yaw = 0, get_bounds = undefined }) {
  const env = make_block_env(sample_block)
  // STUCK-IN-BLOCK (BACKLOG): a spawn handed a buried feet-position (streamed-in terrain grew over the
  // constant, a restored/checkpoint spot inside geometry) is ejected to the nearest air BEFORE the body
  // exists — the camera never opens inside solid. Uses the controller's own solidity oracle (one home).
  const spawn = eject_from_solid(env.solid_at, [position[0], position[1], position[2]])
  const state = create_controller_state(spawn, yaw)
  // [D215 — the character read as jittery/shaking while running] fixed-step physics renders at
  // frame rate: the pose used to SNAP to the last completed 1/60 step (worst at run speed). The
  // controller now keeps the PREVIOUS step's pose and get_transform() interpolates by the
  // accumulator fraction — avatar, shoulder camera, and remote broadcast all read the same smooth
  // source (a camera reading raw while the avatar interpolates would re-create the shake).
  const prev = { position: [...state.position], visual_y: state.visual_y, facing_yaw: state.facing_yaw }
  /** held input, merged by set_input — sampled at each fixed step. */
  const input = { forward: 0, strafe: 0, jump: false, walk: false, speed_scale: 1, yaw }
  let acc = 0
  // The mid-air double-jump is a one-shot EVENT (not a lasting state): step_controller flags `_air_jump_fired`
  // on the firing step; tick() latches it here for the frame, and get_transform() surfaces it as `air_jumped`
  // so the app fires the feet puff exactly once. Set each tick (never left latched) — a get_transform read is
  // idempotent, so multiple same-frame readers (world_spawns/floor-net) all agree without racing a clear.
  let air_jump_event = false
  let disposed = false

  return {
    set_input(next) {
      if (disposed) return
      if (next.forward !== undefined) input.forward = next.forward
      if (next.strafe !== undefined) input.strafe = next.strafe
      if (next.jump !== undefined) input.jump = next.jump
      if (next.walk !== undefined) input.walk = next.walk
      if (next.speed_scale !== undefined) input.speed_scale = next.speed_scale
      if (next.yaw !== undefined) input.yaw = next.yaw
    },

    tick(dt) {
      if (disposed) return
      acc = Math.min(acc + Math.max(0, dt), FIXED_STEP * MAX_STEPS_PER_TICK)
      let air_jumped = false
      while (acc >= FIXED_STEP) {
        ;[prev.position[0], prev.position[1], prev.position[2]] = state.position
        prev.visual_y = state.visual_y
        prev.facing_yaw = state.facing_yaw
        step_controller(state, input, env, FIXED_STEP)
        if (state._air_jump_fired) air_jumped = true // latch the one-shot across this tick's fixed steps
        acc -= FIXED_STEP
      }
      air_jump_event = air_jumped
      // [D204] the fence is PHYSICAL for the body — every tick, all states, jump arcs included.
      const b = get_bounds?.()
      if (b) {
        const M = 0.35 // body half-width margin off the wall plane
        const cx = Math.min(b.max_x - M, Math.max(b.min_x + M, state.position[0]))
        const cz = Math.min(b.max_z - M, Math.max(b.min_z + M, state.position[2]))
        const dx = Math.abs(cx - state.position[0])
        const dz = Math.abs(cz - state.position[2])
        if (dx > 0 || dz > 0) {
          if (dx > 1 || dz > 1) {
            // far outside = an escapee (pre-fix jump-out, teleport bug) — the rescue net, loud.
            console.warn(
              `[voxel] OOB RESCUE (D204): body at [${state.position.map((v) => +v.toFixed(1)).join(', ')}] snapped inside the zone fence`
            )
          }
          state.position[0] = cx
          state.position[2] = cz
          // [D215] the correction is teleport-class: clamp the PREVIOUS pose too, so the render
          // interpolation never shows a frame outside the fence (no lerp across a rescue).
          prev.position[0] = Math.min(b.max_x - M, Math.max(b.min_x + M, prev.position[0]))
          prev.position[2] = Math.min(b.max_z - M, Math.max(b.min_z + M, prev.position[2]))
          if (dx > 0) state.velocity[0] = 0 // stop at the wall on that axis — slide, never cross
          if (dz > 0) state.velocity[2] = 0
        }
      }
    },

    get_transform() {
      // [D215] interpolate between the previous and current fixed steps by the accumulator fraction.
      const a = Math.min(1, acc / FIXED_STEP)
      const lerp = /** @param {number} p @param {number} c */ (p, c) => p + (c - p) * a
      // Reuse the core controller's horizontal speed and exact land locomotion threshold. Vertical
      // buoyancy/sinking is deliberately excluded: an idle swimmer always has some vertical velocity.
      const underwater_moving = state.in_water && state.speed > 0.5
      // wrap-aware yaw lerp (shortest arc) so a heading flip never spins the long way for a frame.
      let dyaw = state.facing_yaw - prev.facing_yaw
      if (dyaw > Math.PI) dyaw -= Math.PI * 2
      if (dyaw < -Math.PI) dyaw += Math.PI * 2
      return {
        position: /** @type {[number,number,number]} */ ([
          lerp(prev.position[0], state.position[0]),
          lerp(prev.position[1], state.position[1]),
          lerp(prev.position[2], state.position[2]),
        ]),
        visual_y: lerp(prev.visual_y, state.visual_y),
        facing_yaw: prev.facing_yaw + dyaw * a,
        on_ground: state.on_ground,
        in_water: state.in_water,
        air_jumped: air_jump_event,
        speed: state.speed,
        anim: state.in_water ? (underwater_moving ? 'SWIM' : 'IDLE') : state.anim,
        gait_scale: state.gait_scale ?? 1,
        velocity: /** @type {[number,number,number]} */ ([...state.velocity]),
      }
    },

    teleport(p, opts = {}) {
      if (disposed) return
      // STUCK-IN-BLOCK (BACKLOG): every ADOPTED position (join / rollback / snapshot / home / rescue)
      // is ejected to the nearest air so the body never lands inside geometry. The ONE opt-out is
      // creative-fly, whose per-frame teleport DELIBERATELY moves the body through solids ({eject:false}).
      const target = opts.eject === false ? p : eject_from_solid(env.solid_at, [p[0], p[1], p[2]])
      state.position = [target[0], target[1], target[2]]
      ;[, state.visual_y] = target
      state.velocity = [0, 0, 0]
    },

    dispose() {
      disposed = true
    },
  }
}
