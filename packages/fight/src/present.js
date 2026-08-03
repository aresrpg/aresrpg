// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/present.js — the ONE presentation queue: it PACES the ordered log for the eye; it never owns state.
//
// The committed state is armed the instant the log folds (store.js). Presentation is a SEPARATE cursor over that
// same log: my own actions play at 0 delay (prediction — my cast's VFX the frame I click), and each NON-LOCAL
// (mob / peer) turn is paced so the eye can read it.
//
// MOB PACING: 3s per mob turn — alone against 6 mobs, that's 3×6. So each mob turn presents over ~3s; a 6-mob wave totals ~18s, each
// mob's beats readable inside its own ~3s slot. This reuses the PROVEN render producer verbatim
// (fight_render_events.produce_receipt_render_turns) — only the per-turn TIMING is rescaled here.

import { produce_receipt_render_turns } from './fight_render_events.js'

export const MOB_TURN_MS = 3000

/** Rescale one turn's beats so they span exactly `total_ms` — INTRA-SEGMENT ORDERING LAW (the ≥1s-late
 *  floater fix): a turn SHORTER than its slot keeps every beat at its NATURAL duration
 *  (the damage floater starts at the cast's real impact pace, never a stretched offset) and the LAST beat
 *  absorbs the slot's slack, so the turn still occupies exactly `total_ms` (the tuned wave length is
 *  untouched). A turn LONGER than the slot compresses proportionally (long walks must fit the tuned slot).
 *  All-instant beats (raw sum 0) spread evenly so the slot is still ~total_ms (never a zero-length mob turn). */
const rescale = (beats, total_ms, start_at) => {
  const raw_total = beats.reduce((sum, b) => sum + (b.duration || 0), 0)
  const natural = raw_total > 0 && raw_total <= total_ms
  // The slack lands on the last beat WITH DURATION — never a trailing zero-length bookkeeping marker
  // (turn_end/fight_end). Else the marker fires at raw_total and the slot's tail is DEAD AIR the §7b twin
  // convicts (E10 'below' at 1750, E8 'above' on the following handoff — acceptance-pack red, 2026-07-18).
  const absorb = natural ? beats.findLastIndex((b) => (b.duration || 0) > 0) : -1
  let at = start_at
  const out = beats.map((b, i) => {
    const duration = natural
      ? (b.duration || 0) + (i === absorb ? total_ms - raw_total : 0)
      : raw_total > 0
        ? Math.round((b.duration / raw_total) * total_ms)
        : Math.round(((i + 1) / beats.length) * total_ms) - Math.round((i / beats.length) * total_ms)
    const spec = { ...b, at, duration }
    at += duration
    return spec
  })
  return { beats: out, end_at: at }
}

/** Does this wave turn still HOLD the board, or does it only decorate it? A `fold_inert` turn (#2124) is
 *  PRESENTATION-OWED: the adopted snapshot already contains every row it explains, so it can neither mask an
 *  entry (there is no log row left to mask — the same reason `wave_masked_fold` refuses to rewind below its own
 *  base), nor hold a death, nor spend my turn clock gating me on a beat about state the board already shows.
 *  It plays, and that is all it does. Every "is the wave still holding something" question reads this. */
export const holds_the_fold = (turn) => turn?.fold_inert !== true

/** A wave turn whose entry WINDOW must mask the committed fold until it presents: every non-local
 *  (receipt-paced) turn, plus MY OWN windowed displacement leg — is_local for the input law (my leg never
 *  disarms me), yet its `Displaced` entries must not fold ahead of the slide (§7b: never an insta-jump).
 *  Local INTENT turns carry no window and never mask (prediction paints first). */
export const masks_entries = (turn) => holds_the_fold(turn) && (!turn.is_local || turn.from_idx != null)

/**
 * Pace a log segment for playback. Reuses `produce_receipt_render_turns` (grouping + beat build) and only
 * rescales timing: local turns → instant (0), each non-local turn → `mob_turn_ms`. Wave duration = mob_turn_ms ×
 * (number of non-local turns), so 6 mobs alone = 18s.
 *
 * DISPLACEMENT LEG (§7b push grammar; found 2026-07-17: on-chain pushes were not rendering correctly):
 * MY OWN receipt turn is prediction-painted EXCEPT its victims' slides — the click's synthetic beats never
 * carry a `Displaced`. So a local turn's `displacement` beats (+ the trap boom a slide detonates, + the
 * `teleport_arrival` puff a blink lands) are split into their OWN local turn at NATURAL
 * per-cell pace (E7 — the reference slide, DISPLACEMENT_CELL_MS), flagged `displacement_leg`; the store windows
 * it so the presented fold holds each victim at the pre-push cell until the slide plays. A teleport's own
 * `displacement` is itself instant (0ms — register #26), so the leg's real length comes from its
 * `teleport_arrival` beat: without it the leg used to degenerate to a 0/0 turn. Beats re-anchor at 0: the render
 * queue clocks `at` from the turn's OWN head.
 * @param {any[]} raw_events  chain events ({ type, parsedJson })
 * @param {object} ctx        forwarded to produce_receipt_render_turns (fight_id / resolvers / grid_width /
 *   obstacles / holes / shape_mask / board_width / board_height — the last five feed the obstacle-aware move
 *   -path reconstruction; absent ⇒ the prior straight-line reconstruction, unchanged)
 * @param {{ mob_turn_ms?: number, is_local?: (turn: { source_id: string,
 *   source: {is_mob?:boolean, idx?:number, character?:string}|null }) => boolean }} [opts]
 */
export const pace_segment = (raw_events, ctx = {}, { mob_turn_ms = MOB_TURN_MS, is_local = () => false } = {}) => {
  const { turns } = produce_receipt_render_turns(raw_events, ctx)
  // EVERY turn's beats anchor at ITS OWN head (at 0) — the render queue clocks each enqueued turn from its own
  // start (fight_render_queue run_event: `turn_started_at + slot.at`), so a segment-absolute `at` makes every
  // turn after the first WAIT ITS OWN OFFSET AGAIN (turn N plays (N−1)×slot late — the multi-mob dead-air
  // class, caught red by envelopes_7b E8 3001ms). Turns are serial by construction: consumers order by row and
  // sum `duration`; the displacement leg already anchored at 0 for exactly this contract.
  const paced = turns.flatMap((turn) => {
    const local = is_local(turn)
    const total_ms = local ? 0 : mob_turn_ms
    const { beats } = rescale(turn.events, total_ms, 0)
    const row = { source_id: turn.source_id, source: turn.source ?? null, is_local: local, duration: total_ms, beats }
    if (!local) return [row]
    const slide = turn.events.filter(
      (b) => b.kind === 'displacement' || b.kind === 'trap_trigger' || b.kind === 'teleport_arrival'
    )
    if (!slide.length) return [row]
    const slide_ms = slide.reduce((sum, b) => sum + (b.duration || 0), 0)
    return [row, { ...row, displacement_leg: true, duration: slide_ms, beats: rescale(slide, slide_ms, 0).beats }]
  })
  return {
    turns: paced,
    total_duration: paced.reduce((sum, t) => sum + t.duration, 0),
    beats: paced.flatMap((t) => t.beats),
  }
}

/** How many non-local turns a paced segment holds — its wave length in mob turns (each ≈ mob_turn_ms). */
export const wave_turn_count = (paced) => paced.turns.filter((t) => !t.is_local).length

// ── LOCAL (optimistic) beats — my own click's presentation, playing THIS frame at natural durations ─────────

/** A synthetic chain-shaped Cast (+Displaced +Hit) raw-event set for MY optimistic cast — the SAME beat producer
 *  then builds its presentation, so prediction and receipt playback share one pipeline (no second beat vocabulary).
 *  `displacements`: [{ is_mob, idx, from_cell, to_cell, effect_kind, requested }] — a TELEPORT self-move or a
 *  PUSH/PULL slide, shaped exactly like the chain's `Displaced` event so it renders the movement beat (E7 slide).
 *  `victims`: [{ is_mob, idx, amount, remaining_hp }] — `amount` is the HP-before-clamped damage floater and
 *  `remaining_hp` the deterministic client-computed post-hit HP. The confirmed receipt path applies the same
 *  clamp from its pre-receipt fighter-health resolver.
 *  Order = [Cast, …Displaced, …Hit]: the Cast opens the caster's turn, the position/damage effects flush into
 *  it (produce_receipt_render_turns `pending`) — the exact emitter order a real cast receipt carries. */
export const synthetic_cast_events = ({
  fight_id,
  caster_is_mob = false,
  caster_idx = 0,
  target_cell = null,
  displacements = [],
  victims = [],
}) => [
  {
    type: '0x0::fight_events::Cast',
    parsedJson: { fight: fight_id, caster_is_mob, caster_idx, target_cell },
  },
  ...displacements.map((d) => ({
    type: '0x0::fight_events::Displaced',
    parsedJson: {
      fight: fight_id,
      target_is_mob: d.is_mob,
      target_idx: d.idx,
      kind: d.effect_kind, // decodes to `effect_kind` (push/pull/teleport mechanics code)
      from_cell: d.from_cell,
      to_cell: d.to_cell,
      requested: d.requested ?? 0,
      blocked: 0,
    },
  })),
  ...victims.map((v) => ({
    type: '0x0::fight_events::Hit',
    parsedJson: {
      fight: fight_id,
      victim_is_mob: v.is_mob,
      victim_idx: v.idx,
      amount: v.amount,
      remaining_hp: v.remaining_hp,
      caster_is_mob,
      caster_idx,
    },
  })),
]

/** A synthetic Moved raw event for MY optimistic walk. `path` (decoded cells) rides the beat ctx. */
export const synthetic_move_events = ({ fight_id, character, to_cell }) => [
  { type: '0x0::fight_events::Moved', parsedJson: { fight: fight_id, character, to_cell } },
]

/** A synthetic chain-shaped Tackled raw event for MY optimistic DENIED move (the no-walk law) — the SAME
 *  beat producer then builds the hit-anim + pool-forfeit floater, so the prediction and the receipt playback
 *  share ONE pipeline (no second beat vocabulary). ap_lost/mp_lost are the exact chain forfeit (next_move_tackle
 *  → tackle_losses); num/den are omitted (the beat prices nothing, it only voices the loss). */
export const synthetic_tackled_events = ({
  fight_id,
  runner_is_mob = false,
  runner_idx = 0,
  ap_lost = 0,
  mp_lost = 0,
}) => [
  {
    type: '0x0::fight_events::Tackled',
    parsedJson: { fight: fight_id, runner_is_mob, runner_idx, ap_lost, mp_lost },
  },
]

/** Build MY intent's presentation beats at NATURAL durations (no wave rescale — a local action starts this
 *  frame and plays at clip pace). Returns the flat beat list the store appends as a local wave turn. */
export const local_intent_beats = (raw_events, ctx = {}) => {
  const { turns } = produce_receipt_render_turns(raw_events, ctx)
  return turns.flatMap((t) => t.events)
}

/** MY optimistic MOVE beats — the drafted PATH rendered THIS frame. The render producer's `move_path` option is
 *  a RESOLVER `(event, source_id, known_from, to) => cells|null` invoked PER Moved event — so the single already
 *  known path is handed over as a resolver (`() => path`), NEVER the raw array (a raw array is "called" as
 *  move_path?.(event,…) → the S2 flip's "instance of Array" crash). ONE home for the local-move beat build so a
 *  call site can't re-break the resolver contract. An UNKNOWN path is `null`, never `[]` — empty means absent
 *  on both sides of this seam (#1649), so the producer reconstructs the walk instead of rendering one hop
 *  through the nearest wall. */
export const local_move_beats = ({ fight_id, character, to_cell, path = null }) =>
  local_intent_beats(synthetic_move_events({ fight_id, character, to_cell }), { fight_id, move_path: () => path })

/** The status effects a rendered 'cast' beat carries — a pure read of the beat's source event, for the render
 *  adapter's badge/vfx binding. Lives on the presentation surface (not the receipt→wave producer) so the beat
 *  emitters stay import-confined to the presenter seam (the presenter-beat-boundary arch gate, #281). */
export const fight_cast_beat_effects = (source_event) =>
  (source_event?.effects ?? []).filter((effect) => effect?.status)
