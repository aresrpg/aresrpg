// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #170 (4th recurrence) — THE LIFECYCLE ORGAN, distinct from the retirement-projection latch that holds HP.
//
// A killed mob's rig poofs; the fold still HOLDS the mob (the retirement floor keeps it present + dead). When
// engine_view.dead momentarily FLICKERS false — a re-armed death beat flips project.death_presenting_ids to
// "animating" — entity_fold_action fell through to 'upsert': a FRESH rig with NO facing (sync_entities passes
// facing_yaw only from the placement centroid, null in ACTIVE) → a DEFAULT-ORIENTATION model → then dead again →
// the death animation RE-PLAYS. The owner's tell verbatim: "his model REAPPEARS WITH A DEFAULT ORIENTATION and
// dies again." HP projection is intact underneath; the ENTITY LIFECYCLE betrays it.
//
// The guard: a POOFED rig stays DOWN while it is COMMITTED-dead, even through the engine_view.dead flicker. The
// ONLY door back is the COMMITTED fold (authoritative, retirement-floored — never the flickering engine_view.dead)
// showing the fighter genuinely ALIVE again (the sanctioned divergence-correction revive).

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

  test('a genuinely REVIVED corpse (committed ALIVE) re-upserts — the sanctioned divergence-correction door back', () => {
    const revived = { ...MOB, dead: false }
    expect(entity_fold_action(revived, { ...BASE, poofed: true, committed_dead: false })).toEqual({ kind: 'upsert' })
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
