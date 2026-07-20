// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Generic SUI fund helper — bun-signs from PRIVATE_KEY (env) so it NEVER switches the global active address
// (never switches the active address) and NEVER writes a key to a file. Usage:
//   PRIVATE_KEY=<suiprivkey…> NETWORK=testnet bun run fund.mjs <toAddress> <amountSUI>
import { Transaction } from '@mysten/sui/transactions'
import { keypair, sui_client } from './client.js'

const [, , TO, AMOUNT_SUI] = process.argv
if (!TO || !AMOUNT_SUI) throw new Error('usage: bun run fund.mjs <toAddress> <amountSUI>')
const mist = BigInt(Math.round(Number(AMOUNT_SUI) * 1e9))

const tx = new Transaction()
const [coin] = tx.splitCoins(tx.gas, [mist])
tx.transferObjects([coin], TO)

const from = keypair.getPublicKey().toSuiAddress()
const r = await sui_client.signAndExecuteTransaction({ signer: keypair, transaction: tx, options: { showEffects: true } })
await sui_client.waitForTransaction({ digest: r.digest })
console.log(`from ${from} → ${TO} : ${AMOUNT_SUI} SUI · status=${r.effects?.status?.status} · digest=${r.digest}`)
