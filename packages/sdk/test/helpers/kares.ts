// Synthetic transport scenarios; captured network bytes are verified separately.
import {
  CLOCK_BCS,
  COMBAT_POT_BCS,
  COMMUNITY_POOL_BCS,
  KARES_CURRENCY_BCS,
  STAKE_POSITION_BCS,
  STAKING_POOL_BCS,
} from '../../src/kares_decode.ts'
import { KARES_ALLOCATION, KARES_SUPPLY } from '../../src/kares_economics.ts'

import { id } from './transport.ts'

export const kares_test_pins = {
  kares_rewards_package: id(100),
  kares_rewards_package_original: id(100),
  kares_coin_type: `${id(99)}::token::TOKEN`,
  kares_currency: { id: id(101), shared_version: '1' },
  kares_economy: { id: id(102), shared_version: '1' },
  kares_staking_pool: { id: id(103), shared_version: '1' },
  kares_combat_pot: { id: id(109), shared_version: '1' },
  kares_community_pool: { id: id(110), shared_version: '1' },
}
export const kares_test_owner = id(200)
const object = (object_id: string, type: string, content: Uint8Array) => ({
  objectId: object_id,
  version: '2',
  digest: 'fixture',
  type,
  content,
  json: {} as Record<string, unknown>,
  owner: { $kind: 'Shared' as const, Shared: { initialSharedVersion: '1' } },
})

export const kares_test_objects = () => {
  const pins = kares_test_pins
  return [
    {
      ...object(id(102), `${id(100)}::economy::Economy`, new Uint8Array()),
      json: {
        id: id(102),
        token: pins.kares_coin_type.slice(2),
        currency: id(101),
        staking_pool: id(103),
        combat_pot: id(109),
        community_pool: id(110),
        started_ms: '0',
      },
    },
    object(
      id(103),
      `${id(100)}::staking::StakingPool<${pins.kares_coin_type}>`,
      STAKING_POOL_BCS.serialize({
        id: id(103),
        active: true,
        principal: 10n,
        kares_rewards: KARES_ALLOCATION.rewards,
        sui_rewards: 0n,
        last_wall_ms: 0n,
        active_ms: 0n,
        initial_released: 0n,
        kares_index: 0n,
        sui_index: 0n,
        kares_remainder: 0n,
        sui_remainder: 0n,
        buckets: Array.from({ length: 31 }, () => ({
          start_ms: 0n,
          kares: 0n,
          sui: 0n,
          released_kares: 0n,
          released_sui: 0n,
        })),
      }).toBytes()
    ),
    object(
      id(101),
      `0x2::coin_registry::Currency<${pins.kares_coin_type}>`,
      KARES_CURRENCY_BCS.serialize({
        id: id(101),
        decimals: 9,
        name: 'KARES',
        symbol: 'KARES',
        description: '',
        icon_url: '',
        supply: { BurnOnly: KARES_SUPPLY },
        regulated: { Unregulated: true },
        treasury_cap_id: null,
        metadata_cap_id: { Deleted: true },
        extra_fields: [],
      }).toBytes()
    ),
    object(
      id(109),
      `${id(100)}::combat_rewards::CombatPot<${pins.kares_coin_type}>`,
      COMBAT_POT_BCS.serialize({
        id: id(109),
        balance: KARES_ALLOCATION.combat,
        authorized: { name: `${id(50)}::fight_rewards::BossVictory` },
        started_ms: 0n,
        epoch: 1n,
        epoch_started_ms: 0n,
        work: 0n,
        quota: 20_000n,
        day: 0n,
        spent: 0n,
      }).toBytes()
    ),
    object(
      id(110),
      `${id(100)}::community::CommunityPool<${pins.kares_coin_type}>`,
      COMMUNITY_POOL_BCS.serialize({
        id: id(110),
        treasury: kares_test_owner,
        started_ms: 0n,
        remaining: KARES_ALLOCATION.community,
      }).toBytes()
    ),
    object(id(6), '0x2::clock::Clock', CLOCK_BCS.serialize({ id: id(6), timestamp_ms: 10n }).toBytes()),
  ]
}

export const kares_test_position = () => ({
  objectId: id(201),
  version: '2',
  digest: 'fixture',
  type: `${id(100)}::staking::StakePosition<${kares_test_pins.kares_coin_type}>`,
  owner: { $kind: 'AddressOwner' as const, AddressOwner: kares_test_owner },
  content: STAKE_POSITION_BCS.serialize({
    id: id(201),
    pool: id(103),
    amount: 10n,
    kares_index: 0n,
    sui_index: 0n,
    kares_accrued: 0n,
    sui_accrued: 0n,
  }).toBytes(),
})

export const kares_test_client = () => {
  const state = { objects: kares_test_objects(), positions: [kares_test_position()], balance_reads: 0 }
  const client = {
    network: 'testnet',
    core: {
      getObjects: async ({ objectIds }: { objectIds: string[] }) => ({
        objects: objectIds.map((id) => state.objects.find(({ objectId }) => objectId === id) ?? new Error('not found')),
      }),
      listOwnedObjects: async () => ({ objects: state.positions, hasNextPage: false, cursor: null }),
      getBalance: async () => {
        state.balance_reads += 1
        return { balance: { balance: '12345678901' } }
      },
    },
  }
  return { state, client }
}
