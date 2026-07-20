// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S2 — dungeon_store is now a PURE RE-EXPORT FAÇADE. The run/fight lifecycle moved to dungeon_run_store.js (over
// the generic fight core); this file only keeps the historic import surface stable so the ~40 `use_dungeon`
// consumers stay untouched. ZERO logic, zero state, zero fight verbs — the gate guards it.

export { use_dungeon } from './dungeon_run_store.js'
export { DUNGEON_BOARD_ORIGIN } from '@aresrpg/fight'
