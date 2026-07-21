// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import { chat_line_in_scope } from './world_chat_scope.js'

// #306: chat rides the shared zone channel and has ZERO fight/dungeon awareness. dungeon_id is each character's
// PERSONAL run_pass_id (dungeon_run_store.js "session identity"), never a shared instance id — two different
// players' ids never match, not even two co-fighters standing side by side in the exact same fight. Gating
// general/commerce lines on that comparison silently dropped a fighter's chat for every roamer AND for any ally
// whose own client wasn't independently mid-fight at that instant. A fighter now stays a member of the same log
// a roamer reads, unconditionally.
describe('chat has zero fight/dungeon awareness (#306)', () => {
  it('never hides a general line, dungeon_id match or not', () => {
    expect(chat_line_in_scope({ channel: 'general' })).toBe(true)
  })

  it('never hides a commerce line', () => {
    expect(chat_line_in_scope({ channel: 'commerce' })).toBe(true)
  })

  it('keeps client-local combat lines visible (no peer state at all)', () => {
    expect(chat_line_in_scope({ channel: 'combat' })).toBe(true)
  })

  it('keeps own and party lines visible too', () => {
    expect(chat_line_in_scope({ channel: 'general', from_me: true })).toBe(true)
    expect(chat_line_in_scope({ channel: 'group' })).toBe(true)
  })
})
