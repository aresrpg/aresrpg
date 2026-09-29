// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { quad, type RecipeVertex } from './sprite_kit.ts'

export const leaf_height = (t: number, lift: number): number => Math.sin(t * Math.PI * 0.68) * lift

type Point = readonly [number, number, number]
/** A bent leaf ribbon: four triangles, rounded width profile, fixed UVs and rooted wind weights. */
export const leaf = (
  origin: Point,
  yaw: number,
  length: number,
  lift: number,
  width: number,
  blend = 0.5
): readonly RecipeVertex[] => {
  const point = (t: number, side: number): RecipeVertex => {
    const reach = length * t,
      spread = Math.sin(Math.PI * t) ** 0.6 * width * side
    return [
      origin[0] + Math.cos(yaw) * reach - Math.sin(yaw) * spread,
      origin[1] + leaf_height(t, lift),
      origin[2] + Math.sin(yaw) * reach + Math.cos(yaw) * spread,
      blend + t * 0.35,
      origin[1] + t * lift,
      0.5 + side * 0.5,
      t,
    ]
  }
  return [
    point(0, 0),
    point(0.25, -1),
    point(0.25, 1),
    ...quad(point(0.25, -1), point(0.7, -1), point(0.7, 1), point(0.25, 1)),
    point(0.7, -1),
    point(1, 0),
    point(0.7, 1),
  ]
}
export const stem = (height: number, lean: number): readonly RecipeVertex[] =>
  quad(
    [-0.018, 0, 0, 0, 0, 0, 0],
    [0.018, 0, 0, 0, 0, 1, 0],
    [lean + 0.012, height, 0, 0.18, height, 1, 1],
    [lean - 0.012, height, 0, 0.18, height, 0, 1]
  )
