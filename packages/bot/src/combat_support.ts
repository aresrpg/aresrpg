// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  board_zone_cells,
  zone_targets,
  type Fighter,
  type HydratedFightCheckpoint,
  type SpellEffect,
} from '@aresrpg/fight'
import { EFFECT_KINDS } from '@aresrpg/fight/move_contract'

const positive_add = (row: Readonly<SpellEffect>) =>
  row.kind === EFFECT_KINDS.add && row.chance_bp > 0n && row.value_max > 0n
const added_value = (fighter: Readonly<Fighter>, stat: bigint, element: string) =>
  fighter.effects.reduce(
    (total, row) =>
      total + (row.kind === EFFECT_KINDS.add && row.stat === stat && row.element === element ? row.value : 0n),
    0n
  )
const improved = (before: Readonly<Fighter>, after: Readonly<Fighter>) =>
  after.hp > before.hp ||
  after.ap > before.ap ||
  after.mp > before.mp ||
  after.effects.some(
    ({ kind, stat, element }) =>
      kind === EFFECT_KINDS.add && added_value(after, stat, element) > added_value(before, stat, element)
  )

/** Current potential coverage, not a prediction of future occupancy, rolls, or buff utility.
 * This fails if a stored glyph payload is treated as an effect applied at placement time. */
const glyph_recipients = (
  before: Readonly<HydratedFightCheckpoint>,
  after: Readonly<HydratedFightCheckpoint>,
  caster: bigint
): ReadonlySet<bigint> => {
  const anchors = new Set(before.contract.zones.map(({ anchor }) => anchor))
  const zones = after.contract.zones.filter(
    (zone) => zone.owner_fighter === caster && !zone.trap && zone.turns_left > 0n && !anchors.has(zone.anchor)
  )
  const recipients = zones.flatMap((zone) => {
    const cells = board_zone_cells(zone)
    const occupants = after.contract.fighters.filter(
      (fighter) => !fighter.dead && !fighter.forfeited && cells.includes(fighter.cell)
    )
    return occupants.flatMap((occupant) =>
      // A glyph resolves its payload at each turn-start occupant, not at the zone anchor.
      zone.effects.filter(positive_add).flatMap((row) => zone_targets(after, caster, row, occupant.cell, occupant.cell))
    )
  })
  return new Set(recipients)
}

/** Count distinct living allies, including the caster. Zero is not a useful support cast.
 * Immediate pools use net gains; stat adds use increased totals, never pre-existing buffs.
 * Glyphs count positive add payload coverage only. Shields and other utility are not scored. */
export const support_beneficiaries = (
  before: Readonly<HydratedFightCheckpoint>,
  after: Readonly<HydratedFightCheckpoint>,
  caster: bigint
): number => {
  const owner = after.contract.fighters[Number(caster)]
  if (!owner || owner.dead || owner.forfeited || after.contract.ended) return 0
  const potential = glyph_recipients(before, after, caster)
  return after.contract.fighters.filter(
    (fighter, index) =>
      !fighter.dead &&
      !fighter.forfeited &&
      fighter.team === owner.team &&
      (potential.has(BigInt(index)) || improved(before.contract.fighters[index]!, fighter))
  ).length
}
