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

/**
 * THE ONE SLOT (#1224) — the chain slot a seat's NEXT action folds with (`participant::casts_this_turn` at that
 * action's execution, the `tackle_seed` / `slot_crit_roll` input). Every surface that previews a seeded roll —
 * the move wash's tackle contest, the §7 crit clock, the socket glow — reads THIS number, because they are all
 * asking about the same on-chain counter and a disagreement is a preview of a roll the chain will not make.
 *
 * The snapshot row is only a BASE: the counter resets on chain when MY turn starts and advances per cast of
 * mine, so the ordered post-view journal (`store.log`, canonical rows AND my own drafted intents) is what makes
 * it current. `ahead` is the ESCAPE HATCH for actions that exist nowhere yet — a planned batch being priced
 * before it is drafted (the bot's bank). A count taken from a second store instead is not a shortcut, it is a
 * second home: it cannot see a turn the journal already restarted.
 *
 * @param {{ base?: number, events?: object[], seat: number, ahead?: number }} params
 * @returns {number}
 */
export const next_action_slot = ({ base = 0, events = [], seat, ahead = 0 }) =>
  casts_this_turn_from_events({
    base,
    events,
    turn_started: (event) => event.kind === 'TurnStarted' && !event.is_mob && Number(event.idx) === seat,
    cast: (event) => event.kind === 'Cast' && !event.caster_is_mob && Number(event.caster_idx) === seat,
  }) + Math.max(0, Number(ahead) || 0)
