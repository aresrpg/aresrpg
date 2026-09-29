// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { leaf, leaf_height } from './botanical.ts'
import type { SpriteBuilder } from './sprite_kit.ts'

export const herb_fern: SpriteBuilder = (random) =>
  Array.from({ length: 3 }, (_, frond) => {
    const yaw = frond * 2.399 + random() * 0.5,
      length = 0.75 + random() * 0.35,
      height = 0.55 + random() * 0.3
    return [
      ...leaf([0, 0, 0], yaw, length, height, 0.012, 0.15),
      ...[1, 2, 3].flatMap((level) =>
        [-1, 1].flatMap((side) => {
          const t = level / 4
          return leaf(
            [Math.cos(yaw) * length * t, leaf_height(t, height), Math.sin(yaw) * length * t],
            yaw + side * 1.1,
            (1 - t) * 0.5,
            0.08,
            0.07,
            0.3 + t * 0.25
          )
        })
      ),
    ]
  }).flat()
