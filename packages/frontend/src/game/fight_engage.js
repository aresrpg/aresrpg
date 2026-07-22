// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

const initial_entry_state = () => ({ phase: 'idle', request: null, receipt: null, error: null, retried: false })

/**
 * The fight-entry reducer door. Effects return only as inputs: in particular, an `open_receipt` is the sole
 * transition that permits the refused entry to be submitted again. This keeps the corrective open out of an
 * abort callback chain and makes the one permitted retry explicit as data.
 * @param {ReturnType<typeof initial_entry_state>} state @param {any} input
 */
export function reduce_fight_entry(state, input) {
  switch (input.type) {
    case 'entry_intent':
      return state.phase === 'idle' ? { ...state, phase: 'entering', request: 'entry' } : state
    case 'entry_refused':
      return state.phase === 'entering' && !state.retried
        ? { ...state, phase: 'opening', request: 'open', error: input.error }
        : { ...state, phase: 'failed', request: null, error: input.error }
    case 'open_receipt':
      return state.phase === 'opening'
        ? { ...state, phase: 'entering', request: 'entry', receipt: input.receipt, error: null, retried: true }
        : state
    case 'entry_receipt':
      return state.phase === 'entering'
        ? { ...state, phase: 'complete', request: null, receipt: input.receipt, error: null }
        : state
    case 'open_failed':
    case 'entry_failed':
      return { ...state, phase: 'failed', request: null, error: input.error }
    default:
      return state
  }
}

/**
 * Run a fight entry through the reducer door. The first refusal may request the shared result-open effect; only
 * its awaited receipt re-enters the reducer and releases one fresh entry submission. A second entry refusal, or
 * any open failure, surfaces untouched.
 * @template T
 * @param {{ submit: () => Promise<T>, recover_refusal?: (error: unknown) => Promise<unknown> }} effects
 * @returns {Promise<T>}
 */
export async function run_fight_entry({ submit, recover_refusal }) {
  let state = reduce_fight_entry(initial_entry_state(), { type: 'entry_intent' })
  while (state.request) {
    if (state.request === 'entry') {
      try {
        const receipt = await submit()
        state = reduce_fight_entry(state, { type: 'entry_receipt', receipt })
      } catch (error) {
        state = reduce_fight_entry(state, {
          type: recover_refusal && !state.retried ? 'entry_refused' : 'entry_failed',
          error,
        })
      }
      continue
    }
    try {
      const receipt = await recover_refusal(state.error)
      state = reduce_fight_entry(state, { type: 'open_receipt', receipt })
    } catch (error) {
      state = reduce_fight_entry(state, { type: 'open_failed', error })
    }
  }
  if (state.phase === 'failed') throw state.error
  return state.receipt
}

/**
 * Start the authoritative fight-engage task before its presentation. `present` only launches the visual beat;
 * its animation lifetime is deliberately absent from the returned task, so an authoritative state change can
 * mount the board while that beat is still running.
 * Presentation failures are reported but cannot replace the already-started authoritative promise.
 * @template T
 * @param {{ submit: () => Promise<T>, recover_refusal?: (error: unknown) => Promise<unknown>, present: () => void,
 *   on_present_error: (error: unknown) => void }} effects
 * @returns {Promise<T>}
 */
export function start_fight_engage({ submit, recover_refusal, present, on_present_error }) {
  const submitted = run_fight_entry({ submit, recover_refusal })
  try {
    present()
  } catch (error) {
    try {
      on_present_error(error)
    } catch {
      // Even a broken diagnostic sink cannot orphan a transaction that is already in flight.
    }
  }
  return submitted
}
