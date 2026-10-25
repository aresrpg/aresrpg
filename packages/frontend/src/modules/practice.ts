// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { player_max_hp, type PlayerSource } from '@aresrpg/fight'

import type { AppInput, AppModule, AppState } from '../store.ts'
import { catalog_spell_sources } from '../content/fight_sources.ts'
import { practice_roster, type PracticeEntrant } from '../practice/roster.ts'
import { advance_practice, next_practice_match, practice_bracket, type PracticeMatch } from '../practice/bracket.ts'
import { practice_bot_input } from '../practice/policy.ts'

import { simulator_board } from './simulator.ts'

export type PracticeState = Readonly<{
  seed: bigint
  entrants: readonly PracticeEntrant[]
  matches: readonly PracticeMatch[]
  active: number | null
}>
export type PracticeInput =
  | Readonly<{ type: 'practice/start'; source: PlayerSource; seed: bigint }>
  | Readonly<{ type: 'practice/next' }>
  | Readonly<{ type: 'practice/completed'; won: boolean }>

export const initial_practice_state = (): PracticeState => ({ seed: 0n, entrants: [], matches: [], active: null })

const transition = (state: PracticeState, input: PracticeInput): PracticeState => {
  if ((state.active !== null) !== (input.type === 'practice/completed')) return state
  switch (input.type) {
    case 'practice/start':
      return {
        seed: input.seed,
        entrants: practice_roster(input.source, input.seed),
        matches: advance_practice(practice_bracket(input.seed), input.seed),
        active: null,
      }
    case 'practice/next': {
      const active = next_practice_match(state.matches)
      return active < 0 ? state : { ...state, active }
    }
    case 'practice/completed': {
      const match = state.matches[state.active!]!
      const opponent = match.a === 0 ? match.b : match.a
      const matches = state.matches.map((row, index) =>
        index === state.active ? { ...row, done: true, winner: input.won ? 0 : opponent } : row
      )
      return { ...state, active: null, matches: advance_practice(matches, state.seed) }
    }
  }
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (!input.type.startsWith('practice/')) return state
  const practice = transition(state.practice, input as PracticeInput)
  return practice === state.practice ? state : { ...state, practice }
}

export const practice_setup = (practice: Readonly<PracticeState>) => {
  const match = practice.matches[practice.active!]!
  const opponent = (match.a === 0 ? match.b : match.a)!
  return {
    fight_id: `practice_${practice.seed}_${practice.active}`,
    board: simulator_board({
      seed: practice.seed + BigInt(practice.active!),
      characters: [],
      character_placements: {},
      mob_placements: {},
    }),
    players: [0, opponent].map((index, team) => {
      const { id, source } = practice.entrants[index]!
      return {
        character: id,
        owner: team === 0 ? 'local' : 'practice_bot',
        team: BigInt(team),
        ready: true,
        hp: player_max_hp(source),
        source,
      }
    }),
    mobs: [],
    spells: Object.fromEntries(
      Object.entries(catalog_spell_sources()).filter(([, spell]) =>
        [practice.entrants[0]!, practice.entrants[opponent]!].some(
          ({ source }) => spell.classe === source.classe && spell.unlock_level <= source.level
        )
      )
    ),
  }
}

const observe = ({ events, dispatch }: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.practice.active === null) return
    if (previous.practice.active === null) {
      dispatch({
        type: 'fight/opened',
        mode: 'local',
        setup: practice_setup(state.practice),
        seed: state.practice.seed,
      })
    }
    if (previous.fight.mounted && !state.fight.mounted)
      dispatch({ type: 'practice/completed', won: previous.fight.checkpoint?.contract.winner === 0n })
  })
  events.on('STATE_UPDATED', (state, previous) => {
    const { fight } = state
    const idle = [
      state.practice.active !== null,
      fight !== previous.fight,
      fight.mode === 'local',
      fight.presentations.length === 0,
      fight.error === null,
    ].every(Boolean)
    if (!idle || !fight.checkpoint) return
    const input =
      fight.checkpoint.contract.round === 0n ? { type: 'start' as const } : practice_bot_input(fight.checkpoint)
    if (input) dispatch({ type: 'fight/input', fight: null, origin: 'local', input })
  })
}

export default { name: 'practice', reduce, observe } as const satisfies AppModule
