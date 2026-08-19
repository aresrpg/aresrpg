// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A spell preview is a disposable run through the real resolver, never a second combat formula.

import { create_fight } from './fight.ts'
import type { FightRuntimeError, HydratedFightCheckpoint } from './types.ts'

export type SpellPreviewEffect = Readonly<{
  kind: bigint
  channel: bigint
  element: string
  value: bigint
  turns: bigint
}>

export type SpellPreviewMovement = Readonly<{
  mode: 'push' | 'pull' | 'teleport' | 'swap'
  cells: bigint
}>

export type SpellTargetPreview = Readonly<{
  fighter: bigint
  hp_before: bigint
  hp_after: bigint
  ap_before: bigint
  ap_after: bigint
  ap_delta: bigint
  mp_before: bigint
  mp_after: bigint
  mp_delta: bigint
  cell_before: bigint
  cell_after: bigint
  effects: readonly SpellPreviewEffect[]
  movements: readonly SpellPreviewMovement[]
}>

export type SpellCastPreview = Readonly<{
  error: FightRuntimeError | null
  critical: boolean
  targets: readonly SpellTargetPreview[]
}>

const preview_cast = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  action:
    | Readonly<{ type: 'cast_spell'; fighter: bigint; spell: string; target_cell: bigint }>
    | Readonly<{ type: 'weapon_strike'; fighter: bigint; target_cell: bigint }>
): SpellCastPreview => {
  const simulation = create_fight({ state: checkpoint as HydratedFightCheckpoint, mode: 'local' })
  const result = simulation.apply(action)
  if (result.error) return Object.freeze({ error: result.error, critical: false, targets: Object.freeze([]) })
  const critical = result.events.find((event) => event.type === 'spell_cast')?.payload.critical ?? false
  const effects = result.events.flatMap((event) =>
    event.type === 'effect_applied'
      ? [
          Object.freeze({
            fighter: event.payload.target,
            effect: Object.freeze({
              kind: event.payload.kind,
              channel: event.payload.channel,
              element: event.payload.element,
              value: event.payload.value,
              turns: event.payload.turns,
            }),
          }),
        ]
      : []
  )
  const movement_events = result.events.flatMap((event) =>
    event.type === 'fighter_moved' && event.payload.mode !== 'walk'
      ? [
          Object.freeze({
            fighter: event.payload.fighter,
            mode: event.payload.mode as SpellPreviewMovement['mode'],
          }),
        ]
      : []
  )
  const impacted = new Set(
    result.events.flatMap((event) => {
      if (event.type === 'damage_number' || event.type === 'heal_number') return [event.payload.target]
      if (event.type === 'effect_applied') return [event.payload.target]
      if (event.type === 'fighter_moved' && event.payload.mode !== 'walk') return [event.payload.fighter]
      if (event.type === 'ap_mp_change' && event.payload.reason !== 'cast_cost') return [event.payload.fighter]
      return []
    })
  )
  const point_deltas = result.events.reduce<Map<bigint, Readonly<{ ap: bigint; mp: bigint }>>>((deltas, event) => {
    if (event.type !== 'ap_mp_change' || event.payload.reason === 'cast_cost') return deltas
    const previous = deltas.get(event.payload.fighter) ?? { ap: 0n, mp: 0n }
    deltas.set(
      event.payload.fighter,
      Object.freeze({
        ap: previous.ap + event.payload.ap_after - event.payload.ap_before,
        mp: previous.mp + event.payload.mp_after - event.payload.mp_before,
      })
    )
    return deltas
  }, new Map())
  const targets = checkpoint.contract.fighters.flatMap((before, index) => {
    const after = result.state.contract.fighters[index]
    if (!after || !impacted.has(BigInt(index))) return []
    const applied = effects.filter(({ fighter }) => fighter === BigInt(index)).map(({ effect }) => effect)
    const movements = movement_events
      .filter(({ fighter }) => fighter === BigInt(index))
      .reduce<readonly SpellPreviewMovement[]>((rows, movement) => {
        const previous = rows.at(-1)
        if (previous?.mode !== movement.mode)
          return Object.freeze([...rows, Object.freeze({ mode: movement.mode, cells: 1n })])
        return Object.freeze([...rows.slice(0, -1), Object.freeze({ mode: movement.mode, cells: previous.cells + 1n })])
      }, Object.freeze([]))
    return [
      Object.freeze({
        fighter: BigInt(index),
        hp_before: before.hp,
        hp_after: after.hp,
        ap_before: before.ap,
        ap_after: after.ap,
        ap_delta: point_deltas.get(BigInt(index))?.ap ?? 0n,
        mp_before: before.mp,
        mp_after: after.mp,
        mp_delta: point_deltas.get(BigInt(index))?.mp ?? 0n,
        cell_before: before.cell,
        cell_after: after.cell,
        effects: Object.freeze(applied),
        movements: Object.freeze(movements),
      }),
    ]
  })
  return Object.freeze({ error: null, critical, targets: Object.freeze(targets) })
}

export const preview_spell_cast = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  caster: bigint,
  spell: string,
  target_cell: bigint
): SpellCastPreview => preview_cast(checkpoint, { type: 'cast_spell', fighter: caster, spell, target_cell })

export const preview_weapon_strike = (
  checkpoint: Readonly<HydratedFightCheckpoint>,
  caster: bigint,
  target_cell: bigint
): SpellCastPreview => preview_cast(checkpoint, { type: 'weapon_strike', fighter: caster, target_cell })
