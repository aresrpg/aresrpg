// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { fromBase64 } from '@mysten/sui/utils'

import {
  COMMUNITY_POOL_BCS,
  COMBAT_POT_BCS,
  KARES_CURRENCY_BCS,
  STAKING_POOL_BCS,
  STAKE_POSITION_BCS,
  project_community_claimable,
} from '../src/kares_decode.ts'
import { KARES_ALLOCATION, KARES_SUPPLY, COMMUNITY_VESTING_MS } from '../src/kares_economics.ts'

import capture from './fixtures/rewards.testnet.json'

// Real testnet objects captured 2026-10-02 after funded setup and two stakes/one claim.
// Every object ID, version, type and exact wire payload is pinned in the fixture.
const row = (name: string) => {
  const object = capture.objects.find(({ type }) => type.includes(`::${name}<`))
  if (!object) throw new Error(`Missing captured ${name}`)
  return object
}

test('captured currency and community reserve preserve supply and vesting', () => {
  const currency = KARES_CURRENCY_BCS.parse(fromBase64(row('Currency').bcs))
  expect(currency.decimals).toBe(9)
  expect(currency.supply).toEqual({ $kind: 'BurnOnly', BurnOnly: KARES_SUPPLY })
  const community = COMMUNITY_POOL_BCS.parse(fromBase64(row('CommunityPool').bcs))
  expect(community.remaining).toBe(KARES_ALLOCATION.community)
  expect(community.started_ms).toBe(1_790_933_226_234n)
  expect(project_community_claimable(community, community.started_ms + COMMUNITY_VESTING_MS / 2n)).toBe(
    KARES_ALLOCATION.community / 2n
  )
})

test('captured combat reserve fixes its original game witness and starts with no emission debt', () => {
  const combat = COMBAT_POT_BCS.parse(fromBase64(row('CombatPot').bcs))
  expect(combat).toMatchObject({
    id: row('CombatPot').object_id,
    balance: KARES_ALLOCATION.combat,
    authorized: {
      name: '4f532487e0cc336b593f79bc20b9f9220d02f8e554b754e0b5971f1dfc9e5d01::fight_rewards::BossVictory',
    },
    epoch: 1_240n,
    quota: 20_000n,
    work: 0n,
    day: 0n,
    spent: 0n,
  })
})

test('captured generic staking layout separates principal from claimed emissions and retained dust', () => {
  const pool = STAKING_POOL_BCS.parse(fromBase64(row('StakingPool').bcs))
  const positions = capture.objects
    .filter(({ type }) => type.includes('::StakePosition<'))
    .map(({ bcs }) => STAKE_POSITION_BCS.parse(fromBase64(bcs)))
  expect(pool.principal).toBe(150_000_000_000_000n)
  expect(positions.reduce((sum, position) => sum + position.amount, 0n)).toBe(pool.principal)
  expect(positions.every((position) => position.pool === pool.id)).toBe(true)
  expect(pool.initial_released).toBe(191_251_902_587n)
  expect(pool.kares_rewards).toBe(KARES_ALLOCATION.rewards - 191_251_902_586n)
  expect(pool.sui_rewards).toBe(0n)
  expect(pool.buckets).toHaveLength(31)
})
