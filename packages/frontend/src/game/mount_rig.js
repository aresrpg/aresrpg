// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// TR-97 — the MOUNT rig: the ridden creature GLB beneath a player. ONE home for loading + posing + tearing
// down a mount model, used by BOTH the local rider (embed_voxel.js) and remote riders (remote_players.js).
//
// GLB DISCIPLINE (the 2026-07-07 shared-dispose FREEZE law — the same rule ambient_mobs.js documents): each
// rig is a SkeletonUtils.clone of a MODULE-CACHED GLB (fetch+parse ONCE per URL). Teardown DETACHES from the
// scene and stops the mixer but NEVER disposes geometry/material/texture — clones SHARE those by reference,
// and disposing one frees a GPUBuffer a sibling/future clone still submits over → WebGPU "Buffer used in
// submit while destroyed" → the whole world FREEZES. The cache OWNS the GPU resources for the page session; a
// clone only borrows them, so a rig teardown is a scene-detach, never a GPU free.

import { AnimationMixer, Box3 } from 'three'
import { clone as clone_skinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

import { apply_avatar_material, load_glb_checked } from '@aresrpg/engine3/player'

import { mount_is_flight, mount_model_yaw, mount_target_height, pick_mount_clips } from './cosmetic_glb.js'
import { create_mount_glb_cache } from './mount_glb_cache.js'
import { game_log } from '../core/log.js'
import { canonical_model_source_url, model_asset_url } from './model_asset_url.js'

const SEAT_LIFT = 0.8 // fraction of the mount's height the rider sits at (bbox top of the back ≈ ×0.8)
const BLEND_RATE = 8 // idle↔move weight ease (per-second lambda)

/** Fetch+parse each unique mount GLB once; failed work is evicted, resolved render data stays page-cached. */
const glb_cache = create_mount_glb_cache((/** @type {string} */ url) => load_glb_checked(url))


/** The mount GLB refusal rule (non-CDN URLs rejected) — ONE home, shared by create_mount_rig and the
 *  #175 preload below so a preload always warms the EXACT cache key the real mount will ask for.
 *  @param {string} glb_url @returns {string | null} */
const resolve_source_url = (glb_url) =>
  canonical_model_source_url(glb_url, { allow_dev_models: true })

/** Which dragon skin the fast-travel dragon rides — fire by default; `?ftdragon=frost|void` previews the
 *  others in DEV. ONE home so the mount AND the #175 preload below always resolve the identical URL. */
export function ft_dragon_glb_url() {
  const pick = (import.meta.env.DEV && new URLSearchParams(location.search).get('ftdragon')) || 'dragon-fire'
  const file = ['dragon-fire', 'dragon-frost', 'dragon-void'].includes(pick) ? `${pick}.glb` : 'dragon-fire.glb'
  return model_asset_url('mob', file)
}

/** PRELOAD-ON-INTENT: fetch+parse the SAME canonical key spawn will consume, and resolve only once that render
 *  data is in the warm cache. Failure stays retryable (the cache evicts it) and resolves false so the travel
 *  effect can refuse before entering flight. @param {string} glb_url @returns {Promise<boolean>} */
export function preload_mount_glb(glb_url) {
  const source_url = resolve_source_url(glb_url)
  if (!source_url) return Promise.resolve(false)
  return glb_cache
    .preload(source_url)
    .then(() => true)
    .catch((error) => {
      game_log('mount', `GLB preload failed (${source_url}):`, error)
      return false
    })
}

/**
 * Create a mount rig for `glb_url`. Fills in ASYNC — `update()`/`seat_height` no-op / read 0 until the GLB
 * resolves, so the caller can create it and pose every frame immediately. The returned handle owns the scene
 * membership; `dispose()` detaches it (never a GPU free — see the module header).
 * @param {{ engine: any, glb_url: string }} args the live engine facade + the mount model URL.
 * @returns {{ readonly ready: boolean, readonly seat_height: number,
 *   update: (x: number, gy: number, z: number, yaw: number, moving: boolean, dt: number) => void,
 *   set_visible: (v: boolean) => void, dispose: () => void }}
 */
export function create_mount_rig({ engine, glb_url }) {
  /** @type {{ root: any, mixer: AnimationMixer, idle: any, move: any, h: number, ground_off: number,
   *   tops: { o: any, y: number }[], move_w: number } | null} */
  let rig = null
  let disposed = false
  let want_visible = true
  const source_url = resolve_source_url(glb_url)

  const load = source_url
    ? glb_cache.for_spawn(source_url, { warm_only: mount_is_flight(source_url) })
    : Promise.reject(new Error('refused non-CDN mount asset URL'))
  load
    .then((/** @type {any} */ gltf) => {
      if (disposed) return
      const root = clone_skinned(gltf.scene)
      // WORLD-SIZE normalisation (ambient_mobs' law, PER-MOUNT target — cosmetic_glb MOUNT_TABLE): scale the
      // rig so its bind bbox height = target_h, independent of the model's authored units. SKINNED-AWARE
      // measure (the siluri ×10 root cause): Box3.setFromObject reads a SkinnedMesh's bounds through its
      // bones' matrixWorld, which are STALE on a fresh clone — siluri's Armature carries a 0.128 bind scale,
      // so the stale measure said h=0.094 while the GPU skinned the true ~0.73 rig (a cow-sized fish repro).
      // updateMatrixWorld(true) first (bones current), then force each skinned mesh's bbox recompute.
      root.updateMatrixWorld(true)
      root.traverse((/** @type {any} */ o) => {
        if (o.isSkinnedMesh) o.computeBoundingBox()
      })
      const bbox = new Box3().setFromObject(root)
      const model_h = bbox.max.y - bbox.min.y || 1
      const target_h = mount_target_height(source_url)
      const s = target_h / model_h
      root.scale.setScalar(s)
      // GROUND the model (the character_avatar feet-at-origin law the old rig skipped): the bind bbox floor
      // sits AT the caller's ground y, so a model authored above/below its origin never floats or sinks.
      const ground_off = -bbox.min.y * s
      root.traverse((/** @type {any} */ o) => {
        if (o.isMesh) o.castShadow = true
      })
      apply_avatar_material(root) // kill the raw golden PBR — the avatar-home fix every live rig uses
      root.visible = want_visible
      const mixer = new AnimationMixer(root)
      const clips = gltf.animations ?? []
      // GROUND clips before FLY for a walking mount: a bird's fly loop carries baked altitude — never pick
      // it while a walk/run exists. (corbac ships idle+walk only, but its "walk" IS a hover — the root-Y pin
      // below is the guarantee either way.) A FLIGHT mount (cosmetic_glb's mount_is_flight — the fast-travel
      // dragons, airborne for their rig's whole life) inverts that: its fly loop is the ride.
      // pick_mount_clips is the pure, unit-tested naming convention (#175).
      const { idle: idle_clip, move: move_clip } = pick_mount_clips(clips, { flight: mount_is_flight(source_url) })
      const idle = idle_clip ? mixer.clipAction(idle_clip) : null
      const move = move_clip ? mixer.clipAction(move_clip) : null
      idle?.play()
      if (move) {
        move.play()
        move.weight = 0
      }
      // ROOT-Y PIN (the "mount snaps ~2 blocks up while moving" root cause): clips may bake root Y
      // translation — corbac's walk keys its SKELETON ROOT BONE y∈[0.823,0.931] vs bind −0.266 ≈ +2 world
      // blocks of hover (the carrier is the root bone `md_crow_pet_1`, NOT the scene-top node — the GLB
      // ships two nodes named md_crow_pet and the loader dedupes). Record the BIND y of every top-level
      // node AND every skeleton-root bone (a bone whose parent is not a bone); update() re-pins them after
      // every mixer tick, so vertical comes ONLY from the walking controller. Child-bone motion (wing flap,
      // head bob, leg strides) is untouched.
      /** @type {{ o: any, y: number }[]} */
      const tops = root.children.map((/** @type {any} */ o) => ({ o, y: o.position.y }))
      root.traverse((/** @type {any} */ o) => {
        if (o.isBone && !o.parent?.isBone) tops.push({ o, y: o.position.y })
      })
      rig = { root, mixer, idle, move, h: target_h, ground_off, tops, move_w: 0 }
      engine.add_to_scene(root)
    })
    .catch((/** @type {any} */ error) => game_log('mount', `GLB load failed (${source_url ?? 'rejected'}):`, error))

  return {
    /** The rig is loaded + in-scene. */
    get ready() {
      return !!rig
    },
    /** The y-lift (world m) to seat a rider on the mount's back — 0 until the GLB resolves. */
    get seat_height() {
      return rig ? rig.h * SEAT_LIFT : 0
    },
    /** Pose the mount at feet (x, gy, z), facing `yaw`; `moving` blends idle↔walk. */
    update(x, gy, z, yaw, moving, dt) {
      if (!rig) return
      rig.root.position.set(x, gy + rig.ground_off, z)
      rig.root.rotation.y = mount_model_yaw(source_url, yaw)
      if (rig.move) {
        rig.move_w += ((moving ? 1 : 0) - rig.move_w) * Math.min(1, dt * BLEND_RATE)
        rig.move.weight = rig.move_w
        if (rig.idle) rig.idle.weight = 1 - rig.move_w
      }
      rig.mixer.update(dt)
      // root-Y pin — the mount NEVER changes height because a clip says so (see the load block).
      for (const t of rig.tops) t.o.position.y = t.y
    },
    /** Show / hide the mount (fights hide it with the walk avatar) without a dispose/reload. */
    set_visible(v) {
      want_visible = !!v
      if (rig) rig.root.visible = want_visible
    },
    dispose() {
      disposed = true
      if (rig) {
        try {
          engine.remove_from_scene(rig.root)
        } catch {
          /* already gone */
        }
        rig.mixer.stopAllAction()
      }
      rig = null // REMOVE-ONLY — the cache owns the GPU resources (never dispose a shared clone)
    },
  }
}
