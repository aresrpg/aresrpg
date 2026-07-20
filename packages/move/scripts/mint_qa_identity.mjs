// QA IDENTITY MINTER — creates a funded, character-owning THROWAWAY testnet wallet for independent
// QA drives (the release-gate wall, 2026-07-15: prod auth is zkLogin-only, so no QA agent can obtain a
// character; independent verification needs exactly one funded char-owning suiprivkey).
// Composes the SDK's own `create_character_paid_ptb` (permissionless self-pay — the SAME PTB shape prod
// uses behind the sponsor) against the LIVE stamped deployment, signed by the throwaway itself.
//
//   NETWORK=testnet FUND_SUI=3 node mint_qa_identity.mjs      # generate + fund + mint; prints the identity
//
// Funding source: the ACTIVE CLI keystore address (server-aresrpg — the testnet ops wallet).
// The printed suiprivkey is a DISPOSABLE testnet QA credential — never a prod key, never reused.
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'

// Relative import: packages/move/scripts is not an npm workspace member of the SDK — same pattern
// as this directory's other cross-package reads.
import { SDK } from '../../sdk/src/sui.js'

import { keypair as funder, sui_client } from './client.js'
import { run } from './ceremony_lib.mjs'

const FUND_SUI = Number(process.env.FUND_SUI ?? 12) // creation gate price (10 SUI, goes to the game treasury) + fight/QA gas
const NAME = process.env.QA_NAME ?? `QA_${Date.now().toString(36).slice(-5).toUpperCase()}`

const qa = Ed25519Keypair.generate()
const qa_address = qa.toSuiAddress()
console.log(`qa address: ${qa_address}`)

// 1. Fund from the active keystore (server-aresrpg).
const fund_tx = new Transaction()
const [coin] = fund_tx.splitCoins(fund_tx.gas, [BigInt(Math.floor(FUND_SUI * 1e9))])
fund_tx.transferObjects([coin], qa_address)
await run(sui_client, funder, 'qa-fund', fund_tx, { ceilingSui: 0.05 })

// 2. Mint char-1 via the SDK's paid composer, signed by the throwaway (self-pay, price from the live gate).
const sdk = await SDK({ network: 'testnet' })
const creation = await sdk.get_creation_state()
const price_mist = BigInt(creation?.price ?? 0n)
if (!price_mist) throw new Error(`creation gate returned no price: ${JSON.stringify(creation, (_, v) => String(v))}`)
console.log(
  `creation gate: ${JSON.stringify(creation, (_, v) => (typeof v === 'bigint' ? String(v) : v))} → paying ${price_mist} MIST`
)
const tx = sdk.create_character_paid_ptb({
  name: NAME,
  class: 'senshi',
  male: true,
  color_1: 0xffffff,
  color_2: 0xd9af57,
  color_3: 0x8b6539,
  price_mist,
})
await run(sui_client, qa, 'qa-mint-char', tx, { ceilingSui: 0.5 })

console.log('=== QA IDENTITY READY ===')
console.log(`address:    ${qa_address}`)
console.log(`character:  ${NAME} (senshi)`)
console.log(`suiprivkey: ${qa.getSecretKey()}`)
