// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFile } from 'node:fs/promises'

import { SuiGrpcClient } from '@mysten/sui/grpc'
import { parseStructTag, normalizeStructTag } from '@mysten/sui/utils'

import { SDK, sui_transport } from '../packages/sdk/src/client.ts'
import {
  create_blast_purchase_transaction,
  type BlastPurchase,
  type BlastPurchaseConfig,
} from '../packages/sdk/src/blast_purchase.ts'
import { resolve_pins } from '../packages/sdk/src/pins.ts'
import captured from '../packages/sdk/test/fixtures/blast_presale.mainnet.json' with { type: 'json' }

type Input = Readonly<{
  config: BlastPurchaseConfig
  sender: string
  purchase: Omit<BlastPurchase, 'amount'> & Readonly<{ amount: string }>
}>
const fixture = (): Input => {
  const [sale, version] = captured.objects
  const type = parseStructTag(sale.type)
  return {
    config: {
      id: sale.objectId,
      package: type.address,
      package_original: type.address,
      package_version: version.objectId,
      coin_type: normalizeStructTag(type.typeParams[0]),
      url: 'https://www.blast.fun/',
    },
    sender: '0x52ecee5e58e2f3a7461cc604f4efcc3b68031e4715456d821e3a2719b0593600',
    purchase: { method: 'open', amount: '1000000' },
  }
}
const [, , argument] = process.argv
if (!argument) throw new Error('Usage: bun scripts/simulate_blast_purchase.ts --fixture | public-purchase.json')
const input: Input = argument === '--fixture' ? fixture() : (JSON.parse(await readFile(argument, 'utf8')) as Input)
const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' })
const sdk = SDK({
  client: sui_transport(client),
  network: 'mainnet',
  address: input.sender,
  pins: resolve_pins('mainnet'),
  gas_budget: 'estimate',
})
const tx = create_blast_purchase_transaction(input.config, input.sender, {
  ...input.purchase,
  amount: BigInt(input.purchase.amount),
} as BlastPurchase)
try {
  const result = await sdk.simulate(tx)
  console.log(
    JSON.stringify(
      { mode: 'unsigned simulation only', result },
      (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
      2
    )
  )
} catch (error) {
  console.error(
    JSON.stringify({
      mode: 'unsigned simulation only',
      refused: error instanceof Error ? error.message : String(error),
    })
  )
  process.exitCode = 1
}
