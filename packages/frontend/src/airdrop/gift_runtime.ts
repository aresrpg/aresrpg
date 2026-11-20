// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createStore } from 'zustand/vanilla'
import { GiftError } from '@aresrpg/sdk/gift'
import type { GiftPolicy } from '@aresrpg/sdk/gift-provenance'

import { browser_auth_storage, type AuthStorage } from '../auth_storage.ts'
import { create_remembered_auth } from '../remembered_auth.ts'
import { report_error } from '../reporting.ts'

import {
  initial_gift_state,
  reduce_gift,
  type GiftInput,
  type GiftResult,
  type GiftState,
  type GiftTask,
  type GiftWallet,
} from './gift_state.ts'

type GiftAuth = Readonly<{
  connect_google: () => Promise<GiftWallet>
  restore: (name: string) => Promise<GiftWallet | null>
  dispose: () => void
}>
type GiftRuntimeOptions = Readonly<{
  link: string | null
  policy: GiftPolicy
  storage?: AuthStorage | null
  load_auth?: () => Promise<() => GiftAuth>
}>

const failure_code = (error: unknown): string => {
  if (error instanceof GiftError) return error.code
  if (error instanceof Error && /outcome unknown|previous transaction/.test(error.message)) return 'uncertain'
  return 'unavailable'
}

export const create_gift_runtime = ({
  link,
  policy,
  storage = browser_auth_storage(),
  load_auth = async () => (await import('../auth.ts')).create_auth,
}: GiftRuntimeOptions) => {
  const store = createStore<GiftState>(initial_gift_state)
  const dispatch = (input: GiftInput): void => {
    store.setState((state) => reduce_gift(state, input), true)
  }

  const observe = (): (() => void) => {
    const controller = new AbortController()
    const account = create_remembered_auth<GiftWallet>(async () => (await load_auth())(), storage)
    let release_wallet = (): void => {}
    const connected = (wallet: GiftWallet, advance: GiftTask['advance']): GiftResult => ({
      kind: 'connected',
      wallet,
      advance,
    })
    const require_wallet = (state: GiftState): GiftWallet => {
      if (!state.wallet) throw new GiftError('unauthorized')
      return state.wallet
    }
    const check = async (state: GiftState): Promise<GiftResult> => {
      const wallet = require_wallet(state)
      // The shared SDK owns uncertain submissions. Reload its session after it accepts a receipt.
      if (await wallet.gift(policy).recover()) {
        const restored = await account.restore()
        if (!restored) throw new GiftError('unauthorized')
        return connected(restored, state.task!.advance)
      }
      let proof = state.status?.proof ?? null
      if (!state.status && link && !state.skip_link) {
        const card = await wallet.inspect_giftcard_link(link)
        if (!card) return { kind: 'checked', status: { stage: 'missing', proof: null }, balance: null }
        proof = { giftcard: card.id }
      }
      const [status, balance] = await Promise.all([wallet.gift(policy).status(proof), wallet.read_sui_balance()])
      return { kind: 'checked', status, balance }
    }
    const write =
      (action: 'redeem' | 'open' | 'collect') =>
      async (state: GiftState): Promise<GiftResult> => {
        if (!state.status?.proof) throw new GiftError('invalid')
        return { kind: 'executed', status: await require_wallet(state).gift(policy).execute(action, state.status) }
      }
    const tasks: Record<GiftTask['kind'], (state: GiftState) => Promise<GiftResult>> = {
      boot: async () => {
        const wallet = await account.restore().catch((error: unknown) => {
          report_error(error, { area: 'gift-auth-restore' })
          return null
        })
        if (controller.signal.aborted) {
          wallet?.dispose?.()
          return { kind: 'ready' }
        }
        return wallet ? connected(wallet, false) : { kind: 'ready' }
      },
      login: async () => connected(await account.connect(), true),
      check,
      logout: async (state) => {
        await account.sign_out(require_wallet(state))
        return { kind: 'disconnected' }
      },
      transfer: async (state) => {
        if (!link || !state.status?.proof) throw new GiftError('invalid')
        return { kind: 'executed', status: await require_wallet(state).gift(policy).transfer(link, state.status.proof) }
      },
      redeem: write('redeem'),
      open: write('open'),
      collect: write('collect'),
    }
    const start_task = (task: GiftTask, state: GiftState): void => {
      void tasks[task.kind](state)
        .then((result) => {
          if (controller.signal.aborted) {
            if (result.kind === 'connected') result.wallet.dispose?.()
            return
          }
          dispatch({ type: 'completed', task: task.id, result })
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          report_error(error, { area: 'gift', action: task.kind })
          dispatch({ type: 'failed', task: task.id, error: task.kind === 'login' ? 'login' : failure_code(error) })
        })
    }
    const observe_wallet = (state: GiftState, previous: GiftState): void => {
      if (state.wallet !== previous.wallet) {
        release_wallet()
        previous.wallet?.dispose?.()
        const { wallet } = state
        if (wallet) {
          const stop_invalidation = wallet.on_invalidated?.(() => {
            account.forget()
            dispatch({ type: 'invalidated', wallet })
          })
          release_wallet = () => {
            stop_invalidation?.()
          }
        }
      }
    }
    const stop = store.subscribe((state, previous) => {
      observe_wallet(state, previous)
      if (state.task && state.task !== previous.task) start_task(state.task, state)
    })
    dispatch({ type: 'start' })
    return () => {
      controller.abort()
      stop()
      release_wallet()
      store.getState().wallet?.dispose?.()
      account.dispose()
    }
  }
  return { store, dispatch, observe }
}

export type GiftRuntime = ReturnType<typeof create_gift_runtime>
