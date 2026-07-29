// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEV-ONLY BOT SEAM (#1100) — the doors a SCRIPTED fight bot needs and the #1028 seams do not open.
// Sibling of dev_cast.js / dev_probe.js: same DEV gate, same registrar pattern, same live-module closures
// (a Playwright-side `import('/src/…')` binds a DEAD second Vite instance — the documented dev_probe trap),
// same `__ARES_DEV_` prefix the bundle gate (scripts/assert_clean_bundle.mjs) fails any production build on.
//
// WHY TWO MORE DOORS (each closes a hole the bot cannot play around, not a convenience):
//
//   1. __ARES_DEV_READ() — the WHOLE fight as plain JSON. `__ARES_DEV_STATE` was built for a human driver's
//      eyes: it carries my vitals and the world's `dungeon.mobs` slice, but no AP, no per-fighter statuses,
//      no board mask, and no spell book — so a policy reading it cannot check reach, price a cast, see a
//      buff it already applied, or know a trap spell exists. This projects the SAME `fight_view()` every
//      surface already reads, plus the caster's book off `resolve_class_spells` (the one resolver the spell
//      bar itself reads). It DECIDES nothing and WRITES nothing.
//
//   2. __ARES_DEV_TURN(actions) — one PLAYER-SHAPED turn. `__ARES_DEV_MOVE` and `__ARES_DEV_CAST` each
//      commit a whole turn holding exactly ONE action, so a bot could never move-then-cast the way a player
//      does (the turn PTB closes with `act_pass` — sim_chain `commands_from_staged`), and `__ARES_DEV_CAST`
//      refuses any cell with no living fighter on it, which makes a TRAP (a `free_cell` spell, cast on the
//      empty approach path) impossible to land through it at all. This stages the batch DungeonBoard's
//      `on_end_turn` stages and routes it through the SAME `use_dungeon.commit_turn` door the End Turn
//      button presses. No second commit path, no rule of its own — an illegal action is refused by the
//      authority exactly as it refuses the button.
//
// It returns the READ from both sides of the commit, which is what makes per-action assertion possible at
// all: the bot compares its planned delta against the folded truth instead of trusting an `ok: true`. Since
// #1144 it also returns the PREDICTION BANK — what the client's own `predict_cast` said each cast would do,
// recorded before the authority was asked. Prediction is the only fact a post-commit read cannot recover, and
// without it every "parity" assertion in this rig compares the chain against itself.
//
//   3. __ARES_DEV_PLACE(cell) — commit the PLACEMENT the world surface opens every fight with (`turns::place`,
//      place + READY in one signature, the last ready auto-starting the fight). The simulator writes its
//      placements straight into its own setup store, so the sim bot never sees this phase; a WORLD fight cannot
//      be played without it, and no other seam signs it.
//
//   4. __ARES_DEV_ABANDON() — forfeit the live fight. What makes a CHAIN-backed rig repeatable: a fight the bot
//      opens and walks away from keeps its character escrowed, and every later run then finds nothing to claim
//      and no way to say why.
//
// EVERY DOOR HERE WORKS ON BOTH SURFACES, and that is a constraint, not an observation: this module is loaded by
// the simulator's registrar too, so anything it imports enters the SIMULATOR's fight closure. The world-only
// JOIN door therefore lives in its own module (dev_world_entry.js) — see the reasoning in its header, and
// scripts/zero-drift-gate.mjs for the tooth that enforces it.

import { decode, encode } from '@aresrpg/fight/los'
import { board_view, fight_view, min_turn_left, my_action_slot } from '@aresrpg/fight/project'
import { participant_entity_id } from '@aresrpg/fight/fight_control'
import { fight_store } from '@aresrpg/fight/store'
import { crit_clock_of, predict_cast } from '@aresrpg/fight/predict_cast'

import { use_dungeon } from '../../world-shell/dungeon_store.js'
import { fight_spell, resolve_class_spells, seat_spell_level, seat_spell_row } from '../screens/hud/fight-spells.js'
import { resolve_dungeon_ref } from '../screens/hud/target_prediction_core.js'
import { use_dungeon_turn } from '../screens/dungeon-turn.js'
import { context } from '../store.js'

const MOVE_KIND = 0 // dungeon_turn.move apply_move — the on-chain action tag
const CAST_KIND = 1
const STATUS_ACTIVE = 1

/**
 * THE COMMITTED OVERLAY — why the bot cannot assert on `engine_view` alone. Its `cell`/`health` are the
 * DISPLAY/PRESENTED fold: my own walk HOLDS at its pre-move cell until the walk beat plays (SNAP-THEN-RUN),
 * and a wave's HP numbers tick with the vfx. A read taken the instant a commit returns would therefore show
 * a move that "did not happen" and damage that "did not land" — both false FAILs. `board_view` already
 * publishes the settled fold per fighter as `committed { cell, hp, alive, ap, mp }`; this is that projection,
 * keyed by entity id, so every assertion below reads CHAIN TRUTH and nothing waits on an animation.
 * @returns {Map<string, any>}
 */
const committed_by_id = () => {
  const board = board_view(fight_store.getState())
  const map = new Map()
  if (!board) return map
  for (const row of board.escrow ?? []) {
    const id = participant_entity_id(row)
    if (id) map.set(id, row.committed ?? null)
  }
  ;(board.mobs ?? []).forEach((row, index) => map.set(`mob-${index}`, row.committed ?? null))
  return map
}

/** A fighter row → plain JSON (no Map, no class instance) the policy can reason over unchanged. */
const fighter_row = (f, committed) => ({
  id: f.id,
  team: f.team,
  name: f.name,
  cell: f.cell ? { x: f.cell.x, y: f.cell.y } : null,
  hp: f.health,
  hp_max: f.health_max,
  ap: f.ap,
  ap_max: f.ap_max,
  mp: f.mp,
  mp_max: f.mp_max,
  dead: !!f.dead,
  is_player: !!f.is_player,
  level: f.level ?? 1,
  class_id: f.class_id ?? null,
  base_range: f.base_range ?? 0,
  // SETTLED TRUTH (see committed_by_id) — what every assertion reads. `cell` above is the eye's cell.
  cell_committed: committed?.cell == null ? null : decode(Number(committed.cell)),
  hp_committed: committed?.hp ?? f.health,
  alive_committed: committed?.alive ?? !f.dead,
  ap_committed: committed?.ap ?? f.ap,
  mp_committed: committed?.mp ?? f.mp,
  // THE COMPOSED BUILD (#1077) — the locked stat snapshot the authority resolves with and the seat's learned
  // spell levels, both already riding the fight view. Published because a bot that cannot see the build cannot
  // PREDICT anything: the prediction bank below runs the same `predict_cast` the floaters do, and a prediction
  // fed a level-1 empty-stat read would diverge from the chain on every cast for a reason that is not the game's.
  base_stats: f.base_stats ?? {},
  spell_levels: f.spell_levels ?? {},
  // the LIVE status rows (project.js `effects_of`) — raw chain kinds, so a buff the bot applied is visible
  // to the assertion that says it landed.
  effects: (f.effects ?? []).map((e) => ({
    kind: e.kind,
    remaining_turns: e.remaining_turns,
    value: e.value ?? null,
    stat: e.stat ?? null,
    element: e.element ?? null,
  })),
})

/**
 * The caster's book, projected to the SpellLevel field set `@aresrpg/sim/spell_targeting` takes verbatim
 * (range / modifiable_range / linear / line_of_sight / free_cell) so the policy can call the SIM's own
 * targeting gate instead of inventing a second one.
 *
 * THE SEAT'S RANK, not rank 1 (#1157 ②). `seat_spell_row(seat, spell)` is the ONE door every fight surface reads
 * a live spell number through (range, AP cost, cooldown, per-turn caps, effects) since #1077 — this seam is one
 * of those surfaces. Reading `levels[0]` priced AP, measured range and checked caps at rank 1 while the authority
 * resolved at the seat's real rank, so an upgraded spell produced a plan the chain refuses and a FAIL row that
 * blamed the spell instead of the read.
 *
 * LEVEL-GATED, like the bar. `resolve_class_spells(class, level)` is the SAME resolver DungeonBoard's spell bar
 * reads (`my_spells`), at the SAME level — so the book the bot plans over is the book the player can press. An
 * ungated book was harmless on the simulator (its seat is authored at level 200, which unlocks everything) and
 * is NOT harmless on the world: a level-1 seat would plan casts the chain refuses, and every one of those is a
 * signed transaction that burns gas to learn what the resolver already knew.
 */
const spell_rows = (seat, class_id, char_level) =>
  resolve_class_spells(class_id, Number(char_level) || 0)
    .filter((spell) => !!spell.object_id)
    .map((spell) => {
      const level = seat_spell_row(seat, spell) ?? {}
      return {
        id: spell.object_id, // what a committed cast NAMES (fight_start.js `cast_id_of`)
        name_key: spell.name_key,
        name: spell.name,
        // the RANK this seat casts at — the level index `predict_cast` and the chain both resolve on
        level: seat_spell_level(seat, spell),
        element: spell.element ?? null,
        ap: level.ap ?? 0,
        mp: level.mp ?? 0,
        range: level.range ?? [0, 0],
        modifiable_range: !!level.modifiable_range,
        line_of_sight: !!level.line_of_sight,
        linear: !!level.linear,
        free_cell: !!level.free_cell,
        casts_per_turn: level.casts_per_turn ?? 0,
        casts_per_target: level.casts_per_target ?? 0,
        cooldown: level.cooldown ?? 0,
        crit_rate: level.crit_rate ?? 0,
        effects: (level.effects ?? []).map((e) => ({
          kind: e.kind,
          kind_id: e.kind_id ?? null,
          base: e.base ?? 0,
          chance: e.chance ?? 0,
          turns: e.turns ?? 0,
          area_shape: e.area_shape ?? null,
          area_size: e.area_size ?? 0,
          element: e.element ?? null,
          target_filter: e.target_filter ?? 0,
        })),
      }
    })

/**
 * window.__ARES_DEV_READ() — ONE plain-JSON snapshot of the live fight: every fighter, the board mask, my
 * traps, the turn clock and the caster's castable book. Read-only, both surfaces (it goes through the fight
 * PROJECTION, never a world-only chain slice — #1025's rule).
 * @returns {object} `{ ok: false, error }` when no fight is live.
 */
function dev_read() {
  const store = use_dungeon.getState()
  const view = fight_view()
  if (!view) return { ok: false, error: 'no active fight' }
  const committed = committed_by_id()
  const fighters = [...view.fighters.values()].map((f) => fighter_row(f, committed.get(f.id)))
  const me = view.my_entity_id ? view.fighters.get(view.my_entity_id) : null
  return {
    ok: true,
    fight_id: view.fight_id,
    status: store.dungeon?.status ?? null,
    busy: store.busy,
    error: store.error ? String(store.error) : null,
    placement: !!view.placement,
    placement_cells: (view.placement_cells?.[0] ?? []).map((c) => ({ x: c.x, y: c.y })),
    winner: view.winner ?? -1,
    turn_number: view.turn_number ?? 0,
    my_id: view.my_entity_id ?? null,
    active_id: view.active_entity_id ?? null,
    presenting: !!view.presenting,
    turn_order: view.turn_order ?? [],
    // THE MIN-TURN FLOOR, in the read because the bot is held to it exactly as the player is: `actions.move::
    // assert_min_turn` aborts a turn committed inside the human-natural 3s, and the End Turn button greys out
    // for precisely this remainder (FightControls reads the same projection off the same raw core state). A bot
    // that could not see this clock committed the instant it was handed the turn and had half its turns refused.
    min_turn_left_ms: min_turn_left(fight_store.getState()),
    // flat GRID_W×GRID_H walkability (0 walkable / 1 blocked) — project.js `board_cells`, obstacles and
    // holes already folded in. The policy pathfinds and traces LoS over exactly this.
    arena: { width: view.arena.width, height: view.arena.height, cells: [...view.arena.cells] },
    my_traps: [...(view.my_traps ?? [])],
    hand: [...(view.hand ?? [])],
    fighters,
    spellbook: me ? spell_rows(me, me.class_id ?? me.classe, me.level ?? 1) : [],
  }
}

/**
 * THE PREDICTION BANK (#1144) — what the client SAYS this turn's casts will do, recorded BEFORE the authority
 * is asked, so the assertions can compare prediction against chain instead of chain against itself.
 *
 * It is the board's own cast prediction, not a second one: same `predict_cast`, same `fight_view()`, same seat
 * rank (`seat_spell_level`), same deterministic crit clock and same `resolve_ref` DungeonBoard's `optimistic_cast`
 * runs when a player clicks — this only declines to write the result into the store. A bank computed any other way
 * would be a third implementation of the damage formula and would prove nothing about what the player was shown.
 *
 * EVERY CAST IS PREDICTED OFF THE PRE-TURN VIEW, and that is sound because of the policy's own harness rule: a
 * planned turn never contains two actions claiming the same assertable fact, so no two casts of one turn touch the
 * same fighter's HP. Position is not an input to a damage number, so a preceding move does not move the prediction
 * either. An unresolved prediction (a <100% chance row, a not-yet-deployed chain kind) banks its REASONS and no
 * number — an honest gap the sheet reports, never a fabricated expectation.
 * @param {Array<{ kind: number, cell: { x: number, y: number }, spell_id?: string }>} actions
 * @returns {Array<object>} one row per cast action, in plan order
 */
const bank_predictions = (actions) => {
  const dungeon = use_dungeon.getState().dungeon
  const view = fight_view()
  const caster_id = view?.my_entity_id ?? null
  const me = caster_id ? view.fighters.get(caster_id) : null
  if (!dungeon || !me)
    // NEVER A SILENT EMPTY BANK: an un-bankable turn names its reason, so the sheet's parity row reports a gap
    // with a cause instead of a quiet zero (the whole failure mode this oracle exists to end).
    return [{ index: -1, hp: [], unresolved: [`no_bank:${!dungeon ? 'no dungeon store' : 'no seat in the view'}`] }]
  const escrow_row = dungeon.escrow?.find((p) => (p.character ?? p.character_id) === caster_id) ?? null
  const resolve_ref = (id) => resolve_dungeon_ref(dungeon, id)
  const rows = []
  // Casts of a PLANNED batch that exist in no journal yet — the one legitimate `ahead` offset on the ONE slot
  // derivation (#1224): everything already drafted rides the store log this reads below.
  let drafted = 0
  for (const [index, action] of actions.entries()) {
    if (action.kind !== CAST_KIND) continue
    const spell = fight_spell(action.spell_id)
    const spell_level = seat_spell_level(me, spell)
    const target_cell = encode(action.cell.x, action.cell.y)
    const banked = {
      index,
      spell_id: String(action.spell_id),
      spell_key: spell?.name_key ?? null,
      spell_level,
      target_cell: action.cell,
      // the build the prediction ran on — a divergence row names it, so "predicted 2, chain killed" carries the
      // stats and rank it was predicted with instead of being an anecdote.
      caster_build: { stats: me.base_stats ?? {}, level: me.level ?? 1 },
      hp: [],
      place_traps: [],
      unresolved: spell?.template ? [] : [`no_template:${action.spell_id}`],
    }
    // this cast's own slot, then the counter advances for the next one (a template-less row still consumes a slot
    // on the chain's sequence, so it advances before the bail below).
    const critical_clock = crit_clock_of({
      fight: dungeon,
      seat_row: escrow_row,
      slot: my_action_slot(fight_store.getState(), { ahead: drafted }),
    })
    drafted += 1
    if (!spell?.template) {
      rows.push(banked)
      continue
    }
    const prediction = predict_cast({
      view,
      caster_id,
      spell: spell.template,
      spell_level,
      target_cell,
      critical_clock,
      resolve_ref,
    })
    // Hit rows are keyed by REF (is_mob/idx) exactly as the fold takes them, so every fighter the cast changes
    // is banked by entity id here — the assertion looks its planned target up by id and needs no second mapping.
    const by_ref = new Map(
      [...view.fighters.keys()]
        .map((id) => [resolve_ref(id), id])
        .filter(([ref]) => !!ref)
        .map(([ref, id]) => [`${ref.is_mob ? 'm' : 'p'}${ref.idx}`, id])
    )
    const hp = (prediction?.actions ?? [])
      .filter((row) => row.kind === 'Hit')
      .map((row) => ({
        id: by_ref.get(`${row.victim_is_mob ? 'm' : 'p'}${row.victim_idx}`) ?? null,
        remaining_hp: Number(row.remaining_hp),
      }))
      .filter((row) => !!row.id)
    const place_traps = prediction?.placed_traps ?? []
    rows.push({
      ...banked,
      hp,
      place_traps,
      trap_anchor: target_cell,
      unresolved: [...banked.unresolved, ...(prediction?.unresolved ?? [])],
    })
  }
  return rows
}

/**
 * Re-enter authority-accepted seam traps through the SAME reducer input the board's optimistic cast uses.
 * The receipt already folded the cast outcomes, so only the trap payload enters: replaying prediction actions
 * here would apply damage/status twice. A committed-floor basis makes the ledger record immune to draft rollback.
 */
const fold_committed_traps = (predicted) => {
  for (const row of predicted) {
    const place_traps = row.place_traps ?? []
    if (!place_traps.length) continue
    const core = fight_store.getState()
    core.input({
      type: 'predicted',
      intent_id: `seam:${core.fight_id}:${core.applied_version}:${row.index}`,
      basis_version: core.applied_version,
      actions: [],
      place_traps,
      trap_anchor: row.trap_anchor,
      placed_at: { version: core.applied_version, event_idx: Number.MAX_SAFE_INTEGER },
    })
  }
}

/** Capture the store's short-lived refusal reason across an await — it can be cleared by the reconciling
 *  refresh before the promise settles, and a refusal without its reason is the silence the bot exists to end. */
const with_refusal = async (run) => {
  let reason = null
  const unsubscribe = use_dungeon.subscribe((state) => {
    if (state.error) reason = String(state.error)
  })
  try {
    await run()
  } catch (error) {
    unsubscribe()
    return String(error?.message ?? error)
  }
  unsubscribe()
  const live = use_dungeon.getState().error
  return reason ?? (live ? String(live) : null)
}

/**
 * Refuse before touching the store, so a bad plan is a REASON, never a half-committed turn.
 *
 * TURN-LEVEL vs PLAN-LEVEL, and why the caller is told which. A refusal about the TURN — it is not mine yet, the
 * store is mid-poll, the min-turn floor has not elapsed — says nothing whatsoever about the actions offered, and
 * it passes on its own. A refusal about the PLAN is the authority judging what was asked for. A driver that
 * cannot tell them apart blacklists a perfectly good spell the first time it is early, and then plays a fight it
 * has blinded itself in (measured on the first world run: two timing refusals blacklisted both damage spells and
 * the bot passed for seventeen straight turns).
 * @returns {{ reason: string, turn_level: boolean } | null}
 */
const turn_refusal = (view, store, actions) => {
  const transient = (reason) => ({ reason, turn_level: true })
  const rejected = (reason) => ({ reason, turn_level: false })
  if (!store.dungeon || !view) return transient('no active dungeon fight')
  if (store.busy) return transient('store busy — retry')
  if (store.dungeon.status !== STATUS_ACTIVE) return transient(`dungeon not ACTIVE (status=${store.dungeon.status})`)
  if (!view.my_entity_id) return transient('my_entity_id null')
  if (view.active_entity_id !== view.my_entity_id) return transient(`not my turn (active=${view.active_entity_id})`)
  // The floor the chain itself asserts (`actions.move::assert_min_turn`) and the End Turn button greys out for.
  const floor_ms = min_turn_left(fight_store.getState())
  if (floor_ms > 0) return transient(`the min-turn floor has ${floor_ms}ms left`)
  if (!Array.isArray(actions)) return rejected('actions must be an array')
  for (const action of actions) {
    if (action?.kind !== MOVE_KIND && action?.kind !== CAST_KIND)
      return rejected(`action kind ${action?.kind} is not 0 (move) or 1 (cast)`)
    if (!Number.isInteger(action?.cell?.x) || !Number.isInteger(action?.cell?.y))
      return rejected('each action needs cell {x:int,y:int}')
    if (action.kind === CAST_KIND && !action.spell_id) return rejected('a cast action needs the spell object id (`spell_id`)')
  }
  return null
}

/**
 * window.__ARES_DEV_TURN(actions) — commit ONE whole player turn and hand back the read from both sides.
 * `actions` are `{ kind: 0, cell }` (move — destination-only, the sim rebuilds the canonical route) and
 * `{ kind: 1, cell, spell_id }` (cast — `spell_id` is the SpellTemplate object id `__ARES_DEV_READ`'s
 * spellbook publishes). An EMPTY array is a legal pass, exactly like pressing End Turn with nothing drafted.
 * @param {Array<{ kind: number, cell: { x: number, y: number }, spell_id?: string }>} actions
 * @returns {Promise<{ ok: boolean, error?: string, turn_level?: boolean, before?: object, after?: object,
 *   predicted?: Array<object> }>} `turn_level` marks a refusal about the TURN rather than the plan — transient,
 *   and never evidence about a spell. `predicted` is the prediction bank (see `bank_predictions`).
 */
async function dev_turn(actions = []) {
  const store = use_dungeon.getState()
  const view = fight_view()
  const refusal = turn_refusal(view, store, actions)
  if (refusal) return { ok: false, error: refusal.reason, turn_level: refusal.turn_level }

  const before = dev_read()
  // THE BANK, taken here: before a single action is staged, while the view still holds the state the prediction
  // was made on. After the commit it is unrecoverable — which is why the oracle could never exist client-side.
  const predicted = bank_predictions(actions)
  // ARM the last cast's card exactly as a real grab does (the spell bar reads `name_key`), so the VFX/hand
  // chrome of a bot turn is the chrome of a played turn. Cosmetic only — the staged object id is the cast.
  const armed = [...actions].reverse().find((a) => a.kind === CAST_KIND)
  if (armed) {
    const row = before.spellbook.find((s) => s.id === armed.spell_id)
    if (row) context.dispatch('action/fight/arm', { spell_id: row.name_key })
  }
  const turn = use_dungeon_turn.getState()
  const staged = actions.map((action) => {
    const cell = encode(action.cell.x, action.cell.y)
    if (action.kind === CAST_KIND) turn.set_cast_target(cell)
    return action.kind === CAST_KIND
      ? { kind: CAST_KIND, target: cell, spell_template_id: String(action.spell_id) }
      : { kind: MOVE_KIND, target: cell }
  })

  // commit_turn returns false on a swallowed refusal, so BOTH facts are needed: the boolean and the reason.
  let committed = false
  const error = await with_refusal(async () => {
    try {
      committed = await store.commit_turn(staged)
    } finally {
      use_dungeon_turn.getState().clear_picks()
    }
  })
  if (committed && !error) fold_committed_traps(predicted)
  const after = dev_read()
  if (!committed) return { ok: false, error: error ?? 'turn commit refused', before, after, predicted }
  if (error) return { ok: false, error, before, after, predicted }
  return { ok: true, before, after, predicted }
}

/**
 * window.__ARES_DEV_PLACE(cell) — take MY start cell for a fight that is still in PLACEMENT. Routes through the
 * SAME `use_dungeon.place_at_cell` door the READY button presses (`turns::place` — place + ready in one
 * signature; the last ready starts the fight), so an illegal cell is refused by the authority exactly as it
 * refuses the button. Returns the read from both sides, like `__ARES_DEV_TURN`.
 * @param {{ x: number, y: number }} cell one of `__ARES_DEV_READ().placement_cells`
 * @returns {Promise<{ ok: boolean, error?: string, before?: object, after?: object }>}
 */
async function dev_place(cell) {
  const store = use_dungeon.getState()
  const view = fight_view()
  if (!store.dungeon || !view) return { ok: false, error: 'no active dungeon fight' }
  if (!view.placement) return { ok: false, error: 'the fight is not in placement' }
  if (!Number.isInteger(cell?.x) || !Number.isInteger(cell?.y)) return { ok: false, error: 'place needs cell {x:int,y:int}' }
  // The band is checked HERE because a placement outside it is dropped by the reducer rather than refused — a
  // dropped placement is a silently seatless fight, which is the one failure a bot cannot diagnose from a read.
  const band = (view.placement_cells?.[0] ?? []).some((c) => c.x === cell.x && c.y === cell.y)
  if (!band) return { ok: false, error: `${cell.x},${cell.y} is not one of my start cells` }
  const before = dev_read()
  const error = await with_refusal(() => store.place_at_cell(encode(cell.x, cell.y)))
  const after = dev_read()
  return error ? { ok: false, error, before, after } : { ok: true, before, after }
}

/**
 * window.__ARES_DEV_ABANDON() — FORFEIT the live fight (`use_dungeon.abandon_fight`, the ABANDON button's own
 * door). This is what makes a chain-backed rig REPEATABLE: a fight the bot opens and walks away from keeps its
 * character escrowed forever, and every later run then finds no claimable group and no way to say why. The rig
 * wants a free seat, not that fight's rewards.
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function dev_abandon({ settle_ms = 30_000 } = {}) {
  if (!use_dungeon.getState().fight_id) return { ok: false, error: 'no live fight to abandon' }
  // `abandon_fight` DROPS the call while the store is busy — it returns false without composing anything, so
  // waiting out a background poll costs nothing and signs nothing. This is not a retry of a failed transaction
  // (none was built); it is waiting for the door to be open before knocking.
  const deadline = Date.now() + settle_ms
  while (use_dungeon.getState().busy && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 500))
  const store = use_dungeon.getState()
  if (store.busy) return { ok: false, error: `the store was still busy after ${settle_ms / 1000}s` }
  let released = false
  const error = await with_refusal(async () => {
    released = await store.abandon_fight()
  })
  return released && !error ? { ok: true } : { ok: false, error: error ?? 'the forfeit was dropped' }
}

/** Register the hooks (idempotent; dev builds only — the caller gates on import.meta.env.DEV). */
export function register_dev_bot_seam() {
  if (typeof window === 'undefined') return
  ;(/** @type {any} */ (window)).__ARES_DEV_READ = dev_read
  ;(/** @type {any} */ (window)).__ARES_DEV_TURN = dev_turn
  ;(/** @type {any} */ (window)).__ARES_DEV_PLACE = dev_place
  ;(/** @type {any} */ (window)).__ARES_DEV_ABANDON = dev_abandon
}
