// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { WalletChoice, WalletInput, WalletSession, WalletState, WalletRequest } from './model.ts'
import { wallet_selection, type WalletStorage } from './selection.ts'

export type WalletDriver<S extends WalletSession> = Readonly<{
  wallets: () => readonly WalletChoice<S>[]
  on_wallets_changed?: (listener: () => void) => () => void
}>
export type WalletObserverOptions<S extends WalletSession> = Readonly<{
  network: string
  storage: WalletStorage | null
  create_auth: () => Promise<WalletDriver<S>>
}>
type WalletContext<S extends WalletSession> = Readonly<{
  get_state: () => WalletState<S>
  dispatch: (input: WalletInput<S>) => void
  subscribe: (listener: (state: WalletState<S>, previous: WalletState<S>) => void) => void
  signal: AbortSignal
}>

export const observe_wallet = <S extends WalletSession>(
  context: WalletContext<S>,
  options: WalletObserverOptions<S>
): void => {
  const { get_state, dispatch, signal } = context
  const selection = wallet_selection(options.storage, options.network)
  let stop_discovery: (() => void) | undefined
  let stop_invalidation: (() => void) | undefined
  const current = (sequence: number): boolean => !signal.aborted && get_state().sequence === sequence
  const fail = (error: unknown, sequence: number): void => {
    if (!current(sequence)) return
    console.error('External wallet operation failed.', error)
    dispatch({
      type: 'external_wallet/failed',
      sequence,
      error: error instanceof Error ? error.message : String(error),
    })
  }
  const send = (input: Extract<WalletInput<S>, { sequence: number }>): boolean => {
    if (!current(input.sequence)) return false
    dispatch(input)
    return true
  }
  const run = async (request: WalletRequest<S>, sequence: number): Promise<void> => {
    switch (request.kind) {
      case 'disconnect':
        await (request.session ?? request.wallet)?.disconnect()
        send({ type: 'external_wallet/finished', sequence })
        return
      case 'authorize': {
        const accounts = await request.wallet.authorize()
        send({ type: 'external_wallet/accounts', sequence, accounts })
        return
      }
      case 'restore':
      case 'connect': {
        const accounts = await request.wallet.authorize(true)
        if (!accounts.includes(request.address))
          throw new Error('The saved account is no longer authorized in this wallet')
        break
      }
    }
    if (!current(sequence)) return
    const session = await request.wallet.connect(request.address)
    if (!send({ type: 'external_wallet/connected', sequence, session })) session.dispose?.()
  }

  const watch_session = (session: S | null): void => {
    stop_invalidation?.()
    stop_invalidation = session?.on_invalidated?.(() => dispatch({ type: 'external_wallet/invalidated', session }))
  }
  watch_session(get_state().session)
  context.subscribe((state, previous) => {
    if (state.session !== previous.session) {
      watch_session(state.session)
      previous.session?.dispose?.()
    }
    const selection_changed = state.session !== previous.session || state.remembered !== previous.remembered
    if (selection_changed || state.request?.kind === 'disconnect') {
      try {
        selection.write(state.session ?? state.remembered)
      } catch (error) {
        console.error('External wallet selection could not be saved.', error)
      }
    }
    if (state.request && state.sequence !== previous.sequence)
      void run(state.request, state.sequence).catch((error: unknown) => fail(error, state.sequence))
  })
  void options
    .create_auth()
    .then((auth) => {
      if (signal.aborted) return
      stop_discovery = auth.on_wallets_changed?.(() =>
        dispatch({ type: 'external_wallet/discovered', wallets: auth.wallets() })
      )
      dispatch({ type: 'external_wallet/ready', wallets: auth.wallets(), remembered: selection.read() })
    })
    .catch((error: unknown) => fail(error, get_state().sequence))
  signal.addEventListener(
    'abort',
    () => {
      stop_discovery?.()
      stop_invalidation?.()
    },
    { once: true }
  )
}
