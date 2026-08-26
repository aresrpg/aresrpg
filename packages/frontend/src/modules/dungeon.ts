// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow, DungeonLobbyRow, ItemRow } from '@aresrpg/protocol'

import type { AppInput, AppModule, AppState } from '../store.ts'
import { content_catalog } from '../content/catalog.ts'
import { copy_text } from '../i18n/copy.ts'
import { encumbered_asset_ids } from '../inventory_stacks.ts'
import { toast } from '../toast.ts'

import { character_custody, selected_character } from './session.ts'
import { selected_party } from './party.ts'

export type DungeonState = Readonly<{
  lobbies: Readonly<Record<string, DungeonLobbyRow>>
  pending_by_character: Readonly<Record<string, string>>
  optimistic_runs: Readonly<Record<string, NonNullable<CharacterRow['dungeon_run']>>>
}>

export type DungeonInput =
  | Readonly<{
      type: 'dungeon/enter'
      portal: Readonly<{ world: string; zx: number; zz: number; x: number; z: number }>
    }>
  | Readonly<{ type: 'dungeon/start_fight'; access: 0 | 1 }>
  | Readonly<{ type: 'dungeon/join_fight'; fight: string }>
  | Readonly<{ type: 'dungeon/abandon' }>
  | Readonly<{ type: 'dungeon/pending'; character_id: string; operation: string | null }>
  | Readonly<{
      type: 'dungeon/optimistic_run'
      character_id: string
      run: NonNullable<CharacterRow['dungeon_run']> | null
    }>

export const dungeon_lobby_key = ({ world, x, z }: Readonly<{ world: string; x: number; z: number }>): string =>
  `${world}:${x}:${z}`

export const dungeon_operation_reconciled = (operation: string, character: Readonly<CharacterRow> | null): boolean =>
  (operation === 'enter' && character?.dungeon_run !== undefined) ||
  ((operation === 'start' || operation.startsWith('join:')) && character?.custody === 'fight') ||
  (operation === 'abandon' && character?.dungeon_run === undefined)

export const initial_dungeon_state = (): DungeonState =>
  Object.freeze({
    lobbies: Object.freeze({}),
    pending_by_character: Object.freeze({}),
    optimistic_runs: Object.freeze({}),
  })

export const selected_dungeon_pending = (state: Readonly<AppState>): string | null => {
  const character_id = state.session.selected_character_id
  return character_id ? (state.dungeon.pending_by_character[character_id] ?? null) : null
}

export const selected_dungeon_run = (state: Readonly<AppState>): NonNullable<CharacterRow['dungeon_run']> | null => {
  const character_id = state.session.selected_character_id
  if (!character_id) return null
  const character = state.session.characters.find(({ id }) => id === character_id)
  return character?.dungeon_run ?? state.dungeon.optimistic_runs[character_id] ?? null
}

/** The exact unlocked key object the entry transaction may burn. The modal reads this same
 * selector, so an unavailable key never leaves a clickable door in front of the player. */
export const dungeon_entry_key = (state: Readonly<AppState>, item_type: string): Readonly<ItemRow> | null => {
  const character = selected_character(state.session)
  if (!character) return null
  const listed = encumbered_asset_ids(state.marketplace.own_listings, state.trade.rows)
  return (
    state.session.inventory.find(
      (item) =>
        item.item_type === item_type && item.kiosk === character.kiosk && item.amount > 0 && !listed.has(item.id)
    ) ?? null
  )
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'server/packet' && input.packet.type === 'packet/dungeon_lobby') {
    const { lobby } = input.packet
    return Object.freeze({
      ...state,
      dungeon: Object.freeze({
        ...state.dungeon,
        lobbies: Object.freeze({ ...state.dungeon.lobbies, [dungeon_lobby_key(lobby)]: Object.freeze(lobby) }),
      }),
    })
  }
  if (input.type === 'dungeon/pending')
    return Object.freeze({
      ...state,
      dungeon: Object.freeze({
        ...state.dungeon,
        pending_by_character: Object.freeze({
          ...Object.fromEntries(
            Object.entries(state.dungeon.pending_by_character).filter(([id]) => id !== input.character_id)
          ),
          ...(input.operation ? { [input.character_id]: input.operation } : {}),
        }),
      }),
    })
  if (input.type === 'dungeon/optimistic_run')
    return Object.freeze({
      ...state,
      dungeon: Object.freeze({
        ...state.dungeon,
        optimistic_runs: Object.freeze({
          ...Object.fromEntries(
            Object.entries(state.dungeon.optimistic_runs).filter(([id]) => id !== input.character_id)
          ),
          ...(input.run ? { [input.character_id]: Object.freeze(input.run) } : {}),
        }),
      }),
    })
  return state
}

const observe: NonNullable<AppModule['observe']> = ({ events, get_state, dispatch }) => {
  const run = <T>(
    character_id: string,
    operation: string,
    transaction: Promise<T>,
    confirmed?: (result: T) => void,
    failed?: () => void
  ): void => {
    if (get_state().dungeon.pending_by_character[character_id]) return
    dispatch({ type: 'dungeon/pending', character_id, operation })
    void transaction.then(
      (result) => confirmed?.(result),
      (error: unknown) => {
        failed?.()
        dispatch({ type: 'dungeon/pending', character_id, operation: null })
        toast.add(error)
      }
    )
  }

  events.on('dungeon/enter', ({ portal }) => {
    const state = get_state()
    const character = selected_character(state.session)
    const { wallet } = state.session
    const dungeon = content_catalog.world(portal.world)?.dungeon
    if (!character || !wallet || !dungeon || state.dungeon.pending_by_character[character.id]) return
    const key = dungeon_entry_key(state, dungeon.key)
    if (!key) {
      const text = state.copy ? copy_text(state.copy.world_hud) : (key: string) => key
      const name = content_catalog.item(dungeon.key)?.item.name ?? dungeon.key
      toast.add(new Error(text('dungeon_key_required', { key: name })))
      return
    }
    dispatch({
      type: 'dungeon/optimistic_run',
      character_id: character.id,
      run: Object.freeze({ world: portal.world, room: 1, x: portal.x, z: portal.z }),
    })
    run(
      character.id,
      'enter',
      wallet.dungeon.enter({
        character_id: character.id,
        custody: character_custody(character),
        world: portal.world,
        zx: portal.zx,
        zz: portal.zz,
        key_id: key.id,
      }),
      undefined,
      () => dispatch({ type: 'dungeon/optimistic_run', character_id: character.id, run: null })
    )
  })

  events.on('dungeon/start_fight', ({ access }) => {
    const state = get_state()
    const character = selected_character(state.session)
    const { wallet } = state.session
    const run_state = character?.dungeon_run
    const world = run_state ? content_catalog.world(run_state.world) : null
    const room = run_state ? world?.dungeon?.rooms[run_state.room - 1] : null
    if (!character || !wallet || !run_state || !room || state.dungeon.pending_by_character[character.id]) return
    run(
      character.id,
      'start',
      wallet.dungeon.start_fight({
        character_id: character.id,
        custody: character_custody(character),
        world: run_state.world,
        x: run_state.x,
        z: run_state.z,
        mob_types: Object.freeze(room.map(({ mob_type }) => mob_type)),
        access,
      }),
      ({ fight }) => dispatch({ type: 'fight/watch', character_id: character.id, fight })
    )
  })

  events.on('dungeon/join_fight', ({ fight }) => {
    const state = get_state()
    const character = selected_character(state.session)
    const { wallet } = state.session
    const run_state = character?.dungeon_run
    const lobby = run_state ? state.dungeon.lobbies[dungeon_lobby_key(run_state)] : null
    const row = lobby?.fights.find(({ id }) => id === fight)
    if (
      !character ||
      !wallet ||
      !run_state ||
      !row ||
      row.phase !== 'placement' ||
      state.dungeon.pending_by_character[character.id]
    )
      return
    const own_party = selected_party(state)
    const party =
      row.access === 1 && row.opener && own_party?.members.some(({ character_id }) => character_id === row.opener)
        ? own_party.id
        : null
    if (row.access === 1 && !party) {
      const text = state.copy ? copy_text(state.copy.world_hud) : (key: string) => key
      toast.add(new Error(text('dungeon_group_refusal')))
      return
    }
    run(
      character.id,
      `join:${fight}`,
      wallet.dungeon.join_fight({
        fight,
        character_id: character.id,
        custody: character_custody(character),
        party,
      }),
      () => dispatch({ type: 'fight/watch', character_id: character.id, fight })
    )
  })

  events.on('dungeon/abandon', () => {
    const state = get_state()
    const character = selected_character(state.session)
    const { wallet } = state.session
    if (!character?.dungeon_run || !wallet || state.dungeon.pending_by_character[character.id]) return
    run(
      character.id,
      'abandon',
      wallet.dungeon.abandon({ character_id: character.id, custody: character_custody(character) })
    )
  })

  events.on('STATE_UPDATED', (state) => {
    Object.keys(state.dungeon.optimistic_runs).forEach((character_id) => {
      const character = state.session.characters.find(({ id }) => id === character_id)
      if (character?.dungeon_run) dispatch({ type: 'dungeon/optimistic_run', character_id, run: null })
    })
    Object.entries(state.dungeon.pending_by_character).forEach(([character_id, operation]) => {
      const character = state.session.characters.find(({ id }) => id === character_id) ?? null
      if (dungeon_operation_reconciled(operation, character))
        dispatch({ type: 'dungeon/pending', character_id, operation: null })
    })
  })
}

export default Object.freeze({ name: 'dungeon', reduce, observe }) satisfies AppModule
