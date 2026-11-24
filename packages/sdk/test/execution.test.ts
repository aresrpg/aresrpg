// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The SDK execute door: simulate before signing, submit the same bytes once, absorb the receipt once,
// let the Sui resolver own gas, and order one account's lane across tabs.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, spyOn, test } from 'bun:test'
import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { fromBase64 } from '@mysten/sui/utils'
import type { Wallet, WalletAccount } from '@mysten/wallet-standard'

import {
  GAS_BUDGET_MIST,
  SDK,
  absorb_receipt,
  create_gas_ledger,
  gas_mist_from_receipt,
  log_transaction_receipt,
  sui_transport,
} from '../src/client.ts'
import {
  executed_transaction_digest,
  pre_submission_failure,
  pre_submission_version_race,
  transaction_failure_kind,
} from '../src/transaction_error.ts'
import { create_wallet_binding } from '../src/wallet_standard.ts'

import {
  changed,
  digest,
  fake_client,
  id,
  memory_storage,
  pins as base_pins,
  sample_gas,
  signer,
  type FakeClient,
} from './helpers/transport.ts'

const pins = { ...base_pins, math_package: id(2) }

const game = async (client: FakeClient) => {
  const sdk = SDK({ client, signer, pins, transaction_storage: null })
  await sdk.hydrate([id(11)])
  absorb_receipt(sdk.cache, { Transaction: { effects: { changedObjects: [changed(id(13), '5')] } } })
  return sdk
}
const raise_stat = (sdk: Awaited<ReturnType<typeof game>>, tx = sdk.tx()) => {
  sdk.doors.raise_stat(tx, { kiosk: id(11), cap: id(13), character_id: id(13), stat: 'strength', points: 5 })
  return tx
}
const wallet_sdk = (client: FakeClient, refuse: () => Error | null = () => null) => {
  const wallet = { signatures: 0 }
  const sdk = SDK({
    address: id(99),
    client,
    pins,
    transaction_storage: null,
    sign_transaction: async () => {
      wallet.signatures += 1
      const refusal = refuse()
      if (refusal) throw refusal
      return { bytes: new Uint8Array([1]), signature: 'wallet-signature' }
    },
  })
  return { sdk, wallet }
}
const transfer_gas = (sdk: ReturnType<typeof SDK>) => {
  const tx = sdk.tx()
  tx.transferObjects([tx.gas], id(98))
  return tx
}

test('a refused simulation never signs, submits or reports, whichever branch carries the refusal', async () => {
  for (const failure_branch of ['FailedTransaction', 'Transaction'] as const) {
    const client = fake_client({ simulate_ok: false, failure_branch })
    const { sdk, wallet } = wallet_sdk(client)
    const observed: unknown[] = []
    sdk.on_transaction((execution) => observed.push(execution))
    await expect(sdk.execute(transfer_gas(sdk))).rejects.toThrow(/NOT submitted.*scribe locked/)
    expect([wallet.signatures, client.calls.executions, observed.length]).toEqual([0, 0, 0])
  }
  const gas = fake_client({ simulate_ok: false, failure_message: 'InsufficientGas' })
  const sdk = await game(gas)
  const refusal = String(await sdk.execute(raise_stat(sdk)).catch((failure: unknown) => failure))
  expect([/gas budget exceeded.*NOT submitted/.test(refusal), refusal.includes('InsufficientGas')]).toEqual([
    true,
    true,
  ])
  const build = fake_client({
    resolution_failure: "provided version doesn't match for object 0x1, provided: 10 actual: 0x9",
  })
  const stale = await game(build)
  const error = await stale.execute(stale.tx()).catch((failure: unknown) => failure)
  expect(String(error)).toMatch(/transaction resolution failed.*NOT submitted.*provided version/)
  expect(pre_submission_failure(error)).toBe(true)
  const lag =
    '[sdk] transaction resolution failed — NOT submitted: provided version does not match for object 0x1, provided: 10 actual: 0x9'
  expect(pre_submission_version_race(new Error(lag))).toBe(true)
  expect([gas.calls.executions, build.calls.executions]).toEqual([0, 0])
  const graphql = SDK({
    client: sui_transport(new SuiGraphQLClient({ network: 'testnet', url: 'https://unused.invalid' })),
    address: id(99),
    pins: {},
    transaction_storage: null,
  })
  await expect(graphql.execute(graphql.tx())).rejects.toThrow('writes require a gRPC client')
})

test('a green simulation submits the same bytes once and the receipt feeds cache, observers and kiosk', async () => {
  const created = { [id(70)]: '0x2::kiosk::Kiosk', [id(71)]: `${id(5)}::personal_kiosk::PersonalKioskCap` }
  const client = fake_client({ created, gas_used: sample_gas })
  const sdk = await game(client)
  const observed: unknown[] = []
  const unsubscribe = sdk.on_transaction((execution) => observed.push(execution))
  await sdk.simulate(sdk.tx())
  expect(observed).toEqual([])
  const [header] = sdk.tx().getData().commands
  expect(header?.MoveCall).toMatchObject({ package: pins.math_package, module: 'aresrpg', function: 'aresrpg' })
  const receipt = await sdk.execute(raise_stat(sdk), { include: { objectTypes: true } })
  expect(receipt.Transaction?.digest).toBe(client.calls.digests[0])
  expect(client.calls.executions).toBe(1)
  expect(sdk.ref(id(50))).toEqual({ objectId: id(50), version: '4', digest })
  expect(sdk.created_personal_kiosk()).toMatchObject({ objectId: id(71), kioskId: id(70), isPersonal: true })
  expect(observed).toEqual([{ digest: client.calls.digests[0], outcome: 'success', gas_mist: '2500000' }])
  unsubscribe()
  await sdk.execute(sdk.tx())
  expect(observed).toHaveLength(1)
  expect(sdk.gas_spent_24h()).toBe(5_000_000n)
  absorb_receipt(sdk.cache, { effects: { changedObjects: [{ ...changed(id(13), '6'), idOperation: 'Deleted' }] } })
  expect(() => raise_stat(sdk)).toThrow(/unresolved object/)

  const failed = await game(fake_client({ execution_ok: false, created, gas_used: sample_gas }))
  const failures: unknown[] = []
  failed.on_transaction((execution) => failures.push(execution))
  await expect(failed.execute(failed.tx())).rejects.toThrow('failed on-chain')
  expect(failed.created_personal_kiosk()).toBeNull()
  expect(failures).toEqual([{ digest: expect.any(String), outcome: 'failure', gas_mist: '2500000' }])
})

test('an executed failure is terminal: its digest is exposed and nothing retries it', async () => {
  const client = fake_client({ execution_ok: false })
  const sdk = SDK({ client, signer, pins, transaction_storage: null })
  const error = await sdk.execute(transfer_gas(sdk)).catch((failure: unknown) => failure)
  expect(String(error)).toMatch(/transaction \S+ failed on-chain.*scribe locked/)
  expect(pre_submission_failure(error)).toBe(false)
  expect(executed_transaction_digest(error)).toBe(client.calls.digests[0]!)
  expect(transaction_failure_kind(error)).toBe('failed')
  await expect(sdk.execute(sdk.tx())).rejects.toThrow(/failed on-chain/)
  expect(client.calls).toMatchObject({ simulations: 2, executions: 2, visibility_waits: [] })
  expect(executed_transaction_digest(new Error('transaction resolution failed — NOT submitted'))).toBeNull()
  expect(
    pre_submission_version_race(new Error('[sdk] transaction D failed on-chain: provided version does not match'))
  ).toBe(false)
  // The fullnode's sentence: sui-rpc-api `error.rs:494-503`, Sui 1.84.1 (rev e83d690), read 2026-11-21.
  const node =
    'Unable to perform gas selection due to insufficient SUI balance (in address balance or coins) for account 0x1 to satisfy required budget 5000000.'
  for (const cause of [
    node,
    'insufficient balance',
    'InsufficientGas',
    'not enough SUI',
    'No valid gas coins found for the transaction.',
  ])
    expect(transaction_failure_kind(new Error(`[sdk] transaction resolution failed — NOT submitted: ${cause}`))).toBe(
      'funding'
    )
  expect(transaction_failure_kind(new Error(node))).toBe('failed')
  expect(transaction_failure_kind(new Error('[sdk] transaction outcome unknown: timeout'))).toBe('uncertain')
})

test('the resolver owns gas: fixed ceiling or estimate, never a receipt-pinned coin, net cost logged once', async () => {
  expect(GAS_BUDGET_MIST).toBe(50_000_000n)
  const client = fake_client()
  const sdk = await game(client)
  await sdk.execute(sdk.tx())
  const next = sdk.tx()
  await sdk.execute(next)
  expect(next.getData().gasData.payment).toEqual([{ objectId: id(50), version: '3', digest }])
  const gasless = fake_client()
  gasless.core.resolveTransactionPlugin = () => async (data, options, after) => {
    if (!options.onlyTransactionKind) {
      data.gasData.price = '1000'
      data.gasData.budget = '5000000'
      data.gasData.payment = []
      data.expiration = {
        $kind: 'ValidDuring',
        ValidDuring: { minEpoch: '1', maxEpoch: '2', minTimestamp: null, maxTimestamp: null, chain: digest, nonce: 7 },
      }
    }
    await after()
  }
  const balance = await game(gasless)
  await balance.execute(balance.tx())
  const paid_by_balance = balance.tx()
  await balance.execute(paid_by_balance)
  expect(paid_by_balance.getData().gasData.payment).toEqual([])

  const log = spyOn(console, 'log').mockImplementation(() => undefined)
  log_transaction_receipt({
    digest: 'tx',
    effects: { gasUsed: { computationCost: '2000000', storageCost: '1000000', storageRebate: '500000' } },
  })
  expect(log).toHaveBeenCalledWith('%c tx ', 'color:#ff5a8b;font-weight:700', 'tx', '0.0025 SUI', {
    status: 'success',
    net_sui: '0.0025',
    computation_sui: '0.002',
    storage_sui: '0.001',
    rebate_sui: '0.0005',
  })
  log.mockRestore()
  let now_ms = 1_000
  const ledger = create_gas_ledger({ address: '0xA', network: 'testnet', storage: memory_storage(), now: () => now_ms })
  const landed = {
    digest: 'fight-turn',
    effects: { gasUsed: { computationCost: '7', storageCost: '5', storageRebate: '2' } },
  }
  expect(gas_mist_from_receipt(landed)).toBe(10n)
  ledger.record(landed)
  ledger.record(landed)
  ledger.tag(landed, 'fight:0xf1')
  expect([ledger.spent_24h(), ledger.spent_24h('fight:0xf1'), ledger.spent_24h('fight:0xf2')]).toEqual([10n, 10n, 0n])
  now_ms += 24 * 60 * 60 * 1_000 + 1
  expect(ledger.spent_24h()).toBe(0n)
  const broken = {
    getItem: () => {
      throw new Error('disabled')
    },
    setItem: () => {
      throw new Error('disabled')
    },
    removeItem: () => undefined,
  }
  const display_only = create_gas_ledger({ address: '0xA', network: 'testnet', storage: broken })
  expect(() => display_only.record({ digest: 'bad', effects: { gasUsed: { computationCost: 'wat' } } })).not.toThrow()
  expect(display_only.spent_24h()).toBe(0n)
})

test('one real gRPC resolver round per write: one checked simulation, then the signer', async () => {
  for (const payment of ['coin', 'balance', 'estimated', 'refused'] as const) {
    const estimated = payment === 'estimated'
    const gas_coins = payment === 'coin' || payment === 'refused' ? [{ objectId: id(50), version: '3', digest }] : []
    const requests: string[] = []
    const signed: Uint8Array[] = []
    const boundary = new Error('reached signing boundary')
    const client: SuiGrpcClient = new SuiGrpcClient({
      network: 'testnet',
      baseUrl: 'https://resolver.invalid',
      fetch: (async (url, options) => {
        requests.push(String(url).split('/').at(-1)!)
        const method = client.transactionExecutionService.methods.find(({ name }) => name === 'SimulateTransaction')!
        const request = method.I.toJson(
          method.I.fromBinary(fromBase64(await new Response(options!.body).text()).subarray(5))
        ) as {
          transaction: Record<string, Parameters<typeof method.O.fromJson>[0]>
          doGasSelection: boolean
          checks: string
        }
        expect([request.doGasSelection, request.checks]).toEqual([true, 'ENABLED'])
        expect((request.transaction.gasPayment as { budget?: string } | undefined)?.budget).toBe(
          estimated ? undefined : String(GAS_BUDGET_MIST)
        )
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
                ...(gas_coins.length
                  ? {}
                  : { expiration: { kind: 'VALID_DURING', minEpoch: '1', epoch: '2', chain: digest, nonce: 1 } }),
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
      transaction_storage: null,
      sign_transaction: async (tx) => {
        expect(tx.getData().gasData.payment).toEqual(gas_coins)
        signed.push(await tx.build())
        throw boundary
      },
    })
    const tx = sdk.tx()
    sdk.doors.ready_fight(tx, { fight_object: { objectId: id(70), initialSharedVersion: '1' }, fighter_idx: 0n })
    await expect(sdk.execute(tx, estimated ? { budget: 'estimate' } : {})).rejects.toThrow(
      payment === 'refused' ? 'Transaction failed' : boundary.message
    )
    expect([signed.length, requests]).toEqual([payment === 'refused' ? 0 : 1, ['SimulateTransaction']])
  }
})

test('a wallet adapter: rejection allows a later explicit attempt, retired operations never sign', async () => {
  const rejection = new Error('User rejected the signature request')
  let rejected = true
  const client = fake_client()
  const { sdk, wallet } = wallet_sdk(client, () => (rejected ? rejection : null))
  const observed: unknown[] = []
  sdk.on_transaction((execution) => observed.push(execution))
  await sdk.read_sui_balance()
  await sdk.read_sui_balance()
  expect(client.calls.balances).toBe(1)
  const error = await sdk.execute(sdk.tx()).catch((failure: unknown) => failure)
  expect([pre_submission_failure(error), (error as Error).cause === rejection]).toEqual([true, true])
  expect([wallet.signatures, client.calls.executions, observed.length, sdk.is_transaction_idle()]).toEqual([
    1,
    0,
    0,
    true,
  ])
  rejected = false
  await sdk.execute(sdk.tx())
  expect([wallet.signatures, client.calls.executions, client.calls.simulations]).toEqual([2, 1, 2])
  await sdk.read_sui_balance()
  expect(client.calls.balances).toBe(2)

  const gate = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  const barrier = fake_client()
  const wait = barrier.core.waitForTransaction
  barrier.core.waitForTransaction = async (input) => {
    entered.resolve()
    await gate.promise
    return wait(input)
  }
  const guarded = wallet_sdk(barrier)
  await guarded.sdk.execute(guarded.sdk.tx())
  const resolved = guarded.sdk.tx()
  resolved.setSender(id(99))
  await resolved.build({ client: barrier as never })
  let live = true
  const pending = guarded.sdk
    .execute(resolved, {
      before_sign: () => {
        if (!live) throw new Error('Operation retired')
      },
    })
    .catch((failure: unknown) => failure)
  await entered.promise
  live = false
  gate.resolve()
  expect([pre_submission_failure(await pending), guarded.wallet.signatures, barrier.calls.executions]).toEqual([
    true,
    1,
    1,
  ])

  for (const stage of ['build', 'queue']) {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const lane = wallet_sdk(fake_client())
    let current = true
    const blocked = lane.sdk.tx()
    blocked.addBuildPlugin(async (_data, _options, next) => {
      entered.resolve()
      await release.promise
      await next()
    })
    const predecessor =
      stage === 'queue'
        ? lane.sdk
            .execute(blocked, {
              before_sign: () => {
                throw new Error('Queue predecessor retired')
              },
            })
            .catch(String)
        : Promise.resolve('')
    const pending = lane.sdk
      .execute(stage === 'build' ? blocked : lane.sdk.tx(), {
        before_sign: () => {
          if (!current) throw new Error('Operation retired')
        },
      })
      .catch((failure: unknown) => failure)
    await entered.promise
    current = false
    release.resolve()
    const retired = await pending
    expect([pre_submission_failure(retired), String(retired).includes('Operation retired')]).toEqual([true, true])
    if (stage === 'queue') expect(await predecessor).toContain('Queue predecessor retired')
    expect([lane.wallet.signatures, lane.sdk.is_transaction_idle()]).toEqual([0, true])
  }
})

test('an Enoki session that is missing or expired can never open a signing popup', async () => {
  const fixture = (read_session: () => Promise<unknown>) => {
    const calls: string[] = []
    const feature = (name: string, result: object) => async () => {
      calls.push(name)
      return result
    }
    const wallet = {
      features: {
        'standard:events': { on: () => () => undefined },
        'enoki:getSession': {
          getSession: async ({ network }: { network: string }) => {
            calls.push(network)
            return read_session()
          },
        },
        'sui:signPersonalMessage': { signPersonalMessage: feature('message', { bytes: '', signature: 'proof' }) },
        'sui:signTransaction': { signTransaction: feature('transaction', { bytes: '', signature: 'transaction' }) },
      },
    } as unknown as Wallet
    const binding = create_wallet_binding(wallet, { address: '0x1' } as WalletAccount, 'mainnet')
    binding.on_invalidated(() => void calls.push('invalidated'))
    return { binding, calls }
  }
  for (const session of [null, { expiresAt: Number.MAX_SAFE_INTEGER }, { jwt: 'test-only', expiresAt: 0 }]) {
    const { binding, calls } = fixture(async () => session)
    await expect(binding.sign_transaction({} as never)).rejects.toThrow('session expired')
    expect(calls).toEqual(['mainnet', 'invalidated'])
    binding.dispose()
  }
  const live = fixture(async () => ({ jwt: 'test-only', expiresAt: Number.MAX_SAFE_INTEGER }))
  await live.binding.sign_personal_message(new Uint8Array())
  await live.binding.sign_transaction({} as never)
  expect(live.calls).toEqual(['mainnet', 'message', 'mainnet', 'transaction'])
  const unread = fixture(async () => {
    throw new Error('storage interrupted')
  })
  await expect(unread.binding.sign_personal_message(new Uint8Array())).rejects.toThrow('storage interrupted')
  expect(unread.calls).toEqual(['mainnet'])
  let complete!: (session: unknown) => void
  const late = fixture(
    () =>
      new Promise((done) => {
        complete = done
      })
  )
  const pending = late.binding.sign_personal_message(new Uint8Array())
  late.binding.dispose()
  complete(null)
  await expect(pending).rejects.toThrow('disconnected')
  expect(late.calls).toEqual(['mainnet'])
})

test('one lane serializes submissions and blocks a pre-resolved write until its predecessor is visible', async () => {
  const gate = Promise.withResolvers<void>()
  const serial = fake_client({ execution_gate: gate.promise })
  const sdk = SDK({ client: serial, signer, pins, transaction_storage: null })
  const submissions = Promise.all([sdk.execute(transfer_gas(sdk)), sdk.execute(transfer_gas(sdk))])
  while (serial.calls.executions === 0) await Promise.resolve()
  expect(serial.calls.executions).toBe(1)
  gate.resolve()
  await submissions
  expect([serial.calls.executions, serial.calls.max_active_executions]).toEqual([2, 1])

  const client = fake_client({ visibility_failures: 1 })
  const { sdk: lane, wallet } = wallet_sdk(client)
  await lane.execute(lane.tx())
  expect(client.calls.visibility_waits).toEqual([])
  const resolved = lane.tx()
  resolved.setSender(id(99))
  resolved.setGasPrice(1000)
  resolved.setGasBudget(5000000)
  resolved.setGasPayment([{ objectId: id(50), version: '4', digest }])
  await expect(lane.execute(resolved)).rejects.toThrow(/next transaction NOT submitted.*ledger has not indexed/)
  expect([wallet.signatures, client.calls.executions]).toEqual([1, 1])
  await lane.execute(resolved)
  expect(client.calls.visibility_waits).toEqual([client.calls.digests[0]!, client.calls.digests[0]!])
  expect([wallet.signatures, client.calls.executions, client.calls.simulations]).toEqual([2, 2, 1])
  await expect(lane.synchronize_transactions()).resolves.toBeUndefined()
})

test('hydration reads only what the cache lacks and absence stays data', async () => {
  const client = fake_client({ lag: new Map([[id(77), 99]]), owned_versions: new Map([[id(79), ['4']]]) })
  const sdk = SDK({ address: id(99), client, pins, transaction_storage: null })
  await sdk.hydrate(Array.from({ length: 21 }, (_, index) => id(index + 100)))
  absorb_receipt(sdk.cache, { Transaction: { effects: { changedObjects: [changed(id(79), '5')] } } })
  await sdk.hydrate_unknown([id(77), id(79), id(100)])
  expect(client.calls.hydrations.map(({ length }) => length)).toEqual([21, 1])
  expect([sdk.cache.shared.has(id(77)), sdk.ref(id(79))?.version]).toEqual([false, '5'])
  expect(await sdk.read_sui_balance()).toBe(10_000_000_000n)
})

test('every SDK submission passes through the one recovery owner, the SDK never polls, players hold no admin door', () => {
  const source_dir = resolve(import.meta.dir, '../src')
  const sources = [...new Bun.Glob('**/*.ts').scanSync(source_dir)].map((file) => ({
    file,
    text: readFileSync(resolve(source_dir, file), 'utf8'),
  }))
  expect(sources.filter(({ text }) => /\.executeTransaction\s*\(/u.test(text)).map(({ file }) => file)).toEqual([
    'transaction_execution.ts',
  ])
  expect(sources.some(({ text }) => /\bset(?:Timeout|Interval)\s*\(/u.test(text))).toBe(false)
  const player_session = sources.find(({ file }) => file === 'auth.ts')!.text
  for (const admin of ['deployment_admin', 'seed_admin', 'publish_contract', 'upgrade_contract'])
    expect(player_session).not.toContain(admin)
})
