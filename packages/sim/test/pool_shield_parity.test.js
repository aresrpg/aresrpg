// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1671 deterministic-twin parity. The `move` expectations are the literal u64 arithmetic asserted by the
// Move fixture in foundation/engine: kind 24 subtracts on every hit, then kind 40 spends its matching-element
// reservoir. Keeping both columns in one fixture makes a one-sided semantic edit fail here.

import { describe, expect, test } from 'bun:test'

import * as spell_effect from '../src/spell_effect.js'
import { consume_shields } from '../src/fight_actions.js'
import { apply_shields } from '../src/spell_calculator.js'

import fixture from './fixtures/pool_shield_parity.json'

const state_of = effects => ({
  team0: [{ id: 'target', effects }],
  team1: [],
})

const live_effects = state => state.team0[0].effects

const resolve_hit = (state, hit) => {
  const folded = apply_shields(hit.damage, hit.element, live_effects(state))
  const next = consume_shields(state, 'target', folded.shields_consumed)
  return { folded, state: next }
}

describe('#1671 pool-shield deterministic-twin parity', () => {
  test('kind 40 is the append-only vocabulary tail', () => {
    expect(spell_effect.K_POOL_SHIELD).toBe(fixture.kind)
    expect(spell_effect.k_pool_shield()).toBe(fixture.kind)
  })

  test('F1 — a 550 pool exhausts across 200/200/300 and leaks 150', () => {
    const vector = fixture.F1_exhaustion_across_hits
    let state = state_of([{ ...vector.pool }])
    const sim = []
    for (const hit of vector.hits) {
      const { folded, state: next_state } = resolve_hit(state, hit)
      state = next_state
      const pool = live_effects(state).find(
        effect => effect.type === 'POOL_SHIELD',
      )
      sim.push({
        damage: folded.damage,
        absorbed:
          folded.shields_consumed.find(
            consumed => consumed.id === vector.pool.id,
          )?.absorbed ?? 0,
        pool_remaining: pool?.value ?? 0,
        active: pool !== undefined,
      })
    }
    expect(sim).toEqual(vector.move)
  })

  test('F2 — an earth pool does not absorb a fire hit', () => {
    const vector = fixture.F2_per_element
    const result = resolve_hit(state_of([{ ...vector.pool }]), vector.hit)
    const [pool] = live_effects(result.state)
    expect({
      damage: result.folded.damage,
      absorbed: result.folded.shields_consumed[0]?.absorbed ?? 0,
      pool_remaining: pool.value,
      active: true,
    }).toEqual(vector.move)
  })

  test('F3 — flat kind 24 applies before the pool', () => {
    const vector = fixture.F3_flat_before_pool
    const result = resolve_hit(
      state_of(vector.effects.map(effect => ({ ...effect }))),
      vector.hit,
    )
    const effects = live_effects(result.state)
    const flat = effects.find(effect => effect.type === 'SHIELD')
    const pool = effects.find(effect => effect.type === 'POOL_SHIELD')
    expect({
      damage: result.folded.damage,
      flat_absorbed: vector.hit.damage - vector.move.pool_absorbed,
      pool_absorbed:
        result.folded.shields_consumed.find(
          consumed => consumed.id === vector.effects[1].id,
        )?.absorbed ?? 0,
      flat_remaining: flat?.value ?? 0,
      pool_remaining: pool?.value ?? 0,
    }).toEqual(vector.move)
  })

  test('F4 — kind 24 remains a per-hit flat and is never consumed', () => {
    const vector = fixture.F4_kind_24_per_hit_regression
    let state = state_of([{ ...vector.flat }])
    const sim = []
    for (const hit of vector.hits) {
      const { folded, state: next_state } = resolve_hit(state, hit)
      state = next_state
      const flat = live_effects(state).find(effect => effect.type === 'SHIELD')
      sim.push({
        damage: folded.damage,
        flat_remaining: flat?.value ?? 0,
        active: flat !== undefined,
      })
    }
    expect(sim).toEqual(vector.move)
  })
})
