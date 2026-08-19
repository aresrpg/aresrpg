// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A fallen stepped branch with a short fork.

import { pixel_cross, randint, type PixelCell, type SpriteBuilder } from './sprite_kit.ts'

export const twig_branch: SpriteBuilder = (random) => {
  const length = randint(random, 5, 7)
  const rise_every = randint(random, 2, 3)
  const direction = random() < 0.5 ? 1 : -1
  const cells: PixelCell[] = []
  for (let step = 0; step < length; step += 1)
    cells.push([direction * (step - Math.floor(length / 2)), Math.floor(step / rise_every), 0])
  const fork_at = randint(random, 2, 3)
  cells.push(
    [direction * (fork_at - Math.floor(length / 2)), Math.floor(fork_at / rise_every) + 1, 0],
    [direction * (fork_at - Math.floor(length / 2) - 1), Math.floor(fork_at / rise_every) + 2, 0]
  )
  return pixel_cross(cells)
}
