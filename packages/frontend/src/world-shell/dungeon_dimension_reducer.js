export const DUNGEON_CEREMONY_STARTED = 'dungeon_ceremony_started'
export const DUNGEON_CEREMONY_FINISHED = 'dungeon_ceremony_finished'

/**
 * Pure fold for async dungeon-dimension results. The ceremony id is the reconciliation version:
 * duplicate or stale completions cannot clear the active ceremony or a newer room's roster.
 */
export function dungeon_dimension_reduce(state, input) {
  switch (input.type) {
    case DUNGEON_CEREMONY_STARTED:
      if (state.ceremony_id !== null) return state
      return { ...state, ceremony_id: input.ceremony_id }

    case DUNGEON_CEREMONY_FINISHED:
      if (state.ceremony_id !== input.ceremony_id) return state
      return {
        ...state,
        ceremony_id: null,
        spawned_for: input.restore && state.spawned_for === input.restore_key ? null : state.spawned_for,
      }

    default:
      return state
  }
}
