// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LEG 0a — CAST AUTO-RETARGET ON INVALIDATION (the "cast not committed because target no longer
// valid"). A drafted cast whose target fighter moved off the drafted cell is RECOMPOSED against the target's CURRENT
// committed cell when the spell still legally reaches it (reusing the draft's OWN range/LoS footprint — one home);
// when it can't reach, the pure re-validation reports a drop without UI metadata. This locks the flush-time
// decision (txs.retarget_cast); the HUD's local commit-removal edge separately owns any cancellation event.

import { describe, expect, test } from 'bun:test'

import { retarget_cast } from '../src/txs.js'

const W = 20
const enc = (x, y) => y * W + x
const A = enc(8, 8) // the drafted target cell (the mob stood here when I drafted the cast)
const B = enc(9, 8) // the mob's CURRENT committed cell (it walked one east before my turn commits)
const FAR = enc(18, 18)

// the SAME footprint the draft/click gate painted — a set of legally-reachable cells (range + LoS), membership only.
const reaches = (cells) => (cell) => cells.has(Number(cell))

describe('LEG 0a — a drafted cast follows its target to the committed cell, or reports a drop', () => {
  test('① the target moved to an IN-RANGE cell → compose against the new cell B, never the stale A', () => {
    const footprint = new Set([A, B, enc(7, 8)])
    // red today: the flush composes A → the chain sees no target at A → on-chain target-invalid, the cast is lost.
    expect(retarget_cast({ target_cell: A, committed_cell: B, reaches: reaches(footprint) })).toEqual({ target: B })
  })

  test('② the target moved OUT of range → no compose; re-validation reports only the domain drop', () => {
    const footprint = new Set([A, enc(7, 8)]) // FAR is not reachable
    expect(retarget_cast({ target_cell: A, committed_cell: FAR, reaches: reaches(footprint) })).toEqual({
      dropped: true,
    })
  })

  test('a still-valid target (committed cell unchanged) composes the drafted cell — no needless retarget', () => {
    expect(retarget_cast({ target_cell: A, committed_cell: A, reaches: () => true })).toEqual({ target: A })
  })

  test('a void cast (no tracked target fighter) composes the drafted cell unchanged', () => {
    expect(retarget_cast({ target_cell: A, committed_cell: null, reaches: () => false })).toEqual({ target: A })
  })

  // #321 GROUND-TARGET EXEMPTION: a free_cell spell (trap/glyph/teleport) targets the CELL, not a fighter — cells
  // don't move, so it must never retarget/drop on account of who now stands there. DungeonBoard.flush_commit gates
  // this by forcing `committed_cell: null` for a ground-targeted entry (never resolving `eye_target` at all), which
  // is exactly the "void cast" input above — pinned again here under its OWN name so the #321 use case reads
  // explicitly, not just as a side effect of the void-cast case.
  test('#321 a ground-targeted cast (the caller forces committed_cell null — cells never retarget) composes its drafted cell unchanged, even though a fighter now stands there', () => {
    expect(retarget_cast({ target_cell: A, committed_cell: null, reaches: () => true })).toEqual({ target: A })
  })
})
