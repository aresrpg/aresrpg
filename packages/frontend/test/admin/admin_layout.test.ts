// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { TimelineKpiCard } from '../../src/admin/OverviewPage.tsx'
import {
  chart_hover_index,
  chart_point_values,
  chart_tick_values,
  format_chart_timestamp,
  MetricChart,
} from '../../src/admin/MetricChart.tsx'

const source = (file: string): string => readFileSync(new URL(`../../src/admin/${file}`, import.meta.url), 'utf8')

test('the admin shell owns one overview surface', () => {
  const page = source('AdminPage.tsx')
  expect(page).toContain('<OverviewPage')
  expect(page).not.toContain('SalesHistoryPage')
})

test('overview restores KPI-first hierarchy and compact width-first charts', () => {
  const overview = source('OverviewPage.tsx')
  expect(overview.match(/<ChartPanel/g)).toHaveLength(6)
  expect(overview.match(/<KpiCard/g)).toHaveLength(7)
  expect(overview.match(/<TimelineKpiCard/g)).toHaveLength(2)
  expect(overview.match(/<KpiGroup/g)).toHaveLength(4)
  expect(overview).toContain('w-max max-w-full')
  expect(overview).toContain('flex h-32 w-max')
  expect(overview).toContain('flex h-full w-max')
  expect(overview).toContain('flex flex-wrap items-stretch gap-3')
  expect(overview).toContain('data-kpi-group={tone}')
  expect(overview).toContain('transactions.last_24h')
  expect(overview).toContain('transactions.last_30d')
  expect(overview).toContain('transactions.all_time')
  expect(overview).toContain('transactions.gas_last_24h_mist')
  expect(overview).toContain('transactions.gas_last_30d_mist')
  expect(overview).toContain('transactions.gas_all_time_mist')
  expect(overview).not.toContain('transactions.all_time.toLocaleString()')
  expect(overview).toContain('display_sui(transactions.gas_all_time_mist)')
  expect(overview).toContain('format_sui(BigInt(value), 2)')
  expect(overview).not.toMatch(/format_sui\([^\n]+, [34]\)/)
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
      timestamps: [0, 1, 2],
      value_kind: 'count',
    })
  )
  expect(markup).toContain('grid-cols-[42px_minmax(0,1fr)]')
  expect(markup).not.toContain('<text')
})

test('transaction KPI cards keep fixed 24-hour, 30-day, and all-time values together', () => {
  const markup = renderToStaticMarkup(
    createElement(TimelineKpiCard, {
      entries: [
        { label: '24 hours', value: '12' },
        { label: '30 days', value: '42' },
        { label: 'All time', value: '84' },
      ],
      label: 'Game transactions',
    })
  )
  expect(markup).toContain('grid-cols-[repeat(3,max-content)]')
  expect(markup).toContain('border-l')
  expect(markup).toContain('24 hours')
  expect(markup).toContain('30 days')
  expect(markup).toContain('All time')
  expect(markup).toContain('12')
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
        { label: 'Marketplace', color: '#gold', values: [1, 2] },
        { label: 'Royalty', color: '#violet', values: [3, 4] },
      ],
      1
    )
  ).toEqual([
    { label: 'Marketplace', color: '#gold', value: 2 },
    { label: 'Royalty', color: '#violet', value: 4 },
  ])
})

test('discrete charts use integral ticks and hover timestamps include the date and time', () => {
  expect(chart_tick_values(3, 'count')).toEqual([3, 2, 1, 0])
  expect(chart_tick_values(7, 'count')).toEqual([8, 6, 4, 2, 0])
  const timestamp = format_chart_timestamp(0, 'en-US', 'UTC')
  expect(timestamp).toContain('Jan 1, 1970')
  expect(timestamp).toContain('12:00 AM')

  const overview = source('OverviewPage.tsx')
  const online_series = overview.slice(
    overview.indexOf('const online_series'),
    overview.indexOf('const address_series')
  )
  expect(online_series).toContain("text(copy, 'peak', 'Peak')")
  expect(online_series).not.toContain("text(copy, 'average', 'Average')")
})
