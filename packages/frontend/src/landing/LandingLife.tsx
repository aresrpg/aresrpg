// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Decorative life for the home page: weather over the backdrop and a Yajin pacing the hero card.
import type { CSSProperties } from 'react'

const vars = (values: Readonly<Record<string, string>>): CSSProperties => values as CSSProperties

/** Position in percent of the backdrop, loop duration and start offset in seconds. */
const MOTES = [
  [8, 22, 7, 0],
  [17, 48, 9, -3],
  [29, 14, 6, -1],
  [41, 36, 8, -5],
  [58, 20, 7, -2],
  [67, 52, 10, -6],
  [76, 12, 6, -4],
  [88, 40, 8, -1],
  [94, 26, 9, -7],
  [50, 60, 11, -3],
] as const
export const LandingWeather = () => (
  <div className="fx">
    <canvas className="fx-canvas" data-landing-rain="" />
    {MOTES.map(([x, y, duration, delay], index) => (
      <i
        className="mote"
        data-cool={index % 2 === 1 ? '' : undefined}
        key={x}
        style={vars({ '--x': `${x}%`, '--y': `${y}%`, '--d': `${duration}s`, '--dl': `${delay}s` })}
      />
    ))}
  </div>
)

type Pixel = readonly [
  color: 'hood' | 'hood-lo' | 'bone' | 'bone-lo' | 'ink',
  x: number,
  y: number,
  w: number,
  h: number,
]
/** The Yajin on a 12x16 pixel grid: blue hood and scarf over a skeleton. */
const BODY: readonly Pixel[] = [
  ['hood', 2, 0, 7, 1],
  ['hood', 1, 1, 9, 2],
  ['hood', 1, 3, 2, 4],
  ['hood-lo', 1, 5, 2, 3],
  ['bone', 3, 2, 7, 5],
  ['bone', 4, 7, 5, 1],
  ['ink', 5, 4, 2, 2],
  ['ink', 8, 4, 1, 2],
  ['bone-lo', 4, 7, 1, 1],
  ['bone-lo', 6, 7, 1, 1],
  ['bone-lo', 8, 7, 1, 1],
  ['hood', 2, 8, 8, 2],
  ['hood-lo', 1, 9, 2, 2],
  ['bone', 3, 10, 6, 3],
  ['ink', 4, 11, 4, 1],
  ['bone', 2, 10, 1, 3],
  ['bone', 9, 10, 1, 3],
]
const STAND: readonly Pixel[] = [
  ['bone', 4, 13, 1, 3],
  ['bone', 7, 13, 1, 3],
  ['bone-lo', 4, 15, 2, 1],
  ['bone-lo', 7, 15, 2, 1],
]
const STRIDE: readonly Pixel[] = [
  ['bone', 3, 13, 1, 2],
  ['bone', 8, 13, 1, 2],
  ['bone-lo', 2, 15, 2, 1],
  ['bone-lo', 8, 15, 2, 1],
]

const Frame = ({ name, pixels }: Readonly<{ name: string; pixels: readonly Pixel[] }>) => (
  <g data-frame={name}>
    {pixels.map(([color, x, y, width, height]) => (
      <rect data-c={color} height={height} key={`${x}-${y}-${color}`} width={width} x={x} y={y} />
    ))}
  </g>
)

export const LandingYajin = () => (
  <span aria-hidden="true" className="yajin">
    <svg shapeRendering="crispEdges" viewBox="0 0 12 16">
      <Frame name="body" pixels={BODY} />
      <Frame name="stand" pixels={STAND} />
      <Frame name="stride" pixels={STRIDE} />
    </svg>
  </span>
)
