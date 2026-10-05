// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { bcs } from '@mysten/sui/bcs'

import { COMMUNITY_VESTING_MS, KARES_ALLOCATION } from '../src/kares_economics.ts'
import { project_community_claimable } from '../src/kares_decode.ts'
import { create_kares_community_claim_transaction } from '../src/kares_ptb.ts'

import { id } from './helpers/transport.ts'

const total = KARES_ALLOCATION.community
const state = (remaining = total) => ({ started_ms: 100n, remaining })

test('community calendar duration matches the native owner', () => {
  const source = readFileSync(new URL('../../rewards/sources/amounts.move', import.meta.url), 'utf8')
  expect(source).toContain('1_825 * 86_400_000')
  expect(COMMUNITY_VESTING_MS).toBe(1_825n * 86_400_000n)
})

test('funded setup starts release, with no initial unlock or staking-clock input', () => {
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
  expect(() => project_community_claimable(state(), 99n)).toThrow('older than funding')
  expect(() => project_community_claimable(state(total - 1n), 100n)).toThrow('older than the community claim')
})

test('treasury claim uses only its canonical reserve and delivers the exact returned coin', () => {
  const pins = {
    package: id(100),
    original: id(100),
    coin_type: `${id(99)}::token::TOKEN`,
    economy: { id: id(101), shared_version: '2' },
    community: { id: id(105), shared_version: '2' },
    pool: { id: id(102), shared_version: '2' },
    currency: { id: id(103), shared_version: '2' },
    combat_pot: { id: id(104), shared_version: '2' },
  }
  const data = create_kares_community_claim_transaction(pins, id(200)).getData()
  expect(data.commands).toHaveLength(2)
  expect(data.commands[0].MoveCall).toMatchObject({ package: id(100), module: 'community', function: 'claim' })
  expect(data.inputs[0].Object?.SharedObject?.objectId).toBe(id(105))
  expect(data.commands[1].TransferObjects!.objects).toEqual([{ $kind: 'NestedResult', NestedResult: [0, 0] }])
  const { address: recipient } = data.commands[1].TransferObjects!
  if (recipient.$kind !== 'Input') throw new Error('The treasury must be an explicit address input')
  expect(
    bcs.Address.parse(
      Uint8Array.from(atob(data.inputs[recipient.Input].Pure!.bytes), (character) => character.charCodeAt(0))
    )
  ).toBe(id(200))
})
