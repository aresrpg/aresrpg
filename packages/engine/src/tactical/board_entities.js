// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Tactical-board entity lifecycle: idempotent avatar upsert/remove, constant-speed waypoint locomotion,
// impact-frame attack/hit/death beats, and camera-facing combat floats. The board rAF calls tick(dt).

import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Mesh,
  SkinnedMesh,
  Sprite,
  SpriteMaterial,
} from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { normalLocal, positionLocal, uniform } from 'three/tsl'

import { create_character_avatar } from '../player/character_avatar.js'
import { create_mob_model } from '../player/mob_model.js'
import { create_worn_cosmetics } from '../player/worn_cosmetics.js'
import { attach_invisibility_heat_haze } from '../render/invisibility_heat_haze.js'

import { FLOOR_THICKNESS } from './board.js'
import { entity_id_at_cell } from './board_entity_picking.js'
import {
  BOARD_PLAYER_HEIGHT,
  create_capsule_placeholder,
  dispose_capsule_placeholder,
  placeholder_body_of,
} from './entity_placeholder.js'
import { install_pos_trace } from './pos_trace.js'
import { weld_smoothed_normals } from './smooth_normals.js'

export { entity_id_at_cell }

// BOARD_PLAYER_HEIGHT (the fight-only player height; mob size is intrinsic and owned by create_mob_model)
// now lives beside the model-miss body that must match it — entity_placeholder.js, imported above.

/** Mob body trees stay identical to the overworld factory output; only players may get the fight shell. */
export const entity_outline_color = (
  /** @type {string | undefined} */ kind,
  /** @type {number | null | undefined} */ outline
) => (kind === 'mob' ? null : (outline ?? null))

// ── [team-outline] INVERTED-HULL SILHOUETTE ─────────────────────────────────────────────────────────
// Players keep the classic BackSide outline. Its cloned shell uses position-welded normals so only the outer
// silhouette protrudes; mobs never receive the shell and retain the factory body tree exactly.
const OUTLINE_THICKNESS = 0.045

// ── IMPACT-FRAME METADATA TABLE (the W4 keystone) ──────────────────────────────────────────────────
// Derived by inspecting senshi_male.glb (bun GLB JSON parse, 2026-07-04): the rig carries ATTACK
// (1.967 s), DEATH (2.100 s), and locomotion clips (WALK 0.833 s, RUN 0.667 s, IDLE 7.667 s) but NO
// dedicated HIT clip — and the 2026-07-06 FULL-FLEET scan (every character class/sex GLB + every mob
// GLB under frontend public) found NO HIT/FLINCH/IMPACT clip on ANY rig. Fields: `clip` = the GLB clip
// driven; `impact` = the fraction of the clip at which the "hit lands" (the moment the dapp's rendered
// damage is applied); `end` = OPTIONAL fraction at which the clip is CUT and the mixer handed back to
// locomotion (a crossfaded recoil, not a completed motion). Every impact is a DESIGN CONSTANT well
// BELOW 1.0 so the beat resolves MID-CLIP (impact ≠ end — the property the acceptance video must show):
//   attack — weapon CONTACT lands ~60 % through the wind-up→swing→follow-through (
//            "weapon contact ≈ 55-65 %"; was 0.45, which read a touch early). A FRACTION, not a time, so
//            it's correct on every rig's ATTACK/ATTACK_CAC clip regardless of length (senshi_male 1.967 s,
//            yajin ATTACK_CAC 2.042 s, hophop 0.625 s…).
//   death  — the body's killing collapse reads at ~mid clip; the rest is the settle.
//   hit    — [D304 SUPERSEDED 2026-07-11: a hit reaction read as the mob playing its attack
//            animation] D304 reused ATTACK's opening jerk-back for the victim recoil — WRONG: even the
//            first 30-35 % of a swing IS the wind-up, so a struck body visibly played "about to attack",
//            never "got hit". THE LAW now: a hit reaction NEVER resolves to an attack-family clip, full
//            stop. `clip: 'HIT'` names the rig's OWN dedicated flinch clip — ladder rung 1, auto-wired by
//            the SAME clip_duration/find_clip_key lookup every other anim uses (a future rig that ships a
//            real HIT/FLINCH clip is picked up with ZERO code changes here). NO current rig has one (the
//            2026-07-06 fleet scan), so `hit` always takes the KNOWN-BUT-CLIPLESS branch below today —
//            ladder rung 2: the victim plays NO clip (stays in its loco loop) while the PROCEDURAL
//            reaction system (react_to_impact/advance_recoil, further down this file) supplies the
//            flinch — a magnitude-scaled recoil + shake-jitter + tip, entirely position/scale/rotation,
//            never a clip. Ladder rung 3 (never nothing) is the same clipless-quiet path every RUN-only
//            mob already takes for `attack`/`death` — impact still resolves on schedule, just silently.
// THREE outcomes, not two (resolve_impact): (1) a KNOWN anim whose clip this rig HAS ⇒ play it, resolve at
// fraction × real duration; (2) a KNOWN anim whose clip this rig LACKS ⇒ the EXPECTED clipless path (the
// many RUN-only mob rigs — aragne/bunny/frog/mouse ship IDLE+RUN only; the kokushibo caster ships no
// ATTACK; EVERY rig today for `hit`): NO clip plays, the beat still resolves at fraction × a nominal
// length, and it is QUIET (it must not spam twice per fight); (3) an UNKNOWN anim (not
// in this table — a typo or a future beat) ⇒ the LOUD `known:false` path in entity_beat — the whole point
// of a named table is that a genuinely missing entry is caught LOUDLY while an expected rig-capability gap
// stays silent.
/** @type {Record<string, { clip: string, impact: number, end?: number }>} */
export const IMPACT_FRAMES = {
  // attack — the swing's weapon CONTACT frame at 60 % (range: 55-65 %); duration-independent.
  attack: { clip: 'ATTACK', impact: 0.6 },
  // death — the killing collapse reads ~mid clip; the rest is the settle.
  death: { clip: 'DEATH', impact: 0.5 },
  // hit — [D304 superseded] the rig's OWN flinch clip if it ever ships one; every current rig is clipless
  //   here ⇒ impact/end read as fractions of the NOMINAL 0.8 s fallback (≈0.24 s / 0.28 s) — the window the
  //   procedural recoil (react_to_impact) is armed within. NEVER 'ATTACK' — see the law above.
  hit: { clip: 'HIT', impact: 0.3, end: 0.35 },
}

/** Fallback impact fraction for an unmapped beat anim — the resolve-at-MIDPOINT fallback (contract). */
const FALLBACK_IMPACT = 0.5
/** Fallback clip duration (s) when even the fallback clip is missing — a nominal beat length. */
const FALLBACK_DURATION = 0.8

/**
 * Resolves the impact TIME (seconds into the clip) for a beat anim against an avatar's real clip
 * durations. Pure + exported so the whole classification is unit-testable without a GLB. Reports two
 * orthogonal booleans: `known` (the anim is in IMPACT_FRAMES) and `mapped` (a real rig clip resolved and
 * will PLAY). The three outcomes: (1) known & rig HAS the clip ⇒ known+mapped, play `clip`, impact at
 * fraction × real duration; (2) known & rig LACKS the clip (a RUN-only mob) ⇒ known but NOT mapped,
 * `clip:null` so no swing plays, impact at fraction × a NOMINAL beat length (quiet — the expected case);
 * (3) UNKNOWN anim ⇒ neither known nor mapped, `clip:null`, midpoint fallback (the caller LOUD-errors off
 * `known:false`). [D304] `end_time` = when the beat CLIP is cut and the mixer handed back to locomotion:
 * the clip/nominal end, unless the table carries an `end` fraction — then end×duration, clamped into
 * [impact_time, duration] so the impact resolve (the bar-release contract) can never be cut off.
 *
 * @param {string} anim beat anim name (attack/hit/death/…)
 * @param {(clip_name: string) => number | null} clip_duration avatar clip-duration lookup
 * @returns {{ clip: string | null, impact_time: number, duration: number, end_time: number, mapped: boolean, known: boolean }}
 */
export function resolve_impact(anim, clip_duration) {
  const meta = IMPACT_FRAMES[anim]
  if (meta) {
    const dur = clip_duration(meta.clip)
    if (dur != null && dur > 0) {
      const impact_time = dur * meta.impact
      const end_time = meta.end != null ? Math.min(dur, Math.max(dur * meta.end, impact_time)) : dur
      return { clip: meta.clip, impact_time, duration: dur, end_time, mapped: true, known: true }
    }
    // KNOWN beat, but this rig has NO such clip — the EXPECTED case for the many RUN-only mob rigs
    // (aragne/bunny/frog/mouse ship IDLE+RUN only; the kokushibo caster ships no ATTACK). NOT a defect:
    // it must NOT hit the loud path (regression: it fired twice per fight). The entity can't animate
    // the swing so it stays in its loco loop (clip:null ⇒ beat() skips play_beat), but the beat still
    // resolves at the DESIGNED impact fraction over a nominal length — so a clipless mob's damage/recoil
    // lands at the same RELATIVE instant a rigged one's would (fraction × 0.8 s), not the 0.5 midpoint.
    const nominal = FALLBACK_DURATION
    const impact_time = nominal * meta.impact
    const end_time = meta.end != null ? Math.min(nominal, Math.max(nominal * meta.end, impact_time)) : nominal
    return { clip: null, impact_time, duration: nominal, end_time, mapped: false, known: true }
  }
  // UNKNOWN beat anim (not in IMPACT_FRAMES — a typo at the call site, or a future beat with no entry):
  // the LOUD path (beat() console.errors off `known:false`), resolving at the clip MIDPOINT.
  return {
    clip: null,
    impact_time: FALLBACK_DURATION * FALLBACK_IMPACT,
    duration: FALLBACK_DURATION,
    end_time: FALLBACK_DURATION,
    mapped: false,
    known: false,
  }
}

// ── [D303] GAIT (walk vs run) ───────────────────────────────────────────────────────────────────────
/** Natural ground speed (cells/s) each locomotion clip reads correctly at timeScale 1 — the D303
 *  anchors. WALK: the adapter's walk pace (480 ms/cell). RUN: the historical 4 cells/s default every
 *  RUN-clip mob rig shipped at with timeScale 1 (empirical — no slide reported at that pace).
 *  resolve_gait divides the requested speed by the RESOLVED clip's anchor so feet track the ground on
 *  any rig (2026-07-06 fleet scan: player rigs carry WALK+RUN; most mob rigs are RUN-only — their
 *  'WALK' anim falls back to the RUN clip via ANIM_PREFS, so the anchor must follow the clip). */
export const LOCO_NATURAL_SPEED = { WALK: 1000 / 480, RUN: 4 }

/**
 * Resolves the locomotion anim + mixer timeScale for a walk's gait. Pure (clip lookup injected) so the
 * no-foot-slide math is unit-testable without a GLB. NO gait (legacy callers: demo/bench) ⇒ exactly the
 * pre-D303 behavior (WALK anim, timeScale 1). The clip whose anchor divides the speed mirrors the
 * avatar's ANIM_PREFS fallback (RUN→WALK, WALK→RUN) so the timeScale matches the clip that will
 * actually play — a walk-gait mob on a RUN-only rig gets a slowed run (a trot), never a sliding sprint.
 * @param {'walk' | 'run' | undefined | null} gait the caller's gait pick (the adapter's ≥3-cell law)
 * @param {number} cells_per_second travel speed
 * @param {(clip_name: string) => number | null} clip_duration avatar clip-duration lookup
 * @param {number} [time_scale_override] explicit caller override — wins outright when provided
 * @returns {{ anim: string, time_scale: number }}
 */
export function resolve_gait(gait, cells_per_second, clip_duration, time_scale_override = undefined) {
  if (gait !== 'walk' && gait !== 'run') return { anim: 'WALK', time_scale: time_scale_override ?? 1 }
  const anim = gait === 'run' ? 'RUN' : 'WALK'
  if (time_scale_override != null) return { anim, time_scale: time_scale_override }
  const has = (/** @type {string} */ n) => {
    const d = clip_duration(n)
    return d != null && d > 0
  }
  const other = anim === 'RUN' ? 'WALK' : 'RUN'
  const clip = has(anim) ? anim : has(other) ? other : anim
  return { anim, time_scale: cells_per_second / LOCO_NATURAL_SPEED[/** @type {'WALK' | 'RUN'} */ (clip)] }
}

/**
 * @typedef {object} EntitiesController
 * @property {(spec: { id: string, kind?: string, glb_variant?: string, hair_url?: string, colors?: unknown, scale?: number, cell: { x: number, y: number }, facing?: string, facing_yaw?: number, outline?: number, worn?: WornSlots | null, visual_effect?: { kind:string, active?:boolean } }) => void} upsert
 * @property {(id: string, opts?: { r?: number, g?: number, b?: number, peak?: number }) => void} flash [D257] hit-flash the struck entity
 * @property {(id: string) => void} remove
 * @property {(id: string, waypoints: { x: number, y: number }[], opts?: { cells_per_second?: number, gait?: 'walk' | 'run', loco_time_scale?: number, knockback?: boolean }) => Promise<void>} move
 * @property {(id: string, opts: { anim: string, float?: { text: string, kind?: string }, face?: { x: number, y: number } }) => Promise<void>} beat
 * @property {(id: string, float: { text: string, kind?: string }) => void} float spawn a float over an entity
 * @property {(dt: number, camera: import('three').Camera) => void} tick advance mixers/walks/beats/floats
 * @property {(cell: { x: number, y: number } | null) => (string | null)} id_at_cell the entity standing on a board cell → id (the D1 cell-hitbox hover rule)
 * @property {(id: string) => ({ x: number, z: number } | null)} render_position_of [entity-anchor] an
 *   entity's CURRENT interpolated world XZ — the walk tween's LIVE transform (whatever this frame's
 *   advance_walk has actually reached), never the logical destination cell `move()` snaps `e.cell` to
 *   instantly. Feeds board_highlights.set_entity_anchor so the "cell under a fighter" marker is
 *   physically unable to pre-jump ahead of the walk. Null when the id isn't registered (never
 *   upserted, or already removed/despawned).
 * @property {(id: string) => (number | null)} entity_height_of [reference-faithful-mob-sizes] the measured
 *   rest-pose height (blocks) of an entity's avatar (eye_height/0.9 — the same derivation the pick cylinder
 *   uses), or null for an unregistered id. Head-anchored overlays (the dapp hover tooltip) read this so a
 *   tag rides the REAL body under intrinsic per-creature sizing, never a constant.
 * @property {() => void} dispose
 */

/** @typedef {Parameters<ReturnType<typeof create_worn_cosmetics>['set_slots']>[0]} WornSlots */

/** Facing string → yaw (radians). +y north (+Z), +x east (+X); model +Z is forward. */
const FACING_YAW = { north: 0, south: Math.PI, east: Math.PI / 2, west: -Math.PI / 2 }

/**
 * Creates the entities controller for a board.
 * @param {object} board
 * @param {(x: number, y: number) => [number, number, number]} board.cell_center_world THE cell→world mapper
 * @param {{ x: number, y: number, z: number }} board.origin floor plane = origin.y
 * @param {number} board.cell_size
 * @param {import('../engine.js').EngineApi} engine the engine handle (scene add/remove)
 * @param {{ create_avatar?: typeof create_character_avatar, create_worn?: typeof create_worn_cosmetics }} [deps]
 *   injectable factories — production uses the real avatar/worn-cosmetics rigs; tests inject fakes (the same
 *   fake-board/fake-engine idiom this file's tests already use) so the worn-mount wiring is provable headless.
 * @returns {EntitiesController}
 */
export function create_board_entities(
  board,
  engine,
  { create_avatar = create_character_avatar, create_worn = create_worn_cosmetics } = {}
) {
  const { cell_center_world, origin, cell_size } = board

  /**
   * @typedef {object} Entity
   * @property {ReturnType<typeof create_character_avatar>} avatar
   * @property {{ x: number, y: number }} cell current cell
   * @property {number} facing_yaw
   * @property {null | { path: [number,number,number][], seg: number, t: number, speed: number, cell_size: number, gait?: 'walk' | 'run', time_scale_override?: number, loco: { anim: string, time_scale: number } | null, knockback?: boolean, resolve: () => void }} walk
   * @property {null | { time: number, impact_time: number, duration: number, end_time: number, resolved: boolean, resolve: (value?: any) => void, on_done: (value?: any) => void, float: (null | { text: string, kind?: string }), anim: string, clip: string | null }} beat
   * @property {Sprite[]} floats live float sprites over this entity
   * @property {null | { t: number, r: number, g: number, b: number, peak: number, mats: {material:any, emissive:{r:number,g:number,b:number}}[] | null }} flash [D257] hit-flash state
   * @property {null | { t: number, dx: number, dz: number, mag: number, rest_x: number, rest_z: number, rest_rot_z: number, sx: number, sy: number, sz: number }} recoil [victim-reaction] procedural got-hit flinch (magnitude-scaled translate + shake-jitter + squash)
   * @property {null | { t: number, base_scale_y: number, base_rot_x: number }} death_collapse [victim-reaction] procedural clipless-death collapse (crush + topple) — terminal, never restored
   * @property {number | null} [death_armed_at] [victim-reaction] engine-clock timestamp a death beat's impact landed — the hard-removal belt's clock
   * @property {number} [pick_half] [item 13b] cached horizontal half-extent (m) for the hover-pick cylinder
   * @property {number | null} outline_color [team-outline] team color for the silhouette (null = no outline)
   * @property {import('three').Mesh[] | null} outline [team-outline] built hull shells (null until lazily built once the avatar loads)
   * @property {boolean} invisibility_active whether the cast-resolution seam has armed the vanish
   * @property {ReturnType<typeof attach_invisibility_heat_haze> | null} invisibility live heat-haze shell
   * @property {ReturnType<typeof create_worn_cosmetics> | null} worn_rig [cosmetics-in-fights] equipped
   *   hat/cloak GLB mounts on THIS player's rig (null for mobs) — the roam create_worn_cosmetics mechanism,
   *   fed the desired slots once the async avatar is ready (the same gate embed_voxel_player uses).
   * @property {WornSlots | null} desired_worn the last resolved worn slots to reconcile.
   * @property {import('three').Mesh | null} placeholder [S4] the model-miss capsule body (null when a real
   *   GLB was resolved) — owned here, so removal frees its own buffers.
   */
  /** @type {Map<string, Entity>} */
  const entities = new Map()
  // A cast-result can race the first normal entity upsert. Preserve that resolved status and attach it the
  // moment the avatar arrives instead of dropping the visual until a later state refresh.
  const pending_invisibility = new Set()

  // [pos-trace] flag-gated trajectory tap ("log all glb positions every frame"). Disabled by
  // default ⇒ inert (no globals touched); enabled ⇒ hangs window.__ARES_POS_TRACE + _RESET(). tick() feeds
  // it the live per-frame positions below.
  const pos_trace = install_pos_trace()

  const set_invisibility = (/** @type {Entity} */ entity, /** @type {boolean} */ active) => {
    entity.invisibility_active = active
    if (!active) {
      entity.invisibility?.dispose()
      entity.invisibility = null
    } else {
      // The normal opaque outline would reveal a solid black silhouette through the haze. Drop it while vanished;
      // the ordinary lazy-outline path rebuilds it after a future clear.
      dispose_outline(entity)
      if (entity.avatar.ready && !entity.invisibility)
        entity.invisibility = attach_invisibility_heat_haze(entity.avatar.object3d)
    }
  }

  // [W7] burst stagger — an engine-clock (dt-accumulated, so it's deterministic under test) timestamp of
  // the last float spawned ANYWHERE on this board + its own delay, chained by float_burst_stagger so a
  // multi-hit (same tick or same beat, one entity or several) fans its numbers ~80ms apart.
  let _clock = 0
  let _last_float_at = -Infinity
  let _last_stagger = 0
  const spawn_float_staggered = (/** @type {Entity} */ target, /** @type {{text:string,kind?:string}} */ float) => {
    const stagger = float_burst_stagger(_clock - _last_float_at, _last_stagger)
    _last_float_at = _clock
    _last_stagger = stagger
    // [float-lag] design ruling 2026-07-12: the number appeared slightly too soon, must wait for the vfx to finish. The
    // number is already emitted on the IMPACT beat (never at cast/data time — the adapter fires it at the
    // delivery landing), but it popped the same instant the impact VFX started. spawn_float holds the sprite
    // invisible for `stagger_delay` (age starts negative), so adding FLOAT_IMPACT_LAG_S delays only the number's
    // VISIBLE pop — the sprite is still CREATED in-sequence at the impact beat, so the beat's done-promise and the
    // hit→number→death order (a kill's death still chains off `done`, unaffected) are untouched. The lag
    // is well under the hit clip so the number always reads before the death collapse.
    spawn_float(target, float, engine, stagger + FLOAT_IMPACT_LAG_S)
  }

  const place_avatar = (/** @type {Entity} */ e) => {
    const [cx, , cz] = cell_center_world(e.cell.x, e.cell.y)
    e.avatar.object3d.position.set(cx, origin.y + FLOOR_THICKNESS, cz) // [D291] entities STAND ON the slab top (raised 0.3 off the land — the old sink would be visible)
    e.avatar.object3d.rotation.y = e.facing_yaw
  }

  /** Tear down + drop one entity — the ONE removal path shared by the public `.remove(id)` AND the
   *  [victim-reaction] hard death belt in tick() (a forced depop calls this directly, no `this` reliance).
   *  Safe (no-op) on an id that's already gone — the belt and an upstream adapter-side despawn can both
   *  race to call this for the SAME corpse; only the first does anything. @param {string} id */
  const remove_entity = (/** @type {string} */ id) => {
    const e = entities.get(id)
    if (!e) {
      pending_invisibility.delete(id)
      return
    }
    for (const s of e.floats) engine.remove_from_scene(s)
    // [team-outline] drop the hull shells + free ONLY our own materials BEFORE avatar.dispose: the shells
    // SHARE the avatar geometry/skeleton (REMOVE-ONLY), which avatar.dispose's dispose_tree frees once.
    e.invisibility?.dispose()
    // [cosmetics-in-fights] detach the worn hat/cloak (REMOVE-ONLY — the worn GLB cache owns the GPU buffers;
    // the clones share them, so dispose only unparents) before avatar.dispose frees the rig tree.
    e.worn_rig?.dispose()
    dispose_outline(e)
    // [S4] the placeholder capsule is OURS (the avatar's dispose_tree only frees what the loader mounted).
    dispose_capsule_placeholder(e.placeholder)
    engine.remove_from_scene(e.avatar.object3d)
    e.avatar.dispose()
    entities.delete(id)
  }

  return {
    upsert(spec) {
      let e = entities.get(spec.id)
      // Effect-only update: the dapp's cast-resolution event reaches this existing board seam directly. It must
      // never run the ordinary cell/facing upsert below (that would snap or rotate an animated fighter).
      if (spec.visual_effect?.kind === 'invisibility') {
        const active = spec.visual_effect.active !== false
        if (!e) {
          if (active) pending_invisibility.add(spec.id)
          else pending_invisibility.delete(spec.id)
          return
        }
        set_invisibility(e, active)
        return
      }
      if (!e) {
        // Players keep the character-only hair/recolour loader. Mobs inject create_mob_model: the exact same
        // cached clone + material factory used by overworld spawns, with no board-side material options.
        const avatar = create_avatar({
          glb_url: spec.glb_variant,
          hair_url: spec.hair_url,
          colors: /** @type {[string|number, string|number, string|number] | null} */ (spec.colors ?? null),
          // [board-player-scale] design ruling 2026-07-12: seat the FIGHT player in the mob band (BOARD_PLAYER_HEIGHT)
          // instead of the roam CHARACTER_HEIGHT default, so it's not a giant next to the enemies.
          scale: spec.kind === 'player' ? BOARD_PLAYER_HEIGHT : undefined,
          mob_model_factory:
            spec.kind === 'mob'
              ? (url, opts) => create_mob_model(url, { ...opts, fallback_url: spec.mob_fallback_url })
              : null,
        })
        engine.add_to_scene(avatar.object3d)
        // [S4] MODEL MISS — no glb url resolved for this fighter (an unpublished class/mob model, a catalog
        // gap). The avatar loader has nothing to load, so its root would stay an empty group and the fighter
        // would be INVISIBLE while still acting. Stand a team-tinted capsule in the body's place instead:
        // one home, every board (game, simulator, demo) inherits it.
        const body = placeholder_body_of(spec)
        const placeholder = body ? create_capsule_placeholder(body) : null
        if (placeholder) avatar.object3d.add(placeholder)
        // [cosmetics-in-fights] owner v1.12.31 ②: worn hat/cloak GLBs render on the ROAM avatar but the fight
        // rig ignored them. Build the SAME create_worn_cosmetics rig the roam player uses (bone-child mounts on
        // this avatar's Head/cape) for PLAYERS only — mobs never wear cosmetics. Slots reconcile in tick() once
        // the async avatar is ready (the embed_voxel_player ready-gate; set_slots before bones exist is lost).
        const worn_rig = spec.kind === 'mob' ? null : create_worn({ avatar })
        // [D284] the static team facing is a CREATE-only default — the entity OWNS its facing once alive.
        const facing_yaw = FACING_YAW[/** @type {keyof typeof FACING_YAW} */ (spec.facing ?? 'south')] ?? 0
        // [team-outline] the silhouette color is fixed at CREATE (a fighter never changes team); the shells
        // are built LAZILY in tick() once the async GLB has loaded (the meshes don't exist yet here).
        e = {
          avatar,
          cell: { ...spec.cell },
          facing_yaw,
          walk: null,
          beat: null,
          floats: [],
          flash: /** @type {any} */ (null),
          recoil: null,
          death_collapse: null,
          death_armed_at: null,
          outline_color: entity_outline_color(spec.kind, spec.outline),
          outline: null,
          invisibility_active: pending_invisibility.delete(spec.id),
          invisibility: null,
          worn_rig,
          desired_worn: spec.worn ?? null,
          placeholder,
        }
        entities.set(spec.id, e)
      } else {
        // [D284] idempotent update: move to the new cell ONLY. Do NOT re-apply the static team facing —
        // that unconditional clobber snapped every idle mob back to its default heading on each poll reconcile
        // ("mobs turn back to their default rotation") AND undid the beat-facing fix. Walk-end / beat /
        // the D290 placement override are the only facing writers now.
        e.cell = { ...spec.cell }
        // [cosmetics-in-fights] adopt a re-resolved worn set (equip/unequip mid-fight); omitted ⇒ keep current.
        if (spec.worn !== undefined) e.desired_worn = spec.worn
      }
      // [D290] explicit numeric facing override — a placement re-face toward the opposing band's centroid.
      // Applied on CREATE or UPDATE (so a placement re-pick re-faces), and ONLY when the caller passes it;
      // active-phase upserts omit it, so walk-end / beat facing persists across reconciles.
      if (spec.facing_yaw != null) e.facing_yaw = spec.facing_yaw
      place_avatar(e)
      if (e.invisibility_active) set_invisibility(e, true)
    },

    remove(id) {
      remove_entity(id)
    },

    move(id, waypoints, opts = {}) {
      const e = entities.get(id)
      if (!e || waypoints.length === 0) return Promise.resolve()
      const speed = opts.cells_per_second ?? 4
      // Build a world-space path: current cell center → each waypoint center.
      const start = cell_center_world(e.cell.x, e.cell.y)
      const path = [start, ...waypoints.map((w) => cell_center_world(w.x, w.y))]
      return new Promise((resolve) => {
        // The gait rides the walk state: the CALLER picks walk/run (the adapter's ≥3-cell law);
        // the loco clip + timeScale resolve LAZILY in tick() (resolve_gait needs the rig's real clip
        // inventory, and the GLB loads async — `loco` caches the resolution once the avatar is ready).
        e.walk = {
          path,
          seg: 0,
          t: 0,
          speed,
          cell_size,
          gait: opts.gait,
          time_scale_override: opts.loco_time_scale,
          loco: null,
          knockback: !!opts.knockback,
          resolve,
        }
        // snap the logical cell to the final waypoint now (state is where it's HEADED)
        e.cell = { ...waypoints[waypoints.length - 1] }
      })
    },

    beat(id, opts) {
      const e = entities.get(id)
      if (!e) return Promise.resolve()
      // [item 7] Face the target BEFORE the anim plays: an attacker must swing TOWARD its target, not
      // wherever it last walked/spawned (fixes "fighters face the wrong way"). `opts.face`
      // is a BOARD CELL — yaw toward its world centre via the SAME cell→world map walks/upserts use
      // (atan2(dx,dz); the rig's +Z is forward). Persist as facing_yaw so a reconcile re-upsert
      // (place_avatar) keeps the attack facing, not the stale one. Omitted ⇒ exactly today's behaviour.
      if (opts.face) {
        const [fx, , fz] = cell_center_world(opts.face.x, opts.face.y)
        const p = e.avatar.object3d.position
        const yaw = Math.atan2(fx - p.x, fz - p.z)
        e.avatar.object3d.rotation.y = yaw
        e.facing_yaw = yaw
      }
      const { impact_time, duration, end_time, known, clip } = resolve_impact(opts.anim, e.avatar.clip_duration)
      if (!known) {
        // W4 keystone: an UNKNOWN beat anim (not in IMPACT_FRAMES — a typo or a future beat) is a LOUD
        // error, never a silent end-of-clip resolve. A KNOWN beat whose clip this rig LACKS (a RUN-only
        // mob) is the EXPECTED clipless path (resolve_impact ⇒ known:true, clip:null) — it stays QUIET so
        // it never spams per fight (regression: this fired twice every fight vs clipless mobs).
        console.error(
          `[board_entities] beat anim "${opts.anim}" is NOT in IMPACT_FRAMES; resolving at MIDPOINT ` +
            `fallback (${(duration / 2).toFixed(3)}s). Add it to IMPACT_FRAMES.`
        )
      }
      // drive the one-shot clip only if the rig HAS it; a clipless ATTACKER gets the PROCEDURAL lunge below
      // (ladder rung 2, mirroring the victim's clipless flinch/collapse) — never a silent stand-still
      // ("some don't even have attack animations somehow"); locomotion is paused for a real
      // beat by the walk/beat guard in tick().
      if (clip) e.avatar.play_beat(clip)
      else if (should_procedural_attack({ anim: opts.anim, clip })) arm_attack_lunge(e, impact_time, duration)
      // The float is DEFERRED to the impact frame (spawned by advance_beat the instant impact resolves)
      // so the damage number appears WITH the VFX burst, not at call time (ref2: number + flash sync).
      // [fight-feel 2026-07-12] a SECOND, purely-additive resolver stapled onto the SAME promise: `.done` fires at
      // the beat's NATURAL END (end_time — advance_beat's existing "clip finished" instant), never touching the
      // W4 impact-resolve above (every hit/death/float timing keeps reading impact, unchanged). `.duration_ms` is
      // the REAL resolved clip length (never a guessed constant) so a caller can arm its OWN bounded fallback if
      // `.done` never fires (an entity removed mid-beat — advance_beat then never runs again for it). Consumer:
      // voxel_fight_adapter's cast sequencer waits for the PLAYER's swing to actually finish before the delivery
      // VFX mounts ("let it finish before sending vfx, it's going too fast").
      /** @type {any} */
      let on_done = () => {}
      const done = new Promise((resolve_done) => {
        on_done = resolve_done
      })
      const p = /** @type {Promise<void> & { done: Promise<void>, duration_ms: number }} */ (
        /** @type {any} */ (
          new Promise((resolve) => {
            e.beat = {
              time: 0,
              impact_time,
              duration,
              end_time,
              resolved: false,
              resolve,
              on_done,
              float: opts.float ?? null,
              anim: opts.anim, // [victim-reaction] retained so the impact seam can suppress the flinch on a DEATH beat
              clip, // [victim-reaction] null ⇒ no rig clip is playing this beat (should_procedural_death's ladder check)
            }
          })
        )
      )
      p.done = done
      p.duration_ms = end_time * 1000
      return p
    },

    float(id, float) {
      const e = entities.get(id)
      if (e) spawn_float_staggered(e, float)
    },

    /** [D257] HIT-FLASH — the struck entity's avatar pulses emissive (0.15 s in / 0.25 s out). The
     *  adapter calls this on hit-land per entity; default red-orange. @param {string} id
     *  @param {{ r?: number, g?: number, b?: number, peak?: number }} [opts] */
    flash(id, { r = 1, g = 0.25, b = 0.12, peak = 1 } = {}) {
      const e = entities.get(id)
      if (e) arm_flash(e, { r, g, b, peak })
    },
    tick(dt, camera) {
      _clock += dt // [W7] burst-stagger clock — advances once per tick regardless of entity count
      for (const [id, e] of entities) {
        // [victim-reaction HARD BELT] Dead mobs must never persist on the board — force-remove a corpse
        // DEATH_FORCE_REMOVE_S after its death event, regardless of the beat/promise/adapter-timer state.
        // The normal despawn (adapter DEATH_BEAT_S ≈0.7s, well under this belt) always wins the race first —
        // this only ever fires when that upstream plumbing dropped the ball (an orphaned beat promise etc.),
        // so a struck-dead corpse can never stand on the board forever.
        if (should_force_remove(e.death_armed_at, _clock)) {
          remove_entity(id)
          continue
        }
        // [team-outline] lazily attach the inverted-hull shells once the async avatar has loaded its meshes.
        if (e.outline_color != null && e.outline === null && e.avatar.ready && !e.invisibility_active)
          e.outline = build_outline(e.avatar.object3d)
        // A status may resolve before the async GLB is ready. Attach on the first ready frame, then drive the
        // haze's world-locked shimmer from the same entity clock as its animation.
        if (e.invisibility_active && !e.invisibility && e.avatar.ready)
          e.invisibility = attach_invisibility_heat_haze(e.avatar.object3d)
        e.invisibility?.update(dt)
        // [cosmetics-in-fights] mount/reconcile the equipped hat/cloak once the async avatar rig is ready — the
        // SAME per-frame set_slots feed + ready-gate the roam player uses (embed_voxel_player). set_slots edge-
        // diffs the desired slots so a per-tick call is cheap; null slots (a mob, or no cosmetics) → {} no-op.
        if (e.worn_rig && e.avatar.ready) e.worn_rig.set_slots(e.desired_worn ?? {})
        advance_walk(e, dt)
        advance_flash(e, dt)
        advance_recoil(e, dt) // [victim-reaction] drive the got-hit flinch offset/shake/tip (self-clears at RECOIL_DUR)
        advance_lunge(e, dt) // [attacker-reaction] clipless-attack procedural lunge toward the target (self-clears)
        advance_death_collapse(e, dt) // [victim-reaction] clipless-death procedural collapse (crush + topple)
        // On the frame a beat crosses its impact time, spawn the deferred number. Fight visuals are owned by the
        // authored VFX pack; this entity layer deliberately has no procedural fallback path.
        const beat_active = advance_beat(e, dt, (beat) => {
          if (beat.float) spawn_float_staggered(e, beat.float)
          // [victim-reaction] the STRUCK body reacts on the SAME instant the number/burst land — one home for
          // "the hit lands" timing. A no-float beat (the attacker's own swing) reacts not at all.
          react_to_impact(e, beat)
          // [victim-reaction] the death belt + procedural collapse are FLOAT-INDEPENDENT (unlike the flinch
          // above): a fold-discovered corpse despawn (sync_entities) fires `{anim:'death'}` with NO float at
          // all, so gating this on beat.float would leave exactly the corpses standing forever.
          if (beat.anim === 'death') arm_death_response(e, beat, _clock)
        })
        // Locomotion anim: WALK/RUN while walking, else IDLE — but a beat OWNS the mixer while it plays
        // (drive it via tick(), not update(), so update()'s crossfade doesn't yank the beat clip).
        if (beat_active) {
          e.avatar.tick(dt)
        } else if (e.walk && e.walk.knockback) {
          // [W6 #3] KNOCKBACK — a shoved body slides fast along the ground with NO running legs (IDLE), so it
          // reads as displacement, not a sprint; advance_walk keeps its facing (no turn toward the travel dir).
          e.avatar.update(/** @type {any} */ ('IDLE'), e.avatar.object3d.rotation.y, dt)
        } else if (e.walk) {
          // [D303] gait-aware locomotion: the RUN anim on a 'run' gait (the avatar's ANIM_PREFS falls it
          // back to WALK on clip-less rigs) with the mixer advanced at time_scale × dt so foot cadence
          // tracks ground speed (no foot-slide/moonwalk). Only the loco loop is active in this branch,
          // so scaling dt IS the clip timeScale — zero per-action plumbing. Cached once clips are known.
          const loco =
            e.walk.loco ?? resolve_gait(e.walk.gait, e.walk.speed, e.avatar.clip_duration, e.walk.time_scale_override)
          if (!e.walk.loco && e.avatar.ready) e.walk.loco = loco
          e.avatar.update(/** @type {any} */ (loco.anim), e.avatar.object3d.rotation.y, dt * loco.time_scale)
        } else {
          e.avatar.update(/** @type {any} */ ('IDLE'), e.avatar.object3d.rotation.y, dt)
        }
        advance_floats(e, dt, camera, origin, cell_size)
      }
      // [pos-trace] AFTER every entity's per-frame advance, sample the LIVE world positions (the driven
      // oracle asserts mid-move placement, not just snap endpoints). Throttled + capped inside record();
      // the collect thunk runs only when a sample is due, and only when the tap is flag-enabled — dormant
      // costs one boolean and zero allocations.
      if (pos_trace.enabled)
        pos_trace.record(function* () {
          for (const [id, e] of entities) {
            const p = e.avatar.object3d.position
            yield { id, cell: { x: e.cell.x, y: e.cell.y }, x: p.x, y: p.y, z: p.z }
          }
        })
    },

    id_at_cell(cell) {
      return entity_id_at_cell(entities, cell)
    },

    // [entity-anchor] the LIVE render-position feed — see the EntitiesController typedef above. Reads the
    // SAME object3d.position advance_walk/advance_recoil/place_avatar all write every frame; no separate
    // tracked value to drift out of sync with what's actually drawn.
    render_position_of(id) {
      const e = entities.get(id)
      if (!e) return null
      const p = e.avatar.object3d.position
      return { x: p.x, z: p.z }
    },

    // [reference-faithful-mob-sizes] the measured rest-pose HEIGHT (blocks) of an entity's avatar, or
    // null pre-upsert. With mobs now at their INTRINSIC (per-creature) heights, anything anchoring to "the
    // head" — the dapp's hover tooltip, most notably — must read the real body instead of a constant. Same
    // derivation the pick cylinder uses: eye_height = measured bbox·0.9, so /0.9 recovers the full height; a
    // not-yet-loaded avatar reports its CHARACTER_HEIGHT-derived placeholder (a sane provisional, never null).
    entity_height_of(id) {
      const e = entities.get(id)
      return e ? e.avatar.eye_height / 0.9 : null
    },

    dispose() {
      for (const id of [...entities.keys()]) this.remove(id)
      pending_invisibility.clear()
    },
  }
}

/**
 * Spawns a rising damage/heal float over an entity at its CURRENT avatar position (so it lands where the
 * body is, matching the VFX burst). @param {any} e @param {{text:string,kind?:string}} float
 * @param {import('../engine.js').EngineApi} engine @param {number} [stagger_delay] seconds this float's
 *  pop/rise/fade is HELD before it starts (0 = spawns immediately) — fans a same-tick burst out ~80ms apart.
 */
function spawn_float(e, float, engine, stagger_delay = 0) {
  const kind = float.kind ?? 'info'
  const sprite = make_float_sprite(float.text, kind)
  const p = e.avatar.object3d.position
  sprite.position.set(p.x, p.y + e.avatar.eye_height + 0.4, p.z)
  // [W7] age starts NEGATIVE by the stagger delay: advance_floats holds the sprite invisible at the spawn
  // point until age crosses 0, so a multi-hit burst fans its numbers out instead of popping as one clump.
  sprite.userData.age = -stagger_delay
  // stash the settled footprint + a per-kind overshoot strength so advance_floats can drive the spring
  // pop-in each frame off `age` (crits punch harder — the distinct crit read).
  sprite.userData.base_x = sprite.scale.x
  sprite.userData.base_y = sprite.scale.y
  sprite.userData.overshoot = kind === 'crit' ? FLOAT_CRIT_POP_OVERSHOOT : FLOAT_POP_OVERSHOOT
  // ± drift picked ONCE at spawn so stacked hits on the same cell fan out instead of overlapping.
  sprite.userData.drift_x = (Math.random() * 2 - 1) * FLOAT_DRIFT_X
  // reuses the SAME reduced_motion() the victim-reaction recoil gates on (below) — one home for the signal.
  sprite.userData.reduced_motion = reduced_motion()
  engine.add_to_scene(sprite)
  e.floats.push(sprite)
}

// ── [team-outline] inverted-hull silhouette ──────────────────────────────────────────────────────────

/**
 * Darken an sRGB color to ~`target` relative luminance, preserving hue by scaling all three components
 * uniformly (never brightening — an already-dark input is returned unchanged). Rec.709 luma weights on the
 * sRGB components: perceptual enough for a rim tint (the exact swatch is eyeballed, not colorimetric).
 * Pure — unit-tested headless. @param {number} color_int 0xRRGGBB @param {number} target 0..1 @returns {number} */
export function darken_to_luminance(color_int, target) {
  const r = ((color_int >> 16) & 255) / 255
  const g = ((color_int >> 8) & 255) / 255
  const b = (color_int & 255) / 255
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const s = luma > 1e-4 ? Math.min(1, target / luma) : 1
  const to8 = (/** @type {number} */ v) => Math.max(0, Math.min(255, Math.round(v * s * 255)))
  return (to8(r) << 16) | (to8(g) << 8) | to8(b)
}

/**
 * Build the inverted-hull material for one mesh: a BACKSIDE MeshBasicNodeMaterial that pushes every vertex
 * OUT along its (post-skinning, smoothed) normal by OUTLINE_THICKNESS and paints a flat, unlit BLACK rim —
 * the default three.js OutlinePass look (spec: "make the outlines black", uniform across every
 * team, never a fill, never an interior-crease line — silhouette only, see the SMOOTHED NORMALS note
 * above). Opaque + depth-tested so only the rim protrudes past the body's silhouette; toneMapped:false
 * keeps the hue exact under the AgX tonemap. @returns {MeshBasicNodeMaterial}
 */
export function make_outline_material() {
  const mat = new MeshBasicNodeMaterial()
  mat.side = BackSide // only the back shell shows → a rim around the body's silhouette
  mat.toneMapped = false
  mat.color = new Color(0x000000) // unlit flat BLACK — never team-tinted
  // positionLocal/normalLocal are the SKINNED values at this point (NodeMaterial.setupPosition applies
  // skinning BEFORE positionNode — the same hook the built-in displacementMap rides), so the hull tracks
  // every walk/attack frame instead of freezing at the bind pose. normalLocal is the shell geometry's
  // SMOOTHED (position-welded) normal, so the push separates only the outer silhouette, not every corner.
  mat.positionNode = positionLocal.add(normalLocal.normalize().mul(uniform(OUTLINE_THICKNESS)))
  return mat
}

/**
 * Build a SHELL geometry for one source mesh: the body's exact vertex layout (cloned position / skinIndex
 * / skinWeight / index — so the shell skins identically to the body) but with POSITION-WELDED SMOOTHED
 * normals (weld_smoothed_normals) replacing the rig's hard per-face normals. The shell OWNS this geometry
 * — every attribute is a fresh clone, none shared with the body — so dispose_outline can free it with a
 * single geometry.dispose() without touching the body's GPU buffers (three frees buffers per BufferAttribute
 * on dispose; a shared attribute would double-free the body's). @param {import('three').BufferGeometry} src
 * @returns {BufferGeometry} */
function make_shell_geometry(src) {
  const geo = new BufferGeometry()
  const pos = src.attributes.position
  geo.setAttribute('position', pos.clone())
  const src_normal = src.attributes.normal
  const smoothed = weld_smoothed_normals(
    pos.array,
    src_normal ? src_normal.array : new Float32Array(pos.array.length),
    src.index ? src.index.array : null
  )
  geo.setAttribute('normal', new BufferAttribute(smoothed, 3))
  if (src.attributes.skinIndex) geo.setAttribute('skinIndex', src.attributes.skinIndex.clone())
  if (src.attributes.skinWeight) geo.setAttribute('skinWeight', src.attributes.skinWeight.clone())
  if (src.index) geo.setIndex(src.index.clone())
  return geo
}

/**
 * Attach an inverted-hull outline to every mesh under a loaded avatar. A SKINNED mesh gets a SkinnedMesh
 * shell bound to the SAME skeleton (deforms identically); a static mesh (e.g. bone-parented hair) gets a
 * plain Mesh shell. Each shell is a CHILD of its source mesh (identity local transform ⇒ the exact same
 * world matrix), carries its OWN smoothed-normal geometry clone (freed in dispose_outline), casts no
 * shadow, and is never frustum-culled (skinned bounds lie). @param {import('three').Object3D} root the
 * avatar object3d @returns {import('three').Mesh[]} the created shells
 */
function build_outline(root) {
  /** @type {import('three').Mesh[]} */
  const shells = []
  /** @type {any[]} */
  const targets = []
  root.traverse((obj) => {
    if (/** @type {any} */ (obj).isMesh && !obj.userData.__outline_shell && !obj.userData.__invisibility_shell)
      targets.push(obj)
  })
  for (const obj of targets) {
    const mat = make_outline_material()
    const shell_geo = make_shell_geometry(obj.geometry) // owned clone with smoothed normals
    /** @type {any} */
    let shell
    if (obj.isSkinnedMesh) {
      shell = new SkinnedMesh(shell_geo, mat)
      shell.bind(obj.skeleton, obj.bindMatrix) // SAME skeleton → identical deformation
      shell.bindMode = obj.bindMode
    } else {
      shell = new Mesh(shell_geo, mat)
    }
    shell.userData.__outline_shell = true
    shell.frustumCulled = false
    shell.castShadow = false
    shell.receiveShadow = false
    shell.renderOrder = (obj.renderOrder || 0) - 1 // draw before the body so the rim reads cleanly
    obj.add(shell) // child of the source mesh: identity local transform ⇒ same world matrix
    shells.push(shell)
  }
  return shells
}

/**
 * Detach the hull shells + free each shell's OWN material AND smoothed-normal geometry clone (the SKELETON
 * still belongs to the avatar — never disposed here; avatar.dispose owns it). Every shell attribute is a
 * fresh clone, so geometry.dispose frees only the shell's buffers. Safe when no outline was built.
 * @param {any} e
 */
function dispose_outline(e) {
  if (!e.outline) return
  for (const s of e.outline) {
    s.removeFromParent()
    s.geometry?.dispose?.() // the shell OWNS its cloned smoothed-normal geometry — free it (skeleton stays)
    const mat = s.material
    if (Array.isArray(mat)) mat.forEach((/** @type {any} */ m) => m?.dispose?.())
    else mat?.dispose?.()
  }
  e.outline = null
}

// ── walk / beat / float advancement (pure-ish helpers, keep the controller lean) ────────────────────

/**
 * Advances a constant-speed walk one frame. Moves along the world path at `speed` cells/s, faces the
 * heading, and resolves the move promise + clears the walk on arrival.
 * @param {any} e entity @param {number} dt
 */
function advance_walk(e, dt) {
  const w = e.walk
  if (!w) return
  const seg_from = w.path[w.seg]
  const seg_to = w.path[w.seg + 1]
  if (!seg_to) {
    // no more segments — snap to end + resolve
    e.avatar.object3d.position.set(seg_from[0], e.avatar.object3d.position.y, seg_from[2])
    w.resolve()
    e.walk = null
    return
  }
  const dx = seg_to[0] - seg_from[0]
  const dz = seg_to[2] - seg_from[2]
  const seg_cells = (Math.hypot(dx, dz) || 1e-6) / w.cell_size // segment length in CELLS
  w.t += (w.speed * dt) / seg_cells // constant cells/s → param [0,1] along this segment
  // face the direction of travel (model +Z forward → yaw = atan2(dx, dz)) — a [W6 #3] KNOCKBACK keeps its
  // facing (a shoved body doesn't turn to face where it's flung), so only steer heading for a real walk.
  if (!w.knockback) e.avatar.object3d.rotation.y = Math.atan2(dx, dz)
  if (w.t >= 1) {
    w.seg += 1
    w.t = 0
    // land exactly on the segment end (avoids float drift accumulating across a long path)
    e.avatar.object3d.position.set(seg_to[0], e.avatar.object3d.position.y, seg_to[2])
    if (w.seg >= w.path.length - 1) {
      // [D284] persist the final travel heading so a reconcile re-upsert (place_avatar) keeps the walk facing —
      // without this, e.facing_yaw stayed stale and the next poll snapped the mob back to its team default
      // (the per-frame rotation.y write above never reached facing_yaw).
      if (!w.knockback) e.facing_yaw = Math.atan2(dx, dz) // [W6 #3] a knockback preserves the shoved body's facing
      w.resolve()
      e.walk = null
    }
    return
  }
  e.avatar.object3d.position.set(seg_from[0] + dx * w.t, e.avatar.object3d.position.y, seg_from[2] + dz * w.t)
}

/**
 * Advances a one-shot beat one frame. Resolves the beat promise the FIRST frame the clock crosses the
 * impact time (mid-clip), then keeps the clip playing until its end — or its [D304] end CAP — before
 * clearing (the visual beat completes/cuts while the dapp already got its impact resolve; on a capped
 * 'hit' the next frame's locomotion update() crossfades the recoil back to IDLE/WALK). Fires
 * `on_impact(beat)` on that same first frame (VFX burst + deferred float — ref2 clarity beat).
 * @param {any} e @param {number} dt
 * @param {(beat: any) => void} on_impact called once, the frame the clock crosses impact
 * @returns {boolean} true while a beat is active (owns the mixer this frame)
 */
function advance_beat(e, dt, on_impact) {
  const b = e.beat
  if (!b) return false
  b.time += dt
  if (!b.resolved && b.time >= b.impact_time) {
    b.resolved = true
    on_impact(b) // spawn VFX + float AT the impact instant, before the promise resolve
    b.resolve() // W4: resolves at IMPACT, not end-of-clip
  }
  if (b.time >= b.end_time) {
    e.beat = null // clip finished (or its [D304] end cap hit) — hand the mixer back to locomotion next frame
    b.on_done?.() // [fight-feel] the beat's natural-end signal — separate from the W4 impact resolve above
    return false
  }
  return true
}

// ── float size + motion (FEEL DEMAND: "floating numbers too small and not bouncy
// enough" — the house fight-feel reference: BIG, punchy numbers that arc with a spring). Per-float
// timeline: a fast spring POP-IN (scale 0 → overshoot → rest), a HANG at full opacity while it rises +
// drifts, then a FADE-DROP (opacity eases out + a small gravity sag) — total life ~900ms. Multi-hit
// floats fan out via a burst stagger (below) so a burst reads as a flurry, not one clump. ──────────────
// [2nd pass — "floating numbers too small and not punchy enough"] the house fight-feel
// reference read: the number SCALES UP on spawn (reference client `m_shiftScale: 1.0`, FEEL_NOTES §Hit) — a
// hard pop is the whole punch, NOT a longer life. So: bigger BASE + a stronger spring overshoot + a snappier
// pop window; life stays ~0.9s (short = punchy). Reference damage `hint`s live ~1s and fade (per the
// extraction corpus's FightContextFrame), so 0.9s is on-reference. Crits SLAM harder (a bigger overshoot +
// scale — the distinct crit read).
// [float-lag] design ruling 2026-07-12 — the number waits for the impact VFX to resolve before it pops. A pure VISUAL hold
// (spawn_float sets age = -this), NOT a sequence change: the sprite is created at the impact beat, held invisible
// this long, then springs in. 0.22s > FLOAT_POP_TIME so the pop clearly TRAILS the impact flash/burst, yet stays
// well under the hit clip so it always lands before a kill's death collapse (order preserved).
const FLOAT_IMPACT_LAG_S = 0.22
const FLOAT_LIFETIME = 0.9 // s — total life, spawn → fully faded (short on purpose; punch is pop+size, not duration)
const FLOAT_POP_TIME = 0.15 // s — the spring pop-in window (snappier than the old 0.18 — a harder SLAM in)
const FLOAT_HANG_FRAC = 0.45 // fraction of FLOAT_LIFETIME held at full opacity before the fade-drop starts
const FLOAT_RISE = 1 // meters risen over the lifetime (ease-out — fast rise, settling near the top)
const FLOAT_DRIFT_X = 0.4 // meters — max ± horizontal drift (randomized per spawn) so stacked hits fan out
const FLOAT_GRAVITY_DROP = 0.2 // meters the number sags back down during the fade tail ("gravity-ease")
const FLOAT_POP_OVERSHOOT = 0.45 // normal hit: spring born at 0, overshoots to ×1.45, settles to ×1 (punchier)
const FLOAT_CRIT_POP_OVERSHOOT = 0.8 // crits punch hardest: overshoot to ×1.8 — the requested SLAM
const FLOAT_REDUCED_FADE_IN = 0.12 // s — reduced-motion still eases in briefly (never a hard cut)

// magnitude → base-scale curve ("a 3-damage tick reads smaller than a 40-crit"): a hit at/below
// FLOAT_MAG_FLOOR reads at FLOAT_SCALE_MIN×base, at/above FLOAT_MAG_CEIL at FLOAT_SCALE_MAX×base,
// smoothstepped between — small ticks stay legible-small, big hits saturate the band instead of growing
// forever. Crits ride an ADDITIONAL flat multiplier — the "top band" distinct crit read.
const FLOAT_MAG_FLOOR = 5
const FLOAT_MAG_CEIL = 50
const FLOAT_SCALE_MIN = 0.75
const FLOAT_SCALE_MAX = 1.3
const FLOAT_CRIT_SCALE = 1.5 // crits are a bigger, weightier label (distinct crit-font read) atop the magnitude curve
/** World-meters sprite footprint at magnitude-curve ×1 — bumped again ("still too small", 2nd
 *  pass: 5.2→7.0, ~35% up on the prior 5.2 base which was itself ~2× the original 2.6). The magnitude curve +
 *  crit multiplier scale OUT from here; the 4:1 canvas aspect is unchanged so long numbers never clip. */
const FLOAT_BASE_W = 7.0
const FLOAT_BASE_H = 1.75
// burst stagger — a multi-hit fans its numbers ~80ms apart so it reads as a flurry, not a clump.
const FLOAT_BURST_WINDOW = 0.15 // s — a float spawned within this long of the previous one is "the same burst"
const FLOAT_BURST_STAGGER = 0.08 // s — per-float stagger delay inside a burst

// float label rasterization (make_float_sprite): a FIXED-width canvas whose world footprint (FLOAT_BASE_W)
// maps from it. A damage number fits with room; a long composed label (the pre-#239 combined "TACKLED  -2 MP
// -1 AP" tag was the motivating case — tackle now floats short separate AP/MP numbers, see FLOAT_COLOR.ap
// above, but any future multi-part label hits the same fixed canvas) does not, so it must SHRINK to fit
// rather than clip (regression: "oversized+cropped"). ONE home for these three numbers.
const FLOAT_CANVAS_W = 256 // px — the float sprite's canvas width (the 4:1 aspect + world footprint map from it)
const FLOAT_FONT_PX = 38 // px — base label font (JetBrains Mono 600, the heaviest LOADED house weight)
const FLOAT_TEXT_PAD = 12 // px — horizontal breathing room inside the canvas so glyphs never touch the edge

/**
 * Shrink-to-fit font px for a float label so a long composed string NEVER clips the fixed-width float canvas —
 * the board's toast-width-cap law applied to floats. PURE (the caller measures the string's rendered width at
 * the base font and passes it in): a string that already fits keeps the base size; a wider one scales down by
 * the exact overflow ratio (the supersampled canvas keeps the smaller glyphs crisp). Floored at 1px so it
 * never returns 0/NaN on a pathological width. @param {number} measured_px rendered width of the text at
 * base_px @param {number} [base_px] @param {number} [avail_px] usable canvas width @returns {number} font px (≤ base_px)
 */
export function fit_float_font_px(
  measured_px,
  base_px = FLOAT_FONT_PX,
  avail_px = FLOAT_CANVAS_W - FLOAT_TEXT_PAD * 2
) {
  if (!(measured_px > avail_px)) return base_px
  return Math.max(1, Math.floor((base_px * avail_px) / measured_px))
}

/**
 * Extracts the numeric magnitude from a fully-composed float string ("-42", "+15") for the SCALE curve
 * only — the dapp's exact text is never re-rendered, only sized. Non-numeric text (a future status float)
 * reads at the curve's floor instead of throwing. Pure. @param {string} text @returns {number}
 */
export function float_text_magnitude(text) {
  const m = /-?\d+/.exec(String(text ?? ''))
  return m ? Math.abs(Number(m[0])) : 0
}

/**
 * Maps a hit's magnitude to a base-scale multiplier via a clamped smoothstep between FLOAT_MAG_FLOOR and
 * FLOAT_MAG_CEIL. Pure + exported — the magnitude→size law is unit-testable without a canvas.
 * @param {number} magnitude @returns {number}
 */
export function float_magnitude_scale(magnitude) {
  const span = FLOAT_MAG_CEIL - FLOAT_MAG_FLOOR
  const t = Math.max(0, Math.min(1, (Math.abs(magnitude) - FLOAT_MAG_FLOOR) / span))
  const eased = t * t * (3 - 2 * t) // smoothstep
  return FLOAT_SCALE_MIN + eased * (FLOAT_SCALE_MAX - FLOAT_SCALE_MIN)
}

/**
 * Spring pop-in curve: 0 at t=0, overshoots to (1+overshoot) at an interior peak, settles to 1 at t=1. A
 * cheap two-segment ease (not a physical spring sim) with exact keyframe values, so it's trivially unit
 * tested. @param {number} t normalized time within the pop window, clamped to [0,1] @param {number} overshoot
 * e.g. 0.3 for a ×1.3 peak @returns {number} scale multiplier
 */
export function float_pop_curve(t, overshoot) {
  const c = Math.max(0, Math.min(1, t))
  const PEAK_T = 0.55 // where the overshoot peaks within the pop window
  const peak = 1 + overshoot
  if (c <= PEAK_T) {
    const p = c / PEAK_T
    return peak * (1 - (1 - p) * (1 - p)) // ease-out quad: 0 → peak
  }
  const p = (c - PEAK_T) / (1 - PEAK_T)
  const eased = p * p * (3 - 2 * p) // smoothstep settle: peak → 1
  return peak + (1 - peak) * eased
}

/** Ease-out quad (fast start, settles near 1) — drives both the rise and the drift so they arrive
 *  together. Pure + exported for the arc/drift unit tests. @param {number} t clamped to [0,1] @returns {number} */
export function float_rise_ease(t) {
  const c = Math.max(0, Math.min(1, t))
  return 1 - (1 - c) * (1 - c)
}

/**
 * Opacity over the float's life: held at 1 through hang_frac, then eases out (accelerating — the
 * "fade-drop" read) to 0 by t=1. Pure. @param {number} t age/FLOAT_LIFETIME, clamped [0,1] @param {number}
 * hang_frac @returns {number} opacity
 */
export function float_opacity_curve(t, hang_frac) {
  const c = Math.max(0, Math.min(1, t))
  if (c <= hang_frac) return 1
  const p = (c - hang_frac) / (1 - hang_frac)
  return 1 - p * p // ease-in fade: slow to start, accelerating — reads as it "gives out"
}

/**
 * Extra downward sag applied only during the fade tail (age past hang_frac) — the small ballistic drop
 * that reads as "gravity caught up with it" as the number fades. Pure, returns a 0..1 fraction of
 * FLOAT_GRAVITY_DROP. @param {number} t age/FLOAT_LIFETIME, clamped [0,1] @param {number} hang_frac
 * @returns {number}
 */
export function float_gravity_drop_curve(t, hang_frac) {
  const c = Math.max(0, Math.min(1, t))
  if (c <= hang_frac) return 0
  const p = (c - hang_frac) / (1 - hang_frac)
  return p * p
}

/**
 * Decides THIS float's stagger delay (s): within FLOAT_BURST_WINDOW of the previous spawn ⇒ same burst ⇒
 * chain onto the previous float's delay + FLOAT_BURST_STAGGER (a multi-hit fans out ~80ms apart, reading
 * as a burst, not a clump); otherwise a fresh, unstaggered spawn. Pure + exported — the burst-grouping law
 * is unit-testable without the engine clock. @param {number} since_last seconds since the previous float
 * spawned anywhere on the board (Infinity if none yet) @param {number} prev_delay the previous float's own
 * stagger delay (s) @returns {number} this float's stagger delay (s)
 */
export function float_burst_stagger(since_last, prev_delay) {
  return since_last <= FLOAT_BURST_WINDOW ? prev_delay + FLOAT_BURST_STAGGER : 0
}

/**
 * Advances every float over an entity: billboards it to the camera, springs it in, rises + drifts + fades
 * it, and removes it from the scene at end-of-life. A float still within its burst-stagger hold (negative
 * age) stays invisible at the spawn point. Reduced-motion floats skip the spring/rise/drift for a static
 * fade instead (accessibility — "keep fades, drop movement"; reuses the SAME reduced_motion() the victim-
 * reaction recoil gates on — one home for the signal). @param {any} e @param {number} dt
 * @param {import('three').Camera} camera @param {{x:number,y:number,z:number}} origin @param {number} _cell_size
 */
function advance_floats(e, dt, camera, origin, _cell_size) {
  if (e.floats.length === 0) return
  const cx = e.avatar.object3d.position.x
  const cz = e.avatar.object3d.position.z
  const base_y = origin.y + e.avatar.eye_height + 0.4
  for (let i = e.floats.length - 1; i >= 0; i -= 1) {
    const s = e.floats[i]
    s.userData.age += dt
    const { age } = s.userData
    if (age >= FLOAT_LIFETIME) {
      engine_remove(s)
      e.floats.splice(i, 1)
      continue
    }
    const mat = /** @type {SpriteMaterial} */ (s.material)
    if (age < 0) {
      // still held for its burst stagger — invisible, parked at the spawn point.
      mat.opacity = 0
      s.position.set(cx, base_y, cz)
    } else {
      const t = age / FLOAT_LIFETIME
      if (s.userData.reduced_motion) {
        // static fade: no pop, no rise, no drift — a brief ease-in then the same hang+fade (accessibility).
        const fade_in = Math.min(1, age / FLOAT_REDUCED_FADE_IN)
        mat.opacity = fade_in * float_opacity_curve(t, FLOAT_HANG_FRAC)
        s.position.set(cx, base_y, cz)
        s.scale.set(s.userData.base_x, s.userData.base_y, 1)
      } else {
        const rise_k = float_rise_ease(t)
        const drop_k = float_gravity_drop_curve(t, FLOAT_HANG_FRAC)
        s.position.set(cx + s.userData.drift_x * rise_k, base_y + FLOAT_RISE * rise_k - FLOAT_GRAVITY_DROP * drop_k, cz)
        mat.opacity = float_opacity_curve(t, FLOAT_HANG_FRAC)
        const pop_t = age / FLOAT_POP_TIME
        const pop = pop_t < 1 ? float_pop_curve(pop_t, s.userData.overshoot) : 1
        s.scale.set(s.userData.base_x * pop, s.userData.base_y * pop, 1)
      }
    }
    if (camera) s.quaternion.copy(camera.quaternion) // face the camera (billboard)
  }
}

/** Scene-remove shim so advance_floats (which lacks the engine handle) can drop an expired sprite. The
 *  sprite is parented under the scene root; removeFromParent frees it without the engine handle. */
function engine_remove(/** @type {Sprite} */ sprite) {
  sprite.removeFromParent()
  const mat = /** @type {SpriteMaterial} */ (sprite.material)
  mat.map?.dispose()
  mat.dispose()
}

// ── float sprite (camera-facing billboard text) ─────────────────────────────────────────────────────

// Float color by kind — the combat-log colour GRAMMAR (styles/tokens.css): damage = RED,
// heal = PINK (--clog-num-heal #ff6bb0, moved OFF green so green frees up for MP), crit = AMBER (--clog-num-crit
// = --warn #ffb454), else house gold. The engine can't import the frontend CSS tokens, so the hexes are pinned
// here to the SAME values — a heal float now reads pink like its combat-log line (was a stale green that
// pre-dated the grammar pass). Damage stays the saturated #ff5a3c (a float over the 3D board wants more punch
// than the log's pastel --bad; still unmistakably damage-red).
// [float-punch] design ruling 2026-07-12: the red needed to read way more punchy. Two compounding fixes: (1) the sprite
// material now renders toneMapped:false (make_float_sprite below) so AgX no longer desaturates the authored
// hex into washed salmon — the pixel IS the constant; (2) damage pushed off the orange-leaning #ff5a3c to a
// saturated true-red #ff2f1c (post-AgX-bypass this reads as a punchy RED, pixel-verified). heal/crit/info
// inherit the same toneMapped:false truth (heal pink + crit amber now render at their real combat-log hues,
// hexes unchanged — the AgX bypass alone un-washes them).
// `mp` = the house mint MP green (--clog-num-mp / --good) — the move's spent-MP floater.
// `ap` = the house ice-blue AP tone (--clog-num-ap / frosted --accent) — #239: the tackle forfeit's AP leg
// (mp/ap replace the old combined red "TACKLED -N MP -N AP" label float; the presentation rule bans the label
// entirely, so each pool now floats on its own, colored like its combat-log number).
const FLOAT_COLOR = {
  damage: '#ff2f1c',
  heal: '#ff6bb0',
  crit: '#ffb454',
  info: '#c8963c',
  mp: '#4fd6a0',
  ap: '#5db4ff',
}

/**
 * Renders a FULLY-COMPOSED text string to a canvas texture and wraps it in a camera-facing Sprite, sized
 * by the magnitude→scale curve (small ticks read small, big hits read big) with crits riding an ADDITIONAL
 * flat multiplier — the "always bigger than a same-magnitude non-crit" top band. The dapp composes the
 * text (i18n stays dapp-side, contract); the engine only rasterizes + billboards it — the magnitude is
 * parsed back out of the text for SIZING only, never re-displayed. Crits also bake a soft gold glow (the
 * house `.gold-glow` halo — canvas shadowBlur, a one-time raster cost) for a distinct "pop" read.
 * @param {string} text @param {string} kind @returns {Sprite}
 */
function make_float_sprite(text, kind) {
  const color = FLOAT_COLOR[/** @type {keyof typeof FLOAT_COLOR} */ (kind)] ?? FLOAT_COLOR.info
  const canvas = document.createElement('canvas')
  const scale = 4 // supersample for crisp text at the locked-cam distance
  canvas.width = FLOAT_CANVAS_W * scale
  canvas.height = 64 * scale
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
  ctx.scale(scale, scale)
  // [float-font] design ruling 2026-07-12: the font also read weird. ROOT CAUSE: this asked for weight 700, but the app only
  // loads JetBrains Mono at 300/400/500/600 (index.html Google-Fonts import) — 700 is UNLOADED, so the canvas
  // renders a SUBSTITUTE (a faux-bold synthesis of the loaded face, or a system-mono fallback) rather than a real
  // weight — the "weird" glyph. 600 is the house type's heaviest LOADED weight (CLAUDE.md: JetBrains Mono 300–600),
  // so it renders the REAL face with no substitution; punch now comes from the size curve + the toneMapped:false
  // colour truth below, not an unavailable weight. 256-wide canvas still holds a 6-digit signed number (~150px)
  // with room, so no clip.
  ctx.font = `600 ${FLOAT_FONT_PX}px "JetBrains Mono", ui-monospace, monospace`
  // SHRINK-TO-FIT (regression: "oversized+cropped"): measure the composed label at the base font; a long
  // composed tag that would spill past the fixed-width canvas drops to the exact font px that fits, so the
  // WHOLE label always renders (never cropped). A damage number is under the bound → base size kept.
  const fit_px = fit_float_font_px(ctx.measureText(text).width)
  if (fit_px !== FLOAT_FONT_PX) ctx.font = `600 ${fit_px}px "JetBrains Mono", ui-monospace, monospace`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // dark outline for legibility over any board color, then the fill (glow-free stroke — crisp regardless of kind)
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'
  ctx.strokeText(text, FLOAT_CANVAS_W / 2, 32)
  if (kind === 'crit') {
    // [W7] crit glow — the house gold-glow halo (CLAUDE.md .gold-glow: "text with gold text-shadow halo"),
    // baked once into the texture so it costs nothing per-frame.
    ctx.shadowColor = color
    ctx.shadowBlur = 14
  }
  ctx.fillStyle = color
  ctx.fillText(text, FLOAT_CANVAS_W / 2, 32)
  const texture = new CanvasTexture(canvas)
  // [float-punch] toneMapped:false — the combat number is UI text with an authored combat-log hue, NOT an HDR
  // scene sprite: passing it through the renderer's AgX tonemap desaturated the red into washed salmon (
  // "too washed"). Bypassing tonemap makes the RENDERED pixel equal the authored FLOAT_COLOR (a saturated red),
  // matching the entity-anchor / highlight tiles which are toneMapped:false for the same reason.
  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const sprite = new Sprite(material)
  const final_scale = float_magnitude_scale(float_text_magnitude(text)) * (kind === 'crit' ? FLOAT_CRIT_SCALE : 1)
  sprite.scale.set(FLOAT_BASE_W * final_scale, FLOAT_BASE_H * final_scale, 1) // world-meters footprint of the label
  sprite.renderOrder = 999 // always on top (occlusion baseline is the locked cam, contract)
  return sprite
}

// [D257] HIT-FLASH envelope — the struck avatar's emissive pulses red-orange (0.15 s in / 0.25 s out),
// restoring the exact per-material baseline. Mob materials rest at WHITE because white × emissiveMap × 0.3
// is their shared albedo floor; players generally rest at black. Never assume either at this context seam.
const FLASH_LIFE = 0.4
const FLASH_IN = 0.15

const restore_flash_materials = (/** @type {any} */ flash) => {
  for (const { material, emissive } of flash?.mats ?? []) material.emissive.setRGB(emissive.r, emissive.g, emissive.b)
}

const arm_flash = (/** @type {any} */ entity, /** @type {{r:number,g:number,b:number,peak:number}} */ tint) => {
  restore_flash_materials(entity.flash) // a re-hit starts from the true baseline, never the prior pulse
  entity.flash = { t: 0, ...tint, mats: null }
}

export function advance_flash(/** @type {any} */ e, /** @type {number} */ dt) {
  const f = e.flash
  if (!f) return
  f.t += dt
  if (!f.mats) {
    f.mats = []
    const seen = new Set()
    e.avatar.object3d.traverse((/** @type {any} */ n) => {
      const materials = Array.isArray(n.material) ? n.material : [n.material]
      for (const material of materials) {
        if (!material?.emissive || seen.has(material)) continue
        seen.add(material)
        f.mats.push({
          material,
          emissive: { r: material.emissive.r, g: material.emissive.g, b: material.emissive.b },
        })
      }
    })
  }
  if (f.t >= FLASH_LIFE) {
    restore_flash_materials(f)
    e.flash = null
    return
  }
  const env = flash_envelope(f.t, FLASH_IN, FLASH_LIFE) * f.peak
  for (const { material, emissive } of f.mats)
    material.emissive.setRGB(
      emissive.r + (f.r - emissive.r) * env,
      emissive.g + (f.g - emissive.g) * env,
      emissive.b + (f.b - emissive.b) * env
    )
}

// ── VICTIM REACTION — the "got hit" flinch: players + mobs must visibly react to taking damage ──
// NO rig carries a HIT/HURT/FLINCH clip (2026-07-11 full-fleet GLB parse: players ship ATTACK/DEATH/loco +
// SPELL_*; mobs range from [ATTACK,IDLE,RUN] down to kokushibo [no ATTACK] and dragon-void [ZERO clips]), so
// a clip-based reaction is impossible universally. Instead the struck body gets a PROCEDURAL flinch that
// layers ON TOP of whatever the mixer is doing (idle — NEVER the attack clip; D304 superseded above) and so
// never interrupts a clip: a magnitude-scaled recoil AWAY from the attacker (translate + a decaying SHAKE
// jitter + a squash/tip punch, ~300 ms, spring return — float_magnitude_scale sizes it exactly like the
// floating number, so a nuke shakes harder than a chip hit) plus a COLORED IMPACT TINT (advance_flash — a
// colorize at peak < 1, NOT a bloom halo, derived from the SAME FLOAT_COLOR table
// the damage number reads so the tint always matches what the player sees printed). Heals get a soft GREEN
// pulse and NO recoil; crits get their own gold-toned tint. Fired from the ONE place the hit lands — a
// beat's impact frame, when that beat carries a damage/heal float or is an explicit no-float hit; the
// attacker's own 'attack' beat carries float:null (beats_from_packet), so an attacker never self-reacts. The
// recoil (only) is skipped under
// reduced-motion and mid-walk; a DEATH beat flashes but never flinches (its own procedural collapse, below,
// owns the body instead). Because the reaction is position/scale/rotation/emissive — never a clip — it
// works even on the zero-clip mobs a clip-based reaction could never touch.

const tint_from = (/** @type {string} */ hex, /** @type {number} */ peak) => {
  const c = new Color(hex)
  return { r: c.r, g: c.g, b: c.b, peak }
}
/** Emissive tint per reaction kind — a luma-sane COLORIZE (peak < 1 keeps it a tint, not a lightbulb/halo;
 *  every peak here stays well under the brand's no-halo luma ceiling). DERIVED from FLOAT_COLOR (below) —
 *  one home per fact — so the victim's impact tint matches the color the floating number prints: red damage +
 *  a DISTINCT amber crit (both derived). HEAL is the one deliberate exception — a green body-pulse even though
 *  its NUMBER is now pink (a fast flash must read as health-green, not the damage-adjacent pink). A true
 *  per-SPELL-ELEMENT tint
 *  (fire/water/earth…) needs the caster's element threaded through entity_beat from the adapter — that
 *  plumbing is outside this file's fence today; `kind` (damage/heal/crit) is the richest signal already
 *  reaching this boundary, and IS "the element" as far as a struck body can see. The flash restores each
 *  material's captured baseline (white albedo floor for mobs, usually black for players). */
const REACTION_FLASH = {
  damage: tint_from(FLOAT_COLOR.damage, 0.55),
  crit: tint_from(FLOAT_COLOR.crit, 0.6),
  // heal is the DELIBERATE exception to the "tint == printed number" derivation: the colour grammar moved
  // the heal NUMBER to pink, but a sub-second body-flash reads as "I got healed" ONLY as the universal health
  // GREEN — and tokens.css itself flags the heal pink as "the same chroma family as --bad" (damage red), so a
  // pink heal flash would MISREAD as a hit. The pink lives on the floating NUMBER (it carries a +sign + context);
  // the body pulse stays green. Damage/crit still derive from FLOAT_COLOR — they DO match their number.
  heal: tint_from('#4caf50', 0.4),
}
/** Recoil geometry (fixes "doesn't shake nor has colored impact effect" — the flinch below is
 *  now a genuine SHAKE, not just a smooth shove). */
const RECOIL_DUR = 0.3 // s — a readable flinch (target range: ~250-350 ms)
const RECOIL_DIST = 0.18 // m — base jerk-back at the locked-cam distance, scaled by hit magnitude (below)
const LUNGE_DIST = 0.26 // m — the clipless-attacker strike reach: a shade past the flinch so the swing reads as the CAUSE
const RECOIL_SQUASH = 0.08 // scale dips to ×0.92 at the peak, springs back to ×1
const RECOIL_PEAK = 0.32 // fraction of the duration at which the recoil is fully extended (fast out, spring back)
const RECOIL_JITTER_CYCLES = 3 // oscillations across the flinch window — the "shake", not a single nudge
const RECOIL_JITTER_AMP = 0.05 // m — lateral shake amplitude at peak, scaled by hit magnitude
const RECOIL_TIP = 0.14 // rad (~8°) — the "skew punch": a quick off-balance roll, scaled by hit magnitude
// [victim-reaction] procedural DEATH collapse (ladder rung 2 for 'death', mirroring 'hit'): a clipless rig
// has no DEATH clip to play, so without this the corpse just holds its last loco pose — reading as "still
// standing" (regression: "a 0-HP mob standing on the board while the fight continues"). TERMINAL — no
// restore, the hard belt below removes the entity shortly after, so there is nothing to leak.
const DEATH_COLLAPSE_DUR = 0.45 // s — fade over ~450ms (the crush/topple window)
const DEATH_CRUSH = 0.72 // the body's height crushes to ~28% — an unmistakable collapse, not a wobble
const DEATH_TIP = 0.35 // rad (~20°) — topples over as it crushes
/** [victim-reaction HARD BELT] Dead mobs must never persist — force-removed this long after its
 *  death event regardless of animation/promise/adapter-timer state. The adapter's normal despawn
 *  (overlay_intents.DEATH_BEAT_S ≈ 0.7 s) always wins the race first; this is pure defensive insurance. */
const DEATH_FORCE_REMOVE_S = 1.5

/**
 * The reaction DESIGN for a beat that just landed on an entity — pure, so the mapping is unit-testable. A
 * DEATH beat flashes (marks the fatal hit) but NEVER recoils ("a victim mid-death never flinches" — its own
 * collapse owns the body); a heal float is a soft green pulse with no recoil; damage/crit is a red flash +
 * recoil. An explicit no-float hit uses the same damage reaction (the tackle toll); info floats and no-float
 * attacker swings react not at all.
 * @param {string} anim the beat's anim (attack/hit/death/…)
 * @param {string | undefined} kind the float kind (damage/crit/heal/info)
 * @returns {{ flash: { r: number, g: number, b: number, peak: number }, recoil: boolean } | null}
 */
export function reaction_for(anim, kind) {
  if (anim === 'death') return { flash: REACTION_FLASH.damage, recoil: false } // fatal hit: flash, no flinch
  if (kind === 'heal') return { flash: REACTION_FLASH.heal, recoil: false }
  if (kind === 'crit') return { flash: REACTION_FLASH.crit, recoil: true } // its own gold-toned tint (was lumped with damage)
  if (kind === 'damage' || (anim === 'hit' && kind == null)) return { flash: REACTION_FLASH.damage, recoil: true }
  return null
}

/**
 * Unit AWAY-from-attacker direction on the board plane. The victim's hit/death beat faces it TOWARD its
 * attacker (voxel_fight_adapter: the beat's `face` = the caster cell) and the rig's +Z is forward, so "away"
 * is the negated forward vector. Pure. @param {number} facing_yaw @returns {{ dx: number, dz: number }}
 */
export function recoil_away_dir(facing_yaw) {
  return { dx: -Math.sin(facing_yaw), dz: -Math.cos(facing_yaw) }
}

/**
 * Out-and-back envelope: 0 at both ends, peaking at 1 at `peak` — a fast move OUT then an eased spring back
 * to rest (smoothstep on each leg so nothing snaps). The ONE curve home for both the victim recoil (peak =
 * RECOIL_PEAK) and the clipless-attacker lunge (peak = the beat's designed impact fraction, so the lunge's
 * furthest reach lands exactly ON the impact instant — the damage/burst fire at full extension). Pure.
 * @param {number} t01 clock/duration in [0,1] @param {number} peak (0,1) @returns {number} 0..1
 */
export function peak_envelope(t01, peak) {
  if (t01 <= 0 || t01 >= 1) return 0
  if (t01 <= peak) {
    const x = t01 / peak
    return x * x * (3 - 2 * x)
  }
  const x = (t01 - peak) / (1 - peak)
  return 1 - x * x * (3 - 2 * x)
}

/**
 * Recoil envelope: peak_envelope at the flinch's RECOIL_PEAK. Pure. @param {number} t01 clock/duration in
 * [0,1] @returns {number} the 0..1 displacement + squash amount
 */
export function recoil_envelope(t01) {
  return peak_envelope(t01, RECOIL_PEAK)
}

/**
 * The SHAKE: a decaying lateral oscillation riding recoil_envelope (0 at both ends, so it can never leave a
 * residual offset) — a few quick back-and-forth cycles layered PERPENDICULAR to the away-recoil, which is
 * what turns a single smooth shove into something that actually reads as a shake (fixes "doesn't shake").
 * Pure + exported. @param {number} t01 clock/RECOIL_DUR in [0,1] @returns {number} the oscillation × envelope
 */
export function recoil_jitter(t01) {
  if (t01 <= 0 || t01 >= 1) return 0
  return Math.sin(t01 * RECOIL_JITTER_CYCLES * Math.PI * 2) * recoil_envelope(t01)
}

/** True when the OS/browser asks for reduced motion — gates the physical recoil (the tint still fires).
 *  Guarded for headless/SSR/test (no window/matchMedia) ⇒ false ⇒ motion allowed. */
function reduced_motion() {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/**
 * Ladder rung 2 for a DEATH beat (mirrors the hit ladder above IMPACT_FRAMES): true when this rig has NO
 * real clip playing for the beat — the beat() clip resolution already collapsed "rig lacks DEATH" to
 * `clip: null` (resolve_impact's known-but-clipless branch), so a plain null-check is the whole rule. Pure —
 * testable off the beat shape alone (no GLB). @param {{ anim: string, clip: string | null }} beat
 * @returns {boolean}
 */
export function should_procedural_death(beat) {
  return beat.anim === 'death' && !beat.clip
}

/**
 * Ladder rung 2 for an ATTACK beat — same rule, attacker side: a rig with no ATTACK clip (the source model
 * ships none — vanilla crab/sheep/bunny class) must never strike as a silent statue; it gets the procedural
 * lunge instead. Pure. @param {{ anim: string, clip: string | null }} beat @returns {boolean}
 */
export function should_procedural_attack(beat) {
  return beat.anim === 'attack' && !beat.clip
}

/**
 * [victim-reaction HARD BELT] true once `belt_s` has elapsed since a death event armed, regardless of the
 * beat/animation/promise state upstream — a defensive backstop ("a dead mob may NEVER persist").
 * Pure. @param {number | null | undefined} armed_at engine clock (s) the death event fired, or null/undefined
 * (never armed) @param {number} now current engine clock (s) @param {number} [belt_s] @returns {boolean}
 */
export function should_force_remove(armed_at, now, belt_s = DEATH_FORCE_REMOVE_S) {
  return armed_at != null && now - armed_at >= belt_s
}

/**
 * The hit-flash envelope: rises 0→1 over `flash_in`, decays 1→0 by `life` (a fast in, slower-out pulse —
 * D257). Pure + exported (extracted from advance_flash's inline math so the tint's rise/decay/restore-to-
 * zero shape — the "material state restored" contract — is unit-testable without a THREE material).
 * @param {number} t seconds elapsed @param {number} flash_in seconds of the rise @param {number} life total
 * pulse seconds @returns {number} 0..1
 */
export function flash_envelope(t, flash_in, life) {
  if (t >= life) return 0
  const raw = t < flash_in ? t / flash_in : 1 - (t - flash_in) / (life - flash_in)
  return raw * raw * (3 - 2 * raw)
}

/**
 * Arm the struck entity's reaction at the impact instant: set the emissive tint (the reused advance_flash
 * slot) and, for a real flinch (damage/crit, not death, not reduced-motion, not mid-walk), arm the recoil
 * away from the attacker — magnitude-scaled by the SAME float_magnitude_scale curve the damage number's
 * size reads (a nuke shakes harder than a chip hit). A no-float explicit hit uses the curve's floor; a
 * no-float attacker swing reacts not at all. A re-hit while a recoil is still live re-uses the EXISTING true
 * rest/base-scale (never the mid-recoil offset) so staggered multi-hits can't drift the body off its cell; its
 * magnitude re-reads fresh each hit (a harder second hit shakes harder, not capped to the first). @param {any} e
 * @param {any} beat
 */
export function react_to_impact(e, beat) {
  const design = reaction_for(beat.anim, beat.float?.kind)
  if (!design) return
  const { r, g, b, peak } = design.flash
  arm_flash(e, { r, g, b, peak })
  if (design.recoil && !e.walk && !reduced_motion()) {
    const { dx, dz } = recoil_away_dir(e.facing_yaw)
    const obj = e.avatar.object3d
    const live = e.recoil // a re-hit mid-flinch keeps the true rest, not the offset position
    const mag = float_magnitude_scale(float_text_magnitude(beat.float?.text))
    e.recoil = {
      t: 0,
      dx,
      dz,
      mag,
      rest_x: live ? live.rest_x : obj.position.x,
      rest_z: live ? live.rest_z : obj.position.z,
      rest_rot_z: live ? live.rest_rot_z : obj.rotation.z,
      sx: live ? live.sx : obj.scale.x,
      sy: live ? live.sy : obj.scale.y,
      sz: live ? live.sz : obj.scale.z,
    }
  }
}

/**
 * Arm the clipless-attacker lunge at beat() time: a forward strike-and-return along the attacker's facing
 * (beat() has just yawed it toward its target via opts.face; the rig's +Z is forward), peaking at the beat's
 * DESIGNED impact fraction so full extension lands exactly when the damage/burst resolve. Mirrors
 * react_to_impact's recoil arming: rest captured once (a re-arm mid-lunge reuses the live rest so it can
 * never drift off its cell), skipped while walking or under reduced motion — the beat's TIMING is untouched
 * either way (resolve_impact already scheduled it). @param {any} e @param {number} impact_time s
 * @param {number} duration s
 */
export function arm_attack_lunge(e, impact_time, duration) {
  if (e.walk || reduced_motion()) return
  const obj = e.avatar.object3d
  const yaw = e.facing_yaw ?? obj.rotation.y
  const live = e.lunge
  e.lunge = {
    t: 0,
    dx: Math.sin(yaw), // TOWARD the target — the negation of recoil_away_dir
    dz: Math.cos(yaw),
    duration,
    peak: Math.min(0.9, Math.max(0.1, duration > 0 ? impact_time / duration : 0.5)),
    rest_x: live ? live.rest_x : obj.position.x,
    rest_z: live ? live.rest_z : obj.position.z,
  }
}

/**
 * Advance the clipless-attacker lunge one frame: slide the body toward its target by LUNGE_DIST·env
 * (peak_envelope peaking on the impact instant) and restore the EXACT rest position when the beat's window
 * ends — same restore contract as advance_recoil, so a lunge can never leave a body off its cell. Self-
 * clears. @param {any} e @param {number} dt
 */
export function advance_lunge(e, dt) {
  const l = e.lunge
  if (!l) return
  l.t += dt
  const obj = e.avatar.object3d
  if (l.t >= l.duration) {
    obj.position.x = l.rest_x
    obj.position.z = l.rest_z
    e.lunge = null
    return
  }
  const env = peak_envelope(l.t / l.duration, l.peak)
  obj.position.x = l.rest_x + l.dx * LUNGE_DIST * env
  obj.position.z = l.rest_z + l.dz * LUNGE_DIST * env
}

/**
 * Advance the recoil one frame: offset the body along its away-vector by RECOIL_DIST·mag·env, layer a
 * decaying lateral SHAKE (recoil_jitter) perpendicular to it, dip its scale by RECOIL_SQUASH·env, and roll
 * it slightly (RECOIL_TIP·env — the "skew punch"), restoring the EXACT rest position/rotation/scale when the
 * flinch ends (RECOIL_DUR). The offset rides the rest captured at impact (a struck body is stationary), so
 * it can't drift. @param {any} e @param {number} dt
 */
export function advance_recoil(e, dt) {
  const r = e.recoil
  if (!r) return
  r.t += dt
  const obj = e.avatar.object3d
  if (r.t >= RECOIL_DUR) {
    obj.position.x = r.rest_x
    obj.position.z = r.rest_z
    obj.rotation.z = r.rest_rot_z
    obj.scale.set(r.sx, r.sy, r.sz)
    e.recoil = null
    return
  }
  const t01 = r.t / RECOIL_DUR
  const env = recoil_envelope(t01)
  const jitter = recoil_jitter(t01)
  const perp_dx = -r.dz // perpendicular to the away-vector — the shake rides sideways to the shove
  const perp_dz = r.dx
  obj.position.x = r.rest_x + r.dx * RECOIL_DIST * r.mag * env + perp_dx * RECOIL_JITTER_AMP * r.mag * jitter
  obj.position.z = r.rest_z + r.dz * RECOIL_DIST * r.mag * env + perp_dz * RECOIL_JITTER_AMP * r.mag * jitter
  const tip_sign = r.dx >= 0 ? 1 : -1
  obj.rotation.z = r.rest_rot_z + RECOIL_TIP * r.mag * env * tip_sign
  const m = 1 - RECOIL_SQUASH * env
  obj.scale.set(r.sx * m, r.sy * m, r.sz * m)
}

/**
 * Arm the DEATH-beat response at its impact instant: the hard-belt timestamp ALWAYS (fired unconditionally —
 * see the float-independence note at the tick() call site), plus — mirroring the hit ladder — a PROCEDURAL
 * collapse (should_procedural_death) when this rig has no real DEATH clip: without it a clipless corpse just
 * holds its last loco frame forever, reading as "still standing" (a reported regression). Idempotent
 * (won't re-arm/restart an already-collapsing body). @param {any} e @param {any} beat @param {number} now the
 * engine clock (s)
 */
export function arm_death_response(e, beat, now) {
  e.death_armed_at = now
  if (e.death_collapse || !should_procedural_death(beat)) return
  const obj = e.avatar.object3d
  e.death_collapse = { t: 0, base_scale_y: obj.scale.y, base_rot_x: obj.rotation.x }
}

/**
 * Advance the procedural death collapse one frame: crushes the body's height and topples it forward,
 * settling into (and holding) the fallen pose over DEATH_COLLAPSE_DUR. TERMINAL — never restored; the hard
 * belt removes the entity shortly after, so there is nothing to leak. Reuses float_rise_ease (the file's
 * existing ease-out arc) for the rise — one home, no new curve shape. @param {any} e @param {number} dt
 */
export function advance_death_collapse(e, dt) {
  const d = e.death_collapse
  if (!d) return
  if (d.t >= DEATH_COLLAPSE_DUR) return // holds the settled crushed/toppled pose until the belt removes it
  d.t = Math.min(DEATH_COLLAPSE_DUR, d.t + dt)
  const env = float_rise_ease(d.t / DEATH_COLLAPSE_DUR)
  const obj = e.avatar.object3d
  obj.scale.y = d.base_scale_y * (1 - DEATH_CRUSH * env)
  obj.rotation.x = d.base_rot_x + DEATH_TIP * env
}
