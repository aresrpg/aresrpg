// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase64, toBase58 } from '@mysten/sui/utils'

import { GAS_BUDGET_MIST, SDK, sui_transport } from '../src/client.ts'

import { digest, id, pins, signer } from './helpers/transport.ts'

// Synthetic fullnode replies exercise the installed client's resolver and HTTP transport.
// Existing receipt tests own submission/recovery; this test stops at the signing boundary.
for (const payment of ['coin', 'fragmented', 'balance', 'estimated', 'reservation', 'refused'] as const)
  test(`real gRPC resolver: ${payment} uses one checked simulation before signing`, async () => {
    const estimated = ['estimated', 'reservation'].includes(payment)
    // Synthetic reservation output from the gRPC service: SDK 2.39.1's u64 amount/u32 epoch/20-byte marker layout.
    const reservation_bytes = new Uint8Array(32).fill(0xac)
    new DataView(reservation_bytes.buffer).setBigUint64(0, 50_331_000n, true)
    new DataView(reservation_bytes.buffer).setUint32(8, 1, true)
    const gas_coins =
      payment === 'reservation'
        ? [{ objectId: id(50), version: '0', digest: toBase58(reservation_bytes) }]
        : payment === 'balance' || payment === 'estimated'
          ? []
          : (payment === 'fragmented' ? [50, 51] : [50]).map((coin) => ({ objectId: id(coin), version: '3', digest }))
    const requests: string[] = []
    const signed: Uint8Array[] = []
    const signing_boundary = new Error('reached signing boundary')
    const client: SuiGrpcClient = new SuiGrpcClient({
      network: 'testnet',
      baseUrl: 'https://resolver.invalid',
      fetch: (async (url, options) => {
        requests.push(String(url).split('/').at(-1)!)
        expect(requests.at(-1)).toBe('SimulateTransaction')
        const method = client.transactionExecutionService.methods.find(({ name }) => name === 'SimulateTransaction')!
        const bytes = fromBase64(await new Response(options!.body).text())
        const request = method.I.toJson(method.I.fromBinary(bytes.subarray(5))) as {
          transaction: Record<string, Parameters<typeof method.O.fromJson>[0]>
          doGasSelection: boolean
          checks: string
        }
        expect(request.doGasSelection).toBe(true)
        expect(request.checks).toBe('ENABLED')
        const gas_payment = request.transaction.gasPayment as { budget?: string } | undefined
        expect(gas_payment?.budget).toBe(estimated ? undefined : String(GAS_BUDGET_MIST))
        const payload = method.O.toBinary(
          method.O.fromJson({
            transaction: {
              transaction: {
                ...request.transaction,
                gasPayment: {
                  objects: gas_coins,
                  owner: signer.toSuiAddress(),
                  price: '1000',
                  budget: estimated ? '331000' : String(GAS_BUDGET_MIST),
                },
                ...(payment === 'balance' || estimated
                  ? { expiration: { kind: 'VALID_DURING', minEpoch: '1', epoch: '2', chain: digest, nonce: 1 } }
                  : {}),
              },
              effects: { status: { success: payment !== 'refused' }, epoch: '1' },
            },
          })
        )
        const trailers = new TextEncoder().encode('grpc-status: 0\r\n')
        const frame = new Uint8Array(payload.length + trailers.length + 10)
        new DataView(frame.buffer).setUint32(1, payload.length)
        frame.set(payload, 5)
        frame[payload.length + 5] = 128
        new DataView(frame.buffer).setUint32(payload.length + 6, trailers.length)
        frame.set(trailers, payload.length + 10)
        return new Response(frame, { headers: { 'content-type': 'application/grpc-web+proto', 'grpc-status': '0' } })
      }) as typeof fetch,
    })
    const sdk = SDK({
      client: sui_transport(client),
      address: signer.toSuiAddress(),
      pins,
      sign_transaction: async (tx) => {
        expect(tx.getData().gasData.payment).toEqual(gas_coins)
        expect(tx.getData().gasData.budget).toBe(estimated ? '331000' : String(GAS_BUDGET_MIST))
        signed.push(await tx.build())
        throw signing_boundary
      },
    })
    const tx = sdk.tx()
    if (['fragmented', 'reservation'].includes(payment)) {
      const amount =
        payment === 'reservation'
          ? tx.moveCall({
              target: `${id(1)}::royalty_rule::fee_amount`,
              typeArguments: [`${id(1)}::item::Item`],
              arguments: [
                tx.sharedObjectRef({ objectId: id(80), initialSharedVersion: '1', mutable: false }),
                tx.pure.u64(0),
              ],
            })
          : 1_000_000_000n
      const [coin] = tx.splitCoins(tx.gas, [amount])
      tx.transferObjects([coin], id(98))
    }
    sdk.doors.ready_fight(tx, {
      fight_object: { objectId: id(70), initialSharedVersion: '1' },
      fighter_idx: 0n,
    })
    await expect(sdk.execute(tx, estimated ? { budget: 'estimate' } : {})).rejects.toThrow(
      payment === 'refused' ? 'Transaction failed' : signing_boundary.message
    )
    expect(signed).toHaveLength(payment === 'refused' ? 0 : 1)
    expect(requests).toEqual(['SimulateTransaction'])
  })
