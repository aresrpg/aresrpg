import { describe, expect, it, afterEach } from 'bun:test'

// Headless unit tests for the SFX VARIANT ROTATION (sounds were too repetitive). All pure
// string/index math — no Audio/DOM (element_sfx_variant_src only builds a `/sfx/...` path + console.warn; the
// actual `new Audio()` lives in play_element_sfx, untested here). The rng is injected for determinism.
import { pick_variant_index, element_sfx_variant_src, element_sfx_src, is_sfx_enabled, set_sfx_enabled } from './sfx.js'

describe('pick_variant_index — non-repeating variant pick', () => {
  it('a single-variant family always returns the base index 1 (no rotation possible)', () => {
    expect(pick_variant_index(1, undefined)).toBe(1)
    expect(pick_variant_index(1, 1)).toBe(1)
  })

  it('NEVER returns the `last` index — the "same file twice in a row" rule — and stays in [1,count]', () => {
    for (let last = 1; last <= 3; last += 1)
      for (let r = 0; r < 1; r += 0.03) {
        const i = pick_variant_index(3, last, () => r)
        expect(i).not.toBe(last)
        expect(i).toBeGreaterThanOrEqual(1)
        expect(i).toBeLessThanOrEqual(3)
      }
  })

  it('with 2 variants it strictly alternates 1↔2', () => {
    expect(pick_variant_index(2, 1, () => 0)).toBe(2)
    expect(pick_variant_index(2, 1, () => 0.99)).toBe(2)
    expect(pick_variant_index(2, 2, () => 0)).toBe(1)
    expect(pick_variant_index(2, 2, () => 0.99)).toBe(1)
  })

  it('spreads across all indices when unconstrained (first play, last=undefined)', () => {
    const seen = new Set([
      pick_variant_index(3, undefined, () => 0), // → 1
      pick_variant_index(3, undefined, () => 0.5), // → 2
      pick_variant_index(3, undefined, () => 0.99), // → 3
    ])
    expect([...seen].sort()).toEqual([1, 2, 3])
  })
})

describe('element_sfx_variant_src — rotates corpus files, resolves the family, never silent', () => {
  it('a covered element uses its OWN family; an uncovered one falls back to neutral (rotated)', () => {
    expect(element_sfx_variant_src('fire', 'impact', () => 0)).toMatch(/^\/sfx\/impact_fire(_\d)?\.ogg$/)
    // 'poison' has no coverage → resolves to the neutral family (never a silent/missing file)
    expect(element_sfx_variant_src('poison', 'impact', () => 0)).toMatch(/^\/sfx\/impact_neutral(_\d)?\.ogg$/)
  })

  it('variant 1 = the base file (no numeric suffix); a higher variant carries the _N suffix', () => {
    // forcing rng → index 1 (rng 0, and 'aoe' has a single variant so it is always the base)
    expect(element_sfx_variant_src('fire', 'aoe', () => 0.99)).toBe('/sfx/aoe_fire.ogg') // aoe never rotates
    // a rotated hit is one of the fire-impact family's files, base OR a numbered variant
    expect(element_sfx_variant_src('fire', 'impact', () => 0.99)).toMatch(/^\/sfx\/impact_fire(_[23])?\.ogg$/)
  })

  it('NEVER plays the same file twice in a row across a burst of casts', () => {
    let prev = ''
    for (let n = 0; n < 24; n += 1) {
      const s = element_sfx_variant_src('fire', 'cast') // real rng, 3 fire-cast variants
      expect(s).not.toBe(prev) // guaranteed by pick_variant_index, not luck
      prev = s
    }
  })

  it('the base resolver (element_sfx_src) is always the variant-1 file (deterministic fallback)', () => {
    expect(element_sfx_src('fire', 'cast')).toBe('/sfx/cast_fire.ogg')
    expect(element_sfx_src('poison', 'cast')).toBe('/sfx/cast_neutral.ogg') // uncovered → neutral base
    expect(element_sfx_src('weapon', 'impact')).toBe('/sfx/impact_weapon.ogg')
  })
})

describe('is_sfx_enabled / set_sfx_enabled — the SOUND EFFECTS settings toggle', () => {
  afterEach(() => set_sfx_enabled(true)) // restore the shipped default so later tests see it enabled

  it("defaults to enabled (opt-OUT, not opt-in — today's behavior unchanged until the user disables it)", () => {
    expect(is_sfx_enabled()).toBe(true)
  })

  it('disabling takes effect immediately', () => {
    set_sfx_enabled(false)
    expect(is_sfx_enabled()).toBe(false)
  })

  it('re-enabling restores it', () => {
    set_sfx_enabled(false)
    set_sfx_enabled(true)
    expect(is_sfx_enabled()).toBe(true)
  })

  // get_ctx()'s `!is_sfx_enabled()` branch of its guard is NOT separately unit-tested here: bun:test has no
  // `window` (confirmed empirically), so get_ctx's leading `typeof window === 'undefined'` already short-
  // circuits to null regardless of this flag — a test flipping the sfx pref would pass for the wrong reason
  // (a false-green, CLAUDE.md Agent Execution Standard #6). The gate is a 1-line `||` add, visible at the
  // call site (get_ctx, line ~230) — verified by reading, not a black-box test that can't isolate it here.
})
