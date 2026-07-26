// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// §② THE FOLD unit truth (Fight V2 build step 2). fold_canonical is the package's documented, publicly re-exported
// fold (v2/index.js) — issue #549 found it had ZERO test coverage and a second, private, independent fold
// (project.js's old `fold_base`) that disagreed with it on `fight_id` in the pre-snapshot window. This pins the
// unified behavior: fold_canonical is now project.js's only fold, and its pre-snapshot fight_id is null — exactly
// what the 9,829-envelope corpus already certified through the old fold_base — never a caller-threaded value.

import { describe, test, expect } from 'bun:test'

import { empty_core_state, ingest } from '../src/core.js'
import { fold_canonical } from '../src/core_fold.js'

describe('fold_canonical — the committed chain truth (issue #549: one fold, not two)', () => {
  test('pre-snapshot: a receipt admits before any snapshot lands (inbox.js §1 primary boot scenario) — fight_id is null, even threaded the live session id, matching the corpus-proven project_board behavior', () => {
    const fight_id = '0xf'
    let state = ingest(empty_core_state(), {
      payload: { kind: 'session_opened', fight_id, my_key: null, ctx: {} },
      observed_at_ms: 0,
    })
    // A receipt admits into the log before any snapshot lands — inbox.js's own documented boot scenario: the
    // journal starves while real gameplay rides the receipt stream. base_view stays null; only the log gains a row.
    const events = [
      {
        type: '0x0::fight_events::Hit',
        parsedJson: { fight: fight_id, victim_is_mob: true, victim_idx: 0, remaining_hp: 79 },
      },
    ]
    state = ingest(state, {
      payload: { kind: 'journal_rows_received', source: 'receipt', fight_id, version: 1, rows: { events } },
      observed_at_ms: 1,
    })
    expect(state.inbox.base_view).toBeNull() // the pre-snapshot window issue #549 is about
    expect(state.fight_id).toBe(fight_id) // known since session_opened — the id a naive fold_canonical(inbox, fight_id) call would leak
    // The corpus-proven path (project.js's old fold_base) never received a fight_id and hardcoded null here.
    // fold_canonical is the single home now — even threaded the live session fight_id, it must agree.
    expect(fold_canonical(state.inbox, state.fight_id).fight_id).toBeNull()
  })
})
