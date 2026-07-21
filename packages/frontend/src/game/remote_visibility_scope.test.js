// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #333 — dungeon_id is each character's PERSONAL run_pass_id (dungeon_run_store.js "session identity"), never
// equal between two different players — not even two co-op partners standing in the exact same room — so it can
// never gate cross-player visibility (same disease PR #330 cured in the chat scope, world_chat_scope.js).
// same_render_instance replaces the broken personal-id comparison with the genuinely-shared party id for the
// in-dungeon case, and never gates the open-world case at all (range does that, upstream in remote_players.js).

import { describe, expect, it } from 'bun:test'

import { same_render_instance } from './remote_visibility_scope.js'

describe('same_render_instance (#333)', () => {
  it('two co-op partners in the SAME dungeon render for each other despite different personal run ids', () => {
    expect(
      same_render_instance({
        mine_dungeon_id: '0xMY_RUN_PASS',
        peer_dungeon_id: '0xTHEIR_RUN_PASS', // a DIFFERENT personal run pass — the exact #333 repro shape
        mine_party_id: '0xPARTY',
        peer_party_id: '0xPARTY',
      })
    ).toBe(true)
  })

  it('a stranger running the identical dungeon TEMPLATE, not in my party, never renders as a ghost (D237)', () => {
    expect(
      same_render_instance({
        mine_dungeon_id: '0xMY_RUN_PASS',
        peer_dungeon_id: '0xSTRANGER_RUN_PASS',
        mine_party_id: '0xPARTY',
        peer_party_id: null, // solo stranger, no party at all
      })
    ).toBe(false)
  })

  it('two un-partied overworld peers still render for each other — range gates it upstream, not this predicate', () => {
    expect(
      same_render_instance({ mine_dungeon_id: null, peer_dungeon_id: null, mine_party_id: null, peer_party_id: null })
    ).toBe(true)
  })

  it('one in a dungeon, the other in the overworld — never co-located, even when both are partied together', () => {
    expect(
      same_render_instance({
        mine_dungeon_id: '0xMY_RUN_PASS',
        peer_dungeon_id: null,
        mine_party_id: '0xPARTY',
        peer_party_id: '0xPARTY',
      })
    ).toBe(false)
    expect(
      same_render_instance({
        mine_dungeon_id: null,
        peer_dungeon_id: '0xTHEIR_RUN_PASS',
        mine_party_id: '0xPARTY',
        peer_party_id: '0xPARTY',
      })
    ).toBe(false)
  })

  it('two solo dungeon-goers (no party at all) never collide on a null-equals-null party match', () => {
    expect(
      same_render_instance({
        mine_dungeon_id: '0xMY_RUN_PASS',
        peer_dungeon_id: '0xTHEIR_RUN_PASS',
        mine_party_id: null,
        peer_party_id: null,
      })
    ).toBe(false)
  })

  it('different parties both running the same dungeon template never render for each other', () => {
    expect(
      same_render_instance({
        mine_dungeon_id: '0xMY_RUN_PASS',
        peer_dungeon_id: '0xTHEIR_RUN_PASS',
        mine_party_id: '0xPARTY_A',
        peer_party_id: '0xPARTY_B',
      })
    ).toBe(false)
  })
})
