// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/cast_record.js — THE CAST-RESOLUTION RECORD (#1993 WP5): one home for what a cast actually did — did it
// land, on whom, and on which cells — read by BOTH the combat log and the impact package.
//
// WHY IT EXISTS. A cast's landing used to be decided twice, by two homes that could not see each other (#1859):
// the log asked a beat-KIND classifier ("is there any resolution-shaped beat behind this cast?") while the
// renderer authorized its impact off the caster cell plus the packet's AIM cell, then resolved the struck cells
// from a LIVE fighter read at impact time — a third answer, taken hundreds of milliseconds after the first two.
// A kind-only verdict cannot see a payload (a fully dodged drain still emits a `status` beat), and an aim cell is
// not a landing (a cast resolves on bodies, which may not be standing on the cell it was aimed at). So the two
// disagreed with each other and with chain placement, and a live session watched a mob cast visibly AT the
// player and read back that it hit nothing.
//
// WHY A PURE FUNCTION AND NOT A FOLD. Unlike the result record (`result_record.js`), a cast's resolution has no
// late evidence: the whole answer is present in the source turn's ordered beats the moment the presenter binds
// them, which is exactly when both consumers need it. Nothing accumulates, so nothing needs memory — the record
// is derived once, at bind, and travels on the cast packet.
//
// WHAT IT DELIBERATELY DOES NOT DO. It never invents a cell. A victim whose row the projection cannot resolve
// contributes NO cell rather than the aim cell — a fabricated position is the bug, not the cure.

/** The beat kinds that CARRY a cast's resolution: a body took damage or healing, an entity was moved or
 *  teleported, a trap/glyph was placed, one triggered, or a status/drain landed. */
const RESOLUTION_KINDS = new Set([
  'damage',
  'heal',
  'displacement',
  'teleport_arrival',
  'trap_place',
  'trap_trigger',
  'status',
])

/** The kinds that OPEN a new action. Everything past one of them belongs to IT, never to the cast in front of
 *  it — the attribution the beat-kind classifier got wrong: a walk that springs a trap writes `move` →
 *  `trap_trigger` → `damage` into the SAME source turn, and a forward scan that stopped only at the next `cast`
 *  claimed that detonation as the whiffed cast's landing (#1859 arm B). */
const ACTION_KINDS = new Set(['cast', 'move'])

/** The empty record — nothing landed, nobody touched, no cell claimed. */
export const empty_cast_resolution = () => ({
  /** did this cast resolve on anything at all. The ONE landing verdict: the whiff line fires on `!landed`, the
   *  impact package (thwack · shake · flash · ripple) fires on `landed`. */
  landed: false,
  /** the cell the caster AIMED at — the chain's own `target_cell`. Where the arc flies; never a landing claim. */
  aim_cell: null,
  /** every entity this cast resolved on, in beat order, deduped. */
  target_ids: [],
  /** the cells it resolved ON — the beat's own cell where it carries one, else the entity's canonical cell,
   *  resolved ONCE here rather than re-read by each consumer at its own moment. */
  target_cells: [],
  /** which resolution kinds answered — the evidence behind `landed`, kept so a test can name the arm. */
  kinds: [],
})

/** Did THIS beat resolve anything? Kind alone cannot say: a fully dodged drain emits a `status` row whose own
 *  `landed` count is 0, and a displacement that never left its cell moved no one. Everything else that reaches
 *  a resolution kind touched something — an absorbed 0-damage hit still connected with a body. */
const beat_resolved = (spec) => {
  const payload = spec?.payload ?? {}
  if (!RESOLUTION_KINDS.has(String(spec?.kind))) return false
  if (spec.kind === 'status' && payload.landed != null) return Number(payload.landed) > 0
  if (spec.kind === 'displacement') return payload.from?.x !== payload.to?.x || payload.from?.y !== payload.to?.y
  return true
}

/** The entity a resolution beat resolved on. A trap PLACEMENT names its caster (`entity_id`); every other kind
 *  names its victim. */
const beat_target_id = (spec) => spec?.payload?.target_id ?? spec?.payload?.entity_id ?? null

/** The cell a resolution beat carries in its OWN payload: the trap/glyph cell, the teleport landing, or — for a
 *  displacement — the cell the body was struck ON, before the push moved it. Null when the beat holds none. */
const beat_cell = (spec) =>
  spec?.kind === 'displacement' ? (spec.payload?.from ?? null) : (spec?.payload?.cell ?? null)

const cell_key = (cell) => `${cell.x},${cell.y}`

/**
 * THE RECORD — a cast beat's resolution, derived once from the source turn's ordered beats.
 *
 * @param {{ kind?: string, payload?: any } | null} cast the cast beat itself (its `payload.effects` are the
 *   status rows it resolves on its own caster, and `payload.target` is the aim)
 * @param {{ kind?: string, payload?: any }[]} [following] the source turn's specs AFTER the cast, in order
 * @param {(entity_id: string) => {x:number,y:number}|null|undefined} [cell_of] the CANONICAL entity-cell lookup
 *   (the projected fighter row / `fight_visible_view.entities[id].cells.display`) — asked once, here, for the
 *   victims whose own beat carries no cell.
 * @returns {ReturnType<typeof empty_cast_resolution>}
 */
export const cast_resolution = (cast, following = [], cell_of = () => null) => {
  if (!cast) return empty_cast_resolution()
  const caster_id = cast.payload?.entity_id ?? null
  const siblings = following ?? []
  const next_action = siblings.findIndex((spec) => ACTION_KINDS.has(String(spec?.kind)))
  // Every claim this cast makes, in beat order: the cast beat's OWN status rows first (a self-buff resolves on
  // the caster with no sibling beat behind it), then the siblings up to the next action.
  const claims = [
    // A status row the cast beat carries names its own subject when it has one — a debuff lands on its victim,
    // a self-buff on the caster. Attributing every one of them to the caster would splash a status cast at the
    // wrong body, which is the same fabricated-position class this record exists to end.
    ...(cast.payload?.effects ?? []).map((effect) => ({
      kind: 'status',
      entity_id: effect?.target_id ?? caster_id,
      cell: null,
    })),
    ...(next_action < 0 ? siblings : siblings.slice(0, next_action))
      .filter(beat_resolved)
      .map((spec) => ({ kind: spec.kind, entity_id: beat_target_id(spec), cell: beat_cell(spec) })),
  ]
  const cells = new Map(
    claims
      .flatMap(({ entity_id, cell }) => {
        const at = cell ?? (entity_id ? cell_of(entity_id) : null)
        return at && Number.isFinite(at.x) && Number.isFinite(at.y) ? [{ x: at.x, y: at.y }] : []
      })
      .map((at) => [cell_key(at), at])
  )
  return {
    landed: claims.length > 0,
    aim_cell: cast.payload?.target ?? null,
    target_ids: [...new Set(claims.map(({ entity_id }) => entity_id).filter(Boolean))],
    target_cells: [...cells.values()],
    kinds: claims.map(({ kind }) => kind),
  }
}
