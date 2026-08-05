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
// The companion keeps its distinct positioning (pet_follow.js's independent dead-zone steering) and small
// presentation size, but its MODEL + MIXER are the shared character-avatar handle used by player and mob bodies.
// That handle owns clip resolution/crossfades; controller.js's classify_anim remains the one movement→state home.

import { classify_anim, create_character_avatar, create_mob_model } from '@aresrpg/engine3/player'

import { game_log } from '../core/log.js'
import { mob_model_fallback_url } from './data/mobs.js'
import { canonical_model_source_url } from './model_asset_url.js'
import { step_pet_follow, empty_pet_motion } from './pet_follow.js'
import { hover_target_y, is_fish_pet } from './pet_hover.js'

export { resolve_pet_companion } from './pet_companion_resolver.js'

const COMPANION_HEIGHT = 0.7 // world blocks — a small trailing critter (player avatar ruler = 1.5 blocks)

/**
 * A companion rig for `glb_url` that follows its character as an INDEPENDENT world entity. Its shared avatar
 * fills in ASYNC; the caller can create and feed the stable empty root immediately, while its mixer safely
 * no-ops until the GLB resolves. `update()` steps the pure pet_follow steering (its own world position, a 5-block dead zone,
 * catch-up beyond it, idle roam within it), derives the animation state through the controller's shared
 * classifier, and feeds that state to the shared avatar mixer — it is NOT welded to the character transform.
 * A fish-family `slug` (pet_hover.js's is_fish_pet, #676) hovers HOVER_HEIGHT_M above the fed ground y with a
 * gentle time-based bob instead of grounded placement; while moving, its SWIM state resolves through the same
 * avatar clip preferences as every other model. `dispose()` detaches it and delegates instance cleanup to the
 * shared mob-model/avatar lifecycle.
 * @param {{ engine: any, glb_url: string, slug?: string | null, rng?: () => number }} args the live engine facade,
 *   pet model URL, catalog slug (family detection — #676), and optional steering entropy source.
 * @returns {{ readonly ready: boolean,
 *   update: (owner_x: number, owner_gy: number, owner_z: number, dt: number) => void,
 *   set_visible: (v: boolean) => void, dispose: () => void }}
 */
export function create_pet_companion_rig({ engine, glb_url, slug = null, rng = Math.random }) {
  let disposed = false
  let want_visible = true
  let elapsed_s = 0 // hover bob accumulator (fish only) — TIME-based, advanced by update()'s own dt
  const is_fish = is_fish_pet(slug)
  const source_url = canonical_model_source_url(glb_url, { allow_dev_models: true })
  const avatar = source_url
    ? create_character_avatar({
        glb_url: source_url,
        scale: COMPANION_HEIGHT,
        receive_shadow: false,
        fallback_url: mob_model_fallback_url(),
        mob_model_factory: create_mob_model,
      })
    : null
  let motion = empty_pet_motion()
  if (avatar) {
    avatar.object3d.visible = want_visible
    engine.add_to_scene(avatar.object3d)
  } else game_log('pet', `GLB load failed (rejected):`, new Error('refused non-CDN pet asset URL'))

  return {
    /** The rig is loaded + in-scene. */
    get ready() {
      return !!avatar?.ready
    },
    /** Step the independent follow steering and drive the shared avatar's locomotion state. */
    update(owner_x, owner_gy, owner_z, dt) {
      if (!avatar || disposed) return
      // The pure reducer owns the pet's world position (x/z only — #676's hover is a vertical-only change, the
      // dead-zone follow/roam steering below is IDENTICAL for every family); production uses Math.random for
      // roam entropy, while the driven test injects a deterministic source at this edge.
      const prev_x = motion.x
      const prev_z = motion.z
      motion = step_pet_follow(motion, { x: owner_x, z: owner_z }, dt, rng)
      const dx = Number.isFinite(prev_x) ? motion.x - prev_x : 0
      const dz = Number.isFinite(prev_z) ? motion.z - prev_z : 0
      const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0
      // controller.js remains the ONE movement→animation-state derivation. A pet is an authored walking gait,
      // so even its fast cosmetic catch-up consumes WALK; no travel consumes IDLE. Fish preserve #676 by asking
      // the shared avatar preferences for SWIM only while horizontally moving (still fish now genuinely IDLE).
      const ground_anim = classify_anim(
        /** @type {any} */ ({ speed, in_water: false, on_ground: true }),
        { ground_gait: 'walk' }
      )
      const anim = is_fish && ground_anim === 'WALK' ? 'SWIM' : ground_anim
      // Ground y trails the character's fed height — the same tolerance the character auto-follow accepts (no
      // per-pet voxel scan; #593 explicitly forbids collision agonizing for a cosmetic companion). A fish
      // hovers HOVER_HEIGHT_M above it with a gentle bob instead (#676). The shared avatar group is already
      // feet-grounded, so both branches place that one canonical root directly.
      if (is_fish) {
        elapsed_s += dt
        avatar.object3d.position.set(motion.x, hover_target_y(owner_gy, elapsed_s), motion.z)
      } else {
        avatar.object3d.position.set(motion.x, owner_gy, motion.z)
      }
      avatar.update(/** @type {any} */ (anim), motion.yaw, dt)
    },
    /** Show / hide the companion (fights hide it with the walk avatar) without a dispose/reload. */
    set_visible(v) {
      want_visible = !!v
      if (avatar) avatar.object3d.visible = want_visible
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (avatar) {
        try {
          engine.remove_from_scene(avatar.object3d)
        } catch {
          /* already gone */
        }
        avatar.dispose()
      }
    },
  }
}
