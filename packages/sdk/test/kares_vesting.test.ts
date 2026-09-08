// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { bcs } from '@mysten/sui/bcs'

import { COMMUNITY_VESTING_MS, KARES_ALLOCATION } from '../src/kares_economics.ts'
import { project_community_claimable } from '../src/kares_decode.ts'
import { create_kares_start_transaction, create_kares_community_claim_transaction } from '../src/kares_ptb.ts'

import { id } from './helpers/transport.ts'

const total = KARES_ALLOCATION.community
const state = (community_tokens = total) => ({ settled: true, settled_ms: 100n, community_tokens })

test('community calendar vesting constants match their native owner', () => {
  const source = readFileSync(new URL('../../kares/sources/offering.move', import.meta.url), 'utf8')
  const days = source.match(/const COMMUNITY_VESTING_MS: u64 = ([\d_]+) \* DAY_MS;/)!
  const day = source.match(/const DAY_MS: u64 = ([\d_]+);/)!
  expect(BigInt(days[1].replaceAll('_', '')) * BigInt(day[1].replaceAll('_', ''))).toBe(COMMUNITY_VESTING_MS)
})

test('only successful settlement starts release, with no initial unlock or staking-clock input', () => {
  expect(project_community_claimable({ ...state(), settled: false }, COMMUNITY_VESTING_MS * 2n)).toBe(0n)
  expect(project_community_claimable(state(), 100n)).toBe(0n)
  expect(project_community_claimable(state(), 100n + COMMUNITY_VESTING_MS / 5n)).toBe(total / 5n)
  expect(project_community_claimable(state(), 100n + COMMUNITY_VESTING_MS * 2n)).toBe(total)
})

test('claim cadence preserves cumulative entitlement and fully exhausts the same reserve', () => {
  let remaining = total
  for (let elapsed = 1n; elapsed <= 1_000n; elapsed++) {
    remaining -= project_community_claimable(state(remaining), 100n + elapsed)
    expect(total - remaining).toBe((total * elapsed) / COMMUNITY_VESTING_MS)
  }
  expect(project_community_claimable(state(remaining), 100n + COMMUNITY_VESTING_MS)).toBe(remaining)
  expect(project_community_claimable(state(0n), 100n + COMMUNITY_VESTING_MS)).toBe(0n)
})

test('malformed reserve and stale clock snapshots fail closed', () => {
  expect(() => project_community_claimable(state(total + 1n), 100n)).toThrow('malformed')
  expect(() => project_community_claimable(state(-1n), 100n)).toThrow('malformed')
  expect(() => project_community_claimable({ ...state(total - 1n), settled: false }, 100n)).toThrow('before settlement')
  expect(() => project_community_claimable(state(), 99n)).toThrow('older than settlement')
  expect(() => project_community_claimable(state(total - 1n), 100n)).toThrow('older than the community claim')
})

test('treasury claim uses only its canonical offering and delivers the exact returned coin', () => {
  const pins = {
    package: id(100),
    original: id(100),
    offering: { id: id(101), shared_version: '2' },
    pool: { id: id(102), shared_version: '2' },
    currency: { id: id(103), shared_version: '2' },
    combat_pot: { id: id(104), shared_version: '2' },
  }
  const data = create_kares_community_claim_transaction(pins, id(200)).getData()
  expect(data.commands).toHaveLength(2)
  expect(data.commands[0].MoveCall).toMatchObject({ package: id(100), module: 'offering', function: 'claim_community' })
  expect(data.inputs[0].Object?.SharedObject?.objectId).toBe(id(101))
  expect(data.commands[1].TransferObjects!.objects).toEqual([{ $kind: 'NestedResult', NestedResult: [0, 0] }])
  const { address: recipient } = data.commands[1].TransferObjects!
  if (recipient.$kind !== 'Input') throw new Error('The treasury must be an explicit address input')
  expect(
    bcs.Address.parse(
      Uint8Array.from(atob(data.inputs[recipient.Input].Pure!.bytes), (character) => character.charCodeAt(0))
    )
  ).toBe(id(200))
})

test('combat activation uses the canonical reserve and original game witness without taking wallet coins', async () => {
  const { create_kares_combat_seed_transaction, create_kares_combat_authorization_transaction } =
    await import('../src/kares_ptb.ts')
  const pins = {
    package: id(100),
    original: id(100),
    offering: { id: id(101), shared_version: '2' },
    pool: { id: id(102), shared_version: '2' },
    currency: { id: id(103), shared_version: '2' },
    combat_pot: { id: id(104), shared_version: '2' },
  }
  const seed = create_kares_combat_seed_transaction(pins).getData()
  expect(seed.commands).toHaveLength(1)
  expect(seed.commands[0].MoveCall).toMatchObject({ package: id(100), module: 'offering', function: 'seed_combat' })
  expect(seed.inputs.map((input) => input.Object?.SharedObject?.objectId)).toEqual([id(101), id(104)])
  const authorize = create_kares_combat_authorization_transaction(pins, id(200)).getData()
  expect(authorize.commands).toHaveLength(1)
  expect(authorize.commands[0].MoveCall).toMatchObject({
    package: id(100),
    module: 'offering',
    function: 'authorize_combat',
    typeArguments: [`${id(200)}::fight_rewards::BossVictory`],
  })
  expect(authorize.inputs.map((input) => input.Object?.SharedObject?.mutable)).toEqual([false, true])
  expect(() => create_kares_combat_authorization_transaction(pins, undefined)).toThrow('original game package')
})

test('one-time start supplies only the canonical offering and native Clock, never a client timestamp', () => {
  const pins = {
    package: id(100),
    original: id(100),
    offering: { id: id(101), shared_version: '2' },
    pool: { id: id(102), shared_version: '2' },
    currency: { id: id(103), shared_version: '2' },
    combat_pot: { id: id(104), shared_version: '2' },
  }
  const data = create_kares_start_transaction(pins).getData()
  expect(data.commands).toHaveLength(1)
  expect(data.commands[0].MoveCall).toMatchObject({ package: id(100), module: 'offering', function: 'start' })
  expect(data.commands[0].MoveCall!.arguments).toHaveLength(2)
  expect(data.inputs.map((input) => input.Object?.SharedObject?.mutable)).toEqual([true, false])
  expect(data.inputs.some((input) => input.Pure)).toBe(false)
})
