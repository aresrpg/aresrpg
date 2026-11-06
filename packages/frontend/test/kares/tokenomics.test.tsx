// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { KARES_UNIT } from '@aresrpg/sdk/kares-economics'

import { load_app_copy } from '../../src/i18n/copy.ts'
import { initial_finance } from '../../src/kares/model.ts'
import { TokenomicsPanel } from '../../src/kares/TokenomicsPanel.tsx'
import { tokenomics_reading } from '../../src/kares/tokenomics.ts'
import { reduce_finance } from '../../src/kares/model.ts'

import { finance_snapshot, finance_state } from './fixture.ts'

const copy = (await load_app_copy('en')).kares_page
const refresh = () => undefined

test('missing configuration shows unknown figures, never zero balances or invented circulating supply', () => {
  const state = { ...initial_finance(), error: 'KARES currency is not configured' }
  const html = renderToStaticMarkup(<TokenomicsPanel copy={copy} state={state} refresh={refresh} />)
  expect(html).toContain(copy.figures_unconfigured)
  expect(html).toContain(copy.circulating_unknown)
  expect(html).toContain('54,794.520547945')
  expect(html).toContain(copy.daily_cap_note)
  expect(html).not.toContain('110,000,000')
})

test('a failed refresh hides retained live figures while preserving the static daily cap', () => {
  const state = { ...finance_state(), error: 'Network failure' }
  const html = renderToStaticMarkup(<TokenomicsPanel copy={copy} state={state} refresh={refresh} />)
  expect(html).toContain(copy.figures_unavailable)
  expect(html).not.toContain('110,000,000')
  expect(html).toContain('54,794.520547945')
})

test('the actual tab renders canonical artwork, exact SDK values and forecast semantics', () => {
  const base = finance_snapshot()
  const snapshot = {
    ...base,
    total_supply: 987_654_321n * KARES_UNIT,
    pool: { ...base.pool, kares_rewards: 123_456n * KARES_UNIT, daily_kares: 9n * KARES_UNIT },
    combat_pot: { ...base.combat_pot, balance: 234_567n * KARES_UNIT },
    community: { ...base.community, remaining: 345_678n * KARES_UNIT, claimable: 456n * KARES_UNIT },
  }
  const html = renderToStaticMarkup(<TokenomicsPanel copy={copy} state={finance_state(snapshot)} refresh={refresh} />)
  for (const amount of ['987,654,321', '123,456', '234,567', '345,678', '456']) expect(html).toContain(amount)
  expect(html).toContain('data-kares-logo')
  expect(html).toContain('currency/kares.png')
  expect(html).toContain(copy.pool_forecast_note)
  expect(html).toContain(copy.pool_held_note)
  expect(html).toContain(copy.circulating_unknown)
  expect(html).toContain('Crates')
  expect(html).toContain('not when you open the crate')
  expect(html).not.toContain('Mastery')
})

test('all supported locales contain the live data and crate explanations', async () => {
  for (const locale of ['en', 'fr', 'de', 'es', 'pt', 'uk', 'ru', 'ja', 'ko', 'zh', 'vi'] as const) {
    const text = (await load_app_copy(locale)).kares_page
    for (const key of [
      'figures_unconfigured',
      'figures_unavailable',
      'figures_ready',
      'current_supply',
      'circulating_supply',
      'circulating_unknown',
      'total_staked',
      'pool_held',
      'pool_held_note',
      'pool_forecast',
      'pool_forecast_note',
      'treasury_claimable',
      'daily_cap',
      'daily_cap_note',
      'mastery_title',
      'mastery_note',
    ] as const)
      expect(text[key]?.length).toBeGreaterThan(0)
  }
})

test('verified unfunded rewards remain distinct from missing configuration and zero supply', () => {
  const state = reduce_finance(initial_finance(), { type: 'snapshot', sequence: 0, snapshot: null, balances: null })
  expect(tokenomics_reading(state).phase).toBe('pre_funding')
  const html = renderToStaticMarkup(<TokenomicsPanel copy={copy} state={state} refresh={refresh} />)
  expect(html).toContain(copy.figures_unfunded)
  expect(html).toContain(copy.token_pending)
  expect(html).toContain('disabled')
  expect(tokenomics_reading(state).burned).toBeNull()
})

test('loading and failures hide measurements; stale readings retain their original chain timestamp', () => {
  const state = finance_state()
  const pending = { ...state, request: { kind: 'refresh' as const } }
  expect(tokenomics_reading(pending).snapshot).toBeNull()
  const stale = reduce_finance(state, { type: 'failed', sequence: state.sequence, error: 'lagging', stale: true })
  expect(tokenomics_reading(stale)).toMatchObject({ phase: 'stale', snapshot: state.snapshot })
  const html = renderToStaticMarkup(<TokenomicsPanel copy={copy} state={stale} refresh={refresh} />)
  expect(html).toContain(copy.figures_stale)
  expect(html).toContain('1970')
  const failed = reduce_finance(stale, { type: 'failed', sequence: state.sequence, error: 'offline' })
  expect(tokenomics_reading(failed).snapshot).toBeNull()
})

test('burned supply derives only from a valid supply range and circulation is never inferred', () => {
  const base = finance_snapshot()
  for (const total_supply of [-1n, base.total_supply + 1n]) {
    expect(tokenomics_reading(finance_state({ ...base, total_supply })).burned).toBeNull()
  }
  const reading = tokenomics_reading(finance_state({ ...base, total_supply: base.total_supply - 7n }))
  expect(reading.burned).toBe(7n)
  expect(reading.circulating).toBeNull()
  const html = renderToStaticMarkup(<TokenomicsPanel copy={copy} state={finance_state()} refresh={refresh} />)
  expect(html).toContain(base.coin_type)
  expect(html).toContain('https://aftermath.finance/trade')
})
