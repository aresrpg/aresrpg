// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #170 (5th recurrence) — THE RE-BEAT FLAVOR: on v1.12.42 (the #260 sticky lifecycle guard live) a mob played
// its death animation FOUR TIMES on a standing rig. Root cause: the renderer created a new 'death' beat for
// every zero-HP Hit, and multiple sources independently re-derive the same kill fact into `state.wave` (a
// receipt wave, a poll's spectator replay adopting a peer's committed turn, a second poll racing the first's
// unacked presentation) — beats had no canonical identity, and once-only was arrival-local (store.js seq), so
// each source's OWN 'death' beat played in full.
//
// THE FIX: no wave-builder emits a 'death'-kind beat from an event anymore (fight_render_events.js /
// fight_predicted_render.js — the 'damage' beat's `killed` flag stays as CAUSE enrichment only). The death
// VISUAL is derived from the PRESENTED-STATE TRANSITION instead: is_death_edge is the pure fold this studio has
// used since aresrpg-legacy's player_health.js health-fold (`last_health !== character.health` guards the
// emit — death===death is a no-op by construction, whatever source re-asserts it). Once-only BY CONSTRUCTION —
// no per-source dedup ledger needed for this class.

import { describe, expect, test } from 'bun:test'

import { is_death_edge } from './voxel_fight_folds.js'

describe('#170 (5th recurrence) is_death_edge — the presented-state alive→dead transition fold', () => {
  test('the FIRST kill signal for a standing fighter is a genuine edge — the death presents', () => {
    expect(is_death_edge(/* was_dead */ false, /* dead */ true)).toBe(true)
  })

  test('RED-FIRST: a SECOND (or third, or fourth) re-assertion of the SAME still-dead fighter is a no-op — ' +
    'death===death, whichever source re-asserts it (receipt wave, poll adoption, a second poll…)', () => {
    expect(is_death_edge(/* was_dead */ true, /* dead */ true)).toBe(false)
  })

  test('a genuine committed-fold revival (the dead→alive edge, the #260 poofed-guard door) is never itself a ' +
    'death trigger — the caller records it, but this reports false (the wrong direction to play a death beat)', () => {
    expect(is_death_edge(/* was_dead */ true, /* dead */ false)).toBe(false)
  })

  test('a LATER genuine re-death after a revival is a fresh false→true edge — it presents again, correctly ' +
    '(no permanent latch: the accumulator only ever reflects the LAST observed value)', () => {
    expect(is_death_edge(/* was_dead */ false, /* dead */ true)).toBe(true) // the post-revival accumulator state
  })

  test('a standing (never-dead) fighter observed alive stays a no-op', () => {
    expect(is_death_edge(/* was_dead */ false, /* dead */ false)).toBe(false)
  })

  test('THE FULL SEQUENCE — a fighter observed through its whole lifecycle: 3 redundant kill sources, one ' +
    'presented death; a genuine revival; a genuine second death, presented again', () => {
    let was_dead = false
    const observe = (dead) => {
      const edge = is_death_edge(was_dead, dead)
      was_dead = dead
      return edge
    }
    // receipt wave, poll adoption, a second poll — all racing the same still-unacked kill.
    expect(observe(true)).toBe(true) // receipt wave: presents
    expect(observe(true)).toBe(false) // poll adoption: no-op
    expect(observe(true)).toBe(false) // a second poll: no-op
    // the committed-fold genuine-revival door (sync_entities, mirrors #260's removed_corpses.delete site).
    expect(observe(false)).toBe(false) // never itself a death trigger
    // a genuine new kill, post-revival.
    expect(observe(true)).toBe(true) // presents again — correct, not suppressed
  })
})
