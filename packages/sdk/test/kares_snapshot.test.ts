// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_kares_snapshot_reader } from '../src/kares_snapshot.ts'
import { create_cache } from '../src/cache.ts'
import { STAKE_POSITION_BCS } from '../src/kares_decode.ts'
import { KARES_ALLOCATION, KARES_SUPPLY } from '../src/kares_economics.ts'

import { kares_test_client, kares_test_owner, kares_test_pins } from './helpers/kares.ts'
import { id } from './helpers/transport.ts'

const fixture = () => {
  const { state, client } = kares_test_client()
  return { state, client, reader: create_kares_snapshot_reader(client as never, kares_test_pins, 'testnet') }
}

test('reads one funded currency and its linked reserves without an offering dependency', async () => {
  const { reader } = fixture()
  const snapshot = await reader.snapshot(kares_test_owner)
  expect(snapshot.total_supply).toBe(KARES_SUPPLY)
  expect(snapshot.pool.kares_rewards).toBe(KARES_ALLOCATION.rewards)
  expect(snapshot.combat_pot.balance).toBe(KARES_ALLOCATION.combat)
  expect(snapshot.community.remaining).toBe(KARES_ALLOCATION.community)
  expect(snapshot.positions[0].amount).toBe(10n)
  expect(snapshot.kares_balance).toBe(12_345_678_901n)
  expect('offering' in snapshot).toBe(false)
})

test('game staking does not read or retain a second wallet balance', async () => {
  const { reader, state } = fixture()
  const snapshot = await reader.staking_snapshot(kares_test_owner)
  expect(state.balance_reads).toBe(0)
  expect('kares_balance' in snapshot).toBe(false)
  expect((await reader.snapshot()).positions).toEqual([])
  expect(state.balance_reads).toBe(0)
})

test('foreign currency and reserve object identities fail closed', async () => {
  const { reader, state } = fixture()
  state.objects[0].json.currency = id(999)
  await expect(reader.snapshot()).rejects.toThrow('not linked')
})

test('foreign reward-package types and wrong shared versions are rejected', async () => {
  const { reader, state } = fixture()
  const original = state.objects[0].type
  state.objects[0].type = original.replace(id(100), id(999))
  await expect(reader.snapshot()).rejects.toThrow('Unexpected canonical')
  state.objects[0].type = original
  state.objects[0].owner.Shared.initialSharedVersion = '9'
  await expect(reader.snapshot()).rejects.toThrow('shared-object version')
})

test('staking positions must belong to this owner, pool and configured token', async () => {
  const { reader, state } = fixture()
  state.positions[0].owner.AddressOwner = id(999)
  await expect(reader.snapshot(kares_test_owner)).rejects.toThrow('another wallet')
  state.positions[0].owner.AddressOwner = kares_test_owner
  const p = STAKE_POSITION_BCS.parse(state.positions[0].content)
  state.positions[0].content = STAKE_POSITION_BCS.serialize({ ...p, pool: id(999) }).toBytes()
  await expect(reader.snapshot(kares_test_owner)).rejects.toThrow('another staking pool')
  state.positions[0].content = STAKE_POSITION_BCS.serialize(p).toBytes()
  state.positions[0].type = state.positions[0].type.replace(id(99), id(998))
  await expect(reader.snapshot(kares_test_owner)).rejects.toThrow('Unexpected canonical')
})

test('omitting a previously observed position never invents an empty stake', async () => {
  const { reader, state } = fixture()
  await reader.snapshot(kares_test_owner)
  const [position] = state.positions
  state.positions = []
  await expect(reader.snapshot(kares_test_owner)).rejects.toThrow('behind a certified transaction')
  state.positions = [position]
  expect((await reader.snapshot(kares_test_owner)).positions).toHaveLength(1)
})

test('certified shared-object writes reject stale snapshots until the RPC catches up', async () => {
  const { reader, state } = fixture()
  reader.observe_receipt({
    Transaction: {
      digest: 'certified',
      effects: {
        status: { success: true },
        changedObjects: [{ objectId: id(103), outputState: 'ObjectWrite', outputVersion: '3' }],
      },
    },
  })
  await expect(reader.snapshot()).rejects.toThrow('behind a certified transaction')
  state.objects.find((object) => object.objectId === id(103))!.version = '3'
  expect((await reader.snapshot()).pool.version).toBe('3')
})

test('the shared SDK cache floor also protects first finance reads', async () => {
  const { client } = fixture()
  const cache = create_cache()
  cache.shared.set(id(103), { initialSharedVersion: '1', version: '3' })
  const reader = create_kares_snapshot_reader(client as never, kares_test_pins, 'testnet', cache)
  await expect(reader.snapshot()).rejects.toThrow('behind a certified transaction')
})

test('network mismatches, missing objects and duplicate owned rows are refused', async () => {
  const { reader, state, client } = fixture()
  client.network = 'mainnet'
  await expect(reader.snapshot()).rejects.toThrow('different network')
  client.network = 'testnet'
  state.positions.push(state.positions[0])
  await expect(reader.snapshot(kares_test_owner)).rejects.toThrow('ownership changed')
  state.objects = []
  await expect(reader.snapshot()).rejects.toThrow('unavailable')
})
