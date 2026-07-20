// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-84 — the CONTRACTS PAUSED store. Split out from contracts_paused_modal.tsx on purpose: this file's only
// imports are zustand + the two leaf modules abort_copy.test.js/report.test.js already prove safe in a
// DOM-less bun:test (no jsdom/RTL harness exists in this repo — item_detail_view.test.tsx's header notes why
// one wasn't added for a single row). Pulling in `../auth` (touches `window`/wallet-standard at module scope)
// or react-dom/lucide-react here would make the pure state-transition logic untestable headlessly.

import { create } from 'zustand'

import { on_maintenance_abort } from '../game/core/abort_copy.js'
import { game_log } from '../core/log.js'

export type TriBool = boolean | null

interface ContractsPausedState {
  paused: boolean
  /** An explicit poll result: `false` ⇒ latch paused, `true` ⇒ clear it, `null` (unknown) ⇒ leave untouched. */
  report: (enabled: TriBool) => void
  /** The reactive net (a live version/102 tx abort) — always latches paused, independent of the last poll. */
  mark_paused: () => void
}

export const use_contracts_paused = create<ContractsPausedState>((set, get) => ({
  paused: false,
  report: (enabled) => {
    if (enabled === false) {
      if (!get().paused) game_log('maintenance', 'contracts paused — chain read confirmed enabled=false')
      set({ paused: true })
    } else if (enabled === true) {
      if (get().paused) game_log('maintenance', 'contracts live again — chain read confirmed enabled=true')
      set({ paused: false })
    }
    // enabled === null (unreadable / never-toggled) — unknown, never touches `paused`.
  },
  mark_paused: () => {
    if (!get().paused) game_log('maintenance', 'contracts paused — detected via a live version/102 tx abort')
    set({ paused: true })
  },
}))

// Module-scope tail wire (mirrors dungeon_store.js's `on_marker_refusal` wiring): ANY tx anywhere that aborts
// version/102 flips the store instantly. Registered once, at import time — not per-render.
on_maintenance_abort(() => use_contracts_paused.getState().mark_paused())
