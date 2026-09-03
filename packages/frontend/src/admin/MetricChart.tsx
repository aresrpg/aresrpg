// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState, type PointerEvent as ReactPointerEvent } from 'react'

export type MetricSeries = Readonly<{
  label: string
  color: string
  values: readonly number[]
  area?: boolean
}>
export type MetricValueKind = 'continuous' | 'count'

const WIDTH = 820
const HEIGHT = 180
const TOP = 8
const BOTTOM = 8

export const chart_hover_index = (client_x: number, left: number, width: number, count: number): number | null => {
  if (width <= 0 || count <= 0) return null
  const ratio = Math.min(1, Math.max(0, (client_x - left) / width))
  return Math.round(ratio * Math.max(0, count - 1))
}

export const chart_point_values = (series: readonly MetricSeries[], index: number) =>
  Object.freeze(
    series.flatMap(({ label, color, values }) => {
      const value = values[index]
      return typeof value === 'number' && Number.isFinite(value) ? [Object.freeze({ label, color, value })] : []
    })
  )

const compact_number = (value: number): string => {
  if (value === 0) return '0'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  if (value >= 100) return Math.round(value).toLocaleString()
  return value.toFixed(value >= 10 ? 0 : 1)
}
const count_number = (value: number): string => value.toLocaleString(undefined, { maximumFractionDigits: 0 })
const metric_number = (value: number, value_kind: MetricValueKind): string =>
  value_kind === 'count' ? count_number(value) : compact_number(value)

export const chart_tick_values = (maximum_value: number, value_kind: MetricValueKind): readonly number[] => {
  if (!Number.isFinite(maximum_value) || maximum_value <= 0) return Object.freeze([0])
  if (value_kind === 'continuous') {
    const maximum = maximum_value * 1.08
    return Object.freeze([maximum, maximum * 0.75, maximum * 0.5, maximum * 0.25, 0])
  }
  const step = Math.max(1, Math.ceil(maximum_value / 4))
  const maximum = Math.ceil(maximum_value / step) * step
  return Object.freeze(Array.from({ length: maximum / step + 1 }, (_, index) => maximum - index * step))
}

export const format_chart_timestamp = (at_ms: number, locales?: string, time_zone?: string): string =>
  new Intl.DateTimeFormat(locales, {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(time_zone ? { timeZone: time_zone } : {}),
  }).format(at_ms)

const chart_axis = (maximum_value: number, value_kind: MetricValueKind) => {
  const tick_values = chart_tick_values(maximum_value, value_kind)
  const scale = Math.max(1, tick_values[0] ?? 0)
  if (maximum_value > 0)
    return Object.freeze({
      scale,
      visible_ticks: tick_values,
      plot_ratios: Object.freeze(tick_values.map((value) => value / scale)),
    })
  return Object.freeze({
    scale,
    visible_ticks: Object.freeze([null, null, null, null, 0]),
    plot_ratios: Object.freeze([1, 0.75, 0.5, 0.25, 0]),
  })
}

const line_path = (values: readonly number[], maximum: number): string =>
  (values.length === 0 ? [0] : values)
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * WIDTH
      const y = TOP + (1 - value / maximum) * (HEIGHT - TOP - BOTTOM)
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

const point_x = (index: number, count: number): number => (index / Math.max(1, count - 1)) * WIDTH
const point_y = (value: number, scale: number): number => TOP + (1 - value / scale) * (HEIGHT - TOP - BOTTOM)
const exact_number = (value: number, value_kind: MetricValueKind): string =>
  value.toLocaleString(undefined, {
    maximumFractionDigits: value_kind === 'count' ? 0 : 3,
    minimumFractionDigits: 0,
  })
const chart_hover_view = (
  series: readonly MetricSeries[],
  timestamps: readonly number[],
  index: number | null,
  count: number
) => {
  if (index === null) return Object.freeze({ index: null, x: null, at_ms: null, values: Object.freeze([]) })
  const at_ms = timestamps[index]
  return Object.freeze({
    index,
    x: point_x(index, count),
    at_ms: typeof at_ms === 'number' && Number.isFinite(at_ms) ? at_ms : null,
    values: chart_point_values(series, index),
  })
}
const tooltip_transform = (x: number): string => {
  if (x > WIDTH * 0.75) return 'translateX(-100%)'
  if (x < WIDTH * 0.25) return 'translateX(0)'
  return 'translateX(-50%)'
}

export const MetricChart = ({
  label,
  series,
  timestamps,
  value_kind,
  className = 'h-44',
}: Readonly<{
  label: string
  series: readonly MetricSeries[]
  timestamps: readonly number[]
  value_kind: MetricValueKind
  className?: string
}>) => {
  const [hovered_index, set_hovered_index] = useState<number | null>(null)
  const maximum_value = Math.max(0, ...series.flatMap(({ values }) => values))
  const { scale, visible_ticks, plot_ratios } = chart_axis(maximum_value, value_kind)
  const bottom = HEIGHT - BOTTOM
  const point_count = timestamps.length
  const hovered = chart_hover_view(series, timestamps, hovered_index, point_count)
  const hover = (event: Readonly<ReactPointerEvent<SVGSVGElement>>): void => {
    const bounds = event.currentTarget.getBoundingClientRect()
    set_hovered_index(chart_hover_index(event.clientX, bounds.left, bounds.width, point_count))
  }
  return (
    <div aria-label={label} className={`grid min-w-0 grid-cols-[42px_minmax(0,1fr)] gap-2 ${className}`} role="img">
      <div
        aria-hidden="true"
        className="flex flex-col justify-between py-1 text-right text-[8px] text-[#6b7280] tabular-nums"
      >
        {visible_ticks.map((value, index) => (
          <span key={index}>{value === null ? '' : metric_number(value, value_kind)}</span>
        ))}
      </div>
      <div className="relative min-h-0 min-w-0">
        <svg
          aria-hidden="true"
          className="size-full overflow-hidden"
          onPointerLeave={() => set_hovered_index(null)}
          onPointerMove={hover}
          preserveAspectRatio="none"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          {plot_ratios.map((ratio) => {
            const y = TOP + (1 - ratio) * (bottom - TOP)
            return <line key={ratio} stroke="rgba(255,255,255,0.07)" x1="0" x2={WIDTH} y1={y} y2={y} />
          })}
          {series.map(({ label: series_label, color, values, area = false }) => {
            const path = line_path(values, scale)
            return (
              <g key={series_label}>
                <title>{series_label}</title>
                {area && <path d={`${path} L${WIDTH},${bottom} L0,${bottom} Z`} fill={color} opacity="0.1" />}
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )
          })}
          {hovered.x !== null && (
            <>
              <line
                stroke="rgba(255,255,255,0.28)"
                strokeDasharray="3 4"
                x1={hovered.x}
                x2={hovered.x}
                y1={TOP}
                y2={bottom}
              />
              {hovered.values.map(({ label: series_label, color, value }) => (
                <circle
                  cx={hovered.x}
                  cy={point_y(value, scale)}
                  fill={color}
                  key={series_label}
                  r="3"
                  stroke="var(--color-bg)"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </>
          )}
          <line stroke="#77707e" strokeDasharray="4 5" x1={WIDTH} x2={WIDTH} y1={TOP} y2={bottom} />
        </svg>
        {hovered.x !== null && hovered.at_ms !== null && hovered.values.length > 0 && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-28 border border-white/12 bg-bg/95 px-2.5 py-2 text-[8px] shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
            data-chart-tooltip=""
            style={{
              left: `${(hovered.x / WIDTH) * 100}%`,
              transform: tooltip_transform(hovered.x),
            }}
          >
            <time
              className="mb-1.5 block border-b border-white/8 pb-1.5 text-[#b8b4ac] tabular-nums"
              dateTime={new Date(hovered.at_ms).toISOString()}
            >
              {format_chart_timestamp(hovered.at_ms)}
            </time>
            {hovered.values.map(({ label: series_label, color, value }) => (
              <div className="flex items-center justify-between gap-4" key={series_label}>
                <span className="inline-flex items-center gap-1.5 text-[#8d929c]">
                  <i className="size-1.5" style={{ background: color }} />
                  {series_label}
                </span>
                <strong className="font-medium text-[#e8e4dc] tabular-nums">{exact_number(value, value_kind)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
