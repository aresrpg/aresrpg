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
import type { AppInput, SiteModule, SiteState } from '../store.ts'
import { run_direct_transaction } from '../transaction_guard.ts'
import { sui_session } from '../wallet/external_session.ts'

export type WalletImportFailure =
  | Readonly<{ kind: 'funding'; payer: 'source' | 'owner'; required_mist: bigint }>
  | Readonly<{ kind: 'busy' }>
  /** `resumable`: the source wallet already offered; the next import finishes it without a new offer. */
  | Readonly<{ kind: 'failed'; message: string; resumable: boolean }>

/** Where the window is. Only `loading` and `importing` wait on an operation; its results name it by `sequence`. */
export type WalletImportStep =
  | Readonly<{ kind: 'idle' }>
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'ready'; plan: WalletImportPlan }>
  | Readonly<{ kind: 'importing'; plan: WalletImportPlan; progress: WalletImportProgress | null }>
  | Readonly<{ kind: 'done'; moved: number; left: WalletImportPlan['left'] }>
  | Readonly<{ kind: 'failed'; error: WalletImportFailure }>

export type WalletImportState = Readonly<{
  open: boolean
  /** The connected wallet this window state describes. Another wallet starts from a clean state. */
  source: AuthSession | null
  /** Counts the reads and imports this window started. It never resets, so a late result cannot match a newer one. */
  sequence: number
  step: WalletImportStep
}>

export type WalletImportInput =
  | Readonly<{ type: 'wallet_import/open' }>
  | Readonly<{ type: 'wallet_import/close' }>
  | Readonly<{ type: 'wallet_import/refresh' }>
  | Readonly<{ type: 'wallet_import/loaded'; sequence: number; plan: WalletImportPlan }>
  | Readonly<{ type: 'wallet_import/start' }>
  | Readonly<{ type: 'wallet_import/progress'; sequence: number; progress: WalletImportProgress }>
  | Readonly<{ type: 'wallet_import/finished'; sequence: number; plan: WalletImportPlan }>
  | Readonly<{ type: 'wallet_import/failed'; sequence: number; error: WalletImportFailure }>

const IDLE: WalletImportStep = Object.freeze({ kind: 'idle' })

export const initial_wallet_import_state = (sequence = 0): WalletImportState =>
  Object.freeze({ open: false, source: null, sequence, step: IDLE })

/** Characters the game roster can still receive. */
export const free_character_slots = (state: SiteState): number =>
  Math.max(0, MAX_TRACKED_CHARACTERS - state.session.characters.length)

type Step<Type extends WalletImportInput['type']> = (
  state: WalletImportState,
  input: Extract<WalletImportInput, { type: Type }>
) => WalletImportState

const with_step = (state: WalletImportState, step: WalletImportStep): WalletImportState =>
  Object.freeze({ ...state, step })
const begin = (state: WalletImportState, step: WalletImportStep): WalletImportState =>
  with_step({ ...state, sequence: state.sequence + 1 }, step)
const waiting = ({ step }: WalletImportState): boolean => step.kind === 'loading' || step.kind === 'importing'
/** The result answers the operation the window waits on now. */
const answers = (state: WalletImportState, sequence: number): boolean => waiting(state) && state.sequence === sequence

const STEPS: { [Type in WalletImportInput['type']]: Step<Type> } = {
  'wallet_import/open': (state) =>
    state.open ? state : Object.freeze({ ...initial_wallet_import_state(state.sequence), open: true }),
  // A running import keeps signing; closing the window cannot hide it.
  'wallet_import/close': (state) =>
    state.step.kind === 'importing' ? state : initial_wallet_import_state(state.sequence),
  'wallet_import/refresh': (state) => (state.source && !waiting(state) ? begin(state, { kind: 'loading' }) : state),
  'wallet_import/loaded': (state, input) =>
    answers(state, input.sequence) && state.step.kind === 'loading'
      ? with_step(state, { kind: 'ready', plan: input.plan })
      : state,
  'wallet_import/start': (state) =>
    state.step.kind === 'ready' ? begin(state, { kind: 'importing', plan: state.step.plan, progress: null }) : state,
  'wallet_import/progress': (state, input) =>
    answers(state, input.sequence) && state.step.kind === 'importing'
      ? with_step(state, { ...state.step, progress: input.progress })
      : state,
  'wallet_import/finished': (state, input) =>
    answers(state, input.sequence) && state.step.kind === 'importing'
      ? with_step(state, { kind: 'done', moved: input.plan.assets, left: input.plan.left })
      : state,
  'wallet_import/failed': (state, input) =>
    answers(state, input.sequence) ? with_step(state, { kind: 'failed', error: input.error }) : state,
}

/** An open window reads each newly connected wallet once. A running import keeps its own wallet. */
const follow_source = (state: WalletImportState, source: AuthSession | null): WalletImportState => {
  if (!state.open || state.step.kind === 'importing' || state.source === source) return state
  const clean = Object.freeze({ ...initial_wallet_import_state(state.sequence), open: true, source })
  return source ? begin(clean, { kind: 'loading' }) : clean
}

export const reduce_wallet_import = (
  state: WalletImportState,
  input: AppInput,
  source: AuthSession | null
): WalletImportState => {
  const step = STEPS[input.type as WalletImportInput['type']] as Step<WalletImportInput['type']> | undefined
  return follow_source(step ? step(state, input as WalletImportInput) : state, source)
}

/** The import signs with the connected wallets: while it runs, the wallet selection must not change. */
export const wallet_import_operation = ({ step }: WalletImportState): 'import' | null =>
  step.kind === 'importing' ? 'import' : null

const reduce = <S extends SiteState>(state: S, input: AppInput): S => {
  if (input.type === 'auth/disconnected' || input.type === 'auth/rejected')
    return { ...state, wallet_import: initial_wallet_import_state(state.wallet_import.sequence) }
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

const observe: NonNullable<SiteModule['observe']> = ({ events, dispatch, get_state, signal }) => {
  const fail = (sequence: number, error: unknown): void => {
    if (signal.aborted) return
    const failure = import_failure(error, get_state().copy)
    dispatch({ type: 'wallet_import/failed', sequence, error: failure })
    // Only the game wallet uses the game's funding window. The source wallet is funded by its owner.
    if (failure.kind === 'funding' && failure.payer === 'owner')
      dispatch({ type: 'funding/open', cost_mist: failure.required_mist })
  }
  const read = (state: SiteState): void => {
    const { wallet } = state.session
    const { source, sequence } = state.wallet_import
    if (!wallet || !source) return dispatch({ type: 'wallet_import/close' })
    void wallet
      .read_wallet_import(source, free_character_slots(state))
      .then((plan) => {
        if (!signal.aborted) dispatch({ type: 'wallet_import/loaded', sequence, plan })
      })
      .catch((error: unknown) => {
        console.error('The source wallet could not be read.', error)
        fail(sequence, error)
      })
  }
  const run_import = (state: SiteState, plan: WalletImportPlan): void => {
    const { wallet } = state.session
    const { source, sequence } = state.wallet_import
    if (!wallet || !source) return fail(sequence, new Error('The connected wallet changed.'))
    // The game wallet pays the royalty of every asset. Fund it before the source wallet signs anything.
    // The window says so itself: the funding window alone leaves no reason behind once it is closed.
    if (funding_shortfall(plan.royalty_mist, state.session.sui_balance_mist ?? 0n) > 0n)
      return fail(sequence, new WalletImportFundingRequired('owner', plan.royalty_mist))
    // The live connections decide, not this window's memory of them: a wallet that disconnected
    // or changed account during the run must stop the next signature.
    const before_sign = (): void => {
      const now = get_state()
      if (signal.aborted || now.session.wallet !== wallet || sui_session(now.external_wallet.session) !== source)
        throw new Error('The connected wallet changed.')
    }
    const operation = run_direct_transaction(async () => {
      const moved = await wallet.import_wallet_assets(source, {
        character_slots: free_character_slots(get_state()),
        before_sign,
        on_progress: (progress) => dispatch({ type: 'wallet_import/progress', sequence, progress }),
      })
      if (!signal.aborted) dispatch({ type: 'wallet_import/finished', sequence, plan: moved })
    })
    if (!operation) return dispatch({ type: 'wallet_import/failed', sequence, error: { kind: 'busy' } })
    void operation
      .catch((error: unknown) => {
        console.error('The wallet import stopped.', error)
        fail(sequence, error)
      })
      .finally(() => dispatch({ type: 'wallet/refresh' }))
  }
  // A read or an import follows the observed state change, never the input that caused it.
  events.on('STATE_UPDATED', (state, previous) => {
    const { step, sequence } = state.wallet_import
    if (sequence === previous.wallet_import.sequence) return
    if (step.kind === 'loading') read(state)
    if (step.kind === 'importing') run_import(state, step.plan)
  })
}

export default Object.freeze({
  name: 'wallet_import',
  initial: () => ({ wallet_import: initial_wallet_import_state() }),
  reduce,
  observe,
}) satisfies SiteModule
