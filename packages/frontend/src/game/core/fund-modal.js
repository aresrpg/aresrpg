// Tiny single-modal store for the "fund your wallet" onboarding — framework-agnostic (an
// EventEmitter + a snapshot), mirroring toast.js so vanilla screens (character-create.js) and the
// React chrome can both open it. Ephemeral UI state, deliberately NOT engine game-state.

import { EventEmitter } from 'events'

const emitter = new EventEmitter()

/**
 * @typedef {{
 *   address: string,
 *   required_sui?: number | null,
 *   balance_sui?: number | null,
 * }} FundModalState
 */

/** @type {FundModalState | null} */
let current = null

const emit = () => emitter.emit('change')

export const fund_store = {
  /** @returns {FundModalState | null} */
  get: () => current,
  /** @param {() => void} cb @returns {() => void} */
  subscribe: cb => {
    emitter.on('change', cb)
    return () => emitter.off('change', cb)
  },
}

/**
 * Open the fund-wallet modal. `required_sui` / `balance_sui` are optional context shown when the
 * modal is opened because a paid action (an additional character) couldn't be afforded.
 * @param {FundModalState} state
 */
export function open_fund_wallet(state) {
  current = state
  emit()
}

export function close_fund_wallet() {
  current = null
  emit()
}
