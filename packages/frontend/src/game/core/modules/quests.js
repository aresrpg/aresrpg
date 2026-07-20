// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Tutorial questbook — client engine module. The SERVER is the sole authority on quest progress
// (transient Redis runtime state); this module only folds the pushed `questsUpdate` snapshot into the
// `quests` store slice. The QuestsDrawer renders the STATIC chain (@aresrpg/sdk/quests) merged with this
// live progress and never computes completion. One store slice:
//   state.quests — { progress: { [quest_id]: { count, completed } }, active_quest_id } | null
//
// A quest ABSENT from `progress` is one the server cannot yet track (its trigger has no live source) —
// the drawer greys it as "coming soon". `active_quest_id` is the highlighted current objective.

/** @type {import('../game.js').Module} */
export default function quests() {
  return {
    /** @param {import('../game.js').State} state @param {import('../game.js').Action} action */
    reduce(state, { type, payload }) {
      if (type !== 'action/quests_update') return state
      const progress = (payload?.quests ?? []).reduce(
        (/** @type {Record<string, { count: number, completed: boolean }>} */ acc, q) => {
          acc[q.quest_id] = { count: q.count ?? 0, completed: !!q.completed }
          return acc
        },
        {}
      )
      return {
        ...state,
        quests: {
          progress,
          active_quest_id: payload?.active_quest_id || null,
        },
      }
    },
    /** @param {import('../game.js').Context} context */
    observe({ events, dispatch }) {
      events.on('packet/questsUpdate', (payload) => dispatch('action/quests_update', payload))
    },
  }
}
