// Regression gate for the reference-corpus stamina -> AP-cost conversion (src/spell_cost.js) and the resulting
// castability invariant: EVERY one of the 12 classes must have at least one spell castable within the
// base AP budget (<= 6), and every spell cost must be a positive integer in [1, 6]. This locks the
// CLAUDE.md caveat "10/12 classes lack a <=6-AP castable spell" closed.

import { test, expect } from 'bun:test'

import spells from '../src/spells.json' with { type: 'json' }
import {
  stamina_to_ap,
  AP_MIN,
  AP_MAX,
  AP_PER_STAMINA,
} from '../src/spell_cost.js'

const CLASSES = [
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

test('stamina_to_ap is a clamped integer division (the documented formula)', () => {
  // exact band edges from ap = clamp(round(stamina / 20), 1, 6)
  expect(stamina_to_ap(0)).toBe(1) // no free spells -> AP_MIN
  expect(stamina_to_ap(30)).toBe(2) // dense cheap kit lands at 2
  expect(stamina_to_ap(40)).toBe(2)
  expect(stamina_to_ap(50)).toBe(3) // round(2.5) -> 3
  expect(stamina_to_ap(60)).toBe(3)
  expect(stamina_to_ap(80)).toBe(4)
  expect(stamina_to_ap(110)).toBe(6) // round(5.5) -> 6, the ceiling band starts here
  expect(stamina_to_ap(300)).toBe(AP_MAX) // ultimate clamped to the cap
  // constants are coherent
  expect(AP_MIN).toBe(1)
  expect(AP_MAX).toBe(6)
  expect(AP_PER_STAMINA).toBe(20)
})

test('stamina_to_ap is deterministic and always a positive integer in [AP_MIN, AP_MAX]', () => {
  for (const stamina of [0, 5, 17, 33, 40, 55, 99, 120, 200, 300, 1000]) {
    const a = stamina_to_ap(stamina)
    const b = stamina_to_ap(stamina)
    expect(a).toBe(b) // pure: same input -> same output
    expect(Number.isInteger(a)).toBe(true)
    expect(a).toBeGreaterThanOrEqual(AP_MIN)
    expect(a).toBeLessThanOrEqual(AP_MAX)
  }
  // non-numeric / nullish input defaults to the floor cost, never NaN
  expect(stamina_to_ap(undefined)).toBe(AP_MIN)
  expect(stamina_to_ap(null)).toBe(AP_MIN)
})

test('every spell cost in spells.json is a positive integer within the AP budget', () => {
  for (const class_spells of Object.values(spells))
    for (const spell of Object.values(class_spells))
      for (const level of spell.levels) {
        expect(Number.isInteger(level.cost)).toBe(true)
        expect(level.cost).toBeGreaterThanOrEqual(AP_MIN)
        expect(level.cost).toBeLessThanOrEqual(AP_MAX)
      }
})

test('ALL 12 classes have at least one spell castable within the base AP budget (<=6)', () => {
  for (const class_id of CLASSES) {
    const class_spells = spells[class_id]
    expect(class_spells).toBeDefined()
    const castable = Object.values(class_spells).filter(spell =>
      spell.levels.some(level => level.cost <= AP_MAX),
    )
    expect(castable.length).toBeGreaterThanOrEqual(1)
  }
})

test('each class offers a spread: a cheap option (<=3 AP) AND a heavier option', () => {
  for (const class_id of CLASSES) {
    const level1_costs = Object.values(spells[class_id]).map(
      spell => spell.levels[0].cost,
    )
    // a cheap castable so a level-1 player can always act
    expect(Math.min(...level1_costs)).toBeLessThanOrEqual(3)
    // and a meaningfully more expensive option (the scale isn't flat)
    expect(Math.max(...level1_costs)).toBeGreaterThan(Math.min(...level1_costs))
  }
})
