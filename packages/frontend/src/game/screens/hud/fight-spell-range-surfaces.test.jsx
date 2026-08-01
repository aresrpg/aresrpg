// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SpellSeedTip } from './tooltip-content.jsx'

const visible_text = (html) => html.replace(/<[^>]+>/g, '')
const tooltip_t = (key) => (key === 'entity.range_to' ? 'à' : key)

describe('fight-spell range surfaces', () => {
  test('SpellSeedTip renders an unequal locale range instead of life.value', () => {
    const html = renderToStaticMarkup(
      createElement(SpellSeedTip, {
        t: tooltip_t,
        name: 'Tooltip range fixture',
        life: { value: 991, damageMin: 5, damageMax: 14, kind: 'damage' },
      })
    )
    const text = visible_text(html)

    expect(text).toContain('5 à 14')
    expect(text).not.toContain('991')
  })

  test('SpellSeedTip collapses equal bounds to one number', () => {
    const html = renderToStaticMarkup(
      createElement(SpellSeedTip, {
        t: tooltip_t,
        name: 'Tooltip equal fixture',
        life: { value: 991, damageMin: 8, damageMax: 8, kind: 'damage' },
      })
    )
    const text = visible_text(html)

    expect(html).toMatch(/<dd[^>]*>8<\/dd>/)
    expect(text).not.toContain('8 à 8')
    expect(text).not.toContain('991')
  })

  test('Spellbook keeps its effect rows wired directly to seed_effect_parts', () => {
    const source = readFileSync(new URL('./Spellbook.jsx', import.meta.url), 'utf8')

    expect(source).toContain("import { seed_effect_parts, seed_el_label } from './seed-effect-line.js'")
    expect(source).toContain('view={seed_effect_parts(t, fx, { locale })}')
  })
})
