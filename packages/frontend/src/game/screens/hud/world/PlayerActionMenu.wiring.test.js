// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #329 — inviting another player used to cold-start a party through create() (party_store.js), which
// UNCONDITIONALLY sweeps every one of the leader's OWN owned alt characters into the party via
// join_owned_alts_to_party — real, signed, ACCEPTED PTBs (on-chain membership, not a rendering glitch; a live
// owner repro confirmed the phantom characters held real fight turn slots waiting on a ready that never comes).
// The invite-a-friend flow's only intent is "add this ONE other player" — it must cold-start a BARE party
// (create_bare, no owned-alt sweep) and leave the deliberate multichar-squad path to the explicit picker
// (invite_owned, PartyFrame.jsx) or the system's own silent ensure_owned_party().
//
// SOURCE-TEXT proof (house pattern — see remote_players.test.js's own header): this call site sits behind a
// live click handler inside a component with a wallet/party-store/tx dependency graph a unit test has no
// business booting just to prove which function name appears at one call site. party_store.character.test.js
// separately proves create_bare()'s OWN behavior (never sweeps alts); this file proves the wiring: the exact
// function the component calls.

import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('./PlayerActionMenu.jsx', import.meta.url), 'utf8')
const friends_source = readFileSync(new URL('./OnlinePlayers.jsx', import.meta.url), 'utf8')
const roster_source = readFileSync(new URL('../../../../world-shell/friends_reads.js', import.meta.url), 'utf8')

describe('PlayerActionMenu cold-start party (#329)', () => {
  it('the cold-start invite path calls create_bare(), never the owned-alt-sweeping create()', () => {
    expect(source).toContain('await use_party.getState().create_bare()')
    expect(source).not.toContain('await use_party.getState().create()')
  })
})

describe('friend-list fast travel (#327)', () => {
  it('an ordinary friend-row click opens the shared player menu with every roster route', () => {
    expect(roster_source).toContain('routes: chars.map')
    expect(roster_source).toContain('character_id: candidate.id')
    expect(friends_source).toContain('onClick={open_menu}')
    expect(friends_source).toContain("kind: 'friend'")
    expect(friends_source).toContain('routes: row.routes')
    expect(friends_source).toContain('open_player_menu({')
  })

  it('the menu samples live presence at action time and dispatches through the one fast-travel door', () => {
    expect(source).toContain('presence_characters_by_address(address)')
    // still the ONE door (dispatch_fast_travel → ft_dispatch), now keyed by traveler (tranche F): the manual
    // flight flies the character being DRIVEN, so the dispatch stamps traveler_id: selected_character_id.
    expect(source).toContain('dispatch_fast_travel(')
    expect(source).toContain('{ ...target, address }')
    expect(source).toContain('ft_dispatch({ ...input, traveler_id: selected_character_id })')
    expect(source).not.toContain("from '../../../../world-shell/world_join.js'")
    expect(source).not.toContain("from '../../../fast_travel_pilot.js'")
  })
})
