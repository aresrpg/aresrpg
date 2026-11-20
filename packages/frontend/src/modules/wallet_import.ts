// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

// A player moves the characters and items of another wallet they own into the game wallet.
// The source wallet's assets live only in this window state. They never enter the game inventory:
// moved assets arrive there through the normal receipt and packet path.

import { MAX_TRACKED_CHARACTERS } from '@aresrpg/protocol'
import { AgentHandoverIncomplete } from '@aresrpg/sdk/agent-handover'
import {
  WalletImportFundingRequired,
  type WalletImportPlan,
  type WalletImportProgress,
} from '@aresrpg/sdk/wallet-import'

import type { AuthSession } from '../auth.ts'
import { funding_shortfall } from '../funding/near.ts'
import type { AppCopy } from '../i18n/copy.ts'
import { player_error_text } from '../i18n/player_error.ts'
import type { AppInput, AppModule, AppState } from '../store.ts'
import { run_direct_transaction } from '../transaction_guard.ts'
import { sui_session } from '../wallet/external_session.ts'

export type WalletImportFailure =
  | Readonly<{ kind: 'funding'; payer: 'source' | 'owner'; required_mist: bigint }>
  | Readonly<{ kind: 'busy' }>
  /** `resumable`: the source wallet already offered; the next import finishes it without a new offer. */
  | Readonly<{ kind: 'failed'; message: string; resumable: boolean }>

export type WalletImportState = Readonly<{
  open: boolean
  /** The connected wallet this window state describes. Another wallet starts from a clean state. */
  source: AuthSession | null
  pending: 'load' | 'import' | null
  plan: WalletImportPlan | null
  progress: WalletImportProgress | null
  done: Readonly<{ moved: number; left: WalletImportPlan['left'] }> | null
  error: WalletImportFailure | null
}>

export type WalletImportInput =
  | Readonly<{ type: 'wallet_import/open' }>
  | Readonly<{ type: 'wallet_import/close' }>
  | Readonly<{ type: 'wallet_import/refresh' }>
  | Readonly<{ type: 'wallet_import/loaded'; source: AuthSession; plan: WalletImportPlan }>
  | Readonly<{ type: 'wallet_import/start' }>
  | Readonly<{ type: 'wallet_import/running' }>
  | Readonly<{ type: 'wallet_import/progress'; progress: WalletImportProgress }>
  | Readonly<{ type: 'wallet_import/finished'; plan: WalletImportPlan }>
  | Readonly<{ type: 'wallet_import/failed'; error: WalletImportFailure }>

export const initial_wallet_import_state = (): WalletImportState =>
  Object.freeze({ open: false, source: null, pending: null, plan: null, progress: null, done: null, error: null })

/** Characters the game roster can still receive. */
export const free_character_slots = (state: AppState): number =>
  Math.max(0, MAX_TRACKED_CHARACTERS - state.session.characters.length)

type Step<Type extends WalletImportInput['type']> = (
  state: WalletImportState,
  input: Extract<WalletImportInput, { type: Type }>
) => WalletImportState

const reading = (state: WalletImportState): WalletImportState =>
  Object.freeze({ ...state, pending: 'load', plan: null, done: null, error: null })

const STEPS: { [Type in WalletImportInput['type']]: Step<Type> } = {
  'wallet_import/open': (state) =>
    state.open ? state : Object.freeze({ ...initial_wallet_import_state(), open: true }),
  // A running import keeps signing; closing the window cannot hide it.
  'wallet_import/close': (state) => (state.pending === 'import' ? state : initial_wallet_import_state()),
  'wallet_import/refresh': (state) => (state.source && !state.pending ? reading(state) : state),
  'wallet_import/loaded': (state, input) =>
    state.pending === 'load' && input.source === state.source
      ? Object.freeze({ ...state, pending: null, plan: input.plan })
      : state,
  'wallet_import/start': (state) => state,
  'wallet_import/running': (state) =>
    state.plan && !state.pending ? Object.freeze({ ...state, pending: 'import', progress: null, error: null }) : state,
  'wallet_import/progress': (state, input) =>
    state.pending === 'import' ? Object.freeze({ ...state, progress: input.progress }) : state,
  'wallet_import/finished': (state, input) =>
    Object.freeze({
      ...state,
      pending: null,
      plan: null,
      progress: null,
      done: Object.freeze({ moved: input.plan.assets, left: input.plan.left }),
    }),
  'wallet_import/failed': (state, input) =>
    Object.freeze({ ...state, pending: null, progress: null, error: input.error }),
}

/** An open window reads each newly connected wallet once. A running import keeps its own wallet. */
const follow_source = (state: WalletImportState, source: AuthSession | null): WalletImportState => {
  if (!state.open || state.pending === 'import' || state.source === source) return state
  const clean = Object.freeze({ ...initial_wallet_import_state(), open: true, source })
  return source ? reading(clean) : clean
}

export const reduce_wallet_import = (
  state: WalletImportState,
  input: AppInput,
  source: AuthSession | null
): WalletImportState => {
  const step = STEPS[input.type as WalletImportInput['type']] as Step<WalletImportInput['type']> | undefined
  return follow_source(step ? step(state, input as WalletImportInput) : state, source)
}

const reduce = (state: AppState, input: AppInput): AppState => {
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected')
    return { ...state, wallet_import: initial_wallet_import_state() }
  const next = reduce_wallet_import(state.wallet_import, input, sui_session(state.external_wallet.session))
  return next === state.wallet_import ? state : { ...state, wallet_import: next }
}

/** The technical cause stays in the console; the window shows the player's version. */
export const import_failure = (error: unknown, copy: AppCopy | null): WalletImportFailure => {
  const cause = error instanceof AgentHandoverIncomplete ? error.cause : error
  if (cause instanceof WalletImportFundingRequired)
    return { kind: 'funding', payer: cause.payer, required_mist: cause.required_mist }
  return {
    kind: 'failed',
    message: copy ? player_error_text(copy, cause) : String(cause),
    resumable: error instanceof AgentHandoverIncomplete,
  }
}

type ImportRequest = Readonly<{ wallet: AuthSession; source: AuthSession; plan: WalletImportPlan }>

const import_request = (state: AppState): ImportRequest | null => {
  const { wallet } = state.session
  const { source, plan, pending } = state.wallet_import
  return wallet && source && plan && !pending ? { wallet, source, plan } : null
}

const observe: NonNullable<AppModule['observe']> = ({ events, dispatch, get_state, signal }) => {
  const current = (source: AuthSession): boolean => !signal.aborted && get_state().wallet_import.source === source
  const fail = (error: unknown): void => {
    const failure = import_failure(error, get_state().copy)
    dispatch({ type: 'wallet_import/failed', error: failure })
    // Only the game wallet uses the game's funding window. The source wallet is funded by its owner.
    if (failure.kind === 'funding' && failure.payer === 'owner')
      dispatch({ type: 'funding/open', cost_mist: failure.required_mist })
  }
  const read = (state: AppState): void => {
    const { wallet } = state.session
    const { source } = state.wallet_import
    if (!wallet || !source) return dispatch({ type: 'wallet_import/close' })
    void wallet
      .read_wallet_import(source, free_character_slots(state))
      .then((plan) => {
        if (current(source)) dispatch({ type: 'wallet_import/loaded', source, plan })
      })
      .catch((error: unknown) => {
        console.error('The source wallet could not be read.', error)
        if (current(source)) fail(error)
      })
  }
  // The read follows the observed state change, never the input that caused it.
  events.on('STATE_UPDATED', (state, previous) => {
    const before = previous.wallet_import
    const now = state.wallet_import
    if (now.pending === 'load' && (before.pending !== 'load' || before.source !== now.source)) read(state)
  })
  events.on('wallet_import/start', () => {
    const state = get_state()
    const request = import_request(state)
    if (!request) return
    const { wallet, source, plan } = request
    // The game wallet pays the royalty of every asset. Fund it before the source wallet signs anything.
    // The window says so itself: the funding window alone leaves no reason behind once it is closed.
    if (funding_shortfall(plan.royalty_mist, state.session.sui_balance_mist ?? 0n) > 0n)
      return fail(new WalletImportFundingRequired('owner', plan.royalty_mist))
    // The live connections decide, not this window's memory of them: a wallet that disconnected
    // or changed account during the run must stop the next signature.
    const before_sign = (): void => {
      const now = get_state()
      if (signal.aborted || now.session.wallet !== wallet || sui_session(now.external_wallet.session) !== source)
        throw new Error('The connected wallet changed.')
    }
    const operation = run_direct_transaction(async () => {
      dispatch({ type: 'wallet_import/running' })
      const moved = await wallet.import_wallet_assets(source, {
        character_slots: free_character_slots(get_state()),
        before_sign,
        on_progress: (progress) => dispatch({ type: 'wallet_import/progress', progress }),
      })
      dispatch({ type: 'wallet_import/finished', plan: moved })
    })
    if (!operation) return dispatch({ type: 'wallet_import/failed', error: { kind: 'busy' } })
    void operation
      .catch((error: unknown) => {
        console.error('The wallet import stopped.', error)
        fail(error)
      })
      .finally(() => dispatch({ type: 'wallet/refresh' }))
  })
}

export default Object.freeze({ name: 'wallet_import', reduce, observe }) satisfies AppModule
