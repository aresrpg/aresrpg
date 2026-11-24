// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { is_admin_address } from '../admin_access.ts'
import { site_page_of } from '../site/routes.ts'
import type { SiteState } from '../store.ts'

export type AnalyticsProperties = Readonly<Record<string, string | number | boolean | null>>

/** What every event of the site says: its page, its language and the account. The game reports its own surface. */
export const site_analytics_context = (state: SiteState): AnalyticsProperties => ({
  surface: site_page_of(state.location.pathname).key,
  locale: state.locale,
  authenticated: state.session.wallet !== null,
  is_internal: is_admin_address(state.session.wallet?.address ?? null),
})

/** A pseudonym, not anonymization: a public address can still be matched by recomputing its hash. */
export const analytics_identity = async (network: string, address: string): Promise<string> => {
  const input = new TextEncoder().encode(`aresrpg:analytics:v1:${network}:${address.toLowerCase()}`)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return `player_${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}
