// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE APP-MANAGED FOLLOWER GATE (#509) — the authoritative "these ids are auto-followed, app-driven" set that
// the character-selection write door (sui_session's `action/select_character` reduce + observe) consults to
// REFUSE embodying a follower: an auto-following character is APP-MANAGED and can never become the driven
// character, by sidebar click (already folded to a non-button) OR programmatically (the world-join auto-select
// door the folded-row UI guard can't reach — the live focus-steal).
//
// group_wiring — the follow reducer's production edge — PUBLISHES the set on every follow-projection change;
// the selection door READS it. A dependency-free leaf ON PURPOSE: the game core reads it without importing
// group_wiring, which would close the group_wiring → game/store → game → modules → sui_session import cycle
// depcruise forbids. One-way: group_wiring writes, the reducer reads. Session-scoped, starts empty (follow is
// never persisted); a reset publishes the empty set, reopening every id to selection.

// eslint-disable-next-line functional/no-let -- one app-lifetime registry, replaced wholesale on each publish.
let follower_ids = new Set()

/** Publish the current auto-follow id set (group_wiring's notify_follow fires this on every follow change). */
export function set_app_managed_followers(ids) {
  follower_ids = new Set(ids)
}

/** The selection door's read: is this id an app-managed follower that can never be embodied? null → false. */
export function is_app_managed_follower(character_id) {
  return follower_ids.has(character_id)
}
