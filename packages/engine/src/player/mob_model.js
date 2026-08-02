// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ONE MOB-MODEL RENDER SDK — the single home for "load a creature GLB and make it render right".
//
// Born 2026-07-13 (constraint: mob-fight GLB rendering needs ONE sdk to render models, not
// several). Before this, THREE mob paths each re-implemented load + measure + scale +
// material and had DRIFTED: the roam world-spawn rig (spawn_rigs.js) height-normalised with an
// updateWorldMatrix-guarded measure + SkeletonUtils clone (the PROVEN-correct, signed-off config);
// the fight board (board_entities.js → character_avatar.js) measured WITHOUT the matrix pre-update; the dungeon
// rig (cave_mobs.js) applied `scale` as a RAW geometry multiplier (the "giant mob" class — a 3.16-unit reference-corpus
// GLB ×1.4 drew a 4.4-block colossus). The material policy alone was shared. This module makes the WHOLE render
// path one home: the DRACO loader, the metalness gold-kill, the pixel-art sampler/emissive-floor, the cached
// clone loader, and the height-normalise policy all live HERE. character_avatar.js (the recolour/hair/beat
// player+fight avatar) now builds ON these — the dependency flows ONE way (avatar → this), no cycle.
//
// Consumed by every mob path: create_mob_model is the ONE factory that parses/caches, SkeletonUtils-clones,
// gives the instance its own material objects, and applies the fixed mob render policy. Contexts may animate and
// position the returned root, but they do not load or prepare creature materials themselves.

import { Box3, Color, LinearMipmapLinearFilter, NearestFilter, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { clone as clone_skinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

// [C1 SLICED COMPILE] first-of-URL rigs render one epsilon-scaled warm frame through the live engine's
// warm queue BEFORE create_mob_model resolves, so the consumer's real mount hits warm pipeline caches
// instead of sync-compiling scene+shadow variants mid-play (no queue registered ⇒ resolves immediately).
import { warm_pipelines_once } from '../render/pipeline_warm_queue.js'

/** DRACO decoder directory. The engine owns the static third-party runtime assets in
 *  packages/engine/public/draco; its Vite demo serves them directly and the frontend Vite config republishes
 *  them at `/draco/`. setDecoderPath appends the wasm/js filenames to this base. */
const DRACO_DECODER_URL = '/draco/'

let _loader = /** @type {GLTFLoader | null} */ (null)
/** One shared GLTFLoader + DRACOLoader (the GLBs need a DRACO decoder or the parse throws). */
function get_loader() {
  if (!_loader) {
    const draco = new DRACOLoader().setDecoderPath(DRACO_DECODER_URL)
    _loader = new GLTFLoader().setDRACOLoader(draco)
  }
  return _loader
}

/** D224 — the dapp's character avatar, cave mob pack, roam world-spawn + fight board ALL load creature GLBs
 *  (several are DRACO-required) through this SAME shared loader (one decoder config, one home — never a second
 *  DRACOLoader on the client). */
export const get_glb_loader = get_loader

const GLB_CONTENT_TYPES = new Set([
  'application/gltf-buffer',
  'application/octet-stream',
  'application/x-gltf',
  'binary/octet-stream',
  'model/gltf-binary',
])

/** @param {string | null | undefined} value */
export function is_glb_content_type(value) {
  return GLB_CONTENT_TYPES.has(
    String(value ?? '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase()
  )
}

/**
 * Fetch a GLB, reject non-model responses before parsing, then hand verified bytes to the shared DRACO loader.
 * This catches the SPA rewrite failure mode (`text/html` with status 200) at the network boundary.
 * @param {string} url
 * @param {{ fetch_impl?: typeof fetch, loader?: GLTFLoader }} [opts]
 */
export async function load_glb_checked(url, { fetch_impl = globalThis.fetch, loader = get_loader() } = {}) {
  if (typeof url !== 'string' || !url) throw new TypeError('GLB URL is unavailable')
  const response = await fetch_impl(url)
  if (!response.ok) throw new Error(`GLB request failed (${response.status}) for ${url}`)
  const content_type = response.headers?.get?.('content-type')
  if (!is_glb_content_type(content_type))
    throw new TypeError(`Refused non-model content-type "${content_type ?? '<missing>'}" for ${url}`)
  const bytes = await response.arrayBuffer()
  const document_base = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/'
  const response_url = new URL(response.url || url, document_base)
  return loader.parseAsync(bytes, new URL('.', response_url).href)
}

/**
 * [D193/D242] Neutralize the raw glTF PBR "gold/black" class on every mesh under a model: a metalness of
 * 1 (or any > 0) reflects NOTHING without an envmap (the engine ships none) and reads as OVERSATURATED
 * GOLD — or a black silhouette — under the scene's analytic lights. Neither the player rig nor the
 * creature GLBs are chrome. THE single home for this fix: create_character_avatar applies it to the
 * player body/hair, and prepare_mob_render applies it to the roam/dungeon/fight creature GLBs (D242 —
 * the cave/fight mobs bypassed the avatar home and rendered golden). Idempotent; safe on any Object3D.
 * @param {import('three').Object3D} object3d
 */
export function apply_avatar_material(object3d) {
  object3d.traverse((obj) => {
    const mesh = /** @type {any} */ (obj)
    if (!mesh.isMesh) return
    const mat = mesh.material
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (m && typeof m.metalness === 'number' && m.metalness > 0) m.metalness = 0
    }
  })
}

/** [mob-shade-floor 2026-07-13] Fraction of a mob face's own albedo emitted as an unlit floor so faces angled
 *  away from the engine's overhead-only directional lights read their painted colour instead of AgX-crushing to
 *  black. 0.30 tuned headless under the exact engine rig: it lifts the crushed shore-crab claw faces + makes eyes
 *  glow, while AgX rolls the lit faces off so the form is preserved (0.5 flattened; see the reference-match probe). */
const MOB_EMISSIVE_FLOOR = 0.3

/**
 * [S-82] MOB-ONLY pixel-art texture filter. The reference-corpus critter atlases are tiny (bunny 128×96,
 * chick 64×64) with ~6–10 texel eye islands; three.js's default LinearFilter MAG smears those into muddy
 * blobs (reported: "weird eyes" / "blurry models"). The correct pixel-art sampler is NEAREST
 * MAGNIFICATION (each texel snaps to crisp pixels up close) but MIPMAPPED MINIFICATION
 * (LinearMipmapLinearFilter — [fight-polish 07-12] owner: keep the distance clean; all-Nearest min without
 * mipmaps aliased/shimmered the atlas as the mob shrank). colorSpace is deliberately left untouched. Applied
 * on every `map`/`emissiveMap` under a model. Idempotent (guarded on a per-texture key flag — the converter
 * now emits NEAREST samplers, so an already-Nearest map must still receive the min/aniso policy), safe on a
 * shared/cloned texture — SkeletonUtils clones SHARE textures, so setting it once at load keys every clone (REMOVE-ONLY law).
 * anisotropy=8 (board_surface.js's own grazing-angle constant — one shared value, not a renderer-plumbed
 * max) kills the residual angle-smear a fight-board camera's shallow angle would otherwise reintroduce.
 *
 * [mob-shade-floor 2026-07-13] It ALSO lays a low ALBEDO-EMISSIVE FLOOR on every mob material. WHY (instrumented
 * headless under the EXACT engine rig): both engine directionals sit ABOVE (renderer.js: "faces pointing AWAY
 * from the single directional sun … AgX crushes them to black"), so a box-per-bone mob's down/inward-angled voxel
 * faces crush to pure black — the reported "a lot of fully dark faces" (worst on the shore crab's big rotated
 * claws; geometry/normals/winding were PROVEN correct, never inverted). The floor makes each face read its OWN
 * albedo (emissiveMap = the map — per-texel colour, never a flat wash) at MOB_EMISSIVE_FLOOR regardless of light
 * angle (the reference-corpus near-unlit look), lifting crushed faces + the eye decal's glow; AgX rolls the lit faces off so
 * it never blows out. Untouched: the tuned WORLD lighting; and players (never route through here).
 * @param {import('three').Object3D} object3d
 */
export function apply_pixel_filter(object3d) {
  object3d.traverse((obj) => {
    const mesh = /** @type {any} */ (obj)
    if (!mesh.isMesh) return
    const mat = mesh.material
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (!m) continue
      // [tex-extract-fix 2026-07-21, #158] Albedo-emissive floor FIRST — order matters. GLTFLoader's
      // loadImageSource caches by sourceIndex and hands back a `.clone()` on a cache hit (three@0.185.1
      // GLTFParser.js): a material whose glTF-native emissiveTexture already points at the SAME image as
      // its baseColorTexture (a different texture/sampler entry, same source index) arrives with TWO
      // DISTINCT Texture instances sharing ONE Source/ImageBitmap. The renderer's upload dedupe keys on the
      // TEXTURE OBJECT (WebGPU backend DataMap), never the shared Source, so processing both independently
      // below would queue two copyExternalImageToTexture calls against the same bitmap — the second is
      // what Chrome logs as "fails extracting valid resource from external image". Forcing
      // `emissiveMap = map` (the SAME instance, never a clone) BEFORE the pixel-filter loop means that loop
      // only ever sees ONE texture object per material — the discarded clone is dropped before anything can
      // reference or upload it. Idempotent on the SkeletonUtils-shared material via __mob_shade_floor.
      if (m.map && !m.__mob_shade_floor) {
        m.emissiveMap = m.map // per-texel colour floor (the face's own paint), NOT a flat wash — exact same instance
        m.emissive = new Color(0xffffff) // white × emissiveMap × intensity ⇒ intensity·albedo
        m.emissiveIntensity = MOB_EMISSIVE_FLOOR
        m.__mob_shade_floor = true
        m.needsUpdate = true
      }
      for (const map of [m.map, m.emissiveMap]) {
        // idempotency: a private key flag, NOT `magFilter === NearestFilter` — the converter now emits a
        // NEAREST sampler (the GLB converter [mob-crisp 2026-07-13]), so sampler-carrying GLBs arrive
        // already-Nearest and the old guard would have skipped the min/aniso policy below entirely. After
        // the reassignment above, m.map and m.emissiveMap are always the SAME object — one real iteration.
        if (!map || map.__ares_pixel_keyed) continue // guard: key the shared texture once (clones SHARE it)
        map.__ares_pixel_keyed = true
        map.magFilter = NearestFilter // crisp pixel-art texels up close (kills the blur)
        map.minFilter = LinearMipmapLinearFilter // mipmapped minification — clean as the mob shrinks (no shimmer)
        map.generateMipmaps = true
        map.anisotropy = 8 // matches board_surface.js's grazing-angle constant — kills angle smear, cheap
        map.needsUpdate = true
      }
    }
  })
}

/** Page-lifetime GLB parse cache. Instances borrow parsed geometry/textures, so the parse is NEVER disposed per
 *  teardown. Keyed by URL; the same URL parses exactly once across every mob path that asks for it.
 *  @type {Map<string, Promise<any>>} */
const _glb_cache = new Map()

/**
 * Clone each source material once per instance (preserving within-model sharing). Geometry and textures stay
 * shared with the immutable parsed GLB; material objects do not. This is required because transient board VFX
 * tint material fields: one fighter must never mutate another fighter or an overworld clone of the same mob.
 * @param {import('three').Object3D} root @returns {Set<any>} the instance-owned materials
 */
function clone_instance_materials(root) {
  const clones = new Map()
  const owned = new Set()
  const clone_one = (/** @type {any} */ source) => {
    if (!source) return source
    let copy = clones.get(source)
    if (!copy) {
      copy = source.clone()
      clones.set(source, copy)
      owned.add(copy)
    }
    return copy
  }
  root.traverse((obj) => {
    const mesh = /** @type {any} */ (obj)
    if (!mesh.isMesh || !mesh.material) return
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone_one) : clone_one(mesh.material)
  })
  return owned
}

/** Load the immutable, page-cached GLTF source. @param {string} url */
async function load_mob_source(url) {
  let p = _glb_cache.get(url)
  if (!p) {
    p = load_glb_checked(url)
    _glb_cache.set(url, p)
  }
  return p
}

/**
 * Build one render-ready mob from an already-parsed GLTF. Private so create_mob_model remains the only public
 * loader/factory. The returned disposer frees only per-instance skeleton/material state, never cached geometry
 * or shared textures.
 * @param {{ scene: import('three').Object3D, animations?: import('three').AnimationClip[] }} gltf
 * @param {{ label?: string | null }} [opts]
 */
function create_mob_model_from_gltf(gltf, { label = null } = {}) {
  const root = clone_skinned(gltf.scene)
  const materials = clone_instance_materials(root)
  const measured = prepare_mob_render(root, { pixel_filter: true, label })
  let disposed = false
  return {
    root,
    clips: gltf.animations ?? [],
    measured,
    dispose() {
      if (disposed) return
      disposed = true
      root.traverse((obj) => {
        const mesh = /** @type {any} */ (obj)
        if (mesh.isSkinnedMesh) mesh.skeleton?.dispose?.()
      })
      for (const material of materials) material.dispose?.()
    },
  }
}

/**
 * THE single mob-model factory: one cached DRACO/GLTF loader, one SkeletonUtils instance path, one fixed
 * material/shadow/sampler policy. Both overworld and fight-board consumers call this function directly.
 * @param {string} url a served GLB URL (get_mob_model().url)
 * @param {{ label?: string | null }} [opts]
 * @returns {Promise<ReturnType<typeof create_mob_model_from_gltf>>}
 */
export async function create_mob_model(url, { label = url } = {}) {
  const model = create_mob_model_from_gltf(await load_mob_source(url), { label })
  // [C1] warm this rig class's pipelines (dedupe by URL — clones share material feature-sets, so the
  // first instance's warm covers every later clone). The root is still detached here; consumers mount
  // it only after this resolve, when every first-use pipeline is a cache hit.
  await warm_pipelines_once(url, model.root)
  return model
}

// [mob-sizes-authored 2026-07-13] Ruling (verbatim: "sizes should be true to source"). Before
// this, EVERY mob (roam MOB_TARGET_H=1.8, dungeon/fight get_mob_model().size=1.4·wire) was height-NORMALISED
// to a near-player constant — a frog, a larva and a dragon all stood the same, player-tall. The reference-corpus
// extractor (the GLB converter) preserves each creature's TRUE authored proportions, so the fix is to
// STOP dividing them out: the authored size stands, straight through.
//
// UNIT CALIBRATION (measured 2026-07-13, headless GLB probes): the shipped GLBs are NOT in world-metres. The
// converter divides source units by SCALE=32 — a value its own comment admits was "calibrated to the shipped
// mob GLB band" — and the known player-sized HUMANOIDS expose the error: hy_skeleton_sand/white measure 3.72
// GLB units tall, hy_zombie_* 3.62, hy_feran 3.80. A humanoid mob standing beside the 2.0-block player must
// be ~1.8-1.9 blocks, so the true source convention is 64 units/block and every shipped GLB is exactly 2× its
// world-block height. HYTALE_BLOCKS_PER_GLB_UNIT corrects that HERE, in the one home (the converter-side
// equivalent — re-extracting the whole fleet at --scale 64 — is a separate lane; until it runs, this constant
// is the single source of the correction). Calibrated cast: silk larva 0.42 · frog 0.60 (knee-high) ·
// shore crab 1.61 · skeleton/zombie 1.81-1.86 · bear_grizzly 1.96 · yeti 3.34 · dragon_fire 4.10.
const HYTALE_BLOCKS_PER_GLB_UNIT = 0.5 // shipped GLBs (converter --scale 32) are 2× world blocks; true scale = 64 u/block
// The clamp catches a genuinely broken/degenerate export AND caps the giant bosses so they stay readable on
// the tactical board — inside it, sizes are source-faithful verbatim. Only yeti (3.34) + dragons (~4.1) clamp.
const MOB_MIN_H = 0.35 // blocks — floor (the smallest real critter, the silk larva, is 0.42; below = bad export)
const MOB_MAX_H = 3.2 // blocks — ceiling (giant bosses cap here; taller swallows the fight board / cave rooms)

/**
 * THE single render policy for a creature model — everything between "a parsed/cloned GLB" and "renders like
 * the roam world's mobs". Idempotent-safe on a SkeletonUtils clone (the material helpers key the shared
 * textures/materials once). Mutates `model` in place; returns its measured extents so the caller can ground it.
 *
 *  1. SCALE. Reset to scale 1, force the whole subtree's world matrices current (updateWorldMatrix(true,true))
 *     so a freshly-cloned skinned rig's bind pose can't lie about its bounds (QA 2026-07-10: a bad
 *     local-bbox read drew GIANTS), then measure the height. Two policies:
 *       - `target_height` GIVEN (players only: CHARACTER_HEIGHT / the fight-board's BOARD_PLAYER_HEIGHT) —
 *         the OLD divide-and-retarget: scale so the rig stands exactly `target_height` blocks tall.
 *       - `target_height` OMITTED (every mob path, now) — INTRINSIC (2026-07-13: "sizes should be
 *         true to source"): the measured height × HYTALE_BLOCKS_PER_GLB_UNIT (the unit calibration above)
 *         stands — no retarget — except clamped into [MOB_MIN_H, MOB_MAX_H] (broken exports + giant bosses),
 *         which logs a one-line warn naming the model so an out-of-band size is never silent.
 *  2. SHADOWS + culling per mesh: cast (default on), receive (default OFF — the mob convention: a box-per-bone
 *     rig self-shadows under the near-overhead sun and AgX crushes it black), frustumCulled off (skinned bounds
 *     lie during animation).
 *  3. MATERIAL: apply_avatar_material (kill the raw-glTF metalness gold/black class) + — when pixel_filter —
 *     apply_pixel_filter (Nearest MAG + mipmapped MIN + aniso for the tiny pixel-art atlases, plus the albedo
 *     emissive floor that lifts faces the sun can't reach). Players omit pixel_filter (their high-res skin
 *     wants the smooth Linear default).
 *
 * @param {import('three').Object3D} model the loaded/cloned rig root (NOT wrapped — this is the GLB scene)
 * @param {object} opts
 * @param {number | null} [opts.target_height] world-block height to NORMALISE the rig to (player: CHARACTER_HEIGHT
 *   / the fight-board's BOARD_PLAYER_HEIGHT). Omit/null for a MOB ⇒ intrinsic sizing (the GLB's authored
 *   size × the unit calibration, clamped — see HYTALE_BLOCKS_PER_GLB_UNIT / MOB_MIN_H / MOB_MAX_H above).
 * @param {boolean} [opts.cast_shadow] cast into the sun shadow map (default true)
 * @param {boolean} [opts.receive_shadow] sample the shadow map (default false — the mob convention)
 * @param {boolean} [opts.pixel_filter] apply the pixel-art sampler + emissive floor (mobs true, players false; default false)
 * @param {string | null} [opts.label] model identifier (template name / GLB url) for the clamp warn log only —
 *   never affects sizing.
 * @returns {{ height: number, min_y: number }} scaled extents (world units, pre-grounding — the caller grounds)
 */
export function prepare_mob_render(
  model,
  { target_height = null, cast_shadow = true, receive_shadow = false, pixel_filter = false, label = null }
) {
  model.scale.setScalar(1)
  model.updateWorldMatrix(true, true)
  const raw_height = new Box3().setFromObject(model).getSize(new Vector3()).y
  const measured_height = raw_height > 0.05 ? raw_height : 1
  let final_height
  if (target_height != null && target_height > 0) {
    final_height = target_height // explicit normalise — the PLAYER path only
  } else {
    // MOB INTRINSIC (constraint: sizes stay true to source) — the authored height through the unit
    // calibration; the clamp fires only on broken exports + the giant bosses (see the rationale above).
    const intrinsic = measured_height * HYTALE_BLOCKS_PER_GLB_UNIT
    final_height = Math.min(MOB_MAX_H, Math.max(MOB_MIN_H, intrinsic))
    if (final_height !== intrinsic)
      console.warn(
        `[mob_model] "${label ?? (model.name || 'unnamed')}" intrinsic height ${intrinsic.toFixed(2)} blocks outside [${MOB_MIN_H}, ${MOB_MAX_H}] — clamped to ${final_height.toFixed(2)}`
      )
  }
  model.scale.setScalar(final_height / measured_height)

  model.traverse((obj) => {
    const mesh = /** @type {any} */ (obj)
    if (!mesh.isMesh) return
    mesh.castShadow = cast_shadow
    mesh.receiveShadow = receive_shadow
    mesh.frustumCulled = false // a skinned mesh's static bounds lie during animation → don't cull
  })
  apply_avatar_material(model) // kill the raw-glTF metalness (the gold/black class) — ONE home, shared with the player
  if (pixel_filter) apply_pixel_filter(model) // mob rigs: Nearest MAG + mipmap MIN + aniso + albedo emissive floor

  const scaled = new Box3().setFromObject(model)
  return { height: scaled.max.y - scaled.min.y, min_y: scaled.min.y }
}
