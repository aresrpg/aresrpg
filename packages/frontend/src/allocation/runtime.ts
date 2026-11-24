// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createStore } from 'zustand/vanilla'
import type { AllocationRequest, AllocationResult } from '@aresrpg/protocol'
import type { AllocationStatus } from '@aresrpg/immutable/allocation'

import type { Auth, AuthSession } from '../auth.ts'
import { x_post_url } from '../components/links.tsx'
import { create_remembered_auth } from '../remembered_auth.ts'

import { restore_allocation_wallet } from './restoration.ts'
import { create_allocation_client } from './client.ts'

export type AllocationTask =
  | Readonly<{ kind: 'boot' | 'google' | 'link_google' | 'logout' | 'load' | 'reconnect' }>
  | Readonly<{ kind: 'wallet'; name: string }>
  | Readonly<{ kind: 'verify'; wallet: AuthSession }>
  | Readonly<{ kind: 'remove'; address: string }>
  | Readonly<{ kind: 'share'; address: string; locale: string; text: string }>
export type AllocationProgress = 'restoring' | 'connecting' | 'loading'
const INITIAL_PROGRESS: Readonly<Record<string, AllocationProgress>> = {
  boot: 'restoring',
  google: 'connecting',
  wallet: 'connecting',
}
type Result = Readonly<{
  session: AuthSession | null
  status: AllocationStatus | null
  error: string | null
  share_intent_url: string | null
}>
export type AllocationState = Result &
  Readonly<{ task: AllocationTask | null; sequence: number; progress: AllocationProgress | null }>
type Input =
  | Readonly<{ type: 'progress'; sequence: number; progress: AllocationProgress }>
  | Readonly<{ type: 'request'; task: AllocationTask }>
  | Readonly<{ type: 'result'; sequence: number; result: Result }>
  | Readonly<{ type: 'invalidated'; wallet: AuthSession }>
export const initial_allocation = (): AllocationState => ({
  session: null,
  status: null,
  task: null,
  sequence: 0,
  progress: null,
  error: null,
  share_intent_url: null,
})
export const reduce_allocation = (state: AllocationState, input: Input): AllocationState => {
  switch (input.type) {
    case 'progress':
      return state.sequence === input.sequence && state.task ? { ...state, progress: input.progress } : state
    case 'request': {
      if (state.task) return state
      const cleared = input.task.kind === 'logout' ? { status: null } : {}
      return {
        ...state,
        ...cleared,
        share_intent_url: null,
        task: input.task,
        progress: INITIAL_PROGRESS[input.task.kind] ?? 'loading',
        sequence: state.sequence + 1,
        error: null,
      }
    }
    case 'invalidated':
      return state.session !== input.wallet ? state : { ...initial_allocation(), sequence: state.sequence + 1 }
    case 'result':
      return state.sequence !== input.sequence ? state : { ...state, ...input.result, task: null, progress: null }
  }
}
export const share_intent = (url: string, locale: string, text: string): string => {
  const preview = new URL(url)
  preview.searchParams.set('locale', locale)
  return x_post_url(text, preview.href)
}
type Request = (request: AllocationRequest) => Promise<AllocationResult>
const verify = async (request: Request, wallet: AuthSession): Promise<void> => {
  const challenge = await request({ action: 'wallet_challenge', address: wallet.address, label: wallet.wallet_name })
  if (challenge.action !== 'wallet_challenge') throw new Error('unavailable')
  const { signature } = await wallet.sign_personal_message(new TextEncoder().encode(challenge.message))
  await request({ action: 'wallet_verify', nonce: challenge.nonce, signature })
}
export const link_game_wallet = async (request: Request, connect: () => Promise<AuthSession>): Promise<void> => {
  const wallet = await connect()
  try {
    await verify(request, wallet)
  } finally {
    wallet.dispose?.()
  }
}
const operate = async (
  request: Request,
  task: AllocationTask,
  get_auth: () => Promise<Pick<Auth, 'connect_google'>>
): Promise<string | null> => {
  switch (task.kind) {
    case 'link_google':
      await link_game_wallet(request, (await get_auth()).connect_google)
      break
    case 'verify':
      await verify(request, task.wallet)
      break
    case 'remove':
      await request({ action: 'wallet_remove', address: task.address })
      break
    case 'share': {
      const result = await request({ action: 'share', address: task.address })
      if (result.action !== 'share') throw new Error('unavailable')
      return share_intent(result.url, task.locale, task.text)
    }
    default:
      break
  }
  return null
}
export const create_allocation_runtime = () => {
  const store = createStore<AllocationState>(initial_allocation)
  const dispatch = (input: Input): void => store.setState((state) => reduce_allocation(state, input), true)
  const observe = (): (() => void) => {
    let active = true
    // Whitelisted wallets buy here (DECISIONS: WHITELISTED WALLETS BUY ON THE ALLOCATION PAGE).
    const account = create_remembered_auth(undefined, undefined, { wallets: true })
    let client: ReturnType<typeof create_allocation_client> | null = null
    let client_wallet: AuthSession | null = null
    let stop_wallet = (): void => {}
    const current = (sequence: number): boolean => active && store.getState().sequence === sequence
    const bind = (wallet: AuthSession | null): void => {
      if (wallet === client_wallet) return
      stop_wallet()
      client?.dispose()
      client_wallet?.dispose?.()
      client_wallet = wallet
      client = wallet
        ? create_allocation_client(wallet, undefined, (progress) =>
            dispatch({ type: 'progress', sequence: store.getState().sequence, progress })
          )
        : null
      stop_wallet = wallet?.on_invalidated?.(() => dispatch({ type: 'invalidated', wallet })) ?? (() => {})
    }
    const authenticate = async (task: AllocationTask, wallet: AuthSession | null): Promise<AuthSession | null> => {
      switch (task.kind) {
        case 'boot':
          return restore_allocation_wallet(account.restore)
        case 'google':
        case 'wallet':
          return account.connect(task.kind === 'wallet' ? task.name : null)
        case 'reconnect':
          client?.reconnect()
          return wallet
        case 'logout':
          await account.sign_out(wallet)
          return null
        default:
          return wallet
      }
    }
    const run = async (state: AllocationState): Promise<void> => {
      let { session } = state
      try {
        session = await authenticate(state.task!, session)
        if (!current(state.sequence)) {
          session?.dispose?.()
          return
        }
        bind(session)
        let status: AllocationStatus | null = null
        let share_intent_url: string | null = null
        if (client) {
          const { request } = client
          share_intent_url = (await operate(request, state.task!, account.provider)) ?? state.share_intent_url
          const result = await request({ action: 'status' })
          if (result.action !== 'status') throw new Error('unavailable')
          ;({ status } = result)
        }
        if (current(state.sequence))
          dispatch({
            type: 'result',
            sequence: state.sequence,
            result: { session, status, share_intent_url, error: null },
          })
      } catch (error) {
        console.warn('Allocation operation could not be confirmed')
        if (current(state.sequence))
          dispatch({
            type: 'result',
            sequence: state.sequence,
            result: {
              session,
              status: state.status,
              share_intent_url: null,
              error: error instanceof Error ? error.message : 'unavailable',
            },
          })
      }
    }
    const stop = store.subscribe((state, previous) => {
      if (previous.session && !state.session) {
        bind(null)
        account.forget()
      }
      if (state.share_intent_url && state.share_intent_url !== previous.share_intent_url)
        location.assign(state.share_intent_url)
      if (state.task && state.sequence !== previous.sequence) void run(state)
    })
    dispatch({ type: 'request', task: { kind: 'boot' } })
    return () => {
      active = false
      stop()
      bind(null)
      account.dispose()
    }
  }
  return { store, dispatch, observe }
}
export type AllocationRuntime = ReturnType<typeof create_allocation_runtime>
