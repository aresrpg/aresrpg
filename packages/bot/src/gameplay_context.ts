// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { chain_now } from '@aresrpg/protocol/chain-clock'
import { character_checkpoint, PLAYABLE_INDEXING_LAG, travel_proof_ready, type CharacterRow } from '@aresrpg/protocol'

import type { Travel } from './locomotion.ts'
import type { ActorSnapshot } from './actor_snapshot.ts'
import type { Command } from './control.ts'
import { identifier, matches } from './gameplay_schema.ts'

export type GameplayContext = Readonly<{
  address: string
  pins?: import('@aresrpg/sdk/pins').Pins
  command: Command
  snapshot: ActorSnapshot
  now: number
  freshness_ms: number
}>
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

export const gameplay_observation_ready = (context: GameplayContext) => {
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
  if (window?.world !== world || !window.zones.some((zone) => zone.zx === zx && zone.zz === zz))
    throw new Error('needs_resync')
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
