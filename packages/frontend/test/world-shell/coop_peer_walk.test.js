// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// COOP PRESENTATION DESYNC (#1138 / #1139) — the fold's POSITION SAFETY NET, red-first.
//
// On an OBSERVING seat a peer's committed action arrives over the journal transport, which produces NO paced wave
// turn (store_chain.js paces `receipt` only). So the ONLY channel that can move a peer's rig is the entity
// reconcile's "the fold moved it but no beat did" verdict — and that verdict was gated on `is_mob`, so a PLAYER
// rig never walked: the occupancy flipped while the model stayed put (#1138), and a rig whose anchor had drifted
// was corrected by a straight snap instead of a walked route from its previous cell (#1139).

import { describe, test, expect } from 'bun:test'
import { decode, encode } from '@aresrpg/fight/los'

import { entity_fold_action } from '../../src/world-shell/voxel_fight_folds.js'
import { move_path_dungeon } from '../../src/fight-engine/overlay_intents.js'

const idle = { has_entity: true, is_dying: false, walking: false, replay_owned: false }

const peer = (cell) => ({ id: '0xchar_bob', is_player: true, dead: false, cell })

describe('#1138 — a peer seat’s committed move must MOVE the model, not just the occupancy', () => {
  test('a living PLAYER whose folded cell drifted from its rig, with no beat owning it, WALKS to the new cell', () => {
    const verdict = entity_fold_action(peer({ x: 5, y: 2 }), { ...idle, placed: { x: 1, y: 2 } })
    expect(verdict).toEqual({ kind: 'walk', to: { x: 5, y: 2 } })
  })

  test('a MOB keeps the identical verdict — the net was never mob-specific, only mob-gated', () => {
    const mob = { id: 'mob-0', is_player: false, dead: false, cell: { x: 5, y: 2 } }
    expect(entity_fold_action(mob, { ...idle, placed: { x: 1, y: 2 } })).toEqual({ kind: 'walk', to: { x: 5, y: 2 } })
  })

  test('an in-flight walk / paced replay still owns the rig — the net never fights a beat', () => {
    expect(entity_fold_action(peer({ x: 5, y: 2 }), { ...idle, walking: true, placed: { x: 1, y: 2 } })).toEqual({
      kind: 'skip',
    })
    expect(entity_fold_action(peer({ x: 5, y: 2 }), { ...idle, replay_owned: true, placed: { x: 1, y: 2 } })).toEqual({
      kind: 'skip',
    })
  })

  test('a player standing on its folded cell stays an ordinary upsert (no phantom walk every reconcile)', () => {
    expect(entity_fold_action(peer({ x: 1, y: 2 }), { ...idle, placed: { x: 1, y: 2 } })).toEqual({ kind: 'upsert' })
  })

  test('PLACEMENT still snaps — a pick places a body, it never walks one across the zone', () => {
    expect(entity_fold_action(peer({ x: 5, y: 2 }), { ...idle, placed: { x: 1, y: 2 }, placement: true })).toEqual({
      kind: 'upsert',
    })
  })
})

describe('#1139 — the corrected move is a WALKED, obstacle-aware route from the previous cell', () => {
  // A wall spanning column x=3 with a single gap at y=5: a straight line from (1,2) to (5,2) crosses it.
  const wall = [0, 1, 2, 3, 4, 6, 7, 8, 9].map((y) => encode(3, y))

  test('the verdict’s route walks cell-by-cell around the wall — never a straight displacement through it', () => {
    const from = { x: 1, y: 2 }
    const verdict = entity_fold_action(peer({ x: 5, y: 2 }), { ...idle, placed: from })
    // The adapter turns the verdict into exactly this route (voxel_fight_adapter's 'walk' branch).
    expect(verdict.kind).toBe('walk')
    const route = move_path_dungeon({ cell: from }, verdict.to, { blocked: new Set(wall), mp: 400 }).map(decode)

    expect(route.length).toBeGreaterThan(0)
    // no step lands in a wall…
    for (const cell of route) expect(wall.includes(encode(cell.x, cell.y))).toBe(false)
    // …and every step is orthogonally adjacent to the previous one, starting from the PREVIOUS cell (a walk, not
    // a teleport: a single-waypoint route is what lerps a rig straight through geometry).
    let at = from
    for (const cell of route) {
      expect(Math.abs(cell.x - at.x) + Math.abs(cell.y - at.y)).toBe(1)
      at = cell
    }
    expect(at).toEqual({ x: 5, y: 2 })
    expect(route.length).toBeGreaterThan(4) // the detour through the gap, never the 4-step straight line
  })
})
