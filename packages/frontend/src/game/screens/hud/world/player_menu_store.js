// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-67 — the ONE "target a player" home. Two seams open it (chat name click · in-world nameplate click) and
// one component renders it (PlayerActionMenu). Kept a bare store (no React) so remote_players.js — a plain rAF
// module outside the React tree — can open it imperatively via `open_player_menu` with the same contract the
// chat seam uses. The menu only ever WRITES through the existing friend / party tx flows; it holds no roster.

import { create } from 'zustand'

/**
 * @typedef {{
 *   id: string | null,        // the peer's on-chain character id (chat + nameplate both carry it) — resolves the wallet address
 *   address: string | null,   // the peer's wallet, when already known (nameplate reads it live); else resolved from `id`
 *   name: string,             // display name for the menu header
 *   x: number, y: number,     // screen anchor (the click point / element rect) — the menu clamps itself on-screen
 * }} PlayerTarget
 */

export const use_player_menu = create((set) => ({
  /** @type {PlayerTarget | null} */
  target: null,
  /** @param {PlayerTarget} target */
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}))

/** Imperative opener for non-React callers (remote_players.js's nameplate chips live outside the React tree). */
export function open_player_menu(/** @type {PlayerTarget} */ target) {
  use_player_menu.getState().open(target)
}
