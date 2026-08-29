// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import mobs from '../../../../seed/content/mobs.json'
import { mob_power_summary } from '../../src/editor/mob_power.ts'
import type { JsonValue } from '../../src/editor/seed_editor.ts'

const preserved = new Set([
  'fuwa__white',
  'fuwa__black',
  'fuwa__fukuo',
  'misui__fire',
  'misui__earth',
  'misui__wind',
  'misui__water',
  'misui__vitality',
])
const authored = mobs.filter(({ role, mob_type }) => role !== 'protector' && !preserved.has(mob_type))
const by_type = new Map(authored.map((mob) => [mob.mob_type, mob]))
const policy = Object.freeze({
  ant_red: [0.9, 1.1, 1.1],
  ant_white: [0.8, 0.9, 0.85],
  aragne__fire: [0.75, 0.8, 1.15],
  aragne__water: [1.1, 1.1, 0.9],
  aragne__air: [0.8, 0.9, 1],
  aragne__earth: [1.05, 1, 0.9],
  aragne__arakiri: [0.85, 1.2, 1.8],
  araknomath: [4, 3, 1],
  crab: [1.5, 0.9, 0.85],
  cro_wani__green: [1.25, 1.1, 1.2],
  cro_wani__white: [1.15, 1.2, 1.25],
  misui__misunami: [1.4, 1.3, 1.4],
  moka: [1, 0.9, 1],
  moyumi: [0.75, 0.9, 0.95],
})
const band_scaled = (base: number, low: number, high: number, level: number): number =>
  high === low ? base : Math.floor((base * (6 * (high - low) + 10 * (level - low))) / (10 * (high - low)))
const pool_scaled = (base: number, low: number, high: number, level: number): number =>
  high === low ? base : Math.round((base * (10 * (high - low) + 3 * (level - low))) / (10 * (high - low)))
const scalable = ({ kind }: Readonly<{ kind: number }>): boolean => kind <= 7 || kind === 14 || kind === 15
const midpoint_summary = (mob: (typeof authored)[number]) => {
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
    ap: pool_scaled(mob.ap, low, high, level),
    mp: pool_scaled(mob.mp, low, high, level),
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
const rows_of = (mob_type: string) => by_type.get(mob_type)!.spells.flatMap(({ levels }) => levels[0]!.effects)

test('all remaining mobs vary HP and XP around their role reference while matching intended turn damage', () => {
  expect(authored).toHaveLength(14)
  authored.forEach((mob) => {
    const [hp_factor, xp_factor, damage_factor] = policy[mob.mob_type as keyof typeof policy]
    const summary = midpoint_summary(mob)
    expect(summary.minimum.hp / summary.retro.hp, `${mob.mob_type} HP`).toBeWithin(hp_factor - 0.02, hp_factor + 0.02)
    const expected_xp = Math.round(summary.retro.xp * xp_factor)
    expect(summary.minimum.xp, `${mob.mob_type} XP`).toBeWithin(expected_xp - 1, expected_xp + 1)
    expect(summary.minimum.damage, `${mob.mob_type} damage`).toBe(Math.round(summary.retro.damage * damage_factor))
    expect(Math.max(...Object.values(mob.resistances))).toBeGreaterThan(32_768)
    expect(Math.min(...Object.values(mob.resistances))).toBeLessThan(32_768)
    expect(mob.spells.flatMap(({ levels }) => levels[0]!.effects).some(({ kind }) => kind === 17)).toBeFalse()
  })
})

test('ants are seven-MP poison supports whose colony links can protect allies', () => {
  ;['ant_white', 'ant_red'].forEach((mob_type) => {
    const mob = by_type.get(mob_type)!
    expect(midpoint_summary(mob).minimum.mp).toBeGreaterThanOrEqual(7)
    expect(rows_of(mob_type)).toContainEqual(expect.objectContaining({ kind: 19, target_filter: 3, turns: 1 }))
    expect(rows_of(mob_type)).toContainEqual(expect.objectContaining({ kind: 5, stat: 12, turns: 2 }))
    expect(mob.spells.at(-1)?.levels[0]?.casts_per_turn).toBe(0)
  })
})

test('Aragnes use elemental webs, pulls, or haste without relying on invisibility', () => {
  const aragnes = authored.filter(({ family, mob_type }) => family === 'aragne' && mob_type !== 'araknomath')
  expect(aragnes).toHaveLength(5)
  aragnes.forEach((mob) => {
    const rows = rows_of(mob.mob_type)
    expect(rows.some(({ kind }) => [4, 6, 9, 13].includes(kind))).toBeTrue()
    expect(rows.some(({ kind }) => kind === 17)).toBeFalse()
  })
  expect(rows_of('aragne__arakiri')).toContainEqual(expect.objectContaining({ kind: 6, stat: 12 }))
})

test('Crowani are buffing melee warriors, while Crab, Moka, and Moyumi keep distinct combat jobs', () => {
  ;['cro_wani__green', 'cro_wani__white'].forEach((mob_type) => {
    const mob = by_type.get(mob_type)!
    expect(rows_of(mob_type)).toContainEqual(expect.objectContaining({ kind: 4, target_filter: 3 }))
    expect(mob.spells[1]?.levels[0]?.casts_per_turn).toBe(1)
    expect(mob.spells[2]?.name).toBe('Tail Sweep')
  })
  expect(rows_of('crab')).toContainEqual(expect.objectContaining({ kind: 14, target_filter: 4 }))
  expect(rows_of('crab')).toContainEqual(expect.objectContaining({ kind: 15, target_filter: 4 }))
  const moka = by_type.get('moka')!
  expect(moka.spells).toHaveLength(1)
  expect([moka.spells[0]!.levels[0]!.range_min, moka.spells[0]!.levels[0]!.range_max]).toEqual([1, 1])
  const hollow_arrow = by_type.get('moyumi')!.spells.find(({ name }) => name === 'Hollow Arrow')!.levels[0]!
  expect([hollow_arrow.range_min, hollow_arrow.range_max]).toEqual([3, 7])
  expect(hollow_arrow.effects).toContainEqual(expect.objectContaining({ kind: 5, stat: 5, turns: 2 }))
})

test('Misunami retains Misui support, and Araknomath exposes movement, timing, and add priorities', () => {
  expect(rows_of('misui__misunami')).toContainEqual(expect.objectContaining({ kind: 4, stat: 12, target_filter: 3 }))
  expect(rows_of('misui__misunami')).toContainEqual(expect.objectContaining({ kind: 6, stat: 12, element: 'water' }))
  const boss = by_type.get('araknomath')!
  expect(boss.spells.map(({ name }) => name)).toEqual([
    'Axiom Cocoon',
    'Prime Web',
    'Factor Line',
    'Remainder Slam',
    'Final Proof',
  ])
  const boss_rows = rows_of('araknomath')
  expect(boss_rows).toContainEqual(expect.objectContaining({ kind: 14, target_filter: 4 }))
  expect(boss_rows).toContainEqual(expect.objectContaining({ kind: 15, target_filter: 4 }))
  expect(boss_rows).toContainEqual(expect.objectContaining({ kind: 13, area_shape: 1, area_size: 2 }))
  expect(boss_rows).toContainEqual(expect.objectContaining({ kind: 3, element: 'earth' }))
  expect(midpoint_summary(boss).minimum.xp).toBe(midpoint_summary(boss).retro.xp * 3)
})

test('Minosui Iron Scales shields its caster instead of targeting an impossible adjacent enemy', () => {
  const minosui = mobs.find(({ mob_type }) => mob_type === 'misui__vitality')!
  const iron_scales = minosui.spells.find(({ name }) => name === 'Iron Scales')!.levels[0]!
  expect([iron_scales.range_min, iron_scales.range_max]).toEqual([0, 0])
  expect(
    [...iron_scales.effects, ...iron_scales.crit_effects].every(({ target_filter }) => target_filter === 4)
  ).toBeTrue()
})
