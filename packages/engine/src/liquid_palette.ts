// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export type LinearColor = readonly [number, number, number]
export type LiquidPalette = Readonly<{
  body: LinearColor
  shallow: LinearColor
  up: LinearColor
  down: LinearColor
}>

const scaled = (color: LinearColor, scale: LinearColor): LinearColor =>
  Object.freeze(color.map((channel, index) => Math.min(1, channel * scale[index]!)) as [number, number, number])

/** The water preset's one engine-owned grade. Every water surface and immersion color derives
 * from the seed-authored linear base color through this transform. */
export const liquid_palette = (color: LinearColor): LiquidPalette =>
  Object.freeze({
    body: scaled(color, [0.3, 3.8, 1.65]),
    shallow: scaled(color, [0.3, 5.2, 0.95]),
    up: scaled(color, [0.8, 4.6, 1.8]),
    down: scaled(color, [0.15, 0.8, 0.65]),
  })
