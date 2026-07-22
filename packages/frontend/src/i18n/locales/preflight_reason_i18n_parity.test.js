// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// i18n PARITY GUARD — the pre-flight refusal "must say why" bundle: replaces the 3rd generic
// refusal that night — "The transaction was refused before sending — no gas was spent. Try again." with zero
// indication of the actual reason). The 6-locale law (CLAUDE.md): every user-facing string lands in ALL locales;
// a missing/empty locale would print the raw key on the toast's second line. This pins presence + non-emptiness
// across all six, mechanically. See abort_copy.js's humanize_tx_error + abort_copy.test.js's "must say why" block.
import { describe, expect, test } from 'bun:test'

const LOCALES = ['en', 'fr', 'de', 'es', 'ja', 'uk']

// [namespace, key] pairs added by this bundle.
const KEYS = [
  ['errors', 'tx_refusal_reason'], // the "{{headline}}\nReason: {{reason}}" template
  ['errors', 'tx_refusal_reason_unmapped'], // an unmapped-but-parsed abort names its module + code
  ['errors', 'tx_stale_reference'], // a non-MoveAbort structural gRPC failure (CommandArgumentError etc.)
  ['errors', 'equip_wrong_slot'], // client-selected slot disagrees with Move's category-derived slot
]

describe('i18n · pre-flight "must say why" strings present in ALL 6 locales', () => {
  for (const [ns, key] of KEYS) {
    test.each(LOCALES)(`%s.json carries a non-empty ${ns}.${key}`, async (lang) => {
      const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
      const value = json?.[ns]?.[key]
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    })
  }

  // The reason template MUST keep both interpolation slots in every locale, or the headline/reason collapse
  // into raw "{{headline}}" text on the toast instead of the composed sentence.
  test.each(LOCALES)('%s.json errors.tx_refusal_reason interpolates {{headline}} and {{reason}}', async (lang) => {
    const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
    expect(json.errors.tx_refusal_reason).toContain('{{headline}}')
    expect(json.errors.tx_refusal_reason).toContain('{{reason}}')
  })

  test.each(LOCALES)('%s.json errors.tx_refusal_reason_unmapped interpolates {{module}} and {{code}}', async (lang) => {
    const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
    expect(json.errors.tx_refusal_reason_unmapped).toContain('{{module}}')
    expect(json.errors.tx_refusal_reason_unmapped).toContain('{{code}}')
  })
})
