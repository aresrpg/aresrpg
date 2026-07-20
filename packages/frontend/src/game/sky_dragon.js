// TR-97 — the SKY DRAGON: a scripted ambient dragon soaring a slow, high, banking circle across the demo
// sky, for the trailer. Spawnable via `?dragon=1` (variant via `?dragon=frost|fire|void`) for capturing it;
// absent by default (zero cost when the flag is off — the module never imports). Client-only, zero
// chain / zero p2p — pure decoration, like the ambient mob packs.
//
// PATTERN PROVENANCE (ported, not reinvented): the GLB load (module-cached `loadAsync` → SkeletonUtils
// clone → apply_avatar_material → mixer) + REMOVE-ONLY teardown are lifted VERBATIM from ambient_mobs.js;
// the dragon GLBs are the SAME rig-fixed models the ambient/cave packs already fly (post-#94 FK fix). Own
// rAF, like ambient_mobs/remote_players — dispose() cancels it and detaches the rig (never a GPU free).
//
// FLIGHT: a pivot group carries position + heading (yaw = atan2(velocity)); the dragon child carries a
// constant BANK roll into the turn + a slow altitude bob, so the soar reads as a living glide, not a turntable.

import { AnimationMixer, Box3, Group, Vector3 } from 'three'
import { clone as clone_skinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

import { apply_avatar_material, get_glb_loader } from '@aresrpg/engine3/player'
import { walrus_asset_url } from '@aresrpg/sdk/jobs'
import { game_log } from '../core/log.js'

const VARIANTS = /** @type {Record<string, string>} */ ({
  void: '/sprites/mobs/models/dragon-void.glb',
  frost: '/sprites/mobs/models/dragon-frost.glb',
  fire: '/sprites/mobs/models/dragon-fire.glb',
})
const TARGET_SPAN = 12 // world blocks — the dragon's longest dimension after normalisation (big, cinematic)
const RADIUS = 140 // circle radius (blocks) around the spawn — sweeps the whole sky above the zone
const ALTITUDE = 112 // metres ABOVE the circle centre — peaks sit ≈195 m, so this clears them for a sky vista
const OMEGA = (2 * Math.PI) / 44 // rad/s — one full circle in ~44 s (slow, majestic)
const BANK = 0.32 // rad — constant roll into the turn (inner wing low)
const NOSE_PITCH = -0.06 // rad — a hair nose-down glide
const BOB_AMP = 3.5 // m — gentle altitude breathing
const BOB_RATE = 0.35 // Hz-ish — the bob frequency

/**
 * Spawn the soaring sky dragon. Async-fills (the flight math runs immediately; the rig joins the scene when
 * the GLB resolves). `center` = the world spawn (the circle centre, XZ) + the altitude anchor (Y).
 * @param {{ engine: any, center: [number, number, number], variant?: string }} args
 * @returns {{ dispose: () => void }}
 */
export function create_sky_dragon({ engine, center, variant }) {
  const key = String(
    variant ?? new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('dragon') ?? ''
  ).toLowerCase()
  const local = VARIANTS[key] ?? VARIANTS.void
  // Walrus-first (the dragon GLBs live in the `mob` quilt), bundled /sprites fallback — progressive migration.
  const url = walrus_asset_url('mob', local.split('/').pop() ?? '') ?? local
  const [cx, cyBase, cz] = center
  const cy = cyBase + ALTITUDE

  const pivot = new Group() // position + heading
  pivot.name = 'sky_dragon'
  const banker = new Group() // the constant bank roll + nose pitch (kept off the heading so it reads clean)
  banker.rotation.z = BANK
  banker.rotation.x = NOSE_PITCH
  pivot.add(banker)

  /** @type {AnimationMixer | null} */ let mixer = null
  let disposed = false
  let raf = 0
  let last_t = performance.now()
  let theta = 0

  get_glb_loader()
    .loadAsync(url)
    .then((gltf) => {
      if (disposed) return
      const root = clone_skinned(gltf.scene)
      const bbox = new Box3().setFromObject(root)
      const size = new Vector3()
      bbox.getSize(size)
      const longest = Math.max(size.x, size.y, size.z) || 1
      root.scale.setScalar(TARGET_SPAN / longest)
      root.traverse((/** @type {any} */ o) => {
        if (o.isMesh) o.castShadow = true
      })
      apply_avatar_material(root)
      mixer = new AnimationMixer(root)
      const clips = gltf.animations ?? []
      // prefer a wing/fly/flap clip; else the first clip; play it looping so the wings beat as it soars.
      const fly = clips.find((/** @type {any} */ c) => /fly|flap|wing|move|run/i.test(c.name)) ?? clips[0]
      if (fly) mixer.clipAction(fly).play()
      banker.add(root)
      engine.add_to_scene(pivot)
      game_log('sky-dragon', `soaring (${key || 'void'}) — ${clips.length} clip(s)`) // loud-pipeline law
    })
    .catch((error) => game_log('sky-dragon', 'GLB load failed:', error))

  const frame = (/** @type {number} */ now) => {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.1, (now - last_t) / 1000)
    last_t = now
    theta += OMEGA * dt
    const x = cx + RADIUS * Math.cos(theta)
    const z = cz + RADIUS * Math.sin(theta)
    const y = cy + BOB_AMP * Math.sin((now / 1000) * (2 * Math.PI * BOB_RATE))
    pivot.position.set(x, y, z)
    // heading = the tangent of the circle (velocity ∝ (−sinθ, cosθ)); yaw = atan2(vx, vz), the mob-rig facing
    // convention (atan2(dx, dz)). Constant ω ⇒ a smooth, always-forward soar.
    pivot.rotation.y = Math.atan2(-Math.sin(theta), Math.cos(theta))
    if (mixer) mixer.update(dt)
  }
  raf = requestAnimationFrame(frame)

  return {
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      try {
        engine.remove_from_scene(pivot)
      } catch {
        /* already gone */
      }
      mixer?.stopAllAction()
      // REMOVE-ONLY — the loader cache owns the GLB's GPU resources (shared with the ambient/cave dragon rigs).
    },
  }
}
