// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { bcs } from '@mysten/sui/bcs'

import { COMMUNITY_VESTING_MS, KARES_ALLOCATION } from './kares_economics.ts'

const U64 = bcs.u64().transform({ input: (value: bigint) => value, output: BigInt })
const U256 = bcs.u256().transform({ input: (value: bigint) => value, output: BigInt })

export const COMMUNITY_POOL_BCS = bcs.struct('CommunityPool', {
  id: bcs.Address,
  treasury: bcs.Address,
  started_ms: U64,
  remaining: U64,
})
export const COMBAT_POT_BCS = bcs.struct('CombatPot', {
  id: bcs.Address,
  balance: U64,
  authorized: bcs.struct('TypeName', { name: bcs.String }),
  started_ms: U64,
  epoch: U64,
  epoch_started_ms: U64,
  work: U64,
  quota: U64,
  day: U64,
  spent: U64,
})

/** Calendar vesting is independent of the paused staking clock. */
export const project_community_claimable = (
  pool: Readonly<{ started_ms: bigint; remaining: bigint }>,
  clock_ms: bigint
): bigint => {
  const total = KARES_ALLOCATION.community
  if (pool.remaining < 0n || pool.remaining > total) throw new Error('KARES community reserve is malformed')
  if (clock_ms < pool.started_ms) throw new Error('KARES clock read is older than funding')
  const elapsed = clock_ms - pool.started_ms
  const vested = (total * (elapsed < COMMUNITY_VESTING_MS ? elapsed : COMMUNITY_VESTING_MS)) / COMMUNITY_VESTING_MS
  const claimed = total - pool.remaining
  if (vested < claimed) throw new Error('KARES clock read is older than the community claim')
  return vested - claimed
}
const BUCKET_BCS = bcs.struct('RewardBucket', {
  start_ms: U64,
  kares: U64,
  sui: U64,
  released_kares: U64,
  released_sui: U64,
})
export const STAKING_POOL_BCS = bcs.struct('StakingPool', {
  id: bcs.Address,
  active: bcs.bool(),
  principal: U64,
  kares_rewards: U64,
  sui_rewards: U64,
  last_wall_ms: U64,
  active_ms: U64,
  initial_released: U64,
  kares_index: U256,
  sui_index: U256,
  kares_remainder: U256,
  sui_remainder: U256,
  buckets: bcs.vector(BUCKET_BCS),
})
export const STAKE_POSITION_BCS = bcs.struct('StakePosition', {
  id: bcs.Address,
  pool: bcs.Address,
  amount: U64,
  kares_index: U256,
  sui_index: U256,
  kares_accrued: U256,
  sui_accrued: U256,
})
export const CLOCK_BCS = bcs.struct('Clock', { id: bcs.Address, timestamp_ms: U64 })
export const KARES_CURRENCY_BCS = bcs.struct('Currency', {
  id: bcs.Address,
  decimals: bcs.u8(),
  name: bcs.String,
  symbol: bcs.String,
  description: bcs.String,
  icon_url: bcs.String,
  supply: bcs.option(bcs.enum('SupplyState', { Fixed: U64, BurnOnly: U64, Unknown: null })),
  regulated: bcs.enum('RegulatedState', {
    Regulated: bcs.struct('Regulated', {
      cap: bcs.Address,
      allow_global_pause: bcs.option(bcs.bool()),
      variant: bcs.u8(),
    }),
    Unregulated: null,
    Unknown: null,
  }),
  treasury_cap_id: bcs.option(bcs.Address),
  metadata_cap_id: bcs.enum('MetadataCapState', { Claimed: bcs.Address, Unclaimed: null, Deleted: null }),
  extra_fields: bcs.vector(
    bcs.struct('Entry', {
      key: bcs.String,
      value: bcs.tuple([bcs.String, bcs.vector(bcs.u8())]),
    })
  ),
})

export type KaresPoolState = ReturnType<typeof STAKING_POOL_BCS.parse>
export type KaresPositionState = ReturnType<typeof STAKE_POSITION_BCS.parse>
export const REWARD_SCALE = 10n ** 27n
export const REWARD_DAY_MS = 86_400_000n
export const INITIAL_REWARDS = KARES_ALLOCATION.rewards
export const INITIAL_DURATION_MS = 1_825n * REWARD_DAY_MS
export const SUPPLEMENTARY_DURATION_MS = 30n * REWARD_DAY_MS
const linear = (amount: bigint, elapsed: bigint, duration: bigint): bigint =>
  (amount * (elapsed < duration ? elapsed : duration)) / duration

const released_rewards = (pool: KaresPoolState, active_ms: bigint) => {
  const initial_released = linear(INITIAL_REWARDS, active_ms, INITIAL_DURATION_MS)
  const supplementary = pool.buckets.reduce(
    (total, bucket) => {
      const elapsed = active_ms > bucket.start_ms ? active_ms - bucket.start_ms : 0n
      return {
        kares: total.kares + linear(bucket.kares, elapsed, SUPPLEMENTARY_DURATION_MS) - bucket.released_kares,
        sui: total.sui + linear(bucket.sui, elapsed, SUPPLEMENTARY_DURATION_MS) - bucket.released_sui,
      }
    },
    { kares: 0n, sui: 0n }
  )
  return {
    initial_released,
    kares: initial_released - pool.initial_released + supplementary.kares,
    sui: supplementary.sui,
  }
}

/** Presentation mirror of staking::update; never a transaction input or payout authority. */
export const project_kares_pool = (pool: KaresPoolState, clock_ms: bigint) => {
  if (clock_ms < pool.last_wall_ms) throw new Error('KARES clock read is older than the pool')
  const active_ms = pool.active_ms + (pool.active && pool.principal > 0n ? clock_ms - pool.last_wall_ms : 0n)
  const released = released_rewards(pool, active_ms)
  // An empty active pool resumes when the first stake arrives. This forecasts funded emissions,
  // while the caller applies the current or proposed stake share.
  const next_day = released_rewards(pool, active_ms + (pool.active ? REWARD_DAY_MS : 0n))
  const kares_index =
    pool.kares_index + (pool.principal ? (released.kares * REWARD_SCALE + pool.kares_remainder) / pool.principal : 0n)
  const sui_index =
    pool.sui_index + (pool.principal ? (released.sui * REWARD_SCALE + pool.sui_remainder) / pool.principal : 0n)
  return Object.freeze({
    active_ms,
    initial_remaining: INITIAL_REWARDS - released.initial_released,
    kares_index,
    sui_index,
    daily_kares: next_day.kares - released.kares,
    daily_sui: next_day.sui - released.sui,
  })
}

export const project_kares_position = (
  pool: Readonly<{ kares_index: bigint; sui_index: bigint }>,
  position: KaresPositionState
) => {
  if (position.kares_index > pool.kares_index || position.sui_index > pool.sui_index)
    throw new Error('KARES pool read is older than the position')
  return Object.freeze({
    pending_kares:
      (position.kares_accrued + position.amount * (pool.kares_index - position.kares_index)) / REWARD_SCALE,
    pending_sui: (position.sui_accrued + position.amount * (pool.sui_index - position.sui_index)) / REWARD_SCALE,
  })
}
