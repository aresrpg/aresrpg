// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { bcs } from '@mysten/sui/bcs'
import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 as from_base64 } from '@mysten/sui/utils'

import { normalize_mob_template } from '../../frontend/src/chain/read_templates.js'
import { STAT_BIAS } from '../../frontend/src/chain/stat_bias.js'

import { normalize_seed_mob_stats, seed_mob_stat_values } from './seed_mob_stats.mjs'

const PACKAGE_ID = `0x${'1'.padStart(64, '0')}`
const MOB_ID = `0x${'2'.padStart(64, '0')}`

const chain_stats_from_seed = (seed_stats) => {
  const tx = new Transaction()
  tx.moveCall({
    target: `${PACKAGE_ID}::spell::new_stats`,
    arguments: seed_mob_stat_values(seed_stats, STAT_BIAS).map((value) => tx.pure.u64(value)),
  })
  const values = tx
    .getData()
    .inputs.filter((input) => input.$kind === 'Pure')
    .map((input) => Number(bcs.u64().parse(from_base64(input.Pure.bytes))))
  return {
    fire_resistance: values[7],
    water_resistance: values[8],
    earth_resistance: values[9],
    air_resistance: values[10],
  }
}

test('abbreviated seed resistances survive the canonical chain reader round-trip', () => {
  const seed_stats = {
    fireRes: 11,
    waterRes: -7,
    earthRes: 20,
    airRes: 3,
  }
  const normalized = normalize_seed_mob_stats(seed_stats, STAT_BIAS)
  const stats = chain_stats_from_seed(seed_stats)
  const mob = normalize_mob_template({ stats }, MOB_ID)

  expect(normalized).toMatchObject({
    fire_resistance: STAT_BIAS + 11,
    water_resistance: STAT_BIAS - 7,
    earth_resistance: STAT_BIAS + 20,
    air_resistance: STAT_BIAS + 3,
  })
  expect(normalized).not.toHaveProperty('fireRes')
  expect(normalized).not.toHaveProperty('waterRes')
  expect(normalized).not.toHaveProperty('earthRes')
  expect(normalized).not.toHaveProperty('airRes')
  expect(mob).toMatchObject({
    fireResistance: 11,
    waterResistance: -7,
    earthResistance: 20,
    airResistance: 3,
  })
})
