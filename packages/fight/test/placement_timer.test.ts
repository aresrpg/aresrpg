// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_fight } from '../src/fight.ts'

import { create_fixture } from './helpers.ts'

test('an unarmed placement clock can never force-start', () => {
  const checkpoint = structuredClone(create_fixture().checkpoint)
  checkpoint.contract.placement_ms = 0n
  checkpoint.contract.fighters.forEach((fighter) => {
    if (fighter.kind.type === 'player') fighter.ready = false
  })

  const result = create_fight({ state: checkpoint, mode: 'remote' }).apply({
    type: 'start',
    observed_ms: 1_000_000n,
  })

  expect(result.error?.code).toBe('not_ready')
  expect(result.state.contract.round).toBe(0n)
})
