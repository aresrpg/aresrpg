// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PET COMPANION — never built until now: `/v1` characters carry `pet`/`pet_equipped`
// (packages/rpc/api/views.js's `character_pet_projection`) all the way through boot_roster.js's
// `rpc_to_card` ("the later world lane decides how that pet becomes a companion or mount prompt"), but
// nothing downstream ever read those fields for a render. SPEC §10 pets: "All pets are mountable" is a
// SEPARATE, not-yet-wired toggle (mount_speed_multiplier/resolve_mount read `character.mount`, a
// different slot than `character.pet` — out of scope here); the only LIVE baseline is SPEC's own
// "unmounted pets run alongside", so this module is exactly that: a small GLB trailing the local player,
// spawned/despawned off the live equipped-pet read. Fixes a gap where an equipped pet did not appear
// in the world — companion only, never a ridden mount.
//
// The spawn/despawn DECISION (resolve_pet_companion) lives in pet_companion_resolver.js — split out so it
// carries no @aresrpg/engine3 import and stays unit-testable without the private character GLB (issue #117).
// Appearance resolves catalog-first (see that module's header for the #526 finding): a pool pet whose GLB
// isn't published yet stays unspawned with a game_log line naming the slug, never a placeholder — the
// no-silent-substitute law.
//
// The rig factory is a DELIBERATE parallel of mount_rig.js's GLB-cache/clone/scale/ground/dispose
// lifecycle, not a shared import: mount_rig.js is also remote_players.js's rig, and this factory now is too
// (#553 — public pets: remote_players.js spawns the identical rig for a peer's equipped pet, resolved off
// remote_character_cache.js's /v1 read instead of the local live-character read below) — a companion's
// positioning (an independent world entity that follows with a dead zone — pet_follow.js, NOT a rig welded to
// the owner's transform) and
// sizing (a small critter, never MOUNT_TABLE's rideable scale) genuinely differ from a ridden mount's
// (posed at the feet, seat-lifted). It skips mount_rig's idle/move blend + root-y-pin: those exist to
// fight baked root translation in WALK/RUN clips, and a companion only ever loops its IDLE clip (no
// baked forward motion by convention), so the extra machinery would be complexity without a bug to fix.

import { AnimationMixer, Box3 } from 'three'
import { clone as clone_skinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

import { apply_avatar_material, get_glb_loader } from '@aresrpg/engine3/player'
import { canonical_walrus_asset_url } from '@aresrpg/sdk/jobs'

import { game_log } from '../core/log.js'
import { step_pet_follow, empty_pet_motion } from './pet_follow.js'

export { resolve_pet_companion } from './pet_companion_resolver.js'

const COMPANION_HEIGHT = 0.7 // world blocks — a small trailing critter (player avatar ruler = 1.5 blocks)

/** @type {Map<string, Promise<any>>} fetch+parse each unique pet GLB ONCE; clone per rig. */
const _cache = new Map()
const load_glb = (/** @type {string} */ url) => {
  let p = _cache.get(url)
  if (!p) {
    p = get_glb_loader().loadAsync(url)
    _cache.set(url, p)
  }
  return p
}

/**
 * A companion rig for `glb_url` that follows its owner as an INDEPENDENT world entity. Fills in ASYNC —
 * `update()`/`set_visible()` no-op until the GLB resolves, so the caller can create it and feed it every frame
 * immediately. `update()` steps the pure pet_follow steering (its own world position, a 5-block dead zone,
 * catch-up beyond it, idle roam within it) and loops its one idle clip — it is NOT welded to the owner's
 * transform. `dispose()` detaches it (REMOVE-ONLY — never a GPU free; clones share the cached GLB's
 * geometry/material, mount_rig.js's shared-dispose law).
 * @param {{ engine: any, glb_url: string }} args the live engine facade + the pet model URL.
 * @returns {{ readonly ready: boolean,
 *   update: (owner_x: number, owner_gy: number, owner_z: number, dt: number) => void,
 *   set_visible: (v: boolean) => void, dispose: () => void }}
 */
export function create_pet_companion_rig({ engine, glb_url }) {
  /** @type {{ root: any, mixer: AnimationMixer, ground_off: number, motion: ReturnType<typeof empty_pet_motion> } | null} */
  let rig = null
  let disposed = false
  let want_visible = true
  const source_url =
    canonical_walrus_asset_url(glb_url) ?? (glb_url.startsWith('/') && !glb_url.startsWith('//') ? glb_url : null)

  const load = source_url ? load_glb(source_url) : Promise.reject(new Error('refused non-CDN pet asset URL'))
  load
    .then((/** @type {any} */ gltf) => {
      if (disposed) return
      const root = clone_skinned(gltf.scene)
      root.updateMatrixWorld(true)
      root.traverse((/** @type {any} */ o) => {
        if (o.isSkinnedMesh) o.computeBoundingBox()
      })
      const bbox = new Box3().setFromObject(root)
      const model_h = bbox.max.y - bbox.min.y || 1
      const scale = COMPANION_HEIGHT / model_h
      root.scale.setScalar(scale)
      const ground_off = -bbox.min.y * scale // ground the bind bbox floor at the caller's ground y
      root.traverse((/** @type {any} */ o) => {
        if (o.isMesh) o.castShadow = true
      })
      apply_avatar_material(root) // kill the raw golden PBR — the avatar-home fix every live rig uses
      root.visible = want_visible
      const mixer = new AnimationMixer(root)
      const clips = gltf.animations ?? []
      const idle_clip = clips.find((/** @type {any} */ c) => /idle/i.test(c.name)) ?? clips[0]
      idle_clip && mixer.clipAction(idle_clip).play()
      rig = { root, mixer, ground_off, motion: empty_pet_motion() }
      engine.add_to_scene(root)
    })
    .catch((/** @type {any} */ error) => game_log('pet', `GLB load failed (${source_url ?? 'rejected'}):`, error))

  return {
    /** The rig is loaded + in-scene. */
    get ready() {
      return !!rig
    },
    /** Step the independent follow steering toward the owner's position (dead zone + roam); loops its idle clip. */
    update(owner_x, owner_gy, owner_z, dt) {
      if (!rig) return
      // The pure reducer owns the pet's world position; Math.random (roam entropy) rides its default at this edge.
      rig.motion = step_pet_follow(rig.motion, { x: owner_x, z: owner_z }, dt)
      // Ground y trails the owner's fed height — the same tolerance the character auto-follow accepts (no
      // per-pet voxel scan; #593 explicitly forbids collision agonizing for a cosmetic companion).
      rig.root.position.set(rig.motion.x, owner_gy + rig.ground_off, rig.motion.z)
      rig.root.rotation.y = rig.motion.yaw
      rig.mixer.update(dt)
    },
    /** Show / hide the companion (fights hide it with the walk avatar) without a dispose/reload. */
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
