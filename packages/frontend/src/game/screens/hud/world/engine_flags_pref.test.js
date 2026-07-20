// engine_flags_pref unit tests (FLAGS → SETTINGS PAGE lane: the engine's keeper URL flags become real
// settings-page options). The module is pure localStorage + URL-string parsing (quality_pref/hp_display_pref
// idiom), so persistence and URL-override precedence are both testable at the module seam with zero DOM
// mocking — resolve_* takes the raw search string as an explicit argument instead of reading `location`.
// bun:test has no DOM localStorage — a minimal in-memory shim stands in, restored after the suite (mirrors
// hp_display_pref.test.js exactly).

import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  AMBIENCE_STORAGE_KEY,
  SUN_FOLLOW_STORAGE_KEY,
  SKY_COUPLE_STORAGE_KEY,
  TAAU_MEDIUM_STORAGE_KEY,
  FAR_FIELD_EXPERIMENTAL_STORAGE_KEY,
  REVEAL_STYLE_STORAGE_KEY,
  REVEAL_STYLE_OPTIONS,
  get_saved_ambience,
  save_ambience,
  get_saved_sun_follow,
  save_sun_follow,
  get_saved_sky_couple,
  save_sky_couple,
  get_saved_taau_medium,
  save_taau_medium,
  get_saved_far_field_experimental,
  save_far_field_experimental,
  get_saved_reveal_style,
  save_reveal_style,
  resolve_off_escape,
  resolve_on_escape,
  resolve_reveal_style,
  apply_saved_engine_flags,
} from './engine_flags_pref.js'

const store = new Map()
const real = globalThis.localStorage
globalThis.localStorage = /** @type {any} */ ({
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
})
afterAll(() => {
  if (real === undefined) delete globalThis.localStorage
  else globalThis.localStorage = real
})

describe('engine_flags_pref — defaults match the shipped engine behavior', () => {
  beforeEach(() => store.clear())

  it('ambience/sun_follow/sky_couple/taau_medium default ON (the engine escape is an OFF-only hatch)', () => {
    expect(get_saved_ambience()).toBe(true)
    expect(get_saved_sun_follow()).toBe(true)
    expect(get_saved_sky_couple()).toBe(true)
    expect(get_saved_taau_medium()).toBe(true)
  })

  it('far_field_experimental defaults OFF (audition-only, no default flip)', () => {
    expect(get_saved_far_field_experimental()).toBe(false)
  })

  it("reveal_style defaults to 'dissolve' (pool_renderer.js's own default)", () => {
    expect(get_saved_reveal_style()).toBe('dissolve')
  })
})

describe('engine_flags_pref — toggle → persisted → fresh read hydrates it', () => {
  beforeEach(() => store.clear())

  it('ambience', () => {
    save_ambience(false)
    expect(store.get(AMBIENCE_STORAGE_KEY)).toBe('0')
    expect(get_saved_ambience()).toBe(false)
    save_ambience(true)
    expect(get_saved_ambience()).toBe(true)
  })

  it('sun_follow', () => {
    save_sun_follow(false)
    expect(store.get(SUN_FOLLOW_STORAGE_KEY)).toBe('0')
    expect(get_saved_sun_follow()).toBe(false)
  })

  it('sky_couple', () => {
    save_sky_couple(false)
    expect(store.get(SKY_COUPLE_STORAGE_KEY)).toBe('0')
    expect(get_saved_sky_couple()).toBe(false)
  })

  it('taau_medium', () => {
    save_taau_medium(false)
    expect(store.get(TAAU_MEDIUM_STORAGE_KEY)).toBe('0')
    expect(get_saved_taau_medium()).toBe(false)
  })

  it('far_field_experimental', () => {
    save_far_field_experimental(true)
    expect(store.get(FAR_FIELD_EXPERIMENTAL_STORAGE_KEY)).toBe('1')
    expect(get_saved_far_field_experimental()).toBe(true)
  })

  it('reveal_style', () => {
    save_reveal_style('scan')
    expect(store.get(REVEAL_STYLE_STORAGE_KEY)).toBe('scan')
    expect(get_saved_reveal_style()).toBe('scan')
  })

  it('garbage reveal_style in storage falls back to dissolve, never leaks into state', () => {
    store.set(REVEAL_STYLE_STORAGE_KEY, 'banana')
    expect(get_saved_reveal_style()).toBe('dissolve')
  })
})

describe('engine_flags_pref — URL-override precedence (off-escape: ambience/sun_follow/sky_couple/taau_medium shape)', () => {
  it('an explicit ?param=0 overrides an ON persisted setting', () => {
    expect(resolve_off_escape('?sunfollow=0', 'sunfollow', true)).toBe(false)
  })

  it('no URL param defers to the persisted setting (both directions)', () => {
    expect(resolve_off_escape('', 'sunfollow', true)).toBe(true)
    expect(resolve_off_escape('', 'sunfollow', false)).toBe(false)
  })

  it("a non-'0' URL value is NOT a recognized override — matches the engine's own `=== '0'` check exactly", () => {
    expect(resolve_off_escape('?sunfollow=1', 'sunfollow', false)).toBe(false)
  })

  it('an unrelated URL param is ignored', () => {
    expect(resolve_off_escape('?other=0', 'sunfollow', true)).toBe(true)
  })
})

describe('engine_flags_pref — URL-override precedence (on-escape: far_terrace/far_cont shape)', () => {
  it('an explicit ?param=1 overrides an OFF persisted setting', () => {
    expect(resolve_on_escape('?farterrace=1', 'farterrace', false)).toBe(true)
  })

  it('no URL param defers to the persisted setting', () => {
    expect(resolve_on_escape('', 'farterrace', true)).toBe(true)
    expect(resolve_on_escape('', 'farterrace', false)).toBe(false)
  })

  it("a non-'1' URL value is NOT a recognized override — matches the engine's own `!== '1'` check exactly", () => {
    expect(resolve_on_escape('?farterrace=0', 'farterrace', true)).toBe(true)
  })
})

describe('engine_flags_pref — URL-override precedence (reveal_style enum shape)', () => {
  it('a recognized ?reveal= value overrides the persisted style', () => {
    for (const opt of REVEAL_STYLE_OPTIONS) expect(resolve_reveal_style(`?reveal=${opt}`, 'dissolve')).toBe(opt)
  })

  it('no URL param defers to the persisted style', () => {
    expect(resolve_reveal_style('', 'rise')).toBe('rise')
  })

  it('an unrecognized ?reveal= value is ignored, persisted style wins', () => {
    expect(resolve_reveal_style('?reveal=bogus', 'rise')).toBe('rise')
  })
})

describe('engine_flags_pref — apply_saved_engine_flags pushes persisted values into the globalThis.__ARES_* mirrors', () => {
  beforeEach(() => store.clear())
  afterEach(() => {
    delete /** @type {any} */ (globalThis).__ARES_SUN_FOLLOW
    delete /** @type {any} */ (globalThis).__ARES_SKY_COUPLE
    delete /** @type {any} */ (globalThis).__ARES_TAAU_MEDIUM
  })

  it('an OFF persisted setting writes the explicit 0 escape the engine checks for', () => {
    save_sun_follow(false)
    save_sky_couple(false)
    save_taau_medium(false)
    apply_saved_engine_flags()
    expect(/** @type {any} */ (globalThis).__ARES_SUN_FOLLOW).toBe(0)
    expect(/** @type {any} */ (globalThis).__ARES_SKY_COUPLE).toBe(0)
    expect(/** @type {any} */ (globalThis).__ARES_TAAU_MEDIUM).toBe(0)
  })

  it('the default ON setting clears any prior override (no "force on" global exists engine-side)', () => {
    /** @type {any} */ (globalThis).__ARES_SUN_FOLLOW = 0 // simulate a stale prior-session override
    save_sun_follow(true)
    apply_saved_engine_flags()
    expect('__ARES_SUN_FOLLOW' in globalThis).toBe(false)
  })
})
