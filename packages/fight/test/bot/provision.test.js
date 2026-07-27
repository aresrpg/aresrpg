// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1184 — THE SEARCH LEG'S BRAIN, headless. Every `search` row this planner emits is a real SUI transaction, so
// the spend rules are proven by fixtures here rather than by watching a live chain: search where you stand
// before you pay to travel, never search the same zone twice in one run, never target a TTL-fresh zone (the
// chain refuses it), and stop honestly at the bound instead of circling a barren neighbourhood.

import { describe, expect, test } from 'bun:test'

import { MAX_HOPS, pick_hop, plan_provision, zone_key_of } from '../../src/bot/index.js'

const scout = (over = {}) => ({ ok: true, zone: { zx: 10, zy: 10 }, prompt_armed: true, fresh_keys: [], ...over })

describe('plan_provision', () => {
  test('searches where the body already stands — the cheapest spend there is', () => {
    expect(plan_provision(scout(), {})).toEqual({ kind: 'search', zx: 10, zy: 10 })
  })

  test('never searches the same zone twice in one run — the reroll already happened', () => {
    const planned = plan_provision(scout(), { tried: ['10:10'] })
    expect(planned.kind).toBe('hop')
  })

  test('an unarmed lever here is a hop, not a doomed press', () => {
    // [F] is registered exactly when the chain accepts a search; pressing anyway would sign a refusal.
    expect(plan_provision(scout({ prompt_armed: false }), {})).toEqual({ kind: 'hop', zx: 9, zy: 9 })
  })

  test('hops one zone over first, and never onto a TTL-fresh one', () => {
    const fresh = ['9:9', '10:9', '11:9', '9:10', '11:10', '9:11', '10:11']
    const planned = plan_provision(scout({ prompt_armed: false }), {}, {})
    expect(planned).toEqual({ kind: 'hop', zx: 9, zy: 9 })
    expect(plan_provision(scout({ prompt_armed: false, fresh_keys: fresh }), {})).toEqual({
      kind: 'hop',
      zx: 11,
      zy: 11,
    })
  })

  test('the hop budget is the bound — a spent run stops instead of circling', () => {
    const planned = plan_provision(scout({ prompt_armed: false }), { hops: MAX_HOPS, tried: ['10:10'] })
    expect(planned.kind).toBe('exhausted')
    expect(planned.why).toContain(`${MAX_HOPS} zone hops`)
  })

  test('a seat with no standing zone stops honestly rather than guessing one', () => {
    const planned = plan_provision({ ok: false, zone: null }, {})
    expect(planned).toEqual({
      kind: 'exhausted',
      why: 'the seat published no standing zone — the body or the world is unbound',
    })
  })

  test('a neighbourhood that is entirely fresh or tried is exhausted, and says which', () => {
    const fresh = []
    for (let dx = -MAX_HOPS; dx <= MAX_HOPS; dx += 1)
      for (let dy = -MAX_HOPS; dy <= MAX_HOPS; dy += 1) fresh.push(zone_key_of(10 + dx, 10 + dy))
    const planned = plan_provision(scout({ prompt_armed: false, fresh_keys: fresh }), {})
    expect(planned.kind).toBe('exhausted')
    expect(planned.why).toContain('TTL-fresh or already tried')
  })
})

describe('pick_hop', () => {
  test('stays on the u32 zone grid — there is no zone west of 0', () => {
    expect(pick_hop({ zx: 0, zy: 0 }, new Set())).toEqual({ zx: 1, zy: 0 })
  })

  test('is deterministic: the same board picks the same zone every time', () => {
    const off = new Set(['9:9', '10:9'])
    expect(pick_hop({ zx: 10, zy: 10 }, off)).toEqual(pick_hop({ zx: 10, zy: 10 }, off))
  })
})
