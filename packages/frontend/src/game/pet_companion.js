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
// Appearance resolves through cosmetic_glb.js's cosmetic_glb_url — the SAME one resolution home worn
// cosmetics + mounts use ("the one resolution home for both conventions", cosmetic_glb.js's own header).
// A pool pet whose GLB isn't uploaded yet 404s at load exactly like any other missing worn/mount asset
// (game_log below, never a placeholder — the no-silent-substitute law).
//
// The rig factory is a DELIBERATE parallel of mount_rig.js's GLB-cache/clone/scale/ground/dispose
// lifecycle, not a shared import: mount_rig.js is also remote_players.js's rig (this lane's local-only,
// peer pets are the follow-up row) and a companion's positioning (eased trail behind the player) and
// sizing (a small critter, never MOUNT_TABLE's rideable scale) genuinely differ from a ridden mount's
// (posed at the feet, seat-lifted). It skips mount_rig's idle/move blend + root-y-pin: those exist to
// fight baked root translation in WALK/RUN clips, and a companion only ever loops its IDLE clip (no
// baked forward motion by convention), so the extra machinery would be complexity without a bug to fix.

import { AnimationMixer, Box3 } from 'three'
import { clone as clone_skinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

import { apply_avatar_material, get_glb_loader } from '@aresrpg/engine3/player'
import { canonical_walrus_asset_url } from '@aresrpg/sdk/jobs'

import { cosmetic_glb_url } from './cosmetic_glb.js'
import { game_log } from '../core/log.js'

// Call-time read on purpose (cosmetic_glb.js's law): vite statically inlines `import.meta.env.DEV`; bun
// tests flip `process.env.DEV` per-call instead of racing the process-global module registry.
const is_dev = () => Boolean(import.meta.env.DEV)

const COMPANION_HEIGHT = 0.7 // world blocks — a small trailing critter (player avatar ruler = 1.5 blocks)
const FOLLOW_BEHIND = 1.4 // blocks behind the player along facing
const FOLLOW_SIDE = 0.6 // blocks to the player's right — keeps it out of the dead-behind camera blind spot
const EASE_LAMBDA = 8 // position/yaw ease — matches remote_players.js LERP_LAMBDA / mount_rig.js BLEND_RATE
const SPEED_EPS = 0.15 // m/s under which the companion keeps its last facing (no idle jitter)

/**
 * Pure decision helper — equipped-pet state -> spawn/despawn + appearance verdict. DEV `?pet=<slug>` /
 * `window.__force_pet` forces a slug (QA path, mirrors resolve_mount's `?mount=`), else the live
 * `pet_equipped` + sibling `pet.slug` (character_pet_projection's honest identity-snapshot-gap contract:
 * `pet_equipped: true` with a null `pet` must never spawn a placeholder). Pure over the supplied
 * character; safe on null/partial input.
 * @param {any} character the live selected character (carries pet/pet_equipped from the /v1 read-model)
 * @param {string} [search] the URL query string (defaults to the live location — injectable for tests)
 * @returns {{ spawn: boolean, glb_url: string | null, key: string | null }}
 */
export function resolve_pet_companion(character, search) {
  if (is_dev()) {
    const query = search ?? (typeof location !== 'undefined' ? location.search : '')
    const forced = typeof window !== 'undefined' ? /** @type {any} */ (window).__force_pet : null
    const slug = (forced && String(forced)) || new URLSearchParams(query).get('pet')
    if (slug) return { spawn: true, glb_url: cosmetic_glb_url(slug), key: slug }
  }
  const equipped = character?.pet_equipped === true
  const slug = equipped && typeof character?.pet?.slug === 'string' ? character.pet.slug : ''
  if (!slug) return { spawn: false, glb_url: null, key: null }
  return { spawn: true, glb_url: cosmetic_glb_url(slug), key: slug }
}

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
 * A trailing companion rig for `glb_url`. Fills in ASYNC — `update()`/`set_visible()` no-op until the GLB
 * resolves, so the caller can create it and feed it every frame immediately. `update()` eases the rig
 * toward a fixed offset behind+right of the fed player transform (remote_players.js's
 * `k = 1 - exp(-λ·dt)` idiom) and loops its one idle clip. `dispose()` detaches it (REMOVE-ONLY — never a
 * GPU free; clones share the cached GLB's geometry/material, mount_rig.js's shared-dispose law).
 * @param {{ engine: any, glb_url: string }} args the live engine facade + the pet model URL.
 * @returns {{ readonly ready: boolean,
 *   update: (player_x: number, player_gy: number, player_z: number, player_yaw: number, dt: number) => void,
 *   set_visible: (v: boolean) => void, dispose: () => void }}
 */
export function create_pet_companion_rig({ engine, glb_url }) {
  /** @type {{ root: any, mixer: AnimationMixer, ground_off: number, x: number, z: number, yaw: number } | null} */
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
      rig = { root, mixer, ground_off, x: NaN, z: NaN, yaw: 0 }
      engine.add_to_scene(root)
    })
    .catch((/** @type {any} */ error) => game_log('pet', `GLB load failed (${source_url ?? 'rejected'}):`, error))

  return {
    /** The rig is loaded + in-scene. */
    get ready() {
      return !!rig
    },
    /** Ease the companion toward a spot behind+right of the fed player transform; loops its idle clip. */
    update(player_x, player_gy, player_z, player_yaw, dt) {
      if (!rig) return
      const target_x = player_x + Math.sin(player_yaw) * FOLLOW_BEHIND + Math.cos(player_yaw) * FOLLOW_SIDE
      const target_z = player_z + Math.cos(player_yaw) * FOLLOW_BEHIND - Math.sin(player_yaw) * FOLLOW_SIDE
      if (!Number.isFinite(rig.x)) {
        // first frame after load — snap instead of sliding in from NaN/origin
        rig.x = target_x
        rig.z = target_z
        rig.yaw = player_yaw
      }
      const k = 1 - Math.exp(-EASE_LAMBDA * dt)
      const dx = target_x - rig.x
      const dz = target_z - rig.z
      rig.x += dx * k
      rig.z += dz * k
      const speed = Math.hypot(dx, dz) * EASE_LAMBDA
      if (speed > SPEED_EPS) rig.yaw = Math.atan2(dx, dz) // face its own travel direction (remote_players.js idiom)
      rig.root.position.set(rig.x, player_gy + rig.ground_off, rig.z)
      rig.root.rotation.y = rig.yaw
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
