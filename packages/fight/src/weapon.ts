// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { AREA_SHAPES, CLASS_AFFINITIES, EFFECT_KINDS, TARGET_FILTERS, WEAPON_PHYSICS } from './move_contract.gen.ts'
import type { FightReadState } from './spell_turn.ts'
import type { SpellEffect, SpellLevel, WeaponDamage, WeaponSource } from './types.ts'

type WeaponPhysics = {
  crit_1_in: bigint
  ap: bigint
  reach: bigint
  range_min: bigint
  modifiable_range: boolean
  line_launch: boolean
  area_shape: bigint
  area_size: bigint
}

const physics_of = (category: string): WeaponPhysics =>
  (WEAPON_PHYSICS as Record<string, WeaponPhysics>)[category] ?? {
    crit_1_in: 100n,
    ap: 4n,
    reach: 1n,
    range_min: 1n,
    modifiable_range: false,
    line_launch: false,
    area_shape: AREA_SHAPES.point,
    area_size: 0n,
  }

const hit = (element: string, from: bigint, to: bigint, area_shape: bigint, area_size: bigint): SpellEffect => ({
  kind: BigInt(EFFECT_KINDS.damage),
  element,
  value: from,
  value_max: to,
  area_shape: BigInt(area_shape),
  area_size: BigInt(area_size),
  target_filter: BigInt(TARGET_FILTERS.none),
  chance_bp: 10_000n,
  turns: 0n,
  stat: 0n,
})

const assemble = (physics: WeaponPhysics, lines: WeaponDamage[], affinity: boolean): SpellLevel => {
  const scale = (value: bigint): bigint => (affinity ? (value * 110n) / 100n : value)
  const effects = lines.map(({ element, from, to }) => {
    const minimum = scale(BigInt(from))
    const maximum = scale(BigInt(to))
    return hit(element, minimum, maximum, physics.area_shape, physics.area_size)
  })
  const crit_effects = effects.map((effect) => ({
    ...effect,
    value: (effect.value * 150n) / 100n,
    value_max: (effect.value_max * 150n) / 100n,
  }))
  return {
    ap_cost: BigInt(physics.ap),
    range_min: BigInt(physics.range_min),
    range_max: BigInt(physics.reach),
    modifiable_range: physics.modifiable_range,
    line_of_sight: true,
    line_launch: physics.line_launch,
    free_cell: false,
    casts_per_turn: 0n,
    casts_per_target: 0n,
    cooldown_turns: 0n,
    crit_1_in: BigInt(physics.crit_1_in),
    effects,
    crit_effects,
  }
}

export const unarmed = (): SpellLevel => assemble(physics_of(''), [{ element: 'earth', from: 4n, to: 4n }], false)

export const strike_of = (classe: string, weapon: WeaponSource | null): SpellLevel => {
  if (!weapon || weapon.damages.length === 0) return unarmed()
  return assemble(
    physics_of(weapon.category),
    weapon.damages,
    (CLASS_AFFINITIES as Record<string, string>)[classe] === weapon.category
  )
}

export const weapon_level_of = (runtime: FightReadState, caster: bigint): SpellLevel | null => {
  const fighter = runtime.contract.fighters[Number(caster)]
  if (!fighter || fighter.kind.type !== 'player') return null
  const source = runtime.sources.players[fighter.kind.character]
  return source ? strike_of(source.classe, source.weapon) : null
}
