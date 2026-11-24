// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The demo page runs the fight lab and the seed editor beside the game's slices, with no account link.
import { WORLD_MODULES } from '../game/game_modules.ts'
import { observing, type AppModule } from '../store.ts'

export const DEMO_MODULES: readonly AppModule[] = observing(WORLD_MODULES, [
  'simulator',
  'editor',
  'settings',
  'audio',
  'locale',
  'fight',
])
