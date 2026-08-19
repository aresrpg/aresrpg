// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A flowering herb: tall stem, paired diagonal leaves, and a detailed bloom. In flower sprites
// band 1 is PETAL SHADING (a 55% mix of dark body toward the petal color), so every archetype
// carries a lit side and a shaded side inside three flat tones. Stems and leaves stay band 0 —
// a mid band there would tint the greens toward the petals. Four archetypes: lobed daisy,
// notched tulip cup, budded bloom spray, drooping bell.

import { pixel_cross, randint, type PixelCell, type SpriteBuilder } from './sprite_kit.ts'

const daisy = (random: () => number, base_row: number): readonly PixelCell[] => {
  // Eight petal lobes around a shaded inner ring and a dark heart.
  const center_row = base_row + 3
  const cells: PixelCell[] = []
  const lobes = [
    [0, 1],
    [1, 1],
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, -1],
    [-1, 0],
    [-1, 1],
  ] as const
  lobes.forEach(([dx, dy]) => {
    cells.push([dx, center_row + dy, 1])
    cells.push([dx * 2, center_row + dy * 2, 2])
    if (dx !== 0 && dy !== 0 && random() < 0.7) cells.push([dx * 3, center_row + dy * 2, 2])
  })
  cells.push([0, center_row, 0])
  return cells
}

const tulip = (random: () => number, base_row: number): readonly PixelCell[] => {
  // A cup with a shaded base row, lit body, flared lip, and a V-notched crown.
  const width = randint(random, 1, 2)
  const cells: PixelCell[] = []
  for (let x = -width; x <= width; x += 1) cells.push([x, base_row, 1])
  for (let row = 1; row < 3; row += 1) for (let x = -width; x <= width; x += 1) cells.push([x, base_row + row, 2])
  cells.push(
    [-width - 1, base_row + 1, 1],
    [width + 1, base_row + 1, 1],
    [-width - 1, base_row + 2, 2],
    [width + 1, base_row + 2, 2],
    [-width, base_row + 3, 2],
    [width, base_row + 3, 2]
  )
  if (width === 2) cells.push([0, base_row + 3, 2])
  return cells
}

const spray = (random: () => number, base_row: number): readonly PixelCell[] => {
  // Three fanned blooms (shaded bottom, lit top) plus single-cell buds on the stalks.
  const cells: PixelCell[] = []
  const fan = [-2, 0, 2] as const
  fan.forEach((dx, index) => {
    const lift = index === 1 ? 2 : 0
    cells.push(
      [dx, base_row + lift, 1],
      [dx + 1, base_row + lift, 1],
      [dx, base_row + lift + 1, 2],
      [dx + 1, base_row + lift + 1, 2]
    )
    if (index !== 1) {
      cells.push([dx, base_row - 1, 0])
      if (random() < 0.6) cells.push([dx - 1, base_row + lift + 2, 2])
    }
  })
  return cells
}

const bell = (random: () => number, base_row: number): readonly PixelCell[] => {
  // A hooked stem tip with a bell hanging under it — shaded rim, lit body, clapper cell.
  const side = random() < 0.5 ? 1 : -1
  const cells: PixelCell[] = []
  cells.push([0, base_row, 0], [side, base_row, 0], [side * 2, base_row - 1, 0])
  const bell_x = side * 2
  for (let x = -1; x <= 1; x += 1) {
    cells.push([bell_x + x, base_row - 4, 1])
    cells.push([bell_x + x, base_row - 3, 2])
    cells.push([bell_x + x, base_row - 2, 2])
  }
  cells.push([bell_x, base_row - 5, 1])
  return cells
}

export const flower_bloom: SpriteBuilder = (random) => {
  const stem_rows = randint(random, 8, 12)
  const cells: PixelCell[] = []
  for (let row = 0; row < stem_rows; row += 1) cells.push([0, row, 0])
  const leaf_row = randint(random, 2, 4)
  cells.push(
    [1, leaf_row, 0],
    [2, leaf_row + 1, 0],
    [2, leaf_row + 2, 0],
    [-1, leaf_row + 2, 0],
    [-2, leaf_row + 3, 0],
    [-2, leaf_row + 4, 0]
  )
  const shapes = [daisy, tulip, spray, bell] as const
  const bloom = shapes[randint(random, 0, shapes.length - 1)]!(random, stem_rows)
  return pixel_cross([...cells, ...bloom])
}
