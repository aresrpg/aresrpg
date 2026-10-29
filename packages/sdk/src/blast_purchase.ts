// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { bcs } from '@mysten/sui/bcs'
import { Transaction, coinWithBalance } from '@mysten/sui/transactions'
import { isValidSuiObjectId, normalizeSuiObjectId, SUI_TYPE_ARG } from '@mysten/sui/utils'
import type { SuiGrpcClient } from '@mysten/sui/grpc'

import { blast_config, create_blast_reader, type BlastConfig, type BlastPhase } from './blast.ts'
import { receipt_digest } from './cache.ts'
import type { Pins, Sdk } from './client.ts'
import { gas_mist_from_receipt } from './gas.ts'
import { positive_kares_amount, kares_clock } from './kares_ptb.ts'

export type BlastPurchaseConfig = BlastConfig & Readonly<{ package: string; package_version: string }>
export type BlastProof = Readonly<{ index: string; cap_mist: string; siblings: readonly string[] }>
export type BlastPurchase = Readonly<{ amount: bigint }> &
  (Readonly<{ method: 'open' | 'uncapped' }> | Readonly<{ method: 'allowlisted'; proof: BlastProof }>)
const object_id = (value: unknown): string => {
  if (typeof value !== 'string' || !isValidSuiObjectId(value)) throw new Error('Blast purchase is not configured')
  return normalizeSuiObjectId(value)
}
/** Writes target only the reviewed versioned ABI. Missing pins cannot fall back to a different sale. */
export const blast_purchase_config = (pins: Pins): BlastPurchaseConfig => {
  const config = blast_config(pins)
  if (!config) throw new Error('Blast purchase is not configured')
  const source = pins.blast_presale as Record<string, unknown>
  return { ...config, package: object_id(source.package), package_version: object_id(source.package_version) }
}
const proof_arguments = (tx: Transaction, proof: BlastProof) => {
  if (!/^(0|[1-9]\d*)$/.test(proof.index) || BigInt(proof.index) >= 65536n) throw new Error('Invalid Blast proof index')
  if (!/^[1-9]\d*$/.test(proof.cap_mist)) throw new Error('Invalid Blast proof cap')
  const cap = positive_kares_amount(BigInt(proof.cap_mist))
  if (proof.siblings.length > 16 || proof.siblings.some((value) => !/^[0-9a-f]{64}$/i.test(value)))
    throw new Error('Invalid Blast proof siblings')
  const siblings = proof.siblings.map((value) => Array.from(value.match(/../g)!, (byte) => parseInt(byte, 16)))
  return [tx.pure.u64(proof.index), tx.pure.u64(cap), tx.pure(bcs.vector(bcs.vector(bcs.u8())).serialize(siblings))]
}

/** Pure unsigned composition; the same transaction is available to dry-runs and wallet execution. */
export const create_blast_purchase_transaction = (
  config: BlastPurchaseConfig,
  sender: string,
  purchase: BlastPurchase
): Transaction => {
  const tx = new Transaction()
  tx.setSender(object_id(sender))
  const payment = tx.add(coinWithBalance({ type: SUI_TYPE_ARG, balance: positive_kares_amount(purchase.amount) }))
  const proof = purchase.method === 'allowlisted' ? proof_arguments(tx, purchase.proof) : []
  const [unused] = tx.moveCall({
    target: `${config.package}::blast_presale::commit_${purchase.method}`,
    typeArguments: [config.coin_type, SUI_TYPE_ARG],
    arguments: [tx.object(config.id), tx.object(config.package_version), payment, ...proof, kares_clock(tx)],
  })
  tx.transferObjects([unused], sender)
  return tx
}

/** Blast pays the participant, never the sender; this game only claims for its own signer. */
export const create_blast_claim_transaction = (config: BlastPurchaseConfig, sender: string): Transaction => {
  const tx = new Transaction()
  tx.setSender(object_id(sender))
  tx.moveCall({
    target: `${config.package}::blast_presale::claim`,
    typeArguments: [config.coin_type, SUI_TYPE_ARG],
    arguments: [tx.object(config.id), tx.object(config.package_version), tx.pure.address(sender), kares_clock(tx)],
  })
  return tx
}

const verify_version = async (client: SuiGrpcClient, config: BlastPurchaseConfig): Promise<void> => {
  const { object } = await client.core.getObject({ objectId: config.package_version })
  if (
    object.owner.$kind !== 'Shared' ||
    object.type !== `${config.package_original}::blast_presale_package::PackageVersion`
  )
    throw new Error('Blast version object belongs to another package')
}

export const blast_purchase_actions = ({
  sdk,
  client,
  address,
}: Readonly<{ sdk: Sdk; client: SuiGrpcClient; address: string }>) => {
  const verified_config = async (phases: readonly BlastPhase[], refusal: string): Promise<BlastPurchaseConfig> => {
    const config = blast_purchase_config(sdk.pins)
    const { network } = sdk.pins
    if (!network) throw new Error('Blast purchase network is not configured')
    const snapshot = await create_blast_reader({ network, pins: sdk.pins }, client).read()
    if (!snapshot || !phases.includes(snapshot.phase)) throw new Error(refusal)
    await verify_version(client, config)
    return config
  }
  const prepare = async (purchase: BlastPurchase): Promise<Transaction> =>
    create_blast_purchase_transaction(await verified_config(['live'], 'Blast sale is not open'), address, purchase)
  return Object.freeze({
    configured: (): boolean => {
      const pin = sdk.pins.blast_presale as Partial<BlastPurchaseConfig> | null | undefined
      return !!(pin?.package && pin.package_version && sdk.pins.kares_coin_type)
    },
    simulate: async (purchase: BlastPurchase) => {
      const receipt = await sdk.simulate(await prepare(purchase))
      if (receipt.Transaction?.effects?.status?.success !== true)
        throw new Error('Blast contribution simulation failed')
      const gas_mist = gas_mist_from_receipt(receipt)
      if (gas_mist === null) throw new Error('Blast simulation returned no gas estimate')
      return { amount_mist: purchase.amount, gas_mist }
    },
    purchase: async (purchase: BlastPurchase) => {
      // The common SDK re-simulates before signing and owns single submission and uncertain-receipt recovery.
      const receipt = await sdk.execute(await prepare(purchase))
      return { digest: receipt_digest(receipt), receipt }
    },
    claim: async () => {
      const config = await verified_config(['complete', 'cancelled'], 'Blast claims are not open')
      const receipt = await sdk.execute(create_blast_claim_transaction(config, address))
      return { digest: receipt_digest(receipt), receipt }
    },
  })
}
export type BlastPurchaseActions = ReturnType<typeof blast_purchase_actions>
