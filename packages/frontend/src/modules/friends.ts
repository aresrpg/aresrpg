// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { FriendRow } from '@aresrpg/protocol'
import type { AuthSession } from '@aresrpg/sdk/auth'

import type { AppInput, AppModule, AppState } from '../store.ts'
import { copy_text } from '../i18n/copy.ts'
import { toast } from '../toast.ts'
import { classify_wallet_recipient } from '../wallet_recipient.ts'

export type FriendsState = Readonly<{ rows: readonly FriendRow[]; pending: string | null }>

export type FriendsInput =
  | Readonly<{ type: 'friends/add'; target: string }>
  | Readonly<{ type: 'friends/remove'; address: string }>
  | Readonly<{ type: 'friends/pending'; operation: string | null }>
  | Readonly<{ type: 'friends/added'; address: string }>
  | Readonly<{ type: 'friends/removed'; address: string }>

export const initial_friends_state = (): FriendsState => Object.freeze({ rows: Object.freeze([]), pending: null })

export const friend_name = (row: Readonly<FriendRow>): string =>
  row.characters[0] ?? `${row.address.slice(0, 6)}…${row.address.slice(-4)}`

const reduce = (state: AppState, input: AppInput): AppState => {
  if (
    input.type === 'auth/disconnected' ||
    input.type === 'auth/rejected' ||
    (input.type === 'auth/connected' && state.session.wallet === input.session)
  )
    return Object.freeze({ ...state, friends: initial_friends_state() })
  if (input.type === 'server/packet' && input.packet.type === 'packet/friends')
    return Object.freeze({ ...state, friends: Object.freeze({ ...state.friends, rows: input.packet.friends }) })
  if (input.type === 'friends/pending')
    return Object.freeze({ ...state, friends: Object.freeze({ ...state.friends, pending: input.operation }) })
  if (input.type === 'friends/added' && !state.friends.rows.some(({ address }) => address === input.address))
    return Object.freeze({
      ...state,
      friends: Object.freeze({
        ...state.friends,
        rows: Object.freeze([...state.friends.rows, Object.freeze({ address: input.address, characters: [] })]),
      }),
    })
  if (input.type === 'friends/removed')
    return Object.freeze({
      ...state,
      friends: Object.freeze({
        ...state.friends,
        rows: Object.freeze(state.friends.rows.filter(({ address }) => address !== input.address)),
      }),
    })
  return state
}

const character_owner = (name: string, dispatch: (input: AppInput) => void): Promise<string> =>
  new Promise((resolve, reject) =>
    dispatch({ type: 'wallet/resolve_character', name, resolve: ({ address }) => resolve(address), reject })
  )

const observe: NonNullable<AppModule['observe']> = ({ events, get_state, dispatch }) => {
  const resolve_target = async (wallet: AuthSession, target: string): Promise<string> => {
    const text = copy_text(get_state().copy?.friends_panel ?? {})
    const recipient = classify_wallet_recipient(target)
    if (recipient.kind === 'address') return recipient.value.toLowerCase()
    if (recipient.kind === 'suins') {
      const address = await wallet.resolve_suins_address(recipient.value)
      if (address) return address.toLowerCase()
      throw new Error(text('error_no_suins', { name: recipient.value }))
    }
    if (recipient.kind === 'character') return (await character_owner(recipient.value, dispatch)).toLowerCase()
    throw new Error(text('error_target'))
  }
  const run = (
    operation: string,
    action: (wallet: AuthSession) => Promise<string>,
    completed: (address: string) => AppInput
  ): void => {
    const { wallet } = get_state().session
    if (!wallet || get_state().friends.pending) return
    dispatch({ type: 'friends/pending', operation })
    void action(wallet)
      .then((address) => {
        if (get_state().session.wallet === wallet) dispatch(completed(address))
      })
      .catch((error) => {
        if (get_state().session.wallet === wallet) toast.add(error)
      })
      .finally(() => {
        const state = get_state()
        if (state.session.wallet === wallet && state.friends.pending === operation)
          dispatch({ type: 'friends/pending', operation: null })
      })
  }
  events.on('friends/add', ({ target }) =>
    run(
      'add',
      async (wallet) => {
        const text = copy_text(get_state().copy?.friends_panel ?? {})
        const address = await resolve_target(wallet, target)
        if (get_state().session.wallet !== wallet) throw new Error('stale friend session')
        const state = get_state()
        if (address === wallet.address.toLowerCase()) throw new Error(text('error_self'))
        if (state.friends.rows.some((row) => row.address.toLowerCase() === address))
          throw new Error(text('error_duplicate'))
        await wallet.friends.add(address)
        return address
      },
      (address) => ({ type: 'friends/added', address })
    )
  )
  events.on('friends/remove', ({ address }) =>
    run(
      `remove:${address}`,
      async (wallet) => {
        await wallet.friends.remove(address)
        return address
      },
      (removed) => ({ type: 'friends/removed', address: removed })
    )
  )
}

export default Object.freeze({ name: 'friends', reduce, observe }) satisfies AppModule
