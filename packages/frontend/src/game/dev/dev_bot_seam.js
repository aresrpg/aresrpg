// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEV-ONLY BOT SEAM (#1100) — the two doors a SCRIPTED fight bot needs and the #1028 seams do not open.
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

import { decode, encode } from '@aresrpg/fight/los'
import { board_view, fight_view } from '@aresrpg/fight/project'
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
 */
const spell_rows = (class_id) =>
  resolve_class_spells(class_id, Number.MAX_SAFE_INTEGER)
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
    // flat GRID_W×GRID_H walkability (0 walkable / 1 blocked) — project.js `board_cells`, obstacles and
    // holes already folded in. The policy pathfinds and traces LoS over exactly this.
    arena: { width: view.arena.width, height: view.arena.height, cells: [...view.arena.cells] },
    my_traps: [...(view.my_traps ?? [])],
    hand: [...(view.hand ?? [])],
    fighters,
    spellbook: me ? spell_rows(me.class_id ?? me.classe) : [],
  }
}

/** Refuse before touching the store, so a bad plan is a REASON, never a half-committed turn. */
const turn_refusal = (view, store, actions) => {
  if (!store.dungeon || !view) return 'no active dungeon fight'
  if (store.busy) return 'store busy — retry'
  if (store.dungeon.status !== STATUS_ACTIVE) return `dungeon not ACTIVE (status=${store.dungeon.status})`
  if (!view.my_entity_id) return 'my_entity_id null'
  if (view.active_entity_id !== view.my_entity_id) return `not my turn (active=${view.active_entity_id})`
  if (!Array.isArray(actions)) return 'actions must be an array'
  for (const action of actions) {
    if (action?.kind !== MOVE_KIND && action?.kind !== CAST_KIND) return `action kind ${action?.kind} is not 0 (move) or 1 (cast)`
    if (!Number.isInteger(action?.cell?.x) || !Number.isInteger(action?.cell?.y)) return 'each action needs cell {x:int,y:int}'
    if (action.kind === CAST_KIND && !action.spell_id) return 'a cast action needs the spell object id (`spell_id`)'
  }
  return null
}

/**
 * window.__ARES_DEV_TURN(actions) — commit ONE whole player turn and hand back the read from both sides.
 * `actions` are `{ kind: 0, cell }` (move — destination-only, the sim rebuilds the canonical route) and
 * `{ kind: 1, cell, spell_id }` (cast — `spell_id` is the SpellTemplate object id `__ARES_DEV_READ`'s
 * spellbook publishes). An EMPTY array is a legal pass, exactly like pressing End Turn with nothing drafted.
 * @param {Array<{ kind: number, cell: { x: number, y: number }, spell_id?: string }>} actions
 * @returns {Promise<{ ok: boolean, error?: string, before?: object, after?: object }>}
 */
async function dev_turn(actions = []) {
  const store = use_dungeon.getState()
  const view = fight_view()
  const refusal = turn_refusal(view, store, actions)
  if (refusal) return { ok: false, error: refusal }

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

  // commit_turn returns false on a swallowed refusal; its short-lived store reason can be cleared by the
  // reconciling refresh before the await returns, so capture it live (the dev_move idiom).
  let refusal_reason = null
  const unsubscribe = use_dungeon.subscribe((state) => {
    if (state.error) refusal_reason = String(state.error)
  })
  let committed = false
  try {
    committed = await store.commit_turn(staged)
  } finally {
    unsubscribe()
    use_dungeon_turn.getState().clear_picks()
  }
  const after = dev_read()
  if (!committed)
    return { ok: false, error: refusal_reason ?? String(use_dungeon.getState().error ?? 'turn commit refused'), before, after }
  const error = use_dungeon.getState().error
  if (error) return { ok: false, error: String(error), before, after }
  return { ok: true, before, after }
}

/** Register the hooks (idempotent; dev builds only — the caller gates on import.meta.env.DEV). */
export function register_dev_bot_seam() {
  if (typeof window === 'undefined') return
  ;(/** @type {any} */ (window)).__ARES_DEV_READ = dev_read
  ;(/** @type {any} */ (window)).__ARES_DEV_TURN = dev_turn
}
