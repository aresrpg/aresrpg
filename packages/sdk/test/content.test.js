// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Schema-validates the bundled catalogs (items.json / classes.json): they must carry the required fields in
// the right shape so the sim can consume them. This is a structural gate, not a balance check — it catches a
// broken/empty artifact. SPELLS ARE NOT HERE (#2220): spell truth is the served corpus blob alone, shape-gated
// by @aresrpg/sim's chain_spell_corpus door and the effect-conformance matrix against the published rows.

import { test, expect } from 'bun:test'

import items from '../src/items.json' with { type: 'json' }
import classes from '../src/classes.json' with { type: 'json' }

// MISSING-ARTIFACT (#96): packages/sdk/src/items.json ships as an empty `{}` placeholder in this public
// repo — the real item catalog is authored+transformed by the content pipeline (private repo,
// item_catalog_transform).
const ITEMS_CATALOG_AVAILABLE = Object.keys(items).length > 0

const ELEMENTS = new Set(['fire', 'water', 'air', 'earth', 'neutral'])
const QUALITIES = new Set([
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'junk',
  'developer',
])

const CLASS_IDS = [
  'senshi',
  'yajin',
  'ikari',
  'mori',
  'tokei',
  'shugo',
  'yogen',
  'rojin',
  'shusen',
  'tomoda',
  'asobi',
  'iyashi',
]

const CLASS_IDENTITY_FIELDS = [
  'health',
  'name',
  'stamina',
  'starter_weapon',
  'title',
  'weapon_category',
]

test('the 12 canonical class identities are present', () => {
  expect(Object.keys(classes)).toEqual(CLASS_IDS)
})

test.skipIf(!ITEMS_CATALOG_AVAILABLE)('items: required fields, valid quality, stat tuples, damage elements', () => {
  const all = Object.entries(items)
  expect(all.length).toBeGreaterThan(1000)
  for (const [id, item] of all) {
    expect(item.id).toBe(id)
    expect(typeof item.name).toBe('string')
    expect(typeof item.category).toBe('string')
    expect(item.category.length).toBeGreaterThan(0)
    expect(QUALITIES.has(item.quality)).toBe(true)
    expect(typeof item.level).toBe('number')
    expect(typeof item.stackable).toBe('boolean')
    expect(typeof item.max_drop_chance).toBe('number')
    // stats are [min, max] tuples on the AresRPG stat vocabulary
    for (const range of Object.values(item.stats)) {
      expect(range.length).toBe(2)
      expect(typeof range[0]).toBe('number')
      expect(range[0]).toBeLessThanOrEqual(range[1])
    }
    for (const dmg of item.damages) {
      expect(ELEMENTS.has(dmg.element)).toBe(true)
      expect(dmg.min).toBeLessThanOrEqual(dmg.max)
    }
  }
})

test('item stats only use the AresRPG STATISTICS vocabulary', () => {
  const allowed = new Set([
    'vitality',
    'strength',
    'agility',
    'wisdom',
    'chance',
    'intelligence',
    'fire_resistance',
    'water_resistance',
    'air_resistance',
    'earth_resistance',
    'critical',
    'raw_damage',
    'ap',
    'heal',
    'summons',
  ])
  for (const item of Object.values(items))
    for (const stat of Object.keys(item.stats))
      expect(allowed.has(stat)).toBe(true)
})

test('classes: only identity fields live in the class catalog', () => {
  for (const klass of Object.values(classes)) {
    expect(Object.keys(klass).sort()).toEqual(CLASS_IDENTITY_FIELDS)
    expect(typeof klass.name).toBe('string')
    expect(typeof klass.title).toBe('string')
    expect(typeof klass.health).toBe('number')
    expect(typeof klass.stamina).toBe('number')
    expect(typeof klass.starter_weapon).toBe('string')
    expect(typeof klass.weapon_category).toBe('string')
  }
})
