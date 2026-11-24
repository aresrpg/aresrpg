// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { CONTRACT_CONSTANTS, type HydratedFightCheckpoint } from '@aresrpg/fight'
import type { CharacterRow } from '@aresrpg/protocol'

import { target_fields, type TargetOptions } from './target_constraints.ts'
import { joinable_team } from './team_actions.ts'
import { BOOST_REMOVED, names_removed_step, validate_profile_checkpoint, type CombatProfile } from './combat_profile.ts'
import { plan_combat_turn } from './combat_tactics.ts'
import {
  gameplay_observation_ready,
  gameplay_observed_ms,
  type GameplayContext,
  fight_checkpoint_id,
} from './gameplay_context.ts'
import { owned_fight, validate_gameplay, type GameplayActionName } from './gameplay.ts'

/** `allies` are teammates whose own trees may join this fight; `dungeon` names the run a room belongs to. */
type CombatIntent = Readonly<{
  fight: string
  profiles: readonly Readonly<{ character_id: string; profile: CombatProfile }>[]
  target_options?: TargetOptions
  allies?: readonly string[]
  dungeon?: string
}>
export type CombatNext = Readonly<{
  /** awaiting_ai is only the profile's authored fallback; failure lets the tree choose again. */
  state: 'action' | 'waiting' | 'failure' | 'awaiting_ai' | 'completed'
  issue?: string
  action?: Readonly<{ kind: GameplayActionName; payload: Readonly<Record<string, unknown>> }>
}>
type FightPayload = Readonly<{ character_id: string; fight: string; fighter_idx: string; checkpoint_id: string }>
type Selection = Readonly<{
  run: CombatIntent
  context: GameplayContext
  checkpoint: HydratedFightCheckpoint
  characters: readonly CharacterRow[]
  payload: FightPayload
}>
const action = (kind: GameplayActionName, payload: Readonly<Record<string, unknown>>): CombatNext => ({
  state: 'action',
  action: { kind, payload },
})
/** A free teammate who may still take a seat. Nobody leads: every hero gives the others the chain's
 * own placement window before readying, so a team gathers without a coordinator. */
const gathering = ({ run, checkpoint: { contract }, context }: Selection) =>
  context.snapshot.characters.some((ally) =>
    [
      run.allies?.includes(ally.id),
      ally.custody === 'kiosk',
      !ally.active_fight,
      !ally.ambush,
      run.dungeon
        ? ally.dungeon_run?.dungeon === run.dungeon && ally.dungeon_run.room === Number(contract.dungeon_room)
        : !ally.dungeon_run && ally.world === contract.world,
      joinable_team(contract, context.address, ally.id) !== null,
    ].every(Boolean)
  )
const placement_action = (selection: Selection): CombatNext => {
  const { contract } = selection.checkpoint
  const { context, characters, payload } = selection
  const unready = characters.find((character) => !contract.fighters[character.active_fight!.seat]!.ready)
  // An arena's placement clock is unarmed (zero) until its lobby is full: nothing expires before that.
  const expired =
    contract.placement_ms !== 0n &&
    BigInt(context.snapshot.clock!.chain_ms) >= contract.placement_ms + CONTRACT_CONSTANTS.placement_force_ms
  if (!expired && gathering(selection)) return { state: 'waiting' }
  if (unready)
    return action('fight_ready', {
      ...payload,
      character_id: unready.id,
      fighter_idx: String(unready.active_fight!.seat),
    })
  const all_ready = contract.fighters.every(
    (fighter) => fighter.kind.type !== 'player' || fighter.ready || fighter.dead
  )
  return all_ready || expired ? action('fight_start', payload) : { state: 'waiting' }
}
/** A hero plays only its own turn, even late: the chain lets a turn end at any time until someone
 * passes it. It passes a dead seat at once and anyone else's turn only after the turn window. */
const active_action = (selection: Selection): CombatNext => {
  const { run, checkpoint, context, payload } = selection
  const { contract } = checkpoint
  const seat = contract.queue[Number(contract.turn_ptr)]!
  const fighter = contract.fighters[Number(seat)]!
  const hero = fighter.kind.type === 'player' && fighter.kind.owner === context.address && fighter.kind.character
  if (!fighter.dead && run.profiles.some(({ character_id }) => character_id === hero))
    return owned_turn_action(selection, seat, hero as string)
  const expired = BigInt(context.snapshot.clock!.chain_ms) >= contract.turn_started_ms + CONTRACT_CONSTANTS.turn_max_ms
  return fighter.dead || expired ? action('fight_crank', payload) : { state: 'waiting' }
}
const owned_turn_action = (
  { run, checkpoint, context, payload }: Selection,
  seat: bigint,
  character_id: string
): CombatNext => {
  const { contract } = checkpoint
  const configured = run.profiles.find((profile) => profile.character_id === character_id)!
  // A tree stored before a step was removed waits for its author instead of playing a profile it lost.
  if (names_removed_step(configured.profile)) return { state: 'awaiting_ai', issue: BOOST_REMOVED }
  const unavailable = validate_profile_checkpoint(configured.profile, checkpoint, seat)
  if (unavailable.length) return { state: 'failure', issue: `unavailable_spells:${unavailable.join(',')}` }
  const observed_ms = gameplay_observed_ms(context)
  if (observed_ms < contract.turn_started_ms + CONTRACT_CONSTANTS.turn_min_ms) return { state: 'waiting' }
  const planned = plan_combat_turn(configured.profile, checkpoint, seat, observed_ms)
  if (planned.issue)
    return { state: planned.issue === 'not_active_turn' ? 'waiting' : 'awaiting_ai', issue: planned.issue }
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
export const next_combat_action = (run: CombatIntent, context: GameplayContext): CombatNext => {
  if (!gameplay_observation_ready(context)) return { state: 'waiting' }
  const characters = context.snapshot.characters.filter(({ id }) =>
    run.profiles.some(({ character_id }) => character_id === id)
  )
  if (characters.length !== run.profiles.length) return { state: 'failure', issue: 'character_not_owned' }
  if (characters.every((character) => character.custody === 'kiosk' && !character.active_fight))
    return { state: 'completed' } // The run reducer additionally requires its reconciled settlement command.
  const row = context.snapshot.fights[run.fight]
  if (!row) return { state: 'waiting' }
  const remaining = characters.filter((character) => character.active_fight?.id === run.fight)
  if (!remaining.length) return { state: 'failure', issue: 'fight_changed' }
  const payload = {
    ...target_fields(run.target_options),
    ...(run.dungeon ? { dungeon: run.dungeon } : {}),
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
