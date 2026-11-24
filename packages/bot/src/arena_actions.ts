// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Arenas: Kolizeum lobbies, where a seat is a wager, and tournaments, where it is a registration. The
// game already pushes both to every seated wallet. The bot reads them here, stakes only through a
// command that names the exact pledge, and takes its tournament actions from the rules the game
// client plays by (`@aresrpg/protocol/tournament-rules`): it decides nothing of its own.
import type { CharacterRow, TournamentRow } from '@aresrpg/protocol'
import { kolizeum_joinable } from '@aresrpg/protocol/kolizeum'
import {
  tournament_next_action,
  type TournamentAction,
  type TournamentViewer,
} from '@aresrpg/protocol/tournament-rules'
import { run_tournament_action } from '@aresrpg/sdk/tournament-play'

import type { ActorSnapshot } from './actor_snapshot.ts'
import {
  custody_of,
  gameplay_action,
  gameplay_observation_ready,
  gameplay_observed_ms,
  owned_character,
  type GameplayContext,
} from './gameplay_context.ts'
import { decimal, decode, identifier, object_schema } from './gameplay_schema.ts'

type JoinPayload = Readonly<{ character_id: string; kolizeum: string; side: 0 | 1; pledge_mist: string }>
const join_schema = object_schema({
  character_id: identifier,
  kolizeum: identifier,
  side: { type: 'integer', minimum: 0, maximum: 1 },
  pledge_mist: decimal,
})
const parse_join = (value: unknown) => decode<JoinPayload>(join_schema, value)
/** A hero that holds no seat, run or ambush anywhere: the only one that may take an arena seat. */
const free = (character: CharacterRow) =>
  [!character.active_fight, !character.ambush, !character.dungeon_run].every(Boolean)
/** The stake is the one the command reviewed: a lobby whose pledge differs is another wager. */
const validate_kolizeum_join = (context: GameplayContext) => {
  const payload = parse_join(context.command.payload)
  const character = owned_character(context, payload.character_id)
  const lobby = context.snapshot.kolizeums.find(({ id }) => id === payload.kolizeum)
  if (!lobby || !free(character) || !kolizeum_joinable(lobby, character, payload.side))
    throw new Error('fight_not_joinable')
  if (lobby.pledge_mist !== payload.pledge_mist) throw new Error('pledge_changed')
  return {
    input: {
      kolizeum: lobby.id,
      fight: lobby.fight,
      pledge_mist: BigInt(lobby.pledge_mist),
      side: payload.side,
      character_id: character.id,
      custody: custody_of(character),
    },
  }
}
type StepPayload = Readonly<{
  character_id: string
  tournament: string
  max_entry_fee_mist: string
  confirm?: boolean
}>
const step_schema = {
  ...object_schema({
    character_id: identifier,
    tournament: identifier,
    max_entry_fee_mist: decimal,
    confirm: { type: 'boolean' },
  }),
  required: ['character_id', 'tournament', 'max_entry_fee_mist'],
}
const parse_step = (value: unknown) => decode<StepPayload>(step_schema, value)
/** The wallet as the tournament rules see it: this hero first, on the chain's own clock. */
const viewer_of = (context: GameplayContext, character: CharacterRow | null): TournamentViewer => {
  const ready = gameplay_observation_ready(context)
  return {
    address: context.address,
    character,
    characters: context.snapshot.characters,
    now_ms: ready ? Number(gameplay_observed_ms(context)) : null,
    observed_ms: ready ? context.snapshot.clock!.chain_ms : null,
  }
}
/** The one action the rules offer now: a write, or the first prize still owed. */
const offered = (row: TournamentRow, viewer: TournamentViewer) => {
  const next = tournament_next_action(row, viewer)
  if (next.kind === 'write') return { action: next.action, confirm: next.confirm }
  return next.kind === 'claims' ? { action: next.actions[0]!, confirm: false } : null
}
/** Registration is the only tournament action that pays more than gas. */
const pays_entry = (action: TournamentAction) => ['find', 'join', 'create'].includes(action.kind)
const validate_tournament_step = (context: GameplayContext) => {
  const payload = parse_step(context.command.payload)
  const character = owned_character(context, payload.character_id)
  const row = context.snapshot.tournaments.find(({ id }) => id === payload.tournament)
  const step = row && offered(row, viewer_of(context, character))
  if (!row || !step) throw new Error('tournament_idle')
  // Ending a match with no winner is final for both teams: only an explicit command does it.
  if (step.confirm && !payload.confirm) throw new Error('tournament_confirm_required')
  if (pays_entry(step.action) && BigInt(row.entry_fee_mist) > BigInt(payload.max_entry_fee_mist))
    throw new Error('entry_fee_too_high')
  const actor = 'character' in step.action ? owned_character(context, step.action.character) : null
  const hero = actor ? { name: actor.name, custody: custody_of(actor) } : undefined
  return { input: { row, action: step.action, address: context.address, hero } }
}
export const tournament_version = (snapshot: ActorSnapshot, tournament: unknown): string | undefined =>
  snapshot.tournaments.find(({ id }) => id === tournament)?.version
export const ARENA_ACTIONS = {
  tournament_step: gameplay_action({
    description:
      'Take the one action the tournament rules offer an owned hero now, as bot_arenas shows it in next: register it (join the open team that fits, or found one named after the hero), add it to the wallet team, open or join its match during the admission window, record a finished match, start or expire the event, or claim a prize. Registration pays the event entry fee and is refused above max_entry_fee_mist; every other action costs only gas. Ending a timed-out match with no winner needs confirm: true. With nothing to do it fails with tournament_idle, so a tree puts it before its combat leaf: a call leaf of this kind, then combat, then wait. The seated match is played by the ordinary fight commands or the combat leaf.',
    input_schema: step_schema,
    parse: parse_step,
    validate: validate_tournament_step,
    execute: (sdk, { row, action, ...by }) => run_tournament_action(sdk.tournament, row, action, by),
  }),
  kolizeum_join: gameplay_action({
    description:
      'Stake the exact pledge of an open Kolizeum lobby and seat an owned kiosk-held hero on one of its sides. pledge_mist must equal the lobby pledge read in bot_arenas, or the command is refused. The pledge leaves the wallet now; the winners share the pot less the Kolizeum cut. The hero then plays through the ordinary fight commands or its combat leaf, and fight_forfeit before the start returns the pledge.',
    input_schema: join_schema,
    parse: parse_join,
    validate: validate_kolizeum_join,
    execute: (sdk, input) => sdk.kolizeum.join(input),
  }),
}
/** The observed state that proves a certified arena action took effect. */
export const arena_projected = (kind: string, character: CharacterRow): boolean | undefined =>
  kind === 'kolizeum_join' ? character.custody === 'fight' && Boolean(character.active_fight) : undefined
/** The arenas view: every lobby this wallet may see, and each tournament with what the rules offer each hero. */
export const arenas_view = (context: GameplayContext) => {
  const { kolizeums, tournaments, characters } = context.snapshot
  return {
    kolizeums,
    tournaments: tournaments.map((row) => ({
      id: row.id,
      status: row.status,
      format: row.format,
      start_before_ms: row.start_before_ms,
      entry_fee_mist: row.entry_fee_mist,
      max_level: row.max_level,
      teams: row.teams.length,
      matches: row.matches.length,
      sui_pool: row.sui_pool,
      token_pool: row.token_pool,
      next: characters.map((character) => ({
        character_id: character.id,
        ...tournament_next_action(row, viewer_of(context, character)),
      })),
    })),
  }
}
