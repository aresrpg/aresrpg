// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEV-ONLY diagnostic hooks (P0 sweep drive — items 2/9/11 evidence). Sibling of dev_cast.js, the SAME
// live-module access pattern: real imports inside the app bundle, registered at boot by GameWorldHud's
// import.meta.env.DEV block, tree-shaken out of prod. These hooks exist because a Playwright-side
// `import('/src/…')` resolves a SECOND Vite module instance (fresh zustand stores, empty state) — the
// drive's ds() probe read that dead twin all night. Window hooks close over the LIVE instances.
//
// NO game rules here: __ARES_DEV_MOVE drives the IDENTICAL commit_turn a real move click produces;
// __ARES_DEV_STATE only READS. The two VOXEL-fight hooks below are qa's eyes on the board the 2D-era
// __ARES_FIGHT_BOARD.cell_to_screen provided (dead — that provider retired with the isometric renderer):
// __ARES_DEV_CELL_SCREEN inverts board_picking's ndc math so a headless driver can click a named cell;
// __ARES_DEV_PLACE_READY reaches the SAME store/tx the DungeonBoard placement pick + READY button fire;
// __ARES_DEV_CAST_VFX replays the F1 cast beat (adapter.play_cast's cast_vfx + impact package) on the mounted
// board with zero fight setup/gas, so qa/design can grade the flare→orb→impact feel without landing a real spell.

import { Vector3 } from 'three'

import { encode } from '@aresrpg/fight/los'
import { fight_store } from '@aresrpg/fight/store'
import { context } from '../store.js'
import { use_dungeon } from '../../world-shell/dungeon_store.js'
import { engine_view_of, fight_view, my_placement_zone } from '@aresrpg/fight/project'
import { use_dungeon_turn } from '../screens/dungeon-turn.js'
import { fight_end_state } from '../../fight-engine/fight_end_machine.js'
import { cast_vfx, burst_vfx, is_burst_element } from '../fight_cast_vfx.js'
import { IMPACT_FEEL, magnitude_scale } from '../vfx_map.js'
import { play_element_sfx, play_sfx } from '../core/audio/sfx.js'
import { trigger_fight_flash } from '../core/toast.js'
import { cell_cast_world } from '../../world-shell/voxel_fight_adapter.js'

const MOVE_KIND = 0 // dungeon_turn.move apply_move (0 = move, 1 = cast)
const STATUS_ACTIVE = 1

/**
 * window.__ARES_DEV_MOVE(cell) — commit a REAL single-segment move to {x,y} on the active turn (the same
 * [{kind:0,target}] batch a reach-cell click + End Turn produces). The contract validates reach/MP — an
 * out-of-reach target aborts on-chain exactly like the UI prevents; the caller reads `error`.
 * @param {{ x: number, y: number }} cell @returns {Promise<{ ok: boolean, error?: string, my_cell?: any, mp_after?: number }>}
 */
async function dev_move(cell) {
  const store = use_dungeon.getState()
  const { dungeon, busy } = store
  const fight = fight_view()
  if (!dungeon || !fight) return { ok: false, error: 'no active dungeon fight' }
  if (busy) return { ok: false, error: 'store busy — retry' }
  if (dungeon.status !== STATUS_ACTIVE) return { ok: false, error: `dungeon not ACTIVE (status=${dungeon.status})` }
  const me = fight.my_entity_id
  if (!me) return { ok: false, error: 'my_entity_id null' }
  if (fight.active_entity_id !== me) return { ok: false, error: `not my turn (active=${fight.active_entity_id})` }
  if (!Number.isInteger(cell?.x) || !Number.isInteger(cell?.y)) return { ok: false, error: 'cell must be {x:int,y:int}' }
  // commit_turn returns false on a swallowed simulation refusal. Capture its short-lived store reason while the
  // commit reconciles: refresh may clear `error` before this awaited call returns.
  let refusal_reason = null
  const unsubscribe = use_dungeon.subscribe((state) => {
    if (state.error) refusal_reason = String(state.error)
  })
  let committed = false
  try {
    committed = await store.commit_turn([{ kind: MOVE_KIND, target: encode(cell.x, cell.y) }])
  } finally {
    unsubscribe()
  }
  if (!committed)
    return { ok: false, error: refusal_reason ?? String(use_dungeon.getState().error ?? 'turn commit refused') }
  const err = use_dungeon.getState().error
  if (err) return { ok: false, error: String(err) }
  const after = fight_view()?.fighters?.get(me)
  return { ok: true, my_cell: after?.cell, mp_after: after?.mp }
}

/**
 * window.__ARES_DEV_STATE() — one honest snapshot of the LIVE stores (the drive's cross-instance-safe
 * read): dungeon status/room/busy/phase/error + the fight-end machine + my fighter vitals.
 */
// Complexity retained (#2069): the probe intentionally captures one coherent diagnostic snapshot; extraction would fragment its shared observation point.
function dev_state() {
  const d = use_dungeon.getState()
  const fight = fight_view()
  const me = fight?.my_entity_id ? fight.fighters?.get(fight.my_entity_id) : null
  return {
    status: d.dungeon?.status ?? null,
    room: d.dungeon?.room_index ?? null,
    busy: d.busy,
    phase: d.phase,
    error: d.error ?? null,
    in_session: d.in_session,
    fe: fight_end_state(),
    winner: fight?.winner ?? null,
    my_cell: me?.cell ?? null,
    my_hp: me ? `${me.health}/${me.health_max}` : null,
    my_mp: me?.mp ?? null,
    mobs: d.dungeon?.mobs?.map((/** @type {any} */ m) => ({ cell: m.cell, hp: m.hp, alive: m.alive })) ?? [],
    // [p0-fight-init verify rig] the turn-driver reads the input drive asserts on (cross-instance-safe):
    me: fight?.my_entity_id ?? null,
    active: fight?.active_entity_id ?? null,
    turn: fight?.turn_number ?? null,
    fight_fingerprint: fight?.fingerprint ?? null,
    deadline: d.dungeon?.turn_deadline_ms ?? null,
    move_path: use_dungeon_turn.getState().move_path.length,
    armed: fight?.armed_spell_id ?? null,
    cast_target: use_dungeon_turn.getState().cast_target ?? null,
  }
}

/** Canonical divergence hook: returns and logs the viewer-free per-turn fingerprint. */
function dev_fight_fingerprint() {
  const fingerprint = fight_view()?.fingerprint ?? null
  console.info('[fight:fingerprint]', fingerprint)
  return fingerprint
}

const fingerprint_key = (fight) => {
  const fingerprint = fight?.fingerprint ?? null
  return fingerprint ? `${fight?.fight_id ?? ''}:${fingerprint.turn_ordinal ?? ''}:${fingerprint.hash}` : null
}

const log_fight_fingerprint = (state, previous_state = null) => {
  const fight = engine_view_of(state)
  const fingerprint = fight?.fingerprint ?? null
  if (fingerprint_key(fight) === fingerprint_key(previous_state ? engine_view_of(previous_state) : null)) return
  if (fingerprint)
    console.info('[fight:fingerprint]', {
      fight_id: fight?.fight_id ?? null,
      ...fingerprint,
    })
}

// ── VOXEL-FIGHT probe hooks (qa's board eyes) ────────────────────────────────────────────────────────────────
// scratch Vector3 for the cell→world→ndc projection (allocate nothing per call, like board_picking's scratch).
const _proj = new Vector3()

/**
 * window.__ARES_DEV_CELL_SCREEN(x, y) — CANVAS-relative pixel coords of the CENTER of board cell (x,y), the
 * exact INVERSE of board_picking's ray pick. Project the cell-centre point on the floor plane (y = origin.y —
 * the SAME plane cell_at_ray intersects) through the LIVE engine camera to ndc, then undo board_picking.to_ndc
 * (CSS-pixel bounding rect, NO devicePixelRatio — the picker never uses it). Round-trips: board.cell_at_ray on
 * the ndc of the returned pixels yields {x,y} back (the centre floor-snaps to its own cell). Returns null when no
 * board is built, the camera is pre-boot, the cell is out of bounds, or the point is behind the camera.
 * @param {number} x @param {number} y @returns {{ x: number, y: number } | null}
 */
function dev_cell_screen(x, y) {
  const w = /** @type {any} */ (window)
  const board = w.__voxel_board
  const engine = w.__voxel_engine
  const canvas = /** @type {HTMLCanvasElement | undefined} */ (w.__voxel_canvas)
  if (!board || !engine || !canvas) return null
  const desc = board._descriptor?.()
  if (!desc) return null // no board mounted (roam/exit)
  const cam = engine.get_camera?.()
  if (!cam) return null // engine still booting
  const { origin, width, height, cell_size } = desc
  if (!Number.isInteger(x) || x < 0 || x >= width || !Number.isInteger(y) || y < 0 || y >= height) return null
  // cell centre on the floor plane — board_picking floors (hit − origin)/cell_size, so the centre back-snaps here.
  _proj.set(origin.x + (x + 0.5) * cell_size, origin.y, origin.z + (y + 0.5) * cell_size).project(cam)
  if (_proj.z >= 1) return null // behind the camera / beyond the far plane (mirror the tooltip projection guard)
  const rect = canvas.getBoundingClientRect()
  return {
    x: ((_proj.x + 1) / 2) * rect.width,
    y: ((1 - _proj.y) / 2) * rect.height,
  }
}

/** Occupied cell keys ("x,y") of every LIVING fighter except `exclude_id` (the placer). */
function occupied_keys(fight, exclude_id) {
  const set = new Set()
  for (const f of fight.fighters.values()) {
    if (f.dead || f.id === exclude_id) continue
    set.add(`${f.cell.x},${f.cell.y}`)
  }
  return set
}

/** The fight_id we've already fired place_at for — idempotency guard so a second ready is a no-op (a re-ready
 *  would re-sign the tx; a fresh fight has a new fight_id and clears this naturally). */
let readied_for = /** @type {string | null} */ (null)

/**
 * window.__ARES_DEV_PLACE_READY() — during PLACEMENT, pick the first FREE team-0 start cell and fire the ONE
 * place_at tx (place + READY), reaching the SAME store/tx DungeonBoard's placement pick + READY button call:
 * the optimistic placed dispatch + set_placement_pick + set_placement_intent, then use_dungeon.place_at_cell.
 * A state-reacher, not a click-simulator. Idempotent-safe: a second call while a place_at is in flight, after
 * placement has ended, or on an already-readied fight returns { ok:false, reason }.
 * @returns {Promise<{ cell: { x: number, y: number }, ok: true } | { ok: false, reason: string }>}
 */
async function dev_place_ready() {
  const fight = fight_view()
  if (!fight) return { ok: false, reason: 'no active fight' }
  if (!fight.placement) return { ok: false, reason: 'not in placement phase' }
  if (use_dungeon.getState()._placing) return { ok: false, reason: 'place_at already in flight' }
  if (readied_for === fight.fight_id) return { ok: false, reason: 'already readied this fight' }
  const address = fight.my_entity_id
  const me = address ? fight.fighters.get(address) : null
  if (!me) return { ok: false, reason: 'my fighter not in slice' }
  // My own band, so a non-zero seat still resolves correctly (one home: `my_placement_zone`). Pick the first
  // cell no other living fighter stands on (exclude myself).
  const zone = my_placement_zone(fight)
  const occupied = occupied_keys(fight, me.id)
  const cell = zone.find(c => !occupied.has(`${c.x},${c.y}`))
  if (!cell) return { ok: false, reason: 'no free start cell in team-0 zone' }
  // the placement pick — EXACTLY what the adapter click relay writes post-S2 (the ONE local placement truth).
  use_dungeon_turn.getState().set_placement_pick(encode(cell.x, cell.y))
  // READY — the ONE place_at tx (place + mark ready; solo flips ACTIVE immediately). Encoded flat cell index.
  readied_for = fight.fight_id
  await use_dungeon.getState().place_at_cell(encode(cell.x, cell.y))
  const err = use_dungeon.getState().error
  if (err) {
    readied_for = null // the tx aborted — allow a retry
    return { ok: false, reason: String(err) }
  }
  return { cell: { x: cell.x, y: cell.y }, ok: true }
}

// ── F1 CAST-VFX PREVIEW (qa/design's eyes on the cast beat) ────────────────────────────────────────────────────
// Plays the F1 cast beat on the CURRENTLY-mounted board with ZERO fight setup or gas — a state-reacher into the
// SAME machinery voxel_fight_adapter.play_cast fires, never a re-implementation. It reuses cast_vfx (the real
// flare→orb→impact flipbooks), cell_cast_world (the real cell→world map, anchored at the live board origin), and
// — on impact — play_cast's EXACT impact package (target-layer element SFX + board.shake(0.18) + a hit-flash on
// the avatar standing on `to`), so a preview is frame-faithful to a genuine cast.

/**
 * window.__ARES_DEV_CAST_VFX({ from, to, element, impact }) — fire the F1 cast beat from board cell `from` to
 * board cell `to` on the mounted board (flare at the caster → orb in flight → impact burst at the target). When
 * `impact` is true, the orb's land also fires the FULL impact package play_cast fires: the target-layer element
 * SFX (play_element_sfx), the board camera shake (0.18 — play_cast's non-kill magnitude), and a hit-flash on the
 * fighter occupying `to` (skipped when the cell holds no living avatar). No AoE ripple — a preview carries no
 * multi-cell effect packet, matching play_cast's AoE-only ripple gate. World positions come from the adapter's
 * OWN cell_cast_world anchored at board._descriptor().origin (the same origin play_cast reads from board_frame),
 * so the preview never drifts from the real path.
 * [S-23] BURST elements route exactly like play_cast: element 'earth'/'weapon' plays the impact-only ground
 * burst at `to` on the contact clock, 'death' bursts there immediately — so `{ element: 'death', to: [x,y] }`
 * previews the KO burst, `{ element: 'heal' }` the full heal beat, all on the mounted board with zero gas.
 * @param {{ from: [number, number], to: [number, number], element?: string, impact?: boolean }} opts
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function dev_cast_vfx({ from, to, element = 'fire', impact = true, dmg = 150, killed = false, crit = false } = /** @type {any} */ ({})) {
  const w = /** @type {any} */ (window)
  const board = w.__voxel_board
  const engine = w.__voxel_engine
  if (!board || !engine) return { ok: false, reason: 'no board mounted' }
  const mag = magnitude_scale(dmg) // preview the magnitude-scaled footprint + shake + flash (default a mid hit)
  const desc = board._descriptor?.()
  if (!desc) return { ok: false, reason: 'no board mounted' } // built board, torn down (roam/exit) → no descriptor
  const { origin, width, height } = desc
  const cell_ok = (/** @type {any} */ c) =>
    Array.isArray(c) && Number.isInteger(c[0]) && Number.isInteger(c[1]) &&
    c[0] >= 0 && c[0] < width && c[1] >= 0 && c[1] < height
  if (!cell_ok(from)) return { ok: false, reason: `from cell out of bounds (board ${width}×${height})` }
  if (!cell_ok(to)) return { ok: false, reason: `to cell out of bounds (board ${width}×${height})` }

  const to_cell = { x: to[0], y: to[1] }
  const on_impact = impact
    ? () => {
        play_element_sfx(element, 'impact') // TARGET layer — the exact call play_cast fires on the land
        if (crit) play_sfx('crit') // mirrors play_cast's crit accent layer
        if (killed) play_sfx('death') // mirrors play_cast's kill-stinger layer
        // the FULL impact package the adapter fires (one home mirrored): magnitude-scaled fight-cam shake + the
        // element screen flash + GRADE moment (kill → desaturate, heal → warm), so a preview grades the whole
        // cast → travel → impact → shake → flash chain with zero fight setup/gas.
        const feel = IMPACT_FEEL[element] ?? IMPACT_FEEL.neutral
        w.__voxel_cue_shake?.((killed ? IMPACT_FEEL.death.shake : feel.shake) * mag * (crit ? 1.4 : 1))
        const flash = killed ? IMPACT_FEEL.death : feel
        const grade = killed ? 'desaturate' : feel.grade
        trigger_fight_flash({ color: flash.flash, intensity: (killed ? 0.5 : 0.3) * mag * (crit ? 1.25 : 1), grade })
        // flash the avatar on the strike cell (play_cast flashes beat.release_target on its impact frame) —
        // resolve the fighter from the LIVE slice; skip when no living body stands on `to`.
        const target = [...(fight_view()?.fighters?.values() ?? [])].find(
          (/** @type {any} */ f) => !f.dead && f.cell?.x === to_cell.x && f.cell?.y === to_cell.y,
        )
        if (target) board.flash_entity?.(target.id)
      }
    : undefined
  // the SAME routing verdict play_cast uses (is_burst_element — one home): burst elements are impact-only.
  if (is_burst_element(element)) {
    burst_vfx({ engine, at: cell_cast_world(origin, to_cell), element, magnitude: mag, on_impact })
  } else {
    cast_vfx({
      engine,
      from: cell_cast_world(origin, { x: from[0], y: from[1] }),
      to: cell_cast_world(origin, to_cell),
      element,
      magnitude: mag,
      on_impact,
    })
  }
  return { ok: true }
}

/** Register the hooks (idempotent; dev builds only — the caller gates on import.meta.env.DEV). */
export function register_dev_probe() {
  if (typeof window === 'undefined') return
  const dev_window = /** @type {any} */ (window)
  dev_window.__ARES_DEV_FIGHT_FINGERPRINT_UNSUBSCRIBE?.()
  log_fight_fingerprint(fight_store.getState())
  dev_window.__ARES_DEV_FIGHT_FINGERPRINT_UNSUBSCRIBE = fight_store.subscribe(log_fight_fingerprint)
  ;(/** @type {any} */ (window)).__ARES_DEV_MOVE = dev_move
  ;(/** @type {any} */ (window)).__ARES_DEV_STATE = dev_state
  ;(/** @type {any} */ (window)).__ARES_DEV_FIGHT_FINGERPRINT = dev_fight_fingerprint
  ;(/** @type {any} */ (window)).__ARES_DEV_CELL_SCREEN = dev_cell_screen
  ;(/** @type {any} */ (window)).__ARES_DEV_PLACE_READY = dev_place_ready
  ;(/** @type {any} */ (window)).__ARES_DEV_CAST_VFX = dev_cast_vfx
}
