// The KEEPER set of engine dev-URL flags graduated into real settings on the settings page. Pure
// localStorage + URL-precedence module — the quality_pref.js
// idiom: imports NOTHING, so embed_voxel.js can read the boot-time values without pulling in the heavier
// reboot-bridge (engine_flags.js, which imports embed_voxel.js — same split as quality_pref/render_quality).
//
// PRECEDENCE LAW: an EXPLICIT URL flag in the address bar always overrides the persisted setting (the
// dev/QA escape hatch stays live); absent a URL override, the persisted setting wins; unset ⇒ today's
// shipped default. Every resolve_* below takes the raw `search` string as an explicit argument — never
// reads `location` itself — so precedence is unit-testable with zero DOM mocking (bun:test has no DOM
// `location`, same reason hp_display_pref.test.js hand-rolls a localStorage shim instead of using jsdom).
//
// ENGINE HOOK SURVEY (packages/engine/src is READ-ONLY — FLAGS → SETTINGS PAGE lane):
//   sun_follow   → core/renderer.js:475-481 — off-escape ALSO mirrored by globalThis.__ARES_SUN_FOLLOW
//   sky_couple   → core/renderer.js:466-473 — off-escape ALSO mirrored by globalThis.__ARES_SKY_COUPLE
//   taau_medium  → core/renderer.js:704-716 — off-escape ALSO mirrored by globalThis.__ARES_TAAU_MEDIUM
//   (all three are documented dual-form escape hatches — "?x=0 or globalThis.__ARES_X=0" — a genuine
//   existing non-URL pathway, so apply_saved_engine_flags() below pushes the resolved value into the SAME
//   global the engine already reads; engine_flags.js's setters trigger a live reboot to apply it in place)
//   ambience             → engine.js:620-622        — bare `location.search` read, no config param, no global
//   far_terrace/far_cont → engine.js:1591-1596, render/far_field.js:493 — same, bare URL-only reads
//   reveal (style)       → render/pool_renderer.js:351-352 — same, bare URL-only read
// The last four have NO non-engine-editing pathway today (hence "needs a setter" in the lane report) —
// their getters/setters below still exist so a preference is captured for whenever an engine pass wires a
// setter, but nothing engine-side reads them yet; settings.tsx marks those rows disabled/pending.

export const AMBIENCE_STORAGE_KEY = 'aresrpg.ambience_enabled'
export const SUN_FOLLOW_STORAGE_KEY = 'aresrpg.sun_follow_enabled'
export const SKY_COUPLE_STORAGE_KEY = 'aresrpg.sky_couple_enabled'
export const TAAU_MEDIUM_STORAGE_KEY = 'aresrpg.taau_medium_enabled'
export const FAR_FIELD_EXPERIMENTAL_STORAGE_KEY = 'aresrpg.far_field_experimental_enabled'
export const REVEAL_STYLE_STORAGE_KEY = 'aresrpg.reveal_style'

/** The 3 first-load materialization styles (pool_renderer.js), low→high visual complexity order in the UI. */
export const REVEAL_STYLE_OPTIONS = /** @type {const} */ (['dissolve', 'rise', 'scan'])

/** @param {string} key @param {boolean} fallback @returns {boolean} */
function read_bool(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

/** @param {string} key @param {boolean} value */
function write_bool(key, value) {
  try {
    localStorage.setItem(key, value ? '1' : '0')
  } catch {
    /* non-fatal — session-only (private mode / quota) */
  }
}

// Default ON — matches engine.js/renderer.js's shipped behavior for all four (each engine escape is an
// explicit OFF; there is no "force on" state beyond the shipped default).
export const get_saved_ambience = () => read_bool(AMBIENCE_STORAGE_KEY, true)
/** @param {boolean} v */
export const save_ambience = (v) => write_bool(AMBIENCE_STORAGE_KEY, v)

export const get_saved_sun_follow = () => read_bool(SUN_FOLLOW_STORAGE_KEY, true)
/** @param {boolean} v */
export const save_sun_follow = (v) => write_bool(SUN_FOLLOW_STORAGE_KEY, v)

export const get_saved_sky_couple = () => read_bool(SKY_COUPLE_STORAGE_KEY, true)
/** @param {boolean} v */
export const save_sky_couple = (v) => write_bool(SKY_COUPLE_STORAGE_KEY, v)

export const get_saved_taau_medium = () => read_bool(TAAU_MEDIUM_STORAGE_KEY, true)
/** @param {boolean} v */
export const save_taau_medium = (v) => write_bool(TAAU_MEDIUM_STORAGE_KEY, v)

// Default OFF — matches engine.js/far_field.js's shipped behavior (audition only; the engine opt-in
// is an explicit URL '1', no default flip).
export const get_saved_far_field_experimental = () => read_bool(FAR_FIELD_EXPERIMENTAL_STORAGE_KEY, false)
/** @param {boolean} v */
export const save_far_field_experimental = (v) => write_bool(FAR_FIELD_EXPERIMENTAL_STORAGE_KEY, v)

/** The saved reveal style, or 'dissolve' (the engine default) when unset/unrecognized. @returns {'dissolve'|'rise'|'scan'} */
export function get_saved_reveal_style() {
  try {
    const v = localStorage.getItem(REVEAL_STYLE_STORAGE_KEY)
    return /** @type {any} */ (v && REVEAL_STYLE_OPTIONS.includes(/** @type {any} */ (v)) ? v : 'dissolve')
  } catch {
    return 'dissolve'
  }
}
/** @param {string} value one of REVEAL_STYLE_OPTIONS */
export function save_reveal_style(value) {
  try {
    localStorage.setItem(REVEAL_STYLE_STORAGE_KEY, value)
  } catch {
    /* non-fatal — session-only */
  }
}

// ── URL-override precedence — pure, no DOM dependency ─────────────────────────────────────────────────

/**
 * Default-ON flags whose engine escape is an explicit URL '0' (ambience/sun_follow/sky_couple/taau_medium's
 * own shape). @param {string} search raw `location.search` @param {string} param the URL flag name
 * @param {boolean} persisted the saved setting @returns {boolean}
 */
export function resolve_off_escape(search, param, persisted) {
  return new URLSearchParams(search).get(param) === '0' ? false : persisted
}

/**
 * Default-OFF flags whose engine opt-in is an explicit URL '1' (far_terrace/far_cont's shape).
 * @param {string} search @param {string} param @param {boolean} persisted @returns {boolean}
 */
export function resolve_on_escape(search, param, persisted) {
  return new URLSearchParams(search).get(param) === '1' ? true : persisted
}

/**
 * The reveal-style enum (pool_renderer.js) — a recognized URL value always wins.
 * @param {string} search @param {string} persisted @returns {'dissolve'|'rise'|'scan'}
 */
export function resolve_reveal_style(search, persisted) {
  const raw = new URLSearchParams(search).get('reveal')
  return /** @type {'dissolve'|'rise'|'scan'} */ (
    REVEAL_STYLE_OPTIONS.includes(/** @type {any} */ (raw)) ? raw : persisted
  )
}

const current_search = () => (typeof location === 'undefined' ? '' : location.search)

/**
 * Boot-apply: push the URL-precedence-resolved value of the 3 globalThis-backed flags into the SAME
 * `__ARES_*` globals the engine itself reads (core/renderer.js) — called before create_engine() constructs
 * the renderer (embed_voxel.js's create_session), so a fresh boot honors the player's saved preference
 * exactly as if they had typed the URL flag. Idempotent — engine_flags.js also calls this right before a
 * live reboot so the just-changed value is live the moment the session re-creates. Only ever WRITES an
 * explicit off-signal (0) or clears it — every one of these 3 engine escapes is off-only (no "force on"
 * global exists), so there is nothing to set for the true/default case beyond clearing a prior override.
 * @returns {void}
 */
export function apply_saved_engine_flags() {
  const g = /** @type {any} */ (typeof globalThis === 'undefined' ? {} : globalThis)
  const search = current_search()
  const set_or_clear = (/** @type {string} */ name, /** @type {boolean} */ enabled) => {
    if (enabled) delete g[name]
    else g[name] = 0
  }
  set_or_clear('__ARES_SUN_FOLLOW', resolve_off_escape(search, 'sunfollow', get_saved_sun_follow()))
  set_or_clear('__ARES_SKY_COUPLE', resolve_off_escape(search, 'skycouple', get_saved_sky_couple()))
  set_or_clear('__ARES_TAAU_MEDIUM', resolve_off_escape(search, 'taau_medium', get_saved_taau_medium()))
}
