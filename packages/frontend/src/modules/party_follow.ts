// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Effect-only client automation. Party owns the toggle fact; this module advances the external
// presentation feed, emits existing position intents, and composes existing fight join doors.

import { client_to_chain_coordinate } from '@aresrpg/immutable'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'
import type { CharacterRow, FightRow, PartyRow } from '@aresrpg/protocol'

import {
  PARTY_FOLLOW_JOIN_DISTANCE,
  read_party_follow,
  subscribe_party_follow,
  update_party_follow,
  type PartyFollowPoint,
  type PartyFollowSnapshot,
} from '../game/core/party_follow_feed.ts'
import { clear_owned_character_positions, owned_character_position } from '../game/core/owned_character_feed.ts'
import { pose_matches_character, read_pose } from '../game/core/pose_feed.ts'
import type { AppModule, AppState } from '../store.ts'
import { toast } from '../toast.ts'

import { selected_party } from './party.ts'
import { character_custody } from './session.ts'

const FOLLOW_TICK_MS = 100
type FightContract = HydratedFightCheckpoint['contract']
type FightFighter = FightContract['fighters'][number]

const available_follower = (character: Readonly<CharacterRow>): boolean =>
  character.custody === 'kiosk' && !character.active_fight && !character.dungeon_run && !character.ambush

const belongs_behind_leader = (
  character: Readonly<CharacterRow>,
  leader: Readonly<CharacterRow>,
  members: ReadonlySet<string>,
  controlled: string | null
): boolean =>
  character.id !== leader.id &&
  character.id !== controlled &&
  members.has(character.id) &&
  character.world === leader.world

const follows_character =
  (leader: Readonly<CharacterRow>, members: ReadonlySet<string>, controlled: string | null) =>
  (character: Readonly<CharacterRow>): boolean =>
    belongs_behind_leader(character, leader, members, controlled) && available_follower(character)

const follow_leader = (state: Readonly<AppState>, party: Readonly<PartyRow>): CharacterRow | null => {
  const leader_id = party.members[0]?.character_id
  if (!leader_id) return null
  const leader = state.session.characters.find(({ id }) => id === leader_id)
  return leader?.world ? leader : null
}

export const active_party_follow = (
  state: Readonly<AppState>
): Readonly<{ party: PartyRow; leader: CharacterRow; followers: readonly CharacterRow[] }> | null => {
  const party = state.settings.follow_leader === true ? selected_party(state) : null
  if (!party) return null
  const leader = follow_leader(state, party)
  if (!leader) return null
  const members = new Set(party.members.map(({ character_id }) => character_id))
  const followers = state.session.characters.filter(
    follows_character(leader, members, state.session.selected_character_id)
  )
  return Object.freeze({ party, leader, followers: Object.freeze(followers) })
}

const fighter_character = (fighter: Readonly<FightFighter>): string | null =>
  fighter.kind.type === 'player' ? fighter.kind.character : null

const player_characters = (contract: Readonly<FightContract>): ReadonlySet<string> =>
  new Set(contract.fighters.flatMap((fighter) => fighter_character(fighter) ?? []))

const leader_side = (
  contract: Readonly<FightContract>,
  leader_id: string
): Readonly<{ fighter: FightFighter; team: number; access: bigint; starts: readonly bigint[] }> | null => {
  const fighter = contract.fighters.find((candidate) => fighter_character(candidate) === leader_id)
  if (!fighter) return null
  const team = Number(fighter.team)
  const access = [contract.access_a, contract.access_b][team]
  const starts = [contract.board.start_cells_a, contract.board.start_cells_b][team]
  if ((access !== 0n && access !== 1n) || !starts) return null
  return Object.freeze({ fighter, team, access, starts })
}

const followers_at_leader = (
  followers: readonly CharacterRow[],
  seated: ReadonlySet<string>,
  reserved: ReadonlySet<string>,
  positions: PartyFollowSnapshot
): readonly CharacterRow[] => {
  const waiting = followers.filter(({ id }) => !seated.has(id) && !reserved.has(id))
  const distances = new Map(positions.followers.map((row) => [row.character_id, row.distance]))
  return waiting.filter(({ id }) => (distances.get(id) ?? Infinity) <= PARTY_FOLLOW_JOIN_DISTANCE)
}

const placement_checkpoint = (state: Readonly<AppState>, fight_id: string): HydratedFightCheckpoint | null => {
  const checkpoint = state.fight.cached[fight_id]
  return checkpoint && checkpoint.contract.round === 0n && !checkpoint.contract.ended ? checkpoint : null
}

const snapshot_matches_follow = (
  positions: Readonly<PartyFollowSnapshot>,
  follow: NonNullable<ReturnType<typeof active_party_follow>>
): boolean => positions.party_id === follow.party.id && positions.leader_id === follow.leader.id

const occupied_player_seats = (
  contract: Readonly<FightContract>,
  team: bigint,
  seated: ReadonlySet<string>,
  reserved: ReadonlySet<string>
): number =>
  contract.fighters.filter((fighter) => fighter.team === team && fighter_character(fighter) !== null).length +
  [...reserved].filter((character) => !seated.has(character)).length

export const party_follow_join_plan = (
  state: Readonly<AppState>,
  fight_id: string,
  positions: Readonly<PartyFollowSnapshot>,
  reserved: ReadonlySet<string> = new Set()
): Readonly<{
  fight: string
  team: number
  party?: string
  followers: readonly CharacterRow[]
}> | null => {
  const follow = active_party_follow(state)
  const checkpoint = placement_checkpoint(state, fight_id)
  if (!follow || !checkpoint) return null
  if (!snapshot_matches_follow(positions, follow)) return null
  const side = leader_side(checkpoint.contract, follow.leader.id)
  if (!side) return null
  const seated = player_characters(checkpoint.contract)
  const waiting = followers_at_leader(follow.followers, seated, reserved, positions)
  const occupied = occupied_player_seats(checkpoint.contract, side.fighter.team, seated, reserved)
  const followers = waiting.slice(0, Math.max(0, side.starts.length - occupied))
  if (followers.length === 0) return null
  return Object.freeze({
    fight: fight_id,
    team: side.team,
    ...(side.access === 1n ? { party: follow.party.id } : {}),
    followers: Object.freeze(followers),
  })
}

const finite_character_point = (character: Readonly<CharacterRow>): PartyFollowPoint | null =>
  typeof character.x === 'number' &&
  Number.isFinite(character.x) &&
  typeof character.z === 'number' &&
  Number.isFinite(character.z)
    ? Object.freeze({ x: character.x, y: 0, z: character.z })
    : null

const finite_fight_point = (fight: Readonly<FightRow> | null, world: string): PartyFollowPoint | null =>
  fight?.world === world && Number.isFinite(fight.x) && Number.isFinite(fight.z)
    ? Object.freeze({ x: fight.x, y: 0, z: fight.z })
    : null

export const party_follow_leader_target = (
  leader: Readonly<CharacterRow>,
  pose: ReturnType<typeof read_pose>,
  fight: Readonly<FightRow> | null = null
): PartyFollowPoint | null => {
  if (pose_matches_character(pose, leader.id))
    return Object.freeze({
      x: client_to_chain_coordinate(pose.x),
      y: pose.y,
      z: client_to_chain_coordinate(pose.z),
    })
  if (!leader.world) return null
  const live = owned_character_position(leader.id, leader.world)
  if (live) return Object.freeze({ x: live.x, y: live.y, z: live.z })
  return finite_fight_point(fight, leader.world) ?? finite_character_point(leader)
}

const follow_feed_input = (state: Readonly<AppState>) => {
  const follow = state.session.link_status === 'ready' ? active_party_follow(state) : null
  if (!follow) return null
  // Entering a fight deliberately clears the overworld pose. The owned-position feed retains
  // the leader's last accepted world point, so followers keep approaching that sword instead
  // of treating an unknown target as zero metres away and remaining at their chain spawn.
  const fight_id = follow.leader.active_fight?.id
  const fight = fight_id ? (state.world.all_fights[fight_id] ?? state.world.fights[fight_id] ?? null) : null
  const target = party_follow_leader_target(follow.leader, read_pose(), fight)
  const followers = follow.followers.flatMap((character) =>
    Number.isFinite(character.x) && Number.isFinite(character.z)
      ? [Object.freeze({ character_id: character.id, x: character.x!, y: target?.y ?? 0, z: character.z! })]
      : []
  )
  return Object.freeze({
    party_id: follow.party.id,
    leader_id: follow.leader.id,
    world: follow.leader.world!,
    ...(target ? { target } : {}),
    followers: Object.freeze(followers),
  })
}

const custody_groups = (characters: readonly CharacterRow[]): readonly (readonly CharacterRow[])[] => {
  const groups = new Map<string, CharacterRow[]>()
  characters.forEach((character) => {
    const key = `${character.kiosk}:${character.kiosk_cap ?? ''}`
    groups.set(key, [...(groups.get(key) ?? []), character])
  })
  return Object.freeze([...groups.values()].map((group) => Object.freeze(group)))
}

const auto_fight_expired = (state: Readonly<AppState>, fight: string): boolean => {
  const checkpoint = state.fight.cached[fight]
  return !active_party_follow(state) || checkpoint?.contract.ended === true || (checkpoint?.contract.round ?? 0n) > 0n
}

export const party_leader_engaged = (state: Readonly<AppState>, character_id: string): boolean =>
  active_party_follow(state)?.leader.id === character_id

const join_followers = (
  wallet: NonNullable<AppState['session']['wallet']>,
  plan: NonNullable<ReturnType<typeof party_follow_join_plan>>,
  characters: readonly CharacterRow[]
) =>
  wallet.fight.join_many({
    fight: plan.fight,
    character_ids: Object.freeze(characters.map(({ id }) => id)),
    custody: character_custody(characters[0]!),
    team: plan.team,
    ...(plan.party ? { party: plan.party } : {}),
  })

export const observe_party_follow: NonNullable<AppModule['observe']> = ({ events, get_state, dispatch, signal }) => {
  const auto_fights = new Set<string>()
  const joining_fights = new Set<string>()
  const reserved_followers = new Map<string, Set<string>>()

  const try_auto_join = (fight: string): void => {
    if (joining_fights.has(fight)) return
    const state = get_state()
    const reserved = reserved_followers.get(fight) ?? new Set<string>()
    const plan = party_follow_join_plan(state, fight, read_party_follow(), reserved)
    if (!plan) {
      if (auto_fight_expired(state, fight)) {
        auto_fights.delete(fight)
        reserved_followers.delete(fight)
      }
      return
    }
    const { wallet } = state.session
    if (!wallet) return
    joining_fights.add(fight)
    plan.followers.forEach(({ id }) => reserved.add(id))
    reserved_followers.set(fight, reserved)
    void Promise.all(custody_groups(plan.followers).map((characters) => join_followers(wallet, plan, characters)))
      .then(() =>
        plan.followers.forEach((character) => dispatch({ type: 'fight/watch', character_id: character.id, fight }))
      )
      .catch((error: unknown) => {
        plan.followers.forEach(({ id }) => reserved.delete(id))
        auto_fights.delete(fight)
        if (get_state().session.wallet === wallet) toast.add(error)
      })
      .finally(() => joining_fights.delete(fight))
  }
  const try_auto_fights = (): void => auto_fights.forEach(try_auto_join)
  const tick = (): void => {
    const snapshot = update_party_follow(follow_feed_input(get_state()))
    snapshot.followers.forEach((follower) =>
      dispatch({
        type: 'party/follower_moved',
        character_id: follower.character_id,
        x: follower.x,
        y: follower.y,
        z: follower.z,
      })
    )
  }
  const timer = setInterval(tick, FOLLOW_TICK_MS)

  events.on('world/engage_submitted', ({ fight, character_id }) => {
    const state = get_state()
    // The selected tab may have changed while the engage transaction was confirming. The actor
    // captured at submission is the stable fact: remember the fight even when the only follower
    // is temporarily controlled, then join it after control returns and it reaches the leader.
    if (!party_leader_engaged(state, character_id)) return
    auto_fights.add(fight)
    try_auto_join(fight)
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.session.link_status !== 'ready' && previous.session.link_status === 'ready') {
      update_party_follow(null)
      clear_owned_character_positions()
    }
    if (
      auto_fights.size > 0 &&
      (state.fight.cached !== previous.fight.cached ||
        state.party !== previous.party ||
        state.settings.follow_leader !== previous.settings.follow_leader ||
        state.session.characters !== previous.session.characters)
    )
      try_auto_fights()
  })
  const unsubscribe = subscribe_party_follow(try_auto_fights)
  signal.addEventListener('abort', () => {
    clearInterval(timer)
    unsubscribe()
    update_party_follow(null)
    auto_fights.clear()
    joining_fights.clear()
    reserved_followers.clear()
  })
}

const party_follow_module: AppModule = Object.freeze({ name: 'party_follow', observe: observe_party_follow })
export default party_follow_module
