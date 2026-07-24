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
  /** Player-closed the wall (owner ruling 2026-07-24 — the modal is dismissible). Latches shut until the
   *  next genuine pause SIGNAL: a fresh poll-detected onset or a live tx abort. A poll merely reconfirming an
   *  ALREADY-known pause (every 30s) never clears it — that would reopen a dismissed wall on a timer and
   *  defeat the entire point of letting the player browse whatever doesn't need a tx. */
  dismissed: boolean
  /** An explicit poll result: `false` ⇒ latch paused, `true` ⇒ clear it, `null` (unknown) ⇒ leave untouched. */
  report: (enabled: TriBool) => void
  /** The reactive net (a live version/102 tx abort) — always latches paused, independent of the last poll. */
  mark_paused: () => void
  /** The player closed the wall. Never touches `paused` — the chain truth doesn't change because it was hidden. */
  dismiss: () => void
}

export const use_contracts_paused = create<ContractsPausedState>((set, get) => ({
  paused: false,
  dismissed: false,
  report: (enabled) => {
    if (enabled === false) {
      const was_paused = get().paused
      if (!was_paused) game_log('maintenance', 'contracts paused — chain read confirmed enabled=false')
      // A fresh onset (was live a moment ago) re-arms even a stale dismiss; a reconfirming poll while
      // already paused leaves the latch alone (see the `dismissed` doc above).
      set(was_paused ? { paused: true } : { paused: true, dismissed: false })
    } else if (enabled === true) {
      if (get().paused) game_log('maintenance', 'contracts live again — chain read confirmed enabled=true')
      set({ paused: false, dismissed: false }) // recovered — clear the latch so a later re-pause starts fresh
    }
    // enabled === null (unreadable / never-toggled) — unknown, never touches `paused` or `dismissed`.
  },
  mark_paused: () => {
    if (!get().paused) game_log('maintenance', 'contracts paused — detected via a live version/102 tx abort')
    set({ paused: true, dismissed: false }) // a live failed tx always re-arms — the honest "still paused" proof
  },
  dismiss: () => set({ dismissed: true }),
}))

// Module-scope tail wire (mirrors dungeon_store.js's `on_marker_refusal` wiring): ANY tx anywhere that aborts
// version/102 flips the store instantly. Registered once, at import time — not per-render.
on_maintenance_abort(() => use_contracts_paused.getState().mark_paused())
