// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { BlastPhase } from '@aresrpg/sdk/blast'

import { Results } from '../../src/allocation/Results.tsx'
import { load_app_copy } from '../../src/i18n/copy.ts'

const snapshot = (phase: BlastPhase) => ({
  version: '10',
  clock_ms: 100n,
  phase,
  committed: 75n,
  target: 100n,
  progress_bps: 7500,
  start_ms: 0n,
  end_ms: 200n,
  token_allocation: 400n,
})
const url = 'https://www.blast.fun/presale/example'

// Reported 2026-11-21: with the sale live, the step still said the date was to be announced.
test('the results step never contradicts a sale that exists', async () => {
  const copy = await load_app_copy('en')
  const render = (phase?: BlastPhase) =>
    renderToStaticMarkup(
      <Results
        text={(key) => key}
        locale="en"
        kares_copy={copy.kares_page}
        sale={phase ? snapshot(phase) : null}
        url={url}
      />
    )
  const before = render()
  for (const key of ['results_note', 'sale_title', 'sale_time', 'public_note', '>dilution<'])
    expect(before).toContain(key)
  expect(before).not.toContain(url)

  const live = render('live')
  for (const stale of ['sale_time', 'sale_title', 'public_note', '>results_note<']) expect(live).not.toContain(stale)
  for (const key of ['results_note_sale', 'sale_public', 'sale_dilution', copy.kares_page.blast_live, `href="${url}"`])
    expect(live).toContain(key)

  // Once nobody can buy any more, the step stops saying where to buy.
  const funded = render('funded')
  expect(funded).not.toContain('results_note_sale')
  expect(funded).toContain(copy.kares_page.blast_funded)
})
