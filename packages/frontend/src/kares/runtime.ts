// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_kares_reader, KaresSnapshotPending } from '@aresrpg/sdk/kares'
import { createStore } from 'zustand/vanilla'

import { initial_finance, reduce_finance, type FinanceAction, type FinanceInput, type FinanceSession } from './model.ts'

const require_session = (session: FinanceSession | null): FinanceSession => {
  if (!session) throw new Error('Connect a wallet before submitting a transaction')
  return session
}

const read_snapshot = async <T>(read: () => Promise<T>): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await read()
    } catch (error) {
      if (!(error instanceof KaresSnapshotPending) || attempt === 4) throw error
      // eslint-disable-next-line one-pipeline/no-settimeout-in-stores -- Bounded RPC backoff at the effect boundary; it neither writes state nor retries a transaction.
      await new Promise((resolve) => globalThis.setTimeout(resolve, 200 * 2 ** attempt))
    }
  }
}

const execute_action = (session: FinanceSession, action: FinanceAction) => {
  const { kares } = session
  if (action.kind === 'withdraw') return kares.withdraw(action.positions, action.amount)
  const action_methods = {
    contribute: kares.contribute,
    stake: kares.stake,
    fund_kares: kares.fund_kares,
    fund_sui: kares.fund_sui,
    fund_combat: kares.fund_combat,
  }
  if ('amount' in action) return action_methods[action.kind](action.amount)
  switch (action.kind) {
    case 'claim_offering':
      return kares.claim_offering(action.ids)
    case 'refund':
      return kares.refund(action.ids)
    case 'claim_rewards':
      return kares.claim_rewards(action.ids)
  }
}

export type FinanceOptions = Readonly<{
  network: 'testnet' | 'mainnet'
  rpc_url?: string
  managed?: boolean
}>

const read_finance_snapshot = async (
  session: FinanceSession | null,
  reader: Pick<ReturnType<typeof create_kares_reader>, 'snapshot'>,
  managed: boolean
) => {
  if (managed)
    return { snapshot: await read_snapshot(() => require_session(session).kares.staking_snapshot()), balances: null }
  const { kares_balance, sui_balance, ...snapshot } = await read_snapshot(() =>
    session ? session.kares.snapshot() : reader.snapshot()
  )
  return { snapshot, balances: { kares_balance, sui_balance } }
}

export const create_finance_runtime = (options: FinanceOptions, session: FinanceSession | null = null) => {
  const store = createStore(() => initial_finance(session?.address ?? null))
  const dispatch = (input: FinanceInput): void => store.setState((state) => reduce_finance(state, input), true)
  const start = (): (() => void) => {
    let stopped = false
    let public_reader: ReturnType<typeof create_kares_reader> | null = null
    const reader = { snapshot: () => (public_reader ??= create_kares_reader(options)).snapshot() }
    const send = (input: FinanceInput): void => {
      if (!stopped) dispatch(input)
    }
    const stop_observer = store.subscribe((state, previous) => {
      if (!state.request || state.sequence === previous.sequence) return
      const { request, sequence } = state
      const run = async (): Promise<void> => {
        switch (request.kind) {
          case 'refresh':
            send({
              type: 'snapshot',
              sequence,
              ...(await read_finance_snapshot(session, reader, options.managed === true)),
            })
            return
          case 'execute': {
            const connected = require_session(session)
            const receipt = await execute_action(connected, request.action)
            send({ type: 'receipt', sequence, digest: receipt.digest })
            const result = await read_finance_snapshot(connected, reader, options.managed === true)
            send({ type: 'snapshot', sequence, ...result, digest: receipt.digest })
          }
        }
      }
      void run().catch((error: unknown) => {
        console.error('KARES operation failed.', error)
        send({ type: 'failed', sequence, error: error instanceof Error ? error.message : String(error) })
      })
    })
    dispatch({ type: 'resume' })
    return () => {
      stopped = true
      stop_observer()
    }
  }
  return { store, dispatch, start }
}
