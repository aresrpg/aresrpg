// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1263 — the world-fight claim scan must FAIL FAST per refusal class instead of spending its whole ceiling
// proving one fact. The candidate set here is the reported live shape: 11 zones × 50 groups = 550 candidates.

import { describe, expect, test } from 'bun:test'

import {
  first_uniform_refusal,
  refusal_scope,
  scan_for_claimable_group,
  uniform_refusal_sample_size,
} from '../../../src/game/dev/world_fight_scan.js'

/** 11 zones × 50 groups — the reported ~550-candidate scan. */
const candidates = Array.from({ length: 550 }, (_, i) => ({
  spawn_id: String(i),
  template_id: 'mob',
  zx: Math.floor(i / 50),
  zy: 0,
}))

// The kiosk strand as `create_world_fight` throws it (dungeon_engage_actions.js — the `!handle` door).
const strand_error = () =>
  Object.assign(new Error('That character is not in your kiosk'), { refusal_scope: 'character' })
// Pre-flight dry-run refusals, in the SimulationError shape the node reports (abort_copy's SIM_ABORT_RE form).
const travel_error = () => new Error('SimulationError: MoveAbort abort code 121 in world::checkpoint')
const claimed_error = () => new Error('SimulationError: MoveAbort abort code 108 in zones::claim_group')

describe('refusal_scope', () => {
  test('a character-scoped refusal disqualifies every candidate', () => {
    expect(refusal_scope(strand_error())).toBe('character')
    expect(refusal_scope(new Error('SimulationError: MoveAbort abort code 103 in fight_latch::latch'))).toBe(
      'character'
    )
  })

  test('a travel refusal is zone-scoped', () => {
    expect(refusal_scope(travel_error())).toBe('zone')
  })

  test('an unmapped refusal stays spawn-scoped (never skips a claimable group)', () => {
    expect(refusal_scope(claimed_error())).toBe('spawn')
    expect(refusal_scope(new Error('boom'))).toBe('spawn')
  })
})

describe('scan_for_claimable_group', () => {
  test('a kiosk strand stops on the FIRST refusal with the strand verdict', async () => {
    let attempts = 0
    const result = await scan_for_claimable_group({
      candidates,
      attempt: async () => {
        attempts += 1
        throw strand_error()
      },
    })
    expect(attempts).toBe(1)
    expect(result.verdict).toBe('strand')
    expect(result.reason).toContain('not in your kiosk')
    expect(result.remaining).toBe(549)
  })

  test('#1263 repro: a MIXED refusal stream never trips the uniform net — the strand must stop it', async () => {
    // The reported live shape: the first candidates refuse for varied reasons (claimed groups, unreachable
    // zones), so the initial sample is mixed and `first_uniform_refusal` can never fire again — the scan then
    // runs all 550 dry-runs at ~0.8s each and reports a timeout instead of the one fact it learned first.
    let attempts = 0
    const result = await scan_for_claimable_group({
      candidates,
      attempt: async (candidate) => {
        attempts += 1
        if (Number(candidate.spawn_id) < 2) throw claimed_error()
        throw strand_error()
      },
    })
    expect(attempts).toBe(3)
    expect(result.verdict).toBe('strand')
  })

  test('an unreachable zone skips its remaining candidates for free', async () => {
    const tried = []
    const result = await scan_for_claimable_group({
      candidates,
      attempt: async (candidate) => {
        tried.push(candidate.spawn_id)
        throw travel_error()
      },
    })
    // One refusal per zone, not one per group: 11 zones, 11 dry-runs.
    expect(tried).toHaveLength(11)
    expect(result.attempted).toBe(11)
    expect(result.verdict).toBe('exhausted')
    expect(result.tally.zone).toBe(11)
  })

  test('an exhausted scan reports the real cause instead of a bare no-group line', async () => {
    const result = await scan_for_claimable_group({
      candidates: candidates.slice(0, 3),
      attempt: async () => {
        throw claimed_error()
      },
    })
    expect(result.verdict).toBe('exhausted')
    expect(result.attempted).toBe(3)
    expect(result.tally).toEqual({ character: 0, zone: 0, spawn: 3 })
  })

  test('an UNMAPPED uniform refusal still stops the scan (the fallback net)', async () => {
    let attempts = 0
    const result = await scan_for_claimable_group({
      candidates,
      attempt: async () => {
        attempts += 1
        throw new Error('SimulationError: something nobody mapped yet')
      },
    })
    expect(attempts).toBe(uniform_refusal_sample_size)
    expect(result.verdict).toBe('uniform')
  })

  test('the first claimable group wins and the scan stops there', async () => {
    const result = await scan_for_claimable_group({
      candidates,
      attempt: async (candidate) => {
        if (candidate.spawn_id !== '2') throw claimed_error()
        return 'FIGHT_0x1'
      },
    })
    expect(result).toMatchObject({ fight_id: 'FIGHT_0x1', verdict: 'mounted', attempted: 3 })
  })
})

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
