// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { transaction_failure_kind } from '@aresrpg/sdk/transaction-error'
import type { SuinsSnapshot } from '@aresrpg/sdk/auth'
import type { AgentPairingIdentity } from '@aresrpg/protocol'
import { application_suins_name } from '@aresrpg/immutable'

import type { AppContext, AppInput, AppModule, AppState } from '../store.ts'
import type { AuthSession } from '../auth.ts'
import { env } from '../env.ts'
import { sui_session } from '../wallet/external_session.ts'
import { create_hosted_client, prepare_standalone_hosted } from '../agents/hosted_client.ts'

type Request =
  | Readonly<{ kind: 'load' }>
  | Readonly<{
      kind: 'set'
      name: string
      pairing: AgentPairingIdentity | null
      source: 'settings' | 'setup'
    }>
type Failure = 'read_failed' | 'write_failed' | 'invalid_parent' | 'collision' | 'metadata' | 'unsupported'
type Pending = Readonly<{ pairing: AgentPairingIdentity; reason: ReturnType<typeof transaction_failure_kind> }>
export type SuinsState = Readonly<{
  snapshot: SuinsSnapshot | null
  draft: string
  request: Request | null
  error: Failure | null
  confirmed: boolean
  pending: Pending | null
  waiters: readonly string[]
  completed: readonly string[]
  setup: AgentPairingIdentity | null
}>
export type SuinsInput =
  | Readonly<{ type: 'suins/reset' }>
  | Readonly<{ type: 'suins/close' }>
  | Readonly<{ type: 'suins/name_changed'; name: string }>
  | Readonly<{ type: 'suins/refresh' }>
  | Readonly<{ type: 'suins/use' }>
  | Readonly<{ type: 'suins/setup_started'; token: string }>
  | Readonly<{ type: 'suins/setup'; pairing: AgentPairingIdentity; token: string }>
  | Readonly<{ type: 'suins/cancel_setup'; token: string }>
  | Readonly<{ type: 'suins/loaded'; request: Request; snapshot: SuinsSnapshot }>
  | Readonly<{ type: 'suins/applied'; request: Request; name: string }>
  | Readonly<{ type: 'suins/used'; request: Request; pending: Pending | null }>
  | Readonly<{ type: 'suins/failed'; request: Request; error: Failure }>

export const initial_suins_state = (): SuinsState => ({
  snapshot: null,
  draft: '',
  request: null,
  error: null,
  confirmed: false,
  pending: null,
  waiters: [],
  completed: [],
  setup: null,
})
const finish = (state: SuinsState): SuinsState => ({
  ...state,
  request: null,
  setup: null,
  completed: state.waiters,
  waiters: [],
})
const applied_parent = (snapshot: SuinsSnapshot | null): string => {
  const name = snapshot?.default_name && application_suins_name(snapshot.default_name)
  return name && name.kind === 'player' ? name.parent : ''
}
const setup_request = (state: SuinsState, pairing: AgentPairingIdentity): SuinsState => {
  const name = applied_parent(state.snapshot)
  return name ? { ...state, setup: null, request: { kind: 'set', name, pairing, source: 'setup' } } : finish(state)
}
const complete = (state: SuinsState, input: Extract<SuinsInput, { request: Request }>): SuinsState => {
  if (input.request !== state.request) return state
  switch (input.type) {
    case 'suins/loaded': {
      const parent = applied_parent(input.snapshot)
      const draft = input.snapshot.names.some(({ name }) => name === parent) ? parent : ''
      const loaded = { ...state, snapshot: input.snapshot, draft, request: null }
      return state.setup ? setup_request(loaded, state.setup) : loaded
    }
    case 'suins/applied':
      return { ...state, snapshot: { default_name: input.name, names: state.snapshot!.names } }
    case 'suins/failed':
      return { ...finish(state), error: input.error }
    case 'suins/used':
      return { ...finish(state), pending: input.pending, confirmed: true }
  }
}
type Intent = Exclude<SuinsInput, { request: Request }>
const intents: { [K in Intent['type']]: (state: SuinsState, input: Extract<Intent, { type: K }>) => SuinsState } = {
  'suins/reset': (state) => ({ ...initial_suins_state(), completed: [...state.completed, ...state.waiters] }),
  'suins/close': (state) =>
    state.request?.kind === 'set' && state.request.source === 'settings' ? finish(state) : state,
  'suins/cancel_setup': (state, input) => {
    const waiters = state.waiters.filter((token) => token !== input.token)
    const next = { ...state, waiters, setup: waiters.length ? state.setup : null }
    const setup_only = state.request?.kind === 'set' && state.request.source === 'setup'
    return !waiters.length && setup_only ? finish(next) : next
  },
  'suins/setup_started': (state, input) => ({ ...state, waiters: [...state.waiters, input.token] }),
  'suins/setup': (state, input) => {
    if (state.completed.includes(input.token)) return state
    const waiters = state.waiters.includes(input.token) ? state.waiters : [...state.waiters, input.token]
    const next = { ...state, waiters }
    if (state.request?.kind === 'set') return next
    return { ...next, setup: input.pairing, request: state.request ?? { kind: 'load' } }
  },
  'suins/name_changed': (state, input) => ({
    ...state,
    draft: input.name,
    error: null,
    confirmed: false,
    pending: null,
  }),
  'suins/refresh': (state) => ({ ...state, request: { kind: 'load' }, error: null, confirmed: false }),
  'suins/use': (state) =>
    state.draft
      ? {
          ...state,
          request: { kind: 'set', name: state.draft, pairing: null, source: 'settings' },
          error: null,
          confirmed: false,
          pending: null,
        }
      : state,
}
export const reduce_suins = (state: SuinsState, input: SuinsInput): SuinsState => {
  if ('request' in input) return complete(state, input)
  const concurrent = [
    'suins/setup',
    'suins/setup_started',
    'suins/cancel_setup',
    'suins/reset',
    'suins/close',
  ].includes(input.type)
  if (state.request && !concurrent) return state
  return intents[input.type](state, input as never)
}
const is_suins_input = (input: AppInput): input is SuinsInput => input.type.startsWith('suins/')
const reduce = (state: AppState, input: AppInput): AppState => {
  if (['auth/disconnected', 'auth/rejected'].includes(input.type)) return { ...state, suins: initial_suins_state() }
  if (!state.session.wallet || !is_suins_input(input)) return state
  if (!state.session.wallet.suins.managed && ['suins/use', 'suins/setup'].includes(input.type)) return state
  const suins = reduce_suins(state.suins, input)
  return suins === state.suins ? state : { ...state, suins }
}

const reconcile = async (
  context: AppContext,
  wallet: AuthSession,
  parent_wallet: AuthSession,
  request: Extract<Request, { kind: 'set' }>,
  before_sign: () => void,
  signal: Readonly<AbortSignal>
): Promise<Pending | null> => {
  before_sign()
  await parent_wallet.suins.validate_parent(request.name, before_sign, wallet.address)
  before_sign()
  const pairing =
    request.pairing ??
    (await prepare_standalone_hosted(create_hosted_client(env.bot_service_url, signal, context), wallet)).pairing
  before_sign()
  // apply_parent freshly revalidates authority and collisions after durable setup.
  const human = await parent_wallet.suins.apply_parent(request.name, pairing.address, before_sign, wallet.address)
  before_sign()
  if (parent_wallet !== wallet) await wallet.suins.set_default(human.name, before_sign)
  before_sign()
  context.dispatch({ type: 'suins/applied', request, name: human.name })
  try {
    await wallet.set_agent_default(pairing, `aresrpgagent.${request.name}`, before_sign)
    return null
  } catch (error) {
    before_sign()
    console.warn('Agent display name remains pending.', error)
    return { pairing, reason: transaction_failure_kind(error) }
  }
}
const failure_reason = (error: unknown): Failure => {
  const cause = error instanceof Error ? error.cause : null
  return cause === 'invalid_parent' || cause === 'collision' || cause === 'metadata' || cause === 'unsupported'
    ? cause
    : 'write_failed'
}
const observe: NonNullable<AppModule['observe']> = (context) => {
  const { events, dispatch, get_state, signal } = context
  let controller = new AbortController()
  events.on('STATE_UPDATED', (state, previous) => {
    if ([previous.navigation.page === 'settings', state.navigation.page !== 'settings'].every(Boolean))
      dispatch({ type: 'suins/close' })
    const { wallet } = state.session
    if (!wallet) {
      controller.abort()
      return
    }
    const identity_changed = [
      wallet !== previous.session.wallet,
      state.external_wallet.session !== previous.external_wallet.session,
      state.external_wallet.sequence !== previous.external_wallet.sequence,
    ].some(Boolean)
    if (identity_changed) {
      dispatch({ type: 'suins/reset' })
      dispatch({ type: 'suins/refresh' })
      return
    }
    if ([state.navigation.page === 'settings', previous.navigation.page !== 'settings'].every(Boolean))
      dispatch({ type: 'suins/refresh' })
    const parent_wallet = sui_session(state.external_wallet.session) ?? wallet
    const source = state.external_wallet
    const { request } = state.suins
    if (request === previous.suins.request) return
    controller.abort()
    if (!request) return
    controller = new AbortController()
    const lifetime = AbortSignal.any([signal, controller.signal])
    const current = () =>
      [
        !lifetime.aborted,
        get_state().session.wallet === wallet,
        get_state().suins.request === request,
        get_state().external_wallet.session === source.session,
        get_state().external_wallet.sequence === source.sequence,
      ].every(Boolean)
    const before_sign = () => {
      if (!current() || source.request !== null) throw new Error('SuiNS request cancelled')
    }
    const operation: Promise<SuinsInput> =
      request.kind === 'load'
        ? Promise.all([wallet.suins.snapshot(), parent_wallet === wallet ? null : parent_wallet.suins.snapshot()]).then(
            ([snapshot, parent]) => ({
              type: 'suins/loaded',
              request,
              snapshot: { ...snapshot, names: parent?.names ?? snapshot.names },
            })
          )
        : reconcile(context, wallet, parent_wallet, request, before_sign, lifetime).then((pending) => ({
            type: 'suins/used',
            request,
            pending,
          }))
    void operation
      .then((input) => {
        if (current()) dispatch(input)
      })
      .catch((error: unknown) => {
        console.warn('SuiNS request failed.', error)
        if (current())
          dispatch({
            type: 'suins/failed',
            request,
            error: request.kind === 'load' ? 'read_failed' : failure_reason(error),
          })
      })
  })
  signal.addEventListener('abort', () => controller.abort(), { once: true })
  if (get_state().session.wallet) dispatch({ type: 'suins/refresh' })
}
export default { name: 'suins', reduce, observe } satisfies AppModule
