// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SINGLE-PTB TURN COMMIT — pure-core proof: the staged-intent → SDK-batch mapping (batch
// path + the empty skip + the loud staging-bug drop) and the executed-failure latch discipline. Zero mocks.
// The effectful retry rows live beside their code: world-shell/overdue_retry.test.js.
import { describe, it, expect } from 'bun:test'

import {
  auto_commit_blocked,
  auto_commit_decision,
  compose_turn_actions,
  executed_turn_failure,
  stage_to_batch,
  strike_flush_illegal,
  turn_commit_key,
} from './turn_commit.js'

const to_cell = (/** @type {number} */ c) => c + 1000 // a visible width conversion

describe('stage_to_batch — staged intents → the ONE-PTB action shape', () => {
  it('maps a full turn (move + weapon + cast) in commit order, cells width-converted', () => {
    const { batch, vfx_keys, dropped } = stage_to_batch(
      [
        { kind: 0, target: 5 },
        { kind: 2, target: 7, spell_key: 'weapon_swing' },
        { kind: 1, target: 9, spell_template_id: '0xabc', spell_key: 'fire_bolt' },
      ],
      to_cell
    )
    expect(batch).toEqual([
      { kind: 'move', cell: 1005 },
      { kind: 'weapon', target_cell: 1007 },
      { kind: 'cast', spell_template_id: '0xabc', target_cell: 1009 },
    ])
    expect(vfx_keys).toEqual(['weapon_swing', 'fire_bolt']) // commit order — the confirm replay routes off this
    expect(dropped).toEqual([])
  })

  it('preserves a move + cast + move interleaving exactly', () => {
    const { batch, vfx_keys, dropped } = stage_to_batch(
      [
        { kind: 0, target: 5 },
        { kind: 1, target: 7, spell_template_id: '0xabc', spell_key: 'fire_bolt' },
        { kind: 0, target: 9 },
      ],
      to_cell
    )
    expect(batch).toEqual([
      { kind: 'move', cell: 1005 },
      { kind: 'cast', spell_template_id: '0xabc', target_cell: 1007 },
      { kind: 'move', cell: 1009 },
    ])
    expect(vfx_keys).toEqual(['fire_bolt'])
    expect(dropped).toEqual([])
  })

  it('empty staging = the skip: an empty batch (the SDK then ships one bare act_pass)', () => {
    expect(stage_to_batch([], to_cell)).toEqual({ batch: [], vfx_keys: [], dropped: [] })
    expect(stage_to_batch(undefined, to_cell)).toEqual({ batch: [], vfx_keys: [], dropped: [] })
  })

  it('a cast staged WITHOUT its SpellTemplate id is DROPPED + reported — never downgraded to a weapon swing', () => {
    const bad = { kind: 1, target: 3, spell_key: 'ghost' }
    const { batch, vfx_keys, dropped } = stage_to_batch([bad, { kind: 0, target: 1 }], to_cell)
    expect(batch).toEqual([{ kind: 'move', cell: 1001 }])
    expect(vfx_keys).toEqual([]) // a dropped cast latches NO vfx
    expect(dropped).toEqual([bad])
  })
})

describe('compose_turn_actions — validated casts return to the reducer-owned draft order', () => {
  it('keeps move → cast → move interleaved after cast validation', () => {
    expect(
      compose_turn_actions(
        [
          { kind: 0, target: 5 },
          { kind: 1, target: 7 },
          { kind: 0, target: 9 },
        ],
        [{ kind: 1, target: 8, spell_template_id: '0xabc', spell_key: 'fire_bolt' }]
      )
    ).toEqual([
      { kind: 0, target: 5 },
      { kind: 1, target: 8, spell_template_id: '0xabc', spell_key: 'fire_bolt' },
      { kind: 0, target: 9 },
    ])
  })

  it('keeps rejected casts as empty slots so later survivors cannot shift earlier', () => {
    expect(
      compose_turn_actions(
        [
          { kind: 1, target: 3 },
          { kind: 0, target: 4 },
          { kind: 2, target: 5 },
        ],
        [null, { kind: 2, target: 6, spell_key: 'weapon' }]
      )
    ).toEqual([
      { kind: 0, target: 4 },
      { kind: 2, target: 6, spell_key: 'weapon' },
    ])
  })
})

describe('executed turn failure latch — same turn never auto-fires twice', () => {
  const key = turn_commit_key({ fight_id: 'fight-1', entity_id: 'hero', deadline_ms: 123_000 })

  it('uses the deadline in the key so consecutive solo turns re-arm naturally', () => {
    expect(key).toBe('fight-1@hero@123000')
    expect(turn_commit_key({ fight_id: 'fight-1', entity_id: 'hero', deadline_ms: 124_000 })).not.toBe(key)
    expect(turn_commit_key({ fight_id: null, entity_id: 'hero', deadline_ms: 123_000 })).toBeNull()
  })

  it('a digest latches automatic fire on only that exact turn; a new deadline fires', () => {
    const latch = executed_turn_failure(key, 'digest-burned-once', 42)
    expect(latch).toEqual({ turn_key: key, digest: 'digest-burned-once', failed_at_ms: 42 })
    expect(auto_commit_blocked(latch, key)).toBe(true)
    expect(
      auto_commit_decision({
        enabled: true,
        draft_count: 1,
        busy: false,
        now_ms: 100,
        deadline_ms: 123_000,
        latch,
        turn_key: key,
      })
    ).toBe('latched')
    expect(
      auto_commit_decision({
        enabled: true,
        draft_count: 1,
        busy: false,
        now_ms: 100,
        deadline_ms: 124_000,
        latch,
        turn_key: turn_commit_key({ fight_id: 'fight-1', entity_id: 'hero', deadline_ms: 124_000 }),
      })
    ).toBe('fire')
  })

  it('busy retries and deadline misses are distinct from an executed-failure latch', () => {
    const input = { enabled: true, draft_count: 1, busy: true, deadline_ms: 10_000, latch: null, turn_key: key }
    expect(auto_commit_decision({ ...input, now_ms: 8_000 })).toBe('retry')
    expect(auto_commit_decision({ ...input, now_ms: 8_600 })).toBe('missed')
  })
})

describe('strike_flush_illegal — the weapon-kill drop that revived the corpse', () => {
  // RED-FIRST root: a hand-weapon swing that OPTIMISTICALLY killed its own target was dropped at flush because the
  // legality gated on the optimistic occupancy (which folds this strike's own kill → dead), then the receipt
  // revived the mob "as if I did nothing". The chain validates act_weapon against LIVE on-chain hp before applying.
  it('a mob-killing WEAPON swing COMMITS — liveness reads chain-committed truth, not the optimistic corpse', () => {
    // optimistic view: the mob is already DEAD (its own swing folded hp→0); on-chain it is still ALIVE.
    expect(
      strike_flush_illegal({
        in_footprint: true,
        is_weapon: true,
        target_is_mob: true,
        committed_target_alive: true, // chain truth — the strike lands while the mob still stands
        occupied_alive: false, // the optimistic occupancy the OLD gate wrongly read
      })
    ).toBe(false) // LEGAL — must not drop the finishing swing
  })

  it('a WEAPON swing at an EMPTY cell or a chain-DEAD mob is still illegal (no phantom strike)', () => {
    expect(strike_flush_illegal({ in_footprint: true, is_weapon: true, target_is_mob: false })).toBe(true)
    expect(
      strike_flush_illegal({ in_footprint: true, is_weapon: true, target_is_mob: true, committed_target_alive: false })
    ).toBe(true)
    expect(
      strike_flush_illegal({ in_footprint: false, is_weapon: true, target_is_mob: true, committed_target_alive: true })
    ).toBe(true) // out of reach/LOS
  })

  it('a SPELL is legal at any in-footprint cell (void casts) — only a free_cell trap drops an occupied-live cell', () => {
    expect(strike_flush_illegal({ in_footprint: true, is_weapon: false })).toBe(false) // void cast — the player's right
    // a damage spell at an optimistically-dead mob stays LEGAL (why the spell kill always worked):
    expect(strike_flush_illegal({ in_footprint: true, is_weapon: false, occupied_alive: false })).toBe(false)
    // a free_cell (trap) spell may not land on a LIVING body:
    expect(strike_flush_illegal({ in_footprint: true, is_weapon: false, free_cell: true, occupied_alive: true })).toBe(
      true
    )
    expect(strike_flush_illegal({ in_footprint: true, is_weapon: false, free_cell: true, occupied_alive: false })).toBe(
      false
    )
    expect(strike_flush_illegal({ in_footprint: false, is_weapon: false })).toBe(true)
  })

  // #321/#323 — a SELF-only buff (invisibility/vanish, rmax 0) targets the caster's OWN tile; it can never move
  // out of reach of itself. A stale adoption that shifted the caster's committed/eye cell used to make the drafted
  // self-cell fall OUT of the [0,0] footprint (`in_footprint:false`) → the flush DROPPED the buff, and the turn's
  // deadline auto-commit then shipped a batch WITHOUT it → the invisibility + its granted MP reverted. A self-cast
  // must survive the flush unconditionally (the twin of the trap "cells don't move" rule).
  it('a SELF-cast always survives the flush — never dropped even when in_footprint is false (#321/#323)', () => {
    expect(strike_flush_illegal({ in_footprint: false, is_weapon: false, self_cast: true })).toBe(false)
    // and it stays legal in the ordinary in-footprint case too (no regression to the void-cast right):
    expect(strike_flush_illegal({ in_footprint: true, is_weapon: false, self_cast: true })).toBe(false)
  })
})
