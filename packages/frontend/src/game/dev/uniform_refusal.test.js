// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { first_uniform_refusal, uniform_refusal_sample_size } from './uniform_refusal.js'

describe('first_uniform_refusal', () => {
  const reason = 'SimulationError: fight_latch::ECharacterInFight (full refusal fingerprint)'

  test('waits for the complete initial sample', () => {
    expect(first_uniform_refusal(Array(uniform_refusal_sample_size - 1).fill(reason))).toBeNull()
  })

  test('returns the exact full reason when the first sample is uniform', () => {
    expect(first_uniform_refusal(Array(uniform_refusal_sample_size).fill(reason))).toBe(reason)
  })

  test('does not classify a mixed initial sample as account-wide', () => {
    const refusal_reasons = Array(uniform_refusal_sample_size).fill(reason)
    refusal_reasons[3] = 'SimulationError: zones::EWrongCheckpoint'
    expect(first_uniform_refusal(refusal_reasons)).toBeNull()
  })
})
