// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { observe_chain_clock } from '@aresrpg/protocol/chain-clock'

import type { AppModule } from '../store.ts'
export { chain_now, chain_deadline_reached, type ChainClock, type ChainClockInput } from '@aresrpg/protocol/chain-clock'

const chain_clock: AppModule = {
  name: 'chain_clock',
  reduce: (state, input) => {
    if (input.type === 'clock/observed') {
      const next = observe_chain_clock(state.chain_clock, input)
      return next === state.chain_clock ? state : { ...state, chain_clock: next }
    }
    return state.chain_clock && !['ready', 'connected'].includes(state.session.link_status)
      ? { ...state, chain_clock: null }
      : state
  },
}

export default Object.freeze(chain_clock)
