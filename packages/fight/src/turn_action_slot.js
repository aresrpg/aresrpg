// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// The per-turn action slot is a journal fact: a matching turn start resets it and each matching cast advances
// it. Event dialects stay at their boundaries; this fold is the single home shared by the chain snapshot and
// the fight projection.

/**
 * Fold one seat's ordered event journal into its committed cast count for the current turn.
 * @param {{ base?: number, events?: object[], turn_started: (event: object) => boolean,
 *   cast: (event: object) => boolean }} params
 * @returns {number}
 */
export const casts_this_turn_from_events = ({ base = 0, events = [], turn_started, cast }) => {
  let casts = Number(base ?? 0)
  for (const event of events ?? []) {
    if (turn_started(event)) casts = 0
    else if (cast(event)) casts += 1
  }
  return casts
}
