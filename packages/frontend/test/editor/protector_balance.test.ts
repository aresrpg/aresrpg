// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { gatherable_catalog } from '@aresrpg/immutable'

import mobs from '../../../../seed/content/mobs.json'
import { mob_power_summary } from '../../src/editor/mob_power.ts'
import type { JsonValue } from '../../src/editor/seed_editor.ts'

const band_scaled = (base: number, low: number, high: number, level: number): number =>
  high === low ? base : Math.floor((base * (6 * (high - low) + 10 * (level - low))) / (10 * (high - low)))
const scalable = ({ kind }: Readonly<{ kind: number }>): boolean => kind <= 7 || kind === 14 || kind === 15
const midpoint_summary = (mob: (typeof mobs)[number]) => {
  const low = mob.level_min
  const high = mob.level_max
  const level = Math.floor((low + high) / 2)
  const scale_effect = (row: (typeof mob.spells)[number]['levels'][number]['effects'][number]) =>
    scalable(row)
      ? {
          ...row,
          value: band_scaled(row.value, low, high, level),
          value_max: band_scaled(row.value_max, low, high, level),
        }
      : row
  const scaled = {
    ...mob,
    level_min: level,
    level_max: level,
    hp: band_scaled(mob.hp, low, high, level),
    xp: band_scaled(mob.xp, low, high, level),
    spells: mob.spells.map((spell) => ({
      ...spell,
      levels: spell.levels.map((details) => ({
        ...details,
        effects: details.effects.map(scale_effect),
        crit_effects: details.crit_effects.map(scale_effect),
      })),
    })),
  }
  return mob_power_summary(scaled as unknown as JsonValue)!
}
const protector_by_type = new Map(mobs.filter(({ role }) => role === 'protector').map((mob) => [mob.mob_type, mob]))
type Element = keyof (typeof mobs)[number]['resistances']
const family_policy = Object.freeze({
  FARMER: Object.freeze({ family: 'protector_bricheton', hp: [0.99, 1.02], damage: 1.2 }),
  HERBALIST: Object.freeze({ family: 'protector_gaia', hp: [0.73, 0.77], damage: 1 }),
  MINER: Object.freeze({ family: 'protector_miner', hp: [1.23, 1.27], damage: 1 }),
})
const is_direct_attack = ({ kind, stat, turns }: Readonly<{ kind: number; stat: number; turns: number }>): boolean =>
  kind === 0 || (kind === 6 && stat === 12 && turns === 0)

test('protector family midpoint outputs stay anchored to their ordinary Dofus cohort', () => {
  gatherable_catalog.forEach(({ job, protector }) => {
    const mob = protector_by_type.get(protector)!
    const summary = midpoint_summary(mob)
    const hp_ratio = summary.minimum.hp / summary.retro.hp
    const policy = family_policy[job]

    expect(summary.minimum.xp, `${protector} XP`).toBe(summary.retro.xp)
    expect(mob.family).toBe(policy.family)
    expect(hp_ratio, `${protector} HP`).toBeWithin(policy.hp[0]!, policy.hp[1]!)
    expect(summary.minimum.damage, `${protector} damage`).toBe(Math.round(summary.retro.damage * policy.damage))
  })
})

test('Brichetons strike in melee, push on every damaging cast, and carry elemental specialties', () => {
  const brichetons = mobs.filter(({ family }) => family === 'protector_bricheton')
  expect(brichetons).toHaveLength(11)
  brichetons.forEach((mob) => {
    const ram = mob.spells.find(({ name }) => name === 'Threshing Ram')!.levels[0]!
    expect([ram.range_min, ram.range_max]).toEqual([1, 1])
    expect(ram.casts_per_turn).toBe(0)
    expect(ram.effects.some(({ kind, element }) => kind === 0 && element === mob.element)).toBeTrue()
    expect(ram.effects.some(({ kind }) => kind === 8)).toBeTrue()
    mob.spells
      .map(({ levels }) => levels[0]!)
      .filter(({ effects }) => effects.some(is_direct_attack))
      .forEach(({ effects }) =>
        expect(
          effects.some(({ kind }) => kind === 8),
          mob.mob_type
        ).toBeTrue()
      )
    const own = mob.resistances[mob.element as Element] - 32_768
    const others = Object.entries(mob.resistances)
      .filter(([element]) => element !== mob.element)
      .map(([, value]) => value - 32_768)
    expect(own).toBeGreaterThan(Math.max(...others))
  })
  expect(protector_by_type.get('protector_suize_bricheton')?.spells[0]?.levels[0]?.effects).toContainEqual(
    expect.objectContaining({ kind: 5, element: 'water', stat: 12, turns: 3 })
  )
  expect(protector_by_type.get('protector_blood_bricheton')?.spells[0]?.levels[0]?.effects).toContainEqual(
    expect.objectContaining({ kind: 6, element: 'fire', stat: 12 })
  )
})

test('Gaias are fragile mobile poisoners with evasion and occupied-cell hindering glyphs', () => {
  const gaias = mobs.filter(({ family }) => family === 'protector_gaia')
  expect(gaias).toHaveLength(11)
  gaias.forEach((mob) => {
    const summary = midpoint_summary(mob)
    expect(summary.minimum.mp).toBeGreaterThanOrEqual(5)
    const shed_spores = mob.spells.find(({ name }) => name === 'Shed Spores')!.levels[0]!
    expect(shed_spores.effects).toContainEqual(expect.objectContaining({ kind: 4, stat: 7, target_filter: 4 }))
    expect(shed_spores.effects).toContainEqual(expect.objectContaining({ kind: 4, stat: 3, target_filter: 4 }))
    expect(mob.spells.some(({ levels }) => levels[0]!.effects.some(({ kind }) => kind === 17))).toBeFalse()
    const glyph = mob.spells.find(({ levels }) => levels[0]!.effects.some(({ kind }) => kind === 13))!.levels[0]!
    expect(glyph.free_cell).toBeFalse()
    expect(glyph.effects.some(({ kind, stat }) => kind === 5 && [6, 7, 11].includes(stat))).toBeTrue()
    const attack = mob.spells.find(({ name }) => name === 'Venom Touch')!.levels[0]!
    expect(attack.range_min).toBe(1)
    expect(attack.range_max).toBeWithin(3, 5)
    expect(attack.casts_per_turn).toBe(0)
    expect(attack.effects).toContainEqual(
      expect.objectContaining({ kind: 5, element: mob.element, stat: 12, turns: 2 })
    )
  })
})

test('miner protectors are slow ranged tanks with independently rolled elemental shields', () => {
  const miners = mobs.filter(({ family }) => family === 'protector_miner')
  expect(miners).toHaveLength(11)
  miners.forEach((mob) => {
    const summary = midpoint_summary(mob)
    expect(summary.minimum.mp).toBeLessThanOrEqual(3)
    const guard = mob.spells.find(({ name }) => name === 'Prismatic Guard')!.levels[0]!
    expect(guard.effects.map(({ element }) => element)).toEqual(['earth', 'fire', 'water', 'air'])
    expect(guard.effects.every(({ kind, chance_bp }) => kind === 14 && chance_bp === 2_500)).toBeTrue()
    const volley = mob.spells.find(({ name }) => name === 'Shard Volley')!.levels[0]!
    expect(volley.range_min).toBe(3)
    expect(volley.range_max).toBeWithin(6, 8)
    expect(volley.casts_per_turn).toBe(0)
    const own = mob.resistances[mob.element as Element] - 32_768
    const others = Object.entries(mob.resistances)
      .filter(([element]) => element !== mob.element)
      .map(([, value]) => value - 32_768)
    expect(own).toBeGreaterThan(Math.max(...others))
  })
})
