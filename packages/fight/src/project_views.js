// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/project_views.js — pure legacy-shaped board and engine projections.

import { GRID_W, GRID_H, decode as decode_xy } from './los.js'
import { identity_book } from './identity_book.js'
import { mob_entity_id, participant_entity_id } from './fight_control.js'
import { claimed_budget_state, committed_truth, display_state, presented_state } from './store.js'
import { STATUS_ACTIVE, STATUS_FAILED, STATUS_PLACEMENT, STATUS_ROOM_CLEARED, STATUS_WON } from './board_state.js'
import { fight_fingerprint } from './fingerprint.js'
import { trap_render_prims, trap_visible_to } from './fight_render_prims.js'
import { entity_vitals } from './vitals_record.js'
import {
  deep_freeze,
  input_armed,
  visible_controls,
  visible_entities,
  visible_mount,
  visible_result,
  visible_sync,
  visible_turn,
} from './visible_facts.js'
import {
  DUNGEON_BOARD_ORIGIN,
  cast_presenting,
  chain_terminal_status,
  deadline_starved,
  decided_outcome,
  presenting,
  settlement_request,
  turn_playable,
} from './project_state.js'

// The END-TURN PRESS LAW moved next to the projections it gates (#1993 train 0 — the view's `turn.input_armed`
// and control-phase verdict call the one home). Re-exported verbatim: every importer reads them from here.
export { input_armed, turn_input_armed } from './visible_facts.js'
// THE ROSTER IDENTITY BOOK (#1993 WP3) — identity is resolved once, in identity_book.js, and this projection is
// one of its readers rather than a second resolver. Re-exported so a consumer reaches the book and the one label
// rule through the same door it already imports the projections from.
export { identity_book, identity_label, short_display_id } from './identity_book.js'

/** Fighters whose killing damage beat is unacked. This masks rendered liveness only; targeting remains committed. */
const death_presenting_ids = (s) => {
  const ids = new Set()
  for (const t of s.wave ?? [])
    for (const b of t.beats ?? [])
      if (b.kind === 'damage' && b.payload?.killed && b.payload?.target_id) ids.add(b.payload.target_id)
  return ids
}

const seat_key = (seat) => `p${seat}`
const mob_key = (idx) => `m${idx}`

/** entity id → thin-fold key, built once per projection off the adopted board. Roster ORDER is presentation
 *  metadata and never a join key (#1608) — the seat index / mob index is. */
const fold_keys_by_entity = (view) => {
  const keys = new Map()
  for (const [seat, row] of (view?.escrow ?? []).entries()) {
    const entity_id = participant_entity_id(row)
    if (entity_id) keys.set(entity_id, seat_key(seat))
  }
  for (const [idx] of (view?.mobs ?? []).entries()) keys.set(mob_entity_id(idx), mob_key(idx))
  return keys
}

const positive_delta = (value, base) => {
  const delta = Number(value) - Number(base)
  return Number.isFinite(delta) ? Math.max(0, delta) : 0
}

/** MP from this seat's still-live prediction rows. Unlike a spell-template/cast-path sum this is keyed by the
 * core's per-cast intent batches, so M2b claim retirement removes exactly the confirmed cast and leaves unrelated
 * pending grants intact. @param {any[]} log @param {number} seat */
const drafted_mp_grant = (log, seat) =>
  (log ?? []).reduce(
    (sum, e) =>
      e.source === 'intent' &&
      e.kind === 'Granted' &&
      Number(e.point_kind) === 1 &&
      !e.target_is_mob &&
      Number(e.target_idx) === seat
        ? sum + (Number(e.granted) || 0)
        : sum,
    0
  )

/** A mob's authoritative HP: snapshot + peer/receipt tail, with this client's optimistic intents excluded. */
export const committed_mob_hp = (state, idx) => committed_truth(state).fighters?.[mob_key(idx)]?.hp ?? null

/** Entity id of a thin-fold key (`p0` → the seat's character id, `m2` → `mob-2`), resolved through the view. */
export const entity_id_of_key = (view, key) => {
  if (!key || !view) return null
  if (key[0] === 'm') return mob_entity_id(key.slice(1))
  const row = view.escrow?.[Number(key.slice(1))]
  return row ? (participant_entity_id(row) ?? null) : null
}

/** The board terrain for the arena — canonical GRID, non-walkable = 1: obstacles ∪ holes ∪ OUT-OF-BOARD.
 *  Out-of-board = beyond the true grid dims OR outside the stored shape mask (a shaped board carves the
 *  canonical window — e.g. an octagon's corners). BOOT22 dead-click root: this projection used to leave
 *  out-of-shape cells 0 ("walkable"), so an arena consumer could aim at a cell the board never built —
 *  board_picking correctly nulls there (D75: void cells are never pickable), a silent dead click. One home
 *  for walkability truth: the arena gates on the SAME shape (dims + mask) the rendered board is built from. */
export const project_board_cells = (view) => {
  // D771 (no invented dims): a dims-less view — the OPEN roam plane carries no BoardGeom by design — has NO
  // tactical arena; every canonical cell stays non-walkable (1) instead of fabricating a phantom full
  // GRID_W×GRID_H walkable board. A real fight view carries positive dims → identical clamping as before.
  const raw_w = Number(view.grid_width)
  const raw_h = Number(view.grid_height)
  const width = raw_w > 0 ? Math.min(raw_w, GRID_W) : 0
  const height = raw_h > 0 ? Math.min(raw_h, GRID_H) : 0
  const mask = view.shape_mask // canonical in-shape cell Set (board_state decode) — absent = full-rect board
  const cells = new Array(GRID_W * GRID_H).fill(1)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const idx = y * GRID_W + x
      if (!mask || mask.has(idx)) cells[idx] = 0
    }
  for (const idx of view.obstacles ?? []) if (idx >= 0 && idx < cells.length) cells[idx] = 1
  for (const idx of view.holes ?? []) if (idx >= 0 && idx < cells.length) cells[idx] = 1
  return cells
}

/** Fold-derived lifecycle status: the view's chain status advanced by any fresher folded events. */
const projected_status = (s) => {
  const view_status = s.view?.status ?? STATUS_ACTIVE
  const { run = null, rooms_total = 0 } = s.ctx ?? {}
  if (s.winner === 0) return run && rooms_total > 0 && (run.room ?? 1) < rooms_total ? STATUS_ROOM_CLEARED : STATUS_WON
  if (s.winner === 1) return STATUS_FAILED
  // A folded TurnStarted while the snapshot still says placement = the chain activated under us.
  if (view_status === STATUS_PLACEMENT && s.active != null) return STATUS_ACTIVE
  return view_status
}

/**
 * The legacy `dungeon` view — the adopted board snapshot with the presented fold overlaid on its rows.
 * DungeonBoard / phase.js / dungeon_dimension / the board adapter read exactly this shape (fight_view's
 * contract, preserved verbatim through the flip).
 */
export const board_view = (s) => {
  const { view } = s
  if (!view) return null
  const p = presented_state(s)
  const d = display_state(s) // DISPLAY cell only — holds an in-flight walk at its pre-move cell (SNAP-THEN-RUN)
  const c = committed_truth(s)
  const budget = claimed_budget_state(s)
  const escrow = (view.escrow ?? []).map((row, seat) => {
    const cf = c.fighters?.[seat_key(seat)]
    const bf = budget.fighters?.[seat_key(seat)]
    const canonical_ap = cf?.ap ?? row.ap
    const canonical_mp = cf?.mp ?? row.mp
    const budget_ap = bf?.ap ?? canonical_ap
    const budget_mp = bf?.mp ?? canonical_mp
    // The seat's CHAIN-COMMITTED anchor (my drafted intents excluded): the pool DungeonBoard's draft math
    // subtracts its OWN cast_path/move_path ledger from. Accepted chain-silent point grants join ONLY the AP/MP
    // budget: their Cast/sibling claim is authoritative enough for legality, but they remain outside canonical
    // history. `pending_mp` is the exact per-intent remainder after M2b claim retirement; DungeonBoard uses it
    // instead of correlating an aggregate claimed delta against spell templates.
    // Cell/HP remain strictly canonical. Never use the presented values below — those already fold the draft's
    // ap_cost/mp_left intents, so budgeting against them counts every queued action TWICE (gate9 P1).
    const f = p.fighters?.[seat_key(seat)]
    // THE VITALS RECORD (#1993 WP7) — health and liveness are folded ONCE, in vitals_record.js, and this
    // legacy-shaped board projection reads that fold. It used to re-derive both beside `engine_view`'s copy.
    const v = entity_vitals(row, cf, f)
    const committed = {
      ap: budget_ap,
      mp: budget_mp,
      claimed_ap: positive_delta(budget_ap, canonical_ap),
      claimed_mp: positive_delta(budget_mp, canonical_mp),
      pending_mp: drafted_mp_grant(s.log, seat),
      cell: cf?.cell ?? row.cell,
      hp: v.committed,
      alive: v.alive,
    }
    if (!f) return { ...row, committed }
    return {
      ...row,
      committed,
      // The rendered cell is the DISPLAY fold — my own walk holds at its pre-move cell until the walk beat
      // presents (never jumps ahead of the run); every other fact stays the effective/presented value.
      cell: d.fighters?.[seat_key(seat)]?.cell ?? f.cell ?? row.cell,
      hp: v.presented,
      alive: v.presented_alive,
      ready: f.ready ?? row.ready,
      // TURN-START BUDGET: the fold's predicted begin_turn refill wins over the stale pre-refill snapshot; row.ap/mp
      // is the authoritative fallback (a post-refill read prunes the overlay → f.ap/mp go null → the snapshot shows).
      ap: f.ap ?? row.ap,
      mp: f.mp ?? row.mp,
    }
  })
  const mobs = (view.mobs ?? []).map((row, idx) => {
    const cf = c.fighters?.[mob_key(idx)]
    const f = p.fighters?.[mob_key(idx)]
    const v = entity_vitals(row, cf, f) // the ONE health/liveness fold (#1993 WP7)
    const committed = { cell: cf?.cell ?? row.cell, hp: v.committed, alive: v.alive }
    if (!f) return { ...row, committed }
    const cell = d.fighters?.[mob_key(idx)]?.cell ?? f.cell ?? row.cell // DISPLAY cell (walk-hold); rest presented
    return { ...row, committed, cell, hp: v.presented, alive: v.presented_alive }
  })
  return {
    ...view,
    escrow,
    mobs,
    status: projected_status(s), // committed fold decides terminal truth (never hangs on presentation)
    chain_terminal: chain_terminal_status(s),
    // The dialog OPEN gate (shape ②): client-knowable, receipt-proven fight-over — the terminal effect fires
    // claim() off THIS the instant the killing receipt folds, so a lagged settle never dead-airs a won fight.
    decided_winner: decided_outcome(s),
    settlement_request: settlement_request(s),
    // Local receipt evidence is published beside, never inside, the viewer-free committed fighter image.
    post_commit_budget: s.my_key ? (s.post_commit_budget?.[s.my_key] ?? null) : null,
    turn_deadline_ms: s.turn_deadline_ms ?? view.turn_deadline_ms,
    // The CHAIN turn-seed inputs travel with the view, the same way the deadline does — every crit/tackle
    // preview surface composes its clock from this projection. Read off the VIEW only: `s.turn_ordinal` is a
    // different fact under the same name — the core fold's turn ANCHOR token (a string) — and seeding a
    // preview with it would diverge from the chain. `engine_view.turn_ordinal` is that anchor; this is the seed.
    turn_entropy: view.turn_entropy,
    turn_ordinal: view.turn_ordinal,
  }
}

/**
 * The FightSlice shape (fighters Map, turn/placement machine, ready set) — projected from the PRESENTED
 * state. Every HUD consumer reads it SYNCHRONOUSLY via `useFightView()` / `fight_view()` (the memoized
 * doors below) — the async game-core mirror is dead. `roster` (my kiosk characters) resolves the local seat
 * names; its ONE home is the core's own ctx (`ctx.roster`, pumped by the fight edge module on sui_data), the
 * param remains as a pure-injection override for tests/board_fight_authority.
 */
export const engine_view = (s, { roster = s.ctx?.roster ?? [] } = {}) => {
  const { view } = s
  if (!view) return null
  const p = presented_state(s)
  const d = display_state(s) // DISPLAY cell only — an in-flight walk holds at its pre-move cell (SNAP-THEN-RUN)
  const c = committed_truth(s)
  const death_hold = death_presenting_ids(s) // liveness-only mask: dead presents at the killing turn's ack
  // LEG P — while a peer/mob replay drains, the HP NUMBER must hold with the beat: the turn card only updates
  // once the vfx ends. THE VITALS RECORD (#1993 WP7) owns that fold now, once, for every reader: the legacy
  // field names below are pure DERIVATIONS of `vitals_record.js` and no longer a second derivation beside it.
  const wave_presenting = presenting(s)
  /** This fighter's vitals record — every health and liveness field on the row below is read off it. */
  const vitals_of = (key, snapshot, fold, committed_fold, entity_id) =>
    entity_vitals(snapshot, committed_fold, fold, {
      presenting: wave_presenting,
      death_held: death_hold.has(entity_id),
      optimistic_dead: !!s.busy && s.optimistic_dead?.[key] != null,
    })
  // LEG Q — every active fighter status (was invisibility-only) as the effect-badge array: raw chain ints, one home
  // (the fold's per-fighter `statuses`); `invisible` stays derived from a kind-27 row. Badges read this via engine_view.
  const effects_of = (fighter) =>
    (fighter?.statuses ?? []).map((st, i) => ({
      id: `${st.kind}:${i}`,
      kind: st.kind,
      remaining_turns: st.remaining_turns,
      element: st.element,
      value: st.value,
      stat: st.stat,
      chance: st.chance,
      source: st.source ?? null,
      ...(st.flags != null ? { flags: st.flags } : {}),
    }))
  const ctx = s.ctx ?? {}
  // THE ROSTER IDENTITY BOOK (#1993 WP3) — every fight-visible identity fact, id-keyed, resolved ONCE before this
  // projection reads any of it. This function no longer chooses between name sources; it looks a row up. The
  // injected `roster` override stays the door tests/board_fight_authority use, so it enters the book as the ctx.
  const book = identity_book(view, { ...ctx, roster })
  const map = new Map()
  const ready = new Set()
  for (const [seat, row] of (view.escrow ?? []).entries()) {
    const entity_id = participant_entity_id(row)
    if (!entity_id) continue
    const post_commit = s.post_commit_budget?.[seat_key(seat)] ?? null
    const f = p.fighters?.[seat_key(seat)] ?? {}
    const cf = c.fighters?.[seat_key(seat)] ?? {}
    const identity = book[entity_id]
    const v = vitals_of(seat_key(seat), row, f, cf, entity_id)
    if (f.ready ?? row.ready) ready.add(entity_id)
    map.set(entity_id, {
      id: entity_id,
      owner: identity.owner,
      character_id: identity.character_id,
      // The book's ONE label rule (`name ?? display_id`). The owner-address slice that used to sit here is gone:
      // an address is not an identity (#929), and it was one of the three substitutes the same absent row got.
      name: identity.label,
      identity_resolved: identity.resolved,
      team: identity.team,
      // DISPLAY cell — my own walk holds at its pre-move cell until the walk beat presents (the rig follows
      // the run, never teleports to the target ahead of it); health/ap/mp stay the effective/presented fold.
      cell: decode_xy(d.fighters?.[seat_key(seat)]?.cell ?? f.cell ?? row.cell),
      health: v.presented,
      presented_health: v.display,
      committed_health: v.committed,
      committed_alive: v.alive,
      committed_dead: !v.alive,
      health_max: v.max,
      effects: effects_of(f),
      base_range: row.base_range ?? 0,
      // THE SEAT'S COMPOSED BUILD (#1077) — the ONE object the predict path reads its inputs from: the locked
      // stat snapshot the reducer takes as this fighter's `stats` (it re-adds the timed rows itself from
      // `effects`) and the seat's learned spell levels per SpellTemplate object id. Every fight surface that
      // predicts, prices or ranges a cast derives from THIS, never from a per-surface subset.
      base_stats: row.base_stats ?? {},
      spell_levels: row.spell_levels ?? {},
      // TURN-START BUDGET: the fold predicts the begin_turn refill so the budget paints the instant it's my turn
      // (the TurnStarted event omits ap/mp); the snapshot row.ap/mp reconciles the moment a post-refill read adopts.
      post_commit_ap: post_commit?.ap ?? null,
      post_commit_mp: post_commit?.mp ?? null,
      post_commit_version: post_commit?.version ?? null,
      ap: f.ap ?? row.ap,
      ap_max: row.base_ap,
      mp: f.mp ?? row.mp,
      mp_max: row.base_mp,
      level: identity.level,
      is_player: true,
      dead: !v.display_alive,
      class_id: identity.class_id,
      sex: identity.sex,
      male: identity.male,
      hue: identity.hue,
      colors: identity.colors,
      invisible: !!f.invisible,
    })
  }
  ;(view.mobs ?? []).forEach((m, i) => {
    const entity_id = mob_entity_id(i)
    const f = p.fighters?.[mob_key(i)] ?? {}
    const cf = c.fighters?.[mob_key(i)] ?? {}
    // The book resolved this mob's species and name already (world identity roster → its own chain template;
    // never the shared group template, #1865). The renderer uses `identity_resolved` to keep the honest id text
    // on its built-in capsule without requesting the fake hy__missing GLB.
    const identity = book[entity_id]
    const v = vitals_of(mob_key(i), m, f, cf, entity_id)
    map.set(entity_id, {
      id: entity_id,
      variant: identity.template,
      name: identity.label,
      identity_resolved: identity.resolved,
      team: identity.team,
      cell: decode_xy(d.fighters?.[mob_key(i)]?.cell ?? f.cell ?? m.cell), // DISPLAY cell (walk-hold)
      health: v.presented,
      presented_health: v.display,
      committed_health: v.committed,
      committed_alive: v.alive,
      committed_dead: !v.alive,
      health_max: v.max,
      effects: effects_of(f),
      base_range: m.base_range ?? 0,
      // the TARGET's locked block — its resistances are an input to my own predicted damage (#1077)
      base_stats: m.base_stats ?? {},
      ap: m.ap ?? 0,
      ap_max: m.base_ap ?? 0,
      mp: m.mp ?? 0,
      mp_max: m.base_mp ?? 0,
      level: identity.level,
      is_player: false,
      dead: !v.display_alive,
      element: identity.element,
      invisible: !!f.invisible,
    })
  })
  const status = projected_status(s)
  const placement = status === STATUS_PLACEMENT
  const address = ctx.address ?? null
  const spectator = ctx.spectator === true
  const viewer_seat =
    !spectator && typeof s.my_key === 'string' && s.my_key.startsWith('p') ? Number(s.my_key.slice(1)) : null
  const viewer_context = {
    seat: viewer_seat,
    team: viewer_seat == null ? null : Number(view.escrow?.[viewer_seat]?.team),
  }
  const controlled_entity_ids = spectator
    ? []
    : (view.escrow ?? [])
        .filter((row) => address && String(row.addr) === String(address))
        .map(participant_entity_id)
        .filter(Boolean)
  const my_entity_id = spectator
    ? null
    : (entity_id_of_key(view, s.my_key) ?? ctx.my_entity_id ?? controlled_entity_ids[0] ?? null)
  const active_entity_id = entity_id_of_key(view, c.active)
  // ④+⑦b THE LIVE trap projection — ONE ledger (#1858). `s.my_traps` already holds the public board (adopted in
  // the fold) alongside this client's own placements, so paint, prediction and cast-legality are three reads of
  // one list rather than two homes racing: the sim door reads canonical lifecycle immediately, the render overlay
  // keeps a canonically-consumed row visible only until its own ordered trigger beat presents, and NOTHING reads
  // `ctx.chain_traps` — a raw read is not a render source. Neither position nor turn advancement participates.
  // The visibility predicate crosses ONCE, here: an enemy's trap is unknowable to paint AND to prediction (a
  // locally-placed row is this viewer's team by construction; an adopted row carries the board's owner_team).
  const ledger = (s.my_traps ?? []).map((trap) =>
    trap.owner_team == null ? { ...trap, owner_team: viewer_context.team } : trap
  )
  const known_traps = ledger.filter((trap) => trap_visible_to(viewer_context, trap))
  const live_traps = known_traps.filter((trap) => !trap.gone)
  const visible_traps = known_traps.filter((trap) => !trap.gone || !trap.presented)
  const my_trap_cells = [
    ...new Set(
      live_traps
        .flatMap((trap) => trap.cells ?? [])
        .map(Number)
        .filter(Number.isFinite)
    ),
  ]
  const trap_prims = trap_render_prims(viewer_context, visible_traps)
  // ① each LIVE trap cell → its detonation payload, so the sim door rebuilds the trap WITH damage (not payload:[]).
  // Same canonical live-cell predicate as my_trap_cells (non-gone); first record wins a shared cell.
  // my_traps itself stays a flat encoded-cell list — the payload rides this parallel channel.
  const my_trap_payloads = {}
  for (const trap of live_traps) {
    for (const cell of [...new Set((trap.cells ?? []).map(Number).filter(Number.isFinite))]) {
      if (cell in my_trap_payloads) continue
      my_trap_payloads[cell] = trap.payload ?? []
    }
  }
  // THE LIVE glyph zone projection — every non-gone glyph's full AoE, deduped (the render paints these as the
  // persistent orange ground zone). Unlike traps there is NO occupied-cell exclusion: a glyph is not sprung by a
  // fighter standing on it (check_glyphs persists), so the zone stays lit under whoever walks through it.
  const my_glyph_cells = [...new Set((s.my_glyphs ?? []).filter((g) => !g.gone).flatMap((g) => g.cells ?? []))]
  // PLACEMENT GHOSTS — peers' uncommitted picks (p2p cosmetic hint), gated to the placement phase itself: once
  // the fight leaves placement (projected_status flips to STATUS_ACTIVE — see `placement` above) this reads []
  // even a tick before the fold's own GC catches up, so "on fight start" never depends on GC timing.
  const placement_ghosts = placement
    ? Object.entries(s.placement_ghosts ?? {}).map(([character, g]) => ({ character, cell: g.cell }))
    : []
  // A peer pick is an uncommitted p2p cosmetic hint. Overlay it only on the render-facing fighter Map: canonical,
  // presented and board projections keep the chain cell, so the hint cannot reserve a cell or affect simulation.
  for (const { character, cell } of placement_ghosts) {
    const fighter = map.get(character)
    if (fighter) map.set(character, { ...fighter, cell: decode_xy(cell) })
  }
  return {
    fight_id: s.core.fight_id,
    my_traps: my_trap_cells,
    trap_prims,
    my_trap_payloads,
    my_glyphs: my_glyph_cells,
    placement_ghosts,
    arena: { width: GRID_W, height: GRID_H, cells: project_board_cells(view) },
    origin: DUNGEON_BOARD_ORIGIN,
    fighters: map,
    turn_order: (view.turn_queue ?? [])
      .map((a) => (a.is_mob ? mob_entity_id(a.idx) : participant_entity_id(view.escrow?.[a.idx] ?? {})))
      .filter(Boolean),
    active_entity_id,
    turn_ordinal: c.turn_ordinal ?? null,
    fingerprint: fight_fingerprint(s.core),
    // R4 — the PRESENTATION clock's actor: the head unacked non-local wave turn (a real entity id — 'mob-N'
    // or a character id). Null while nothing drains. The chain clock (active_entity_id) is untouched.
    presenting_entity_id: (s.wave ?? []).find((t) => !t.is_local)?.source_id ?? null,
    my_entity_id,
    controlled_entity_ids,
    active_controlled_character_id:
      active_entity_id && controlled_entity_ids.includes(active_entity_id) ? active_entity_id : null,
    spectator,
    hand: s.hand ?? [],
    draft_count: s.staged?.length ?? 0,
    deck_size: 0,
    discard_size: 0,
    ap_reserve: 0,
    // The committed SeatTurnKey twin: each accepted player TurnStarted advances this in the canonical fold, so a
    // WORLD journal page that commits a whole round cannot hide the edge by beginning and ending playable.
    turn_number: c.fighters?.[s.my_key]?.turn_number ?? 0,
    // The presentation/playable edge clock stays separate for cooldown UI and local-turn gating.
    my_turn_no: s.my_turn_no ?? 0,
    winner: s.winner ?? -1,
    placement,
    placement_deadline_ms: view.placement_deadline_ms ?? 0,
    turn_ms: view.turn_ms ?? 0,
    // BOTH declared zones (#1093): the board paints my band and the opposing one, and placement_click gates on
    // mine — a team whose zone the projection drops is a bare board (PvM's enemy band) or a dead click (a PvP
    // team-1 seat). The chain stores both sides; this reads them, it never assumes the PvM side.
    placement_cells: placement
      ? { 0: (view.start_cells_a ?? []).map(decode_xy), 1: (view.start_cells_b ?? []).map(decode_xy) }
      : { 0: [], 1: [] },
    turn_deadline_ms: s.turn_deadline_ms ?? view.turn_deadline_ms ?? 0,
    deadline_starved: deadline_starved(s),
    ready,
    armed_spell_id: s.armed_spell_id ?? null,
    hovered_spell_id: s.hovered_spell_id ?? null,
    summary: null,
    presenting: presenting(s),
    // THE TURN-HANDOVER FACT (#1808) — my turn is genuinely mine (chain seat ⋀ nothing replaying ⋀ the chain's
    // own mob-resolution budget spent). The board's input gate, the END TURN control and the "your turn" cue all
    // mount on THIS single projected fact; `presenting` alone let the client outrun the chain and grant a turn
    // it then had to hold back.
    playable: turn_playable(s),
    // THE ARMING DOOR, PROJECTED (#1993 WP2b) — `turn_playable ⋀ !is_over`, off the ONE predicate
    // (`visible_facts.input_armed`, the same home `fight_visible_view.turn.input_armed` calls). DungeonBoard
    // used to spell this conjunction itself off the PRE-#1808 boundary (`active_entity_id === me ⋀ !presenting`),
    // which armed the whole affordance while the chain was still spending the mob budget its own deadline was
    // widened by. Edge `busy` stays the consumer's to AND in — the run store's single-flight is wider than the
    // core's (engage/place/settle) and remains an edge input until its family migrates.
    input_armed: input_armed(s),
    // MP-ZONE MISCLICK GUARD — projected so DungeonBoard's click gate (`reachable`) reads the SAME
    // fact move_wash suppresses on, never a second UI-side flag (see cast_presenting's doc above).
    cast_presenting: cast_presenting(s),
  }
}

// ── THE ONE PROJECTION (#1993, train 0) ───────────────────────────────────────────────────────────────────────
// `fight_visible_view(state)` — every fight-visible FACT (turn · entities · result · sync · mount · controls)
// under one immutable object, so a surface selects a narrow key instead of joining three stores. Train 0 ships
// the SHAPE at CURRENT PARITY: every field is the value today's fragment already produces (the derivation is
// moved in or CALLED — `engine_view` / the `project_state` predicates / `project_hud` are its fragments, and
// they stay exported and working). NO new reconciliation lives here; fold-first migrations are later trains.
// Design review constraint ①: PURE over the fold's state — no store, no subscription, no write door, memoized
// on STATE IDENTITY ONLY (the WeakMap below), which is exactly why a recompute from the same raw state is
// deep-equal to the served view (the standing acceptance assert). The SHAPE is here, in the projections' one
// home; the per-fact record builders sit beside it in visible_facts.js for the ≤600-LoC cap (store.js/fold.js).

/**
 * The six-fact fight-visible view. Never null: a session with no adopted board still answers `mount`/`sync`
 * honestly (fight id known, board not here yet) instead of forcing every caller to invent that state.
 * @param {any} s the fight store state
 */
const build_visible_view = (s) => {
  const view = s?.view ?? null
  const engine = view ? engine_view(s) : null
  const committed = committed_truth(s)
  // The ONE identity resolution, shared by both readers: `engine_view` above built its rows off this same book.
  const entities = visible_entities(s, engine, fold_keys_by_entity(view), identity_book(view, s?.ctx ?? {}))
  const active_entity_id = engine?.active_entity_id ?? null
  const status = view ? projected_status(s) : null

  // THE SHAPE — one key per fight-visible fact, each built by exactly one builder beside this file.
  return {
    turn: visible_turn(s, engine, committed, status),
    entities,
    result: visible_result(s, status),
    sync: visible_sync(s, active_entity_id, entities),
    mount: visible_mount(s, engine),
    controls: visible_controls(s, engine, active_entity_id, entities),
  }
}

// State identity is the ONLY memo key (design review constraint ①). The fight store publishes a NEW state object
// per input, so a stale view is unrepresentable; a WeakMap keeps a dead fight's projection from outliving it.
const VISIBLE_VIEWS = new WeakMap()

/**
 * THE fight-visible view — one immutable object owning all six fight-visible facts. Pure: same state in, the
 * same (deep-equal) view out, no store read beside it and no write door.
 * @param {any} s the fight store state
 */
export const fight_visible_view = (s) => {
  if (s == null || typeof s !== 'object') return deep_freeze(build_visible_view({}))
  if (!VISIBLE_VIEWS.has(s)) VISIBLE_VIEWS.set(s, deep_freeze(build_visible_view(s)))
  return VISIBLE_VIEWS.get(s)
}
