// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { leaf, stem } from './botanical.ts'
import { quad, type RecipeVertex, type SpriteBuilder } from './sprite_kit.ts'

export const flower_bloom: SpriteBuilder = (random) => {
  const height = 0.7 + random() * 0.6,
    lean = (random() - 0.5) * 0.18,
    petals = 5 + Math.floor(random() * 3),
    radius = 0.2 + random() * 0.08
  const bloom = Array.from({ length: petals }, (_, index) => {
    const angle = (index * Math.PI * 2) / petals
    const point = (distance: number, side: number, up: number): RecipeVertex => [
      lean + Math.cos(angle) * distance - Math.sin(angle) * side,
      height + up,
      Math.sin(angle) * distance + Math.cos(angle) * side,
      0.72 + distance,
      0.7,
      0.5 + side / (radius * 0.8),
      distance / radius,
    ]
    return quad(
      point(0.025, -0.02, -0.015),
      point(radius, -radius * 0.3, 0.06),
      point(radius, radius * 0.3, 0.06),
      point(0.025, 0.02, -0.015)
    )
  }).flat()
  return [
    ...stem(height, lean),
    ...leaf([0, height * 0.25, 0], 0.5, 0.3, 0.13, 0.09, 0.15),
    ...leaf([0, height * 0.45, 0], 3.7, 0.25, 0.1, 0.08, 0.15),
    ...bloom,
  ]
}
