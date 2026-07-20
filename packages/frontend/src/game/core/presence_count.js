// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Aggregate presence count SSOT. `visible_characters` contains remote p2p peers; the active client is
// rendered separately, so the chat-only total includes one for self.

/** @param {import('./game.js').State} state */
export const select_online_count = (state) => state.visible_characters.size + 1
