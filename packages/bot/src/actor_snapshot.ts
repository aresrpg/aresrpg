// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { observe_chain_clock, type ChainClock } from '@aresrpg/protocol/chain-clock'
import { fight_packet_phase, fight_state_regresses, type FightPhaseRank } from '@aresrpg/protocol/fight-phase'
import type { AgentConnectionState } from '@aresrpg/sdk/agent-connection'
import {
  PLAYABLE_INDEXING_LAG,
  type CharacterRow,
  type FightStateRow,
  type KolizeumLobbyRow,
  type ServerPacket,
  type TournamentRow,
} from '@aresrpg/protocol'

import { empty_inventory, fold_actor_inventory, type ActorInventory } from './actor_inventory.ts'
import { fold_actor_world, type ActorWorld } from './actor_world.ts'

export type ActorSnapshot = ActorWorld &
  Readonly<{
    inventory?: ActorInventory
    characters: readonly CharacterRow[]
    fights: Readonly<Record<string, FightStateRow>>
    fight_phases: Readonly<Record<string, FightPhaseRank>>
    /** Every Kolizeum lobby the game shows this wallet, as its account stream pushes them. */
    kolizeums: readonly KolizeumLobbyRow[]
    /** Every tournament the game shows this wallet, from the same account stream. */
    tournaments: readonly TournamentRow[]
    clock: ChainClock
    observed_at: number
    ready: boolean
    observation_revision: number
    frozen: boolean | null
    indexing_lag: number | null
  }>
/** BOTAI-1: an arena row reaches the AI client, so only chain facts are kept. Every field is picked by
 * name and every text a player chose (hero, team and event names) is dropped: an unknown field or a
 * name can carry instructions. */
const lobby_facts = (lobby: KolizeumLobbyRow): KolizeumLobbyRow => ({
  id: lobby.id,
  fight: lobby.fight,
  creator: lobby.creator,
  format: lobby.format,
  pledge_mist: lobby.pledge_mist,
  pot_mist: lobby.pot_mist,
  level_min: lobby.level_min,
  level_max: lobby.level_max,
  public: lobby.public,
  can_join: lobby.can_join,
  status: lobby.status,
  fighters: (lobby.fighters ?? []).map(({ seat, team, character_id, classe, level, settled }) => ({
    seat,
    team,
    character_id,
    name: '',
    classe,
    level,
    settled,
  })),
})
const tournament_facts = (row: TournamentRow): TournamentRow => ({
  id: row.id,
  version: row.version,
  name: '',
  status: row.status,
  finished_at_ms: row.finished_at_ms,
  organizer: row.organizer,
  format: row.format,
  start_before_ms: row.start_before_ms,
  entry_fee_mist: row.entry_fee_mist,
  max_level: row.max_level,
  sui_bps: row.sui_bps,
  token_bps: row.token_bps,
  sui_pool: row.sui_pool,
  kares_pool: row.kares_pool,
  token_version: row.token_version,
  token_refunded: row.token_refunded,
  token_pool: row.token_pool,
  sui_total: row.sui_total,
  token_total: row.token_total,
  rewards: (row.rewards ?? []).map(({ place, template, amount }) => ({ place, template, amount })),
  teams: (row.teams ?? []).map((team) => ({
    name: '',
    revision: team.revision,
    allowed: team.allowed,
    place: team.place,
    seats: team.seats.map(({ character, owner, sui_claimed, token_claimed, items_claimed }) => ({
      character,
      owner,
      sui_claimed,
      token_claimed,
      items_claimed,
    })),
  })),
  matches: (row.matches ?? []).map((match) => ({
    a: match.a,
    b: match.b,
    available_ms: match.available_ms,
    state: match.state,
    winner: match.winner,
    loser: match.loser,
    fight: match.fight,
    phase: match.phase,
    joined: match.joined,
    fight_winner: match.fight_winner,
  })),
})
export const empty_snapshot = (): ActorSnapshot => ({
  inventory: empty_inventory(),
  characters: [],
  fights: {},
  fight_phases: {},
  kolizeums: [],
  tournaments: [],
  zones: {},
  tracked_zones: {},
  clock: null,
  observed_at: 0,
  ready: false,
  observation_revision: 0,
  frozen: null,
  indexing_lag: null,
})
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
    case 'packet/kolizeums':
      return { ...snapshot, kolizeums: packet.lobbies.map(lobby_facts) }
    case 'packet/tournaments':
      return { ...snapshot, tournaments: packet.tournaments.map(tournament_facts) }
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
  now: number
): ActorSnapshot => {
  if (['disconnected', 'connecting', 'failed', 'stopped'].includes(state.status)) return empty_snapshot()
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
  }
}
const semantic_snapshot = (value: ActorSnapshot) =>
  JSON.stringify([
    value.inventory,
    value.characters,
    value.fights,
    value.fight_phases,
    value.kolizeums,
    value.tournaments,
    value.zones,
    value.tracked_zones,
    value.frozen,
    value.ready,
  ])
export const actor_snapshot_transition = (previous: ActorSnapshot, state: AgentConnectionState, now: number) => {
  const snapshot = reduce_actor_snapshot(previous, state, now)
  return {
    snapshot,
    changed: semantic_snapshot(previous) !== semantic_snapshot(snapshot),
    resync_fights: Object.keys(snapshot.fight_phases).filter(
      (id) =>
        fight_state_regresses(snapshot.fight_phases[id] ?? 0, snapshot.fights[id]?.contract) &&
        !fight_state_regresses(previous.fight_phases[id] ?? 0, previous.fights[id]?.contract)
    ),
    became_ready: snapshot.ready && !previous.ready,
  }
}
