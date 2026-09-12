// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type WalletSession = Readonly<{
  address: string
  wallet_name: string
  disconnect: () => Promise<void>
  dispose?: () => void
  on_invalidated?: (listener: () => void) => () => void
}>
export type WalletChoice<S extends WalletSession = WalletSession> = Readonly<{
  name: string
  authorize: (silent?: boolean) => Promise<readonly string[]>
  connect: (address: string) => Promise<S>
  disconnect: () => Promise<void>
}>
export type WalletSelection = Readonly<{ wallet_name: string; address: string }>
export type WalletRequest<S extends WalletSession> =
  | Readonly<{ kind: 'authorize'; wallet: WalletChoice<S> }>
  | Readonly<{ kind: 'connect' | 'restore'; wallet: WalletChoice<S>; address: string }>
  | Readonly<{ kind: 'disconnect'; session: S | null; wallet: WalletChoice<S> | null }>
export type WalletState<S extends WalletSession = WalletSession> = Readonly<{
  loaded: boolean
  wallets: readonly WalletChoice<S>[]
  selected_wallet: WalletChoice<S> | null
  accounts: readonly WalletSelection[]
  remembered: WalletSelection | null
  session: S | null
  request: WalletRequest<S> | null
  sequence: number
  error: string | null
}>
export type WalletUiInput =
  | Readonly<{ type: 'external_wallet/authorize'; wallet_name: string }>
  | Readonly<{ type: 'external_wallet/select'; wallet_name: string; address: string }>
  | Readonly<{ type: 'external_wallet/disconnect' }>
  | Readonly<{ type: 'external_wallet/cancel' }>
export type WalletInput<S extends WalletSession> =
  | WalletUiInput
  | Readonly<{ type: 'external_wallet/ready'; wallets: readonly WalletChoice<S>[]; remembered: WalletSelection | null }>
  | Readonly<{ type: 'external_wallet/discovered'; wallets: readonly WalletChoice<S>[] }>
  | Readonly<{ type: 'external_wallet/accounts'; sequence: number; accounts: readonly string[] }>
  | Readonly<{ type: 'external_wallet/connected'; sequence: number; session: S }>
  | Readonly<{ type: 'external_wallet/finished'; sequence: number }>
  | Readonly<{ type: 'external_wallet/failed'; sequence: number; error: string }>
  | Readonly<{ type: 'external_wallet/invalidated'; session: S }>
export type WalletView = Readonly<{ state: WalletState; dispatch: (input: WalletUiInput) => void }>

export const initial_wallet_state = <S extends WalletSession>(): WalletState<S> => ({
  loaded: false,
  wallets: [],
  selected_wallet: null,
  accounts: [],
  remembered: null,
  session: null,
  request: null,
  sequence: 0,
  error: null,
})

const request_wallet = <S extends WalletSession>(state: WalletState<S>, request: WalletRequest<S>): WalletState<S> => ({
  ...state,
  request,
  sequence: state.sequence + 1,
  error: null,
})

const restore_when_available = <S extends WalletSession>(state: WalletState<S>): WalletState<S> => {
  if (!state.remembered || state.session || state.request) return state
  const wallet = state.wallets.find(({ name }) => name === state.remembered!.wallet_name)
  return wallet
    ? request_wallet(
        { ...state, selected_wallet: wallet },
        { kind: 'restore', wallet, address: state.remembered.address }
      )
    : state
}

const choose_wallet = <S extends WalletSession>(state: WalletState<S>, input: WalletUiInput): WalletState<S> => {
  if (input.type === 'external_wallet/disconnect')
    return request_wallet(
      {
        ...state,
        session: null,
        remembered: null,
        accounts: state.accounts.filter(({ wallet_name }) => wallet_name !== state.session?.wallet_name),
        selected_wallet: null,
      },
      { kind: 'disconnect', session: state.session, wallet: state.selected_wallet }
    )
  if (input.type === 'external_wallet/cancel')
    return {
      ...state,
      request: null,
      selected_wallet: null,
      remembered: null,
      sequence: state.sequence + 1,
    }
  if (state.request) return state
  if (input.type === 'external_wallet/authorize') {
    const wallet = state.wallets.find(({ name }) => name === input.wallet_name)
    return wallet
      ? request_wallet({ ...state, selected_wallet: wallet, remembered: null }, { kind: 'authorize', wallet })
      : state
  }
  const wallet = state.wallets.find(({ name }) => name === input.wallet_name)
  const authorized = state.accounts.some(
    ({ wallet_name, address }) => wallet_name === input.wallet_name && address === input.address
  )
  return wallet && authorized
    ? request_wallet({ ...state, session: null }, { kind: 'connect', wallet, address: input.address })
    : state
}

const finish_wallet = <S extends WalletSession>(
  state: WalletState<S>,
  input: Extract<WalletInput<S>, { sequence: number }>
): WalletState<S> => {
  if (input.sequence !== state.sequence) return state
  switch (input.type) {
    case 'external_wallet/accounts': {
      const wallet_name = state.selected_wallet!.name
      const accounts = [
        ...state.accounts.filter((account) => account.wallet_name !== wallet_name),
        ...[...new Set(input.accounts)].map((address) => ({ wallet_name, address })),
      ]
      const ready = { ...state, accounts, request: null }
      return input.accounts.length === 1 && !state.session
        ? choose_wallet(ready, { type: 'external_wallet/select', wallet_name, address: input.accounts[0] })
        : ready
    }
    case 'external_wallet/connected':
      return {
        ...state,
        session: input.session,
        remembered: null,
        selected_wallet: null,
        accounts: [
          ...state.accounts.filter(
            ({ wallet_name, address }) => wallet_name !== input.session.wallet_name || address !== input.session.address
          ),
          { wallet_name: input.session.wallet_name, address: input.session.address },
        ],
        request: null,
        error: null,
      }
    case 'external_wallet/finished':
      return { ...state, request: null }
    case 'external_wallet/failed':
      return { ...state, request: null, remembered: null, error: input.error }
  }
}

export const reduce_wallet = <S extends WalletSession>(
  state: WalletState<S>,
  input: WalletInput<S>
): WalletState<S> => {
  if ('sequence' in input) return finish_wallet(state, input)
  if (input.type === 'external_wallet/ready')
    return restore_when_available({
      ...state,
      loaded: true,
      request: null,
      sequence: state.sequence + 1,
      wallets: input.wallets,
      remembered: state.session ? null : input.remembered,
    })
  if (input.type === 'external_wallet/discovered') return restore_when_available({ ...state, wallets: input.wallets })
  if (input.type === 'external_wallet/invalidated')
    return state.session === input.session
      ? {
          ...state,
          session: null,
          request: null,
          remembered: null,
          sequence: state.sequence + 1,
          accounts: state.accounts.filter(({ wallet_name }) => wallet_name !== input.session.wallet_name),
        }
      : state
  return choose_wallet(state, input)
}
