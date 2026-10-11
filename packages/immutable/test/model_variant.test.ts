// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { model_variant_identity } from '../src/model_variant.ts'

test('published protector identities resolve to three shared family models without renaming mobs', () => {
  const models = ['protector_gaia', 'protector_bricheton', 'protector_miner']
  expect(model_variant_identity('protector_shrooms_gaia', models)).toEqual({
    basename: 'protector_gaia',
    variant: 'shrooms',
  })
  expect(model_variant_identity('protector_wheat_bricheton', models)).toEqual({
    basename: 'protector_bricheton',
    variant: 'wheat',
  })
  expect(model_variant_identity('protector_cursed_gem', models)).toEqual({
    basename: 'protector_miner',
    variant: 'cursed_gem',
  })
  expect(model_variant_identity('protector_miner__quartz', models)).toEqual({
    basename: 'protector_miner',
    variant: 'quartz',
  })
  expect(model_variant_identity('protector_', models)).toBeNull()
  expect(model_variant_identity('protector_quartz__extra', models)).toBeNull()
  expect(model_variant_identity('protector_quartz', ['aragne'])).toBeNull()
})
