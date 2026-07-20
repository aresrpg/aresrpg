// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST regression: the friend roster showed a raw address slice instead of the character name — FriendRow
// fell back through rpc/use_address_names + components/address_name's SuiNS/truncated-address chain, a SECOND
// resolution path parallel to world-shell/character_name_resolve.js's ONE HOME for id→name display, whose own
// fallback (short_fighter_id) every other fighter-name surface already shares). This proves friend_display_name
// (world-shell/friends_display.js) resolves a known name (live p2p peer, else the /v1 character name
// friends_reads.read_roster already carries) and, only when genuinely unresolved, falls back to the home's OWN
// contract — never a bespoke truncation here. Imports the pure derivation module directly (not OnlinePlayers.jsx)
// so this test doesn't have to boot the component's transitive auth/p2p/store import graph.
import { describe, expect, it } from 'bun:test'

import { friend_display_name } from '../../../../world-shell/friends_display.js'
import { short_fighter_id } from '../../../../world-shell/character_name_resolve.js'

describe('friend_display_name — the friend-row name derivation (ONE HOME fallback, never a second path)', () => {
  it('resolves the /v1 character name (friends_reads.read_roster row) when no live peer name exists', () => {
    const row = { address: '0xfriend', name: 'Ares' }
    expect(friend_display_name(row, null)).toBe('Ares')
  })

  it('prefers the live p2p self-declared peer name over the polled character name (D222, freshest signal)', () => {
    const row = { address: '0xfriend', name: 'Ares' }
    const peer = { name: 'AresLive' }
    expect(friend_display_name(row, peer)).toBe('AresLive')
  })

  it('an unresolved friend (no peer, no character doc) falls back to the ONE HOME contract — never a raw address slice', () => {
    const row = { address: '0x1234567890abcdef1234567890', name: null }
    expect(friend_display_name(row, null)).toBe(short_fighter_id(row.address))
    expect(friend_display_name(row, null)).toBe('0x12345…67890')
  })

  it('an empty peer name string never beats an already-resolved character name', () => {
    const row = { address: '0xfriend', name: 'Ares' }
    expect(friend_display_name(row, { name: '' })).toBe('Ares')
  })
})
