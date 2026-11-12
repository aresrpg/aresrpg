// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { CONTRACT_CONSTANTS, type HydratedFightCheckpoint } from '@aresrpg/fight'
import type { CharacterRow } from '@aresrpg/protocol'

import type { CombatRun } from './combat_control.ts'
import { validate_profile_checkpoint } from './combat_profile.ts'
import { plan_combat_turn } from './combat_tactics.ts'
import { gameplay_observation_ready, gameplay_observed_ms, type GameplayContext } from './gameplay_context.ts'
import { owned_fight, fight_checkpoint_id, validate_gameplay, type GameplayActionName } from './gameplay.ts'

export type CombatNext = Readonly<{
  state: 'action' | 'waiting' | 'awaiting_ai' | 'completed'
  issue?: string
  action?: Readonly<{ kind: GameplayActionName; payload: Readonly<Record<string, unknown>> }>
}>
type FightPayload = Readonly<{ character_id: string; fight: string; fighter_idx: string; checkpoint_id: string }>
type Selection = Readonly<{
  run: CombatRun
  context: GameplayContext
  checkpoint: HydratedFightCheckpoint
  characters: readonly CharacterRow[]
  payload: FightPayload
}>
const action = (kind: GameplayActionName, payload: Readonly<Record<string, unknown>>): CombatNext => ({
  state: 'action',
  action: { kind, payload },
})
const placement_action = ({ checkpoint: { contract }, context, characters, payload }: Selection): CombatNext => {
  const unready = characters.find((character) => !contract.fighters[character.active_fight!.seat]!.ready)
  if (unready)
    return action('fight_ready', {
      ...payload,
      character_id: unready.id,
      fighter_idx: String(unready.active_fight!.seat),
    })
  const all_ready = contract.fighters.every(
    (fighter) => fighter.kind.type !== 'player' || fighter.ready || fighter.dead
  )
  const expired =
    BigInt(context.snapshot.clock!.chain_ms) >= contract.placement_ms + CONTRACT_CONSTANTS.placement_force_ms
  return all_ready || expired ? action('fight_start', payload) : { state: 'waiting' }
}
const active_action = ({ run, checkpoint, context, payload }: Selection): CombatNext => {
  const { contract } = checkpoint
  const seat = contract.queue[Number(contract.turn_ptr)]!
  const fighter = contract.fighters[Number(seat)]!
  const expired = BigInt(context.snapshot.clock!.chain_ms) >= contract.turn_started_ms + CONTRACT_CONSTANTS.turn_max_ms
  if (fighter.dead || expired) return action('fight_crank', payload)
  if (fighter.kind.type !== 'player' || fighter.kind.owner !== context.address) return { state: 'waiting' }
  return owned_turn_action({ run, checkpoint, context, payload, characters: [] }, seat, fighter.kind.character)
}
const owned_turn_action = (
  { run, checkpoint, context, payload }: Selection,
  seat: bigint,
  character_id: string
): CombatNext => {
  const { contract } = checkpoint
  const configured = run.profiles.find((profile) => profile.character_id === character_id)
  if (!configured) return { state: 'awaiting_ai', issue: 'missing_character_profile' }
  const unavailable = validate_profile_checkpoint(configured.profile, checkpoint, seat)
  if (unavailable.length) return { state: 'awaiting_ai', issue: `unavailable_spells:${unavailable.join(',')}` }
  const observed_ms = gameplay_observed_ms(context)
  if (observed_ms < contract.turn_started_ms + CONTRACT_CONSTANTS.turn_min_ms) return { state: 'waiting' }
  const planned = plan_combat_turn(configured.profile, checkpoint, seat, observed_ms)
  if (planned.issue) return { state: 'awaiting_ai', issue: planned.issue }
  return action('fight_turn', { ...payload, character_id, fighter_idx: String(seat), actions: planned.actions })
}
const fight_action = (selection: Selection): CombatNext => {
  const {
    checkpoint: { contract },
    payload,
  } = selection
  if (contract.ended) return action('fight_settle', payload)
  return contract.round === 0n ? placement_action(selection) : active_action(selection)
}

/** A finite fight objective selects ordinary actions; Move and the twin own all legality. */
export const next_combat_action = (run: CombatRun, context: GameplayContext): CombatNext => {
  if (!gameplay_observation_ready(context)) return { state: 'waiting' }
  const characters = context.snapshot.characters.filter(({ id }) =>
    run.profiles.some(({ character_id }) => character_id === id)
  )
  if (characters.length !== run.profiles.length) return { state: 'awaiting_ai', issue: 'character_not_owned' }
  if (characters.every((character) => character.custody === 'kiosk' && !character.active_fight))
    return { state: 'completed' } // The run reducer additionally requires its reconciled settlement command.
  const row = context.snapshot.fights[run.fight]
  if (!row) return { state: 'waiting' }
  const remaining = characters.filter((character) => character.active_fight?.id === run.fight)
  if (!remaining.length) return { state: 'awaiting_ai', issue: 'fight_changed' }
  const payload = {
    character_id: remaining[0]!.id,
    fight: run.fight,
    fighter_idx: String(remaining[0]!.active_fight!.seat),
    checkpoint_id: fight_checkpoint_id(row),
  }
  const { checkpoint } = owned_fight(payload, context)
  const next = fight_action({ run, context, checkpoint, characters: remaining, payload })
  if (next.action) validate_gameplay({ ...context, command: { ...context.command, ...next.action } })
  return next
}
