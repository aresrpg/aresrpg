// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { fromBase64 } from '@mysten/sui/utils'

import {
  CLOCK_BCS,
  CONTRIBUTION_BCS,
  KARES_CURRENCY_BCS,
  OFFERING_BCS,
  STAKE_POSITION_BCS,
  STAKING_POOL_BCS,
  project_kares_position,
} from '../src/kares_decode.ts'
import { project_kares_deployment } from '../src/deployment_admin.ts'
import { read_kares_metadata } from '../src/kares_metadata.ts'
import { reconcile_kares_positions } from '../src/kares_ownership.ts'

import currency_capture from './fixtures/kares_currency.testnet.json'
import publication_capture from './fixtures/kares_publication.testnet.json'
import finance_capture from './fixtures/kares_finance.testnet.json'
import external_claim from './fixtures/kares_external_claim.testnet.json'

test('real testnet native Currency carries nine decimals, burn-only issuance, and deleted metadata authority', () => {
  // Object 0xee9e…2713, version 4; captured 2026-09-06 after BEnojWNc…Lndh publication.
  // Full immutable provenance and exact BCS bytes live in the fixture.
  const [captured] = currency_capture.objects
  const currency = KARES_CURRENCY_BCS.parse(fromBase64(captured.bcs))
  expect(currency.id).toBe(captured.object_id)
  expect(currency.decimals).toBe(9)
  expect(currency.symbol).toBe('KARES')
  expect(currency.supply).toEqual({ $kind: 'BurnOnly', BurnOnly: 1_000_000_000_000_000n })
  expect(currency.metadata_cap_id.$kind).toBe('Deleted')
  expect(captured.transaction_digest).toBe(publication_capture.transaction_digest)
})

test('real publication projects native Currency and Genesis despite the package type sentinel', () => {
  // Certified testnet BEnojWNcqiW4ri57r9J2qwgo7RtBGvUxcERhzdtWLndh, 2026-09-06.
  const projected = project_kares_deployment(publication_capture.receipt)
  expect(projected.package).toBe('0x13cc3a99ccf244c8a25af30c7bd490d623b1684cab27e801f456666afe85875e')
  expect(projected.currency).toBe(currency_capture.objects[0].object_id)
  expect(projected.genesis).toBe('0xbeb90dc8b93cf0069361104da3cc1eeaf41fce8bfa40b74bed7d44da0563c5e2')
})

const captured = (stage: string, suffix: string) => {
  const row = finance_capture.objects.find((object) => object.stage === stage && object.type.endsWith(suffix))
  if (!row) throw new Error(`Missing captured ${stage} ${suffix}`)
  return row
}

test('pre-vesting offering bytes cannot masquerade as the sealed treasury-vesting layout', () => {
  // 2026-09-06 Offering version1005398023 predates escrow and atomic UpgradeCap destruction.
  // Preserve its exact bytes: the new layout must reject it instead of inventing reserve state.
  const row = captured('metadata_current', '::offering::Offering')
  expect(() => OFFERING_BCS.parse(fromBase64(row.bcs))).toThrow()
})

test('real contribution bytes preserve independent participant custody', () => {
  // Historic Contribution version1005372971, captured2026-09-06; its layout is unchanged.
  const participant = captured('contribution_opened', '::offering::Contribution')
  const contribution = CONTRIBUTION_BCS.parse(fromBase64(participant.bcs))
  expect(contribution.id).toBe(participant.object_id)
  expect(contribution.amount).toBe(100_000_000n)
  expect(contribution.offering).toBe('0xa487a2819ea4dcabf2101263f0635923aa88100d3a6fd08e759df80069c0c6ab')
})

test('real staking bytes preserve principal, fixed schedules, and the address-balance donation', () => {
  // 8XVrqJMv…P48tw created the stake at version1005374680; HgG2wQNY…NKLV funded version1005398130.
  const position_row = captured('stake_opened', '::staking::StakePosition')
  const position = STAKE_POSITION_BCS.parse(fromBase64(position_row.bcs))
  const original_pool = STAKING_POOL_BCS.parse(fromBase64(captured('stake_opened', '::staking::StakingPool').bcs))
  expect(position.id).toBe(position_row.object_id)
  expect(position.pool).toBe(original_pool.id)
  expect(position.amount).toBe(1_000_000_000_000n)
  expect(original_pool.principal).toBe(position.amount)
  expect(position.kares_accrued).toBe(0n)
  const withdrawn = STAKE_POSITION_BCS.parse(fromBase64(captured('withdrawn_position', '::staking::StakePosition').bcs))
  expect(withdrawn.amount).toBe(0n)
  expect(withdrawn.kares_index).toBe(17_168_950_000_000_000_000_000n)
  expect(project_kares_position(withdrawn, withdrawn)).toEqual({ pending_kares: 1_667_935n, pending_sui: 0n })
  const funded = STAKING_POOL_BCS.parse(fromBase64(captured('address_balance_donation', '::staking::StakingPool').bcs))
  expect(funded).toMatchObject({
    active: true,
    principal: 0n,
    active_ms: 0n,
    initial_released: 0n,
    kares_rewards: 200_001_000_000_000n,
    sui_rewards: 0n,
  })
  expect(funded.buckets).toHaveLength(31)
  expect(funded.buckets[1]).toEqual({
    start_ms: 86_400_000n,
    kares: 1_000_000_000n,
    sui: 0n,
    released_kares: 0n,
    released_sui: 0n,
  })
  const clock = CLOCK_BCS.parse(fromBase64(captured('metadata_current', '::clock::Clock').bcs))
  expect(clock.timestamp_ms).toBe(1_788_692_532_801n)
})

test('real retained native metadata capability belongs to cold storage and preserves burn-only issuance', async () => {
  // BARDy3nV…1AS updated the native Currency and MetadataCap at version1005398025 on2026-09-06.
  const currency = finance_capture.objects.find(
    (row) => row.stage === 'metadata_current' && row.type.includes('::Currency<')
  )!
  const original = '0xd46ddc232c6bbf0d0a8d5735d42fae72da2cb8371047fd1f28d3366e2f2de300'
  const client = {
    core: {
      getObject: async ({ objectId }: { objectId: string }) => {
        const object = finance_capture.objects.find(
          (row) => row.stage === 'metadata_current' && row.object_id === objectId
        )!
        return { object: { objectId, type: object.type, owner: object.owner, content: fromBase64(object.bcs) } }
      },
    },
  }
  const metadata = await read_kares_metadata(
    client as never,
    { id: currency.object_id, shared_version: '1005396762' },
    original
  )
  expect(metadata.name).toBe('AresRPG KARES')
  expect(metadata.icon_url).toBe('https://launchpad.aresrpg.world/kares.png')
  expect(metadata.total_supply).toBe(1_000_000_000_000_000n)
  expect(metadata.metadata_cap).toBe('0xe7cba743a0924963e7352ee005f036e2de8976193e944586184db5cdae0a5770')
  expect(metadata.owner).toBe('0xd2d3a44df77e14a764d89b3a89604b738b6566d8773e905e335c563b339aeece')
})

test('an exact-object history result proves the real externally consumed contribution', async () => {
  // Read-only Ledger affectedObject lookup returned 2FQNcDwh…AYMEX for the captured object on 2026-09-06.
  const client = {
    core: {
      getObjects: async () => ({
        objects: [Object.assign(new Error('not found'), { code: 'notExists', objectId: external_claim.object_id })],
      }),
      getTransaction: async () => external_claim.receipt,
    },
    ledgerService: {
      listTransactions: () => ({
        responses: (async function* () {
          yield external_claim.history_frame
        })(),
      }),
    },
  }
  const resolved = await reconcile_kares_positions(
    client as never,
    { original: '0x13cc3a99ccf244c8a25af30c7bd490d623b1684cab27e801f456666afe85875e' } as never,
    external_claim.owner,
    [{ id: external_claim.object_id, version: BigInt(external_claim.input_version) }]
  )
  expect(resolved).toMatchObject([{ receipt: { Transaction: { digest: external_claim.receipt.Transaction.digest } } }])
})
