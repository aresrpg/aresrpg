// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Resolve the Mysten kiosk-rule package ids for a network from @mysten/kiosk's exported constants.
// LINKAGE LAW: the royalty / kiosk_lock / personal_kiosk rule functions must be CALLED at the package id
// the on-chain kiosk-apps lineage binds for that network (wrong id ⇒ InvalidLinkage / dead royalties).
// These constants are the same source KioskClient.getRulePackageId reads; resolving them needs no chain client.
//   bun run packages/move/scripts/resolve_rules.mjs [testnet|mainnet]
import {
  KIOSK_LOCK_RULE_ADDRESS,
  PERSONAL_KIOSK_RULE_ADDRESS,
  ROYALTY_RULE_ADDRESS,
} from '@mysten/kiosk'

const net = process.argv[2] || 'testnet'
console.log(
  JSON.stringify(
    {
      network: net,
      royaltyRulePackageId: ROYALTY_RULE_ADDRESS[net],
      kioskLockRulePackageId: KIOSK_LOCK_RULE_ADDRESS[net],
      personalKioskRulePackageId: PERSONAL_KIOSK_RULE_ADDRESS[net],
    },
    null,
    2
  )
)
