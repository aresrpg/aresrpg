// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What every surface measures: the account's identity, its sign-ins and its transactions. Play is measured by
// the game's own module.
import {
  analytics_available,
  bind_analytics_context,
  capture_analytics,
  identify_analytics,
  reset_analytics_identity,
  type AnalyticsEvent,
} from '../analytics.ts'
import { analytics_identity, site_analytics_context } from '../analytics/context.ts'
import { initial_analytics_state, reduce_analytics } from '../analytics/state.ts'
import { env } from '../env.ts'
import { is_admin_address } from '../admin_access.ts'
import { report_error } from '../reporting.ts'
import type { AuthSession } from '../auth.ts'
import type { SiteModule, SiteState } from '../store.ts'
export type { AnalyticsState, AnalyticsInput } from '../analytics/state.ts'

type Milestone = Readonly<{ reached: boolean; event: AnalyticsEvent }>

const sign_in_milestones = ({ session: { sign_in, wallet } }: SiteState): readonly Milestone[] => {
  const request = sign_in.status === 'connecting' ? sign_in.request : null
  return [
    { reached: request === 'google', event: { name: 'login_started', properties: { method: 'google' } } },
    {
      reached: typeof request === 'object' && request !== null,
      event: { name: 'login_started', properties: { method: 'wallet' } },
    },
    { reached: wallet !== null, event: { name: 'login_completed' } },
    { reached: sign_in.status === 'idle' && Boolean(sign_in.error), event: { name: 'login_failed' } },
  ]
}

const transaction_events = (state: SiteState, previous: SiteState): readonly AnalyticsEvent[] => {
  const { execution } = state.analytics
  if (state.session.wallet !== previous.session.wallet || !execution) return []
  if (execution.digest === previous.analytics.execution?.digest) return []
  const properties = Object.fromEntries(
    Object.entries(execution).filter(([key]) => ['outcome', 'gas_mist'].includes(key))
  )
  return [{ name: 'transaction_executed', properties }]
}

export const site_analytics_events = (state: SiteState, previous: SiteState): readonly AnalyticsEvent[] => {
  if (state.session === previous.session && state.analytics === previous.analytics) return []
  const before = sign_in_milestones(previous)
  return [
    ...transaction_events(state, previous),
    ...sign_in_milestones(state)
      .filter((milestone, index) => milestone.reached && !before[index]!.reached)
      .map(({ event }) => event),
  ]
}

const observe: NonNullable<SiteModule['observe']> = ({ events, dispatch, get_state, signal }) => {
  let unsubscribe: (() => void) | undefined
  const unbind_context = bind_analytics_context(() => site_analytics_context(get_state()))
  const bind = (wallet: AuthSession | null): void => {
    unsubscribe?.()
    unsubscribe = wallet?.on_transaction((execution) =>
      dispatch({ type: 'analytics/transaction_executed', wallet, execution })
    )
    if (!wallet || !analytics_available()) return
    void analytics_identity(env.network, wallet.address).then(
      (identity) => {
        if (!signal.aborted) dispatch({ type: 'analytics/identity_resolved', wallet, identity })
      },
      (error: unknown) => report_error(error, { area: 'analytics_identity' })
    )
  }
  bind(get_state().session.wallet)
  signal.addEventListener(
    'abort',
    () => {
      unsubscribe?.()
      unbind_context()
    },
    { once: true }
  )
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.session.wallet !== previous.session.wallet) {
      if (previous.session.wallet) reset_analytics_identity()
      bind(state.session.wallet)
    }
    if (state.analytics.identity && state.analytics.identity !== previous.analytics.identity)
      identify_analytics(state.analytics.identity, is_admin_address(state.session.wallet?.address ?? null))
    for (const event of site_analytics_events(state, previous)) capture_analytics(event.name, event.properties)
  })
}

export default Object.freeze({
  name: 'analytics',
  initial: () => ({ analytics: initial_analytics_state() }),
  reduce: reduce_analytics,
  observe,
}) satisfies SiteModule
