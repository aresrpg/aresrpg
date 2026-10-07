// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { DEFAULT_NETWORK, resolve_pins } from '@aresrpg/sdk/pins'

import { serve_gift } from '../server/gift.ts'

export default {
  fetch: (request: Request): Promise<Response> =>
    serve_gift(request, {
      pins: resolve_pins(DEFAULT_NETWORK),
      secret: process.env.ENOKI_SECRET_KEY,
      rpc_url: process.env.VITE_SUI_RPC_URL,
      graphql_url: process.env.VITE_GRAPHQL_URL,
    }),
}
