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

describe('PlayerActionMenu cold-start party (#329)', () => {
  it('the cold-start invite path calls create_bare(), never the owned-alt-sweeping create()', () => {
    expect(source).toContain('await use_party.getState().create_bare()')
    expect(source).not.toContain('await use_party.getState().create()')
  })
})
