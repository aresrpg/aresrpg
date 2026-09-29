// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { stone_lump } from './stone_lump.ts'
import { randint, type SpriteBuilder } from './sprite_kit.ts'

export const rock_pebbles: SpriteBuilder = (random) =>
  Array.from({ length: randint(random, 2, 3) }, (_, index) => {
    const radius = 0.1 + random() * 0.11
    return stone_lump(
      random,
      index === 0 ? 0 : (random() - 0.5) * 0.55,
      index === 0 ? 0 : (random() - 0.5) * 0.55,
      radius,
      radius * (0.6 + random() * 0.55)
    )
  }).flat()
