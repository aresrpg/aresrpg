// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { SplitKpiCard } from '../../src/admin/OverviewPage.tsx'
import { chart_hover_index, chart_point_values, MetricChart } from '../../src/admin/MetricChart.tsx'

const source = (file: string): string => readFileSync(new URL(`../../src/admin/${file}`, import.meta.url), 'utf8')

test('the admin shell shares the Encyclopedia tabs and owns a separate sales route', () => {
  const page = source('AdminPage.tsx')
  expect(page).toContain('category_pill')
  expect(page).toContain("id: 'sales'")
  expect(page).toContain('<SalesHistoryPage')
})

test('overview restores KPI-first hierarchy and compact width-first charts', () => {
  const overview = source('OverviewPage.tsx')
  expect(overview.match(/<ChartPanel/g)).toHaveLength(6)
  expect(overview.match(/<KpiCard/g)).toHaveLength(8)
  expect(overview.match(/<SplitKpiCard/g)).toHaveLength(2)
  expect(overview).toContain('transactions.all_time')
  expect(overview).toContain('transactions.gas_range_mist')
  expect(overview).toContain('transactions.gas_all_time_mist')
  expect(overview).toContain('data-admin-kpis=""')
  expect(overview).toContain('data-admin-charts=""')
  expect(overview.indexOf('data-admin-kpis')).toBeLessThan(overview.indexOf('data-admin-charts'))
  expect(overview).toContain('overflow-y-auto')
  expect(overview).toContain('xl:grid-cols-2')
  expect(overview).not.toContain('xl:grid-cols-3')
  const treasury = overview.slice(overview.indexOf('const TreasuryStrip'), overview.indexOf('const LoadingOverview'))
  expect(treasury.match(/<Stat/g)).toHaveLength(2)
  const chart = overview.slice(overview.indexOf('const ChartPanel'), overview.indexOf('const revenue_series'))
  expect(chart).not.toContain('<footer')
  expect(overview).not.toContain('overview_chart_changed')
})

test('range controls wrap without a scrollbar and chart labels never stretch inside SVG', () => {
  const selector = source('AdminRangeSelector.tsx')
  expect(selector).toContain('flex-wrap')
  expect(selector).not.toContain('overflow-x-auto')

  const markup = renderToStaticMarkup(
    createElement(MetricChart, {
      className: 'h-44',
      label: 'Players',
      series: [{ label: 'Active', color: '#70bdf2', values: [0, 1, 2] }],
    })
  )
  expect(markup).toContain('grid-cols-[42px_minmax(0,1fr)]')
  expect(markup).not.toContain('<text')
})

test('transaction KPI cards split the selected range and all-time values equally', () => {
  const markup = renderToStaticMarkup(
    createElement(SplitKpiCard, {
      label: 'Game transactions',
      left: { label: '30 days', value: '42' },
      right: { label: 'All time', value: '84' },
    })
  )
  expect(markup).toContain('grid-cols-2')
  expect(markup).toContain('border-l')
  expect(markup).toContain('30 days')
  expect(markup).toContain('All time')
  expect(markup).toContain('42')
  expect(markup).toContain('84')
})

test('chart hover resolves the nearest point and preserves every exact series value', () => {
  expect(chart_hover_index(10, 10, 100, 5)).toBe(0)
  expect(chart_hover_index(60, 10, 100, 5)).toBe(2)
  expect(chart_hover_index(110, 10, 100, 5)).toBe(4)
  expect(
    chart_point_values(
      [
        { label: 'Shop', color: '#gold', values: [1, 2] },
        { label: 'Royalty', color: '#violet', values: [3, 4] },
      ],
      1
    )
  ).toEqual([
    { label: 'Shop', color: '#gold', value: 2 },
    { label: 'Royalty', color: '#violet', value: 4 },
  ])
})

test('sales history scrolls its table body instead of growing the whole admin page', () => {
  const sales = source('SalesHistoryPage.tsx')
  expect(sales).toContain('min-h-0 flex-1 overflow-auto')
  expect(sales).toContain('admin/sales_range_changed')
})
