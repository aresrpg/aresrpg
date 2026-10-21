// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { createStore } from 'zustand/vanilla'
import type { AllocationRequest, AllocationResult } from '@aresrpg/protocol'
import type { AllocationStatus } from '@aresrpg/immutable/allocation'

import type { Auth, AuthSession } from '../auth.ts'
import { browser_auth_storage, clear_auth_wallet, read_auth_wallet, remember_auth_wallet } from '../auth_storage.ts'

import { create_allocation_client } from './client.ts'

export type AllocationTask =
  | Readonly<{ kind: 'boot' | 'google' | 'logout' | 'load' | 'link_x' }>
  | Readonly<{ kind: 'verify'; wallet: AuthSession }>
  | Readonly<{ kind: 'remove' | 'share'; address: string }>
  | Readonly<{ kind: 'submit'; address: string; urls: readonly string[] }>
type Result = Readonly<{
  google: AuthSession | null
  status: AllocationStatus | null
  error: string | null
  share_url: string | null
}>
export type AllocationState = Result & Readonly<{ task: AllocationTask | null; sequence: number }>
type Input =
  | Readonly<{ type: 'request'; task: AllocationTask }>
  | Readonly<{ type: 'result'; sequence: number; result: Result }>
  | Readonly<{ type: 'invalidated'; wallet: AuthSession }>
export const initial_allocation = (): AllocationState => ({
  google: null,
  status: null,
  task: null,
  sequence: 0,
  error: null,
  share_url: null,
})
export const reduce_allocation = (state: AllocationState, input: Input): AllocationState => {
  switch (input.type) {
    case 'request': {
      if (state.task) return state
      const cleared = input.task.kind === 'logout' ? { status: null, share_url: null } : {}
      return { ...state, ...cleared, task: input.task, sequence: state.sequence + 1, error: null }
    }
    case 'invalidated':
      return state.google !== input.wallet ? state : { ...initial_allocation(), sequence: state.sequence + 1 }
    case 'result':
      return state.sequence !== input.sequence ? state : { ...state, ...input.result, task: null }
  }
}
type Request = (request: AllocationRequest) => Promise<AllocationResult>
const verify = async (request: Request, wallet: AuthSession): Promise<void> => {
  const challenge = await request({ action: 'wallet_challenge', address: wallet.address, label: wallet.wallet_name })
  if (challenge.action !== 'wallet_challenge') throw new Error('unavailable')
  const { signature } = await wallet.sign_personal_message(new TextEncoder().encode(challenge.message))
  await request({ action: 'wallet_verify', nonce: challenge.nonce, signature })
}
const complete_link = async (request: Request): Promise<void> => {
  const url = new URL(location.href)
  const token = url.searchParams.get('linked')
  if (!token) return
  await request({ action: 'complete_x', token })
  url.searchParams.delete('linked')
  history.replaceState(null, '', url)
}
const operate = async (request: Request, task: AllocationTask): Promise<string | null> => {
  switch (task.kind) {
    case 'verify':
      await verify(request, task.wallet)
      break
    case 'submit':
      await request({ action: 'submit', address: task.address, urls: task.urls })
      break
    case 'remove':
      await request({ action: 'wallet_remove', address: task.address })
      break
    case 'share': {
      const result = await request({ action: 'share', address: task.address })
      if (result.action !== 'share') throw new Error('unavailable')
      return result.url
    }
    case 'link_x': {
      const result = await request({ action: 'link_x' })
      if (result.action !== 'link_x') throw new Error('unavailable')
      location.assign(result.url)
      break
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
    let auth: Auth | null = null
    let client: ReturnType<typeof create_allocation_client> | null = null
    let client_wallet: AuthSession | null = null
    let stop_wallet = (): void => {}
    const storage = browser_auth_storage()
    const current = (sequence: number): boolean => active && store.getState().sequence === sequence
    const bind = (wallet: AuthSession | null): void => {
      if (wallet === client_wallet) return
      stop_wallet()
      client?.dispose()
      client_wallet?.dispose?.()
      client_wallet = wallet
      client = wallet ? create_allocation_client(wallet) : null
      stop_wallet = wallet?.on_invalidated?.(() => dispatch({ type: 'invalidated', wallet })) ?? (() => {})
    }
    const get_auth = async (): Promise<Auth> => {
      if (auth) return auth
      const { create_auth } = await import('../auth.ts')
      if (!active) throw new Error('unavailable')
      auth = create_auth()
      return auth
    }
    const authenticate = async (task: AllocationTask, wallet: AuthSession | null): Promise<AuthSession | null> => {
      switch (task.kind) {
        case 'boot': {
          const name = read_auth_wallet(storage)
          return name ? (await get_auth()).restore(name) : null
        }
        case 'google': {
          const session = await (await get_auth()).connect_google()
          remember_auth_wallet(storage, session.wallet_name)
          return session
        }
        case 'logout':
          await wallet?.disconnect()
          clear_auth_wallet(storage)
          return null
        default:
          return wallet
      }
    }
    const run = async (state: AllocationState): Promise<void> => {
      let { google } = state
      try {
        google = await authenticate(state.task!, google)
        if (!current(state.sequence)) {
          google?.dispose?.()
          return
        }
        bind(google)
        let status: AllocationStatus | null = null
        let share_url: string | null = null
        if (client) {
          const { request } = client
          await complete_link(request)
          share_url = (await operate(request, state.task!)) ?? state.share_url
          const result = await request({ action: 'status' })
          if (result.action !== 'status') throw new Error('unavailable')
          ;({ status } = result)
        }
        if (current(state.sequence))
          dispatch({
            type: 'result',
            sequence: state.sequence,
            result: { google, status, share_url, error: new URLSearchParams(location.search).get('error') },
          })
      } catch (error) {
        console.warn('Allocation operation could not be confirmed')
        if (current(state.sequence))
          dispatch({
            type: 'result',
            sequence: state.sequence,
            result: {
              google,
              status: state.status,
              share_url: null,
              error: error instanceof Error ? error.message : 'unavailable',
            },
          })
      }
    }
    const stop = store.subscribe((state, previous) => {
      if (previous.google && !state.google) {
        bind(null)
        clear_auth_wallet(storage)
      }
      if (state.task && state.sequence !== previous.sequence) void run(state)
    })
    dispatch({ type: 'request', task: { kind: 'boot' } })
    return () => {
      active = false
      stop()
      bind(null)
      auth?.dispose()
    }
  }
  return { store, dispatch, observe }
}
export type AllocationRuntime = ReturnType<typeof create_allocation_runtime>
