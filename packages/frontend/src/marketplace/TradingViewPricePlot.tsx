// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data -- React refs own this component’s disposable chart and fit lifecycle. */
// TradingView Lightweight Charts™ — Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/

import { useEffect, useRef, useState } from 'react'
import { ColorType, CrosshairMode, CandlestickSeries, createChart } from 'lightweight-charts'
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts'

import type { CopyText } from '../i18n/copy.ts'
import { useAppStore } from '../store.ts'

import { format_unit_price, price_date, type PricePoint } from './price_history_model.ts'

export const TradingViewPricePlot = ({ points, text }: Readonly<{ points: readonly PricePoint[]; text: CopyText }>) => {
  const element = useRef<HTMLDivElement>(null)
  const chart_ref = useRef<IChartApi | null>(null)
  const series_ref = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const fitted_count = useRef(0)
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
    const down_color = style.getPropertyValue('--aui-danger').trim()
    const series = chart.addSeries(CandlestickSeries, {
      upColor: color('cyan'),
      downColor: down_color,
      wickUpColor: color('cyan'),
      wickDownColor: down_color,
      borderVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: { type: 'custom', minMove: 1e-12, formatter: (value: number) => format_unit_price(value, locale) },
    })
    chart_ref.current = chart
    series_ref.current = series
    fitted_count.current = 0
    const hover = ({ time }: Readonly<{ time?: unknown }>): void => {
      set_hovered(typeof time === 'number' ? time * 1000 : null)
    }
    chart.subscribeCrosshairMove(hover)
    return () => {
      chart.unsubscribeCrosshairMove(hover)
      chart.remove()
      chart_ref.current = null
      series_ref.current = null
    }
  }, [locale])
  useEffect(() => {
    const chart = chart_ref.current
    const series = series_ref.current
    if (!chart || !series) return
    series.setData(
      points.map(({ at_ms, candle }) => {
        const time = (at_ms / 1000) as UTCTimestamp
        return candle === null ? { time } : { time, ...candle }
      })
    )
    // A new period fits once; incoming prices preserve the player's current zoom and scroll.
    if (fitted_count.current !== points.length) {
      chart.timeScale().fitContent()
      fitted_count.current = points.length
    }
  }, [points, locale])
  return (
    <>
      <div
        aria-label={text('prices_inspect')}
        className="h-64 w-full"
        ref={element}
        role="img"
        title="TradingView Lightweight Charts™ · © 2025 TradingView, Inc."
        data-tradingview-prices
      />
      <div
        aria-live="polite"
        className="mt-2 text-[11px] text-muted tabular-nums"
        hidden={!hovered}
        data-price-inspection
      >
        {hovered ? (
          <>
            {price_date(hovered.at_ms, locale)} ·{' '}
            {hovered.candle === null
              ? text(hovered.bucket ? 'prices_legacy' : 'prices_empty_day')
              : `${text('prices_ohlc', {
                  open: format_unit_price(hovered.candle.open, locale),
                  high: format_unit_price(hovered.candle.high, locale),
                  low: format_unit_price(hovered.candle.low, locale),
                  close: format_unit_price(hovered.candle.close, locale),
                })} SUI · ${text('prices_units', { units: BigInt(hovered.bucket!.units).toLocaleString(locale) })}`}
          </>
        ) : null}
      </div>
    </>
  )
}
