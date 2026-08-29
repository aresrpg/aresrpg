// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { useState, type PointerEvent as ReactPointerEvent } from 'react'

export type MetricSeries = Readonly<{
  label: string
  color: string
  values: readonly number[]
  area?: boolean
}>

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
const exact_number = (value: number): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: 3, minimumFractionDigits: 0 })
const chart_hover_view = (series: readonly MetricSeries[], index: number | null, count: number) => {
  if (index === null) return Object.freeze({ index: null, x: null, values: Object.freeze([]) })
  return Object.freeze({ index, x: point_x(index, count), values: chart_point_values(series, index) })
}
const tooltip_transform = (x: number): string => {
  if (x > WIDTH * 0.75) return 'translateX(-100%)'
  if (x < WIDTH * 0.25) return 'translateX(0)'
  return 'translateX(-50%)'
}

export const MetricChart = ({
  label,
  series,
  className = 'h-44',
}: Readonly<{ label: string; series: readonly MetricSeries[]; className?: string }>) => {
  const [hovered_index, set_hovered_index] = useState<number | null>(null)
  const maximum_value = Math.max(0, ...series.flatMap(({ values }) => values))
  const maximum = maximum_value > 0 ? maximum_value * 1.08 : 0
  const scale = Math.max(1, maximum)
  const bottom = HEIGHT - BOTTOM
  const ticks = Object.freeze([1, 0.75, 0.5, 0.25, 0])
  const point_count = Math.max(0, ...series.map(({ values }) => values.length))
  const hovered = chart_hover_view(series, hovered_index, point_count)
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
        {ticks.map((ratio, index) => (
          <span key={ratio}>{maximum === 0 && index !== ticks.length - 1 ? '' : compact_number(maximum * ratio)}</span>
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
          {ticks.map((ratio) => {
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
        {hovered.x !== null && hovered.values.length > 0 && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-28 border border-white/12 bg-bg/95 px-2.5 py-2 text-[8px] shadow-[0_8px_30px_rgba(0,0,0,0.5)]"
            data-chart-tooltip=""
            style={{
              left: `${(hovered.x / WIDTH) * 100}%`,
              transform: tooltip_transform(hovered.x),
            }}
          >
            {hovered.values.map(({ label: series_label, color, value }) => (
              <div className="flex items-center justify-between gap-4" key={series_label}>
                <span className="inline-flex items-center gap-1.5 text-[#8d929c]">
                  <i className="size-1.5" style={{ background: color }} />
                  {series_label}
                </span>
                <strong className="font-medium text-[#e8e4dc] tabular-nums">{exact_number(value)}</strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
