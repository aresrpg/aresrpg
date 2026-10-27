// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect, useState } from 'react'

import { capture_analytics, type AnalyticsCapture } from '../analytics.ts'

import type { CheckoutState } from './checkout_state.ts'

export type FundingMethod = 'direct' | 'bridge' | 'card' | 'faucet'

export const create_funding_observer = (capture: AnalyticsCapture) => {
  let previous: FundingMethod | null = null
  return (method: FundingMethod): void => {
    if (previous === method) return
    if (previous === null) capture('funding_opened')
    previous = method
    capture('funding_method_viewed', { method })
  }
}

export const useFundingAnalytics = (selected: FundingMethod, network: string): void => {
  const method = network === 'testnet' ? 'faucet' : selected
  const [observe] = useState(() => create_funding_observer(capture_analytics))
  useEffect(() => observe(method), [method, observe])
}

export const create_transfer_observer = (capture: AnalyticsCapture) => {
  let previous: CheckoutState['stage'] = 'idle'
  const stages: Readonly<Partial<Record<CheckoutState['stage'], string>>> = {
    signing: 'started',
    success: 'completed',
    failed: 'failed',
    refunded: 'refunded',
    unknown: 'unknown',
  }
  return (stage: CheckoutState['stage'], method: 'bridge' | 'direct'): void => {
    if (stage === previous) return
    previous = stage
    if (stages[stage]) capture(`funding_${method}_${stages[stage]}`, { method })
  }
}
