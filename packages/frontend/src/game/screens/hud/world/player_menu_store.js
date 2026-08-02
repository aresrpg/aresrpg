// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// S-67 — the ONE "target a player" home. Friend row, chat name, and in-world nameplate seams open it, and
// one component renders it (PlayerActionMenu). Kept a bare store (no React) so remote_players.js — a plain rAF
// module outside the React tree — can open it imperatively via `open_player_menu` with the same contract the
// chat seam uses. The menu only ever WRITES through the existing friend / party tx flows; it holds no roster.

import { create } from 'zustand'

/**
 * @typedef {{
 *   kind?: 'friend',          // friend-list targets carry a resolved live route; omitted for in-world/chat seams
 *   id: string | null,        // the target's on-chain character id — an identifier, NOT a claim of ownership;
 *                             // PlayerActionMenu resolves the owning wallet from /v1 before any signed action
 *   owner_address?: string | null, // ONLY the friend seam, whose key IS a wallet read from my on-chain friend
 *                             // list. No other seam may supply one: an address a surface merely observed can
 *                             // never be the owner a transaction is composed against (advisory-only law).
 *   name: string,             // display name for the menu header
 *   routes?: Array<{character_id:string,world_id:string|null}>, // friend roster's already-fetched /v1 worlds
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
