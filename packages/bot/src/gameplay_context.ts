// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { hydrate_fight_checkpoint, type HydratedFightCheckpoint } from '@aresrpg/fight'
import { chain_now } from '@aresrpg/protocol/chain-clock'
import {
  character_checkpoint,
  PLAYABLE_INDEXING_LAG,
  travel_proof_ready,
  type CharacterRow,
  type FightStateRow,
} from '@aresrpg/protocol'
import type { create_agent_actions } from '@aresrpg/sdk/agent-actions'

import spells from '../../../seed/content/spells.json'

import type { Travel } from './locomotion.ts'
import type { ActorSnapshot } from './actor_snapshot.ts'
import type { ActorWorld } from './actor_world.ts'
import type { Command } from './control.ts'
import { hash_secret } from './model.ts'
import { identifier, matches, type Schema } from './gameplay_schema.ts'

export type GameplayContext = Readonly<{
  balance?: Readonly<{ address: string; balance_mist: string; sampled_at: number; expires_at: number }> | null
  address: string
  pins?: import('@aresrpg/sdk/pins').Pins
  command: Command
  snapshot: ActorSnapshot
  now: number
  freshness_ms: number
}>
type AgentActions = ReturnType<typeof create_agent_actions>
/** Every SDK door a gameplay command may call, built for the one wallet that signs it. */
export type GameplayExecutor = AgentActions['fight'] &
  AgentActions['character'] &
  AgentActions['marketplace'] &
  Readonly<Pick<AgentActions, 'dungeon' | 'kolizeum' | 'tournament' | 'create_character'>>
/** One gameplay command kind. `validate` reads the observed context and is rechecked at signing and
 * submission; `execute` sends what it validated through the SDK. */
export type GameplayAction<Input> = Readonly<{
  description: string
  input_schema: Schema
  parse: (value: unknown) => unknown
  validate: (context: GameplayContext) => Readonly<{ input: Input; travel?: Travel }>
  execute: (sdk: GameplayExecutor, input: Input) => Promise<unknown>
}>
/** Ties a kind's validated input to the SDK door that takes it. */
export const gameplay_action = <Input>(action: GameplayAction<Input>) => Object.freeze(action)
export const gameplay_json = (value: unknown): string =>
  JSON.stringify(value, (_, field: unknown) => (typeof field === 'bigint' ? field.toString() : field))
export const fight_checkpoint_id = (row: FightStateRow): string => hash_secret(gameplay_json(row))
export const zone_checkpoint_id = (row: ActorWorld['zones'][string]): string => hash_secret(gameplay_json(row))
export const hydrate_gameplay_fight = (row: FightStateRow): HydratedFightCheckpoint =>
  hydrate_fight_checkpoint({
    contract: row.contract,
    sources: { players: row.players, spells: Object.fromEntries(spells.map((spell) => [spell.name, spell])) },
  })
/** The fight a command names, as observed at the checkpoint it names. */
export const observed_fight = (
  payload: Readonly<{ fight: string; checkpoint_id: string }>,
  context: Pick<GameplayContext, 'snapshot'>
) => {
  const row = context.snapshot.fights[payload.fight]
  if (!row || fight_checkpoint_id(row) !== payload.checkpoint_id) throw new Error('needs_resync')
  return { row, checkpoint: hydrate_gameplay_fight(row) }
}
export const gameplay_observed_ms = ({
  snapshot,
  now,
  freshness_ms,
}: Pick<GameplayContext, 'snapshot' | 'now' | 'freshness_ms'>) => {
  const fresh = (at: number) => Number.isFinite(at) && at <= now && at + freshness_ms > now
  const { clock, indexing_lag: lag } = snapshot
  const ready = [
    snapshot.ready,
    snapshot.frozen === false,
    fresh(snapshot.observed_at),
    lag !== null,
    Number.isSafeInteger(lag),
    Number(lag) >= 0,
    Number(lag) <= PLAYABLE_INDEXING_LAG,
  ].every(Boolean)
  if (!ready || !clock || !fresh(clock.observed_at) || !Number.isSafeInteger(clock.chain_ms) || clock.chain_ms < 0)
    throw new Error('needs_resync')
  const chain_ms = chain_now(clock, now)
  if (chain_ms === null) throw new Error('needs_resync')
  return BigInt(Math.floor(chain_ms))
}

/**
 * What a read is waiting for, in the order a wallet gets ready: its game connection, the game's own
 * state, the chain clock, then each fight a hero sits in. A caller told only "pending" cannot tell a
 * slow start from a wallet that will never answer; these names say which fact is missing.
 */
export const observation_blockers = ({
  snapshot,
  now,
  freshness_ms,
}: Pick<GameplayContext, 'snapshot' | 'now' | 'freshness_ms'>): readonly string[] => {
  const fresh = (at: number) => Number.isFinite(at) && at <= now && at + freshness_ms > now
  const seated = snapshot.characters.flatMap(({ active_fight }) => (active_fight ? [active_fight.id] : []))
  const facts: readonly (readonly [boolean, string])[] = [
    [snapshot.characters.length === 0 && snapshot.observed_at === 0, 'game_connection'],
    [snapshot.frozen === true, 'game_paused'],
    [snapshot.frozen === null, 'game_state'],
    [snapshot.indexing_lag === null || Number(snapshot.indexing_lag) > PLAYABLE_INDEXING_LAG, 'indexer_behind'],
    [!snapshot.clock || !fresh(snapshot.clock.observed_at), 'chain_clock'],
    [snapshot.observed_at !== 0 && !fresh(snapshot.observed_at), 'stale_game_state'],
    ...seated.map((id) => [!snapshot.fights[id], `fight_state:${id}`] as const),
  ]
  const missing = facts.flatMap(([absent, name]) => (absent ? [name] : []))
  // Every named fact holds and the wallet is still not ready: a fight row older than what the game announced.
  return missing.length || snapshot.ready ? missing : ['fight_resync']
}

/** A read the wallet cannot answer yet says what it waits for. */
export const pending_observation = (context: Pick<GameplayContext, 'snapshot' | 'now' | 'freshness_ms'>) => ({
  status: 'pending',
  waiting_for: observation_blockers(context),
})

export const gameplay_observation_ready = (context: Pick<GameplayContext, 'snapshot' | 'now' | 'freshness_ms'>) => {
  try {
    gameplay_observed_ms(context)
    return true
  } catch (error) {
    if (error instanceof Error && error.message === 'needs_resync') return false
    throw error
  }
}

export const assert_fresh = (context: GameplayContext) => {
  if (context.command.observation_revision !== context.snapshot.observation_revision) throw new Error('needs_resync')
  return gameplay_observed_ms(context)
}
export const owned_character = (context: GameplayContext, character_id: string): CharacterRow => {
  const character = context.snapshot.characters.find(({ id }) => id === character_id)
  if (!character) throw new Error('character_authority_mismatch')
  return character
}
export const custody_of = (character: CharacterRow) => {
  if (!matches(identifier, character.kiosk) || !matches(identifier, character.kiosk_cap))
    throw new Error('needs_custody_resync')
  return { kiosk: character.kiosk, kiosk_cap: character.kiosk_cap! }
}
export const assert_travel = (
  character: CharacterRow,
  payload: Readonly<{ world: string }>,
  x: number,
  z: number,
  now_ms: number
) => {
  if (
    character.custody !== 'kiosk' ||
    character.active_fight ||
    character.ambush ||
    character.dungeon_run ||
    character.world !== payload.world ||
    character.checkpoint_world !== payload.world
  )
    throw new Error('character_not_available')
  if (
    !travel_proof_ready({
      from_x: character.x!,
      from_z: character.z!,
      from_ms: character.at_ms!,
      pet_at_start: character.pet === true,
      pet_now: character.equipment.some((item) => item.slot === 'pet'),
      to_x: x,
      to_z: z,
      now_ms,
    })
  )
    throw new Error('travel_not_ready')
}
export const assert_tracked_zone = (
  context: GameplayContext,
  character_id: string,
  world: string,
  zx: number,
  zz: number
) => {
  const window = context.snapshot.tracked_zones[character_id]
  if (window?.world !== world) throw new Error('needs_resync')
  // The view is current and the zone is simply not in it: reading again changes nothing, walking does.
  if (!window.zones.some((zone) => zone.zx === zx && zone.zz === zz)) throw new Error('zone_outside_view')
}

export const travel_destination = (character: CharacterRow, x: number, z: number): Travel => {
  const checkpoint = character_checkpoint(character)
  if (!checkpoint || !character.world || character.x == null || character.z == null) throw new Error('needs_resync')
  return {
    character_id: character.id,
    checkpoint,
    world: character.world,
    x: character.x,
    z: character.z,
    target_x: x,
    target_z: z,
  }
}
