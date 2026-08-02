// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST regression: the friend roster showed a raw address slice instead of the character name — FriendRow
// fell back through rpc/use_address_names + components/address_name's SuiNS/truncated-address chain, a SECOND
// resolution path parallel to world-shell/character_name_resolve.js's ONE HOME for id→name display, whose own
// fallback (short_fighter_id) every other fighter-name surface already shares). This proves friend_display_name
// (world-shell/friends_display.js) resolves the CANONICAL /v1 character name friends_reads.read_roster carries
// and, only when genuinely unresolved, falls back to the home's OWN contract — never a bespoke truncation
// here, and never a name a peer declared for itself. Imports the pure derivation module directly (not OnlinePlayers.jsx)
// so this test doesn't have to boot the component's transitive auth/p2p/store import graph.
import { describe, expect, it } from 'bun:test'

import { friend_display_name } from '../../../../world-shell/friends_display.js'
import { short_fighter_id } from '../../../../world-shell/character_name_resolve.js'

describe('friend_display_name — the friend-row name derivation (ONE HOME fallback, never a second path)', () => {
  it('resolves the /v1 character name that friends_reads.read_roster already carries', () => {
    expect(friend_display_name({ address: '0xfriend', name: 'Ares' })).toBe('Ares')
  })

  // ADVISORY-ONLY LAW (realtime constitution D2): a name is IDENTITY, and identity is an authority question.
  // A peer's self-declared name is an observation — it may not overwrite the /v1 character name this row was
  // built from, however fresh it is. Canonical wins; the derivation takes the row and nothing else.
  it('a self-declared peer name never overrides the canonical /v1 character name', () => {
    expect(friend_display_name({ address: '0xfriend', name: 'Ares' }, { name: 'NotAres' })).toBe('Ares')
  })

  it('an unresolved friend falls back to the ONE HOME contract — never a raw slice, never a claimed name', () => {
    const row = { address: '0x1234567890abcdef1234567890', name: null }
    expect(friend_display_name(row)).toBe(short_fighter_id(row.address))
    expect(friend_display_name(row)).toBe('0x12345…67890')
    expect(friend_display_name(row, { name: 'Claimed' })).toBe(short_fighter_id(row.address))
  })
})
