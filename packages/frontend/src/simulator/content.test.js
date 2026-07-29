// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Simulator content builders — the max-roll gear fold, the class seat and the mob build.
//
// HAND-BUILT FIXTURES pin the ARITHMETIC (max roll → centered wire → fold → seat), which is what this module
// owns. The block at the bottom then folds rows that came out of the REAL live-corpus projection, pinning the
// seam between the two: it used to be a permanently-skipped test over the bundled catalog, which ships empty
// here by construction, so it never ran once.
import { describe, expect, test } from 'bun:test'
import { ITEM_STAT_CATALOG_ORDER, ITEM_STAT_SHIFT } from '@aresrpg/sim/equipment_stats'

import { EQUIPMENT_SLOTS as INVENTORY_EQUIPMENT_SLOTS } from '../game/screens/hud/simulator-equip.js'
import { set_spell_corpus_for_test } from '../game/data/spell_corpus.js'
import encyclopedia_fixture from '../rpc/fixtures/encyclopedia.json'
import { item_corpus_from_v1 } from '../pages/encyclopedia/item_corpus'

import {
  BASE_AP,
  BASE_MP,
  EQUIPMENT_SLOTS,
  MOB_FALLBACK_HP_PER_LEVEL,
  SIMULATOR_CLASSES,
  build_mob,
  build_mob_spell_templates,
  build_seat,
  centered_max_roll,
  class_spell_templates,
  mob_spell_id,
  resolve_loadout,
} from './content.js'

// ── item fixtures ────────────────────────────────────────────────────────────────────────────────
// Max roll is range[1] — DERIVED, never a hardcoded number: the boots' intelligence penalty rolls to -5
// (the least-bad end of [-15,-5]), which is exactly the case a `Math.max` shortcut would get wrong.
//
// THE KEYS ARE THE CORPUS' OWN (#1065). A CorpusItem's stats come out of the /v1 decode home, which renames
// every Move `item_stats` field to its UI spelling — `action`/`movement`, `criticalHit`, `rawDamage`, the
// camelCase resistances. These fixtures used to speak the SDK/chain spelling instead (`ap`, `critical`,
// `raw_damage`), a shape the corpus never emits, so the arithmetic they pin was arithmetic over a wire that
// does not exist: six real gear fields folded to zero on every simulated seat and this file stayed green.
// `item_corpus_wire.fixture.json` is the captured proof of the vocabulary; the bottom block folds live rows.
const HELM = {
  id: 'fixture_helm',
  name: 'Fixture Helm',
  category: 'helmet',
  quality: 'rare',
  level: 60,
  stats: { vitality: [10, 40], strength: [2, 8], action: [0, 1] },
  damages: [],
}
const BOOTS = {
  id: 'fixture_boots',
  name: 'Fixture Boots',
  category: 'boots',
  quality: 'common',
  level: 40,
  stats: { agility: [5, 25], movement: [1, 1], intelligence: [-15, -5] },
  damages: [],
}
const AMULET = {
  id: 'fixture_amulet',
  name: 'Fixture Amulet',
  category: 'amulet',
  quality: 'epic',
  level: 80,
  stats: { vitality: [0, 30], criticalHit: [1, 5], rawDamage: [2, 6], fireResistance: [0, 12] },
  damages: [],
}

/** A centered row (32768-neutral) built by NAME, so a catalog-order change can never silently pass. */
const centered = (deltas) => ITEM_STAT_CATALOG_ORDER.map((key) => ITEM_STAT_SHIFT + (deltas[key] ?? 0))

describe('centered_max_roll — item ranges to the centered wire', () => {
  test('takes range[1] and centers it at 32768, reading each field by the key the corpus carries it under', () => {
    expect(centered_max_roll(HELM)).toEqual(centered({ vitality: 40, strength: 8, action: 1 }))
    expect(centered_max_roll(BOOTS)).toEqual(centered({ agility: 25, movement: 1, intelligence: -5 }))
    expect(centered_max_roll(AMULET)).toEqual(
      centered({ vitality: 30, critical: 5, raw_damage: 6, fire_resistance: 12 })
    )
  })

  test('an unstatted item is the neutral row (every position 32768)', () => {
    expect(centered_max_roll({ id: 'plain', category: 'belt', stats: {} })).toEqual(centered({}))
  })
})

describe('build_seat — a roster character to its fight-start numbers', () => {
  const CHARACTER = { level: 100, class_id: 'senshi', stat_alloc: { vitality: 100, strength: 50 } }
  const seat = build_seat(CHARACTER, [HELM, BOOTS, AMULET])

  test('stats are allocation + the summed gear deltas, floored at zero', () => {
    expect(seat.stats.vitality).toBe(170) // 100 allocated + 40 + 30
    expect(seat.stats.strength).toBe(58) // 50 allocated + 8
    expect(seat.stats.agility).toBe(25)
    expect(seat.stats.intelligence).toBe(0) // 0 allocated - 5 gear, floored (never negative)
    expect(seat.stats.critical_hit).toBe(5)
    expect(seat.stats.raw_damage).toBe(6)
    expect(seat.stats.fire_resistance).toBe(12)
  })

  test('ap/mp are the sdk base pools plus the gear deltas', () => {
    expect([BASE_AP, BASE_MP]).toEqual([6, 3]) // @aresrpg/sdk/stats get_base_stat — base AP 6 / MP 3
    expect(seat.ap_max).toBe(7)
    expect(seat.mp_max).toBe(4)
  })

  test('hp follows get_max_health: class base + 5 per level GAINED + total vitality', () => {
    expect(seat.max_hp).toBe(70 + 5 * 99 + 170) // senshi base 70, 99 levels gained (#867)
    expect(seat.hp).toBe(seat.max_hp) // a seat starts the fight full
  })

  test('the class drives the base pool — a Yogen seat is 40 HP lighter than a Senshi one', () => {
    expect(build_seat({ ...CHARACTER, class_id: 'yogen' }, [HELM, BOOTS, AMULET]).max_hp).toBe(seat.max_hp - 40)
  })

  test('the equipment aggregate carries the gear-only contribution under the sdk stat names', () => {
    expect(seat.equipment_stats).toMatchObject({
      vitality: 70,
      strength: 8,
      intelligence: -5, // the aggregate is the RAW gear sum — the zero floor belongs to the fold, not here
      agility: 25,
      ap: 1,
      mp: 1,
      critical: 5,
    })
  })

  test('a bare character (no gear, no allocation) is the naked baseline', () => {
    const naked = build_seat({ level: 1, class_id: 'senshi', stat_alloc: {} }, [])
    expect(naked.ap_max).toBe(BASE_AP)
    expect(naked.mp_max).toBe(BASE_MP)
    expect(naked.max_hp).toBe(70) // the senshi class base — level 1 gains no level bonus (#867)
  })

  test('a level outside the on-chain curve is refused, never silently floored to 1', () => {
    expect(() => build_seat({ level: 0, class_id: 'senshi', stat_alloc: {} }, [])).toThrow()
    expect(() => build_seat({ level: 201, class_id: 'senshi', stat_alloc: {} }, [])).toThrow()
  })

  test('an unseeded class is refused, never silently seated on another class’s HP pool', () => {
    expect(() => build_seat({ level: 1, class_id: 'sorcerer', stat_alloc: {} }, [])).toThrow()
    expect(() => build_seat(/** @type {any} */ ({ level: 1, stat_alloc: {} }), [])).toThrow()
  })
})

describe('resolve_loadout — the reducer loadout to live corpus rows', () => {
  const CORPUS = new Map([
    [HELM.id, HELM],
    [BOOTS.id, BOOTS],
  ])

  test('a stored loadout resolves against the LIVE corpus it is given', () => {
    const { items, unresolved } = resolve_loadout(CORPUS, { helmet: HELM.id, boots: BOOTS.id })
    expect(items).toEqual([HELM, BOOTS])
    expect(unresolved).toEqual([])
  })

  test('reports unresolvable template ids instead of dropping them — a build never goes silently naked', () => {
    const { items, unresolved } = resolve_loadout(CORPUS, { helmet: 'not_in_corpus', weapon: 'also_missing' })
    expect(items).toEqual([])
    expect(unresolved).toEqual([
      { slot: 'helmet', template_id: 'not_in_corpus' },
      { slot: 'weapon', template_id: 'also_missing' },
    ])
  })

  test('a COLD corpus resolves nothing — every id is unresolved, never a fabricated row', () => {
    const { items, unresolved } = resolve_loadout(new Map(), { helmet: HELM.id })
    expect(items).toEqual([])
    expect(unresolved).toEqual([{ slot: 'helmet', template_id: HELM.id }])
  })

  test('an empty loadout resolves to nothing, quietly', () => {
    expect(resolve_loadout(CORPUS, {})).toEqual({ items: [], unresolved: [] })
    expect(resolve_loadout(CORPUS, undefined)).toEqual({ items: [], unresolved: [] })
  })
})

describe('the slot vocabulary', () => {
  test('is the inventory paper-doll set, re-exported — never a second list', () => {
    expect(EQUIPMENT_SLOTS).toEqual(INVENTORY_EQUIPMENT_SLOTS)
    for (const slot of ['weapon', 'pet', 'relic_1', 'relic_6', 'left_ring', 'right_ring', 'belt'])
      expect(EQUIPMENT_SLOTS).toContain(slot)
  })
})

describe('SIMULATOR_CLASSES', () => {
  test('lists the 12 seeded classes with their weapon category', () => {
    expect(SIMULATOR_CLASSES).toHaveLength(12)
    expect(SIMULATOR_CLASSES.find((row) => row.id === 'senshi')).toMatchObject({
      name: 'Senshi',
      weapon_category: 'longsword',
    })
  })
})

// ── mobs (seam S2 + S3) ──────────────────────────────────────────────────────────────────────────
const BANDED = { id: '0xmob', name: 'Banded Mob', element: 'earth', role: 'trash', minLevel: 10, maxLevel: 20 }
const WITH_BLOCK = { ...BANDED, base_hp: 42, ap: 5, mp: 4, stats: { strength: 12 } }

describe('build_mob — the published combat block', () => {
  test('hp is scaled_hp over the authored base, ap/mp/stats pass through', () => {
    const mob = build_mob(WITH_BLOCK, 15)
    expect(mob.combat_block_published).toBe(true)
    expect(mob.hp).toBe(44) // floor(42 · 7 · (10+5) / 100)
    expect(mob.max_hp).toBe(44)
    expect(mob.ap).toBe(5)
    expect(mob.mp).toBe(4)
    expect(mob.stats).toEqual({ strength: 12 })
    expect(mob.level).toBe(15)
  })

  test('the level is clamped into the authored band before it scales', () => {
    expect(build_mob(WITH_BLOCK, 99)).toMatchObject({ level: 20, hp: 58 }) // floor(42·7·20/100)
    expect(build_mob(WITH_BLOCK, 1)).toMatchObject({ level: 10, hp: 29 }) // floor(42·7·10/100)
  })
})

describe('build_mob — the UNPUBLISHED combat block degrades loudly (seam S2)', () => {
  test('flags the absence and falls back to the declared placeholder block', () => {
    const mob = build_mob(BANDED, 15)
    expect(mob.combat_block_published).toBe(false) // the flag the UI badges — never silent
    expect(mob.ap).toBe(BASE_AP)
    expect(mob.mp).toBe(BASE_MP)
    expect(mob.stats).toEqual({})
    // base 50·max_level = 1000, scaled at the band midpoint
    expect(mob.hp).toBe(1050)
    expect(MOB_FALLBACK_HP_PER_LEVEL).toBe(50)
  })

  test('a partial block still counts as unpublished — base_hp is what a fight cannot fake', () => {
    expect(build_mob({ ...BANDED, ap: 9 }, 15).combat_block_published).toBe(false)
    expect(build_mob({ ...BANDED, ap: 9 }, 15).ap).toBe(9) // what IS authored is still honoured
  })
})

describe('build_mob_spell_templates — the authored kit to sim templates', () => {
  const KIT = [
    {
      ap: 4,
      rmin: 1,
      rmax: 3,
      cd: 2,
      crit: 10,
      effects: [{ kind: 0, op: 'damage', element: 'earth', base: 3 }],
      crit_effects: [],
    },
    { ap: 2, rmin: 1, rmax: 1, los: false, effects: [{ kind: 5, op: 'heal', base: 7 }] },
  ]
  const templates = build_mob_spell_templates('0xmob', KIT)

  test('one template per authored spell, keyed by the mob-scoped id', () => {
    expect(templates.get(mob_spell_id('0xmob', 0))).toBeDefined()
    expect(templates.get(mob_spell_id('0xmob', 1))).toBeDefined()
  })

  test('ap/rmin/rmax/cd/crit map onto the chain level fields; los defaults to true', () => {
    const [level] = templates.get(mob_spell_id('0xmob', 0)).levels
    expect(level.cost).toBe(4)
    expect(level.range).toEqual([1, 3])
    expect(level.cooldown_turns).toBe(2)
    expect(level.critical_chance).toBe(10)
    expect(level.line_of_sight).toBe(true)
    expect(templates.get(mob_spell_id('0xmob', 1)).levels[0].line_of_sight).toBe(false)
  })

  test('the authored `base` becomes the chain `value`, and string elements decode', () => {
    const [effect] = templates.get(mob_spell_id('0xmob', 0)).levels[0].base_effects
    expect(effect.element).toBe('EARTH')
    expect(effect.min).toBe(3)
    expect(effect.max).toBe(3)
  })

  test('an unauthored kit is an empty map, never a stub spell', () => {
    expect(build_mob_spell_templates('0xmob', []).size).toBe(0)
    expect(build_mob_spell_templates('0xmob', undefined).size).toBe(0)
  })
})

describe('class_spell_templates — the published corpus to the sim template map', () => {
  const CORPUS_ROW = {
    id: '0xspell',
    object_id: '0xobj',
    classType: 'senshi',
    unlock: 1,
    name: 'Ember Strike',
    role: 'damage',
    element: 'fire',
    levels: [
      {
        min_char_level: 1,
        ap_cost: 3,
        range_min: 1,
        range_max: 4,
        line_of_sight: true,
        crit_rate: 20,
        cooldown_turns: 0,
        casts_per_turn: 2,
        casts_per_target: 255,
        effects: [{ kind: 0, element: 0, value: 9 }],
        crit_effects: [],
      },
    ],
  }

  // Keyed by NAME_KEY, matching the reducer's `spell_levels` and the fight store's hand — the only spell id
  // that survives a republish (the object id is re-minted, and may be null before the receipt ships).
  test('keys the sim templates by name_key, not the re-mintable object id', () => {
    set_spell_corpus_for_test([CORPUS_ROW])
    const templates = class_spell_templates()
    expect(templates.has('0xspell')).toBe(false)
    expect(templates.get('ember_strike')?.levels[0].cost).toBe(3)
    expect(templates.get('ember_strike')?.levels[0].range).toEqual([1, 4])
    set_spell_corpus_for_test()
  })

  test('an unpublished corpus yields an empty map — inert, never a stub', () => {
    set_spell_corpus_for_test()
    expect(class_spell_templates().size).toBe(0)
  })
})

// THE SEAM between the two modules: rows that came out of the live /v1 projection must fold. This used to be
// a `skipIf(!ITEMS_CATALOG_AVAILABLE)` over the bundled catalog — permanently skipped in this repo, so it
// never once ran and could not have caught the empty-picker bug. The corpus door has no such artifact
// dependency, so it runs everywhere: what it pins is that the projection's output shape IS what the fold eats.
describe('the fold over rows that came from the live corpus', () => {
  // The wire is BIASED at 32768 (see item_corpus.test.ts); these decode to real ranges on the way through.
  const wire = (template_id, category, level, stats) => ({
    template_id,
    item_type: `art_${category}`,
    name: `Live ${category}`,
    description: null,
    level,
    category,
    stats: Object.fromEntries(Object.entries(stats).map(([key, [lo, hi]]) => [key, [32768 + lo, 32768 + hi]])),
    damages: [],
    supply: 1,
    last_sale_mist: null,
  })

  const living = encyclopedia_fixture.items.map(({ template_id }) => template_id)

  test('three live templates fold into a seat with sane pools', () => {
    const real = item_corpus_from_v1([
      wire(living[0], 'helmet', 60, { vitality: [10, 40], strength: [2, 8] }),
      wire(living[1], 'boots', 40, { agility: [5, 25], intelligence: [-15, -5] }),
      wire(living[2], 'amulet', 80, { vitality: [0, 30], critical: [1, 5] }),
    ])
    expect(real).toHaveLength(3)

    const seat = build_seat({ level: 100, class_id: 'senshi', stat_alloc: { vitality: 100 } }, real)
    for (const item of real) expect(centered_max_roll(item)).toHaveLength(ITEM_STAT_CATALOG_ORDER.length)
    expect(seat.ap_max).toBeGreaterThanOrEqual(BASE_AP)
    expect(seat.mp_max).toBeGreaterThanOrEqual(BASE_MP)
    expect(seat.max_hp).toBe(70 + 495 + seat.stats.vitality)
    // max roll, through the real decode: 40 + 30 gear vitality on top of the 100 allocated.
    expect(seat.stats.vitality).toBe(170)
  })
})
