// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORN COSMETICS — equipped HAT + CLOAK GLBs on the roam avatar: the aresrpg-legacy mechanism TRANSCRIBED
// (never imported — legacy is the spec, this is the port). Legacy shipped exactly two worn slots:
//   • hat  — the model parented to the rig's 'Head' bone, RAW (legacy entities.js:101-120 equip_hat:
//     find_bone(model,'Head') → head.clear() → head.add(hat_model); no scale, no offset — the equipment GLBs
//     are AUTHORED for the rig's bone frame at native units, which is the whole reason raw add works).
//   • cloak — the model parented to the dedicated 'cape' bone with a π X-flip (legacy entities.js:122-137
//     equip_cape: cape_model.rotation.set(Math.PI, 0, 0) → back.add(cape_model)). That flip is the ONLY
//     cape transform legacy ships.
// Bone children ride the skeleton, the body yaw AND the avatar's height-normalisation scale automatically —
// no per-frame tracking, no size normalisation, no scene membership of their own (they live in the avatar
// tree, so first-person/fight hides via avatar.visible reach them too).
//
// Two declared deviations from the legacy text (mechanism preserved, engine realities respected):
//   • HAIR: legacy head.clear() DESTROYS the hair and re-equips it as a pseudo-hat on unequip (entities.js:226
//     `hat || { item_type: hair }` — cheap there, MODELS re-clones). The new engine's avatar OWNS its hair
//     mount (character_avatar.js hair path); destroying it would force a re-download to restore. We SUPPRESS
//     it instead (visible=false under a worn hat, restored on unequip/dispose) — the same render per SPEC
//     §7.11 (binding/cosmetics.js seam 8: hair shows only when the head is otherwise bare), zero destruction.
//   • NEW non-legacy assets (sui_helmet class — absent from legacy models.js:50-100, so never authored for
//     the bone frame): a ONE-SHOT measured fit (the approved sui_showcase transform, film-signed
//     2026-07-12b: WOVER 1.4 / VADJ 0.35 / ZADJ −0.06 / HPITCH −0.05) is baked into the child's bone-LOCAL
//     transform at mount, keyed per-item in WORN_FIT. Legacy-authored assets mount raw, exactly like legacy.
//   • VARIANTS: the cosmetic quilt stores one base GLB per appearance; seed skins select that GLB's
//     KHR_materials_variants material at mount. This remains in this attachment home so roam/demo/shop never
//     grow separate slot or variant conventions.
//
// GLB DISCIPLINE (the shared-dispose FREEZE law — mount_rig.js documents it): each mount is a SkeletonUtils
// clone of a MODULE-CACHED GLB (fetch+parse ONCE per URL — the legacy MODELS proxy's own idiom, models.js:
// 107-125); teardown DETACHES + is REMOVE-ONLY — never a GPU free (clones share geometry/material by
// reference; disposing one frees a buffer a sibling submits over → WebGPU device freeze).
//
// MATERIAL (approved 2026-07-12: "material for helmets should be a bit more shiny"): apply_avatar_material
// kills raw glTF metalness=1 (renders black without an envmap), then a MODEST roughness 0.4 / metalness 0.35
// rides the worn meshes ONLY (never skin/mobs).

import { Box3, Quaternion, Vector3 } from 'three'
import { clone as clone_skinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

// [C1 SLICED COMPILE] worn rigs warm their pipelines through the engine's warm queue before the bone
// mount (no registered queue ⇒ immediate resolve — tests/headless unchanged).
import { warm_pipelines_once } from '../render/pipeline_warm_queue.js'

import { apply_avatar_material, get_glb_loader } from './mob_model.js' // [one-mob-sdk 2026-07-13] moved from character_avatar.js (the single mob-render home)

/** Worn-cosmetic PBR (approved) — applied to the mounted GLB meshes ONLY (apply_avatar_material stays
 *  the shared skin/mob home, untouched). A modest metalness + lower roughness = the "shiny" cosmetic look. */
export const WORN_ROUGHNESS = 0.4
export const WORN_METALNESS = 0.35

/** The approved sui_helmet measured-fit constants (sui_showcase.html, film-signed 2026-07-12b).
 *  WOVER = hat outer width / head width (chibi overhang); VADJ = raise, fraction of head height; ZADJ = depth
 *  nudge, fraction of head depth (− = back); HPITCH = crown tip (rad, − tips back). */
export const HEAD_FIT = /** @type {const} */ ({ wover: 1.4, vadj: 0.35, zadj: -0.06, hpitch: -0.05 })

/** Per-item transform table (legacy-shaped: the per-entity tables of entities.js:242-374, keyed by the GLB's
 *  file stem). An entry = a NEW asset needing the measured head fit; NO entry = a legacy-authored asset that
 *  mounts raw on its bone, exactly like legacy equip_hat/equip_cape. */
const WORN_FIT = /** @type {Record<string, typeof HEAD_FIT>} */ ({ sui_helmet: HEAD_FIT })

/** Bone per slot — legacy's two anchors verbatim: 'Head' (entities.js:102) and 'cape' (entities.js:123),
 *  resolved by the same substring-ci rule (legacy models.js:128-139 find_bone / character_avatar D196). */
const SLOT_BONES = /** @type {const} */ ({ head: 'head', back: 'cape' })

/** @typedef {'head' | 'back'} WornSlot */

/** The URL's file stem ('.../cosmetics/sui_helmet.glb?v=2' → 'sui_helmet') — the WORN_FIT key (the
 *  mount_target_height stem idiom). @param {string} url @returns {string} */
const url_stem = (url) =>
  String(url ?? '')
    .split(/[?#]/)[0]
    ?.split('/')
    .pop()
    ?.replace(/\.glb$/i, '')
    .toLowerCase() ?? ''

/** First BONE under `origin` whose name contains `name` (ci) — legacy find_bone (models.js:128-139).
 *  @param {import('three').Object3D} origin @param {string} name @returns {import('three').Object3D | null} */
function find_bone(origin, name) {
  /** @type {import('three').Object3D | null} */ let hit = null
  const want = name.toLowerCase()
  origin.traverse((/** @type {any} */ o) => {
    if (!hit && o.isBone && o.name.toLowerCase().includes(want)) hit = o
  })
  return hit
}

/**
 * Measure the HEAD box in WORLD space = bounds of the vertices whose dominant skin weight is the 'Head' bone
 * (the voxel head block), by summing the 4 skin weights per vertex and keeping those ≥0.5 head-weighted.
 * Ported verbatim from sui_showcase.measure_head_box (the approved fit's measuring stick).
 * @param {import('three').Object3D} avatar_root @returns {Box3|null}
 */
export function measure_head_box(avatar_root) {
  /** @type {any} */ let skinned = null
  avatar_root.traverse((/** @type {any} */ o) => {
    if (!skinned && o.isSkinnedMesh) skinned = o
  })
  if (!skinned) return null
  const head_idx = skinned.skeleton.bones.findIndex((/** @type {any} */ b) => b.name.toLowerCase().includes('head'))
  if (head_idx < 0) return null
  skinned.updateMatrixWorld(true)
  const geo = skinned.geometry
  const pos = geo.attributes.position
  const si = geo.attributes.skinIndex
  const sw = geo.attributes.skinWeight
  const box = new Box3()
  const v = new Vector3()
  let n = 0
  for (let i = 0; i < pos.count; i += 1) {
    let w = 0
    for (let k = 0; k < 4; k += 1) if (si.getComponent(i, k) === head_idx) w += sw.getComponent(i, k)
    if (w >= 0.5) {
      skinned.getVertexPosition(i, v).applyMatrix4(skinned.matrixWorld)
      box.expandByPoint(v)
      n += 1
    }
  }
  return n > 0 ? box : null
}

/**
 * The uniform WORLD fit scale for a measured-fit hat — outer width fits the head's wider horizontal dim ×
 * WOVER. PURE (plain numbers) so the fit math stays headless-testable. @param {{x:number,z:number}} head_size
 * world head bbox size @param {{x:number,z:number}} mesh_size the hat's raw (unscaled) bbox size
 * @param {number} wover @returns {number} */
export function compute_worn_head_scale(head_size, mesh_size, wover) {
  const head_w = Math.max(head_size.x, head_size.z)
  const mesh_w = Math.max(mesh_size.x, mesh_size.z) || 1
  return (head_w * wover) / mesh_w
}

/**
 * Bake the approved measured fit into a head-bone CHILD's local transform, once, at mount. Everything is
 * computed in world space against the measured head box (the sui_showcase math), then converted into the bone's
 * local frame — from there the hat is rigidly bone-locked (rides animation exactly like a legacy-authored hat;
 * the bind-tilt of the bone is cancelled at bake time, so an upright-authored hat sits upright — the showcase's
 * documented reason not to inherit the raw bone quaternion). @param {import('three').Object3D} avatar_root
 * @param {import('three').Object3D} bone @param {import('three').Object3D} mesh (already a child of `bone`)
 * @param {{x:number,z:number}} raw the mesh's DETACHED identity bbox size @param {typeof HEAD_FIT} fit
 * @returns {number|null} the applied world scale, or null while the head isn't measurable yet */
function bake_head_fit(avatar_root, bone, mesh, raw, fit) {
  const hb = measure_head_box(avatar_root)
  if (!hb) return null
  const hs = hb.getSize(new Vector3())
  const hc = hb.getCenter(new Vector3())
  bone.updateWorldMatrix(true, false)
  const bone_q = bone.getWorldQuaternion(new Quaternion())
  const bone_s = bone.getWorldScale(new Vector3())
  const ws = (Math.abs(bone_s.x) + Math.abs(bone_s.y) + Math.abs(bone_s.z)) / 3 || 1
  // world scale → bone-local scale (the avatar's height-normalisation lives in the bone's world scale)
  const s_world = compute_worn_head_scale(hs, { x: raw.x, z: raw.z }, fit.wover)
  mesh.scale.setScalar(s_world / ws)
  // world orientation = body yaw ∘ crown pitch (upright, never the bone's bind tilt) → bone-local
  const yaw = /** @type {any} */ (avatar_root).rotation?.y ?? 0
  const q_world = new Quaternion()
    .setFromAxisAngle(new Vector3(0, 1, 0), yaw)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), fit.hpitch))
  mesh.quaternion.copy(bone_q.clone().invert().multiply(q_world))
  mesh.position.set(0, 0, 0)
  mesh.updateMatrixWorld(true)
  // land the SCALED mesh's world-box centre on the crown anchor (measure-after-scale — an off-origin GLB never
  // floats); ZADJ nudges along the BODY forward axis so the fit is yaw-invariant.
  const wc = new Box3().setFromObject(mesh).getCenter(new Vector3())
  const fwd = new Vector3(0, 0, 1).applyAxisAngle(new Vector3(0, 1, 0), yaw)
  const desired = new Vector3(hc.x, hc.y + fit.vadj * hs.y, hc.z).add(fwd.multiplyScalar(fit.zadj * hs.z))
  const delta = desired.sub(wc).applyQuaternion(bone_q.invert()).divideScalar(ws)
  mesh.position.copy(delta)
  return s_world
}

/** @type {Map<string, Promise<any>>} fetch+parse each unique worn GLB ONCE; clone per mount (the legacy
 *  MODELS proxy idiom, models.js:107-125). */
const _cache = new Map()
const load_glb = (/** @type {string} */ url) => {
  let p = _cache.get(url)
  if (!p) {
    p = get_glb_loader().loadAsync(url)
    _cache.set(url, p)
  }
  return p
}

/** @typedef {{ url: string, variant: string|null }} WornSpec */

/** Seed element vocabulary → authored cosmetic-GLB variant vocabulary (the worn-render generator convention). */
const VARIANT_ALIAS = /** @type {Record<string, string>} */ ({
  air: 'agility',
  earth: 'strength',
  fire: 'intelligence',
  water: 'chance',
})

/** Accept the legacy string caller and the live resolver's variant-bearing model spec. @param {unknown} value
 * @returns {WornSpec|null} */
function normalize_spec(value) {
  if (typeof value === 'string' && value) return { url: value, variant: null }
  if (!value || typeof value !== 'object') return null
  const { url, variant } = /** @type {{url?:unknown, variant?:unknown}} */ (value)
  if (typeof url !== 'string' || !url) return null
  return { url, variant: typeof variant === 'string' && variant ? variant : null }
}

/** Stable async-race/diff key for one desired model. @param {WornSpec} spec */
const spec_key = (spec) => `${spec.url}\u0000${spec.variant ?? ''}`

/** Apply a named KHR_materials_variants choice from a parsed GLTF to its cloned scene. GLTFLoader preserves
 * unknown-extension mappings in mesh.userData; its parser owns material resolution. @param {any} gltf
 * @param {import('three').Object3D} root @param {string|null} variant @returns {Promise<boolean>} */
async function apply_material_variant(gltf, root, variant) {
  if (!variant) return true
  const variants = gltf.parser?.json?.extensions?.KHR_materials_variants?.variants ?? []
  let variant_index = variants.findIndex((/** @type {any} */ row) => row?.name === variant)
  if (variant_index < 0 && VARIANT_ALIAS[variant])
    variant_index = variants.findIndex((/** @type {any} */ row) => row?.name === VARIANT_ALIAS[variant])
  if (variant_index < 0) return false
  /** @type {Promise<void>[]} */ const changes = []
  root.traverse((obj) => {
    const mesh = /** @type {any} */ (obj)
    if (!mesh.isMesh) return
    const mappings = mesh.userData?.gltfExtensions?.KHR_materials_variants?.mappings ?? []
    const mapping = mappings.find((/** @type {any} */ row) => row?.variants?.includes(variant_index))
    if (!mapping || !gltf.parser?.getDependency) return
    changes.push(
      gltf.parser.getDependency('material', mapping.material).then((/** @type {any} */ material) => {
        mesh.material = material
      })
    )
  })
  await Promise.all(changes)
  return changes.length > 0
}

/**
 * Create the worn hat/cloak rig for one avatar — legacy set_equipment's lifecycle (entities.js:220-236) over
 * the engine avatar: `set_slots({ head, back })` reconciles (mounts changed URLs when their GLB resolves,
 * drops cleared ones — the caller edge-triggers per frame exactly like legacy player_equipment.js:50-69);
 * `dispose()` detaches everything + restores hair. Call set_slots only once `avatar.ready` (bones exist).
 * @param {{ avatar: { object3d: import('three').Object3D, ready?: boolean }, load_model?: (url:string) => Promise<any> }} args
 * @returns {{ set_slots: (slots: Partial<Record<WornSlot, string|WornSpec|null>>) => void,
 *   mounted: () => Record<string, any>, dispose: () => void }}
 */
export function create_worn_cosmetics({ avatar, load_model = load_glb }) {
  /** @typedef {{ url: string, mesh: import('three').Object3D, bone: import('three').Object3D,
   *   meshes: string[], mode: 'raw' | 'fitted', scale: number, variant: string|null }} Mount */
  /** @type {Map<WornSlot, Mount>} live mounts by slot */
  const mounts = new Map()
  /** @type {Map<WornSlot, string>} desired spec keys (swap-guard against async races) */
  const wanted = new Map()
  /** Head children suppressed under a worn hat, including hair that arrives after avatar.ready. */
  const suppressed_hair = new Map()
  let disposed = false

  function restore_hair() {
    for (const [object, visible] of suppressed_hair) object.visible = visible
    suppressed_hair.clear()
  }

  /** Non-destructive legacy head.clear(): suppress every non-hat child, remembering original visibility once.
   * Re-run during idempotent reconciliation because character_avatar may attach hair after avatar.ready. */
  function suppress_hair(/** @type {import('three').Object3D} */ bone, /** @type {import('three').Object3D} */ hat) {
    for (const object of bone.children) {
      if (object === hat) continue
      if (!suppressed_hair.has(object)) suppressed_hair.set(object, object.visible)
      object.visible = false
    }
  }

  /** Tear down one slot's mount (REMOVE-ONLY — the cache owns the GPU resources). @param {WornSlot} slot */
  function drop(slot) {
    const m = mounts.get(slot)
    if (!m) return
    m.mesh.removeFromParent()
    mounts.delete(slot)
    if (slot === 'head') restore_hair() // hair shows again when the head is otherwise bare (seam 8)
  }

  /** Load + mount `spec` into `slot` (async; guarded so a stale load never mounts). @param {WornSlot} slot
   * @param {WornSpec} spec */
  function mount(slot, spec) {
    const key = spec_key(spec)
    load_model(spec.url)
      .then(async (/** @type {any} */ gltf) => {
        if (disposed || wanted.get(slot) !== key) return
        const bone = find_bone(avatar.object3d, SLOT_BONES[slot])
        if (!bone) {
          // LOUD (the character_avatar D196 rule): a missing anchor renders nothing, never a floating prop.
          console.warn(`[worn] no '${SLOT_BONES[slot]}' bone on this rig — ${slot} cosmetic skipped (${spec.url})`)
          return
        }
        const mesh = clone_skinned(gltf.scene)
        const variant_applied = await apply_material_variant(gltf, mesh, spec.variant)
        if (disposed || wanted.get(slot) !== key) return
        if (spec.variant && !variant_applied)
          console.warn(`[worn] KHR material variant '${spec.variant}' missing — base material used (${spec.url})`)
        apply_avatar_material(mesh) // kill metalness=1 (renders black without an envmap)
        /** @type {string[]} */ const meshes = []
        mesh.traverse((/** @type {any} */ o) => {
          if (!o.isMesh) return
          o.castShadow = true
          o.frustumCulled = false // animated bounds lie
          meshes.push(o.name || o.type)
          for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
            if (mat && 'roughness' in mat) mat.roughness = WORN_ROUGHNESS
            if (mat && 'metalness' in mat) mat.metalness = WORN_METALNESS
          }
        })
        // [C1 SLICED COMPILE] first-of-cosmetic-class pipelines render one epsilon-scaled warm frame
        // BEFORE the bone mount, so equipping never sync-compiles scene+shadow variants mid-play. The
        // materials are final here (variant + avatar policy + roughness applied above); dedupe by the
        // url+variant key. The swap-guard re-check below covers a dispose/re-equip landing mid-warm.
        await warm_pipelines_once(key, mesh)
        if (disposed || wanted.get(slot) !== key) return
        drop(slot) // replace any prior mount for this slot (swap)
        const fit = slot === 'head' ? WORN_FIT[url_stem(spec.url)] : undefined
        // raw identity bbox (measured DETACHED) — only the fitted path needs it
        mesh.updateMatrixWorld(true)
        const raw = fit ? new Box3().setFromObject(mesh).getSize(new Vector3()) : null
        if (slot === 'head') suppress_hair(bone, mesh)
        if (slot === 'back') mesh.rotation.set(Math.PI, 0, 0) // legacy equip_cape verbatim (entities.js:135)
        bone.add(mesh) // THE legacy mechanism: a bone child rides skeleton + yaw + avatar scale for free
        let scale = 1
        if (fit && raw) {
          const s = bake_head_fit(avatar.object3d, bone, mesh, raw, fit)
          if (s == null) console.warn(`[worn] head not measurable — '${url_stem(spec.url)}' mounted unfitted`)
          else scale = s
        }
        mounts.set(slot, {
          url: spec.url,
          variant: spec.variant,
          mesh,
          bone,
          meshes,
          mode: fit ? 'fitted' : 'raw',
          scale,
        })
      })
      .catch((/** @type {any} */ error) => console.warn(`[worn] GLB load failed (${slot} ${spec.url}):`, error))
  }

  return {
    /** Reconcile the desired worn slots — mount new/changed URLs, drop cleared ones. Idempotent per frame
     *  (diffs internally — the legacy player_equipment change-gate, transcribed). */
    set_slots(slots) {
      for (const key of /** @type {WornSlot[]} */ (Object.keys(SLOT_BONES))) {
        if (!(key in slots)) continue
        const spec = normalize_spec(slots[key])
        const next_key = spec ? spec_key(spec) : null
        if ((wanted.get(key) ?? null) === next_key) {
          const current = mounts.get(key)
          if (key === 'head' && current) {
            suppress_hair(current.bone, current.mesh)
            if (current.mesh.parent !== current.bone) current.bone.add(current.mesh)
          }
          continue
        }
        if (!spec) {
          wanted.delete(key)
          drop(key)
          continue
        }
        wanted.set(key, /** @type {string} */ (next_key))
        drop(key) // clear the old mesh immediately; the new one mounts on load
        mount(key, spec)
      }
    },
    /** Runtime provenance for the proof harness: { slot: { url, meshes, bone, mode, scale } }. */
    mounted() {
      /** @type {Record<string, any>} */ const out = {}
      for (const [slot, m] of mounts.entries())
        out[slot] = {
          url: m.url,
          variant: m.variant,
          meshes: m.meshes,
          bone: m.bone.name,
          mode: m.mode,
          scale: +m.scale.toFixed(4),
        }
      return out
    },
    dispose() {
      disposed = true
      for (const slot of [...mounts.keys()]) drop(slot) // restores hair via the head drop
      wanted.clear()
    },
  }
}
