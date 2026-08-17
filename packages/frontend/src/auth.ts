// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_browser_auth, create_wallet_auth } from '@aresrpg/sdk/auth'
import type { AuthSession } from '@aresrpg/sdk/auth'

import { env } from './env.ts'

export type { AuthSession, SelectableAuthWallet } from '@aresrpg/sdk/auth'

export const create_auth = () =>
  create_browser_auth({
    enoki_api_key: env.enoki_api_key,
    google_client_id: env.google_client_id,
    graphql_url: env.graphql_url,
    network: env.network,
    rpc_url: env.sui_rpc_url,
    redirect_url: `${window.location.origin}/enoki`,
  })

export type Auth = ReturnType<typeof create_auth>

export const create_admin_auth = () =>
  create_wallet_auth({ graphql_url: env.graphql_url, network: env.network, rpc_url: env.sui_rpc_url })
