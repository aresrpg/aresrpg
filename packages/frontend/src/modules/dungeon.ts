// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { CharacterRow, DungeonLobbyRow } from '@aresrpg/protocol'

import type { AppInput, AppModule, AppState } from '../store.ts'
import { content_catalog } from '../content/catalog.ts'
import { copy_text } from '../i18n/copy.ts'
import { toast } from '../toast.ts'

import { character_custody, selected_character } from './session.ts'

export type DungeonState = Readonly<{
  lobbies: Readonly<Record<string, DungeonLobbyRow>>
  pending: string | null
  error: string | null
}>

export type DungeonInput =
  | Readonly<{
      type: 'dungeon/enter'
      portal: Readonly<{ world: string; zx: number; zz: number; x: number; z: number }>
    }>
  | Readonly<{ type: 'dungeon/start_fight'; access: 0 | 1 }>
  | Readonly<{ type: 'dungeon/join_fight'; fight: string }>
  | Readonly<{ type: 'dungeon/abandon' }>
  | Readonly<{ type: 'dungeon/pending'; operation: string | null }>
  | Readonly<{ type: 'dungeon/failed'; error: string }>

export const dungeon_lobby_key = ({ world, x, z }: Readonly<{ world: string; x: number; z: number }>): string =>
  `${world}:${x}:${z}`

export const dungeon_operation_reconciled = (operation: string, character: Readonly<CharacterRow> | null): boolean =>
  (operation === 'enter' && character?.dungeon_run !== undefined) ||
  ((operation === 'start' || operation.startsWith('join:')) && character?.custody === 'fight') ||
  (operation === 'abandon' && character?.dungeon_run === undefined)

export const initial_dungeon_state = (): DungeonState =>
  Object.freeze({ lobbies: Object.freeze({}), pending: null, error: null })

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
      dungeon: Object.freeze({ ...state.dungeon, pending: input.operation, error: null }),
    })
  if (input.type === 'dungeon/failed')
    return Object.freeze({
      ...state,
      dungeon: Object.freeze({ ...state.dungeon, pending: null, error: input.error }),
    })
  return state
}

const observe: NonNullable<AppModule['observe']> = ({ events, get_state, dispatch }) => {
  const run = (operation: string, transaction: Promise<unknown>): void => {
    if (get_state().dungeon.pending) return
    dispatch({ type: 'dungeon/pending', operation })
    void transaction.then(
      () => undefined,
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        dispatch({ type: 'dungeon/failed', error: message })
        toast.add(error)
      }
    )
  }

  events.on('dungeon/enter', ({ portal }) => {
    const state = get_state()
    const character = selected_character(state.session)
    const { wallet } = state.session
    const dungeon = content_catalog.world(portal.world)?.dungeon
    if (!character || !wallet || !dungeon || state.dungeon.pending) return
    const listed = new Set(state.marketplace.own_listings.map(({ id }) => id))
    const key = state.session.inventory.find(
      (item) =>
        item.item_type === dungeon.key && item.kiosk === character.kiosk && item.amount > 0 && !listed.has(item.id)
    )
    if (!key) {
      const text = state.copy ? copy_text(state.copy.world_hud) : (key: string) => key
      const name = content_catalog.item(dungeon.key)?.item.name ?? dungeon.key
      toast.add(new Error(text('dungeon_key_required', { key: name })))
      return
    }
    run(
      'enter',
      wallet.dungeon.enter({
        character_id: character.id,
        custody: character_custody(character),
        world: portal.world,
        zx: portal.zx,
        zz: portal.zz,
        key_id: key.id,
      })
    )
  })

  events.on('dungeon/start_fight', ({ access }) => {
    const state = get_state()
    const character = selected_character(state.session)
    const { wallet } = state.session
    const run_state = character?.dungeon_run
    const world = run_state ? content_catalog.world(run_state.world) : null
    const room = run_state ? world?.dungeon?.rooms[run_state.room - 1] : null
    if (!character || !wallet || !run_state || !room || state.dungeon.pending) return
    run(
      'start',
      wallet.dungeon.start_fight({
        character_id: character.id,
        custody: character_custody(character),
        world: run_state.world,
        x: run_state.x,
        z: run_state.z,
        mob_types: Object.freeze(room.map(({ mob_type }) => mob_type)),
        access,
      })
    )
  })

  events.on('dungeon/join_fight', ({ fight }) => {
    const state = get_state()
    const character = selected_character(state.session)
    const { wallet } = state.session
    const run_state = character?.dungeon_run
    const lobby = run_state ? state.dungeon.lobbies[dungeon_lobby_key(run_state)] : null
    const row = lobby?.fights.find(({ id }) => id === fight)
    if (!character || !wallet || !run_state || !row || row.phase !== 'placement' || state.dungeon.pending) return
    const own_party = state.session.parties[character.id]
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
      `join:${fight}`,
      wallet.dungeon.join_fight({
        fight,
        character_id: character.id,
        custody: character_custody(character),
        party,
      })
    )
  })

  events.on('dungeon/abandon', () => {
    const state = get_state()
    const character = selected_character(state.session)
    const { wallet } = state.session
    if (!character?.dungeon_run || !wallet || state.dungeon.pending) return
    run('abandon', wallet.dungeon.abandon({ character_id: character.id, custody: character_custody(character) }))
  })

  events.on('STATE_UPDATED', (state) => {
    const operation = state.dungeon.pending
    if (!operation) return
    const character = selected_character(state.session)
    if (dungeon_operation_reconciled(operation, character)) dispatch({ type: 'dungeon/pending', operation: null })
  })
}

export default Object.freeze({ name: 'dungeon', reduce, observe }) satisfies AppModule
