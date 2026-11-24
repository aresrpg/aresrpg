// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The practice page plays local fights: every slice the fight reads, and only the effects of the practice, the fight
// and its presentation. It has no account link.
import { WORLD_MODULES } from '../game/game_modules.ts'
import practice from '../modules/practice.ts'
import { observing, type AppModule } from '../store.ts'

export const PRACTICE_MODULES: readonly AppModule[] = observing(
  [practice, ...WORLD_MODULES],
  ['practice', 'settings', 'audio', 'locale', 'fight']
)
