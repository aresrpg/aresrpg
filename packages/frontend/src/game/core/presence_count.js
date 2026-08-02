// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Aggregate OBSERVATION count SSOT. It counts peer observations — one client's report of one room at one
// instant (realtime constitution D2) — plus this client, which is observing. It is NOT a population, NOT a
// player count, and NOT an online roster; it once silently included my own party followers, which is exactly
// the confusion that comes of one map holding two facts. It now reads the observations home alone.

/** @param {import('./game.js').State} state */
export const select_observed_count = (state) => state.observed_peers.size + 1
