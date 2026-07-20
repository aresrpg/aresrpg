// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LOCAL PLAYER BEAT — the ONE seam to fire a one-shot avatar clip (ENG-16 `avatar.play_beat`) on the LOCAL
// roam avatar from OUTSIDE the render loop. `embed_voxel_player` owns the avatar handle: on mount it registers
// a trigger here (which fires the beat AND pauses locomotion for the clip's duration so `update()` can't fade
// it back), and clears it on dispose. Callers fire by clip name — e.g. a successful gather swings ATTACK once
// (the attack animation should play once per successful gather). No handle, no-op.

/** @type {((clip: string) => number | null) | null} */
let _fire = null

/** embed_voxel_player registers the live avatar's beat trigger (or null on dispose). */
export function set_local_beat(fn) {
  _fire = fn
}

/** Fire a one-shot clip on the local avatar; returns its duration (s) or null when no avatar / no such clip. */
export function play_local_beat(clip) {
  return _fire ? _fire(clip) : null
}
