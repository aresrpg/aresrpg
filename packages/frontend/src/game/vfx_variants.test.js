// Unit coverage for the pure per-spell VFX variant selector (the b_spell spread strategy). Proves the selector is
// deterministic, maps each (class/element/role) branch to the DOCUMENTED ported-pack variant, only ever returns a
// name from the real b_spell preset set (never a typo), and — driven over the whole 240-spell corpus — spreads
// same-element spells across DIFFERENT variants (the "Gale Slash ≠ Storm Arc" mandate) with zero throws.
import { describe, expect, it } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { variant_for, spell_hash } from './vfx_variants.js'

// The 35 b_spell preset names the engine modules export (vfx_presets_{dark,air,elemental,flame}.js) — the ONLY
// names the selector may return. Kept inline so this frontend test is hermetic (no engine-merge dependency).
const DARK = ['black', 'evil', 'void'].flatMap((t) => [`dark_orb_${t}`, `dark_bolt_${t}`, `dark_zone_${t}`])
const AIR = Array.from({ length: 6 }, (_, i) => String(i + 1).padStart(2, '0')).flatMap((n) => [
  `air_bolt_orb_${n}`,
  `air_zap_strike_${n}`,
])
const ELEM = ['fire', 'nature', 'electric'].flatMap((e) => [
  `elem_variant_${e}_cast`,
  `elem_variant_${e}_bolt`,
  `elem_variant_${e}_area`,
])
const FLAME = ['cold', 'green', 'light', 'purple', 'void'].map((t) => `flame_variant_${t}`)
const VALID = new Set([...DARK, ...AIR, ...ELEM, ...FLAME])

const spell = (/** @type {object} */ o) => ({ id: 'x_test_spell', ...o })

describe('variant_for — deterministic per-spell VFX variant', () => {
  it('is pure: same spell → same variant every call', () => {
    const s = spell({ classType: 'yajin', element: 'air', role: 'damage' })
    expect(variant_for(s)).toBe(variant_for(s))
    expect(spell_hash('abc')).toBe(spell_hash('abc'))
    expect(spell_hash('abc')).not.toBe(spell_hash('abd'))
  })

  it('returns null (element default) for a spell with no id, and for un-mapped water/neutral damage', () => {
    expect(variant_for(null)).toBeNull()
    expect(variant_for({})).toBeNull()
    expect(variant_for(spell({ element: 'water', role: 'damage' }))).toBeNull()
    expect(variant_for(spell({ element: 'neutral', role: 'damage' }))).toBeNull()
  })

  it('TELEPORT → the arcane-purple utility flavour (never null — the render queue needs a real beat)', () => {
    // element-agnostic self-relocation: warleap carries no damage element, so the role decides, not the element.
    expect(variant_for(spell({ classType: 'senshi', role: 'teleport' }))).toBe('flame_variant_purple')
    expect(variant_for(spell({ element: 'neutral', role: 'teleport' }))).toBe('flame_variant_purple')
    expect(variant_for(spell({ element: 'fire', role: 'teleport' }))).toBe('flame_variant_purple')
  })

  it('YAJIN necromancer → the DarkMagic family, split by role (damage=orb · dot=bolt · trap=zone)', () => {
    expect(variant_for(spell({ classType: 'yajin', role: 'damage' }))).toMatch(/^dark_orb_(black|evil|void)$/)
    expect(variant_for(spell({ classType: 'yajin', role: 'dot' }))).toMatch(/^dark_bolt_(black|evil|void)$/)
    expect(variant_for(spell({ classType: 'yajin', role: 'life_steal' }))).toMatch(/^dark_bolt_/)
    expect(variant_for(spell({ classType: 'yajin', role: 'trap' }))).toMatch(/^dark_zone_/)
    expect(variant_for(spell({ classType: 'yajin', role: 'state' }))).toMatch(/^dark_zone_/)
  })

  it('AIR → the 6-tint ball rotation (damage) · skyfall strike (pull/push) · golden elemental lightning (drain/dot)', () => {
    expect(variant_for(spell({ element: 'air', role: 'damage' }))).toMatch(/^air_bolt_orb_0[1-6]$/)
    expect(variant_for(spell({ element: 'air', role: 'pull' }))).toMatch(/^air_zap_strike_0[1-6]$/)
    expect(variant_for(spell({ element: 'air', role: 'push' }))).toMatch(/^air_zap_strike_0[1-6]$/)
    expect(variant_for(spell({ element: 'air', role: 'drain_ap' }))).toBe('elem_variant_electric_bolt')
    expect(variant_for(spell({ element: 'air', role: 'dot' }))).toBe('elem_variant_electric_area')
  })

  it('FIRE → ElementalMagic fire (damage=bolt · dot=area) · void-flame (punishment)', () => {
    expect(variant_for(spell({ element: 'fire', role: 'damage' }))).toBe('elem_variant_fire_bolt')
    expect(variant_for(spell({ element: 'fire', role: 'dot' }))).toBe('elem_variant_fire_area')
    expect(variant_for(spell({ element: 'fire', role: 'punishment' }))).toBe('flame_variant_void')
  })

  it('EARTH → ElementalMagic nature (damage=bolt · glyph=area) · green-flame (dot)', () => {
    expect(variant_for(spell({ element: 'earth', role: 'damage' }))).toBe('elem_variant_nature_bolt')
    expect(variant_for(spell({ element: 'earth', role: 'glyph' }))).toBe('elem_variant_nature_area')
    expect(variant_for(spell({ element: 'earth', role: 'dot' }))).toBe('flame_variant_green')
  })

  it('flavoured flame overrides: water dot=cold · heal=light · neutral buff=purple', () => {
    expect(variant_for(spell({ element: 'water', role: 'dot' }))).toBe('flame_variant_cold')
    expect(variant_for(spell({ element: 'neutral', role: 'heal' }))).toBe('flame_variant_light')
    expect(variant_for(spell({ element: 'neutral', role: 'buff_stat' }))).toBe('flame_variant_purple')
  })

  it('over the WHOLE 240-spell corpus: never throws, every non-null is a REAL b_spell preset, and same-element spells SPREAD across variants', () => {
    const dir = join(import.meta.dir, '../../../../seed/mainnet/spells')
    /** @type {Record<string, Set<string>>} */
    const per_element = {}
    let total = 0
    let mapped = 0
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const arr = JSON.parse(readFileSync(join(dir, f), 'utf8'))
      for (const s of Array.isArray(arr) ? arr : Object.values(arr)) {
        total += 1
        const v = variant_for(s)
        if (v === null) continue
        mapped += 1
        expect(VALID.has(v), `${s.id} → ${v} is a real b_spell preset`).toBe(true)
        ;(per_element[s.element] ??= new Set()).add(v)
      }
    }
    expect(total).toBe(240)
    expect(mapped).toBeGreaterThan(150) // the majority of the book gets a distinct variant
    // the spread mandate: air's 54 spells land on MANY distinct bolts, not one shared beat.
    expect(per_element.air.size, 'air spreads across many variants').toBeGreaterThanOrEqual(6)
    expect(per_element.fire.size, 'fire spreads').toBeGreaterThanOrEqual(2)
    expect(per_element.earth.size, 'earth spreads').toBeGreaterThanOrEqual(2)
  })
})
