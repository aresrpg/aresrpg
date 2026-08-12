// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The server-side mirrors: channel builders match the indexer topics verbatim (the client
// contract's own tests live in @aresrpg/protocol).

import { describe, expect, test } from 'bun:test'

import { channels } from '../src/protocol.ts'

describe('the indexer wire mirror', () => {
  test('channel builders produce the indexer topics verbatim', () => {
    expect(channels.character('0xabc')).toBe('evt:character:0xabc')
    expect(channels.fight('0x1')).toBe('evt:fight:0x1')
    expect(channels.social('0xme')).toBe('evt:social:0xme')
    expect(channels.economy).toBe('evt:economy')
  })
})
