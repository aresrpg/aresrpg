// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { AppInput, AppModule } from '../store.ts'
import type { SelectableAuthWallet } from '../auth.ts'

import type { AdminState } from './admin_state.ts'

export const reduce_admin_wallet = (admin: AdminState, input: AppInput): AdminState | null => {
  if (input.type === 'admin/wallets_loaded' && admin.wallet.status === 'loading')
    return Object.freeze({
      ...admin,
      wallet: Object.freeze({ ...admin.wallet, status: 'ready', wallets: input.wallets, error: null }),
    })
  if (input.type === 'admin/wallet_connect' && admin.wallet.status === 'ready')
    return Object.freeze({
      ...admin,
      wallet: Object.freeze({
        ...admin.wallet,
        status: 'connecting',
        requested_wallet: input.wallet_name,
        accounts: Object.freeze([]),
        requested_address: null,
        error: null,
      }),
    })
  if (input.type === 'admin/wallet_accounts_loaded' && admin.wallet.status === 'connecting')
    return Object.freeze({
      ...admin,
      wallet: Object.freeze({
        ...admin.wallet,
        status: 'selecting',
        accounts: Object.freeze([...input.accounts]),
        requested_address: null,
        error: null,
      }),
    })
  if (
    input.type === 'admin/wallet_account_select' &&
    admin.wallet.status === 'selecting' &&
    admin.wallet.accounts.includes(input.address)
  )
    return Object.freeze({
      ...admin,
      wallet: Object.freeze({
        ...admin.wallet,
        status: 'connecting',
        requested_address: input.address,
        error: null,
      }),
    })
  if (input.type === 'admin/wallet_picker_cancel' && admin.wallet.status === 'selecting')
    return Object.freeze({
      ...admin,
      wallet: Object.freeze({
        ...admin.wallet,
        status: 'ready',
        requested_wallet: null,
        accounts: Object.freeze([]),
        requested_address: null,
        error: null,
      }),
    })
  if (
    input.type === 'admin/wallet_connected' &&
    admin.wallet.status === 'connecting' &&
    admin.wallet.requested_address === input.session.address
  )
    return Object.freeze({
      ...admin,
      wallet: Object.freeze({
        ...admin.wallet,
        status: 'connected',
        requested_wallet: null,
        accounts: Object.freeze([]),
        requested_address: null,
        session: input.session,
        error: null,
      }),
    })
  if (input.type === 'admin/wallet_disconnect' && admin.wallet.session)
    return Object.freeze({ ...admin, wallet: Object.freeze({ ...admin.wallet, status: 'connecting', error: null }) })
  if (input.type === 'admin/wallet_disconnected')
    return Object.freeze({
      ...admin,
      wallet: Object.freeze({
        status: 'ready',
        wallets: admin.wallet.wallets,
        requested_wallet: null,
        accounts: Object.freeze([]),
        requested_address: null,
        session: null,
        error: null,
      }),
    })
  if (input.type === 'admin/wallet_failed' && ['loading', 'connecting', 'selecting'].includes(admin.wallet.status))
    return Object.freeze({
      ...admin,
      wallet: Object.freeze({
        ...admin.wallet,
        status: admin.wallet.session ? 'connected' : 'ready',
        requested_wallet: null,
        accounts: Object.freeze([]),
        requested_address: null,
        error: input.error,
      }),
    })
  return null
}

export const observe_admin_wallet = ({
  events,
  dispatch,
  get_state,
  signal,
}: Parameters<NonNullable<AppModule['observe']>>[0]): void => {
  let auth: Awaited<ReturnType<typeof import('../auth.ts').create_admin_auth>> | null = null
  let selected_wallet: SelectableAuthWallet | null = null
  let stop_invalidation: (() => void) | null = null
  let generation = 0
  const fail = (error: unknown, request = generation): void => {
    if (signal.aborted || request !== generation) return
    console.error('Admin wallet operation failed.', error)
    dispatch({ type: 'admin/wallet_failed', error: error instanceof Error ? error.message : String(error) })
  }
  void import('../auth.ts')
    .then(({ create_admin_auth }) => create_admin_auth())
    .then((created) => {
      if (signal.aborted) return
      auth = created
      dispatch({ type: 'admin/wallets_loaded', wallets: created.wallets().map(({ name }) => name) })
    })
    .catch(fail)

  events.on('STATE_UPDATED', (state, previous) => {
    const { wallet } = state.admin
    const old_wallet = previous.admin.wallet
    if (wallet.status === 'loading' && old_wallet.status !== 'loading') generation += 1
    if (
      wallet.status === 'connecting' &&
      old_wallet.status === 'ready' &&
      wallet.requested_wallet &&
      !wallet.requested_address
    ) {
      const request = ++generation
      const { requested_wallet } = wallet
      selected_wallet = auth?.wallets().find(({ name }) => name === requested_wallet) ?? null
      if (!selected_wallet) return fail(new Error(`${wallet.requested_wallet} is unavailable`), request)
      void selected_wallet
        .authorize()
        .then((accounts) => {
          const current = get_state().admin.wallet
          if (
            signal.aborted ||
            request !== generation ||
            current.status !== 'connecting' ||
            current.requested_wallet !== requested_wallet
          )
            return
          dispatch({ type: 'admin/wallet_accounts_loaded', accounts })
        })
        .catch((error) => fail(error, request))
      return
    }
    if (
      wallet.status === 'connecting' &&
      old_wallet.status === 'selecting' &&
      wallet.requested_address &&
      selected_wallet
    ) {
      const request = ++generation
      const { requested_address } = wallet
      void selected_wallet
        .connect(requested_address)
        .then((session) => {
          const current = get_state().admin.wallet
          if (
            signal.aborted ||
            request !== generation ||
            current.status !== 'connecting' ||
            current.requested_address !== requested_address
          )
            return
          stop_invalidation?.()
          stop_invalidation =
            session.on_invalidated?.(() => {
              const active = get_state().admin.wallet
              if (active.session === session) dispatch({ type: 'admin/wallet_disconnect' })
            }) ?? null
          dispatch({ type: 'admin/wallet_connected', session })
        })
        .catch((error) => fail(error, request))
      return
    }
    if (wallet.status === 'ready' && old_wallet.status === 'selecting' && selected_wallet) {
      const cancelled = selected_wallet
      selected_wallet = null
      void cancelled.disconnect().catch((error) => console.warn('Admin wallet picker cleanup failed.', error))
      return
    }
    if (wallet.status === 'connecting' && old_wallet.status === 'connected' && old_wallet.session) {
      const request = ++generation
      stop_invalidation?.()
      stop_invalidation = null
      selected_wallet = null
      void old_wallet.session
        .disconnect()
        .then(() => {
          if (!signal.aborted && request === generation) dispatch({ type: 'admin/wallet_disconnected' })
        })
        .catch((error) => fail(error, request))
      return
    }
    if (!wallet.session && old_wallet.session && state.session.wallet !== previous.session.wallet)
      void old_wallet.session.disconnect().catch((error) => console.warn('Admin wallet disconnect failed.', error))
  })
}
