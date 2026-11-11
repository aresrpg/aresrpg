// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Transaction } from '@mysten/sui/transactions'

import { SDK, sui_transport } from '../src/client.ts'

import { execution_receipt } from './helpers/execution_receipt.ts'
import { digest, id, pins, signer } from './helpers/transport.ts'

// Keep the installed gRPC Core resolver: only its remote services are synthetic.
const fixture = () => {
  const client = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://unused.invalid' })
  const calls = { simulations: 0, signatures: 0, executions: 0, reads: 0 }
  let refuse = false
  const method = client.transactionExecutionService.methods.find(({ name }) => name === 'SimulateTransaction')!
  Object.assign(client.transactionExecutionService, {
    simulateTransaction: async (
      input: Parameters<typeof client.transactionExecutionService.simulateTransaction>[0]
    ) => {
      calls.simulations += 1
      const request = method.I.toJson(input) as {
        transaction: Record<string, never>
        checks: string
        doGasSelection: boolean
      }
      expect(request.checks).toBe('ENABLED')
      expect(request.doGasSelection).toBe(true)
      return {
        response: method.O.fromJson({
          transaction: {
            transaction: {
              ...request.transaction,
              gasPayment: {
                objects: [{ objectId: id(50), version: String(calls.executions + 1), digest }],
                owner: signer.toSuiAddress(),
                price: '1000',
                budget: '5000000',
              },
            },
            effects: { status: { success: !refuse }, epoch: '1' },
          },
        }),
      }
    },
  })
  Object.assign(client.core, {
    executeTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
      calls.executions += 1
      expect(Transaction.from(transaction).getData().gasData.payment?.[0]?.version).toBe(String(calls.executions))
      return execution_receipt(transaction)
    },
    waitForTransaction: async () => {
      calls.reads += 1
      throw new Error('The operation timed out')
    },
  })
  const sdk = SDK({
    client: sui_transport(client),
    pins,
    transaction_storage: null,
    address: signer.toSuiAddress(),
    sign_transaction: async (tx) => {
      calls.signatures += 1
      return tx.sign({ signer })
    },
  })
  return {
    sdk,
    calls,
    refuse: () => {
      refuse = true
    },
  }
}

test('certified receipt permits the next checked gRPC resolution despite unavailable ledger lookup', async () => {
  const f = fixture()
  await f.sdk.execute(f.sdk.tx())
  await f.sdk.execute(f.sdk.tx())
  expect(f.calls).toEqual({ simulations: 2, signatures: 2, executions: 2, reads: 0 })
})

test('a next-write simulation refusal still stops before signing or submission', async () => {
  const f = fixture()
  await f.sdk.execute(f.sdk.tx())
  f.refuse()
  await expect(f.sdk.execute(f.sdk.tx())).rejects.toThrow('NOT submitted')
  expect(f.calls).toEqual({ simulations: 2, signatures: 1, executions: 1, reads: 0 })
})

test('explicit read synchronization and pre-resolved transactions retain the ledger barrier', async () => {
  const f = fixture()
  const resolved = f.sdk.tx()
  resolved.setSender(signer.toSuiAddress())
  await resolved.build({ client: f.sdk.sui_client as never })
  await f.sdk.execute(f.sdk.tx())
  await expect(f.sdk.synchronize_transactions()).rejects.toThrow('not yet visible')
  await expect(f.sdk.execute(resolved)).rejects.toThrow('not yet visible')
  expect(f.calls).toEqual({ simulations: 2, signatures: 1, executions: 1, reads: 2 })
})
