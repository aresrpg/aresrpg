// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { leaf } from './botanical.ts'
import type { SpriteBuilder } from './sprite_kit.ts'

export const herb_tall_grass: SpriteBuilder = (random) =>
  Array.from({ length: 6 }, (_, index) =>
    leaf(
      [(random() - 0.5) * 0.2, 0, (random() - 0.5) * 0.2],
      index * 2.399 + random(),
      0.25 + random() * 0.4,
      0.65 + random() * 0.65,
      0.035 + random() * 0.035,
      0.25 + random() * 0.2
    )
  ).flat()
