// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- React refs own this component’s disposable chart and fit lifecycle. */
// TradingView Lightweight Charts™ — Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/

import { useEffect, useRef, useState } from 'react'
import { ColorType, CrosshairMode, LineSeries, createChart } from 'lightweight-charts'
import type { IChartApi, LogicalRange, UTCTimestamp } from 'lightweight-charts'

import type { CopyText } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { format_unit_price, price_date, price_segments, type PricePoint } from './price_history_model.ts'

export const TradingViewPricePlot = ({ points, text }: Readonly<{ points: readonly PricePoint[]; text: CopyText }>) => {
  const element = useRef<HTMLDivElement>(null)
  const chart_ref = useRef<IChartApi | null>(null)
  const visible_range = useRef<LogicalRange | null>(null)
  const [hovered_at, set_hovered] = useState<number | null>(null)
  const hovered = points.find(({ at_ms }) => at_ms === hovered_at) ?? null
  const locale = useAppStore(({ locale }) => locale)
  useEffect(() => {
    const container = element.current
    if (!container) return
    const style = getComputedStyle(container)
    const color = (token: string): string => style.getPropertyValue(`--color-${token}`).trim()
    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: color('surface') },
        textColor: color('muted'),
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        attributionLogo: true,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: color('border') } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: color('gold'), labelBackgroundColor: color('surface-raised') },
        horzLine: { color: color('gold'), labelBackgroundColor: color('surface-raised') },
      },
      rightPriceScale: { borderColor: color('border'), scaleMargins: { top: 0.15, bottom: 0.15 } },
      timeScale: {
        borderColor: color('border'),
        timeVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        rightOffset: 0,
      },
      localization: { locale, priceFormatter: (value: number) => format_unit_price(value, locale) },
    })
    chart_ref.current = chart
    visible_range.current = null
    return () => {
      chart.remove()
      chart_ref.current = null
    }
  }, [locale])
  useEffect(() => {
    const chart = chart_ref.current
    if (!chart || !element.current) return
    const cyan = getComputedStyle(element.current).getPropertyValue('--color-cyan').trim()
    const series = price_segments(points).map((segment, index) => {
      const line = chart.addSeries(LineSeries, {
        color: cyan,
        lineWidth: 2,
        lineVisible: segment.length > 1,
        pointMarkersVisible: segment.length === 1,
        pointMarkersRadius: 3,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: 'custom', minMove: 1e-12, formatter: (value: number) => format_unit_price(value, locale) },
      })
      const values = new Map(segment.map((point) => [point.at_ms, point.value!]))
      line.setData(
        (index === 0 ? points : segment).map(({ at_ms }) => {
          const time = (at_ms / 1000) as UTCTimestamp
          const value = values.get(at_ms)
          return value === undefined ? { time } : { time, value }
        })
      )
      return line
    })
    if (visible_range.current) chart.timeScale().setVisibleLogicalRange(visible_range.current)
    else chart.timeScale().fitContent()
    const hover = ({ time }: Readonly<{ time?: unknown }>): void => {
      set_hovered(typeof time === 'number' ? time * 1000 : null)
    }
    chart.subscribeCrosshairMove(hover)
    return () => {
      if (chart_ref.current !== chart) return
      visible_range.current = chart.timeScale().getVisibleLogicalRange()
      chart.unsubscribeCrosshairMove(hover)
      series.forEach((line) => chart.removeSeries(line))
    }
  }, [points, locale])
  return (
    <>
      <div
        aria-label={text('prices_inspect')}
        className="h-64 w-full"
        ref={element}
        role="img"
        data-tradingview-prices
      />
      <div
        aria-live="polite"
        className="mt-3 min-h-9 border-t border-border pt-3 text-[11px] text-muted tabular-nums"
        data-price-inspection
      >
        {hovered ? (
          <>
            {price_date(hovered.at_ms, locale)} ·{' '}
            {hovered.value === null
              ? text('prices_empty_day')
              : `${format_unit_price(hovered.value, locale)} SUI · ${text('prices_units', { units: BigInt(hovered.bucket!.units).toLocaleString(locale) })}`}
          </>
        ) : (
          text('prices_weighted')
        )}
      </div>
      <details className="mt-2 text-[10px] text-muted">
        <summary className="cursor-pointer">{text('prices_table')}</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <table className="w-full text-right tabular-nums">
            <thead>
              <tr>
                <th className="text-left">{text('prices_date')}</th>
                <th>SUI</th>
                <th>{text('prices_quantity')}</th>
              </tr>
            </thead>
            <tbody>
              {points
                .filter(({ bucket }) => bucket)
                .map(({ at_ms, value, bucket }) => (
                  <tr key={at_ms}>
                    <td className="text-left">{price_date(at_ms, locale)}</td>
                    <td>{format_unit_price(value!, locale)}</td>
                    <td>{BigInt(bucket!.units).toLocaleString(locale)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
      <a
        className="mt-2 block text-[9px] text-muted hover:text-cyan"
        href="https://www.tradingview.com/"
        rel="noreferrer"
        target="_blank"
      >
        TradingView Lightweight Charts™ · © 2025 TradingView, Inc.
      </a>
    </>
  )
}
