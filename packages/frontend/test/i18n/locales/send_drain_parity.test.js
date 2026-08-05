// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2243 i18n PARITY GUARD — MAX empties the wallet, and the modal has to SAY so in every locale before the
// player signs. It also pins the RETIREMENT of `wallet.send.err.reserve` ("Keep 0.2 SUI in your wallet for
// gas"): that sentence named the cap this ticket deleted, so the words themselves are the violation.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']
const SEND_KEYS = [
  'drain_hint',
  'drain_warning',
  'drain_sending',
  'drain_fee_note',
  'drain_remaining',
  'success_drain_body',
]
const ERR_KEYS = ['amount_positive', 'amount_invalid', 'insufficient_balance']

const locale = (lang) => Bun.file(new URL(`../../../src/i18n/locales/${lang}.json`, import.meta.url)).json()

describe('i18n · the empties-your-wallet copy ships in ALL 6 locales', () => {
  for (const key of SEND_KEYS) {
    test.each(LOCALES)(`%s.json carries a non-empty wallet.send.${key}`, async (lang) => {
      const value = (await locale(lang))?.wallet?.send?.[key]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  }

  for (const key of ERR_KEYS) {
    test.each(LOCALES)(`%s.json carries a non-empty wallet.send.err.${key}`, async (lang) => {
      const value = (await locale(lang))?.wallet?.send?.err?.[key]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  }

  test.each(LOCALES)('%s.json states no gas-reserve refusal — the cap it named is gone', async (lang) => {
    expect((await locale(lang))?.wallet?.send?.err?.reserve).toBeUndefined()
  })

  test.each(LOCALES)('%s.json names the recipient in the drained-wallet receipt', async (lang) => {
    expect((await locale(lang)).wallet.send.success_drain_body).toContain('{{recipient}}')
  })
})
