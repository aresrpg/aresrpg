// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import { bcs } from '@mysten/sui/bcs'
import type { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'

export type AgentBatchLimits = Readonly<{
  commands: number
  objects: number
  bytes: number
  arguments: number
  pure_bytes: number
  gas_objects: number
}>
const fields = {
  commands: 'max_programmable_tx_commands',
  objects: 'max_input_objects',
  bytes: 'max_tx_size_bytes',
  arguments: 'max_arguments',
  pure_bytes: 'max_pure_argument_size',
  gas_objects: 'max_gas_payment_objects',
} as const

/** Limits come from this network's current epoch, not a new application batch cap. */
export const read_agent_batch_limits = async (client: SuiGrpcClient): Promise<AgentBatchLimits> => {
  const { response } = await client.ledgerService.getEpoch({ readMask: { paths: ['protocol_config'] } })
  const config = response.epoch?.protocolConfig
  if (!config) throw new Error('Transaction limits are unavailable.')
  const read = (key: string) => {
    const encoded = config.configs[key]?.kind
    const primitive = encoded?.oneofKind === 'structValue' ? encoded.structValue.fields.u64?.kind : encoded
    const value =
      primitive?.oneofKind === 'stringValue'
        ? primitive.stringValue
        : primitive?.oneofKind === 'numberValue'
          ? primitive.numberValue
          : config.attributes[key]
    const number = Number(value)
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`Transaction limit ${key} is unavailable.`)
    return number
  }
  return Object.fromEntries(Object.entries(fields).map(([name, key]) => [name, read(key)])) as AgentBatchLimits
}

/** Reserve the maximum gas-payment vector and the existing SDK's bounded expiration representation. */
const data_overhead = (gas_objects: number) => {
  const digest = '11111111111111111111111111111111'
  const kind = { ProgrammableTransaction: { inputs: [], commands: [] } }
  const gas = { payment: [], owner: '0x0', price: '1', budget: '1' }
  const expiration = {
    ValidDuring: { minEpoch: '0', maxEpoch: '1', minTimestamp: '0', maxTimestamp: '1', chain: digest, nonce: 0 },
  }
  const base =
    bcs.TransactionData.serialize({ V1: { kind, sender: '0x0', gasData: gas, expiration } }).toBytes().length -
    bcs.TransactionKind.serialize(kind).toBytes().length
  const reference = bcs.SuiObjectRef.serialize({ objectId: '0x0', version: '1', digest }).toBytes().length
  return base + gas_objects * reference + bcs.uleb128().serialize(gas_objects).toBytes().length - 1
}

export const agent_batch_fits = async (client: SuiGrpcClient, transaction: Transaction, limits: AgentBatchLimits) => {
  const data = transaction.getData()
  if (data.commands.length >= limits.commands) return false
  const objects = data.inputs.filter((input) => input.$kind !== 'Pure').length + limits.gas_objects
  if (objects > limits.objects) return false
  if (data.inputs.some((input) => input.Pure && fromBase64(input.Pure.bytes).length > limits.pure_bytes)) return false
  if (
    data.commands.some(
      (command) =>
        (command.MoveCall?.arguments.length ?? command.TransferObjects?.objects.length ?? 0) > limits.arguments
    )
  )
    return false
  const kind = await transaction.build({ client, onlyTransactionKind: true })
  return kind.length + data_overhead(limits.gas_objects) <= limits.bytes
}

/** Find the largest fitting prefix before submitting once. A submitted failure never enters the search again. */
export const submit_agent_batches = async <T>(
  rows: readonly T[],
  fits: (rows: readonly T[]) => Promise<boolean>,
  submit: (rows: readonly T[]) => Promise<unknown>
): Promise<void> => {
  let cursor = 0
  while (cursor < rows.length) {
    const remaining = rows.slice(cursor)
    if (await fits(remaining)) {
      await submit(remaining)
      return
    }
    let low = 0,
      high = remaining.length - 1
    while (low < high) {
      const count = Math.ceil((low + high) / 2)
      if (await fits(remaining.slice(0, count))) low = count
      else high = count - 1
    }
    if (!low) throw new Error('One asset and its equipment exceed the current transaction limits.')
    await submit(remaining.slice(0, low))
    cursor += low
  }
}
