// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { observe_chain_clock, type ChainClock } from '@aresrpg/protocol/chain-clock'
import { fight_packet_phase, fight_state_regresses, type FightPhaseRank } from '@aresrpg/protocol/fight-phase'
import type { AgentConnectionState } from '@aresrpg/sdk/agent-connection'
import { PLAYABLE_INDEXING_LAG, type CharacterRow, type FightStateRow, type ServerPacket } from '@aresrpg/protocol'

import { empty_inventory, fold_actor_inventory, type ActorInventory } from './actor_inventory.ts'
import { fold_actor_world, type ActorWorld } from './actor_world.ts'

export type ActorSnapshot = ActorWorld &
  Readonly<{
    inventory?: ActorInventory
    characters: readonly CharacterRow[]
    fights: Readonly<Record<string, FightStateRow>>
    fight_phases: Readonly<Record<string, FightPhaseRank>>
    clock: ChainClock
    observed_at: number
    ready: boolean
    observation_revision: number
    frozen: boolean | null
    indexing_lag: number | null
    cursor: number
    events: readonly Readonly<{ cursor: number; packet: ServerPacket }>[]
  }>
export const empty_snapshot = (): ActorSnapshot => ({
  inventory: empty_inventory(),
  characters: [],
  fights: {},
  fight_phases: {},
  zones: {},
  tracked_zones: {},
  clock: null,
  observed_at: 0,
  ready: false,
  observation_revision: 0,
  frozen: null,
  indexing_lag: null,
  cursor: 0,
  events: [],
})
/** The packets this actor folds (keep in step with `fold_packet`, `fold_actor_world` and
 * `fold_actor_inventory`); only these enter the event ring that `bot_observe` returns.
 * Text other players write (chat, whispers, tournament team names, party, friend and presence
 * rows) never reaches the owner's AI client, which also holds market tools (audit BOTAI-1). */
const MODELED_PACKETS: ReadonlySet<ServerPacket['type']> = new Set([
  'packet/characters',
  'packet/fight_state',
  'packet/fight_started',
  'packet/fight_phase',
  'packet/fight_ended',
  'packet/game_state',
  'packet/server_info',
  'packet/tracked_zones',
  'packet/zones',
  'packet/zone_spawns',
  'packet/inventory',
  'packet/item_updated',
  'packet/item_removed',
  'packet/listings',
  'packet/trades',
  'packet/trade_destroyed',
  'packet/claims',
  'packet/market_slice',
  'packet/market_prices',
])
/** One cursor per admitted event, so a skipped packet never reads as a lost one. */
const admit_event = (snapshot: ActorSnapshot, packet: ServerPacket, limit: number) =>
  MODELED_PACKETS.has(packet.type)
    ? {
        cursor: snapshot.cursor + 1,
        events: [...snapshot.events, { cursor: snapshot.cursor + 1, packet }].slice(-limit),
      }
    : { cursor: snapshot.cursor, events: snapshot.events }
const fold_packet = (snapshot: ActorSnapshot, packet: ServerPacket, now: number): ActorSnapshot => {
  switch (packet.type) {
    case 'packet/characters':
      return { ...snapshot, characters: packet.characters }
    case 'packet/fight_state':
      return fight_state_regresses(snapshot.fight_phases[packet.fight] ?? 0, packet.state.contract)
        ? snapshot
        : { ...snapshot, fights: { ...snapshot.fights, [packet.fight]: packet.state } }
    case 'packet/game_state':
      return { ...snapshot, frozen: packet.frozen }
    case 'packet/server_info': {
      const clock = observe_chain_clock(snapshot.clock, {
        chain_ms: packet.chain_timestamp_ms,
        received_ms: now,
        sample_age_ms: packet.chain_sample_age_ms ?? NaN,
      })
      return { ...snapshot, clock, indexing_lag: packet.indexing_lag }
    }
    default:
      return snapshot
  }
}
export const reduce_actor_snapshot = (
  snapshot: ActorSnapshot,
  state: AgentConnectionState,
  now: number,
  limit: number
): ActorSnapshot => {
  if (['disconnected', 'connecting', 'failed', 'stopped'].includes(state.status))
    return { ...empty_snapshot(), cursor: snapshot.cursor + 1 }
  if (!state.last_packet) return snapshot
  const phase = fight_packet_phase(state.last_packet)
  const fight_phases =
    phase !== null
      ? {
          ...snapshot.fight_phases,
          [phase.fight]: Math.max(snapshot.fight_phases[phase.fight] ?? 0, phase.rank) as FightPhaseRank,
        }
      : snapshot.fight_phases
  const next = fold_packet(
    {
      ...snapshot,
      fight_phases,
      ...fold_actor_world(snapshot, state.last_packet),
      inventory: fold_actor_inventory(snapshot.inventory ?? empty_inventory(), state.last_packet),
    },
    state.last_packet,
    now
  )
  const active_fights = new Set(
    next.characters.flatMap((character) => (character.active_fight ? [character.active_fight.id] : []))
  )
  const fights =
    state.status === 'ready'
      ? Object.fromEntries(Object.entries(next.fights).filter(([id]) => active_fights.has(id)))
      : next.fights
  const ready = [
    state.status === 'ready',
    next.frozen === false,
    next.indexing_lag !== null,
    Number(next.indexing_lag) <= PLAYABLE_INDEXING_LAG,
    next.clock !== null,
    [...active_fights].every(
      (id) => !!fights[id] && !fight_state_regresses(fight_phases[id] ?? 0, fights[id].contract)
    ),
  ].every(Boolean)
  return {
    ...next,
    fights,
    fight_phases: Object.fromEntries(Object.entries(fight_phases).filter(([id]) => active_fights.has(id))),
    ready,
    observed_at: now,
    ...admit_event(snapshot, state.last_packet, limit),
  }
}
export const observation_events = (snapshot: ActorSnapshot, after: unknown, fence: number, supplied_fence: unknown) => {
  if (after === undefined) return snapshot.events
  if (!Number.isSafeInteger(after) || supplied_fence !== fence) throw new Error('needs_resync')
  const cursor = after as number
  const earliest = snapshot.events[0]?.cursor ?? snapshot.cursor
  if (cursor < earliest - 1 || cursor > snapshot.cursor) throw new Error('needs_resync')
  return snapshot.events.filter((event) => event.cursor > cursor)
}

const semantic_snapshot = (value: ActorSnapshot) =>
  JSON.stringify([
    value.inventory,
    value.characters,
    value.fights,
    value.fight_phases,
    value.zones,
    value.tracked_zones,
    value.frozen,
    value.ready,
  ])
export const actor_snapshot_transition = (
  previous: ActorSnapshot,
  state: AgentConnectionState,
  now: number,
  limit: number
) => {
  const snapshot = reduce_actor_snapshot(previous, state, now, limit)
  const previous_ids = new Set(previous.characters.map((character) => character.id))
  return {
    snapshot,
    changed: semantic_snapshot(previous) !== semantic_snapshot(snapshot),
    track_ids:
      state.status === 'ready'
        ? snapshot.characters.filter((character) => !previous_ids.has(character.id)).map((character) => character.id)
        : [],
    resync_fights: Object.keys(snapshot.fight_phases).filter(
      (id) =>
        fight_state_regresses(snapshot.fight_phases[id] ?? 0, snapshot.fights[id]?.contract) &&
        !fight_state_regresses(previous.fight_phases[id] ?? 0, previous.fights[id]?.contract)
    ),
    became_ready: snapshot.ready && !previous.ready,
  }
}
