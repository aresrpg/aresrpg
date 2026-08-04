// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2205 i18n PARITY GUARD — the degraded board notice is the ONLY thing a GPU-less visitor reads on the
// /simulator board region. A missing locale there prints the raw `simulator.board_unavailable` key into the
// hole the renderer left, which is worse than the blank rectangle it replaced.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']
const KEYS = ['board_unavailable', 'board_unavailable_hint']

describe('i18n · the degraded board notice ships in all six locales', () => {
  test.each(LOCALES)('%s.json carries a non-empty simulator.board_unavailable pair', async (lang) => {
    const json = await Bun.file(new URL(`../../../src/i18n/locales/${lang}.json`, import.meta.url)).json()
    for (const key of KEYS) {
      const value = json?.simulator?.[key]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    }
  })
})
