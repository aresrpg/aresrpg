// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #529 — a coop join that leaves NO trace: no fight binding on any character, an empty /v1 fight list, and a
// client that renders nothing and never says why. The evaporation itself is a chain question; the client half
// is the SILENCE. A fresh join stamps `fight_fresh`, and that stamp used to override `definitively_gone`
// FOREVER: the 4s heartbeat kept re-reading an object the node had already reported deleted, so the session
// never collapsed to its outcome flow and the player never learned anything. The receipt's benefit of the doubt
// over a DELETED object is a read-after-write window, and it must expire with the receipt poll that owns it.

import { describe, expect, test } from 'bun:test'

import { receipt_read_miss_decision } from '../../src/world-shell/world_fight_receipt.js'

const FIGHT = '0xjoined'

/** The store shape a fresh join publishes (world_fight.js mount_world_fight). */
const joined_state = (extra = {}) => ({
  fight_id: FIGHT,
  fight_syncing: true,
  fight_fresh: true,
  ...extra,
})

describe('#529 a receipt-owned fight the node reports GONE stops being retried in silence', () => {
  test('a transient read miss is retried — the serving node is merely behind the receipt', () => {
    expect(receipt_read_miss_decision({ state: joined_state(), fight_id: FIGHT, definitively_gone: false })).toBe(
      'retry'
    )
  })

  test('a fresh join whose object is definitively gone is retried while the receipt window is open', () => {
    expect(receipt_read_miss_decision({ state: joined_state(), fight_id: FIGHT, definitively_gone: true })).toBe(
      'retry'
    )
  })

  test('once the receipt poll has given up on THIS id, a definitively-gone read drops instead of looping forever', () => {
    const expired = joined_state({ fight_receipt_expired_id: FIGHT })
    expect(receipt_read_miss_decision({ state: expired, fight_id: FIGHT, definitively_gone: true })).toBe('drop')
    // ...while a merely-unreadable object still converges on the heartbeat — the ceiling ends the GONE grant only.
    expect(receipt_read_miss_decision({ state: expired, fight_id: FIGHT, definitively_gone: false })).toBe('retry')
  })

  test('the expiry is ID-SCOPED — a spent window can never drop the NEXT fight this session enters', () => {
    const next = { fight_id: '0xnext', fight_syncing: true, fight_fresh: true, fight_receipt_expired_id: FIGHT }
    expect(receipt_read_miss_decision({ state: next, fight_id: '0xnext', definitively_gone: true })).toBe('retry')
  })

  test('a fight the receipt does not own drops as before', () => {
    const unheld = { fight_id: FIGHT, fight_syncing: false, fight_fresh: true }
    expect(receipt_read_miss_decision({ state: unheld, fight_id: FIGHT, definitively_gone: false })).toBe('drop')
  })
})
