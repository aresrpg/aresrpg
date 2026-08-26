// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { KolizeumLobbyRow } from '@aresrpg/protocol'

import type { AppInput, AppModule, AppState } from '../store.ts'
import { toast } from '../toast.ts'

import { character_custody, selected_character } from './session.ts'

export type KolizeumState = Readonly<{
  lobbies: readonly KolizeumLobbyRow[]
  pending_by_character: Readonly<Record<string, string>>
}>

export type KolizeumInput =
  | Readonly<{
      type: 'kolizeum/create'
      format: 1 | 3 | 6
      pledge_mist: bigint
      max_level_diff: number
      access: 'public' | 'friends'
    }>
  | Readonly<{ type: 'kolizeum/join'; kolizeum: string; side: 0 | 1 }>
  | Readonly<{ type: 'kolizeum/pending'; character_id: string; operation: string | null }>

export const initial_kolizeum_state = (): KolizeumState =>
  Object.freeze({ lobbies: Object.freeze([]), pending_by_character: Object.freeze({}) })

export const kolizeum_for_fight = (state: Readonly<KolizeumState>, fight: string) =>
  state.lobbies.find((lobby) => lobby.fight === fight) ?? null

export const selected_kolizeum_pending = (state: Readonly<AppState>): string | null => {
  const character_id = state.session.selected_character_id
  return character_id ? (state.kolizeum.pending_by_character[character_id] ?? null) : null
}

export const kolizeum_side_open = (lobby: Readonly<KolizeumLobbyRow>, side: 0 | 1): boolean =>
  lobby.status === 'open' &&
  lobby.fighters.filter((fighter) => fighter.team === side && !fighter.settled).length < lobby.format

/** Pledges deliberately allow zero; the wallet transfer parser rejects it because transfers do not. */
export const parse_kolizeum_pledge = (value: string): bigint | null => {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,9}))?$/.exec(value.trim())
  if (!match) return null
  return BigInt(match[1]) * 1_000_000_000n + BigInt((match[2] ?? '').padEnd(9, '0') || '0')
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'server/packet' && input.packet.type === 'packet/kolizeums')
    return Object.freeze({
      ...state,
      kolizeum: Object.freeze({ ...state.kolizeum, lobbies: Object.freeze(input.packet.lobbies) }),
    })
  if (input.type === 'kolizeum/pending')
    return Object.freeze({
      ...state,
      kolizeum: Object.freeze({
        ...state.kolizeum,
        pending_by_character: Object.freeze({
          ...Object.fromEntries(
            Object.entries(state.kolizeum.pending_by_character).filter(([id]) => id !== input.character_id)
          ),
          ...(input.operation ? { [input.character_id]: input.operation } : {}),
        }),
      }),
    })
  return state
}

const observe: NonNullable<AppModule['observe']> = ({ events, get_state, dispatch }) => {
  const run = <T extends Readonly<{ fight: string }>>(
    character_id: string,
    operation: string,
    transaction: Promise<T>
  ): void => {
    if (get_state().kolizeum.pending_by_character[character_id]) return
    dispatch({ type: 'kolizeum/pending', character_id, operation })
    void transaction.then(
      ({ fight }) => dispatch({ type: 'fight/watch', character_id, fight }),
      (error: unknown) => {
        dispatch({ type: 'kolizeum/pending', character_id, operation: null })
        toast.add(error)
      }
    )
  }

  events.on('kolizeum/create', ({ format, pledge_mist, max_level_diff, access }) => {
    const state = get_state()
    const character = selected_character(state.session)
    const { wallet } = state.session
    if (!character || !wallet || character.custody !== 'kiosk' || state.kolizeum.pending_by_character[character.id])
      return
    const difference = Math.max(0, Math.min(65_534, Math.floor(max_level_diff)))
    run(
      character.id,
      'create',
      wallet.kolizeum.create({
        pledge_mist,
        format,
        level_min: Math.max(1, character.level - difference),
        level_max: Math.min(65_535, character.level + difference),
        access,
        character_id: character.id,
        custody: character_custody(character),
      })
    )
  })

  events.on('kolizeum/join', ({ kolizeum, side }) => {
    const state = get_state()
    const character = selected_character(state.session)
    const { wallet } = state.session
    const lobby = state.kolizeum.lobbies.find(({ id }) => id === kolizeum)
    if (
      !character ||
      !wallet ||
      !lobby ||
      character.custody !== 'kiosk' ||
      character.level < lobby.level_min ||
      character.level > lobby.level_max ||
      !lobby.can_join ||
      !kolizeum_side_open(lobby, side) ||
      state.kolizeum.pending_by_character[character.id]
    )
      return
    run(
      character.id,
      `join:${lobby.id}`,
      wallet.kolizeum.join({
        kolizeum: lobby.id,
        fight: lobby.fight,
        pledge_mist: BigInt(lobby.pledge_mist),
        side,
        character_id: character.id,
        custody: character_custody(character),
      })
    )
  })

  events.on('STATE_UPDATED', (state) => {
    Object.entries(state.kolizeum.pending_by_character).forEach(([character_id]) => {
      const character = state.session.characters.find(({ id }) => id === character_id)
      if (character?.active_fight) dispatch({ type: 'kolizeum/pending', character_id, operation: null })
    })
  })
}

export default Object.freeze({ name: 'kolizeum', reduce, observe }) satisfies AppModule
