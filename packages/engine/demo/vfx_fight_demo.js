// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLAGSHIP VFX — IN-ENGINE AgX CAPTURE (?preset=<name>). Plays a fight-VFX preset through the REAL engine
// render path (create_engine → renderer.js AgX tone-map + grade + bloom post stack), on a FLAT board floating
// in open sky (the team_demo idiom — the same substrate every dungeon fight uses). This is the honest proof
// the presets survive AgX: the standalone probe (vfx_presets_probe.html) renders on a BARE renderer with no
// tone-map, so only THIS surface proves the NORMAL-blend bright-glow choice (board_vfx/title_aura law) reads
// through the crush. The burst LOOPS (re-fires when its duration elapses) so a screenshot always lands on a
// live frame. Exposes window.__engine + window.__vfx_ready.

import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three'

import { create_engine } from '../src/engine.js'
import { create_tactical_board } from '../src/tactical/index.js'
import { create_vfx_preset } from '../src/render/vfx_preset_engine.js'
import { PRESETS } from '../src/render/vfx_presets_data.js'

/**
 * Boot the in-engine VFX capture. @param {HTMLCanvasElement} canvas @param {HTMLDivElement} gate
 * @param {URLSearchParams} params `preset` (name), `scale` (size mult), `tod` (time-of-day)
 */
export async function boot_vfx_fight_demo(canvas, gate, params) {
  const name = params.get('preset') || 'ground_explosion_01'
  const scale = Number(params.get('scale') || 1.5)
  // POST-AgX OVERLAY proof knobs: ?overlay=1 routes the preset to the display-space additive overlay (the fix);
  // omitted = the shipped AgX'd main-pass path (the washed-out BEFORE). ?occluder=1 drops an opaque bar in FRONT of
  // the lower half of the VFX (main scene, layer 0 ⇒ in scene_depth) to prove the overlay's depth occlusion.
  const overlay = params.get('overlay') === '1'
  const occluder = params.get('occluder') === '1'
  if (!PRESETS[name]) {
    gate.dataset.hidden = 'false'
    gate.textContent = `Unknown preset: ${name}`
    return
  }

  gate.dataset.hidden = 'false'
  gate.textContent = 'Booting VFX capture…'

  const engine = create_engine({ canvas, tier: 'high' })
  const w = /** @type {any} */ (window)
  w.__engine = engine
  engine.on('boot_error', (error) => {
    gate.dataset.hidden = 'false'
    gate.textContent = `Engine not ready: ${/** @type {Error} */ (error)?.message ?? error}`
  })
  engine.start()
  engine.set_time_of_day(Number(params.get('tod') || 0.3)) // late-morning key light so the burst reads on the sky

  // A FLAT board in open sky (no terrain to occlude the burst) — the real dungeon-fight substrate (flat:true).
  const ORIGIN = { x: 40, y: 220, z: 40 }
  const board = create_tactical_board({ engine, canvas, default_origin: ORIGIN })
  engine.set_camera_position([ORIGIN.x + 4, ORIGIN.y + 12, ORIGIN.z + 22])
  engine.set_camera_orientation(Math.PI, -0.5)
  await board.build({ grid_w: 6, grid_h: 6, obstacles: [], holes: [], flat: true, anchor: { origin: ORIGIN } })
  board.camera_lock()
  gate.dataset.hidden = 'true'

  // OCCLUDER (occlusion proof): a solid horizontal bar between the camera and the VFX, covering the LOWER half of the
  // effect. It lives in the main scene (layer 0) so it writes scene_depth; the overlay composite must therefore hide
  // the VFX light BEHIND it (the glow gets cut along the bar's top edge) while the upper glow reads over the sky.
  if (occluder) {
    const wall = new Mesh(new BoxGeometry(7, 2.4, 1), new MeshStandardMaterial({ color: 0x555b66 }))
    // NEARER than the VFX (z+8 vs the effect's z+4) and centred on it (same x as the camera+effect), covering the
    // LOWER half — the flame tips poke above the wall's top edge, the base is occluded ⇒ a clean depth-occlusion read.
    wall.position.set(ORIGIN.x + 4, ORIGIN.y + 0.8, ORIGIN.z + 8)
    engine.add_to_scene(wall)
  }

  // Play the preset at the board centre, ground-anchored (feet). LOOP it so a capture always finds a live frame.
  const at = /** @type {[number,number,number]} */ ([ORIGIN.x + 4, ORIGIN.y + 0.5, ORIGIN.z + 4])
  /** @type {ReturnType<typeof create_vfx_preset> | null} */
  let handle = null
  const fire = () => {
    if (handle) {
      engine.remove_from_scene(handle.object3d)
      handle.dispose()
    }
    handle = create_vfx_preset(PRESETS[name], { position: at, scale, overlay })
    engine.add_to_scene(handle.object3d)
  }
  fire()

  let last = performance.now()
  const loop = (/** @type {number} */ now) => {
    const dt = (now - last) / 1000
    last = now
    if (handle && !handle.update(dt)) fire() // re-fire when the burst finishes (looping capture surface)
    w.__vfx_ready = true
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') fire()
  })
}
