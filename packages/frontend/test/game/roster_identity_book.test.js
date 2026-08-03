// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #1993 WP3 — THE ROSTER IDENTITY BOOK, and the disagreement it kills (#1865 class).
//
// THE REPORTED DEFECT, stated as behaviour: when a fight seats a player whose character doc has not resolved, two
// surfaces that are visible AT THE SAME TIME render that one fighter under two different identities —
//
//   · the LIVE projection (`fight_visible_view` → FightTimeline / EntityTooltip / the board plate) rendered the
//     OWNER-ADDRESS slice `0xdee0…ad38` — `project_views.js`'s old last-ditch arm
//     `row.name || roster_name || `${addr.slice(0,6)}…${addr.slice(-4)}``;
//   · the TERMINAL card (`FightReport` → `apply_resolved_names`) rendered the CHARACTER-ID slice
//     `0xc0ffe…f00d1` — `fight_report_names.js`'s own `short_fighter_id(row.id)`.
//
// Measured on the pre-fix tree (edge @4c2074c72): LIVE `"0xdee0…ad38"` · CARD `"0xc0ffe…f00d1"` · no `label` key.
//
// Neither is wrong on its own; having BOTH is the defect. Two consumers each invented a substitute for the same
// absent fact and their inventions disagree, so one fighter has two names on one screen. The RED below asserts
// that disagreement VERBATIM (both exact strings), which is what makes the fix's green meaningful: after the
// book, both consumers render the ONE honest unresolved treatment — the id, from a single home.

import { describe, expect, test } from 'bun:test'
import { fight_visible_view, identity_book, identity_label, short_display_id } from '@aresrpg/fight/project'
import { create_fight_store } from '@aresrpg/fight/store'

import { apply_resolved_names } from '../../src/game/screens/hud/fight_report_names.js'

const FIGHT = '0xidentity_book_fight'
// A 66-char object id and a 66-char address — the real on-chain shapes, so the two truncations genuinely differ.
const UNRESOLVED_CHARACTER = `0xc0ffee1${'a'.repeat(52)}f00d1`
const OWNER = `0xdee0${'b'.repeat(58)}ad38`
const T0 = 1_000_000

/** A live fight seating ONE player whose `/v1` character doc never resolved: no escrow name, no ctx roster row. */
const unresolved_state = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, ctx: { address: OWNER } }, T0)
  store.getState().input(
    {
      type: 'snapshot',
      version: 1,
      fight: {
        id: FIGHT,
        status: 1,
        width: 20,
        height: 19,
        participants: [
          {
            owner: OWNER,
            character: UNRESOLVED_CHARACTER,
            class: 'warrior',
            team: 0,
            hp: 50,
            max_hp: 50,
            ap: 12,
            mp: 3,
            base_ap: 12,
            base_mp: 3,
            cell: 21,
            ready: true,
            casts_this_turn: 0,
            weapon: null,
          },
        ],
        group_template: '0xmob_t',
        group_base_ap: 6,
        group_base_mp: 3,
        mobs: [{ template: '0xmob_t', level: 3, hp: 40, max_hp: 40, cell: 45, ap: 6, mp: 3 }],
        obstacles: [],
        holes: [],
        shape_mask: [],
        start_cells_a: [21],
        start_cells_b: [],
        turn_ptr: 0,
        queue: [],
        turn_deadline_ms: T0 + 90_000,
        turn_entropy: T0 + 90_000,
        turn_ordinal: 1,
        placement_deadline_ms: 0,
        world_seed: null,
        spawn_id: null,
        last_action_ms: 0,
      },
    },
    T0 + 100
  )
  return store.getState()
}

describe('#1993 WP3 · #1865 — one unresolvable id, ONE identity across every consumer', () => {
  // THE RED, kept as the regression seal: before the book these two expressions produced two DIFFERENT strings for
  // the same fighter. The assert is that they now produce the SAME one — and that the one they produce is the id,
  // never an address (a wallet owns several characters, #929) and never an invented word.
  test('the live projection and the terminal card agree on an unresolved player', () => {
    const live = fight_visible_view(unresolved_state()).entities[UNRESOLVED_CHARACTER].identity
    const [card] = apply_resolved_names([{ id: UNRESOLVED_CHARACTER, is_player: true }], new Map())

    // The two substitutes that used to be rendered side by side, spelled out so the defect stays legible.
    const OLD_LIVE_SUBSTITUTE = `${OWNER.slice(0, 6)}…${OWNER.slice(-4)}`
    const OLD_CARD_SUBSTITUTE = `${UNRESOLVED_CHARACTER.slice(0, 7)}…${UNRESOLVED_CHARACTER.slice(-5)}`
    expect(OLD_LIVE_SUBSTITUTE).not.toBe(OLD_CARD_SUBSTITUTE) // the disagreement, verbatim

    expect(live.label).toBe(card.name) // ← RED before the book: `0xdee0…ad38` vs `0xc0ffe…f00d1`
    expect(live.label).toBe(short_display_id(UNRESOLVED_CHARACTER))
    expect(live.label).not.toBe(OLD_LIVE_SUBSTITUTE)
    expect(live.label.includes(OWNER.slice(-4))).toBe(false) // no address survives anywhere as identity
  })

  test('absence stays an id: an unresolved row carries name null, never a substitute string', () => {
    const { identity } = fight_visible_view(unresolved_state()).entities[UNRESOLVED_CHARACTER]
    expect(identity.name).toBe(null) // the authored name is genuinely absent — the view says so
    expect(identity.resolved).toBe(false)
    expect(identity.display_id).toBe(short_display_id(UNRESOLVED_CHARACTER))
    expect(identity.label).toBe(identity.display_id) // the one label rule, applied once
  })

  test('a resolved name wins and marks the row resolved', () => {
    const state = unresolved_state()
    const named = { ...state, ctx: { ...state.ctx, roster: [{ id: UNRESOLVED_CHARACTER, name: 'Aurelia' }] } }
    const { identity } = fight_visible_view(named).entities[UNRESOLVED_CHARACTER]
    expect(identity.name).toBe('Aurelia')
    expect(identity.resolved).toBe(true)
    expect(identity.label).toBe('Aurelia')
  })

  test('a mob keeps its OWN template id when unresolved — never another creature`s name (#1865)', () => {
    // A mixed pack: the shared `group_template` names only the primary. The book has no group-template arm, so a
    // mob whose own species never resolved renders its own template id rather than borrowing the primary's name.
    const state = unresolved_state()
    const mixed = { ...state, view: { ...state.view, mob_names: { '0xother_species': 'Direwolf' } } }
    const { identity } = fight_visible_view(mixed).entities['mob-0']
    expect(identity.name).toBe(null)
    expect(identity.label).toBe('0xmob_t') // its own template id
    expect(identity.label).not.toBe('Direwolf')
  })

  test('the book is the one home both projections read', () => {
    const state = unresolved_state()
    const book = identity_book(state.view, state.ctx)
    expect(Object.keys(book).sort()).toEqual([UNRESOLVED_CHARACTER, 'mob-0'].sort())
    for (const [id, row] of Object.entries(book)) {
      expect(row.id).toBe(id)
      expect(identity_label(row)).toBe(fight_visible_view(state).entities[id].identity.label)
    }
  })
})
