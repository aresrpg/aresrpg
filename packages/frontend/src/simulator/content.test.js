// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Simulator content builders — the max-roll gear fold, the class seat and the mob build.
//
// ITEM FIXTURES, not catalog rows: packages/sdk/src/items.json ships as an empty `{}` placeholder in this
// public repo (MISSING-ARTIFACT #117 — the catalog is authored by the private content pipeline), so the
// hand-computed vectors below run on ItemDef-shaped fixtures. They pin the ARITHMETIC (max roll → centered
// wire → fold → seat), which is what this module owns; the catalog-bearing case at the bottom folds three
// REAL catalog rows wherever the artifact is present.
import { describe, expect, test } from 'bun:test'
import { ITEM_STAT_CATALOG_ORDER, ITEM_STAT_SHIFT } from '@aresrpg/sim/equipment_stats'

import { ITEMS_CATALOG_AVAILABLE } from '../test_helpers/items_fixture.js'
import { EQUIPMENT_SLOTS as INVENTORY_EQUIPMENT_SLOTS, items_for_slot } from '../game/screens/hud/simulator-equip.js'
import { set_spell_corpus_for_test } from '../game/data/spell_corpus.js'

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
const HELM = {
  id: 'fixture_helm',
  name: 'Fixture Helm',
  category: 'helmet',
  quality: 'rare',
  level: 60,
  stats: { vitality: [10, 40], strength: [2, 8], ap: [0, 1] },
  damages: [],
}
const BOOTS = {
  id: 'fixture_boots',
  name: 'Fixture Boots',
  category: 'boots',
  quality: 'common',
  level: 40,
  stats: { agility: [5, 25], mp: [1, 1], intelligence: [-15, -5] },
  damages: [],
}
const AMULET = {
  id: 'fixture_amulet',
  name: 'Fixture Amulet',
  category: 'amulet',
  quality: 'epic',
  level: 80,
  stats: { vitality: [0, 30], critical: [1, 5], raw_damage: [2, 6], fire_resistance: [0, 12] },
  damages: [],
}

/** A centered row (32768-neutral) built by NAME, so a catalog-order change can never silently pass. */
const centered = (deltas) => ITEM_STAT_CATALOG_ORDER.map((key) => ITEM_STAT_SHIFT + (deltas[key] ?? 0))

describe('centered_max_roll — item ranges to the centered wire', () => {
  test('takes range[1] and centers it at 32768, mapping ap/mp onto action/movement', () => {
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
  const CHARACTER = { level: 100, stat_alloc: { vitality: 100, strength: 50 } }
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

  test('hp follows get_max_health: 30 + 5·level + total vitality', () => {
    expect(seat.max_hp).toBe(30 + 5 * 100 + 170)
    expect(seat.hp).toBe(seat.max_hp) // a seat starts the fight full
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
    const naked = build_seat({ level: 1, stat_alloc: {} }, [])
    expect(naked.ap_max).toBe(BASE_AP)
    expect(naked.mp_max).toBe(BASE_MP)
    expect(naked.max_hp).toBe(35) // 30 + 5·1 + 0
  })

  test('a level outside the on-chain curve is refused, never silently floored to 1', () => {
    expect(() => build_seat({ level: 0, stat_alloc: {} }, [])).toThrow()
    expect(() => build_seat({ level: 201, stat_alloc: {} }, [])).toThrow()
  })
})

describe('resolve_loadout — the reducer loadout to catalog rows', () => {
  test('reports unresolvable template ids instead of dropping them (#117 makes this the normal case here)', () => {
    const { items, unresolved } = resolve_loadout({ helmet: 'not_in_catalog', weapon: 'also_missing' })
    expect(items).toEqual([])
    expect(unresolved).toEqual([
      { slot: 'helmet', template_id: 'not_in_catalog' },
      { slot: 'weapon', template_id: 'also_missing' },
    ])
  })

  test('an empty loadout resolves to nothing, quietly', () => {
    expect(resolve_loadout({})).toEqual({ items: [], unresolved: [] })
    expect(resolve_loadout(undefined)).toEqual({ items: [], unresolved: [] })
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

// MISSING-ARTIFACT (#117): only runs where the item catalog artifact is present (a content-bearing tree/CI).
// It proves the same fold over REAL catalog rows — the fixtures above prove the arithmetic everywhere else.
describe('the fold over real catalog rows', () => {
  test.skipIf(!ITEMS_CATALOG_AVAILABLE)('three seeded items fold into a seat with sane pools', () => {
    const [helmet] = items_for_slot('helmet')
    const [boots] = items_for_slot('boots')
    const [amulet] = items_for_slot('amulet')
    const real = [helmet, boots, amulet]
    const seat = build_seat({ level: 100, stat_alloc: { vitality: 100 } }, real)
    for (const item of real) expect(centered_max_roll(item)).toHaveLength(ITEM_STAT_CATALOG_ORDER.length)
    expect(seat.ap_max).toBeGreaterThanOrEqual(BASE_AP)
    expect(seat.mp_max).toBeGreaterThanOrEqual(BASE_MP)
    expect(seat.max_hp).toBe(30 + 500 + seat.stats.vitality)
  })
})
