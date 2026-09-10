// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { GatheringTime } from '../../src/characters/GatheringTime.tsx'
import { copy_text, load_app_copy } from '../../src/i18n/copy.ts'
import { LOCALES } from '../../src/i18n/locale.ts'

test('gather time shows the next level improvement and stops at maximum level', async () => {
  const copy = await load_app_copy('en')
  const t = copy_text(copy.characters_page)
  const initial = renderToStaticMarkup(<GatheringTime gathering level={1} t={t} />)
  expect(initial).toContain('Gather time: 12.00s')
  expect(initial).toContain('Next · Lv 2: 11.90s')
  const maximum = renderToStaticMarkup(<GatheringTime gathering level={100} t={t} />)
  expect(maximum).toContain('Gather time: 2.00s')
  expect(maximum).not.toContain('Next')
})

test('gather time labels resolve in every supported locale', async () => {
  for (const { code } of LOCALES) {
    const copy = await load_app_copy(code)
    const markup = renderToStaticMarkup(<GatheringTime gathering level={99} t={copy_text(copy.characters_page)} />)
    expect(markup).toContain('2.10')
    expect(markup).toContain('2.00')
    expect(markup).toContain('100')
    expect(markup).not.toContain('jobs.detail.')
    expect(markup).not.toContain('{{')
  }
})
