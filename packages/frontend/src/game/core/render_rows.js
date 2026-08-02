// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE RENDER COMPOSITION — and the only place it happens.
//
// Two maps hold two different facts: `observed_peers` is what the p2p room reported seeing (advisory,
// realtime constitution D2) and `owned_follow_render_rows` is my own party followers, driven locally from
// accepted on-chain membership. They used to share one Map with two writers, which is how a p2p observation
// ended up answering questions it has no standing to answer — an aggregate "online" count that silently
// included my own alts, and a freshness sweep from one writer reaping the other's rows.
//
// Only the RENDER edge needs them together (a body on screen is a body on screen), so only the render edge
// joins them. Anything asking a question ABOUT a player reads the map that actually holds that fact.

/** Every row to draw this frame, as `[id, entry]` pairs. Observations first; my followers are mine and win a
 *  key collision by construction (a follower I drive is not a peer I merely observe).
 *  @param {{ observed_peers?: Map<string, any>, owned_follow_render_rows?: Map<string, any> }} state */
export const render_rows = (state) => [...(state.observed_peers ?? []), ...(state.owned_follow_render_rows ?? [])]

/** One row by character id, from either home — the lookup half of the same composition.
 *  @param {{ observed_peers?: Map<string, any>, owned_follow_render_rows?: Map<string, any> }} state
 *  @param {string} id */
export const render_row_of = (state, id) =>
  state.owned_follow_render_rows?.get(id) ?? state.observed_peers?.get(id) ?? null
