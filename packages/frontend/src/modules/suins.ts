// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { SuinsSelection, SuinsSnapshot } from '@aresrpg/sdk/auth'

import type { AppInput, AppModule, AppState } from '../store.ts'

type Request = Readonly<{ kind: 'load' }> | Readonly<{ kind: 'set'; name: string }>
export type SuinsState = Readonly<{
  snapshot: SuinsSnapshot | null
  draft: string
  request: Request | null
  error: 'read_failed' | 'write_failed' | 'invalid_name' | 'not_targeted' | null
  confirmed: boolean
}>
export type SuinsInput =
  | Readonly<{ type: 'suins/name_changed'; name: string }>
  | Readonly<{ type: 'suins/refresh' }>
  | Readonly<{ type: 'suins/use' }>
  | Readonly<{ type: 'suins/loaded'; request: Request; snapshot: SuinsSnapshot }>
  | Readonly<{ type: 'suins/used'; request: Request; result: SuinsSelection }>
  | Readonly<{ type: 'suins/failed'; request: Request; error: 'read_failed' | 'write_failed' }>

export const initial_suins_state = (): SuinsState => ({
  snapshot: null,
  draft: '',
  request: null,
  error: null,
  confirmed: false,
})

const complete = (state: SuinsState, input: Extract<SuinsInput, { request: Request }>): SuinsState => {
  if (input.request !== state.request) return state
  switch (input.type) {
    case 'suins/loaded':
      return { ...state, snapshot: input.snapshot, request: null }
    case 'suins/failed':
      return { ...state, request: null, error: input.error }
    case 'suins/used':
      if (!input.result.ok) return { ...state, request: null, error: input.result.reason }
      return {
        ...state,
        snapshot: { default_name: input.result.name, names: state.snapshot?.names ?? [] },
        draft: input.result.name,
        request: null,
        confirmed: true,
      }
  }
}

export const reduce_suins = (state: SuinsState, input: SuinsInput): SuinsState => {
  if ('request' in input) return complete(state, input)
  if (state.request) return state
  switch (input.type) {
    case 'suins/name_changed':
      return { ...state, draft: input.name, error: null, confirmed: false }
    case 'suins/refresh':
      return { ...state, request: { kind: 'load' }, error: null, confirmed: false }
    case 'suins/use':
      return state.draft.trim()
        ? { ...state, request: { kind: 'set', name: state.draft.trim() }, error: null, confirmed: false }
        : state
  }
}

const is_suins_input = (input: AppInput): input is SuinsInput => input.type.startsWith('suins/')
const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected')
    return { ...state, suins: initial_suins_state() }
  if (!state.session.wallet || !is_suins_input(input)) return state
  const suins = reduce_suins(state.suins, input)
  return suins === state.suins ? state : { ...state, suins }
}

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state, signal }) => {
  events.on('STATE_UPDATED', (state, previous) => {
    const { wallet } = state.session
    if (!wallet) return
    const opened =
      state.navigation.page === 'settings' &&
      (previous.navigation.page !== 'settings' || wallet !== previous.session.wallet)
    if (opened) dispatch({ type: 'suins/refresh' })
    const { request } = state.suins
    if (!request || request === previous.suins.request) return
    const current = () =>
      !signal.aborted && get_state().session.wallet === wallet && get_state().suins.request === request
    const operation: Promise<SuinsInput> =
      request.kind === 'load'
        ? wallet.suins.snapshot().then((snapshot) => ({ type: 'suins/loaded', request, snapshot }))
        : wallet.suins.set_default(request.name).then((result) => ({ type: 'suins/used', request, result }))
    void operation
      .then((input) => {
        if (current()) dispatch(input)
      })
      .catch((error: unknown) => {
        console.warn('SuiNS request failed.', error)
        if (current())
          dispatch({ type: 'suins/failed', request, error: request.kind === 'load' ? 'read_failed' : 'write_failed' })
      })
  })
  const state = get_state()
  if (state.session.wallet && state.navigation.page === 'settings') dispatch({ type: 'suins/refresh' })
}

export default { name: 'suins', reduce, observe } satisfies AppModule
