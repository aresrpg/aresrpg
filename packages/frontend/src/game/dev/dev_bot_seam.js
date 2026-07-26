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
// all: the bot compares its planned delta against the folded truth instead of trusting an `ok: true`.
//
//   3. __ARES_DEV_PLACE(cell) — commit the PLACEMENT the world surface opens every fight with (`turns::place`,
//      place + READY in one signature, the last ready auto-starting the fight). The simulator writes its
//      placements straight into its own setup store, so the sim bot never sees this phase; a WORLD fight cannot
//      be played without it, and no other seam signs it.
//
//   4. __ARES_DEV_WORLD_JOIN(fight_id) — seat MY character in an already-open PUBLIC world fight, through the
//      exact chain the FightsModal Join button runs (`run_fight_entry` → `join_world_fight` →
//      `enter_after_world_join_receipt` → `enter_world_fight`). This is what makes a COOP bot possible at all:
//      the creator's door (`__dev_start_world_fight`, embed_voxel_dev.js) seats exactly one character, and a
//      second seat has no headless door anywhere else. Chain modules load LAZILY inside the call, so the
//      simulator — which registers this same module — never pulls the transaction graph into its page.

import { decode, encode } from '@aresrpg/fight/los'
import { board_view, fight_view, min_turn_left } from '@aresrpg/fight/project'
import { participant_entity_id } from '@aresrpg/fight/fight_control'
import { fight_store } from '@aresrpg/fight/store'

import { use_dungeon } from '../../world-shell/dungeon_store.js'
import { resolve_class_spells } from '../screens/hud/fight-spells.js'
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
 * targeting gate instead of inventing a second one. Fight resolution reads `levels[0]` only (the level-1
 * MVP — cast.move's "SPELL LEVEL" note), so that is the row published here.
 *
 * LEVEL-GATED, like the bar. `resolve_class_spells(class, level)` is the SAME resolver DungeonBoard's spell bar
 * reads (`my_spells`), at the SAME level — so the book the bot plans over is the book the player can press. An
 * ungated book was harmless on the simulator (its seat is authored at level 200, which unlocks everything) and
 * is NOT harmless on the world: a level-1 seat would plan casts the chain refuses, and every one of those is a
 * signed transaction that burns gas to learn what the resolver already knew.
 */
const spell_rows = (class_id, level) =>
  resolve_class_spells(class_id, Number(level) || 0)
    .filter((spell) => !!spell.object_id)
    .map((spell) => {
      const level = spell.levels?.[0] ?? {}
      return {
        id: spell.object_id, // what a committed cast NAMES (fight_start.js `cast_id_of`)
        name_key: spell.name_key,
        name: spell.name,
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
    spellbook: me ? spell_rows(me.class_id ?? me.classe, me.level ?? 1) : [],
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
 * @returns {Promise<{ ok: boolean, error?: string, turn_level?: boolean, before?: object, after?: object }>}
 *   `turn_level` marks a refusal about the TURN rather than the plan — transient, and never evidence about a spell.
 */
async function dev_turn(actions = []) {
  const store = use_dungeon.getState()
  const view = fight_view()
  const refusal = turn_refusal(view, store, actions)
  if (refusal) return { ok: false, error: refusal.reason, turn_level: refusal.turn_level }

  const before = dev_read()
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
  const after = dev_read()
  if (!committed) return { ok: false, error: error ?? 'turn commit refused', before, after }
  if (error) return { ok: false, error, before, after }
  return { ok: true, before, after }
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
 * window.__ARES_DEV_WORLD_JOIN(fight_id) — seat MY selected character in an OPEN PUBLIC world fight and mount
 * it. Every leg is the production one, in the production order (FightsModal's `on_join`, world branch): the
 * entry reducer wraps the join tx, one settlement recovery is allowed for the first refusal, and the join
 * receipt itself is what authorises the mount. `party_id` is null on purpose — a public fight discards it.
 * @param {string} fight_id the Fight object id the creator's engage published
 * @returns {Promise<{ ok: boolean, error?: string, fight_id?: string, status?: number|null }>}
 */
async function dev_world_join(fight_id) {
  if (!fight_id) return { ok: false, error: 'join needs the fight object id' }
  const character_id = context.get_state().selected_character_id
  if (!character_id) return { ok: false, error: 'no selected character' }
  // LAZY, and load-bearing: the simulator registers this same module and has no transaction graph at all.
  const [{ join_world_fight }, { enter_world_fight }, { enter_after_world_join_receipt }, { run_fight_entry }, { recover_fight_entry_refusal }] =
    await Promise.all([
      import('../../world-shell/dungeon_actions.js'),
      import('../../world-shell/world_fight.js'),
      import('../../world-shell/world_fight_receipt.js'),
      import('../fight_engage.js'),
      import('../../world-shell/dungeon_settlement.js'),
    ])
  // A stale session owns the shared store until it is dropped, and `enter_world_fight` refuses to stomp one.
  if (use_dungeon.getState().fight_id || use_dungeon.getState().run_pass_id) use_dungeon.getState().reset_local()
  try {
    await enter_after_world_join_receipt({
      execute: () =>
        run_fight_entry({
          submit: () => join_world_fight({ fight_id, character_id, party_id: null }),
          recover_refusal: (error) => recover_fight_entry_refusal(use_dungeon, character_id, error),
        }),
      enter: enter_world_fight,
      fight_id,
      character_id,
    })
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) }
  }
  await use_dungeon.getState().refresh()
  return { ok: true, fight_id, status: use_dungeon.getState().dungeon?.status ?? null }
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
  ;(/** @type {any} */ (window)).__ARES_DEV_WORLD_JOIN = dev_world_join
  ;(/** @type {any} */ (window)).__ARES_DEV_ABANDON = dev_abandon
}
