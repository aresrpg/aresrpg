// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST — the advisory-only law (realtime constitution D2) at the friends panel. "Is this player online?"
// is an AUTHORITY question, and this surface holds nothing that can answer it: it has a peer observation
// (advisory, this instant, this room) and the read layer's last-known position freshness. Both were being
// collapsed into one `online` boolean — one in the roster read, one overwriting it in the HUD — so the panel
// stated as fact something no source proved. The derivation below is the mechanical replacement: it can only
// ever report WHICH observation we hold, never a verdict about the player.
//
// Pure module by design (friends_display.js is the panel's dependency-light derivation home), so this proves
// the rule without booting OnlinePlayers.jsx's auth/p2p/store import graph.

import { describe, expect, it } from 'bun:test'

import { friend_presence_state } from '../../src/world-shell/friends_display.js'

describe('friend_presence_state — observation and freshness, never an online verdict', () => {
  it('a peer observed in my session right now is SEEN', () => {
    expect(friend_presence_state({ observed: true, position_fresh: false })).toBe('seen')
  })

  it('a live observation outranks the read layer — both facts present still reads as seen', () => {
    expect(friend_presence_state({ observed: true, position_fresh: true })).toBe('seen')
  })

  it('nobody observing but a fresh last-known position is RECENT — a read-layer fact, plainly labelled', () => {
    expect(friend_presence_state({ observed: false, position_fresh: true })).toBe('recent')
  })

  it('no observation and no fresh position is UNSEEN — unknown, never "offline"', () => {
    expect(friend_presence_state({ observed: false, position_fresh: false })).toBe('unseen')
  })

  it('absent facts are unknown, never a negative claim', () => {
    expect(friend_presence_state({})).toBe('unseen')
  })
})
