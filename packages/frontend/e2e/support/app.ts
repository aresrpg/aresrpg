// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The store a browser fixture drives: every module of every surface, folded in the game's order, so a fixture may
// render any view. A fixture names the observers it exercises; every other module only folds.
import type { GameSettings } from '../../src/game/core/settings.ts'
import { WORLD_MODULES } from '../../src/game/game_modules.ts'
import leaderboards from '../../src/modules/leaderboards.ts'
import locale from '../../src/modules/locale.ts'
import practice from '../../src/modules/practice.ts'
import { observing, type AppModule } from '../../src/store.ts'

const EVERY_MODULE: readonly AppModule[] = Object.freeze([
  practice,
  ...WORLD_MODULES.flatMap((module) => (module.name === 'marketplace' ? [module, leaderboards] : [module])),
])

/** A fixture reads English whatever the machine's language. */
const english = Object.freeze({ ...locale, initial: () => ({ locale: 'en' as const, copy: null }) })

export const all_modules = ({
  observe = [],
  settings,
}: Readonly<{ observe?: readonly string[]; settings?: GameSettings }> = {}): readonly AppModule[] =>
  observing(
    EVERY_MODULE.map((module) => {
      if (module.name === 'settings' && settings) return Object.freeze({ ...module, initial: () => ({ settings }) })
      if (module.name === 'locale') return english
      return module
    }),
    observe
  )
