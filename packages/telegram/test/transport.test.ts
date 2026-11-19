// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { card, create_telegram } from '../src/transport.ts'

test('Telegram delivery disables previews so pairing URLs are not consumed by preview crawlers', async () => {
  let sent: any
  const telegram = create_telegram('123:fixture', 1000, async (_url, init) => {
    sent = JSON.parse(String(init.body))
    return Response.json({ ok: true })
  })
  await telegram.send(42, card('https://companion.example/link/one-use'))
  expect(sent.link_preview_options).toEqual({ is_disabled: true })
})
