// D280 — the FIGHT-START CEREMONY sword. Ported from the legacy dapp's spawn_crescent_sword
// (aresrpg-legacy/packages/dapp/src/core/utils/game/objects.js): a fight-marker GLB appears in the sky, grows,
// spins, and SLAMS down to PLANT at the mob pack's spot as the tx-wait beacon. The legacy motion is preserved
// beat-for-beat — grow from nothing (0.1 → 2.5) while high, a full spin with a slight random wobble, an
// expo-in plummet from ~10 m to the floor, blade flipped so the point drives in — but the GSAP timeline is
// re-expressed as a hand-rolled requestAnimationFrame tween (no GSAP dependency in this repo). The legacy
// shipped NO sound; per D280 a weighty impact lands at the plant — now the REFERENCE EXTRACTION's assets
// (added): a 2-frame ground-impact dust flipbook billboarded at the plant cell + a heavy earth-slam
// OGG (both extracted placeholders — replace-before-release; see the use sites below). Mounts through the SAME
// DRACO-wired loader + engine.add_to_scene the cave mob rigs use (cave_mobs.js) — the GLB is
// KHR_draco_mesh_compression-required.
//
// This module only knows how to fall, plant, and tear down. The lifecycle (when to plant / despawn /
// restore the pack) is the dimension's brain (dungeon_dimension.engage); the host that owns the engine + the
// pack anchor is cave_session — it drives this over the shared events bus.

import { Box3 } from 'three'

import { get_glb_loader } from '@aresrpg/engine3/player'
import { create_vfx_preset, PRESETS } from '@aresrpg/engine3/vfx'

import { play_sfx } from './core/audio/sfx.js'
import { prewarm_fight_vfx } from './fight_cast_vfx.js'
import { game_log } from '../core/log.js'

const SWORD_URL = '/sprites/misc/fight_sword.glb'
// The herald-slam dust kick: the 3D GPU-particle EARTH ERUPTION preset (eruption_earth — a gold-loam ground
// pillar), the same 3D burst the combat earth strike plays. A gold slam at the plant cell reads as a heraldic
// power-strike. This replaced the last surviving sprite sheet (the law: ZERO legacy sheets on ANY fight
// surface) — the herald is a fight surface, so it uses the pack VFX like every other beat. The preset's own
// emitters carry the build-up→dissipation (no code-side scale/fade ramp).
const SLAM_SCALE = 2 // world-size multiplier of the eruption (a big heraldic slam)
// Ported constants (legacy objects.js): drop from anchor+10 m, grow 0.1 → 2.5, blade flipped (rot.x = π) so
// the point drives into the floor. The plant depth is no longer a magic number — it's derived from the GLB's
// own bounds at load (plant_y below) so exactly half the sword's height stands above the ground line.
const DROP_H = 10
const START_SCALE = 0.1
const PLANT_SCALE = 2.5
const APPEAR_S = 0.5 // grow-in while still high (legacy timeline step 1)
const FALL_END_S = 2.0 // the expo-in slam finishes (legacy step 2, ~1.5 s drop after the grow)

const ease_out_quad = (/** @type {number} */ t) => 1 - (1 - t) * (1 - t)
const ease_in_expo = (/** @type {number} */ t) => (t <= 0 ? 0 : Math.pow(2, 10 * (t - 1)))

/**
 * Plant a fight-start sword at `anchor` (the mob pack centroid, world feet). It appears in the sky, slams down
 * with an impact, then stands planted as the beacon until disposed.
 * @param {{ engine: any, anchor: ArrayLike<number> }} args
 * @returns {{ dispose: () => void }}
 */
export function plant_fight_sword({ engine, anchor }) {
  const ax = Number(anchor[0])
  const ay = Number(anchor[1])
  const az = Number(anchor[2])
  let disposed = false
  let raf = 0
  /** @type {any} */ let root = null
  /** @type {any} */ let burst = null // the one-shot 3D earth-eruption preset handle (impact only)
  let burst_t0 = 0
  let impacted = false
  let plant_y = 0 // terminal Y offset from the ground line `ay`, derived from the GLB's bounds at load
  const t0 = performance.now()

  // SWORD-IMPACT FREEZE FIX: impact() mounts the `eruption_earth` GPU preset for the
  // FIRST time at the plant (~2 s after this spawns), eating its ~290 ms first-draw WebGPU pipeline compile
  // right on the impact frame — the freeze. The fight-board prewarm (voxel_fight_adapter) can't cover it:
  // the sword plants at the mob-pack CLICK, while that prewarm only fires when the board builds (after the
  // tx confirms — typically AFTER this impact). So warm the sword's own preset HERE, at plant time: the ~2 s
  // fall is ample cover for the compile, and the throwaway tears down long before impact. `earth`'s BURST
  // preset IS eruption_earth (vfx_map BURST_VFX), so prewarm_fight_vfx(['earth']) compiles exactly it.
  const cancel_prewarm = prewarm_fight_vfx(engine, ['earth'])

  const drop_burst = () => {
    if (!burst) return
    try {
      engine.remove_from_scene(burst.object3d)
    } catch {
      /* already gone */
    }
    burst.dispose()
    burst = null
  }

  const impact = () => {
    // The heavy earth-slam OGG (sfx.js SOURCES 'sword_plant') — a kept legacy SOUND,
    // replacing the old synthesized 'hit' thunk.
    play_sfx('sword_plant')
    // The dust kick: the 3D earth-eruption preset at the plant cell (feet), erupting UP from the ground line. Its
    // SpriteNodeMaterial billboards in-shader (no per-frame quaternion copy); age is driven in frame().
    burst = create_vfx_preset(PRESETS.eruption_earth, { position: [ax, ay, az], scale: SLAM_SCALE })
    burst_t0 = performance.now()
    try {
      engine.add_to_scene(burst.object3d)
    } catch {
      /* pre-boot no-op */
    }
  }

  const frame = (/** @type {number} */ now) => {
    raf = requestAnimationFrame(frame)
    // dust burst: the 3D earth-eruption preset played one-shot across its own duration, then dropped. The preset's
    // emitters carry their own build-up→dissipation (no code-side scale/opacity ramp — the preset-owns-it law).
    if (burst) {
      const bt = (now - burst_t0) / 1000
      burst.age.value = bt
      if (bt >= burst.duration) drop_burst()
    }
    // terminal freeze: the planted pose is written exactly once at impact and never touched again, so once the
    // dust flipbook has finished there is zero per-frame work — cancel the loop entirely (a planted sword is static).
    if (impacted && !burst) {
      cancelAnimationFrame(raf)
      raf = 0
      return
    }
    if (!root) return
    const t = (now - t0) / 1000
    // grow-in (legacy step 1): 0.1 → 2.5 over APPEAR_S, easeOut — finishes before the drop starts
    const grow = Math.min(1, t / APPEAR_S)
    const scale = START_SCALE + (PLANT_SCALE - START_SCALE) * ease_out_quad(grow)
    if (t < FALL_END_S) {
      // slam down (step 2): anchor+10 → the derived plant depth, expo.in; one spin with a slight wobble (step 3)
      const fk = Math.max(0, (t - APPEAR_S) / (FALL_END_S - APPEAR_S))
      const drop = Math.min(1, ease_in_expo(fk))
      root.position.set(ax, ay + DROP_H + (plant_y - DROP_H) * drop, az)
      root.rotation.y = fk * Math.PI * 2
      root.rotation.x = Math.PI + (Math.random() * 0.02 - 0.01)
      root.rotation.z += Math.random() * 0.02 - 0.01
      root.scale.setScalar(scale)
    } else if (!impacted) {
      // impact: write the terminal planted pose exactly ONCE — half-buried at the derived depth, wobble killed.
      // Nothing touches the sword after this; the loop lives on only long enough to finish the dust flipbook.
      impacted = true
      root.position.set(ax, ay + plant_y, az)
      root.rotation.set(Math.PI, root.rotation.y, 0) // settle upright-planted, kill the wobble
      root.scale.setScalar(PLANT_SCALE)
      impact()
    }
  }

  get_glb_loader()
    .loadAsync(SWORD_URL)
    .then((/** @type {any} */ gltf) => {
      if (disposed) return
      root = gltf.scene
      root.rotation.x = Math.PI // blade points down to plant
      root.traverse((/** @type {any} */ o) => {
        if (o.isMesh) o.castShadow = true
      })
      // Derive the plant depth from the model's own bounds so exactly HALF the sword's total height stands
      // above the ground line (blade half-buried, hilt + upper blade visible) — bbox-aware, not a magic sink.
      // Measure the Box3 in the planted orientation (rot.x = π) at PLANT_SCALE with the root at origin, then
      // offset so the box centre sits on `ay`: plant_y = −centre_y ⇒ half the height above, half below.
      root.scale.setScalar(PLANT_SCALE)
      root.position.set(0, 0, 0)
      root.updateMatrixWorld(true)
      const box = new Box3().setFromObject(root)
      plant_y = -(box.max.y + box.min.y) / 2
      // start high + tiny for the grow-in slam
      root.position.set(ax, ay + DROP_H, az)
      root.scale.setScalar(START_SCALE)
      engine.add_to_scene(root)
    })
    .catch((/** @type {any} */ e) => game_log('fight-sword', 'GLB load failed:', e))

  raf = requestAnimationFrame(frame)

  return {
    dispose() {
      disposed = true
      cancel_prewarm() // drop the throwaway prewarm handle if we tear down mid-fall (compile already banked)
      cancelAnimationFrame(raf)
      drop_burst() // frees the burst mesh's geo+material; the shared slam TEXTURE stays session-cached
      if (root) {
        try {
          engine.remove_from_scene(root)
        } catch {
          /* already gone */
        }
        root.traverse((/** @type {any} */ o) => {
          o.geometry?.dispose?.()
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) m?.dispose?.()
        })
        root = null
      }
    },
  }
}
