// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WALLET-SWITCH SESSION RESET SUBSCRIPTION (P0/D286) — the ONE, route-independent trigger.
//
// auth is the single home for the wallet identity, so a change AWAY from a previous NON-NULL address
// (disconnect A→null, or a direct A→B switch) must tear the whole wallet session down
// (game/wallet_session_reset) so the prior account's character / kiosk / roster can never leak into the new
// one. A first connect (null→A) and an idempotent re-set (A→A) never fire.
//
// WHY IT LIVES HERE — NOT in auth/index.ts's module body: the reset statically pulls the game/engine stores,
// which must stay in the lazily-booted game chunk, so it is DYNAMIC-imported (pulled only when an actual
// switch happens — never at boot / on the login screen). Naming that dynamic chunk from auth/index.ts made
// the eager login bundle the head of an import CYCLE (auth → wallet_session_reset → … → auth); hoisting the
// subscription into this leaf — imported only by the composition root — keeps the dynamic split while
// leaving auth's module body cycle-free.
//
// ROUTE-INDEPENDENT by design: `install_wallet_session_reset` is called once from the composition root
// (main.tsx), ABOVE the router — so the subscription is live on EVERY route regardless of which component
// tree is mounted (it does not depend on GameWorldHost, where the trigger used to live).
import { report_error } from '../core/report.js'

import { use_auth } from './index'

/**
 * Subscribe the auth store to game/wallet_session_reset: fire the reset on any wallet change away from a
 * previous non-null address. Call ONCE at boot from the composition root; returns the unsubscribe fn.
 */
export function install_wallet_session_reset(): () => void {
  return use_auth.subscribe((state, prev) => {
    if (prev.address && prev.address !== state.address) {
      void import('../game/wallet_session_reset')
        .then(({ reset_wallet_session }) => reset_wallet_session({ type: 'wallet_session/reset' }))
        .catch((err) => report_error(err, { area: 'auth', action: 'wallet_session_reset' }))
    }
  })
}
