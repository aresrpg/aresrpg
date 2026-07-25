// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE ONE HACK-MODE READ for every HUD surface (the presence_count.js selector idiom). The mode is resolved
// exactly once, at the composition root (embed_voxel.js's create_session), and published through the reducer
// door as `world_presentation`; a settings flip re-creates the session in place, so this selector is what
// makes the flip reach the HUD LIVE. Reading the preference module a second time (resolve_hack_mode) instead
// would be a non-reactive read of a fact the reducer already owns: a surface doing that only re-branches when
// React happens to remount it — i.e. after a page reload — which is exactly the bug this closes (#812).

/** @param {import('./game.js').State} state @returns {boolean} is the live session showing the hack grid */
export const select_hack_presentation = (state) => state.world_presentation === 'hackgrid'
