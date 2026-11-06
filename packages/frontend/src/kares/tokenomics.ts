// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { KARES_SUPPLY } from '@aresrpg/sdk/kares-economics'

import type { FinanceState } from './model.ts'

export type TokenomicsPhase = 'loading' | 'unavailable' | 'pre_funding' | 'ready' | 'stale' | 'error'

export const tokenomics_phase = (state: FinanceState): TokenomicsPhase => {
  if (state.request) return 'loading'
  if (state.error?.includes('is not configured')) return 'unavailable'
  if (state.error) return state.stale ? 'stale' : 'error'
  if (state.unfunded) return 'pre_funding'
  return state.snapshot ? 'ready' : 'loading'
}

export const tokenomics_reading = (state: FinanceState) => {
  const phase = tokenomics_phase(state)
  const snapshot = phase === 'ready' || phase === 'stale' ? state.snapshot : null
  return {
    phase,
    snapshot,
    burned:
      snapshot && snapshot.total_supply >= 0n && snapshot.total_supply <= KARES_SUPPLY
        ? KARES_SUPPLY - snapshot.total_supply
        : null,
    circulating: null,
  }
}
