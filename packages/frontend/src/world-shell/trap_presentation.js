// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** @typedef {{ beat_id: string, cell: number }} TrapTriggerBeat */
/**
 * @typedef {{
 *   live_cells: ReadonlyArray<number>,
 *   visible_cells: ReadonlyArray<number>,
 *   pending_removals: ReadonlyArray<TrapTriggerBeat>,
 *   presented_beat_ids: ReadonlyArray<string>,
 * }} TrapPresentationState
 */

const unique = (values) => [...new Set(values)]

const unique_beats = (beats) => [
  ...new Map(beats.map((beat) => [beat.beat_id, { beat_id: beat.beat_id, cell: beat.cell }])).values(),
]

const visible_cells_of = (live_cells, pending_removals) =>
  unique([...live_cells, ...pending_removals.map((removal) => removal.cell)])

/** @returns {TrapPresentationState} */
export const empty_trap_presentation = () => ({
  live_cells: [],
  visible_cells: [],
  pending_removals: [],
  presented_beat_ids: [],
})

export const trap_beat_id = (turn_seq, beat_index) => `${turn_seq}:${beat_index}`

/**
 * Project the active wave's trap-trigger identities. These beats only enrich an observed cell removal with its
 * serial presentation point; they can never create a marker or remove a still-live cell by themselves.
 * @param {(cell: {x:number,y:number}) => number} encode_cell
 * @param {ReadonlyArray<any>} wave
 * @returns {TrapTriggerBeat[]}
 */
export const trap_trigger_beats = (encode_cell, wave) =>
  wave.flatMap((turn) =>
    (turn.beats ?? []).flatMap((beat, beat_index) =>
      beat.kind === 'trap_trigger' && beat.payload?.cell != null
        ? [{ beat_id: trap_beat_id(turn.seq, beat_index), cell: encode_cell(beat.payload.cell) }]
        : []
    )
  )

const observe = (state, live_cells_input, trigger_beats_input) => {
  const live_cells = unique(live_cells_input)
  const live = new Set(live_cells)
  const trigger_beats = unique_beats(trigger_beats_input)
  const active_beat_ids = new Set(trigger_beats.map((beat) => beat.beat_id))
  const presented_beat_ids = state.presented_beat_ids.filter((beat_id) => active_beat_ids.has(beat_id))
  const presented = new Set(presented_beat_ids)
  const pending_removals = state.pending_removals.filter(
    (removal) => active_beat_ids.has(removal.beat_id) && !presented.has(removal.beat_id) && !live.has(removal.cell)
  )
  const pending_beat_ids = new Set(pending_removals.map((removal) => removal.beat_id))
  const removed_cells = state.live_cells.filter((cell) => !live.has(cell))
  const observed_removals = removed_cells.flatMap((cell) => {
    const trigger = trigger_beats.find(
      (beat) => beat.cell === cell && !presented.has(beat.beat_id) && !pending_beat_ids.has(beat.beat_id)
    )
    return trigger ? [trigger] : []
  })
  const next_pending_removals = unique_beats([...pending_removals, ...observed_removals])
  return {
    live_cells,
    visible_cells: visible_cells_of(live_cells, next_pending_removals),
    pending_removals: next_pending_removals,
    presented_beat_ids,
  }
}

const present_trigger = (state, beat_id) => {
  const pending_removals = state.pending_removals.filter((removal) => removal.beat_id !== beat_id)
  return {
    ...state,
    visible_cells: visible_cells_of(state.live_cells, pending_removals),
    pending_removals,
    presented_beat_ids: unique([...state.presented_beat_ids, beat_id]),
  }
}

/**
 * Fold trap presentation from observed state transitions. A queued trigger only schedules a real live→gone
 * delta; replaying or duplicating the beat without that delta changes no marker.
 * @param {Readonly<TrapPresentationState>} state
 * @param {{type:'observe', live_cells:ReadonlyArray<number>, trigger_beats:ReadonlyArray<TrapTriggerBeat>} |
 *   {type:'trigger_presented', beat_id:string}} input
 * @returns {TrapPresentationState}
 */
export const trap_presentation_reduce = (state, input) => {
  switch (input.type) {
    case 'observe':
      return observe(state, input.live_cells, input.trigger_beats)
    case 'trigger_presented':
      return present_trigger(state, input.beat_id)
    default:
      return state
  }
}
