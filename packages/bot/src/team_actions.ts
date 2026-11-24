// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { worlds_source } from '@aresrpg/engine/data'
import type { HydratedFightCheckpoint } from '@aresrpg/fight'
import type { CharacterRow, FightStateRow } from '@aresrpg/protocol'
import { fight_doors, fight_mode } from '@aresrpg/sdk/fight-doors'

import dungeons from '../../../seed/content/dungeons.json'

import { profession_inventory } from './actor_inventory.ts'
import {
  assert_travel,
  custody_of,
  gameplay_action,
  hydrate_gameplay_fight,
  observed_fight,
  owned_character,
  travel_destination,
  type GameplayContext,
  type GameplayExecutor,
} from './gameplay_context.ts'
import { decode, identifier, nonempty, object_schema } from './gameplay_schema.ts'

type Contract = HydratedFightCheckpoint['contract']
type JoinPayload = Readonly<{ character_id: string; fight: string; checkpoint_id: string; dungeon?: string }>
type RunPayload = Readonly<{ character_id: string; world: string; dungeon: string }>
type EnterPayload = RunPayload & Readonly<{ key_id: string }>
type LeavePayload = Readonly<{ character_id: string; dungeon: string }>
type ForfeitPayload = Readonly<{ character_id: string }>
const run_properties = { character_id: identifier, world: nonempty, dungeon: nonempty }
const join_schema = {
  ...object_schema({ character_id: identifier, fight: identifier, checkpoint_id: nonempty, dungeon: nonempty }),
  required: ['character_id', 'fight', 'checkpoint_id'],
}
const enter_schema = object_schema({ ...run_properties, key_id: identifier })
const room_schema = object_schema(run_properties)
const leave_schema = object_schema({ character_id: identifier, dungeon: nonempty })
const parse_join = (value: unknown) => decode<JoinPayload>(join_schema, value)
const parse_enter = (value: unknown) => decode<EnterPayload>(enter_schema, value)
const parse_room = (value: unknown) => decode<RunPayload>(room_schema, value)
const parse_leave = (value: unknown) => decode<LeavePayload>(leave_schema, value)
const forfeit_schema = object_schema({ character_id: identifier })
const parse_forfeit = (value: unknown) => decode<ForfeitPayload>(forfeit_schema, value)
export const dungeon_content = (slug: string) => {
  const dungeon = dungeons.find((row) => row.dungeon === slug)
  if (!dungeon) throw new Error('dungeon_unavailable')
  return dungeon
}
const dungeon_portal = (world: string, dungeon: string) => {
  const city = worlds_source.find((row) => row.world === world)?.cities.find((row) => row.dungeon === dungeon)
  if (!city) throw new Error('dungeon_unavailable')
  return city
}
/** A hero between rooms of this dungeon: entered, rooted at the portal and held by its kiosk. */
const staged_run = (character: CharacterRow, dungeon: string) => {
  const run = character.dungeon_run
  const staged = [run?.dungeon === dungeon, character.custody === 'kiosk', !character.active_fight].every(Boolean)
  if (!staged) throw new Error('character_not_available')
  return run!
}
/** What manages an observed fight, which decides its lifecycle doors. A dungeon room is playable only
 * by a command that names that dungeon, so only a tree whose owner chose the dungeon can spend a key
 * or act in its rooms. An arena or a match needs no name: its stake was the consent. */
export const supported_fight_mode = (row: FightStateRow, contract: Contract, dungeon?: string) => {
  const mode = fight_mode(contract, { kolizeum: row.kolizeum?.id, tournament: row.tournament })
  const room = mode.type === 'dungeon' ? mode.dungeon : undefined
  if (mode.type === 'unresolved' || room !== dungeon) throw new Error('unsupported_fight_mode')
  return mode
}
/** The lifecycle doors of a fight this wallet's SDK signs for. */
export const doors_of = (sdk: GameplayExecutor, fight: string, mode: ReturnType<typeof supported_fight_mode>) =>
  fight_doors({ fight: sdk, dungeon: sdk.dungeon, kolizeum: sdk.kolizeum, tournament: sdk.tournament }, fight, mode)
/** The side this wallet already fights on, while its placement still admits a public joiner. */
export const joinable_team = (contract: Contract, address: string, character_id: string): bigint | null => {
  const players = contract.fighters.filter((fighter) => fighter.kind.type === 'player' && !fighter.forfeited)
  const teams = new Set(
    players.filter(({ kind }) => kind.type === 'player' && kind.owner === address).map(({ team }) => team)
  )
  const [team] = [...teams]
  if (team === undefined || teams.size !== 1) return null
  const starts = team === 0n ? contract.board.start_cells_a : contract.board.start_cells_b
  const open = [
    contract.round === 0n,
    !contract.ended,
    (team === 0n ? contract.access_a : contract.access_b) === 0n,
    contract.fighters.filter((fighter) => fighter.team === team).length < starts.length,
    !players.some(({ kind }) => kind.type === 'player' && kind.character === character_id),
  ]
  return open.every(Boolean) ? team : null
}
const validate_fight_join = (context: GameplayContext) => {
  const payload = parse_join(context.command.payload)
  const character = owned_character(context, payload.character_id)
  const { row, checkpoint } = observed_fight(payload, context)
  const { contract } = checkpoint
  const mode = supported_fight_mode(row, contract, payload.dungeon)
  const team = joinable_team(contract, context.address, character.id)
  // An arena seat is a wager and a match seat is a registration: each has its own command.
  if (team === null || mode.type === 'kolizeum' || mode.type === 'tournament') throw new Error('fight_not_joinable')
  const input = { fight: payload.fight, character_id: character.id, custody: custody_of(character) }
  if (payload.dungeon) {
    if (staged_run(character, payload.dungeon).room !== Number(contract.dungeon_room))
      throw new Error('fight_not_joinable')
    return { input: { ...input, team: null as number | null } }
  }
  const [x, z] = [Number(contract.x), Number(contract.z)]
  assert_travel(character, contract, x, z, context.snapshot.clock!.chain_ms)
  return { travel: travel_destination(character, x, z), input: { ...input, team: Number(team) as number | null } }
}
const validate_dungeon_enter = (context: GameplayContext) => {
  const payload = parse_enter(context.command.payload)
  const character = owned_character(context, payload.character_id)
  const portal = dungeon_portal(payload.world, payload.dungeon)
  const key = profession_inventory(context.snapshot.inventory, character.kiosk).find(({ id }) => id === payload.key_id)
  if (!key?.version || key.item_type !== dungeon_content(payload.dungeon).key) throw new Error('item_unavailable')
  assert_travel(character, payload, portal.x, portal.z, context.snapshot.clock!.chain_ms)
  return {
    travel: travel_destination(character, portal.x, portal.z),
    input: { ...payload, custody: custody_of(character) },
  }
}
const validate_dungeon_fight = (context: GameplayContext) => {
  const payload = parse_room(context.command.payload)
  const character = owned_character(context, payload.character_id)
  const room = dungeon_content(payload.dungeon).rooms[staged_run(character, payload.dungeon).room - 1]
  if (!room || character.world !== payload.world) throw new Error('dungeon_unavailable')
  return {
    input: {
      ...payload,
      custody: custody_of(character),
      mob_types: room.map(({ mob_type }) => mob_type),
      access: 0 as const,
    },
  }
}
const validate_dungeon_leave = (context: GameplayContext) => {
  const payload = parse_leave(context.command.payload)
  const character = owned_character(context, payload.character_id)
  if (character.dungeon_run?.dungeon !== payload.dungeon) throw new Error('character_not_available')
  const seat = character.active_fight
  return {
    input: {
      character_id: character.id,
      custody: custody_of(character),
      room: seat ? { fight: seat.id, fighter_idx: BigInt(seat.seat) } : null,
    },
  }
}
/** The door follows the fight: a room is given up through its dungeon, which also ends the run, and
 * an arena seat that leaves before the start takes its pledge back. */
const validate_fight_forfeit = (context: GameplayContext) => {
  const payload = parse_forfeit(context.command.payload)
  const character = owned_character(context, payload.character_id)
  const seat = character.active_fight
  const row = seat && context.snapshot.fights[seat.id]
  if (!seat || !row) throw new Error('fight_unavailable')
  const { contract } = hydrate_gameplay_fight(row)
  return {
    input: {
      fight: seat.id,
      fighter_idx: BigInt(seat.seat),
      custody: custody_of(character),
      placement: contract.round === 0n,
      mode: supported_fight_mode(row, contract, contract.dungeon ?? undefined),
    },
  }
}
/** A room fight is joined, given up and left through its dungeon, which also ends the run. */
export const TEAM_ACTIONS = {
  fight_join: gameplay_action({
    description:
      'Join the placement of a supported PvE fight that already seats a character of this wallet, on that side. Name the dungeon to join a room fight of the same dungeon run and room.',
    input_schema: join_schema,
    parse: parse_join,
    validate: validate_fight_join,
    execute: (sdk, { team, ...input }) =>
      team === null ? sdk.dungeon.join_fight(input) : sdk.join({ ...input, team }),
  }),
  dungeon_enter: gameplay_action({
    description:
      'Walk to the dungeon portal of its city, burn one exact owned key and start a run at room 1. The key is never returned.',
    input_schema: enter_schema,
    parse: parse_enter,
    validate: validate_dungeon_enter,
    execute: (sdk, input) => sdk.dungeon.enter(input),
  }),
  dungeon_fight: gameplay_action({
    description:
      'Open the current room fight of an entered dungeon run with its authored mobs, public to the same room.',
    input_schema: room_schema,
    parse: parse_room,
    validate: validate_dungeon_fight,
    execute: (sdk, input) => sdk.dungeon.start_fight(input),
  }),
  dungeon_leave: gameplay_action({
    description:
      'End a dungeon run as a loss: abandon it while staged between rooms, or give up its current room fight.',
    input_schema: leave_schema,
    parse: parse_leave,
    validate: validate_dungeon_leave,
    execute: (sdk, { room, custody, character_id }) =>
      room ? sdk.dungeon.give_up_fight({ ...room, custody }) : sdk.dungeon.abandon({ character_id, custody }),
  }),
  fight_forfeit: gameplay_action({
    description:
      'Give up the fight an owned hero is seated in: the hero loses it and is free again. In a dungeon room this also ends the run, and its key is not returned. In an arena the pledge is lost once the fight has started, and returned before. Use it for a fight that cannot be finished.',
    input_schema: forfeit_schema,
    parse: parse_forfeit,
    validate: validate_fight_forfeit,
    execute: (sdk, { fight, mode, ...seat }) => doors_of(sdk, fight, mode)!.forfeit(seat),
  }),
}
/** The observed state that proves a certified team action took effect. */
export const team_projected = (
  kind: string,
  payload: Readonly<Record<string, unknown>>,
  created_fight: unknown,
  character: CharacterRow
): boolean | undefined => {
  const seated = (fight: unknown) => character.custody === 'fight' && character.active_fight?.id === fight
  const checks: Readonly<Record<string, () => boolean>> = {
    fight_join: () => seated(payload.fight),
    dungeon_fight: () => seated(created_fight),
    dungeon_enter: () => character.dungeon_run?.dungeon === payload.dungeon,
    dungeon_leave: () => !character.dungeon_run && character.custody === 'kiosk' && !character.active_fight,
    fight_forfeit: () => character.custody === 'kiosk' && !character.active_fight,
  }
  return Object.hasOwn(checks, kind) ? checks[kind]!() : undefined
}
