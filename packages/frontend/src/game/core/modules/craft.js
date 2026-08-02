// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Craft client module (Wave CRAFT) — PURE RENDERER. The SERVER is the sole authority on the craft
// queue + the per-craft timer + the off-chain ledger (#39 on-chain settle parked). This module folds
// the server's pushes into client state: `craftProgress` -> state.craft, the authoritative
// `resourceInventory` snapshot -> state.resources (the JobsDrawer
// ingredient have/need gate reads it). NEVER stored in localStorage (transient server state;
// localStorage = preferences only).
//
// S-71 janitor: the `packet/craftDone` (reward toast + job-XP fold) and `packet/gatherDone` (resource-
// delta fold) listeners were DELETED here — both WS-backend packets have zero emitters tree-wide
// (retired with the WS/FalkorDB backend, CLAUDE.md).

/** @type {import('../game.js').Module} */
export default function craft() {
  return {
    /** @param {import('../game.js').State} state @param {import('../game.js').Action} action */
    reduce(state, { type, payload }) {
      if (type === 'action/craft')
        // payload null/inactive clears the slice; else the live queue state.
        return { ...state, craft: payload?.active ? payload : null }
      if (type === 'action/resources')
        // authoritative full snapshot from the server's off-chain ledger (replaces the slice).
        return { ...state, resources: payload ?? {} }
      return state
    },
    /** @param {import('../game.js').Context} context */
    observe({ events, dispatch }) {
      // The server's authoritative queue state (server-owned, read-only here).
      events.on('packet/craftProgress', payload => {
        dispatch('action/craft', payload)
      })

      // The authoritative off-chain inventory snapshot (server-owned, read-only here). Drives the craft have/need gate.
      events.on('packet/resourceInventory', ({ resources }) => {
        dispatch('action/resources', resources)
      })
    },
  }
}
