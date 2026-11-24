// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { TransactionExecution } from '@aresrpg/sdk'

import type { AuthSession } from '../auth.ts'
import type { AppInput, SiteState } from '../store.ts'

/** What every surface measures for the signed-in account: its pseudonym and its last transaction. */
export type AnalyticsState = Readonly<{
  /** The last observed wallet lifetime scopes measurements; session alone owns authentication. */
  scope: AuthSession | null
  identity: string | null
  execution: TransactionExecution | null
}>

export type AnalyticsInput = Readonly<{ wallet: AuthSession }> &
  (
    | Readonly<{ type: 'analytics/transaction_executed'; execution: TransactionExecution }>
    | Readonly<{ type: 'analytics/identity_resolved'; identity: string }>
  )

export const initial_analytics_state = (): AnalyticsState => ({ scope: null, identity: null, execution: null })

const fold_analytics = (analytics: AnalyticsState, input: AppInput): AnalyticsState => {
  if (input.type === 'analytics/transaction_executed')
    return input.execution.digest === analytics.execution?.digest
      ? analytics
      : { ...analytics, execution: input.execution }
  if (input.type === 'analytics/identity_resolved')
    return input.identity === analytics.identity ? analytics : { ...analytics, identity: input.identity }
  return analytics
}

export const reduce_analytics = <S extends SiteState>(state: S, input: AppInput): S => {
  if (state.analytics.scope !== state.session.wallet)
    return { ...state, analytics: { ...initial_analytics_state(), scope: state.session.wallet } }
  if ('wallet' in input && input.wallet !== state.session.wallet) return state
  const analytics = fold_analytics(state.analytics, input)
  return analytics === state.analytics ? state : { ...state, analytics }
}
