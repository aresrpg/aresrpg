// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { transaction_failure_kind } from '@aresrpg/sdk/transaction-error'
import type { SuinsSnapshot, SuinsReview } from '@aresrpg/sdk/auth'
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
      stage: 'prepare' | 'review' | 'apply'
      review?: SuinsReview
    }>
type Failure =
  | 'read_failed'
  | 'write_failed'
  | 'unavailable'
  | 'invalid_parent'
  | 'collision'
  | 'stale_review'
  | 'unsupported'
  | `player_default_${ReturnType<typeof transaction_failure_kind>}`
type Pending = Readonly<{ pairing: AgentPairingIdentity; reason: ReturnType<typeof transaction_failure_kind> }>
export type SuinsState = Readonly<{
  snapshot: SuinsSnapshot | null
  draft: string
  request: Request | null
  error: Failure | null
  confirmed: boolean
  pending: Pending | null
  /** The parent whose two names and two defaults a chain read last showed complete; null is unknown. */
  applied: string | null
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
  | Readonly<{ type: 'suins/confirm' }>
  | Readonly<{ type: 'suins/cancel' }>
  | Readonly<{
      type: 'suins/reviewed'
      request: Extract<Request, { kind: 'set' }>
      pairing: AgentPairingIdentity
      review: SuinsReview
    }>
  | Readonly<{ type: 'suins/setup_started'; token: string }>
  | Readonly<{ type: 'suins/setup'; pairing: AgentPairingIdentity; token: string }>
  | Readonly<{ type: 'suins/cancel_setup'; token: string }>
  | Readonly<{ type: 'suins/loaded'; request: Request; snapshot: SuinsSnapshot }>
  | Readonly<{ type: 'suins/applied'; request: Request; name: string }>
  | Readonly<{ type: 'suins/used'; request: Extract<Request, { kind: 'set' }>; pending: Pending | null }>
  | Readonly<{ type: 'suins/failed'; request: Request; error: Failure }>

export const initial_suins_state = (): SuinsState => ({
  snapshot: null,
  draft: '',
  request: null,
  error: null,
  confirmed: false,
  pending: null,
  applied: null,
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
  return name
    ? { ...state, setup: null, request: { kind: 'set', name, pairing, source: 'setup', stage: 'prepare' } }
    : finish(state)
}
type Completion = Extract<SuinsInput, { request: Request }>
const completions: {
  [K in Completion['type']]: (state: SuinsState, input: Extract<Completion, { type: K }>) => SuinsState
} = {
  'suins/loaded': (state, input) => {
    const parent = applied_parent(input.snapshot)
    const draft = input.snapshot.names.some(({ name }) => name === parent) ? parent : ''
    // A fresh default name that is not the remembered one contradicts it.
    const applied = state.applied === parent ? state.applied : null
    const loaded = { ...state, snapshot: input.snapshot, draft, applied, request: null }
    return state.setup ? setup_request(loaded, state.setup) : loaded
  },
  'suins/reviewed': (state, input) => ({
    ...state,
    request: { ...input.request, pairing: input.pairing, review: input.review, stage: 'review' },
  }),
  'suins/applied': (state, input) => ({
    ...state,
    snapshot: { default_name: input.name, names: state.snapshot!.names },
  }),
  'suins/failed': (state, input) => ({ ...finish(state), error: input.error }),
  'suins/used': (state, input) => ({
    ...finish(state),
    pending: input.pending,
    confirmed: true,
    applied: input.pending ? null : input.request.name,
  }),
}
const complete = (state: SuinsState, input: Completion): SuinsState =>
  input.request === state.request ? completions[input.type](state, input as never) : state
type Intent = Exclude<SuinsInput, { request: Request }>
const intents: { [K in Intent['type']]: (state: SuinsState, input: Extract<Intent, { type: K }>) => SuinsState } = {
  'suins/confirm': (state) =>
    state.request?.kind === 'set' && state.request.stage === 'review'
      ? // Writes start here: what the chain holds is unknown until they complete.
        { ...state, applied: null, request: { ...state.request, stage: 'apply' } }
      : state,
  'suins/cancel': (state) =>
    state.request?.kind === 'set' && state.request.stage === 'review' ? finish(state) : state,
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
    if (state.request?.kind === 'set') {
      if (state.request.pairing && state.request.pairing.address !== input.pairing.address)
        return { ...finish(next), error: 'stale_review' }
      return next
    }
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
          request: { kind: 'set', name: state.draft, pairing: null, source: 'settings', stage: 'prepare' },
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
    'suins/confirm',
    'suins/cancel',
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

const prepare = async (
  context: AppContext,
  wallet: AuthSession,
  parent_wallet: AuthSession,
  request: Extract<Request, { kind: 'set' }>,
  before_sign: () => void,
  signal: Readonly<AbortSignal>
): Promise<SuinsInput> => {
  before_sign()
  const identity = wallet.read_agent_pairing_request?.(crypto.randomUUID())
  if (wallet.identity !== 'zklogin' || identity?.owner !== wallet.address)
    throw new Error('SuiNS unsupported', { cause: 'unsupported' })
  await parent_wallet.suins.validate_parent(request.name, before_sign, wallet.address)
  before_sign()
  const pairing =
    request.pairing ??
    (await prepare_standalone_hosted(create_hosted_client(env.bot_service_url, signal, context), wallet)).pairing
  before_sign()
  const review = await parent_wallet.suins.review_parent(request.name, pairing.address, before_sign, wallet.address)
  before_sign()
  // Nothing to change means nothing to confirm: the request completes like an applied one.
  return review.unchanged
    ? { type: 'suins/used', request, pending: null }
    : { type: 'suins/reviewed', request, pairing, review }
}
const reconcile = async (
  context: AppContext,
  wallet: AuthSession,
  parent_wallet: AuthSession,
  request: Extract<Request, { kind: 'set' }>,
  before_sign: () => void
): Promise<SuinsInput> => {
  before_sign()
  const { pairing, review } = request
  if (!pairing || !review) throw new Error('SuiNS confirmation required')
  // apply_parent freshly revalidates authority and collisions after durable setup.
  const human = await parent_wallet.suins.apply_parent(
    request.name,
    pairing.address,
    before_sign,
    wallet.address,
    review
  )
  before_sign()
  try {
    // `human` is the receipt of the write: the default steps trust it instead of reading the names again.
    if (parent_wallet !== wallet) await wallet.suins.set_default(human.name, before_sign, human)
  } catch (error) {
    before_sign()
    console.warn('Names applied; player default remains pending.', error)
    return { type: 'suins/failed', request, error: `player_default_${transaction_failure_kind(error)}` }
  }
  before_sign()
  context.dispatch({ type: 'suins/applied', request, name: human.name })
  try {
    await wallet.set_agent_default(pairing, `aresrpgagent.${request.name}`, before_sign, human)
    return { type: 'suins/used', request, pending: null }
  } catch (error) {
    before_sign()
    console.warn('Agent display name remains pending.', error)
    return { type: 'suins/used', request, pending: { pairing, reason: transaction_failure_kind(error) } }
  }
}
/** A refusal the player can read; any other failure is an unconfirmed write. */
export const failure_reason = (error: unknown): Failure => {
  const cause = error instanceof Error ? error.cause : null
  const failures = ['invalid_parent', 'collision', 'stale_review', 'unsupported', 'unavailable'] as const
  return failures.find((reason) => reason === cause) ?? 'write_failed'
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
      if (!current() || get_state().external_wallet.request !== null) throw new Error('SuiNS request cancelled')
    }
    const operations = {
      load: async (): Promise<SuinsInput> => {
        const [snapshot, parent] = await Promise.all([
          wallet.suins.snapshot(),
          parent_wallet === wallet ? null : parent_wallet.suins.snapshot(),
        ])
        return { type: 'suins/loaded', request, snapshot: { ...snapshot, names: parent?.names ?? snapshot.names } }
      },
      prepare: () =>
        prepare(context, wallet, parent_wallet, request as Extract<Request, { kind: 'set' }>, before_sign, lifetime),
      apply: () => reconcile(context, wallet, parent_wallet, request as Extract<Request, { kind: 'set' }>, before_sign),
      review: () => null,
    }
    const phase = request.kind === 'load' ? 'load' : request.stage
    const operation = operations[phase]()
    if (!operation) return
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
