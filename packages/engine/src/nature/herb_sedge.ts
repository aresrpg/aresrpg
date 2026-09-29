// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { leaf } from './botanical.ts'
import type { SpriteBuilder } from './sprite_kit.ts'

export const herb_sedge: SpriteBuilder = (random) =>
  Array.from({ length: 5 }, (_, index) =>
    leaf([0, 0, 0], index * 2.399 + random(), 0.15 + random() * 0.2, 1 + random() * 0.7, 0.025, 0.3)
  ).flat()
