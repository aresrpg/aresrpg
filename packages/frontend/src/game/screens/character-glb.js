// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The character GLB-render util — ported 1:1 from the AresRPG production character render
// (`aresrpg-legacy/.../core/utils/three/load_model.js` `load` + `create_custom_colors_api`,
// `core/game/models.js` `find_bone`, and `core/game/entities.js` `equip_hat` + `set_colors` +
// the IDLE animation loop). It loads a DRACO-compressed base body GLB (the head is the helmet
// slot, so the base is HAIRLESS), attaches the separate `_hair` mesh to the model's Head BONE
// exactly as production equips a hat (parented to the bone -> follows the skinned animation, NOT
// world-placed), and wires the 3-colour mesh recolour (the `diffuse`/`emissive` base + color1/2/3
// mask layers) via the customizable-texture SSOT. Reusable by the char-create pedestal and (later)
// the in-game render.

import { AnimationMixer, Color, LoopRepeat, Mesh } from 'three'
import { clone as clone_skinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

import { load_glb_checked } from '@aresrpg/engine3/model'

import { model_asset_url } from '../model_asset_url.js'
import { create_customizable_texture } from './customizable-texture.js'

// The manifest-backed asset host is the only model home — geometry has no relative fallback (the SPA rewrite
// answers a missing GLB with index.html at status 200). Resolved at load time (not at module init) so a
// manifest fetched after boot still wins. The host is keyed by GLB basename, so a legacy `/sprites/characters/senshi_male.glb` input maps to identifier
// `senshi_male.glb`. Null-safe: a bald class/gender passes undefined `hair` straight through. Exported so
// the in-world avatar, remote players, and the fight board (which read CHARACTER_MODELS directly) resolve
// through the SAME seam as the pedestal — one home for "class GLB → its live URL".
/** @param {string | null | undefined} local_url @returns {string | null | undefined} */
export const character_glb_url = (local_url) =>
  local_url ? model_asset_url('character', local_url.split('/').pop() ?? '') : local_url

// Class id -> per-gender GLB filenames on the asset host. The 4 RIGGED classes ship a model
// (senshi/shugo/tomoda/yajin, each male +
// female); the other classes have none, so `has_character_model` returns false and the caller falls back to
// the 2D directional sprite (the pedestal shows "model soon"). `hair` is OPTIONAL per gender — the base body
// is hairless (the head is the helmet slot), so a row with no `hair` simply renders bald (shugo + tomoda-male
// ship no hair mesh). Add a row here as each new rig arrives; the URL pattern is `<class>_<gender>[_hair]`.
/**
 * @typedef {{ body: string, hair?: string }} ModelUrls
 * @typedef {{ male: ModelUrls, female: ModelUrls }} ClassModels
 */
/** @type {Record<string, ClassModels>} */
export const CHARACTER_MODELS = {
  senshi: {
    male: { body: 'senshi_male.glb', hair: 'senshi_male_hair.glb' },
    female: { body: 'senshi_female.glb', hair: 'senshi_female_hair.glb' },
  },
  shugo: {
    male: { body: 'shugo_male.glb' },
    female: { body: 'shugo_female.glb' },
  },
  tomoda: {
    male: { body: 'tomoda_male.glb' },
    female: { body: 'tomoda_female.glb', hair: 'tomoda_female_hair.glb' },
  },
  yajin: {
    male: { body: 'yajin_male.glb', hair: 'yajin_male_hair.glb' },
    female: { body: 'yajin_female.glb', hair: 'yajin_female_hair.glb' },
  },
}

/** @param {string} class_id @returns {boolean} */
export const has_character_model = (class_id) => class_id in CHARACTER_MODELS

/**
 * The gender-matched placeholder rig a surface substitutes when a class ships no art of its own. Named once
 * so "which class stands in" is a fact, not four literals scattered across the render surfaces.
 */
export const PLACEHOLDER_RIG_CLASS = 'senshi'

/**
 * The class rig a character actually RENDERS with. Only the 4 rigged classes have art; every other class
 * resolves to `fallback` when one is named (the world's gender-matched Senshi placeholder — a body must be
 * on screen), or to null when none is (the caller then shows an honest "no art yet" placeholder of its own).
 * @param {string | null | undefined} class_id
 * @param {string | null} [fallback]
 * @returns {string | null}
 */
export const character_rig_of = (class_id, fallback = null) =>
  class_id && has_character_model(class_id) ? String(class_id) : fallback

/**
 * THE ONE HOME for "a class + a gender → the GLB urls that render it" — consumed by the roam avatar
 * (embed_voxel_player), remote players, the world fight board (world-shell/voxel_fight_folds) and the
 * simulator board, so a body on one surface is the same body on every other. URLs are asset-host-only through
 * `character_glb_url`; a bald class/gender row resolves `hair: undefined` (bald, never broken).
 *
 * `fallback` is the ONLY thing that differs between surfaces and it is an explicit argument, not a fork: the
 * world substitutes `PLACEHOLDER_RIG_CLASS` because a live board must show a body, while the simulator seats
 * all twelve classes and passes none — putting a Senshi body on the Iyashi you are building would be a lie
 * about the very thing that page exists to show, so an unrigged class resolves no url and the engine's own
 * capsule stands in. The RULE is shared; only the policy argument varies.
 *
 * @param {string | null | undefined} class_id
 * @param {boolean} male
 * @param {{ fallback?: string | null }} [options]
 * @returns {{ rig: string | null, body: string | undefined, hair: string | undefined }}
 */
export const character_model_urls = (class_id, male, { fallback = null } = {}) => {
  const rig = character_rig_of(class_id, fallback)
  const urls = rig ? CHARACTER_MODELS[rig]?.[male ? 'male' : 'female'] : undefined
  return {
    rig,
    body: character_glb_url(urls?.body) ?? undefined,
    hair: character_glb_url(urls?.hair) ?? undefined,
  }
}

// Parsed-GLTF cache keyed by url so re-selecting a class is instant (parse once). Each consumer
// clones the parsed scene (SkeletonUtils.clone rebinds the skeleton so the rig animates correctly).
/** @type {Map<string, Promise<import('three').Group & { animations: import('three').AnimationClip[] }>>} */
const _cache = new Map()
const load_glb = (url) => {
  let p = _cache.get(url)
  if (!p) {
    p = load_glb_checked(url).then((gltf) => {
      gltf.scene.animations = gltf.animations
      return /** @type {any} */ (gltf.scene)
    })
    _cache.set(url, p)
  }
  return p
}

/** Warm one character variant's body + optional hair through the same cache load_character_model reads.
 *  @param {string} class_id @param {{ male?: boolean }} [opts] */
export function preload_character_model(class_id, { male = true } = {}) {
  const models = CHARACTER_MODELS[class_id]
  if (!models) return
  const urls = male ? models.male : models.female
  for (const local_url of [urls.body, urls.hair]) {
    const url = character_glb_url(local_url)
    if (url) load_glb(url).catch(() => {})
  }
}

// find_bone — port of models.js: the first bone whose name CONTAINS `name` (case-insensitive), so
// 'Head' resolves 'mixamorig:Head'. Returns null instead of asserting (the caller decides).
/** @param {import('three').Object3D} origin @param {string} name @returns {import('three').Object3D | null} */
const find_bone = (origin, name) => {
  let bone = /** @type {import('three').Object3D | null} */ (null)
  const want = name.toLowerCase()
  origin.traverse((child) => {
    if (!bone && /** @type {any} */ (child).isBone && child.name.toLowerCase().includes(want)) bone = child
  })
  return bone
}

/**
 * Attach a class's `_hair` mesh to a loaded body rig — the production "equip hat" path: cloned hair
 * parented to the Head BONE (inherits the skinned transform — never world-placed). PEDESTAL-ONLY since
 * D193: the in-world engine avatar mounts its own hair via create_character_avatar({ hair_url }).
 * Resolves the attached hair node, or null (class/gender ships no hair, or no Head bone) — bald is fine.
 * @param {import('three').Object3D} model
 * @param {string} class_id
 * @param {{ male?: boolean }} [opts]
 * @returns {Promise<import('three').Object3D | null>}
 */
async function attach_class_hair(model, class_id, { male = true } = {}) {
  const urls = CHARACTER_MODELS[class_id]?.[male ? 'male' : 'female']
  if (!urls?.hair) return null
  const head = find_bone(model, 'Head')
  if (!head) return null
  const hair_url = character_glb_url(urls.hair)
  if (!hair_url) return null
  const hair = clone_skinned(await load_glb(hair_url))
  head.clear() // production's atomic no-double-headgear rule
  head.add(hair)
  return hair
}

/**
 * Build the 3-colour recolour API for a cloned model — port of load_model.js
 * `create_custom_colors_api`, generalised to where these assets actually store the layer textures:
 * every layer (diffuse AND emissive) is a baseColorTexture (material `.map`), so we group textures
 * by the `(.+)_base` / `(.+)_colorN` naming and swap each `<base>_base` material's `.map` for the
 * composited customizable texture. Returns null when the model carries no customizable layers.
 * @param {import('three').Object3D} model
 * @returns {{
 *   set_color1: (c: Color) => void, set_color2: (c: Color) => void, set_color3: (c: Color) => void,
 *   needsUpdate: () => boolean, update: (r: import('three').WebGLRenderer) => void, dispose: () => void,
 * } | null}
 */
const create_custom_colors = (model) => {
  // collect every named texture reachable from the materials (map + emissiveMap)
  /** @type {Map<string, import('three').Texture>} */
  const textures = new Map()
  model.traverse((child) => {
    const mat = /** @type {any} */ (child).material
    if (!mat) return
    for (const m of Array.isArray(mat) ? mat : [mat])
      for (const tex of [m.map, m.emissiveMap]) if (tex?.name) textures.set(tex.name, tex)
  })

  // base groups: `<base>_base` plus its `<base>_color1/2/3` masks
  const customizables = /** @type {Map<string, ReturnType<typeof create_customizable_texture>>} */ (new Map())
  for (const [tex_name, base_texture] of textures.entries()) {
    const match = tex_name.match(/^(.+)_base$/)
    if (!match || !match[1]) continue
    const base = match[1]
    const additional = new Map()
    for (const layer of ['color1', 'color2', 'color3']) {
      const layer_tex = textures.get(`${base}_${layer}`)
      if (layer_tex) additional.set(layer, layer_tex)
    }
    if (additional.size === 0) continue
    customizables.set(base, create_customizable_texture({ baseTexture: base_texture, additionalTextures: additional }))
  }

  if (customizables.size === 0) return null

  // swap each `<base>_base` material's map for the composited customizable texture (clone the
  // material once so two characters sharing a parsed scene never recolour each other)
  const used = new Set()
  model.traverse((child) => {
    const mesh = /** @type {any} */ (child)
    if (!mesh.material) return
    const mat = mesh.material
    if (Array.isArray(mat)) return
    const map_name = mat.map?.name ?? ''
    const base_match = map_name.match(/^(.+)_base$/)
    if (!base_match || !base_match[1]) return
    const customizable = customizables.get(base_match[1])
    if (!customizable) return
    mesh.material = mat.clone()
    mesh.material.map = customizable.texture
    mesh.material.needsUpdate = true
    used.add(customizable)
  })

  for (const [base, c] of customizables.entries())
    if (!used.has(c)) {
      c.dispose()
      customizables.delete(base)
    }

  const all = () => Array.from(customizables.values())
  const set_layer = (name, color) => {
    for (const c of all()) c.setLayerColor(name, color)
  }
  return {
    set_color1: (c) => set_layer('color1', c),
    set_color2: (c) => set_layer('color2', c),
    set_color3: (c) => set_layer('color3', c),
    needsUpdate: () => all().some((c) => c.needsUpdate()),
    update: (renderer) => {
      for (const c of all()) if (c.needsUpdate()) c.update(renderer)
    },
    dispose: () => {
      for (const c of all()) c.dispose()
    },
  }
}

/**
 * Load a haired character model for a class + gender. Resolves null for a class with no local GLB (the
 * pedestal renders a "model soon" placeholder instead). The returned `object3d` is the posed, haired model;
 * `set_colors` recolours the real mesh live (needs the pedestal's renderer to composite the layers, exactly
 * as production `set_colors(colors, renderer)`).
 *
 * @param {string} class_id
 * @param {{ male?: boolean }} [opts]  gender selector (the on-chain Character carries `male: bool`); defaults
 *   to male (the only variant some data paths carry today — a female char falls back to male until presence
 *   / the read-model projects `sex`).
 * @returns {Promise<{
 *   object3d: import('three').Group,
 *   mixer: AnimationMixer | null,
 *   clips: import('three').AnimationClip[],
 *   set_colors: (colors: [string, string, string], renderer: import('three').WebGLRenderer) => void,
 *   dispose: () => void,
 * } | null>}
 */
export async function load_character_model(class_id, { male = true } = {}) {
  const models = CHARACTER_MODELS[class_id]
  if (!models) return null
  const urls = male ? models.male : models.female
  const body_url = character_glb_url(urls.body)
  if (!body_url) return null

  const body_scene = await load_glb(body_url)
  const model = clone_skinned(body_scene)
  const body_colors = create_custom_colors(model)

  // animation: play IDLE (or the first clip) so we never show the bind T-pose (entities.js plays
  // actions.IDLE on spawn).
  const clips = body_scene.animations ?? []
  let mixer = /** @type {AnimationMixer | null} */ (null)
  if (clips.length) {
    mixer = new AnimationMixer(model)
    const idle = clips.find((c) => /idle/i.test(c.name)) ?? clips[0]
    if (idle) mixer.clipAction(idle).setLoop(LoopRepeat, Infinity).play()
  }

  // hair = the production "equip hat" path: attach_class_hair parents the `_hair` mesh to the Head
  // bone; colors wrap it for the pedestal recolour.
  const hair = await attach_class_hair(model, class_id, { male })
  const hair_colors = hair ? create_custom_colors(hair) : null

  return {
    object3d: /** @type {import('three').Group} */ (model),
    mixer,
    // The body rig's embedded clips (IDLE/WALK/RUN/ATTACK/SPELL_*/DEATH/...) — exposed so the in-game
    // player_model can categorise + drive them (walk on move, attack/spell on cast), exactly as mob_model
    // drives the mob rig's clips. The pedestal ignores these (it only wants the IDLE the mixer already plays).
    clips,
    // set_colors — port of entities.js: apply each colour to the body AND the hair customizable
    // textures, then composite once with the renderer (skip the RT render when nothing changed).
    set_colors([color_1, color_2, color_3], renderer) {
      for (const colors of [body_colors, hair_colors]) {
        if (!colors) continue
        colors.set_color1(new Color(color_1))
        colors.set_color2(new Color(color_2))
        colors.set_color3(new Color(color_3))
        if (colors.needsUpdate()) colors.update(renderer)
      }
    },
    dispose() {
      mixer?.stopAllAction()
      body_colors?.dispose()
      hair_colors?.dispose()
      model.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry?.dispose()
          const mat = /** @type {any} */ (o.material)
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
          else mat?.dispose()
        }
      })
    },
  }
}
