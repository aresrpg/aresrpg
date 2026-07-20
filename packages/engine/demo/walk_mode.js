// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Walk-mode driver for the demo (ENG-8) — the toggle-able character-controller experience that lives
// ALONGSIDE the fly camera in main.js. It owns the wiring of the four ENG-8 subsystems against the
// frozen engine facade: movement input → controller (physics + anim state) → shoulder camera rig →
// avatar (GLB anim), pushing the resulting camera pose through engine.set_camera_position /
// set_camera_orientation / set_camera_fov each frame. Kept out of main.js so main.js's diff stays
// surgical and every file stays under the LoC law.
//
// The controller/collision query the world through engine.sample_block (the resident chunk store),
// wrapped into solid_at/liquid_at by make_block_env (the block-class SSOT). Spawn drops the player
// onto the terrain surface at the demo's default XZ.

import { create_controller_state, step_controller } from '../src/player/controller.js'
import { create_shoulder_camera } from '../src/player/camera_rig.js'
import { create_character_avatar } from '../src/player/character_avatar.js'
import { make_block_env } from '../src/player/block_solidity.js'
import { find_open_spawn } from '../src/player/spawn.js'

import { create_movement_input } from './movement_input.js'

// ENG-24 (2026-07-05): the spawn column scan (find_open_spawn / ground_surface_y / GROUND_IDS /
// SPAWN_HEADROOM) moved VERBATIM to src/player/spawn.js — the public one-home surface the dapp also
// consumes (D160). The demo re-exports find_open_spawn for its existing consumers.
export { find_open_spawn } from '../src/player/spawn.js'

/**
 * @typedef {object} WalkMode
 * @property {(dt: number) => void} tick advances the controller + camera + avatar one frame and pushes
 *   the pose onto the engine. Call from the demo rAF loop while walk mode is active.
 * @property {() => void} enable attaches input + camera listeners, adds the avatar, grounds the player.
 * @property {() => void} disable detaches listeners + removes the avatar (fly mode resumes).
 * @property {() => { anim: string, speed: number, on_ground: boolean, in_water: boolean, pos: [number,number,number] }}
 *   get_state a HUD readout of the current player state.
 * @property {() => void} dispose
 */

/**
 * @param {object} opts
 * @param {import('../src/engine.js').EngineApi} opts.engine the live engine facade.
 * @param {HTMLElement} opts.canvas the render canvas (input target + pointer-lock element).
 * @param {[number, number, number]} opts.spawn_xz_y [x, y_scan_start, z] — walk spawn; y is the height
 *   to start the ground scan from (drop to the surface below it).
 * @param {(x: number, y: number, z: number) => number} [opts.sample_block] world-voxel block-id oracle
 *   the controller/collision read (default engine.sample_block = the streamed ring). D141 CAVE ROOM
 *   passes the room's OWN sample_block so the player collides with the standalone cave (which the ring's
 *   store never sees). Everything else (spawn scan, controller, camera) is unchanged.
 * @returns {WalkMode}
 */
export function create_walk_mode({
  engine,
  canvas,
  spawn_xz_y,
  sample_block = (x, y, z) => engine.sample_block(x, y, z),
  exact_spawn = false,
}) {
  const env = make_block_env(sample_block)
  const input = create_movement_input()
  const camera = create_shoulder_camera({ yaw: Math.PI / 4 })
  const avatar = create_character_avatar()

  const state = create_controller_state([spawn_xz_y[0], spawn_xz_y[1], spawn_xz_y[2]], Math.PI / 4)
  let active = false
  let grounded_once = false

  /** Place the player on OPEN ground the moment enough chunks are resident. Uses find_open_spawn so
   *  they never spawn embedded in a tree canopy (the demo's default XZ sits under forest) — it relocates
   *  to the nearest column with clear headroom above the surface. No-op until the area streams in. */
  function try_ground() {
    if (grounded_once) return
    // [D213 root — the cave spawned its player ON THE ROOF]: the sky-reachable spawn scan
    // (find_open_spawn, D192 first-solid-decides) treats a cave's stone ROOF as valid open ground.
    // ENCLOSED scenes pass exact_spawn: their generator's own guaranteed-clear spawn is used verbatim
    // (no scan); open-world consumers keep the canopy-safe scan.
    const spawn = exact_spawn
      ? /** @type {[number, number, number]} */ ([spawn_xz_y[0], spawn_xz_y[1], spawn_xz_y[2]])
      : find_open_spawn(sample_block, Math.floor(spawn_xz_y[0]), Math.floor(spawn_xz_y[2]))
    if (!spawn) return // area not resident yet — retry next tick
    state.position = [spawn[0], spawn[1], spawn[2]]
    ;[, state.visual_y] = spawn
    state.velocity = [0, 0, 0]
    state.on_ground = true
    grounded_once = true
  }

  return {
    tick(dt) {
      if (!active) return
      try_ground()
      const axis = input.get_axis()
      step_controller(
        state,
        {
          forward: axis.forward,
          strafe: axis.strafe,
          jump: axis.jump,
          walk: axis.walk,
          yaw: camera.get_yaw(),
        },
        env,
        dt
      )
      // avatar rides the smoothed visual_y (auto-step easing) at the feet; controller owns facing.
      avatar.object3d.position.set(state.position[0], state.visual_y, state.position[2])
      avatar.update(state.anim, state.facing_yaw, dt)

      const pose = camera.update({
        feet: [state.position[0], state.visual_y, state.position[2]],
        eye_height: avatar.eye_height,
        speed: state.speed,
        solid_at: env.solid_at,
        dt,
      })
      // hide the avatar when the camera dollies very close (would clip through the head)
      avatar.object3d.visible = pose.distance > 1.0

      engine.set_camera_position(pose.position)
      engine.set_camera_orientation(pose.yaw, pose.pitch)
      engine.set_camera_fov(pose.fov)
      // [ENG camera-feel] thread ground speed to the post stack's motion-blur run-speed trigger — the
      // same value just used for the shoulder rig's speed-FOV above.
      engine.set_camera_speed?.(state.speed)
    },

    enable() {
      if (active) return
      active = true
      grounded_once = false
      input.attach(canvas)
      camera.attach(canvas)
      engine.add_to_scene(avatar.object3d)
      // BENCH HOOK (§7, same spirit as window.__engine): expose the walk subsystem so the ENG-8
      // acceptance spec can drive the camera 180° turn (pointer lock is blocked under automation),
      // teleport the player to test terrain (lake/forest/wall), and read the live controller state.
      if (typeof window !== 'undefined') {
        ;/** @type {any} */ (window).__walk = {
          camera,
          avatar,
          state,
          set_position: (/** @type {[number,number,number]} */ p) => {
            // Intentional teleport (bench): place the player exactly here and DON'T re-run spawn
            // relocation (grounded_once stays true), or try_ground would yank them back to open
            // ground the next tick — which broke the swim test (teleport into water → pulled out).
            state.position = [p[0], p[1], p[2]]
            ;[, state.visual_y] = p
            state.velocity = [0, 0, 0]
            grounded_once = true
          },
          get_state: () => ({ ...state }),
        }
      }
    },

    disable() {
      if (!active) return
      active = false
      input.detach()
      camera.detach()
      engine.remove_from_scene(avatar.object3d)
    },

    get_state() {
      return {
        anim: state.anim,
        speed: state.speed,
        on_ground: state.on_ground,
        in_water: state.in_water,
        pos: /** @type {[number,number,number]} */ ([
          Math.round(state.position[0]),
          Math.round(state.position[1]),
          Math.round(state.position[2]),
        ]),
      }
    },

    dispose() {
      this.disable()
      avatar.dispose()
      camera.dispose()
      input.detach()
    },
  }
}
