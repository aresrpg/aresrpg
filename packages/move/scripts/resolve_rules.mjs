// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Resolve the Mysten kiosk-rule package ids for a network via @mysten/kiosk KioskClient.
// LINKAGE LAW: the royalty / kiosk_lock / personal_kiosk rule functions must be CALLED at the package id
// the on-chain kiosk-apps lineage binds for that network (wrong id ⇒ InvalidLinkage / dead royalties).
// KioskClient.getRulePackageId is the single source of truth (seamless testnet↔mainnet).
//   bun run packages/move/scripts/resolve_rules.mjs [testnet|mainnet]
import { KioskClient } from '@mysten/kiosk'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'

const net = process.argv[2] || 'testnet'
const kc = new KioskClient({
  client: new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(net), network: net }),
  network: net,
})
console.log(
  JSON.stringify(
    {
      network: net,
      royaltyRulePackageId: kc.getRulePackageId('royaltyRulePackageId'),
      kioskLockRulePackageId: kc.getRulePackageId('kioskLockRulePackageId'),
      personalKioskRulePackageId: kc.getRulePackageId('personalKioskRulePackageId'),
    },
    null,
    2,
  ),
)
