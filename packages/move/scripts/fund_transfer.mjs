// fund_transfer.mjs — SELF-CONSOLIDATION of a wallet's SUI coins into ONE, over JSON-RPC with the CLI
// keystore signer. Promoted from the 07-16 `fund_custody.mjs` scratchpad pattern (the qa-identities
// memory ordered promotion to a repo tool on next use). WHY JSON-RPC and NOT the gRPC client.js path:
// server-aresrpg's fragmented coins are the gRPC-first CLI's blind spot for merge-coin; the memory-named
// ANSWERING testnet endpoint is publicnode (rpc-testnet.suiscan.xyz also answers) — the mysten fullnode
// returns empty for these. The gRPC upgrade ceremony needs ONE coin ≥ its gas budget,
// which its native resolver cannot assemble from fragments — this fold produces that coin.
//
// Signer = the ACTIVE-address keystore key (reused from client.js load_signer — one signer home). The
// EXPECT_SIGNER env is a hard guard against signing with the wrong key; the caller switches active-address
// to the funding source first. NEVER the faucet, NEVER alice/QA/drive wallets. dryRun → budget ×1.5 →
// execute. BURN LAW: an executed-failed tx (a digest exists) is NEVER retried — exit non-zero, report state.
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { Transaction } from '@mysten/sui/transactions'

import { keypair } from './client.js'

const {
  RPC_URL = 'https://sui-testnet-rpc.publicnode.com',
  COIN_TYPE = '0x2::sui::SUI',
  EXPECT_SIGNER,
  MIN_RESULT_SUI = '1',
} = process.env

const owner = keypair.getPublicKey().toSuiAddress()
if (EXPECT_SIGNER && owner.toLowerCase() !== EXPECT_SIGNER.toLowerCase())
  throw new Error(
    `SIGNER GUARD: active key is ${owner} but EXPECT_SIGNER=${EXPECT_SIGNER} — refusing to sign`
  )

const client = new SuiJsonRpcClient({ url: RPC_URL })

// Coin acquisition. The SDK `getCoins()` wrapper proved UNRELIABLE against these load-balanced testnet
// pools — it silently dropped a confirmed Coin<SUI> that getObject + raw suix_getCoins + suix_getBalance
// all agree exists. So we drive off the PRIMARY object store, which is consistent across every node we
// tested: an explicit COINS list (comma-separated object ids) is fetched + verified via multiGetObjects;
// absent that, a RAW suix_getCoins enumeration (also consistent in testing, unlike the SDK wrapper).
async function coins_from_ids(ids) {
  const objs = await client.multiGetObjects({
    ids,
    options: { showType: true, showOwner: true, showContent: true },
  })
  return objs.map((o, i) => {
    const d = o.data
    if (!d) throw new Error(`coin ${ids[i]} not found: ${JSON.stringify(o.error)}`)
    if (d.type !== `0x2::coin::Coin<${COIN_TYPE}>`)
      throw new Error(`${ids[i]} is not Coin<${COIN_TYPE}> (type=${d.type})`)
    if (d.owner?.AddressOwner?.toLowerCase() !== owner.toLowerCase())
      throw new Error(`${ids[i]} not owned by signer — actual owner: ${JSON.stringify(d.owner)}`)
    return {
      coinObjectId: d.objectId,
      version: d.version,
      digest: d.digest,
      balance: d.content.fields.balance,
    }
  })
}
async function raw_get_coins() {
  const out = []
  let cursor = null
  do {
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'suix_getCoins',
        params: [owner, COIN_TYPE, cursor, 50],
      }),
    }).then((r) => r.json())
    if (res.error) throw new Error('suix_getCoins: ' + JSON.stringify(res.error))
    out.push(...res.result.data)
    cursor = res.result.hasNextPage ? res.result.nextCursor : null
  } while (cursor)
  return out
}
const explicit = (process.env.COINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const coins = explicit.length ? await coins_from_ids(explicit) : await raw_get_coins()
if (coins.length === 0) throw new Error(`no ${COIN_TYPE} coins at ${owner}`)
coins.sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : -1))
const total = coins.reduce((s, c) => s + BigInt(c.balance), 0n)
console.log(`signer=${owner}`)
console.log(`endpoint=${RPC_URL}`)
console.log(`coins=${coins.length} total=${Number(total) / 1e9} SUI`)
for (const c of coins) console.log(`  ${c.coinObjectId} ${Number(c.balance) / 1e9} SUI`)

if (coins.length === 1) {
  console.log('ALREADY_CONSOLIDATED')
  console.log(`coin=${coins[0].coinObjectId} balance=${Number(coins[0].balance) / 1e9} SUI`)
  process.exit(0)
}

// The largest coin is the gas payment AND the merge destination; the rest fold into it (gas smashing +
// mergeCoins into tx.gas). One surviving coin = primary.coinObjectId, balance = total − gas.
const [primary, ...rest] = coins
const build = () => {
  const tx = new Transaction()
  tx.setSender(owner)
  tx.setGasPayment([
    { objectId: primary.coinObjectId, version: primary.version, digest: primary.digest },
  ])
  tx.mergeCoins(
    tx.gas,
    rest.map((c) =>
      tx.objectRef({ objectId: c.coinObjectId, version: c.version, digest: c.digest })
    )
  )
  return tx
}

// A merge CAN be dry-run (only Upgrade rejects dryRun) → derive the budget honestly, ×1.5.
const dry_tx = build()
dry_tx.setGasBudget(10_000_000n)
const dry = await client.dryRunTransactionBlock({
  transactionBlock: await dry_tx.build({ client }),
})
if (dry.effects.status.status !== 'success')
  throw new Error(`dryRun failed: ${JSON.stringify(dry.effects.status)}`)
const g = dry.effects.gasUsed
const used =
  BigInt(g.computationCost) + BigInt(g.storageCost) - BigInt(g.storageRebate)
let budget = (used * 3n) / 2n
if (budget < 5_000_000n) budget = 5_000_000n
console.log(
  `dryRun=success gasNet=${Number(used) / 1e9} SUI budget(x1.5)=${Number(budget) / 1e9} SUI`
)

const tx = build()
tx.setGasBudget(budget)
const r = await client.signAndExecuteTransaction({
  signer: keypair,
  transaction: tx,
  options: { showEffects: true },
})
await client.waitForTransaction({ digest: r.digest })
if (r.effects?.status?.status !== 'success') {
  console.error(
    `CONSOLIDATION_FAILED_EXECUTED digest=${r.digest} status=${JSON.stringify(r.effects?.status)}`
  )
  console.error('BURN LAW: a digest exists — do NOT retry. Report exact chain state.')
  process.exit(1)
}

// Verify the surviving coin (the primary gas/destination) via the PRIMARY object store — the SDK
// getCoins index proved unreliable on these pools, so a money outcome is NEVER verified through it.
const [survivor] = await coins_from_ids([primary.coinObjectId])
const merged_sui = Number(survivor.balance) / 1e9
console.log('CONSOLIDATION_OK')
console.log(`digest=${r.digest}`)
console.log(`coin=${survivor.coinObjectId} balance=${merged_sui} SUI`)
if (merged_sui < Number(MIN_RESULT_SUI))
  throw new Error(`resulting coin ${merged_sui} SUI < MIN_RESULT_SUI ${MIN_RESULT_SUI}`)
