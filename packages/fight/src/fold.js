// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/fold.js — the PURE fold/merge/base functions behind the store's ONE door (split out of store.js to keep
// each file ≤600 LoC; INC-0). Nothing here reads `get`/`set`: every function is a plain transform over state.
//
// · merge_entries / sorted_log — the keyed `(version, event_idx)` log, order-independent (dedupe / adopt / stale).
// · base_from_view — the snapshot half of snapshot+tail: the adopted rich view → the thin fold base.
// · recompute — snapshot base + sorted authoritative tail → committed state + the derived PROVIDER token.
// · committed_state / presented_state — the two projections the store and its consumers read.
// · wave_turns_of — pace a receipt's non-local raw events into presentation wave turns.
// · foreign_replay_events — chain-shaped raw events for the SPECTATOR REPLAY of a peer's committed turn, derived
//   from the adoption diff (PRESENTATION ONLY — fed to wave_turns_of, never the committed fold).

import { participant_entity_id } from './fight_control.js'
import { apply_action, empty_state, seat_resolver } from './inputs.js'
import * as settle_input from './inputs.js'
import { STATUS_ACTIVE, STATUS_FAILED, STATUS_PLACEMENT, STATUS_WON } from './board_state.js'
import { INVISIBILITY_STATUS_KIND } from './fight_status_snapshot.js'
import { masks_entries, pace_segment } from './present.js'

// Source priority resolves a key collision: an authoritative source ADOPTS over my optimistic intent at the same
// (version, event_idx); a re-delivered lower-or-equal source is idempotent (dedupe / stale drop). V9 (register):
// RECEIPT is the one-way floor (my own tx's proof) — it must never be overridden, so it ranks ABOVE the legacy
// event-shaped `snapshot` segment (the prior order let a snapshot clobber a receipt-proven fact at the same key).
const SOURCE_PRIORITY = { intent: 0, poll: 1, p2p: 1, snapshot: 2, receipt: 3 }
const entry_key = (action) => `${action.version}:${action.event_idx}`
export const sorted_log = (entries) =>
  Object.values(entries).sort((a, b) => a.version - b.version || a.event_idx - b.event_idx)

// TURN-START BUDGET resolver (advisor pass-19): a seat index → its begin_turn refill {ap, mp} = the base pool from
// the current view's escrow. The TurnStarted event omits ap/mp (fight_events.move:24), so normalize_events injects
// this so the fold predicts the refill the instant my turn lands — else the projected budget is the stale pre-refill
// snapshot (0) and the whole turn's move/cast range reads empty (the dead opening click). project.js reconciles to
// the authoritative snapshot ap/mp the moment a post-refill Fight-object read adopts (a drained seat stays correct).
export const base_budget = (view) => (idx) => {
  const p = (view?.escrow ?? [])[idx]
  return p ? { ap: p.base_ap ?? null, mp: p.base_mp ?? null } : null
}

export const last_action_of = (fight, fallback = 0) => {
  const value = Number(fight?.last_action_ms ?? fallback)
  return Number.isFinite(value) ? value : fallback
}

/** Merge new actions into the keyed entry map: keep the higher-priority source per key (adopt / dedupe / stale). */
export const merge_entries = (entries, actions) => {
  const next = { ...entries }
  for (const action of actions) {
    const key = entry_key(action)
    const existing = next[key]
    if (!existing || SOURCE_PRIORITY[action.source] >= SOURCE_PRIORITY[existing.source]) next[key] = action
  }
  return next
}

/** Thin fold base derived from the adopted rich view — the snapshot half of snapshot+tail. */
export const base_from_view = (view, fight_id) => {
  const base = empty_state(fight_id ?? view?.id ?? null)
  if (!view) return base
  const fighters = {}
  for (const p of view.escrow ?? []) {
    const key = `p${p.seat}`
    fighters[key] = { key, is_mob: false, cell: p.cell, hp: p.hp, alive: p.alive, invisible: false, ap: p.ap, mp: p.mp }
  }
  ;(view.mobs ?? []).forEach((m, idx) => {
    const key = `m${idx}`
    fighters[key] = { key, is_mob: true, cell: m.cell, hp: m.hp, alive: m.alive, invisible: false, ap: m.ap, mp: m.mp }
  })
  // Snapshot status rows are entity-mapped OBJECTS { entity_id, kind, remaining_turns, element, value, stat, chance }
  // (fight_status_snapshot.status_snapshot_entities) — was invisibility-only, now every kind. Register #53: map by
  // entity_id, matching a seat via participant_entity_id (its inverse). GROUP them PER FIGHTER as `statuses` (the
  // HUD's effect badges read the whole set via engine_view.effects), and DERIVE `invisible` from a kind-27 row —
  // ONE home, never a second boolean channel duplicating the truth.
  const status_rows = {}
  for (const status of view.invisibility_statuses ?? []) {
    const id = status?.entity_id == null ? '' : String(status.entity_id)
    if (!id) continue
    const seat = (view.escrow ?? []).findIndex((p) => participant_entity_id(p) === id)
    const key = seat >= 0 ? `p${seat}` : id.startsWith('mob-') ? `m${id.slice(4)}` : null
    if (key && fighters[key])
      status_rows[key] = [
        ...(status_rows[key] ?? []),
        {
          kind: Number(status.kind) || 0,
          remaining_turns: Number(status.remaining_turns) || 0,
          element: status.element ?? null,
          value: status.value ?? null,
          stat: status.stat ?? null,
          chance: status.chance ?? null,
        },
      ]
  }
  for (const [key, rows] of Object.entries(status_rows))
    fighters[key] = {
      ...fighters[key],
      statuses: rows,
      invisible: rows.some((row) => row.kind === INVISIBILITY_STATUS_KIND),
    }
  const actor = view.status === STATUS_ACTIVE ? view.turn_queue?.[view.turn_ptr] : null
  const observed_deadline = Number(view.turn_deadline_ms ?? 0)
  return {
    ...base,
    fighters,
    active: actor ? `${actor.is_mob ? 'm' : 'p'}${Number(actor.idx)}` : null,
    turn_deadline_ms: observed_deadline > 0 ? observed_deadline : null,
    turn_deadline_fresh: actor != null && observed_deadline > 0,
    phase: view.status === STATUS_WON ? 'victory' : view.status === STATUS_FAILED ? 'defeat' : 'active',
    winner: view.status === STATUS_WON ? 0 : view.status === STATUS_FAILED ? 1 : -1,
  }
}

// ── V1 · RETIREMENT FLOOR (register V1 · BLANKPAGE §③) ────────────────────────────────────────────────────────
// Death is a FLOORED, append-only retirement — NOT a boolean re-derived from a snapshot's raw hp every recompute.
// `retired` is a durable accumulator `{ fighter_key → floor_version }` (carried through recompute like my_traps),
// appended from AUTHORITATIVE deaths only (a receipt/poll/snapshot Hit→0 or Abandoned; intents never retire — they
// are predictions), and cleared per init. `alive` DERIVES from it: a floor-dead fighter can never resurrect from a
// later higher-version read that carries a positive hp (the resurrection root, symptom ②). Only init clears it; a
// snapshot that contradicts a retirement (alive again at a higher version) is a parity incident — we hold dead.

/** Fold the append-only death floors: base-dead fighters floor at the adopted view's version (their death predates
 *  the base); tail deaths floor at the proving event's version. Idempotent — a key already retired keeps its floor. */
export const derive_retired = (prev, base, authoritative_tail, view_version) => {
  const retired = { ...(prev ?? {}) }
  for (const [key, f] of Object.entries(base.fighters ?? {}))
    if (f.alive === false && retired[key] == null) retired[key] = view_version
  for (const e of authoritative_tail ?? []) {
    const key =
      e.kind === 'Hit' && Number(e.remaining_hp) <= 0
        ? `${e.victim_is_mob ? 'm' : 'p'}${Number(e.victim_idx)}`
        : e.kind === 'Abandoned'
          ? `p${Number(e.seat)}`
          : null
    if (key && retired[key] == null) retired[key] = e.version
  }
  return retired
}

/** Force every retired fighter dead in a committed fighters map — `alive` derives from retirement, never from a
 *  later snapshot's raw hp. A no-op when nothing is retired or every retired key is already dead (the common case);
 *  a retired fighter still carrying positive hp (the contradiction a stale/torn read paints) is clamped to 0/dead. */
export const apply_retirement = (fighters, retired) => {
  if (!fighters || !retired) return fighters
  const stale = Object.keys(retired).filter((key) => {
    const f = fighters[key]
    return f && f.alive !== false
  })
  if (!stale.length) return fighters
  const out = { ...fighters }
  for (const key of stale) {
    const f = out[key]
    out[key] = { ...f, alive: false, hp: f.hp != null && f.hp > 0 ? 0 : f.hp }
  }
  return out
}

/** V2 · A5 OMISSION-HOLD (register V2 · BLANKPAGE A5). A newly-adopted view that does NOT MODEL the status class
 *  (`invisibility_statuses === undefined` — a thinner payload / indexer gap / legacy read) must not DROP a
 *  receipt-floored positive fact: reconstruct the status rows from the prior committed fighters so base_from_view
 *  re-derives them (invisibility/buffs a payload never knew about are HELD, never zeroed). A view that DOES model
 *  the class (any array, INCLUDING []) is authoritative — an absent fighter there is genuinely not-invisible — and
 *  passes through untouched. Backfilling the STORED view (not a per-recompute overlay) makes the hold persist. */
export const carry_statuses = (view, prior) => {
  if (!view || view.invisibility_statuses !== undefined) return view
  const escrow = view.escrow ?? []
  const rows = []
  for (const [key, f] of Object.entries(prior?.fighters ?? {})) {
    const statuses = f.statuses?.length
      ? f.statuses
      : f.invisible
        ? [{ kind: INVISIBILITY_STATUS_KIND, remaining_turns: 1 }]
        : []
    if (!statuses.length) continue
    const entity_id = key[0] === 'm' ? `mob-${key.slice(1)}` : participant_entity_id(escrow[Number(key.slice(1))] ?? {})
    if (!entity_id) continue
    for (const st of statuses)
      rows.push({
        entity_id,
        kind: st.kind,
        remaining_turns: st.remaining_turns ?? 0,
        element: st.element ?? null,
        value: st.value ?? null,
        stat: st.stat ?? null,
        chance: st.chance ?? null,
      })
  }
  return { ...view, invisibility_statuses: rows }
}

/** THE PROVIDER TOKEN (NORTH_STAR consequence 2, verbatim): at any instant exactly ONE provider holds the push
 *  channel. Derived — never a stored latch — from the same wave/turn facts the projections read:
 *   · a non-local (mob/peer) wave is draining → `chain_replay` (the receipt/fight state replays; HUD pushes nothing)
 *   · else it is MY window to push (playable turn OR placement) → `local_turn` (my clicks → the local sim)
 *   · else → `idle_wait` (a peer's turn — nothing until their commit lands, then it becomes chain_replay)
 *  The store's door refuses any input whose provenance doesn't match this token (a logged non-event). */
export const provider_of = ({ presenting, playable, view }) =>
  presenting ? 'chain_replay' : playable || view?.status === STATUS_PLACEMENT ? 'local_turn' : 'idle_wait'

/** PLACEMENT GHOSTS — a peer's uncommitted pick is a cosmetic hint, never a source of truth, so it dies fast:
 *  15s covers a re-pick cadence with headroom while a stale/dead broadcast never lingers into the fight proper. */
export const GHOST_STALE_MS = 15_000

/** Re-fold the committed state from the snapshot base + the sorted tail, and reconcile the turn-floor anchor.
 *  `now` stamps the floor the instant MY turn opens; only the false→true edge re-stamps. */
export const recompute = (draft, now) => {
  const observed_deadline = Number(draft.turn_deadline_ms ?? 0)
  const base = base_from_view(draft.view, draft.fight_id)
  const all_log = sorted_log(draft.entries)
  const log = all_log.filter((e) => e.version > draft.view_version)
  const committed = log.reduce(apply_action, base)
  // V1: append-only death floors, carried forward (base-dead at view_version + authoritative tail deaths at their
  // own version). Intents never retire (predictions). `alive` derives from this — apply_retirement below overrides
  // any later positive-hp read for a floor-dead fighter (the resurrection root).
  const retired = derive_retired(
    draft.retired,
    base,
    log.filter((e) => e.source !== 'intent'),
    draft.view_version
  )
  const authoritative_log = all_log.filter((e) => e.version >= draft.view_version && e.source !== 'intent')
  const last_version = authoritative_log.length ? authoritative_log[authoritative_log.length - 1].version : -1
  const applied_version = Math.max(draft.view_version, last_version)
  const settlement = settle_input.reconcile_settlement(draft.settlement, base, authoritative_log, draft)
  let { turn_started_at, my_turn_no = 0 } = draft
  const my_turn = committed.active != null && committed.active === draft.my_key
  // PLAYABLE-turn anchor + TURN-END DISARM share ONE boundary. The SINGLE-PTB fold resolves my-end→mob-wave→my-next
  // -turn in ONE receipt, so `committed active` never leaves me (my_turn stays true ALL fight) — a
  // `my_turn && !was_my_turn` edge fires only ONCE (turn 1). Key off the PLAYABLE rising edge instead — my turn AND
  // no non-local (mob) wave draining — cleared while a wave presents / off-turn, re-stamped the instant it drains.
  // The SAME gate disarms a stale spell (else it casts on the first click of a fresh turn); my OWN casts are LOCAL
  // waves (is_local) → they never trip it.
  const presenting = (draft.wave ?? []).some((t) => !t.is_local)
  const playable = my_turn && !presenting
  // MY SEAT-TURN COUNTER (cast.move `seat_turn` twin, the cooldown gate's clock): bumped EXACTLY on the PLAYABLE
  // rising edge — the SAME false→true boundary turn_started_at stamps, so it is DEADLINE-INDEPENDENT (a starved /
  // stale / zero chain deadline still counts my turn). Placement never counts (active is null there → playable
  // false); session-init resets it to 0 via empty_fight. This replaces the old DungeonBoard bump that fired only
  // on a POSITIVE, CHANGED turn_deadline_ms — under lag that guard froze the counter while last_cast_turn advanced,
  // pinning every cd>0 spell on-cooldown forever (register #34: a side-store clock derived from a transport edge).
  if (playable && turn_started_at == null) {
    turn_started_at = now
    my_turn_no += 1
  }
  if (!playable) turn_started_at = null
  const armed_spell_id = playable ? draft.armed_spell_id : null
  // Chain timestamps are monotonic within one Fight. A version-inflated but semantically stale object may prune a
  // fresher TurnStarted tail; preserve the greatest observed chain deadline without synthesising a client deadline.
  const turn_deadline_ms = Math.max(observed_deadline, Number(committed.turn_deadline_ms ?? 0)) || null
  const provider = provider_of({ presenting, playable, view: draft.view })
  // ④+⑦b TRAP SPRING (durable, receipt-proven): a `my_traps` cell detonates → mark `gone` FOREVER (never regress a
  // receipt-proven fact; the optimistic spring is engine_view's reversible presented-occupied exclusion). Already-
  // gone rows keep identity. A trap fires ON-CHAIN only when a fighter ENTERS its cell (spell_board::on_enter), and
  // movement/displacement TRUNCATE on the first trap (movement.move:32-39 · reduce.js:415-423) — so a fired trap
  // ALWAYS leaves its trigger STANDING (or dead) on the cell. The ONE proof "this trap fired": a COMMITTED
  // (intents-EXCLUDED) fighter now OCCUPIES the cell — the force-stop LANDING, the same matches_trap(to_cell) signal
  // pace_segment fires the trap_trigger render beat on (fight_render_events). LEG E — the chain corrects
  // the fight and shows the trap as already triggered: the landing counts DEAD too — a push that
  // KILLS the mob ON the trap leaves a receipt-proven corpse on the cell, a detonation exactly like a live stop;
  // filtering `f.alive` here excluded that corpse and resurrected a lethal trap. Traps land ONLY on EMPTY cells
  // (free_cell — spell_target.move:46 · spell_targeting.js:95), so an occupant can only have ENTERED: zero standing
  // false-positives for the point-trap corpus.
  // NO version-bump proxy (RESIDUAL FIX, v1.12.34: trap reconciliation between sim and
  // chain still drifted): a routine poll re-reads the Fight OBJECT and bumps view_version — that is NOT a firing. The removed
  // `superseded` predicate retired EVERY placed trap on the next snapshot, so the sim door stopped predicting its
  // force-stop/damage while the chain kept it armed (and, dual-home, a re-cast then aborted ECellAlreadyTrapped and
  // nuked the whole batch). Truncation-stops makes it redundant: a real crossing leaves an occupant `detonated`
  // already catches, from any path (receipt tail OR a wholesale snapshot's standing base). Fight.fx is dropped from
  // reads, so my_traps only RETIRES on this proof — it errs toward "it stays".
  const detonated = new Set(
    Object.values(committed_state(draft).fighters ?? {})
      .filter((f) => f.cell != null)
      .map((f) => f.cell)
  )
  const my_traps = (draft.my_traps ?? []).map((t) =>
    t.gone ? t : t.cells.some((c) => detonated.has(c)) ? { ...t, gone: true } : t
  )
  // GLYPH EXPIRY (persistent, NOT detonated): unlike a trap, a glyph is never sprung by a fighter standing on it
  // (check_glyphs ticks + persists). It dies only by decay_glyphs — so decrement turns_remaining on each of MY
  // turn-advances (the my_turn_no rising edge = the ONE clean client turn signal; the client has no chain glyph
  // read, so this errs toward persistence — "it stays"). At 0 it's gone forever. Already-gone kept.
  const glyph_turn_advanced = my_turn_no > (draft.my_turn_no ?? 0)
  const my_glyphs = (draft.my_glyphs ?? []).map((g) => {
    if (g.gone) return g
    const turns_remaining = glyph_turn_advanced ? g.turns_remaining - 1 : g.turns_remaining
    return turns_remaining <= 0 ? { ...g, turns_remaining: 0, gone: true } : { ...g, turns_remaining }
  })
  // PLACEMENT GHOSTS GC (durable accumulator, same class as my_traps/my_glyphs above): a committed Placed for a
  // character SUPERSEDES (drops) any ghost recorded for them FOREVER — the chain truth is now real, the hint's
  // job is done. Scanned off `log` (this recompute's own authoritative tail — never `source: 'intent'`, i.e.
  // never MY OWN optimistic Placed), so this is a fast-path; a peer whose commit never produced a discrete event
  // on this client (e.g. baked straight into an adopted snapshot) still falls to the GHOST_STALE_MS floor below.
  const placed_characters = new Set(
    log.filter((e) => e.kind === 'Placed' && e.source !== 'intent').map((e) => String(e.character))
  )
  const placement_ghosts = Object.fromEntries(
    Object.entries(draft.placement_ghosts ?? {}).filter(
      ([character, ghost]) => !placed_characters.has(character) && now - ghost.at < GHOST_STALE_MS
    )
  )
  // #170 OPTIMISTIC-DEATH LATCH — an INTENT-predicted death is (by design) never floored into `retired`: intents
  // are predictions. But a version-inflated yet semantically STALE poll (it read the Fight OBJECT before my commit
  // landed, mob still alive) purges the intent and the corpse STANDS BACK UP — then dies a SECOND time when my
  // commit receipt confirms the kill (the double-death, 3rd recurrence). This TRACKS every optimistic death (key →
  // the receipt_seq it was predicted under) and CARRIES it across the intent-purging poll; `receipt_seq` advances
  // ONLY on a receipt (never a poll), so a stale poll cannot clear it, and MY-TURN RECEIPT releases it — a CONFIRMED
  // kill then rides `retired` (dropped here as redundant), a MISPREDICTED one (a resisted survivor the raw-base
  // prediction over-killed — apply_resistance shaves chain damage) evaporates. The latch is only APPLIED to the eye
  // (project engine_view.dead) while a commit is IN-FLIGHT (`busy`): with NO commit pending a fresh chain read that
  // lacks the kill is AUTHORITATIVE and must restore the mob (a reverted/force-passed tx — kill_adoption LEG A), so
  // gating the hold on `busy` is what distinguishes "the kill is coming" from "the kill never landed". Presentation
  // only — committed/targeting read the honest fold, so a held corpse is never castable.
  const optimistic_dead = {}
  for (const [key, entry] of Object.entries(draft.optimistic_dead ?? {}))
    if (entry.seq === draft.receipt_seq && retired[key] == null) optimistic_dead[key] = entry
  for (const [key, f] of Object.entries(committed.fighters ?? {}))
    if (f.alive === false && retired[key] == null && optimistic_dead[key] == null)
      optimistic_dead[key] = { seq: draft.receipt_seq }
  return {
    ...draft,
    ...committed,
    fighters: apply_retirement(committed.fighters, retired),
    retired,
    optimistic_dead,
    settlement,
    applied_version,
    log,
    turn_started_at,
    my_turn_no,
    armed_spell_id,
    turn_deadline_ms,
    provider,
    my_traps,
    my_glyphs,
    placement_ghosts,
  }
}

/** Snapshot + authoritative tail, excluding this client's optimistic intents. V1: `alive` derives from the
 *  retirement floor here too, so targeting / victory / tackle can never see a floor-dead fighter resurrected. */
export const committed_state = (s) => {
  const base = base_from_view(s.view, s.fight_id)
  const log = sorted_log(s.entries ?? {}).filter((e) => e.version > s.view_version && e.source !== 'intent')
  const committed = log.reduce(apply_action, base)
  return { ...committed, fighters: apply_retirement(committed.fighters, s.retired) }
}

/** Fold keys `p{seat}`/`m{idx}` whose KILLING damage beat still rides an UNACKED wave turn — the same wave fact
 *  project.death_presenting_ids reads for `engine_view.dead`, expressed in fold-key space (fold.js can't import
 *  project.js). #170 (5th recurrence): there is no separate 'death' beat kind anymore (the presenter derives the
 *  death visual from the presented-state edge, not an event-shaped beat) — hold on the 'damage' beat that carries
 *  `killed`, read straight off its source Hit (`victim_is_mob`/`victim_idx` → the key), so no entity resolver is
 *  needed. A masked killing Hit means the fighter is still ALIVE at pre-death HP in the re-fold; these keys mark
 *  "its death is presenting RIGHT NOW", distinct from an already-presented death. */
export const death_presenting_keys = (wave) => {
  const keys = new Set()
  for (const t of wave ?? [])
    for (const b of t.beats ?? []) {
      const e = b.kind === 'damage' && b.payload?.killed ? b.payload?.source_event : null
      if (e && e.victim_idx != null) keys.add(`${e.victim_is_mob ? 'm' : 'p'}${Number(e.victim_idx)}`)
    }
  return keys
}

/** The wave-masked fold behind BOTH projections below: base view + tail with every still-unacked window's
 *  entries removed; my own segments and every acked turn's events show instantly — hold-at-last-shown with
 *  per-turn reveal (the D115 guarantee, rebuilt on the log). Never folds from empty: if the adopted view ever
 *  reaches a version the mask can no longer straddle (the deferral in the snapshot door makes this
 *  unreachable), committed truth shows — an early reveal over a rollback, never a regression.
 *  `hold_intents` is the ONE axis the two projections differ on (see presented_state / display_state). */
const wave_masked_fold = (s, hold_intents) => {
  const pending = (s.wave ?? []).filter(masks_entries) // non-local turns + MY windowed displacement/walk legs
  if (!pending.length) return s
  const windowed = pending.filter((t) => t.from_idx != null)
  if (s.view != null && windowed.length && !(s.view_version < Math.min(...windowed.map((t) => t.version)))) return s
  const masked = (e) =>
    windowed.some((t) => e.version === t.version && e.event_idx >= t.from_idx && e.event_idx <= t.until_idx)
  const base = base_from_view(s.view, s.fight_id)
  const log = (s.log ?? []).filter((e) => (e.source === 'intent' && !hold_intents) || !masked(e))
  // V1 · RETIREMENT FLOOR — the re-fold reads the RAW view base, so it must re-apply the append-only death floor
  // exactly as committed_state does. Without it a floor-dead fighter RESURRECTS in the eye's projection whenever a
  // masking wave drains over a version-inflated-but-stale view that still carries it alive — the corpse stands up,
  // then dies a SECOND time when the wave acks (the double-death). The floor holds authoritative deaths only
  // (intents never retire), so a live prediction is untouched; the death-present HOLD stays owned by
  // project.death_presenting_ids (engine_view.dead), never by this fold's `alive`.
  //
  // #8 · DEATH-PRESENTING HP HOLD — but a fighter whose killing beat is STILL PRESENTING (its Hit sits inside a
  // masked window, so the re-fold already holds it alive at pre-death HP) must NOT be floored here: flooring snaps
  // its card HP to 0 seconds before the death floater lands (engine_view.dead already holds the visual death via
  // the same wave fact). It dies exactly when its beat acks — the turn drains, the key leaves this set, the floor
  // binds. Every OTHER retired fighter still floors (the #134 stale-resurrection of an ALREADY-presented death).
  const folded = log.reduce(apply_action, base)
  const presenting = death_presenting_keys(s.wave)
  const floor = presenting.size
    ? Object.fromEntries(Object.entries(s.retired ?? {}).filter(([key]) => !presenting.has(key)))
    : s.retired
  return { ...s, ...folded, fighters: apply_retirement(folded.fighters, floor) }
}

/** The EFFECTIVE projection — legality, budget, tackle reach read it. My own INTENTS paint first (prediction
 *  never waits on a beat), so a drafted move's destination is live THIS fold even while its walk still plays. */
export const presented_state = (s) => wave_masked_fold(s, false)

/** The DISPLAY projection — the rendered fighter CELL reads it (board_view / engine_view). Identical to
 *  presented_state EXCEPT a WINDOWED intent is HELD: a local walk's Moved intent has nothing to predict-paint
 *  but the walk itself, so the pre-move cell holds until the walk beat presents (§7b — never an insta-jump,
 *  the SNAP-THEN-RUN fix). Non-local moves are already receipt-masked here exactly as in presented. */
export const display_state = (s) => wave_masked_fold(s, true)

/** Pace a receipt's raw events into wave turns (non-local only — my own turn already painted optimistically).
 *  Runs on the PRE-receipt draft, so every resolver reads the state the eye currently sees:
 *   · resolve_fighter_id — seat → the REAL entity id (character id / 'mob-N'), never a 'player-N' default
 *   · fighter_cells      — an entity's pre-receipt cell (real move paths instead of single-cell teleports)
 *   · resolve_cast       — the chain Cast carries NO spell id, so the presentation constants are the spec
 *     (old fight_bridge.js:885): 'mob_attack_dungeon' for a mob, 'dungeon_strike' for a seat
 *  Locality is decided by SEAT (R1): my segments never enter the paced wave, whatever id string they produced.
 *  Each turn carries its raw-receipt event-index window [from_idx, until_idx] — the presented fold
 *  (presented_state) hides exactly the entries inside a still-unacked window. */
export const wave_turns_of = (draft, raw_events, version, trap_cells = []) => {
  const ctx = draft.ctx ?? {}
  if (!Array.isArray(raw_events) || !raw_events.length || !ctx.beat_ctx) return []
  const my_entity = ctx.my_entity_id ?? null
  const escrow = draft.view?.escrow ?? []
  const my_seat = settle_input.actor_from_key(draft.my_key)?.idx ?? seat_resolver(draft.view)(my_entity)
  const grid_w = Number(ctx.beat_ctx.grid_width) || 20
  const resolve_fighter_id = ({ is_mob, idx, character }) =>
    character != null
      ? String(character)
      : is_mob
        ? `mob-${Number(idx)}`
        : (participant_entity_id(escrow[Number(idx)] ?? {}) ?? `player-${Number(idx)}`)
  const cell_of = (key) => {
    const encoded = draft.fighters?.[key]?.cell
    return encoded == null ? null : { x: Number(encoded) % grid_w, y: Math.floor(Number(encoded) / grid_w) }
  }
  const fighter_cells = (source_id) => {
    const id = String(source_id)
    if (id.startsWith('mob-')) return cell_of(`m${id.slice(4)}`)
    const seat = escrow.findIndex((p) => participant_entity_id(p) === id)
    return seat >= 0 ? cell_of(`p${seat}`) : null
  }
  const committed = committed_state(draft)
  const fighter_health = (source_id) => {
    const id = String(source_id)
    if (id.startsWith('mob-')) return committed.fighters?.[`m${id.slice(4)}`]?.hp ?? null
    const seat = escrow.findIndex((p) => participant_entity_id(p) === id)
    return seat >= 0 ? (committed.fighters?.[`p${seat}`]?.hp ?? null) : null
  }
  const resolve_cast = (event) => ({ spell_id: event.caster_is_mob ? 'mob_attack_dungeon' : 'dungeon_strike' })
  // R1 — locality by SEAT: a turn is LOCAL iff its author is my seat (character match, or a non-mob idx equal
  // to my seat index). Produced id strings never decide locality again.
  const is_local = (turn) => {
    const src = turn.source ?? null
    if (!src) return false
    if (src.character != null) return my_entity != null && String(src.character) === String(my_entity)
    return !src.is_mob && my_seat != null && Number(src.idx) === Number(my_seat)
  }
  const { turns } = pace_segment(
    raw_events,
    {
      fight_id: draft.fight_id,
      ...ctx.beat_ctx,
      trap_cells,
      resolve_fighter_id,
      fighter_cells,
      fighter_health,
      resolve_cast,
      // Board terrain facts, straight off the adopted view (board_state.js decode) — feeds present.js's
      // obstacle-aware move-path reconstruction (mob-crossed-obstacle bug, design ruling 2026-07-19). Same pattern as
      // trap_cells above: this module forwards raw facts, present.js/fight_render_prims.js own the interpretation.
      obstacles: draft.view?.obstacles,
      holes: draft.view?.holes,
      shape_mask: draft.view?.shape_mask,
      board_width: draft.view?.width,
      board_height: draft.view?.grid_height,
    },
    { is_local }
  )
  // Only bookkeeping beats ⇒ no 3s slot (skipped mob / terminal marker / a peer's bare turn-open handoff).
  // By beat KIND, never post-rescale duration — the all-instant spread inflates a lone bookkeeping beat to the
  // whole slot, so a duration test lied TRUE: every peer paid a phantom 3s wave per handoff (coop red, 07-17).
  const presentable = (t) => t.beats.some((b) => !['turn_start', 'turn_end', 'turn_skip', 'fight_end'].includes(b.kind))
  const idx_window = (t) => {
    const idxs = t.beats.map((b) => b.payload?.source_event?.event_index).filter((n) => Number.isFinite(n))
    return idxs.length
      ? { from_idx: Math.min(...idxs), until_idx: Math.max(...idxs) }
      : { from_idx: null, until_idx: null }
  }
  // ③b DEDUPE (ruled 07-19): the prediction already predicted + slid MY OWN turn's displacement (client-
  // independence). A receipt displacement_leg whose every slide MATCHES the already-presented predicted
  // displacement (same victim + same landing cell) is redundant — DISCARD it (no double-play). A MISMATCH
  // plays the leg as the correction: chain truth adopts, never regressing a receipt-proven fact.
  const presented = presented_state(draft) // reflects MY prediction (intents not yet purged at receipt time)
  const leg_matches_prediction = (t) => {
    const slides = t.beats.filter((b) => b.kind === 'displacement')
    if (!slides.length) return false
    return slides.every((b) => {
      const e = b.payload?.source_event
      if (!e || e.to_cell == null) return false
      const key = `${e.target_is_mob ? 'm' : 'p'}${Number(e.target_idx)}`
      return presented.fighters?.[key]?.cell === Number(e.to_cell)
    })
  }
  // a LOCAL row survives only as its displacement LEG (present.js) — the rest of my turn painted at click —
  // and only when that leg is NOT already what the prediction presented (③b dedupe).
  return turns
    .filter((t) => (t.is_local ? t.displacement_leg && !leg_matches_prediction(t) : presentable(t)))
    .map((t, i) => ({
      seq: draft.wave_seq + 1 + i,
      version,
      source_id: t.source_id,
      is_local: !!t.is_local,
      duration: t.duration,
      beats: t.beats,
      ...idx_window(t),
    }))
}

/** SPECTATOR REPLAY — other players' actions render instantly, using the SAME sequences a local turn uses,
 *  including kills, which must show live during the replay, never delayed. A peer's committed
 *  turn reaches this client ONLY as the poll's wholesale Fight OBJECT (no events) — so DERIVE chain-shaped raw events
 *  for the OTHER fighters' committed changes from the adoption diff (prev committed fighters → the incoming snapshot's
 *  fighters). The result feeds wave_turns_of → the SAME paced beat pipeline the local player + mobs use; the wholesale
 *  view then adopts AFTER the replay drains. PRESENTATION ONLY: the committed fold is NEVER built from this diff — the
 *  deferred wholesale read is the authoritative adopt (inputs.js law: the client never snapshot-diffs STATE).
 *
 *  Moves are emitted per FOREIGN mover (my own move is predicted, never spectator-paced). Damage is emitted for ANY
 *  fighter that lost HP (a mob striking ME is a foreign action worth a floater). A damaging turn is VOICED as its
 *  mover's Cast so the replay carries the SAME walk/cast/damage/death sequence classes the local path emits; with no
 *  identifiable foreign mover the damage rides bare Hits (a paced 'fight' turn — floater + death, no cast animation).
 *  Only cell/hp deltas drive it; ap/mp/status differences adopt wholesale (no spurious replay). @returns raw events. */
export const foreign_replay_events = (
  prev,
  next,
  { escrow = [], my_key = null, fight_id = null, presented_dead = null } = {}
) => {
  const ev = (kind, json) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: fight_id, ...json } })
  const prev_f = prev?.fighters ?? {}
  const next_f = next?.fighters ?? {}
  const move_of = (key) =>
    key[0] === 'm'
      ? ev('MobMoved', { idx: Number(key.slice(1)), to_cell: Number(next_f[key].cell) })
      : ev('Moved', { character: escrow[Number(key.slice(1))]?.character ?? null, to_cell: Number(next_f[key].cell) })
  const moved = []
  const hits = []
  for (const key of Object.keys(next_f).sort()) {
    const a = prev_f[key]
    if (!a) continue // a fresh roster row (a mid-fight join) is not a committed move
    const b = next_f[key]
    const is_mob = key[0] === 'm'
    if (key !== my_key && a.cell != null && b.cell != null && Number(a.cell) !== Number(b.cell)) moved.push(key)
    // V10 · DEATH-BEAT DEDUP (register V10): a target the eye ALREADY saw die (`presented_dead` — my own optimistic
    // kill, already presented) must not have its death REPLAYED by a foreign snapshot that merely CONFIRMS it
    // (symptom ② REPLAYED die animation). Skip the HP-loss emit for such a target — its floored death adopts
    // wholesale after the replay drains (V1), so no state is lost; only the redundant die-beat is suppressed. Death
    // is terminal within a fight (a revive is a parity incident, rejected on adopt), so the target key IS the
    // (target, floor-version) identity here — a fighter dies at most once per fight.
    if (a.hp != null && b.hp != null && Number(b.hp) < Number(a.hp) && !(presented_dead && presented_dead.has(key)))
      hits.push(
        ev('Hit', {
          victim_is_mob: is_mob,
          victim_idx: Number(key.slice(1)),
          amount: Number(a.hp) - Number(b.hp),
          remaining_hp: Number(b.hp),
        })
      )
  }
  if (!moved.length && !hits.length) return []
  // The actor a damaging turn's Cast is voiced by: the first foreign PLAYER that moved (a peer's turn is the
  // headline), else the first mover of any kind (a lone mob strike falls to the mob). Its move opens the turn so
  // the cast + hits group INTO it (produce_receipt_render_turns); the remaining movers trail as their own turns.
  const actor_key = moved.find((k) => k[0] === 'p') ?? moved[0] ?? null
  const cast =
    actor_key && hits.length
      ? [ev('Cast', { caster_is_mob: actor_key[0] === 'm', caster_idx: Number(actor_key.slice(1)) })]
      : []
  return [
    ...(actor_key ? [move_of(actor_key)] : []),
    ...cast,
    ...hits,
    ...moved.filter((k) => k !== actor_key).map(move_of),
  ]
}

/** The SPECTATOR REPLAY wave turns for adopting `candidate` over `draft` — the diff (foreign_replay_events) paced
 *  through wave_turns_of. COOP ONLY: fires solely when a PEER seat exists; in a SOLO fight the mob wave rides MY OWN
 *  receipt (committed already reflects it), so a snapshot delta is a reconcile, never an unseen foreign turn — []
 *  there means "adopt wholesale, exactly as before" (the keystone / trap-transit / resume reconciles depend on it). */
export const foreign_replay_turns = (draft, candidate, version, trap_cells = []) => {
  const my_seat = draft.my_key && draft.my_key[0] === 'p' ? Number(draft.my_key.slice(1)) : -1
  if (my_seat < 0 || !(candidate.escrow ?? []).some((_, seat) => seat !== my_seat)) return []
  // V10: the presented-retirement cursor — every target the eye already saw die (my optimistic kills INCLUDED,
  // since presented_state folds intents). foreign_replay_events skips re-emitting a death for these (no double
  // die-animation); the candidate still adopts wholesale afterward, so committed truth is unaffected.
  const presented = presented_state(draft)
  const presented_dead = new Set(
    Object.entries(presented.fighters ?? {})
      .filter(([, f]) => f.alive === false)
      .map(([key]) => key)
  )
  const raw = foreign_replay_events(committed_state(draft), base_from_view(candidate, draft.fight_id), {
    escrow: candidate.escrow ?? [],
    my_key: draft.my_key,
    fight_id: draft.fight_id,
    presented_dead,
  })
  return raw.length ? wave_turns_of(draft, raw, version, trap_cells) : []
}
