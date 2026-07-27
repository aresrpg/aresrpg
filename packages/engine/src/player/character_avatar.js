// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Character avatar (ENG-8) — loads the default AresRPG character GLB (DRACO-compressed, the SAME rig
// the dapp ships: senshi_male, copied into engine/assets/characters) and drives its animation state
// machine from the controller's `anim` state with cross-fade transitions. Ports the clip-selection +
// crossfade approach of packages/frontend player-model.js / character-glb.js (IDLE/WALK/RUN/JUMP/
// JUMP_RUN/FALL clips, 0.2 s FADE, exact-name-first resolution so 'RUN' never matches 'JUMP_RUN'), but
// self-contained. [D193 REVERSAL of the original "recolour stays a frontend concern" call: the
// frontend's customizable-texture.js composites via WebGLRenderer render-targets — DEAD under the
// WebGPU renderer — so the 3-mask on-chain recolour now lives HERE, composited on CPU pixels
// (exact legacy shader math, see compose_pixels), plus an optional hair_url mounted on the Head
// bone and a metalness clamp (metalness=1 exports render BLACK without an envmap).] Scales the bind-pose to CHARACTER_HEIGHT from the
// measured bounding box (no magic scale constant) and turns the model to face the controller heading.
//
// ASSET PATHS resolve via `new URL(..., import.meta.url)` — the SAME idiom engine.js uses for worker
// URLs — so Vite emits the GLB + DRACO decoder as served assets in dev AND `vite build`. The default
// GLB path is overridable via `opts.glb_url` (config-first) for a future character-select.

import { AnimationMixer, CanvasTexture, Color, Group, LoopOnce, LoopRepeat, SRGBColorSpace } from 'three'

import { CHARACTER_HEIGHT } from '../config/world_config.js'
// Default character GLB shipped with the engine (copied from the dapp's senshi_male rig). Imported
// with Vite's `?url` so the bundler emits it as a served asset in dev AND `vite build` (a bare
// `new URL(...import.meta.url)` to a file OUTSIDE a served root 404s under the dev server). Under
// `bun test` / tsc this import is never executed (create_character_avatar is browser-only), and the
// `?url` suffix resolves to the string path — harmless.
import DEFAULT_GLB_URL from '../../assets/characters/senshi_male.glb?url'
// [C1 SLICED COMPILE] the player-branch rig warms its pipelines through the engine's warm queue before
// mounting (factory mobs arrive pre-warmed by create_mob_model; no registered queue ⇒ immediate resolve).
import { warm_pipelines_once } from '../render/pipeline_warm_queue.js'

// [one-mob-sdk 2026-07-13] the shared mob-render primitives moved to mob_model.js (the single home); the avatar
// builds its recolour/hair/beat rig ON them, so the dependency flows one way (this → mob_model), no cycle.
import { apply_avatar_material, load_glb_checked, prepare_mob_render } from './mob_model.js'

/** Crossfade duration between animation states (player-model.js FADE = 0.2 s). */
const FADE = 0.2
/** Water resistance for the dry WALK fallback only; a dedicated SWIM keeps its authored cadence. */
const SWIM_WALK_TIME_SCALE = 0.7

/** The avatar accepts every controller anim state PLUS 'SIT' — a rider pose the controller never emits
 *  (TR-97 mounts: the seated body loops SIT while the mount walks). @typedef {import('./controller.js').PlayerAnim | 'SIT'} AvatarAnim */

/** Preference-ordered clip resolution per anim state. EXACT (upper-case) name first, then substring —
 *  exact-first is critical so 'RUN' doesn't match 'JUMP_RUN' (the dapp's documented bug). Values are
 *  fallback chains: the first clip that exists wins. None of the shipped character rigs has SWIM, so
 *  moving underwater uses a slowed WALK as a paddling approximation; a future SWIM clip still wins.
 *  SIT (TR-97 riders) exists on the senshi/yajin rigs; shugo/tomoda ship none → a seated IDLE. */
const ANIM_PREFS = /** @type {Record<AvatarAnim, string[]>} */ ({
  IDLE: ['IDLE'],
  WALK: ['WALK', 'RUN'],
  RUN: ['RUN', 'WALK'],
  JUMP: ['JUMP'],
  JUMP_RUN: ['JUMP_RUN', 'JUMP', 'RUN'],
  FALL: ['FALL', 'JUMP'],
  SWIM: ['SWIM', 'WALK', 'IDLE'],
  SIT: ['SIT', 'IDLE'],
})

/**
 * @typedef {object} CharacterAvatar
 * @property {Group} object3d the scene node to add via engine.add_to_scene — position it at the
 *   player's FEET (its origin is the model's feet: bind-pose min-y sits at the group origin).
 * @property {(anim: AvatarAnim, facing_yaw: number, dt: number) => void}
 *   update drives the mixer, crossfades to the target anim clip, and turns the model to `facing_yaw`.
 * @property {number} eye_height world-space head height above the feet (for the camera FP converge) —
 *   the measured head bone height, or a CHARACTER_HEIGHT fallback.
 * @property {boolean} ready true once the GLB has loaded (before that, update() is a safe no-op).
 * @property {(clip_name: string) => number | null} clip_duration ENG-16: duration (s) of a clip by
 *   upper-case name, or null if the rig has no such clip. Lets the tactical rig compute a beat's
 *   impact time (impact_fraction × duration) — the W4 keystone.
 * @property {(clip_name: string) => number | null} play_beat ENG-16: fire a ONE-SHOT clip (LoopOnce,
 *   clampWhenFinished) crossfaded from the current loop; returns its duration (s) or null if missing.
 *   The tactical fight rig drives attack/death beats through this; locomotion still goes via update().
 * @property {(dt: number) => void} tick ENG-16: advance the mixer WITHOUT changing the active loop —
 *   used while a one-shot beat is playing (update() would crossfade back to a locomotion clip).
 * @property {(colors: [string|number, string|number, string|number]) => void} set_colors [D193] apply
 *   the on-chain 3-color customization (CPU-composited into the _base/_colorN mask textures — WebGPU
 *   safe; ~ms cost per call, no-op before ready or on rigs without customizable layers).
 * @property {() => void} dispose stops the mixer + frees geometry/materials.
 */

/**
 * [D193] The exact legacy compositor blend on raw pixels — port of the frontend's
 * customizable-texture.js fragment shader + blend state: mask texels with alpha < 0.5 are DISCARDED;
 * others write `src.rgb·color` alpha-blended over the accumulator (SrcAlpha/OneMinusSrcAlpha) while
 * the accumulator's ALPHA is never touched (legacy blendSrcAlpha=Zero, blendDstAlpha=One). Pure —
 * unit-tested headless (avatar.test.js).
 * @param {Uint8ClampedArray} out RGBA accumulator, pre-filled with the base texture's pixels
 * @param {Uint8ClampedArray} mask RGBA mask layer (same dimensions)
 * @param {[number, number, number]} rgb layer color in 0..1
 */
export function compose_pixels(out, mask, rgb) {
  for (let i = 0; i < out.length; i += 4) {
    const a = mask[i + 3] ?? 0
    if (a < 128) continue // the shader's `if (sampled.a < 0.5) discard`
    const sa = a / 255
    const inv = 1 - sa
    out[i] = (mask[i] ?? 0) * (rgb[0] ?? 1) * sa + (out[i] ?? 0) * inv
    out[i + 1] = (mask[i + 1] ?? 0) * (rgb[1] ?? 1) * sa + (out[i + 1] ?? 0) * inv
    out[i + 2] = (mask[i + 2] ?? 0) * (rgb[2] ?? 1) * sa + (out[i + 2] ?? 0) * inv
  }
}

/** Draw a texture image to raw pixels (browser canvas-2D path). @param {*} image
 * @returns {{ data: Uint8ClampedArray, width: number, height: number } | null} */
function image_pixels(image) {
  if (!image || typeof document === 'undefined' || !image.width || !image.height) return null
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(image, 0, 0)
  return ctx.getImageData(0, 0, image.width, image.height)
}

/** Find `<base>_base` + `<base>_color1/2/3` texture groups (the legacy naming contract) reachable
 * from a model's materials, with the materials that use each base map. @param {import('three').Object3D} model */
function find_customizable_groups(model) {
  /** @type {Map<string, *>} */ const textures = new Map()
  /** @type {Map<string, *[]>} */ const users = new Map()
  model.traverse((/** @type {*} */ child) => {
    const mat = child.material
    if (!mat || Array.isArray(mat)) return
    for (const tex of [mat.map, mat.emissiveMap]) if (tex?.name) textures.set(tex.name, tex)
    if (mat.map?.name) {
      if (!users.has(mat.map.name)) users.set(mat.map.name, [])
      users.get(mat.map.name)?.push(mat)
    }
  })
  const groups = new Map()
  for (const [name, base] of textures.entries()) {
    const m = name.match(/^(.+)_base$/)
    if (!m || !m[1]) continue
    const masks = new Map()
    for (const layer of ['color1', 'color2', 'color3']) {
      const t = textures.get(`${m[1]}_${layer}`)
      if (t) masks.set(layer, t)
    }
    if (masks.size) groups.set(m[1], { base, masks, materials: users.get(name) ?? [] })
  }
  return groups
}

/** Find a bone by name anywhere under a model (hair mounts on 'Head') — the DAPP's proven matching rule
 * (models.js port, D196): first BONE whose name CONTAINS the query, case-insensitive, so 'Head' resolves
 * 'mixamorig:Head'. The previous exact-`===` match found nothing on the shipped rigs → the hair fetch
 * inside `if (head)` silently never fired (bald walk avatars, reported). @param {import('three').Object3D} origin
 * @param {string} name @returns {import('three').Object3D | null} */
function find_bone(origin, name) {
  /** @type {import('three').Object3D | null} */ let bone = null
  const want = name.toLowerCase()
  origin.traverse((o) => {
    if (!bone && /** @type {*} */ (o).isBone && o.name.toLowerCase().includes(want)) bone = o
  })
  return bone
}

// Character bodies keep their recolour/hair/beat adapter here. Mob loading and material preparation live only
// in mob_model.js; the tactical board injects that factory and reuses this file solely for animation controls.

/**
 * Loads + wires the default character avatar. Returns an avatar handle SYNCHRONOUSLY (its object3d is
 * an empty Group that fills in when the async GLB load resolves — the caller can add it to the scene
 * immediately and start calling update(); both no-op until `ready`). Loading off the hot path keeps
 * the demo boot non-blocking. On load failure it logs + stays not-ready (never throws into the frame
 * loop) — the controller/collision still run, just with no visible mesh.
 * @param {object} [opts]
 * @param {string} [opts.glb_url] override the default character GLB (config-first character-select).
 * @param {string} [opts.hair_url] [D193] optional hair GLB mounted as a child of the 'Head' bone
 *   (the production no-helmet path — inherits the bone's skinned transform).
 * @param {[string|number, string|number, string|number] | null} [opts.colors] [D193] the on-chain
 *   customization [color1, color2, color3]; applied once loaded (also settable via set_colors).
 * @param {boolean} [opts.cast_shadow] whether the avatar casts into the sun shadow map (default true).
 * @param {number | null} [opts.scale] explicit humanoid height override in world blocks. Fight players use
 *   BOARD_PLAYER_HEIGHT; factory-built mobs already carry their intrinsic scale and ignore this option.
 * @param {boolean} [opts.receive_shadow] player-body shadow receiving, default true. Mob callers use
 *   mob_model_factory, whose shared policy owns the mob shadow convention instead of this option.
 * @param {((url:string, opts?:{label?:string|null}) => Promise<{root:import('three').Object3D,
 *   clips:import('three').AnimationClip[], measured:{height:number,min_y:number}, dispose:()=>void}>) | null}
 *   [opts.mob_model_factory] board mobs inject the shared create_mob_model factory; players omit it and keep
 *   the character-only loader/recolour/hair path.
 * @returns {CharacterAvatar}
 */
export function create_character_avatar({
  glb_url = DEFAULT_GLB_URL,
  hair_url = undefined,
  colors = null,
  cast_shadow = true,
  scale = null,
  receive_shadow = true,
  mob_model_factory = null,
} = {}) {
  const root = new Group()
  root.name = 'player_avatar'

  /** @type {AnimationMixer | null} */
  let mixer = null
  /** @type {Map<string, import('three').AnimationAction>} */
  const actions = new Map()
  /** ENG-16: clip durations (s) by upper-case name — the tactical rig's impact-time math reads these. */
  const durations = new Map()
  /** @type {import('three').AnimationAction | null} */
  let active = null
  let active_name = ''
  let eye_height = CHARACTER_HEIGHT * 0.9
  let disposed = false
  let dispose_loaded_model = () => dispose_tree(root)

  /** [D193] pending colors (set before load resolves) + composited texture state per base group. */
  let pending_colors = colors
  /** @type {Map<string, { canvas: *, texture: *, base_pixels: *, mask_pixels: Map<string, *> }>} */
  const composited = new Map()

  const handle = /** @type {CharacterAvatar} */ ({
    object3d: root,
    eye_height,
    ready: false,
    update() {}, // replaced on load
    clip_duration: () => null, // replaced on load
    play_beat: () => null, // replaced on load
    tick: () => {}, // replaced on load
    set_colors(next) {
      pending_colors = next // applied on load; live immediately after (replaced then)
    },
    dispose() {
      if (disposed) return
      disposed = true
      mixer?.stopAllAction()
      for (const state of composited.values()) state.texture.dispose()
      composited.clear()
      dispose_loaded_model()
    },
  })

  const on_model_loaded = (/** @type {any} */ gltf, /** @type {any} */ mob_model = null) => {
    if (disposed) {
      if (mob_model) mob_model.dispose()
      else dispose_tree(gltf.scene)
      return
    }
    const model = mob_model?.root ?? gltf.scene
    // Board mobs arrive fully prepared by create_mob_model — the same cached clone/material factory the
    // overworld uses. Players alone take the character loader branch and prepare their humanoid body here.
    // A factory mob already has intrinsic sizing and its fixed material/shadow policy. Character bodies still
    // height-normalise here (explicit fight scale or CHARACTER_HEIGHT) before recolour/hair composition.
    const measured =
      mob_model?.measured ??
      prepare_mob_render(model, {
        target_height: scale != null && scale > 0 ? scale : CHARACTER_HEIGHT,
        cast_shadow,
        receive_shadow,
        label: glb_url,
      })
    if (mob_model) dispose_loaded_model = mob_model.dispose
    // [C1 SLICED COMPILE] the player branch's first-of-GLB rig renders one epsilon-scaled warm frame
    // (engine warm queue) BEFORE mounting under `root` (already in the scene), so the avatar's first
    // visible frame hits warm scene+shadow pipeline caches instead of sync-compiling them — the
    // post-login residual freeze class. Factory mobs arrive pre-warmed by create_mob_model (same key,
    // deduped). The visual fallback during the warm is today's exact loading state: an empty group.
    if (mob_model) mount_prepared()
    else
      warm_pipelines_once(glb_url, model).then(() => {
        if (disposed)
          dispose_tree(model) // torn down mid-warm — free the never-mounted rig
        else mount_prepared()
      })

    /** The original mount tail (ground-drop → recolour → hair → mixer → ready), split out verbatim so
     *  the pipeline warm above can precede it on the player branch. */
    function mount_prepared() {
      // Drop the model so its FEET (min-y) sit at the group origin — placing the group at the player's feet then
      // lands the model exactly on the ground.
      model.position.y -= measured.min_y
      eye_height = measured.height * 0.9 // head height above the feet — the FP camera converge target
      handle.eye_height = eye_height
      root.add(model)

      // ── [D193] on-chain recolour: the _base/_colorN groups composited on CPU pixels ────────────
      // [D228] an ENTRY LIST, not a name map: the HAIR GLB arrives async LATER and carries its own
      // groups under the SAME texture names as the body ('diffuse_base', …) — the legacy compositor
      // kept body_colors and hair_colors separate for exactly this reason. Entries append as parts
      // arrive; apply_colors iterates them all, so a late hair inherits the last-applied colors.
      const group_entries = [...find_customizable_groups(model).values()]
      let last_colors = /** @type {[string|number, string|number, string|number] | null} */ (null)
      function ensure_state(/** @type {*} */ group) {
        const existing = composited.get(group)
        if (existing) return existing
        const base_pixels = image_pixels(group.base.image)
        if (!base_pixels) return null
        const canvas = document.createElement('canvas')
        canvas.width = base_pixels.width
        canvas.height = base_pixels.height
        const texture = new CanvasTexture(canvas)
        texture.colorSpace = SRGBColorSpace
        texture.flipY = group.base.flipY // GLB textures ship flipY=false — the canvas copy must match
        texture.wrapS = group.base.wrapS
        texture.wrapT = group.base.wrapT
        const mask_pixels = new Map()
        for (const [layer, tex] of group.masks.entries()) {
          const px = image_pixels(tex.image)
          if (px) mask_pixels.set(layer, px)
        }
        // swap each material using `<base>_base` onto the composited canvas (clone so a shared parsed
        // scene never recolours another character — the legacy rule)
        for (const m of group.materials) {
          const clone = m.clone()
          clone.map = texture
          clone.needsUpdate = true
          model.traverse((/** @type {*} */ child) => {
            if (child.material === m) child.material = clone
          })
        }
        const state = { canvas, texture, base_pixels, mask_pixels }
        composited.set(group, state)
        return state
      }
      function apply_colors(/** @type {[string|number, string|number, string|number]} */ next) {
        last_colors = next
        const rgb = next.map((c) => {
          const col = new Color(c)
          return /** @type {[number, number, number]} */ ([col.r, col.g, col.b])
        })
        for (const group of group_entries) {
          const state = ensure_state(group)
          if (!state) continue
          const out = new Uint8ClampedArray(state.base_pixels.data)
          const layer_names = ['color1', 'color2', 'color3']
          for (let i = 0; i < layer_names.length; i += 1) {
            const mask = state.mask_pixels.get(layer_names[i])
            const c = rgb[i]
            if (mask && c) compose_pixels(out, mask.data, c)
          }
          const ctx = state.canvas.getContext('2d')
          if (!ctx) continue
          ctx.putImageData(new ImageData(out, state.base_pixels.width, state.base_pixels.height), 0, 0)
          state.texture.needsUpdate = true
        }
      }
      handle.set_colors = apply_colors // live from here
      if (pending_colors) apply_colors(pending_colors)

      // ── [D193] hair: the production no-helmet path — a child of the Head bone ──────────────────
      if (hair_url) {
        const head = find_bone(model, 'Head')
        if (head) {
          void load_glb_checked(hair_url).then(
            (hair_gltf) => {
              head.clear() // the atomic no-double-headgear rule (no-op on a bare Head bone)
              head.add(hair_gltf.scene)
              // [D228 COMPLETED — hair was not taking colors into account.] The
              // entry-list contract the comment above promises was never finished: the hair GLB's own
              // <base>_base/_colorN groups must REGISTER into group_entries and inherit the last-applied
              // colors — without this, hair rendered its base texture on EVERY engine surface (fight board,
              // lobby, remote peers) while the creation pedestal (its own legacy compositor) colored it — the
              // exact preview-vs-world mismatch reported. Hair also gets the same metalness clamp as the body
              // (it loads after the :291 pass). ensure_state's clone-swap traverses `model`, and the Head bone
              // is inside it, so the hair meshes are covered.
              apply_avatar_material(hair_gltf.scene)
              for (const g of find_customizable_groups(hair_gltf.scene).values()) group_entries.push(g)
              if (last_colors) apply_colors(last_colors)
            },
            (err) => console.warn('[character_avatar] hair GLB load failed (bald, not broken):', hair_url, err)
          )
        } else {
          // LOUD (D196): a silent skip here shipped bald avatars for a night — never quiet again.
          console.warn('[character_avatar] no Head bone found — hair skipped (bald, not broken):', glb_url)
        }
      }

      const clips = mob_model?.clips ?? gltf.animations ?? []
      if (clips.length) {
        mixer = new AnimationMixer(model)
        // pre-build one action per clip (by upper-case name) so state changes are just fade swaps
        for (const clip of clips) {
          const action = mixer.clipAction(clip)
          action.setLoop(LoopRepeat, Infinity)
          actions.set(clip.name.toUpperCase(), action)
          durations.set(clip.name.toUpperCase(), clip.duration ?? 0)
        }
        // start on IDLE (never show the bind T-pose). A creature rig with NO idle-ish clip (some reference-corpus critters
        // ship RUN-only) resolves '' and would freeze in its raw bind pose — fall back to the FIRST clip, matching
        // the roam/dungeon mob loaders (idle_clip = clips.find(/idle/) ?? clips[0]) so a fight mob is never a
        // frozen T-pose. [one-mob-sdk 2026-07-13] — a real IDLE (every player rig) is unaffected.
        play('IDLE', 0)
        if (!active_name && clips[0]) play(/** @type {any} */ (clips[0].name.toUpperCase()), 0)
      }

      handle.ready = true
      handle.update = update
      handle.clip_duration = clip_duration
      handle.play_beat = play_beat
      handle.tick = (dt) => mixer?.update(dt)
    }
  }
  const on_model_error = (/** @type {any} */ err) => console.warn('[character_avatar] GLB load failed:', glb_url, err)
  if (mob_model_factory)
    void mob_model_factory(glb_url, { label: glb_url }).then((model) => on_model_loaded(null, model), on_model_error)
  else void load_glb_checked(glb_url).then(on_model_loaded, on_model_error)

  /**
   * Resolves a clip name for an anim state (exact-first, then substring) and crossfades to it.
   * @param {AvatarAnim} anim
   * @param {number} fade seconds (0 = instant, for the initial IDLE)
   */
  function play(anim, fade) {
    const name = resolve_clip(anim)
    if (!name) return
    const next = actions.get(name)
    if (!next) return
    const time_scale = anim === 'SWIM' && name === 'WALK' ? SWIM_WALK_TIME_SCALE : 1
    // WALK can remain the resolved clip across a water/land boundary; restore its authored cadence
    // even when no crossfade is needed because the active action itself did not change.
    if (name === active_name) {
      next.setEffectiveTimeScale(time_scale)
      return
    }
    next.reset()
    next.setEffectiveTimeScale(time_scale)
    next.enabled = true
    next.setEffectiveWeight(1)
    // Restore looping in case this action was last used as a one-shot beat (play_beat set LoopOnce).
    next.setLoop(LoopRepeat, Infinity)
    next.clampWhenFinished = false
    if (active && fade > 0) {
      next.crossFadeFrom(active, fade, false)
      next.play()
    } else {
      active?.stop()
      next.play()
    }
    active = next
    active_name = name
  }

  /**
   * @param {AvatarAnim} anim
   * @returns {string} the resolved (upper-case) clip name present in the rig, or ''.
   */
  function resolve_clip(anim) {
    const prefs = ANIM_PREFS[anim] ?? [anim]
    // exact match first (across all prefs), then substring
    for (const pref of prefs) if (actions.has(pref)) return pref
    for (const pref of prefs) {
      for (const key of actions.keys()) if (key.includes(pref)) return key
    }
    return ''
  }

  /** @type {CharacterAvatar['update']} */
  function update(anim, facing_yaw, dt) {
    play(anim, FADE)
    // The model's own +Z is its FORWARD. `facing_yaw` (controller heading = atan2(dir_x,dir_z)) already
    // points ALONG the movement direction, so rotation.y = facing_yaw turns the rig's +Z to face the way
    // it moves — back to the camera on a forward run (shoulder-cam standard). [2026-07-03 bug: was
    // facing_yaw+π, which faced the avatar AT the camera, so pressing forward made it face the camera instead of moving away.]
    root.rotation.y = facing_yaw
    mixer?.update(dt)
  }

  /**
   * ENG-16/D304 — resolve a clip KEY present in the rig: EXACT upper-case match first, then substring
   * (the SAME discipline resolve_clip applies to loco anims). The shipped rigs don't share one naming
   * scheme — senshi_female/yajin_male carry ATTACK_CAC (no plain ATTACK), senshi_female's walk is
   * 'Armature|WALK' — so an exact-only lookup silently dropped their beat/duration lookups (the
   * attacker never swung on those rigs). A genuinely absent clip still resolves null (loudness intact).
   * @param {string} clip_name @returns {string | null}
   */
  function find_clip_key(clip_name) {
    const want = clip_name.toUpperCase()
    if (durations.has(want)) return want
    for (const key of durations.keys()) if (key.includes(want)) return key
    return null
  }

  /**
   * ENG-16 — duration (s) of a clip by name (exact-first, then substring — find_clip_key), or null if
   * the rig has no such clip. The tactical rig uses this to compute a beat's IMPACT time
   * (impact_fraction × duration) and its gait timeScale (D303).
   * @param {string} clip_name @returns {number | null}
   */
  function clip_duration(clip_name) {
    const key = find_clip_key(clip_name)
    return key != null ? (durations.get(key) ?? null) : null
  }

  /**
   * ENG-16 — fire a ONE-SHOT clip (attack / death / …) crossfaded from the current locomotion loop.
   * LoopOnce + clampWhenFinished so it holds the final pose (a death stays down). Returns the clip
   * duration (s) or null if the rig has no such clip (the caller LOUD-errors on null — W4 keystone).
   * Name resolution is exact-first-then-substring (find_clip_key — the ATTACK_CAC rigs, D304).
   * The caller drives the mixer via `tick(dt)` while the beat plays (update() would fade back to a
   * locomotion loop). @param {string} clip_name @returns {number | null}
   */
  function play_beat(clip_name) {
    const name = find_clip_key(clip_name)
    if (!name || !mixer) return null
    const action = actions.get(name)
    if (!action) return null
    action.reset()
    action.enabled = true
    action.setEffectiveWeight(1)
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = true
    if (active && active !== action) action.crossFadeFrom(active, FADE, false)
    action.play()
    active = action
    active_name = name
    return durations.get(name) ?? 0
  }

  return handle
}

/**
 * Frees all geometry + materials under a node (dispose hygiene). @param {import('three').Object3D} node
 */
function dispose_tree(node) {
  node.traverse((obj) => {
    const mesh = /** @type {any} */ (obj)
    mesh.geometry?.dispose?.()
    const mat = mesh.material
    if (Array.isArray(mat)) mat.forEach((m) => m?.dispose?.())
    else mat?.dispose?.()
  })
}
