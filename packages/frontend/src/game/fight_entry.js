// FIGHT-ENTRY CINEMATIC — the store lifecycle hook that drives the fight-start
// sequence: "when I start a fight, we should instantly pass into isometrical view with the camera rotating, the
// fight sword appearing and once the fight is ready boom the board appears and the camera becomes static again."
//
// TWO TRIGGERS, one beat:
//   • OPTIMISTIC (pressing R must show the sword and camera change and mob
//     disappearance right away, instead of waiting on the TX first): the world lane's engage INPUT emits
//     'fight_entry/engage' {anchor} on the shared bus BEFORE the claim+create tx (world_spawns hides the
//     targeted group in the same breath) — the beat starts ON THE PRESS, the tx runs UNDER it. Success = the
//     store flip below confirms (belt cleared, beat continues to the board boom); failure = the lane emits
//     'fight_entry/abort' (or the belt timeout fires) → honest rollback: sword despawns, camera releases —
//     never a stuck iso view (the lane re-shows the group + the humanized toast is the tx's own).
//   • STORE FLIP (the fallback/confirmation): `use_dungeon.fight_id` going null→set — the earliest post-tx
//     signal for lanes without a press event (cave engage keeps its D280 ceremony; dev hooks) and the success
//     confirmation for the optimistic path (dedup below — never a double start).
//
// FRESH-CREATES-ONLY GATE: the cinematic is a reward beat for STARTING a fight.
// A reload-resume / co-op poll-adopt sets `fight_fresh: false` in the SAME store set as `fight_id` (every door
// stamps it — dungeon_store + world_fight), and entry_transition returns null: no prepare, no sword, no sting —
// the adapter's on_fight(true) then direct-engages the camera straight at the settled tactical pose (the
// boring-reliable resume path, F6 lesson class).
//
// THE BEATS (this module owns 1–2; the camera owns the settle, fired by the host's on_fight(true) = board ready):
//   1. INSTANT — fight_camera.begin_prepare: snap to iso + a slow orbit around the battlefield anchor (a synthetic
//      board frame; the real board isn't built yet). A "fight_start" sting fires with it.
//   2. HERALD — the fight-start sword drops at the battlefield. DUNGEON/cave fights already plant one via the D280
//      ceremony (dungeon_dimension → cave_session), so we only plant our OWN for WORLD fights (no cave anchor),
//      reusing the SAME plant_fight_sword primitive. on_board_ready() yields it to the board (the cave ceremony
//      yields its own).
//   3. BOOM/SETTLE — owned by the fight camera (do_settle on the host's on_fight(true)); not this module.
//
// Reduced-motion is passed through to begin_prepare (it holds the iso pose still — no spin, no punch).

import { use_dungeon } from '../world-shell/dungeon_store.js'

import { plant_fight_sword } from './fight_sword.js'
import { play_fight_sfx } from './core/audio/sfx.js'
import { context } from './store.js'

/** The synthetic pre-build orbit footprint (cells). A mid-size board — the fit-to-board framing lands the same
 *  iso distance the real board opens at, so the prepare orbit and the settled board read as one shot. */
const PREP_GRID = 11
/** Belt for the optimistic beat: if neither the success flip nor the lane's abort arrives (a hung tx), release
 *  the camera anyway — a stuck iso view is the one forbidden outcome. Mirrors the cave CEREMONY_TIMEOUT_MS. */
const OPTIMISTIC_ABORT_MS = 20000

/** True when the OS/browser asks for reduced motion — gates the orbit + the zoom-punch (the sword still drops). */
export const prefers_reduced_motion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Pure fold — the fight-lifecycle transition verdict for one store snapshot. 'begin' fires the cinematic ONLY
 * on a FRESH create (`fight_fresh` — stamped by every fight_id-setting door in the same set()); a reload-resume
 * or co-op poll-adopt returns null so the camera direct-engages at the settled board pose instead.
 * 'end' = the fight went away (teardown/abort).
 * @param {string | null} prev_fight_id the fight_id of the PREVIOUS snapshot
 * @param {{ fight_id: string | null, fight_fresh?: boolean }} s the new snapshot
 * @returns {'begin' | 'end' | null}
 */
export function entry_transition(prev_fight_id, s) {
  if (!prev_fight_id && s.fight_id) return s.fight_fresh ? 'begin' : null
  if (prev_fight_id && !s.fight_id) return 'end'
  return null
}

/**
 * Wire the fight-entry cinematic to the fight lifecycle. Returns `{ on_board_ready, dispose }` — the host calls
 * on_board_ready() from its on_fight(true) (the board mounted → the herald sword yields to it), and dispose() on
 * session teardown.
 * @param {{ engine: any, fight_camera: { begin_prepare: (a:any)=>void, set_active:(on:boolean)=>void, is_active:()=>boolean },
 *   board_cell_m: number, get_cave_anchor: () => { x:number,y:number,z:number } | null,
 *   get_player_pos: () => ArrayLike<number>,
 *   plant_sword?: typeof plant_fight_sword }} deps `plant_sword` is a test seam (defaults to the real herald).
 */
export function create_fight_entry({
  engine,
  fight_camera,
  board_cell_m,
  get_cave_anchor,
  get_player_pos,
  plant_sword = plant_fight_sword,
}) {
  /** @type {{ dispose: () => void } | null} the WORLD-fight herald sword (caves plant their own via the ceremony). */
  let sword = null
  /** @type {ReturnType<typeof setTimeout> | null} non-null == an optimistic beat is in flight (press fired,
   *  tx result pending) — the belt that guarantees the camera is never stuck iso on a hung tx. */
  let optimistic_timer = null

  /** A synthetic prepare frame CENTRED on a battlefield point (the world board later centers on the same anchor). */
  const centered_frame = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
    const half = (PREP_GRID * board_cell_m) / 2
    return { origin: { x: x - half, y, z: z - half }, grid_w: PREP_GRID, grid_h: PREP_GRID }
  }
  /** The synthetic board frame the prepare orbit reads until the real board builds. Cave: the real board's own
   *  min-corner (origin_of returns the same cave_anchor), so the orbit is centred exactly on the coming board.
   *  World: centred on the player — they're standing AT the pack they engaged, ≈ where the board will drop. */
  const prepare_frame = (/** @type {{ x:number,y:number,z:number } | null} */ cave) => {
    if (cave) return { origin: { x: cave.x, y: cave.y, z: cave.z }, grid_w: PREP_GRID, grid_h: PREP_GRID }
    const p = get_player_pos()
    return centered_frame(Number(p[0]), Number(p[1]), Number(p[2]))
  }

  const clear_optimistic = () => {
    if (optimistic_timer) clearTimeout(optimistic_timer)
    optimistic_timer = null
  }

  // ── OPTIMISTIC trigger (the press): iso snap + orbit + sting + sword at the battlefield, tx still in flight ──
  const on_engage = (/** @type {any} */ payload) => {
    // never stack a beat on a live fight/cinematic (spam-press, or a press racing a mounted board)
    if (optimistic_timer || fight_camera.is_active() || use_dungeon.getState().fight_id) return
    // D3 — ONE flow, two entries. A DUNGEON press (dungeon_dimension.engage) carries no anchor: orbit the coming
    // board's own min-corner (get_cave_anchor, exactly as the post-tx store-flip path below does) and skip the
    // sword (the D280 cave ceremony plants its own — never a second one). A WORLD press carries the group anchor.
    const cave = get_cave_anchor()
    const a = payload?.anchor
    if (!cave && !a) return // a world engage needs the group anchor; a cave resolves its frame from the board
    fight_camera.begin_prepare({
      frame: cave ? prepare_frame(cave) : centered_frame(Number(a[0]), Number(a[1]), Number(a[2])),
      reduced: prefers_reduced_motion(),
    })
    play_fight_sfx('fight_start')
    if (!cave) sword = plant_sword({ engine, anchor: [Number(a[0]), Number(a[1]), Number(a[2])] })
    optimistic_timer = setTimeout(on_abort, OPTIMISTIC_ABORT_MS) // belt — never a stuck iso view
  }
  // ── the lane's rollback (tx failed/refused) or the belt: despawn the sword, hand the camera back ──
  const on_abort = () => {
    if (!optimistic_timer) return // only an in-flight optimistic beat rolls back (never a confirmed fight)
    clear_optimistic()
    sword?.dispose()
    sword = null
    if (fight_camera.is_active()) fight_camera.set_active(false)
  }
  context.events.on('fight_entry/engage', on_engage)
  context.events.on('fight_entry/abort', on_abort)

  let prev_fight_id = use_dungeon.getState().fight_id
  const off = use_dungeon.subscribe((s) => {
    const verdict = entry_transition(prev_fight_id, s) // fresh-creates-only gate
    prev_fight_id = s.fight_id
    if (verdict === 'begin') {
      // the tx landed UNDER an optimistic beat — the cinematic is already playing: just disarm the belt (the
      // board-ready settle takes it from here). Never a double start (sword/sting/camera all already live).
      if (optimistic_timer) return clear_optimistic()
      const cave = get_cave_anchor()
      fight_camera.begin_prepare({ frame: prepare_frame(cave), reduced: prefers_reduced_motion() })
      play_fight_sfx('fight_start')
      // WORLD fights have no D280 ceremony sword — plant the herald ourselves at the battlefield (the player's
      // spot = the engaged pack). Caves already have one (skip — never double-plant).
      if (!cave) {
        const p = get_player_pos()
        sword = plant_sword({ engine, anchor: [p[0], p[1], p[2]] })
      }
    } else if (verdict === 'end') {
      // The fight went away. If a prepare was still running (the board never built — an aborted create), the
      // adapter's on_fight(false) never fires (fight_on stayed false), so release the camera here.
      clear_optimistic()
      sword?.dispose()
      sword = null
      if (fight_camera.is_active()) fight_camera.set_active(false)
    }
  })

  return {
    /** The board mounted (host's on_fight(true)) — the herald sword yields to it (the camera does the settle). */
    on_board_ready() {
      clear_optimistic() // the board IS the success signal — the belt must never fire under a live board
      sword?.dispose()
      sword = null
    },
    dispose() {
      off()
      context.events.off('fight_entry/engage', on_engage)
      context.events.off('fight_entry/abort', on_abort)
      clear_optimistic()
      sword?.dispose()
      sword = null
    },
  }
}
