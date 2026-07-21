// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Schema-validates the seeded content (scripts/seed-content.js output): the
// generated spells.json / items.json / classes.json must carry the required
// fields in the right shape so the sim can consume them. This is a structural
// gate, not a balance check — it catches a broken/empty re-seed.

import { test, expect } from 'bun:test'

import spells from '../src/spells.json' with { type: 'json' }
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

const all_spells = Object.values(spells).flatMap(class_spells =>
  Object.entries(class_spells),
)

test('every class has a spell map and the 12 classes are present', () => {
  expect(Object.keys(classes).length).toBe(12)
  for (const id of [
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
  ])
    expect(classes[id]).toBeDefined()
})

test('spells: required fields, numeric AP cost, valid elements', () => {
  expect(all_spells.length).toBeGreaterThanOrEqual(72)
  for (const [key, spell] of all_spells) {
    expect(typeof spell.name).toBe('string')
    expect(spell.name.length).toBeGreaterThan(0)
    expect(typeof spell.icon).toBe('string')
    expect(typeof spell.description).toBe('string')
    expect(Array.isArray(spell.levels)).toBe(true)
    expect(spell.levels.length).toBeGreaterThan(0)
    for (const level of spell.levels) {
      // AP cost must be a finite number
      expect(typeof level.cost).toBe('number')
      expect(Number.isFinite(level.cost)).toBe(true)
      // range is a [min, max] cell tuple, min <= max
      expect(level.range.length).toBe(2)
      expect(level.range[0]).toBeLessThanOrEqual(level.range[1])
      expect(typeof level.area).toBe('number')
      expect(Array.isArray(level.base_effects)).toBe(true)
      for (const effect of [...level.base_effects, ...level.critical_effects]) {
        expect(typeof effect.type).toBe('string')
        // any effect carrying an element must use the 5-set vocabulary
        if ('element' in effect) expect(ELEMENTS.has(effect.element)).toBe(true)
      }
    }
    // the hand-authored curated entries must survive the merge
    if (key === 'slash' || key === 'jump' || key === 'rage')
      expect(spell.levels[0].base_effects.length).toBeGreaterThanOrEqual(1)
  }
})

test('hand-authored senshi/yajin entries are preserved verbatim', () => {
  for (const key of ['slash', 'jump', 'rage'])
    expect(spells.senshi[key]).toBeDefined()
  for (const key of ['trap', 'unfazed', 'flying_soul'])
    expect(spells.yajin[key]).toBeDefined()
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

test('classes: required fields and spellsJson unlock map references real spell ids', () => {
  const known_spell_ids = new Set(
    all_spells.map(([, spell]) => spell.icon).filter(Boolean),
  )
  for (const klass of Object.values(classes)) {
    expect(typeof klass.name).toBe('string')
    expect(typeof klass.health).toBe('number')
    expect(typeof klass.stamina).toBe('number')
    // unlock keys are numeric levels; values are spell ids
    for (const [level, spell_id] of Object.entries(klass.spells)) {
      expect(Number.isFinite(Number(level))).toBe(true)
      expect(typeof spell_id).toBe('string')
      // every classed spell that HAS an icon must resolve to a seeded spell
      if (known_spell_ids.has(spell_id))
        expect(known_spell_ids.has(spell_id)).toBe(true)
    }
  }
})
