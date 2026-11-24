// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Arenas: a Kolizeum seat is a wager, and arena and tournament fights are played like any other.
// Owner 2026-11-24.
import { expect, test } from 'bun:test'
import type { CharacterRow, FightStateRow, KolizeumLobbyRow, TournamentRow } from '@aresrpg/protocol'

import dungeons from '../../../seed/content/dungeons.json'
import { id } from '../../sdk/test/helpers/transport.ts'
import { arenas_view, tournament_version } from '../src/arena_actions.ts'
import { next_combat_action } from '../src/combat_plan.ts'
import { fight_checkpoint_id, type GameplayContext } from '../src/gameplay_context.ts'

import { fixture_bot } from './fixture.ts'
import {
  fighter as character,
  fight_character_id as character_id,
  fight_context,
  fight_id,
  placement,
  strike_profile as profile,
  started_fight as started,
} from './fixture_fight.ts'
import { plan_of } from './fixture_game.ts'

const ally_id = id(77)
const now = 63_000
const [dungeon] = dungeons
const context_of = (checkpoint: ReturnType<typeof placement>, characters: readonly CharacterRow[], chain_ms = now) =>
  fight_context(checkpoint, characters, now, chain_ms)
const plan = (context: GameplayContext, action: Readonly<{ kind: string; payload: object }>) =>
  plan_of({ ...context, command: { ...context.command, ...action } as GameplayContext['command'] })
const free = (patch: Partial<CharacterRow> = {}): CharacterRow => ({
  ...character(),
  id: ally_id,
  custody: 'kiosk',
  active_fight: undefined,
  ...patch,
})
/** A rival of another wallet seated on the other side. */
const with_rival = (checkpoint: ReturnType<typeof placement>) => {
  const seat = structuredClone(checkpoint.contract.fighters[0]!)
  if (seat.kind.type !== 'player') throw new Error('invalid fixture')
  Object.assign(seat.kind, { character: ally_id, owner: id(5) })
  checkpoint.contract.fighters.push(Object.assign(seat, { team: 1n, ready: false }))
  checkpoint.sources.players[ally_id] = structuredClone(checkpoint.sources.players[character_id]!)
  return checkpoint
}

test('an arena seat is a reviewed wager, and arena and match fights use their own doors', () => {
  const lobby_id = id(88)
  const lobby: KolizeumLobbyRow = {
    id: lobby_id,
    fight: fight_id,
    creator: id(5),
    format: 1,
    pledge_mist: '500000000',
    pot_mist: '500000000',
    level_min: 1,
    level_max: 200,
    public: true,
    can_join: true,
    status: 'open',
    fighters: [{ seat: 0, team: 0, character_id: id(6), name: 'rival', classe: 'ikari', level: 12, settled: false }],
  }
  const lobbies = (heroes: readonly CharacterRow[]): GameplayContext => {
    const context = context_of(placement(), heroes)
    return { ...context, snapshot: { ...context.snapshot, kolizeums: [lobby] } }
  }
  const join = (patch: object = {}) => ({
    kind: 'kolizeum_join',
    payload: { character_id: ally_id, kolizeum: lobby_id, side: 1, pledge_mist: '500000000', ...patch },
  })
  expect(plan(lobbies([free()]), join())).toMatchObject({
    input: { kolizeum: lobby_id, fight: fight_id, pledge_mist: 500_000_000n, side: 1, character_id: ally_id },
  })
  // The stake is the one the command read: another pledge is another wager.
  expect(() => plan(lobbies([free()]), join({ pledge_mist: '400000000' }))).toThrow('pledge_changed')
  expect(() => plan(lobbies([free()]), join({ side: 0 }))).toThrow('fight_not_joinable')
  const raiding = free({ dungeon_run: { dungeon: dungeon!.dungeon, room: 1 } })
  expect(() => plan(lobbies([raiding]), join())).toThrow('fight_not_joinable')
  // A seated arena fight: door policy 31 reads as managed and wagered, and its lobby rides the fight row.
  const managed_by = (context: GameplayContext, manager: Partial<FightStateRow>): GameplayContext => ({
    ...context,
    snapshot: {
      ...context.snapshot,
      fights: { [fight_id]: { ...context.snapshot.fights[fight_id]!, ...manager } },
    },
  })
  const arena = started()
  Object.assign(arena.contract, { managed: true, wagered: true })
  const manager = { kolizeum: { id: lobby_id, pledge_mist: lobby.pledge_mist } }
  const seated = managed_by(context_of(arena, [character()]), manager)
  const intent = { fight: fight_id, profiles: [{ character_id, revision: 1, profile }] }
  expect(next_combat_action(intent, seated).action).toMatchObject({ kind: 'fight_turn' })
  const forfeit = { kind: 'fight_forfeit', payload: { character_id } }
  expect(plan(seated, forfeit)).toMatchObject({
    input: { placement: false, mode: { type: 'kolizeum', kolizeum: lobby_id } },
  })
  // Until its lobby row arrives no door is safe to pick.
  expect(() => next_combat_action(intent, context_of(arena, [character()]))).toThrow('unsupported_fight_mode')
  const match = managed_by(context_of(arena, [character()]), { tournament: { id: id(70), index: 3 } })
  expect(plan(match, forfeit)).toMatchObject({
    input: { mode: { type: 'tournament', tournament: id(70), index: 3 } },
  })
  // An arena's clock is unarmed until the lobby is full: a ready hero waits for its rival, however late.
  const filling = with_rival(placement())
  Object.assign(filling.contract, { managed: true, wagered: true, placement_ms: 0n })
  filling.contract.fighters[0]!.ready = true
  const waiting = managed_by(context_of(filling, [character()], 10_000_000), manager)
  expect(next_combat_action(intent, waiting)).toEqual({ state: 'waiting' })
  const before_start = plan(waiting, forfeit)
  expect(before_start).toMatchObject({ input: { placement: true, mode: { type: 'kolizeum' } } })
})

test('a tournament step takes the action the shared rules offer, and pays no more than the fee it named', () => {
  const cup = id(90)
  const seat = (hero: string, owner: string) => ({
    character: hero,
    owner,
    sui_claimed: false,
    token_claimed: false,
    items_claimed: '0',
  })
  const team = (name: string, hero: string, owner: string) => ({
    name,
    revision: '1',
    allowed: [],
    seats: [seat(hero, owner)],
    place: 0,
  })
  const open: TournamentRow = {
    id: cup,
    version: '4',
    name: 'Cup',
    status: 'open',
    organizer: id(5),
    format: 1,
    start_before_ms: 10_000_000,
    entry_fee_mist: '100000000',
    max_level: null,
    sui_bps: [10_000, 0, 0, 0, 0],
    token_bps: [0, 0, 0, 0, 0],
    sui_pool: '0',
    kares_pool: null,
    token_version: '0',
    token_refunded: false,
    token_pool: '0',
    sui_total: '0',
    token_total: '0',
    rewards: [],
    teams: [],
    matches: [],
  }
  const observing = (row: TournamentRow, heroes: readonly CharacterRow[]): GameplayContext => {
    const context = context_of(placement(), heroes)
    return { ...context, snapshot: { ...context.snapshot, tournaments: [row] } }
  }
  const step = (patch: object = {}) => ({
    kind: 'tournament_step',
    payload: { character_id: ally_id, tournament: cup, max_entry_fee_mist: '100000000', ...patch },
  })
  // Registration: the rules offer a free kiosk-held hero the open team that fits, or a team of its own.
  const registering = observing(open, [free()])
  expect(plan(registering, step())).toMatchObject({
    input: {
      action: { kind: 'find', character: ally_id },
      address: fixture_bot.address,
      hero: { name: free().name },
      row: { id: cup, entry_fee_mist: '100000000' },
    },
  })
  expect(() => plan(registering, step({ max_entry_fee_mist: '99999999' }))).toThrow('entry_fee_too_high')
  expect(arenas_view(registering).tournaments[0]).toMatchObject({
    id: cup,
    entry_fee_mist: '100000000',
    next: [{ character_id: ally_id, kind: 'write', name: 'find' }],
  })
  // A hero seated in a fight cannot register, and an unknown event offers nothing.
  expect(() => plan(observing(open, [character()]), step({ character_id }))).toThrow('tournament_idle')
  expect(() => plan(registering, step({ tournament: id(91) }))).toThrow('tournament_idle')
  // Admission: once its match is available the registered hero opens it, with only gas to pay.
  const rival = team('Rivals', id(6), id(5))
  const running: TournamentRow = {
    ...open,
    version: '9',
    status: 'in_progress',
    teams: [team('Ours', ally_id, fixture_bot.address), rival],
    matches: [{ a: 0, b: 1, available_ms: 60_000, state: 1, winner: null, loser: null, fight: null }],
  }
  const admitted = observing(running, [free()])
  expect(plan(admitted, step({ max_entry_fee_mist: '0' })).input.action).toEqual({
    kind: 'enter',
    index: 0,
    character: ally_id,
  })
  // The match is over and nothing is owed: the step fails so a tree moves on to its next leaf.
  const lost: TournamentRow = { ...running, status: 'finished', teams: [{ ...running.teams[0]!, place: 0 }, rival] }
  expect(() => plan(observing(lost, [free()]), step())).toThrow('tournament_idle')
  // A step is proven by its row moving past the version it read.
  expect([tournament_version(registering.snapshot, cup), tournament_version(admitted.snapshot, cup)]).toEqual([
    '4',
    '9',
  ])
})
