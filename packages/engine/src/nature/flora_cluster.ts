// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { leaf } from './botanical.ts'
import type { SpriteBuilder } from './sprite_kit.ts'

/** Gatherable herbs use the same shaped, textured leaves as biome ground cover. */
export const flora_cluster: SpriteBuilder = (random) =>
  Array.from({ length: 13 }, (_, index) =>
    leaf(
      [0, (index % 3) * 0.04, 0],
      index * 2.399963 + random() * 0.3,
      0.48 + random() * 0.6,
      0.35 + random() * 0.5,
      0.1 + random() * 0.09,
      0.4
    )
  ).flat()
