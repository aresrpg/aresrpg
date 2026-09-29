// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { mushroom } from './mushroom_cluster.ts'
import type { SpriteBuilder } from './sprite_kit.ts'

export const mushroom_toadstool: SpriteBuilder = (random) =>
  mushroom(0, 0, 0.24 + random() * 0.18, 0.16 + random() * 0.1)
