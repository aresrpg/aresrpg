// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

const EXPECTED = {
  en: '{{spell}} cancelled — its target moved out of reach',
  fr: '{{spell}} : cible hors de portée, sort annulé',
  de: '{{spell}} abgebrochen — Ziel außer Reichweite',
  es: '{{spell}}: objetivo fuera de alcance, hechizo cancelado',
  ja: '「{{spell}}」を中止 — 対象が範囲外へ移動しました',
  uk: '«{{spell}}» скасовано — ціль вийшла за межі досяжності',
}
const LOCALES = Object.keys(EXPECTED)

describe('i18n · named out-of-reach cast cancellation in all six locales', () => {
  test.each(LOCALES)('%s.json keeps the {{spell}} interpolation slot', async (lang) => {
    const json = await Bun.file(new URL(`./${lang}.json`, import.meta.url)).json()
    const value = json?.dungeons?.cast_target_unreachable

    expect(typeof value).toBe('string')
    expect(value.trim().length).toBeGreaterThan(0)
    expect(value).toContain('{{spell}}')
    expect(value).toBe(EXPECTED[lang])
  })

  test('English copy renders the cancelled spell name', async () => {
    const json = await Bun.file(new URL('./en.json', import.meta.url)).json()
    const rendered = json.dungeons.cast_target_unreachable.replace('{{spell}}', "Prowler's Eye")

    expect(rendered).toBe("Prowler's Eye cancelled — its target moved out of reach")
  })
})
