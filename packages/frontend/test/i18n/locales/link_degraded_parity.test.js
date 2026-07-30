// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D3a i18n PARITY GUARD — a relay-up room that saw peer signaling but opened no channels must not render the
// raw world_chat.link_degraded key. The honest degraded chip ships as player-facing copy in every locale.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']

describe('i18n · degraded presence link copy exists in all six locales', () => {
  test.each(LOCALES)('%s.json carries non-empty world_chat.link_degraded', async (lang) => {
    const json = await Bun.file(
      new URL(`../../../src/i18n/locales/${lang}.json`, import.meta.url),
    ).json()
    const value = json?.world_chat?.link_degraded
    expect(typeof value).toBe('string')
    expect(value.trim().length).toBeGreaterThan(0)
  })
})
