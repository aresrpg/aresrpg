// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #334 (d) — ROOM LIFECYCLE: the fight-scoped courtesy room joins on fight entry and tears down on fight end,
// and the ZONE (lobby) chat room is NEVER affected by either (the #330 lesson: fight entry never tears down the
// roam channels). Drives the REAL transport with trystero mocked; observes the sent-message tape.

import { test, expect } from 'bun:test'

// Keep the lobby's identity executor stubbed (its import graph loads when we pull broadcast_chat below).
import '../test_helpers/expedition_sdk_mock.js'
import {
  reset_trystero_mock,
  trystero_actions as actions,
  trystero_sent as sent,
} from '../test_helpers/trystero_mock.js'

const { join_lobby, leave_lobby, broadcast_chat } = await import('./lobby-room.js')
const { sync_fight_room, leave_fight_room, broadcast_fight_batch } = await import('./fight-room.js')

test('#334 (d): the fight room joins + tears down; the zone chat survives untouched', () => {
  leave_lobby()
  leave_fight_room()
  reset_trystero_mock()
  join_lobby('0xMINE', { x: 0, y: 0 })

  // JOIN a fight-scoped room — its OWN batch channel, distinct from the lobby's actions.
  sync_fight_room('0xFIGHT')
  expect(actions.has('fbatch'), 'the fight room opened its batch channel').toBe(true)
  broadcast_fight_batch({ fight_id: '0xFIGHT', character: '0xMINE', intent_id: 't1', actions: [] })
  expect(sent.some((row) => row.name === 'fbatch'), 'a joined fight room broadcasts').toBe(true)

  // The ZONE chat is live WHILE the fight room is up — fight entry never tore down the roam channel.
  broadcast_chat('0xMINE', 'me', 'hi', 'zone')
  expect(sent.filter((row) => row.name === 'chat').length, 'zone chat works during the fight').toBe(1)

  // Re-scoping to the SAME fight id is a no-op (idempotent) — no room churn.
  sync_fight_room('0xFIGHT')

  // TEARDOWN — fight end / forfeit. The fight channel goes silent; the zone chat is STILL live.
  leave_fight_room()
  const tape = sent.length
  broadcast_fight_batch({ fight_id: '0xFIGHT', character: '0xMINE', intent_id: 't2', actions: [] })
  expect(sent.length, 'a torn-down fight room broadcasts NOTHING').toBe(tape)
  broadcast_chat('0xMINE', 'me', 'still here', 'zone')
  expect(sent.filter((row) => row.name === 'chat').length, 'the zone chat survived the fight teardown').toBe(2)

  leave_lobby()
})
