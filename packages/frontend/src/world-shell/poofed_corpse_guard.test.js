// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #170 (4th recurrence) — THE LIFECYCLE ORGAN, distinct from the retirement-projection latch that holds HP.
//
// A killed mob's rig poofs; the fold still HOLDS the mob (the retirement floor keeps it present + dead). When
// engine_view.dead momentarily FLICKERS false — a re-armed death beat flips project.death_presenting_ids to
// "animating" — entity_fold_action fell through to 'upsert': a FRESH rig with NO facing (sync_entities passes
// facing_yaw only from the placement centroid, null in ACTIVE) → a DEFAULT-ORIENTATION model → then dead again →
// the death animation RE-PLAYS with default orientation. HP projection is intact underneath; the entity
// lifecycle betrays it.
//
// The guard: a POOFED rig stays DOWN while it is COMMITTED-dead, even through the engine_view.dead flicker. The
// ONLY door back is the COMMITTED fold (authoritative, retirement-floored — never the flickering engine_view.dead)
// showing the fighter genuinely ALIVE again (the sanctioned divergence-correction revive).
//
// #450 (this recurrence) — THE PREDICTED-KILL CLAIM WINDOW. The guard above keyed its door back on
// `committed_dead` ALONE: `committed_dead ? skip : upsert`. That conflates a genuine revive with a PREDICTED kill
// still in flight — because a local predicted kill (my own cast) has committed_dead=FALSE for its ENTIRE window
// (the committed fold only folds the death at the end-turn RECEIPT). So the poofed predicted corpse read as a
// "revive" every reconcile: re-upsert → sync_entities' `observe_death(id,false)` reset → the alive→dead edge
// re-fires → the death beat REPLAYS → poof → re-upsert … looping EXACTLY until end-turn flips committed_dead=true.
// The signature verbatim: "loops its death animation and stays on the board UNTIL the player ends their turn."
//
// The cure: a poofed corpse revives ONLY when it is GENUINELY ALIVE in EVERY projection — the presented view
// (fighter.dead=false, immune to the death-hold via `queued`) AND the committed fold (committed_dead=false) AND
// no pending kill claim in the wave (queued=false). Predicted-dead in any of those senses ⇒ HOLD the corpse down.

import { describe, expect, test } from 'bun:test'

import { entity_fold_action } from './voxel_fight_folds.js'

const MOB = { id: 'mob-0', dead: true, is_player: false, cell: { x: 5, y: 5 } }
const BASE = { has_entity: false, is_dying: false, walking: false, replay_owned: false, placed: null }

describe('#170 poofed-corpse guard — a poofed rig never re-births through an engine_view.dead flicker', () => {
  test('a poofed corpse whose engine_view.dead FLICKERS alive does NOT re-upsert (no default-orientation rebirth)', () => {
    // the flicker: a re-armed death beat makes engine_view.dead read false, yet the COMMITTED fold holds it dead.
    const flickering = { ...MOB, dead: false }
    expect(entity_fold_action(flickering, { ...BASE, poofed: true, committed_dead: true })).toEqual({ kind: 'skip' })
  })

  test('a genuinely REVIVED corpse (committed ALIVE, presented alive, no pending claim) re-upserts — the door back', () => {
    // a FULL revive: every projection says alive and NO kill claim is pending in the wave (queued=false).
    const revived = { ...MOB, dead: false }
    expect(entity_fold_action(revived, { ...BASE, poofed: true, committed_dead: false, queued: false })).toEqual({
      kind: 'upsert',
    })
  })

  // ── #450 RED-FIRST: the PREDICTED-KILL claim window (committed_dead=false the whole time — the receipt only
  //    folds the death at end-turn). Under the old `committed_dead ? skip : upsert` guard BOTH of these returned
  //    'upsert' → the re-arm loop. The poofed corpse must HOLD DOWN until the kill either commits or rolls back. ──
  test('#450 a poofed PREDICTED corpse whose kill claim is still QUEUED in the wave holds down (dead held-false by death_hold)', () => {
    // pre-ack window: the killed damage beat sits in s.wave → project.death_presenting_ids holds engine_view.dead
    // FALSE, but the claim is unretired (queued=true) and uncommitted (committed_dead=false). NOT a revive.
    const held = { ...MOB, dead: false }
    expect(entity_fold_action(held, { ...BASE, poofed: true, committed_dead: false, queued: true })).toEqual({
      kind: 'skip',
    })
  })

  test('#450 a poofed PREDICTED corpse the presented fold shows DEAD holds down while its kill has not committed', () => {
    // post-ack window: the local turn acked (beat drained → queued=false) so engine_view.dead reads the fold's
    // dead=true, yet the RECEIPT has not folded it (committed_dead=false). Still a predicted kill — never a revive.
    expect(entity_fold_action(MOB, { ...BASE, poofed: true, committed_dead: false, queued: false })).toEqual({
      kind: 'skip',
    })
  })

  test('belt-and-braces: a committed-dead fighter with NO live rig never spawns a fresh model, even un-poofed', () => {
    const flickering = { ...MOB, dead: false }
    expect(entity_fold_action(flickering, { ...BASE, has_entity: false, poofed: false, committed_dead: true })).toEqual(
      {
        kind: 'skip',
      }
    )
  })

  test('UNCHANGED: a live rig still plays its ONE death beat — the first death is untouched', () => {
    // the optimistic/authoritative FIRST death (engine_view.dead true, not yet poofed) keeps the existing rule.
    expect(entity_fold_action(MOB, { ...BASE, has_entity: true, is_dying: false })).toEqual({ kind: 'despawn' })
  })
})
