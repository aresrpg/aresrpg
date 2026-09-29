// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Prefer the viewport center; move only as far as necessary to clear the left chat. */
export const combat_center = (viewport_width: number, hud_width: number, chat_right: number): number =>
  Math.min(viewport_width - hud_width / 2 - 10, Math.max(viewport_width / 2, chat_right + 12 + hud_width / 2))
