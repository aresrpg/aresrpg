// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { relay_solana_rpc } from '../server/solana_rpc.ts'

export default {
  fetch: (request: Request): Promise<Response> => relay_solana_rpc(request, process.env.SOLANA_RPC_URL),
}
