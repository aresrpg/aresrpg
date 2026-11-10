// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { fromBase64 } from '@mysten/sui/utils'

import { quote_return_transaction, return_funding, AgentReturnFundingRequired } from '../src/agent_return_funding.ts'
import { simulation_gas_budget } from '../src/gas.ts'

const owner = `0x${'1'.repeat(64)}`,
  agent = `0x${'2'.repeat(64)}`
const simulated = (debit = 100n) => ({
  $kind: 'Transaction' as const,
  Transaction: {
    status: { success: true },
    effects: { status: { success: true }, gasUsed: { computationCost: '100', storageCost: '0', storageRebate: '0' } },
    balanceChanges: [{ address: owner, coinType: '0x2::sui::SUI', amount: String(-debit) }],
  },
})

test('quote preserves validation and includes actual policy spending beyond net gas', async () => {
  const transaction = new Transaction()
  transaction.setSender(owner)
  let calls = 0
  const quote = await quote_return_transaction(
    {
      core: {
        getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
        simulateTransaction: async (options: { checksEnabled: boolean; doGasSelection: boolean }) => {
          expect(options.checksEnabled).toBe(true)
          expect(options.doGasSelection).toBe(false)
          calls += 1
          return simulated(600n)
        },
      },
    } as never,
    owner,
    transaction
  )
  expect(quote).toEqual({ budget_mist: 1100n, cost_mist: 600n, required_mist: 1600n })
  expect(calls).toBe(1)
  expect(transaction.getData().gasData.payment).toBeNull()
})

test('storage rebates never remove the computation budget needed up front', () => {
  const receipt = simulated()
  receipt.Transaction.effects.gasUsed.storageRebate = '5000'
  expect(simulation_gas_budget(receipt, 2n)).toBe(2100n)
})

const funding_fixture = (owner_balance: bigint, agent_balance: bigint) => {
  const submitted: Transaction[] = []
  let guarded = 0
  const client = {
    core: {
      getBalance: async ({ owner: address }: { owner: string }) => ({
        balance: { balance: String(address === owner ? owner_balance : agent_balance) },
      }),
      getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
      simulateTransaction: async ({ transaction }: { transaction: Transaction }) => {
        const input = transaction
          .getData()
          .inputs.find((input) => input.Pure && fromBase64(input.Pure.bytes).length === 8)!
        const amount = BigInt(bcs.u64().parse(fromBase64(input.Pure!.bytes)))
        const result = simulated(amount + 100n)
        result.Transaction.balanceChanges[0]!.address = transaction.getData().sender!
        return result
      },
      waitForTransaction: async () => ({}),
    },
  }
  const owner_sdk = {
    execute: async (transaction: Transaction, options: { before_sign: () => void }) => {
      options.before_sign()
      submitted.push(transaction)
      return { Transaction: { digest: 'funding-receipt' } }
    },
  }
  const funding = return_funding({
    client: client as never,
    sdk: owner_sdk as never,
    owner_sdk: owner_sdk as never,
    owner,
    agent,
    before_sign: () => {
      guarded += 1
    },
    guard: async () => {},
  })
  return { funding, submitted, guarded: () => guarded }
}

test('sufficient bot funds do not request an owner transaction', async () => {
  const f = funding_fixture(2000n, 1000n)
  await f.funding.ensure(agent, { budget_mist: 1000n, cost_mist: 100n, required_mist: 1000n })
  expect(f.submitted).toEqual([])
})

test('a short bot receives only the quoted shortfall through the normal owner transaction', async () => {
  const f = funding_fixture(2000n, 200n)
  await f.funding.ensure(agent, { budget_mist: 1000n, cost_mist: 100n, required_mist: 1000n })
  expect(f.submitted).toHaveLength(1)
  expect(f.submitted[0]!.getData().sender).toBe(owner)
  const values = f.submitted[0]!.getData().inputs.flatMap((input) => (input.Pure ? [fromBase64(input.Pure.bytes)] : []))
  expect(values.filter((bytes) => bytes.length === 8).map((bytes) => bcs.u64().parse(bytes))).toEqual(['800'])
  expect(values.filter((bytes) => bytes.length === 32).map((bytes) => bcs.Address.parse(bytes))).toEqual([agent])
  expect(f.guarded()).toBe(2)
})

test('combined balances do not bypass the owner top-up fee or produce a signature', async () => {
  const f = funding_fixture(900n, 200n)
  const failure = await f.funding
    .ensure(agent, { budget_mist: 1000n, cost_mist: 100n, required_mist: 1000n })
    .catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(AgentReturnFundingRequired)
  expect((failure as AgentReturnFundingRequired).cost_mist).toBe(1900n)
  expect(f.submitted).toEqual([])
})

test('an unfunded owner receives the exact claim shortfall from the funded agent through its ordinary signer', async () => {
  const f = funding_fixture(0n, 3000n)
  await f.funding.ensure(owner, { budget_mist: 1000n, cost_mist: 100n, required_mist: 1000n })
  expect(f.submitted).toHaveLength(1)
  expect(f.submitted[0]!.getData().sender).toBe(agent)
  const values = f.submitted[0]!.getData().inputs.flatMap((input) => (input.Pure ? [fromBase64(input.Pure.bytes)] : []))
  expect(values.filter((bytes) => bytes.length === 8).map((bytes) => bcs.u64().parse(bytes))).toEqual(['1000'])
  expect(values.filter((bytes) => bytes.length === 32).map((bytes) => bcs.Address.parse(bytes))).toEqual([owner])
})

test('insufficient agent funds for an owner top-up open owner funding without signing', async () => {
  const f = funding_fixture(0n, 2000n)
  await expect(
    f.funding.ensure(owner, { budget_mist: 1000n, cost_mist: 100n, required_mist: 1000n })
  ).rejects.toBeInstanceOf(AgentReturnFundingRequired)
  expect(f.submitted).toEqual([])
})
