// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { SDK } from '@aresrpg/sdk/sui'

// S-61 — ids live in the SDK's ONE deployment home (deployment/aresrpg.js): the S-57 per-domain builders
// resolve every package/object id lazily from it, so no id map is passed here. No package id belongs in
// this file.
import { game_log } from '../core/log.js'

import { DEMO_NETWORK } from './deployment'

// The SDK is built ONCE (it opens the gRPC/GraphQL/kiosk clients) and memoised — every store action awaits
// the same instance. NO backend: reads go chain-direct, writes are signed by the wallet.
// #23/D79: the jsonRpc `transport` failover arg is gone (jsonRpc-only concern) — the gRPC/GraphQL clients use
// their own default transports.
export type ExpeditionSdk = Awaited<ReturnType<typeof SDK>>

let sdk_promise: Promise<ExpeditionSdk> | null = null

export function get_sdk(): Promise<ExpeditionSdk> {
  if (!sdk_promise)
    sdk_promise = SDK({
      network: DEMO_NETWORK,
    }).catch((e) => {
      // NEVER cache a FAILED init: clear the memo so the next call retries — else one transient boot-time RPC
      // hiccup permanently wedges every chain read behind a rejected promise (the roster hangs forever). Loud.
      sdk_promise = null
      game_log('sdk', 'init failed', e)
      // Sentry reporting rides a LAZY import (the rpc/client.ts show_rate_limit_failure pattern): the read
      // client's STATIC closure stays free of @sentry/react so it is drivable headless (chain/ hermeticity
      // ratchet). A failed optional reporter import must never replace the original init error.
      void import('../core/report.js')
        .then(({ report_error }) => report_error(e, { area: 'sdk', action: 'init' }))
        .catch(() => {})
      throw e
    })
  return sdk_promise
}
