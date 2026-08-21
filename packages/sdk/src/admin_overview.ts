// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Read-only admin overview: chain facts that need NO connected wallet — the treasury balance
// and the marketplace policy royalties. The treasury address is never hardcoded: it resolves
// from SuiNS (`treasury@aresrpg`) on the first read, and only the admin page ever loads this
// module. This is the one sanctioned direct-GraphQL read path (owner 2026-08-21); signing
// anything still requires the wallet.

import { DEFAULT_ADMIN_ADDRESS } from '@aresrpg/protocol'

import { SDK } from './client.ts'
import { read_marketplace_royalties, type MarketplaceRoyalty } from './marketplace_admin.ts'
import { canonical_suins_name } from './suins.ts'

const TREASURY_SUINS_NAME = 'treasury@aresrpg'

export type AdminOverviewRead = Readonly<{
  treasury_address: string
  treasury_mist: bigint
  royalties: readonly MarketplaceRoyalty[]
}>

export const create_admin_overview = ({
  graphql_url,
  network,
}: Readonly<{ graphql_url: string; network: 'testnet' | 'mainnet' }>) => {
  const sdk = SDK({ graphql_url, network })
  // the transport is structurally a SuiGraphQLClient here; the shared SdkOptions type just
  // does not carry the name-service member
  const name_service = sdk.sui_client.core as unknown as Readonly<{
    resolveNameServiceAddress: (input: Readonly<{ name: string }>) => Promise<Readonly<{ address: string | null }>>
  }>
  const treasury_cell: { address: Promise<string> | null } = { address: null }
  const treasury_address = (): Promise<string> => {
    if (treasury_cell.address) return treasury_cell.address
    const pending = name_service
      .resolveNameServiceAddress({ name: canonical_suins_name(TREASURY_SUINS_NAME) })
      .then(({ address }) => {
        if (!address) throw new Error(`SuiNS did not resolve ${TREASURY_SUINS_NAME} on ${network}`)
        return address
      })
      .catch((error: unknown) => {
        // a failed resolution must not poison the cell forever — the next read retries
        treasury_cell.address = null
        throw error
      })
    treasury_cell.address = pending
    return pending
  }
  return Object.freeze({
    read: async (): Promise<AdminOverviewRead> => {
      const treasury = await treasury_address()
      const [balance, royalties] = await Promise.all([
        sdk.sui_client.core.getBalance({ owner: treasury }),
        // caps here answer "does the ADMIN ADDRESS own the policy cap" — chain truth, not
        // connection truth; the claim PTB re-verifies against the actually connected wallet
        read_marketplace_royalties(sdk, DEFAULT_ADMIN_ADDRESS),
      ])
      return Object.freeze({
        treasury_address: treasury,
        treasury_mist: BigInt(balance.balance.balance),
        royalties,
      })
    },
  })
}
