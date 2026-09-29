// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { leaf } from './botanical.ts'
import type { SpriteBuilder } from './sprite_kit.ts'

export const herb_bush: SpriteBuilder = (random) =>
  Array.from({ length: 9 }, (_, index) =>
    leaf(
      [0, 0, 0],
      index * 2.399 + random() * 0.4,
      0.45 + random() * 0.4,
      0.25 + random() * 0.25,
      0.12 + random() * 0.08,
      0.35
    )
  ).flat()
