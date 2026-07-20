// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import spellbook_seed from './spellbook-seed.json'
import EN from '../../../i18n/locales/en.json' with { type: 'json' }
import FR from '../../../i18n/locales/fr.json' with { type: 'json' }
import DE from '../../../i18n/locales/de.json' with { type: 'json' }
import ES from '../../../i18n/locales/es.json' with { type: 'json' }
import JA from '../../../i18n/locales/ja.json' with { type: 'json' }
import UK from '../../../i18n/locales/uk.json' with { type: 'json' }
import { fight_spells_data } from './fight-spells.js'
import { spell_effects } from './spellbook-data.js'
import { seed_effect_line, seed_effect_parts, is_area_effect, TONE_BUFF, TONE_BAD, HEAL_PINK } from './seed-effect-line.js'

// D113 COVERAGE TEST — the class-killer. When a player grabs ANY class's spell in a dungeon, the armed
// readout must show COMPLETE info (range / AP / an effect line) and the board must be able to paint a
// cast-range. The disease was per-class: a fix for one spell (fire_strike) left the others (backstab, …)
// rendering NOTHING. This walks EVERY seeded spell — the exact source the client reads (spellbook-seed.json,
// generated from the on-chain seed SSOT) — and fails on the FIRST gap, so a future spell that ships without
// complete cast_params or a resolvable render can never regress silently.
//
// It also asserts the render path itself (spell_effects → seed_effect_line) yields a non-empty, non-slug
// string for every effect of every spell — the "no silent nothing / production-ready" law. A `t` stub returns
// the key + params so a MISSING i18n key or an UNHANDLED effect kind (returns '') is caught here, not on screen.

// A translate stub: echoes the key so an unhandled effect kind (seed_effect_line → '') is detectable, and
// records the interpolation params so we can assert the real value (base/turns/…) reached the line.
const t_stub = (key, params) =>
  params
    ? `${key}(${Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .join(',')})`
    : key

// The 4 classes actually seeded on-chain (spell_registry.move: senshi/yajin/tomoda/shugo). If the chain adds a
// class, this list gates the "every class resolves a primary" assertion — bump it in lockstep with the seed.
const SEEDED_CLASSES = ['senshi', 'yajin', 'tomoda', 'shugo']

// The true-taxonomy effect kinds the seed emits (gen_spellbook_seed.mjs). A NEW kind must get a
// seed_effect_line branch (else it renders blank) — this set makes that requirement a test, not a hope.
const KNOWN_EFFECT_KINDS = new Set([
  'DAMAGE',
  'PLACE_TRAP',
  'PUSH',
  'TELEPORT',
  'INVISIBILITY',
  'GIVE_MP',
  'ALTER_STAT',
  'REDUCE_DAMAGE',
  'ALTER_RESIST',
])

describe('D113 seed-spell render coverage', () => {
  test('the seed is non-empty and every spell carries the class/level shape the client reads', () => {
    expect(spellbook_seed.spells.length).toBeGreaterThan(0)
    for (const sp of spellbook_seed.spells) {
      expect(typeof sp.class).toBe('string')
      expect(typeof sp.name_key).toBe('string')
      expect(Array.isArray(sp.levels)).toBe(true)
      expect(sp.levels.length).toBe(6) // #57 model: every spell has exactly 6 levels
    }
  })

  // The core gate: for EVERY spell, level 1 (the only castable level in the dungeon MVP) must be complete —
  // an AP cost, a real range OR an explicit self-cast (0-0 with a self/utility effect), and ≥1 effect. This
  // is exactly the data the armed readout + cast-range wash consume; a gap here is a blank readout on screen.
  for (const sp of spellbook_seed.spells) {
    test(`${sp.class}/${sp.name_key} — level 1 cast_params are complete`, () => {
      const l1 = sp.levels[0]
      expect(l1).toBeTruthy()

      // AP: a cast always costs points (a 0-AP dungeon spell would be a free infinite cast — never seeded).
      expect(typeof l1.ap).toBe('number')
      expect(l1.ap).toBeGreaterThan(0)

      // RANGE: [min,max]. max>0 = a ranged/melee target; [0,0] is a legal SELF cast (buffs like stoneward) —
      // but ONLY when the spell has a self/utility effect (never a 0-range damage spell → that'd be unhittable).
      expect(Array.isArray(l1.range)).toBe(true)
      expect(l1.range.length).toBe(2)
      const [rmin, rmax] = l1.range
      expect(rmin).toBeGreaterThanOrEqual(0)
      expect(rmax).toBeGreaterThanOrEqual(rmin)
      const effects = l1.effects ?? []
      const has_offense = effects.some((e) => e.kind === 'DAMAGE' || e.kind === 'PLACE_TRAP')
      if (rmax === 0) expect(has_offense).toBe(false) // a self-cast can't carry a target-needing damage effect

      // EFFECTS: at least one — a spell that does nothing has no reason to exist and renders an empty readout.
      expect(effects.length).toBeGreaterThan(0)
    })

    // The RENDER path: spell_effects (colour-tags the seed effects) → seed_effect_line (localizes each). Every
    // effect must yield a NON-EMPTY line whose kind is known — this is what guarantees "no silent nothing" on
    // the armed readout. An unhandled kind (blank line) or a stripped value fails HERE.
    test(`${sp.class}/${sp.name_key} — every level-1 effect renders a non-empty line`, () => {
      const tagged = spell_effects(sp.levels[0])
      expect(tagged.length).toBeGreaterThan(0)
      for (const fx of tagged) {
        expect(KNOWN_EFFECT_KINDS.has(fx.kind)).toBe(true) // a NEW kind needs a seed_effect_line branch
        expect(typeof fx.color).toBe('string')
        const line = seed_effect_line(t_stub, fx)
        expect(typeof line).toBe('string')
        expect(line.length).toBeGreaterThan(0) // the blank-render bug this whole ticket is about
      }
    })
  }

  // Every seeded class must resolve a PRIMARY spell (the dungeon hand card the player grabs). This is the
  // lookup DungeonBoard + the armed readout both do (spells.find(class===my_class)); a class with no primary
  // = a grabbed card that resolves to nothing (the original D113 symptom for a whole class).
  test('every seeded class resolves a primary spell (the grabbable dungeon card)', () => {
    for (const cls of SEEDED_CLASSES) {
      const primary = spellbook_seed.spells.find((sp) => sp.class === cls)
      expect(primary).toBeTruthy()
      expect(primary.name_key.length).toBeGreaterThan(0)
      expect(primary.levels[0].ap).toBeGreaterThan(0)
    }
  })
})

// S-64 COVERAGE — the LIVE grimoire's REAL SSOT. The D113 suite above walks the DEPRECATED spellbook-seed.json
// (still the template non-dungeon fallback's source); the actual character-page grimoire (Spellbook.jsx) and
// the dungeon armed readout (DungeonSpellReadout.jsx) both read the derived full 240-spell corpus —
// which that suite never touches. That gap is exactly how a VANISH rank-6 GIVE_POINTS effect (yajin, an AP
// grant) rendered a BLANK bullet and a PLACE_TRAP effect (tomoda kelp_snare/tidemarker/barrow_trap, yajin
// shadow_trap, mori scorchmite_glyph) THREW outright (`fx.payload.base` on an object with no `payload` field) —
// both invisible to the D113 test because it only ever exercised the OLD 9-kind legacy taxonomy. This walks
// EVERY spell × every level × every effect in the REAL corpus and fails loudly on the first blank/unhandled/
// throwing line, so a future reseed can never regress this silently again.
describe('S-64 live derived spell corpus — full effect-render coverage', () => {
  const all_effects = () => {
    const rows = []
    for (const sp of fight_spells_data.spells)
      for (let i = 0; i < sp.levels.length; i++)
        for (const fx of sp.levels[i].effects ?? [])
          rows.push({ class: sp.class, name_key: sp.name_key, level: i + 1, fx })
    return rows
  }

  test('the corpus is non-empty and carries every effect kind the KIT corpus seeds', () => {
    // The SPELL_KITS corpus (docs/SPELL_KITS.md) deliberately routes around the INERT kinds
    // (Appendix A: swap/state/dispel/reflect/reduce/return) — 17 functional kinds, all rendered.
    const kinds = new Set(all_effects().map((r) => r.fx.kind))
    expect(kinds.size).toBeGreaterThanOrEqual(17)
    for (const k of [
      'DAMAGE',
      'HEAL',
      'APPLY_DOT',
      'PLACE_TRAP',
      'PLACE_GLYPH',
      'INVISIBILITY',
      'GIVE_POINTS',
      'STEAL_POINTS',
      'ALTER_RESIST',
      'TELEPORT',
    ])
      expect(kinds.has(k)).toBe(true)
  })

  test('every generated DAMAGE effect carries authored bounds, including both range and equal-bound fixtures', () => {
    const damage = all_effects()
      .filter(({ fx }) => fx.kind === 'DAMAGE')
      .map(({ fx }) => fx)
    expect(damage.length).toBeGreaterThan(0)
    expect(damage.every((fx) => fx.damageMin != null && fx.damageMax != null)).toBe(true)
    expect(damage.some((fx) => fx.damageMin !== fx.damageMax)).toBe(true)
    expect(damage.some((fx) => fx.damageMin === fx.damageMax)).toBe(true)
  })

  test('every spell × level × effect renders a NON-EMPTY, NON-CANARY line — never throws', () => {
    for (const { class: cls, name_key, level, fx } of all_effects()) {
      let line
      expect(() => {
        line = seed_effect_line(t_stub, fx)
      }).not.toThrow(`${cls}/${name_key} L${level} (${fx.kind}) threw instead of rendering`)
      expect(typeof line).toBe('string')
      expect(line.length).toBeGreaterThan(0)
      expect(line.startsWith('? ')).toBe(false) // '? KIND' = the loud canary for an unmapped kind — never real output
    }
  })

  test('yajin Vanish rank 6 — 1.29-exact: INVISIBILITY + the +2 MP grant, not a blank bullet', () => {
    const vanish = fight_spells_data.spells.find((spell) => spell.class === 'yajin' && spell.name_key === 'vanish')
    expect(vanish).toBeTruthy()
    const rank6 = vanish.levels[5]
    const lines = rank6.effects.map((fx) => seed_effect_line(t_stub, fx))
    expect(lines.some((l) => l.includes('spells.fx_invisibility'))).toBe(true)
    // SPELL_KITS reseed (sorts.sql id 72 atom 128): Vanish grants +1 MP ranks 1-5 and
    // +2 MP at rank 6 — the old corpus's +1 AP was the generator's error and died at the reseed.
    const give_points = rank6.effects.find((e) => e.kind === 'GIVE_POINTS')
    expect(give_points.stat).toBe(1) // POINT_MP
    // Parts grammar: GIVE_POINTS renders fx_stat with the MP stat view (sign in pre, abs value) — and
    // the raw-verified duration (sorts.sql 72: the MP rider rides the invisibility, 3 turns) as meta.
    const mp_line = lines.find((l) => l.includes('stat.movement'))
    expect(mp_line).toBeTruthy()
    expect(mp_line).toContain('+2')
    expect(mp_line).toContain('spells.fx_turns(count=3)') // regression guard: never "1 TURNS" again
    expect(lines.some((l) => l.includes('stat.action'))).toBe(false) // never the wrong resource (AP)
  })

  test('a live PLACE_TRAP spell (yajin fanged_snare) renders without crashing (the old fx.payload.base throw)', () => {
    const kelp = fight_spells_data.spells.find((spell) => spell.class === 'yajin' && spell.name_key === 'fanged_snare')
    expect(kelp).toBeTruthy()
    const trap_fx = kelp.levels[0].effects.find((e) => e.kind === 'PLACE_TRAP')
    expect(trap_fx).toBeTruthy()
    expect(() => seed_effect_line(t_stub, trap_fx)).not.toThrow()
  })

  test('ALTER_STAT / ALTER_RESIST carry their TRUE signed value through (no undefined field, no forced "+")', () => {
    const signed = all_effects().filter((r) => r.fx.kind === 'ALTER_STAT' || r.fx.kind === 'ALTER_RESIST')
    expect(signed.length).toBeGreaterThan(0)
    expect(signed.some((r) => r.fx.base < 0)).toBe(true) // the real corpus seeds debuffs (negative base)
    for (const { fx } of signed) {
      // Parts grammar: the sign rides `pre`, the magnitude renders abs — the TRUE signed base still
      // reaches the line verbatim as `<sign><abs>` (never fx.amount/fx.pct undefined).
      const line = seed_effect_line(t_stub, fx)
      expect(line).toContain(`${(fx.base ?? 0) >= 0 ? '+' : '-'}${Math.abs(fx.base ?? 0)}`)
    }
  })
})

// ── LINE-GRAMMAR proof: no cards, just lines — the +1 MP grammar ─────────────
// The strongest oracle available without a browser: the REAL en.json strings through a minimal i18next-
// compatible interpolator (plural _one resolution + {{var}} interpolation + base-key fallback — exactly the
// lookup chain the app performs), asserted against LITERAL player-facing lines. A missing en key surfaces as
// the raw key leaking into the line ('spells.…') and fails the corpus sweep below — so this ALSO gates i18n.
const lookup = (locale, key) => key.split('.').reduce((o, k) => (o == null ? o : o[k]), locale)
const translator =
  (locale) =>
  (key, params = {}) => {
    let s =
      params.count != null
        ? (lookup(locale, `${key}_${params.count === 1 ? 'one' : 'other'}`) ?? lookup(locale, key))
        : lookup(locale, key)
    if (typeof s !== 'string') return key // i18next missing-key behavior: the key itself renders
    for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{{${k}}}`, String(v))
    return s
  }
const t_en = translator(EN)
const t_fr = translator(FR)

describe('S-64b effect-line grammar (parts model, real EN strings)', () => {
  // One representative fx per kind the formatter supports — the synthetic matrix keeps every branch tested
  // even when a reseed drops a kind from the live corpus (6 kinds are corpus-absent today, branches kept).
  const MATRIX = /** @type {const} */ ([
    // [fx, { value, tone?, icon?, dot?, meta? }] — null value = a sentence line (NO magnitude noise)
    [
      {
        kind: 'DAMAGE',
        element: 'earth',
        base: 7,
        damageMin: 7,
        damageMax: 7,
        crit_base: 9,
        chance: 100,
        turns: 0,
        area_shape: 'POINT',
        area_size: 0,
      },
      { value: '7', meta: 'crit 9' },
    ],
    [
      { kind: 'PERCENT_LIFE', element: 'earth', base: 3, chance: 100, turns: 0, area_shape: 'POINT', area_size: 0 },
      { value: '3' },
    ],
    [
      {
        kind: 'APPLY_DOT',
        element: 'water',
        base: 42,
        damageMin: 42,
        damageMax: 42,
        chance: 100,
        turns: 3,
        area_shape: 'POINT',
        area_size: 0,
      },
      { value: '42', meta: '3 turns' },
    ],
    [
      {
        kind: 'LIFE_STEAL',
        element: 'fire',
        base: 55,
        damageMin: 55,
        damageMax: 55,
        chance: 100,
        turns: 0,
        area_shape: 'POINT',
        area_size: 0,
      },
      { value: '55' },
    ],
    [
      {
        kind: 'PUNISHMENT',
        element: 'air',
        base: 80,
        damageMin: 80,
        damageMax: 80,
        chance: 100,
        turns: 0,
        area_shape: 'POINT',
        area_size: 0,
      },
      { value: '80' },
    ],
    [
      {
        kind: 'CASTER_DAMAGE',
        element: 'fire',
        base: 110,
        damageMin: 110,
        damageMax: 110,
        chance: 100,
        turns: 0,
        area_shape: 'POINT',
        area_size: 0,
      },
      { value: '110', tone: TONE_BAD },
    ],
    [
      {
        kind: 'HEAL',
        element: 'water',
        base: 150,
        damageMin: 150,
        damageMax: 150,
        chance: 100,
        turns: 0,
        area_shape: 'POINT',
        area_size: 0,
      },
      { value: '150', tone: HEAL_PINK, icon: 'health' },
    ],
    [
      { kind: 'GIVE_POINTS', stat: 1, base: 1, chance: 100, turns: 1, area_shape: 'POINT', area_size: 0 },
      { value: '1', tone: TONE_BUFF, icon: 'movement', meta: null },
    ], // 1-turn grant = the implied default, NO meta
    [
      { kind: 'REMOVE_POINTS', stat: 0, base: 2, chance: 100, turns: 0, area_shape: 'POINT', area_size: 0 },
      { value: '2', tone: TONE_BAD, icon: 'action' },
    ],
    [
      { kind: 'STEAL_POINTS', stat: 1, base: 1, chance: 100, turns: 0, area_shape: 'POINT', area_size: 0 },
      { value: '1', tone: TONE_BAD, icon: 'movement' },
    ],
    [
      { kind: 'ALTER_STAT', stat: 0, base: 22, chance: 100, turns: 2, area_shape: 'POINT', area_size: 0 },
      { value: '22', tone: TONE_BUFF, icon: 'strength', meta: '2 turns' },
    ],
    [
      { kind: 'ALTER_STAT', stat: 3, base: -16, chance: 100, turns: 2, area_shape: 'POINT', area_size: 0 },
      { value: '16', tone: TONE_BAD, icon: 'agility', meta: '2 turns' },
    ],
    [
      { kind: 'STEAL_STAT', stat: 3, base: 5, chance: 100, turns: 3, area_shape: 'POINT', area_size: 0 },
      { value: '5', tone: TONE_BAD, icon: 'agility', meta: '3 turns' },
    ],
    [
      { kind: 'ALTER_RESIST', base: -12, chance: 100, turns: 2, area_shape: 'POINT', area_size: 0 },
      { value: '12', tone: TONE_BAD, meta: '2 turns' },
    ],
    [
      { kind: 'REDUCE_DAMAGE', base: 73, chance: 100, turns: 2, area_shape: 'POINT', area_size: 0 },
      { value: '73', meta: '2 turns' },
    ],
    [
      { kind: 'REFLECT_DAMAGE', base: 15, chance: 100, turns: 2, area_shape: 'POINT', area_size: 0 },
      { value: '15', meta: '2 turns' },
    ],
    [{ kind: 'PUSH', base: 3, chance: 100, turns: 0, area_shape: 'POINT', area_size: 0 }, { value: '3' }],
    [{ kind: 'PULL', base: 2, chance: 100, turns: 0, area_shape: 'POINT', area_size: 0 }, { value: '2' }],
    // sentence kinds — value MUST be null (the screenshot's floating "1" garbage class)
    [
      { kind: 'PLACE_TRAP', base: 1, chance: 100, turns: 0, area_shape: 'CIRCLE', area_size: 1 },
      { value: null, meta: 'CIRCLE 1' },
    ], // the zone IS the informative part of a trap line
    [
      { kind: 'PLACE_GLYPH', base: 1, chance: 100, turns: 3, area_shape: 'RING', area_size: 1 },
      { value: null, meta: '3 turns · RING 1' },
    ],
    [{ kind: 'TELEPORT', base: 3, chance: 100, turns: 0, area_shape: 'POINT', area_size: 0 }, { value: null }],
    [{ kind: 'SWAP', base: 1, chance: 100, turns: 0, area_shape: 'POINT', area_size: 0 }, { value: null }],
    [{ kind: 'CARRY', base: 1, chance: 100, turns: 0, area_shape: 'POINT', area_size: 0 }, { value: null }],
    [{ kind: 'THROW', base: 1, chance: 100, turns: 0, area_shape: 'POINT', area_size: 0 }, { value: null }],
    [
      { kind: 'INVISIBILITY', base: 1, chance: 100, turns: 2, area_shape: 'POINT', area_size: 0 },
      { value: null, meta: '2 turns' },
    ],
    [
      { kind: 'APPLY_STATE', base: 1, chance: 100, turns: 2, area_shape: 'POINT', area_size: 0 },
      { value: null, meta: '2 turns' },
    ],
    [{ kind: 'DISPEL', base: 1, chance: 100, turns: 1, area_shape: 'POINT', area_size: 0 }, { value: null }],
    [
      { kind: 'REVEAL', base: 0, chance: 100, turns: 0, area_shape: 'CIRCLE', area_size: 3 },
      { value: null, meta: 'CIRCLE 3' },
    ],
    [
      { kind: 'RETURN_SPELL', base: 1, chance: 100, turns: 1, area_shape: 'POINT', area_size: 0 },
      { value: null, meta: '1 turn' },
    ], // fx_turns_one — never "1 turns"
  ])

  test('authored damage bounds use the locale connector and equal bounds stay a single number', () => {
    const ranged = { kind: 'DAMAGE', element: 'air', base: 99, damageMin: 5, damageMax: 14 }
    expect(seed_effect_parts(t_en, ranged).value).toBe('5 to 14')
    expect(seed_effect_parts(t_fr, ranged).value).toBe('5 à 14')

    const equal = { ...ranged, damageMin: 8, damageMax: 8 }
    expect(seed_effect_parts(t_en, equal).value).toBe('8')
    expect(seed_effect_parts(t_en, equal).value).not.toBe('8 to 8')
  })

  for (const [fx, want] of MATRIX) {
    test(`${fx.kind}${fx.stat != null ? ` (stat ${fx.stat})` : ''} — line form is exact`, () => {
      const p = seed_effect_parts(t_en, fx)
      expect(p.value).toBe(want.value) // magnitude presence/absence per kind class
      if (want.tone) expect(p.tone).toBe(want.tone)
      if ('icon' in want) expect(p.icon).toBe(want.icon ?? null)
      if ('meta' in want) expect(p.meta).toBe(want.meta)
      const line = seed_effect_line(t_en, fx)
      expect(line).not.toContain('undefined')
      expect(line).not.toContain('spells.') // a leaked key = a missing en string
      expect(line.startsWith('? ')).toBe(false)
    })
  }

  test('the Vanish grammar, LITERALLY: "+2 MP · 3 turns" (grey sign in pre, green 2) + "Become invisible · 3 turns"', () => {
    const vanish = fight_spells_data.spells.find((spell) => spell.class === 'yajin' && spell.name_key === 'vanish')
    const rank6 = vanish.levels[5]
    const invis = rank6.effects.find((e) => e.kind === 'INVISIBILITY')
    const mp = rank6.effects.find((e) => e.kind === 'GIVE_POINTS')
    // the sentence line — no magnitude, duration as meta
    expect(seed_effect_line(t_en, invis)).toBe(`Become invisible · ${invis.turns} turns`)
    const p = seed_effect_parts(t_en, mp)
    expect(p.icon).toBe('movement') // the MP icon leads
    expect(p.pre.endsWith('+')).toBe(true) // the sign is GREY (part of pre), never inside the coloured value
    expect(p.value).toBe(String(mp.base))
    expect(p.post).toBe(' MP')
    expect(p.tone).toBe(TONE_BUFF)
    expect(seed_effect_line(t_en, mp)).toBe(`+${mp.base} MP · ${mp.turns} turns`)
  })

  test('CORPUS SWEEP with the real EN strings: no undefined, no leaked key, no canary, anywhere', () => {
    for (const sp of fight_spells_data.spells)
      for (let i = 0; i < sp.levels.length; i++)
        for (const fx of sp.levels[i].effects ?? []) {
          const line = seed_effect_line(t_en, fx)
          expect(line.length).toBeGreaterThan(0)
          expect(line).not.toContain('undefined') // the old REDUCE_DAMAGE "spells.undefined" class of bug
          expect(line).not.toContain('spells.') // every key resolves in en.json
          expect(line).not.toContain('encyclopedia.') // zone/chance keys resolve too
          expect(line.startsWith('? ')).toBe(false)
        }
  })

  test('ALTER_STAT names the REAL stat (Move STAT_* enum) — the blanket "raw damage" lie is dead', () => {
    const stats = fight_spells_data.spells.flatMap((sp) =>
      sp.levels.flatMap((l) => (l.effects ?? []).filter((e) => e.kind === 'ALTER_STAT'))
    )
    expect(stats.length).toBeGreaterThan(0)
    const STAT_WORDS = {
      0: 'Strength',
      1: 'Intelligence',
      2: 'Chance',
      3: 'Agility',
      4: 'Wisdom',
      5: 'Vitality',
      6: 'Range',
      7: 'Critical Hit',
      8: 'Percent Damage',
      9: 'Raw Damage',
    }
    for (const fx of stats) {
      const line = seed_effect_line(t_en, fx)
      const word = STAT_WORDS[fx.stat]
      expect(word).toBeTruthy() // an unmapped stat id in the corpus = a new STAT_VIEW row needed
      expect(line).toContain(word)
    }
  })

  // The DOM proof (FightReport.test.jsx's renderToStaticMarkup pattern — pure props, no store/i18n context):
  // the display grammar reaches the MARKUP — grey pre-sign, the value in its OWN coloured span, the stat icon
  // img, and ZERO per-effect card chrome.
  test('<EffectLine> markup: icon + grey sign + coloured value span — and no card box', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { createElement } = await import('react')
    const { EffectLine } = await import('./EffectLine.jsx')
    const vanish = fight_spells_data.spells.find((spell) => spell.class === 'yajin' && spell.name_key === 'vanish')
    const mp = vanish.levels[5].effects.find((e) => e.kind === 'GIVE_POINTS')
    const html = renderToStaticMarkup(createElement(EffectLine, { view: seed_effect_parts(t_en, mp) }))
    expect(html).toContain('fxl__ic') // the MP icon leads the line
    expect(html).toMatch(/\+<b class="fxl__val"/) // the grey '+' sits OUTSIDE the coloured value span (pre)
    expect(html).toContain(`>${mp.base}</b>`)
    expect(html).toContain(' MP') // the grey unit rides post
    expect(html).not.toContain('border') // zero card chrome — lines only
    const invis_html = renderToStaticMarkup(
      createElement(EffectLine, {
        view: seed_effect_parts(
          t_en,
          vanish.levels[5].effects.find((e) => e.kind === 'INVISIBILITY')
        ),
      })
    )
    expect(invis_html).toContain('Become invisible')
    expect(invis_html).not.toContain('fxl__val') // sentence line: NO magnitude span at all
  })
})

// ── Regression guard: "CIRCLE 0" is a misleading zone suffix for a spell that targets a single cell — render
// no zone suffix when it's not actually an AoE. A CIRCLE/CROSS/RING/LINE/TBAR zone of size 0 is geometrically the ONE target cell (see
// packages/sim/src/spell_targeting.js cells_in_circle/cells_in_cross/cells_in_line/cells_in_tbar — manhattan
// distance <= 0 or length 1 all resolve to exactly the target cell), so it is never real area-of-effect and
// must render no zone suffix at all. ALLMAP is the one shape-independent-of-size exception (always the whole
// board). This was a real screenshot: "Places a trap · CIRCLE 0", "5 to 9 Earth damage · CIRCLE 0".
describe('AoE zone suffix — single-cell shapes never print (regression: "CIRCLE 0")', () => {
  test('RED-FIRST: a size-0 CIRCLE trap must not print "CIRCLE 0" in the meta or the flat line', () => {
    const fx = { kind: 'PLACE_TRAP', base: 1, chance: 100, turns: 0, area_shape: 'CIRCLE', area_size: 0 }
    expect(seed_effect_parts(t_en, fx).meta).toBeNull()
    const line = seed_effect_line(t_en, fx)
    expect(line).toBe('Places a trap')
    expect(line).not.toContain('CIRCLE')
  })

  test('a real (size > 0) zone still prints — the suppression is size-gated, not shape-gated', () => {
    const fx = { kind: 'PLACE_TRAP', base: 1, chance: 100, turns: 0, area_shape: 'CIRCLE', area_size: 2 }
    expect(seed_effect_parts(t_en, fx).meta).toBe('CIRCLE 2')
  })

  test('ALLMAP always prints regardless of size — it is never a single cell', () => {
    const fx = { kind: 'DAMAGE', element: 'fire', damageMin: 5, damageMax: 9, chance: 100, turns: 0, area_shape: 'ALLMAP', area_size: 0 }
    expect(seed_effect_parts(t_en, fx).meta).toBe('ENTIRE BOARD')
  })

  test('is_area_effect: the one shared truth condition every zone-label call site derives from', () => {
    expect(is_area_effect('POINT', 0)).toBe(false)
    expect(is_area_effect('POINT', 5)).toBe(false) // POINT has no meaningful size
    expect(is_area_effect('CIRCLE', 0)).toBe(false)
    expect(is_area_effect('CROSS', 0)).toBe(false)
    expect(is_area_effect('RING', 0)).toBe(false)
    expect(is_area_effect('LINE', 0)).toBe(false)
    expect(is_area_effect('TBAR', 0)).toBe(false)
    expect(is_area_effect('CONE', 0)).toBe(false)
    expect(is_area_effect('CIRCLE', 1)).toBe(true)
    expect(is_area_effect('ALLMAP', 0)).toBe(true)
    expect(is_area_effect('ALLMAP', 5)).toBe(true)
  })
})

// LEG C — ALTER_RESIST names its element (resist-element display fix 07-20). The formatter ignored
// fx.element, so a per-element ward rendered a bare "+8 resistance" even after the seed carried the
// element. A fixed row now reads "+8 Earth resistance"; a legacy el_none(255)/element-less row stays
// HONESTLY bare (no invented element). Element names reuse the existing spells.el_* keys; the phrasing
// rides a new spells.fx_alter_resist_el template (×6 locales).
describe('ALTER_RESIST line names the element (resist-element display fix 07-20)', () => {
  const resist = (o) => ({ kind: 'ALTER_RESIST', base: 8, chance: 100, turns: 4, area_shape: 'POINT', area_size: 0, ...o })

  test('an element-carrying resist row renders the element name (EN literal), sign in the grey pre', () => {
    expect(seed_effect_line(t_en, resist({ element: 'earth' }))).toBe('+8 Earth resistance · 4 turns')
    expect(seed_effect_line(t_en, resist({ element: 'fire', base: -12, turns: 2 }))).toBe('-12 Fire resistance · 2 turns')
    const p = seed_effect_parts(t_en, resist({ element: 'water' }))
    expect(p.pre.endsWith('+')).toBe(true) // the sign is grey (pre), never inside the coloured value
    expect(p.value).toBe('8')
    expect(p.post).toContain('Water')
  })

  test('a legacy element-less row stays honestly bare — no element word, no leaked key', () => {
    const line = seed_effect_line(t_en, resist({ turns: 0 })) // no element field at all
    expect(line).toBe('+8 resistance')
    expect(line).not.toContain('spells.')
  })

  test('a neutral(255→"neutral") row renders bare — never invents an element', () => {
    const line = seed_effect_line(t_en, resist({ element: 'neutral', turns: 0 }))
    expect(line).toBe('+8 resistance')
    expect(line).not.toContain('neutral')
  })

  test('all 6 locales resolve the element-carrying resist template (i18n law — no leaked key, no stray {{}})', () => {
    for (const loc of [EN, FR, DE, ES, JA, UK]) {
      const line = seed_effect_line(translator(loc), resist({ element: 'earth' }))
      expect(line).not.toContain('spells.')
      expect(line).not.toContain('{{')
    }
  })

  test('the live corpus resist rows all render a named element (post-revival: every ALTER_RESIST is elemented)', () => {
    const els = ['Fire', 'Water', 'Earth', 'Air']
    const resist_lines = fight_spells_data.spells.flatMap((sp) =>
      sp.levels.flatMap((l) => (l.effects ?? []).filter((e) => e.kind === 'ALTER_RESIST').map((fx) => seed_effect_line(t_en, fx)))
    )
    expect(resist_lines.length).toBeGreaterThan(0)
    for (const line of resist_lines) expect(els.some((el) => line.includes(el))).toBe(true) // never a bare resist in the live corpus
  })
})
