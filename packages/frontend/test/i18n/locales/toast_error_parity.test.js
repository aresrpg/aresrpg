// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

const locales = ['en', 'fr', 'es', 'de', 'uk', 'ja']
const keys = [
  'wallet_request_rejected',
  'wallet_request_pending',
  'wallet_unavailable',
  'rpc_unavailable',
  'request_failed',
]

describe('toast error copy exists in all six locales', () => {
  for (const locale of locales) {
    test(locale, async () => {
      const messages = (await import(`../../../src/i18n/locales/${locale}.json`)).default
      for (const key of keys) {
        expect(messages.errors?.[key]).toBeString()
        expect(messages.errors?.[key]).toBeTruthy()
      }
    })
  }
})
