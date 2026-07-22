// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Sound effects — UI cues (ported aac one-shots) + synthesized COMBAT cues. The combat cues are pure
// Web Audio (oscillator + noise envelopes, zero assets) so the fight has instant juice without shipping
// audio files: cast (rising blip), hit (noise thwack), heal (soft chime), turn (two-note ping), warn
// (urgent last-10s beep), ready (confirm tick), win (ascending arpeggio), lose (descending). One shared
// AudioContext, lazily built on the first play (a user gesture has happened by the time a fight starts).
// SFX are independent of the ambient-music mute (ambient_music.js) — their OWN preference below gates them.

// ---------------------------------------------------------------------------------------------
// SOUND-EFFECTS preference — a separate persisted on/off (music, fight music, and
// sound effects are independently disableable in settings). ONE gate for the whole file: get_ctx() (every synthesized cue,
// PLUS footstep_sfx.js which shares this same context) returns null while disabled, and the two file-backed
// players (play_sfx, play_element_sfx) check it directly since they never call get_ctx(). No per-cue
// changes needed anywhere else — nothing loops here (every SFX is a one-shot), so disabling just gates
// FUTURE calls; nothing to tear down.
// ---------------------------------------------------------------------------------------------

import {
  ELEMENT_AUDIO_VARIANTS,
  audio_asset_src,
  element_audio_key,
  element_audio_src,
  play_audio,
} from './audio_registry.js'

const SFX_STORAGE_KEY = 'ares_sfx'

/** @returns {boolean} true if the user previously disabled sound effects */
function read_sfx_pref() {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(SFX_STORAGE_KEY) === 'off'
  } catch {
    return false
  }
}

/** @param {boolean} muted */
function write_sfx_pref(muted) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SFX_STORAGE_KEY, muted ? 'off' : 'on')
  } catch {
    /* private mode / disabled storage — preference just won't persist */
  }
}

let sfx_muted = read_sfx_pref()

/** @returns {boolean} true unless the user disabled sound effects */
export function is_sfx_enabled() {
  return !sfx_muted
}

/** @param {boolean} enabled @returns {void} */
export function set_sfx_enabled(enabled) {
  sfx_muted = !enabled
  write_sfx_pref(!enabled)
}

/** Per-name volume override for `play_sfx` (falls back to 0.4 below). The three accents stay quieter than a
 *  primary impact (0.5, sfx.js element_sfx_volume) so they read as a LAYER, not a competing duplicate. The
 *  player's OWN death is a headline beat (you lost) — the loudest one-shot here. */
const SOURCE_VOLUME = { crit: 0.45, death: 0.4, knockback: 0.32, player_death: 0.6 }

/**
 * Play a one-shot UI sound (file-backed).
 * @param {string} name registered audio key
 * @returns {void}
 */
export function play_sfx(name) {
  if (!is_sfx_enabled()) return
  void play_audio(name, { volume: SOURCE_VOLUME[name] ?? 0.4 }).catch(() => {})
}

// ── F1: 2-LAYER ELEMENT SFX (file-backed OGG) ─────────────────────────────────────────────────────────
// The reference's two-part spell sound: a `cast` cue on the wind-up + an `impact` cue on the land, keyed
// per (element, layer) pair (extracted placeholders — replace-before-release). The registry's variant table is
// also the coverage truth; any (element, layer) pair NOT registered falls back to the neutral one-shot for that
// layer — never silence, same policy as fight_cast_vfx's art. Louder than the synth UI cues (the impact is a
// loud fight moment) but capped so it never clips.
const element_sfx_volume = { cast: 0.35, impact: 0.5, aoe: 0.32 }

/** The family a beat resolves to: the covered element, else 'neutral' (the fallback that keeps a beat from ever
 *  going silent). @param {string} element @param {string} layer */
const sfx_family = (element, layer) =>
  Object.hasOwn(ELEMENT_AUDIO_VARIANTS, `${element}:${layer}`) ? element : 'neutral'

/** The BASE (variant-1) src for one layer of an element's sound — the deterministic file, never
 *  silent (falls back to neutral). Pure — unit-tested without touching Audio/DOM. @param {string} element
 *  @param {'cast' | 'impact' | 'aoe'} layer */
export const element_sfx_src = (element, layer) => element_audio_src(sfx_family(element, layer), layer) ?? ''

// ── VARIANT ROTATION (sounds were too repetitive) ──────────────────────────────────────────
// The cast whoosh + the impact thwack fire on EVERY spell / EVERY hit, so ONE file per family = the same sound on
// loop (too repetitive). Each high-frequency family now cycles 2–3 registered CORPUS variants. A seeded, NON-REPEATING pick per play
// (never the same file twice in a row) breaks the monotony. Corpus files ONLY — a family on a rotation layer with
// <2 variants plays its base and loud-warns ONCE (an honest coverage gap, never a faked/duplicated file). The
// copied variants (all from the extraction corpus, same extracted-placeholder footing as the bases): cast = Charge/
// PowerUp/Whoosh/Swish per element; impact = element explosion + Impact_{Ice,Earth,Human,Metal} shorts.
/** How many files exist for a family:layer (base + extras). Absent ⇒ 1 (the base only, no rotation). */
const variant_count = (/** @type {string} */ family, /** @type {string} */ layer) =>
  ELEMENT_AUDIO_VARIANTS[`${family}:${layer}`] ?? 1
/** The layers that SHOULD rotate (every-beat sounds) — a <2-variant family on these loud-warns as a coverage gap. */
const ROTATION_LAYERS = new Set(['cast', 'impact'])

/**
 * Pick a variant index in [1, count], never equal to `last` (no immediate repeat — "never the same file twice in
 * a row"). Pure; the rng is injectable for deterministic tests. @param {number} count total files for the family
 * @param {number} [last] the previous index for this family (undefined ⇒ first play) @param {() => number} [rng]
 * @returns {number} an index 1..count
 */
export const pick_variant_index = (count, last, rng = Math.random) => {
  if (count <= 1) return 1
  let i = 1 + Math.floor(rng() * count) // 1..count
  if (i > count) i = count // guard the rng() === 1 corner
  if (i === last) i = (i % count) + 1 // collided with the last one → step to the next (wraps count→1); never repeats
  return i
}

// per family:layer: the last variant index played (the no-immediate-repeat memory) + the once-warned short families.
const _last_variant = /** @type {Map<string, number>} */ (new Map())
const _warned_variants = /** @type {Set<string>} */ (new Set())
/**
 * The ROTATED src for a beat: resolve the family and pick a non-repeating registered variant. A family on a rotation layer (cast/impact) with <2 corpus variants
 * loud-warns ONCE and plays its base. Stateful (the no-repeat memory); the rng is injectable for tests.
 * @param {string} element @param {'cast'|'impact'|'aoe'} layer @param {() => number} [rng] @returns {string}
 */
const element_sfx_variant_key = (element, layer, rng = Math.random) => {
  const family = sfx_family(element, layer)
  const key = `${family}:${layer}`
  const count = variant_count(family, layer)
  if (ROTATION_LAYERS.has(layer) && count < 2 && !_warned_variants.has(key)) {
    _warned_variants.add(key)
    const missing_src = element_audio_src(family, layer, 2)
    console.warn(
      `[fight-sfx] "${key}" plays ONE file every time (<2 corpus variants) — repetitive. Add ` +
        `${missing_src ?? element_audio_key(family, layer, 2)} from the extraction corpus (never duplicate the base to fake a variant).`
    )
  }
  const idx = pick_variant_index(count, _last_variant.get(key), rng)
  _last_variant.set(key, idx)
  return element_audio_key(family, layer, idx)
}

export const element_sfx_variant_src = (element, layer, rng = Math.random) =>
  audio_asset_src(element_sfx_variant_key(element, layer, rng)) ?? ''

// LOUD-NOT-SILENT fallback telemetry (enemy casts were all collapsing onto one shared sound): the moment an (element,
// layer) beat has no dedicated file and rides the neutral one-shot, name the family ONCE (deduped — a fight
// fires the same beat dozens of times) so a "why does this sound generic" is diagnosable at a glance instead of
// vanishing. A family that legitimately shares neutral is fine; this just makes the sharing visible.
const _warned_fallbacks = new Set()
const warn_sfx_fallback = (/** @type {string} */ element, /** @type {string} */ layer) => {
  const key = `${element}:${layer}`
  if (Object.hasOwn(ELEMENT_AUDIO_VARIANTS, key) || _warned_fallbacks.has(key)) return
  _warned_fallbacks.add(key)
  const wanted = element_audio_src(element, layer) ?? element_audio_key(element, layer)
  console.warn(
    `[fight-sfx] no dedicated "${layer}" sound for element "${element}" — using neutral. ` +
      `Register "${key}" (${wanted}) from the extraction corpus to give it its own voice.`
  )
}

/**
 * Play one layer of a cast's element sound. `cast` fires on the wind-up (the caster whoosh), `impact` when the
 * projectile lands (the target hit), `aoe` as an extra wash layered under `impact` when the beat struck ≥3
 * cells. Best-effort, silent if the file is missing.
 * @param {string} element spell element (fire/water/earth/air/weapon/heal/neutral/…); uncovered pairs fall back to neutral
 * @param {'cast' | 'impact' | 'aoe'} layer which layer of the beat
 * @returns {void}
 */
export function play_element_sfx(element, layer) {
  if (!is_sfx_enabled()) return
  warn_sfx_fallback(element, layer) // loud once if this (element, layer) has no dedicated file (rides neutral)
  // ROTATE among the family's corpus variants (sounds were too repetitive) — never the same file twice in
  // a row; falls back to the base for a single-variant family. Transparent to callers (adapter/fight-sfx unchanged).
  const key = element_sfx_variant_key(element, layer)
  void play_audio(key, { volume: element_sfx_volume[layer] ?? 0.4 }).catch(() => {})
}

// ── synthesized combat SFX (Web Audio) ────────────────────────────────────────────────

/** @type {AudioContext | null} */
let actx = null
// Exported (footstep_sfx.js — world-ambience audio) so every synthesized sound in the app, one-shot or
// looping, shares this ONE lazy AudioContext instead of each module spinning up its own.
export const get_ctx = () => {
  if (typeof window === 'undefined' || !is_sfx_enabled()) return null
  if (!actx) {
    const Ctor = window.AudioContext ?? /** @type {any} */ (window).webkitAudioContext
    if (!Ctor) return null
    actx = new Ctor()
  }
  if (actx.state === 'suspended') actx.resume().catch(() => {})
  return actx
}

/** A short oscillator tone with an attack/decay envelope. Exported for the footstep knock/splash accent
 *  layers (footstep_sfx.js) — same idiom, no reimplementation. @returns {void} */
export const tone = (freq, dur, type, gain, ctx, when = 0, slide_to) => {
  const t0 = ctx.currentTime + when
  const osc = ctx.createOscillator()
  const env = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (slide_to) osc.frequency.exponentialRampToValueAtTime(slide_to, t0 + dur)
  env.gain.setValueAtTime(0, t0)
  env.gain.linearRampToValueAtTime(gain, t0 + 0.008)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(env)
  env.connect(ctx.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

/** A burst of filtered noise (impact thwack). @returns {void} */
const noise = (dur, gain, ctx, cutoff = 1800) => {
  const t0 = ctx.currentTime
  const len = Math.floor(ctx.sampleRate * dur)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = ctx.createBufferSource()
  src.buffer = buf
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = cutoff
  const env = ctx.createGain()
  env.gain.setValueAtTime(gain, t0)
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(filter)
  filter.connect(env)
  env.connect(ctx.destination)
  src.start(t0)
  src.stop(t0 + dur + 0.02)
}

/**
 * A satisfying harvest "pop" for a completed gather (Wave GATHER) — a soft pluck thunk + a bright
 * two-note rising chime so the reward reads as a pleasant collect cue (the monkey-brain dopamine hit).
 * Synthesized (zero assets), best-effort silent if Web Audio is unavailable.
 * @returns {void}
 */
export function play_gather_sfx() {
  const ctx = get_ctx()
  if (!ctx) return
  noise(0.08, 0.06, ctx, 1400) // soft pluck/thunk of the harvest
  tone(523, 0.12, 'triangle', 0.14, ctx, 0.02) // C5
  tone(784, 0.18, 'sine', 0.12, ctx, 0.1, 1046) // G5 -> C6 sparkle
}

/**
 * The zone-reveal "discovery chime" (`discovery_chime`) — a 3-note ascending sparkle, ~0.3s,
 * with NO percussive head (this is a map reveal, not a physical action; contrast the gather pop's pluck).
 * Fires on a search-zone success (the reward beat). Synthesized, restrained (kin to the win arpeggio but
 * softer/shorter — never louder than the arm-blip it follows). Best-effort silent if Web Audio is gone.
 * @returns {void}
 */
export function play_discovery_sfx() {
  const ctx = get_ctx()
  if (!ctx) return
  tone(659, 0.14, 'triangle', 0.11, ctx, 0.0) // E5
  tone(988, 0.16, 'triangle', 0.11, ctx, 0.08) // B5
  tone(1319, 0.3, 'sine', 0.1, ctx, 0.16, 1976) // E6 -> B6 shimmer tail (the sparkle)
}

/**
 * Play a synthesized combat cue. Best-effort: silent if Web Audio is unavailable. Design spec_fight_juice §3:
 * restrained dark-fantasy DNA (kin to the fight-end card tolls), NOT arcadey — most cues quiet, the IMPACT +
 * CRIT are the loud moments.
 * @param {'cast'|'hit'|'crit'|'heal'|'move'|'warn'|'ready'|'win'|'lose'|'deny'|'fight_start'} name
 * @returns {void}
 */
export function play_fight_sfx(name) {
  const ctx = get_ctx()
  if (!ctx) return
  switch (name) {
    case 'fight_start':
      // FIGHT-ENTRY HERALD: the "battle begins" sting that pairs with the iso snap + sword
      // drop — a low horn-like swell rising into a soft bright accent. Dark-fantasy + restrained (kin to the
      // card tolls), NOT an arcade fanfare.
      tone(110, 0.5, 'sawtooth', 0.1, ctx, 0, 165) // low horn swell A2 -> E3
      tone(220, 0.45, 'sine', 0.08, ctx, 0.04, 330) // a warm body over it
      tone(660, 0.3, 'triangle', 0.07, ctx, 0.2, 880) // a soft bright accent tail (the "go")
      break
    case 'cast':
      // soft airy element WHOOSH on the wind-up: a low-passed swish + a gentle rising body. Short, not screechy.
      noise(0.18, 0.05, ctx, 900)
      tone(220, 0.2, 'sine', 0.06, ctx, 0, 360)
      break
    case 'hit':
      // damped weighty THUNK: a short low-passed body-thud + a low sine thump. No ring-out, no cartoon boing.
      noise(0.09, 0.28, ctx, 500)
      tone(96, 0.12, 'sine', 0.2, ctx, 0, 60)
      break
    case 'crit':
      // the thunk + ONE extra layer: a heavier/deeper sub-thump + a bright short gold ping. Heavier AND
      // brighter than a normal hit, still one accent — never a fanfare.
      noise(0.1, 0.3, ctx, 560)
      tone(70, 0.22, 'sine', 0.26, ctx, 0, 44) // sub-thump (deeper + longer than a normal hit)
      tone(1568, 0.16, 'triangle', 0.12, ctx, 0.02, 2100) // bright gold ping accent
      break
    case 'heal':
      // a soft warm rising shimmer — two gentle sines sliding up, no jingle
      tone(523, 0.34, 'sine', 0.1, ctx, 0, 784) // C5 -> G5 warm rise
      tone(784, 0.4, 'sine', 0.07, ctx, 0.06, 1046) // C6 shimmer over it
      break
    case 'move':
      tone(280, 0.07, 'triangle', 0.06, ctx) // a soft muted step (quiet)
      break
    case 'warn':
      // last-10s TENSION cue: a quiet LOW rising tone (dread), not a shrill arcade beep
      tone(220, 0.5, 'sine', 0.09, ctx, 0, 330)
      break
    case 'ready':
      tone(660, 0.08, 'triangle', 0.12, ctx) // confirm tick
      break
    case 'win':
      ;[523, 659, 784, 1046].forEach((f, i) => tone(f, 0.24, 'triangle', 0.16, ctx, i * 0.12))
      break
    case 'lose':
      ;[440, 370, 294].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.14, ctx, i * 0.14))
      break
    case 'deny':
      // a soft "not there" nudge for a click off the legal zone — two quick muted low blips, restrained (never a
      // harsh error buzz). Reinforces the placement banner's visual shake — no dead interactions.
      tone(200, 0.06, 'sine', 0.06, ctx, 0)
      tone(150, 0.07, 'sine', 0.05, ctx, 0.07)
      break
    default:
      break
  }
}
