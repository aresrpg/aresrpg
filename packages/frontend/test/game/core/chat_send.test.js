// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1815 — "chat send fails and the toast blames presence". The courier chat door the report captured
// (`POST /v1/courier/chat → 400`, "character must be a full 0x + 64-hex Sui id") was RETIRED on 2026-08-02, so
// that refusal cannot recur — but its second defect outlived it and got WORSE: the surviving p2p send swallowed
// every failure (`.catch(() => {})`) while the local echo dispatched unconditionally, so a line that reached
// NOBODY rendered as delivered. Silence is not honest copy.
//
// PURE by construction — zero mock.module (house law: a process-global module mock outlives the file that set
// it). The transport's own verdict is proven beside the transport, in test/p2p/lobby-room.test.js.
//
// RED-FIRST: `chat_refusal_toast` did not exist and nothing surfaced a dropped line at all.
import { describe, expect, test } from 'bun:test'

import { chat_refusal_toast } from '../../../src/game/core/chat_send.js'
import { CHANNEL } from '../../../src/game/core/modules/chat.js'
import i18n from '../../../src/i18n'

describe('#1815 — a chat line nobody received says so, and never blames presence for it', () => {
  test('a delivered line says nothing (the unchanged happy path stays silent)', () => {
    expect(chat_refusal_toast(CHANNEL.general, true)).toBeNull()
    expect(chat_refusal_toast(CHANNEL.group, true)).toBeNull()
  })

  test('a world line nobody carried names the LINK — the honest refusal', () => {
    const refusal = chat_refusal_toast(CHANNEL.general, false)
    expect(refusal).toMatchObject({
      state: 'error',
      title: i18n.t('world_chat.not_sent'),
      message: i18n.t('world_chat.not_sent_no_link'),
    })
    // the copy resolves (all six locales carry it) and is not the raw key
    expect(refusal.message).not.toBe('world_chat.not_sent_no_link')
    // and it never blames the presence roster, which has nothing to do with delivery
    expect(refusal.message).not.toMatch(/presence/i)
    expect(refusal.title).not.toMatch(/presence/i)
  })

  test('a party line sent while solo names the PARTY, not the link', () => {
    const refusal = chat_refusal_toast(CHANNEL.group, false)
    expect(refusal.message).toBe(i18n.t('world_chat.not_sent_no_party'))
    expect(refusal.message).not.toBe(i18n.t('world_chat.not_sent_no_link'))
    expect(refusal.message).not.toMatch(/presence/i)
  })

  test('every locale carries both reasons — an untranslated refusal is a refusal that lies', () => {
    for (const language of ['en', 'fr', 'de', 'es', 'ja', 'uk']) {
      for (const key of ['world_chat.not_sent', 'world_chat.not_sent_no_link', 'world_chat.not_sent_no_party']) {
        const copy = i18n.t(key, { lng: language })
        expect(copy).not.toBe(key)
        expect(copy.length).toBeGreaterThan(0)
      }
    }
  })
})
