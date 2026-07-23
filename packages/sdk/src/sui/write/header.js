// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Transaction } from '@mysten/sui/transactions'

import { aresrpg_deployment } from '../../deployment/aresrpg.js'

// THE on-chain MARKER every player-facing PTB leads with (mirrors packages/move/aresrpg/sources/header.move —
// a genuinely no-op `entry fun`). Explorers title a transaction by its FIRST moveCall; the sponsor service's
// per-user pay-per-use fee counter filters "is this an aresrpg tx?" by the presence of this exact command.
// Owner ruling 2026-07-24: the S-57 domain-file migration silently dropped the prepend from every builder but
// one marketplace buy path (`items_marketplace.js` patched it back ad hoc) — restored end-to-end here instead.
//
// ONE HOME for the composition: every write-flow builder's `tx` PARAMETER now DEFAULTS here instead of a bare
// `new Transaction()`, so the target string lives in exactly one place. A caller who supplies their OWN `tx`
// (chaining multiple builders into one batched, one-signature PTB) never triggers this default — only the
// builder that actually OPENS the transaction adds the header, so a chained batch never carries it twice.
/**
 * @param {'mainnet' | 'testnet' | 'devnet' | 'localnet'} network
 * @param {Partial<import('../../deployment/aresrpg.js').AresrpgIds>} [ids] the `context.ids?.aresrpg` injection seam
 * @returns {Transaction}
 */
export function new_ptb(network, ids) {
  const tx = new Transaction()
  const { LATEST_PACKAGE_ID } = aresrpg_deployment(network, ids)
  tx.moveCall({ target: `${LATEST_PACKAGE_ID}::header::aresrpg` })
  return tx
}
