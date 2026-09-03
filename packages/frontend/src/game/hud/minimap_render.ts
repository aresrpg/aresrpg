// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable functional/immutable-data, functional/prefer-immutable-types, no-param-reassign -- canvas rendering is an explicit effect boundary over its mutable drawing context. */
// MINIMAP RENDER — pure sampling + painting for the 2D maps (minimap lens AND the full-screen
// world map share this pipeline at different radii). North-up, analytic: the terrain comes
// straight from the compiled world recipe's per-column sampler (no chunk residency, works before
// terrain streams in), hill-shaded from its own height gradient under a fixed daylight palette.
// The grid re-samples only when the player crosses a resample cell; painting is a cheap
// per-frame pass over the cached grid plus the overlay marks.

import { sample_world_column, type CompiledWorld } from '@aresrpg/engine'

/** World blocks from center to the minimap's edge (owner 2026-08-19: dezoomed from 128). */
export const VIEW_RADIUS_BLOCKS = 224
/** Minimap samples per axis — grid cell = 4 blocks at the default radius. */
export const SAMPLE_N = 112
/** The player crosses this many blocks before the terrain grid re-samples. */
export const RESAMPLE_STEP = 8

export type ReliefGrid = Readonly<{
  center_x: number
  center_z: number
  radius: number
  samples: number
  heights: Float32Array
  colors: Uint8ClampedArray // rgb per sample, sRGB
}>

const srgb = (linear: number): number => Math.round(255 * Math.min(1, Math.max(0, linear) ** (1 / 2.2)))

export const resample_key = (x: number, z: number): string =>
  `${Math.round(x / RESAMPLE_STEP)}:${Math.round(z / RESAMPLE_STEP)}`

/** Fill one row band of a relief grid in place — the big map samples progressively so a
 * zone-scale grid never freezes the main thread. */
export const fill_relief_rows = (world: CompiledWorld, grid: ReliefGrid, from_row: number, to_row: number): void => {
  const { samples, radius, center_x, center_z, heights, colors } = grid
  const step = (radius * 2) / samples
  for (let row = from_row; row < to_row; row += 1) {
    for (let col = 0; col < samples; col += 1) {
      const wx = center_x + (col - samples / 2) * step
      const wz = center_z + (row - samples / 2) * step
      const column = sample_world_column(world, Math.floor(wx), Math.floor(wz))
      const index = row * samples + col
      heights[index] = column.surface_y
      const [r, g, b] = world.materials.colors[column.surface_id] ?? [0.2, 0.2, 0.2]
      colors[index * 3] = srgb(r!)
      colors[index * 3 + 1] = srgb(g!)
      colors[index * 3 + 2] = srgb(b!)
    }
  }
}

export const empty_relief_grid = (
  center_x: number,
  center_z: number,
  radius = VIEW_RADIUS_BLOCKS,
  samples = SAMPLE_N
): ReliefGrid =>
  Object.freeze({
    center_x,
    center_z,
    radius,
    samples,
    heights: new Float32Array(samples * samples),
    colors: new Uint8ClampedArray(samples * samples * 3),
  })

export const sample_relief_grid = (
  world: CompiledWorld,
  center_x: number,
  center_z: number,
  radius = VIEW_RADIUS_BLOCKS,
  samples = SAMPLE_N
): ReliefGrid => {
  const grid = empty_relief_grid(center_x, center_z, radius, samples)
  fill_relief_rows(world, grid, 0, samples)
  return grid
}

/** Paint the cached grid hill-shaded (light from the north-west) onto the canvas. */
export const paint_relief = (context: CanvasRenderingContext2D, grid: ReliefGrid, size: number): void => {
  const { samples, radius } = grid
  const cell = size / samples
  // The local lenses sample every 4–8 blocks. Whole-world LOD samples hundreds of blocks per
  // cell, so normalize the height delta by sample spacing or continental relief saturates the
  // hill shade into alternating black and white cells.
  const sample_step = (radius * 2) / samples
  const shade_gain = 0.045 * Math.min(1, 8 / sample_step)
  for (let row = 0; row < samples; row += 1) {
    for (let col = 0; col < samples; col += 1) {
      const index = row * samples + col
      const height = grid.heights[index]!
      const upleft = grid.heights[Math.max(0, row - 1) * samples + Math.max(0, col - 1)]!
      const shade = Math.min(1.25, Math.max(0.55, 1 + (height - upleft) * shade_gain))
      const r = Math.min(255, grid.colors[index * 3]! * shade)
      const g = Math.min(255, grid.colors[index * 3 + 1]! * shade)
      const b = Math.min(255, grid.colors[index * 3 + 2]! * shade)
      context.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`
      context.fillRect(col * cell, row * cell, cell + 1, cell + 1)
    }
  }
}

/** World (client-space) → canvas pixel for a north-up view centered on (center_x, center_z). */
export const to_canvas = (
  x: number,
  z: number,
  center_x: number,
  center_z: number,
  size: number,
  radius = VIEW_RADIUS_BLOCKS
): Readonly<{ px: number; pz: number }> => {
  const scale = size / (radius * 2)
  return Object.freeze({ px: size / 2 + (x - center_x) * scale, pz: size / 2 + (z - center_z) * scale })
}
