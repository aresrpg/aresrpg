// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D137 — THE VOXEL FIGHT ADAPTER: the bridge that lets the engine's tactical BoardHandle paint the SAME truth
// the isometric fight-overlay.js does. PURE WIRING — zero game logic. Every cell set / legality / timing comes
// from fight-engine/overlay_intents.js + the stores; every entity/model/color from the fight slice + the seat;
// every input relays the SAME store action DungeonBoard.jsx / fight-overlay.js already own. The adapter NEVER
// builds a tx, NEVER re-decides legality, NEVER re-implements the phase machine.
//
// THIS IS A SECOND RENDERER. fight-overlay.js (Three, in the roam scene) is renderer #1; this drives the engine
// BoardHandle (WebGPU voxel scene) as renderer #2. They subscribe the identical stores:
//   • phase   — derive_phase(dungeon, fight, my_seat)  (fight-engine/phase.js — the single mount authority)
//   • dungeon — use_dungeon.getState().dungeon         (grid via dungeon_grid_of; obstacles/holes = the D41 seed)
//   • fight   — fight_view() (the memoized core engine_view)  (fighters Map, active/placement/placement_cells/winner —
//               engine_view at READ TIME, never the async context mirror: the BOOT23 mob-rollback fix)
//   • picks   — use_dungeon_turn                       (emit_click / set_placement_pick — the input relay)
// and replays the SAME live combat events fight-overlay reacts to (fightMoved / fightCastResult), mapped onto
// the engine's entity_move / entity_beat.
//
// LIFECYCLE (idempotent on reconcile storms — the engine tolerates same-state):
//   PLACEMENT/ACTIVE → await board.build(build args from the record) · camera_lock · upsert entities · paint
//                      per-phase highlights · relay clicks (placement pick / turn draft).
//   TERMINAL         → freeze (board stays; no new input — the card is the surface, mounted by the 2D HUD).
//   ROAM/EXIT        → teardown + camera_release.

import { Vector3 } from 'three'
import { TEAM_COLORS } from '@aresrpg/engine3/tactical'
import * as project from '@aresrpg/fight/project'
import { fight_store } from '@aresrpg/fight/store'
import { fight_view } from '@aresrpg/fight/project'
import { GRID_CELLS } from '@aresrpg/fight/los'
import { fight_cast_beat_effects } from '@aresrpg/fight/fight_render_events'

import {
  move_reachable_set,
  move_path_dungeon,
  cast_range_set_dungeon,
  manhattan_range_cells,
  placement_cells_by_team,
  placement_active,
  encode as encode_cell,
  decode as decode_cell,
  DEATH_BEAT_S,
  CAST_TRAVEL_S,
  CAST_SAFETY_MS,
} from '../fight-engine/overlay_intents.js'
import {
  derive_phase,
  PHASE,
  STATUS_WON,
  STATUS_FAILED,
  is_placement as phase_is_placement,
  is_active as phase_is_active,
} from '../fight-engine/phase.js'
import i18n from '../i18n'
import { dungeon_grid_of } from '../game/screens/dungeon-grid.js'
import { read_worn_templates, resolve_worn_cosmetics } from '../game/cosmetic_glb.js'
import { context } from '../game/store.js'
import { play_fight_sfx, play_element_sfx, play_sfx } from '../game/core/audio/sfx.js'
import { cast_vfx, burst_vfx, arrival_vfx, is_burst_element, prewarm_fight_vfx } from '../game/fight_cast_vfx.js'
import {
  IMPACT_FEEL,
  MAG_HP_FRACTION,
  magnitude_scale,
  ALL_CAST_ELEMENTS,
  resolve_cast_element,
} from '../game/vfx_map.js'
import { fight_spell } from '../game/screens/hud/fight-spells.js'
import { push_event_toast, trigger_fight_flash } from '../game/core/toast.js'
import { WORLD_BOARD_UNPLACEABLE } from '../game/world_board_seat.js'
import { use_dungeon_turn } from '../game/screens/dungeon-turn.js'
import { init_fight_stream } from '../game/screens/fight-stream.js'
import { use_auth } from '../auth'
import {
  WEAPON_ATTACK_ID,
  WEAPON_ATTACK_RANGE,
  WEAPON_ATTACK_AP,
  // COMBAT-LOG REALTIME: the log lines compose in fight.js (one home) but fire HERE, at each
  // beat, so they stream with the paced replay instead of dumping at packet-dispatch time.
  emit_cast_context_line,
  emit_effect_line,
  emit_death_line,
  emit_trap_line,
} from '../game/core/modules/fight.js'
import { game_log } from '../core/log.js'

import { fight_state_trace } from './fight_state_trace.js'
import { use_dungeon } from './dungeon_store.js'
import { presentation_blocked_cells } from './fight_board_blockers.js'
import { create_fight_render_queue } from './fight_render_queue.js'
// PURE FOLDS live in a sibling module (voxel_fight_folds.js) so they're unit-testable WITHOUT the browser-only
// runtime (context/auth/three) this adapter drags — the same split overlay_intents.js follows. Re-exported here
// so consumers depend on the adapter surface alone.
import {
  VOXEL_BOARD_ORIGIN,
  build_args_from_dungeon,
  entity_spec_from_fighter,
  beats_from_packet,
  split_move_at_traps,
  split_path_at_mp,
  wash_armed_spell,
  cast_face_target,
  seed_range_of,
  seed_cast_flags_of,
  spell_footprint,
  hover_footprint_plan,
  my_seat_of,
  element_of_spell,
  board_lifecycle_decision,
  entity_fold_action,
  turn_input_armed,
} from './voxel_fight_folds.js'

// re-export the pure folds so a consumer/test can depend on the adapter surface alone.
export {
  VOXEL_BOARD_ORIGIN,
  build_args_from_dungeon,
  entity_spec_from_fighter,
  glb_variant_of,
  beats_from_packet,
  seed_range_of,
  my_seat_of,
} from './voxel_fight_folds.js'

// ── [W6] FIGHT-FEEL TUNING (presentation ONLY — zero chain/sim; tuned live via A/B) ───────────────────
// #1 HIT-FLASH: a BRIEF struck-body colorize on the hit frame — the retro tactical "got-hit" read (0.15 s in /
//   0.25 s out; that TIMING lives in the engine's advance_flash). Kept SUBTLE — a red tint, NOT the old abusive
//   full-emissive glow that was cut. A/B it live: `window.__ARES_HITFLASH = false` kills it.
export const HIT_FLASH_TINT = { r: 1.0, g: 0.28, b: 0.28, peak: 0.6 } // red colorize, moderate peak (not a lightbulb)
const hitflash_on = () => (typeof window === 'undefined' ? true : /** @type {any} */ (window).__ARES_HITFLASH !== false)
// #2 AoE RIPPLE: the on-impact target-cell splash (staggered per-cell, delay = dist/speed). 5–15 = the reference
//   extract; the engine's ripple() owns the stagger curve.
const RIPPLE_SPEED = 11
// #3 KNOCKBACK: a shoved body slides FASTER than a run (run ≈5.9 c/s) + a heavier shake when it hits a wall.
const KNOCKBACK_MS_PER_CELL = 82 // ≈12 cells/s — a shove, not a sprint
const WALL_HIT_SHAKE = 0.3 // collision thud (heavier than the 0.18 std hit — ≈ a kill)
// A killed mob's rig lingers DEATH_BEAT_S past its death-beat impact (the SEEN death), then poofs — the same
// death-then-poof clock fight-overlay used (overlay_intents.DEATH_BEAT_S), never a hardcoded despawn delay.
const DEATH_BEAT_MS = Math.round(DEATH_BEAT_S * 1000)
// Missing/stalled rAF must not wait for the 4s whole-cast watchdog before showing the hit. This backstop sits just
// beyond the authored projectile travel window; it does not change the 0.5 cast-animation VFX start.
const CAST_DELIVERY_FALLBACK_MS = Math.round(CAST_TRAVEL_S * 1000) + 250
// A cast's serialized chain (swing → delivery arc → victim reaction → death) resolves the paced slot; a normal
// cast+kill runs ~2.5s. CAST_SAFETY_MS (one home: overlay_intents — the terminal hold cap derives from it) hard-
// ceilings the delivery promise so a wedged VFX can never hang the serial pace queue (a late on_impact still
// plays harmlessly). Above the ≥3s slot floor's natural length, below the presentation watchdog.

/** [fight-feel 2026-07-12, tunable threshold 2026-07-13] Waits for the caster's cast/attack beat to ACTUALLY
 *  finish playing — not just its impact frame (board.entity_beat resolves AT IMPACT, the W4 keystone every
 *  hit/death/float timing depends on; UNCHANGED here) — before the caller's gated step fires (the delivery VFX
 *  mount below, or the death-hold caller's fight-end release). Prefers the beat's own natural-end signal
 *  (`.done` — board_entities' advance_beat resolving it off the SAME per-frame clock that derived the rig's
 *  REAL clip duration); races a computed threshold (`duration_ms × fire_ratio` — DERIVED from the resolved clip
 *  length, never a guessed constant) so a beat that never naturally settles (the caster entity removed
 *  mid-swing) can never hang the cast sequence, and an EARLY `.done` (an aborted/interrupted beat) always wins
 *  the race and fires promptly — never later than the beat's real end. `fire_ratio` picks WHERE that threshold
 *  sits: the default 1.1 (the death-hold caller) sits just ABOVE full length — a pure hang-safety net, since
 *  `.done` normally wins the race at ~1.0×; the delivery-VFX caller below passes 0.8 (fires the VFX at
 *  80% of the cast animation) so the TIMER itself becomes the usual trigger — a deliberate 20%
 *  overlap with the cast anim's tail for punchier fight feel. No resolved duration (an entity absent from the
 *  board) ⇒ nothing to wait on, resolves immediately, regardless of ratio. Whichever side of the race settles
 *  first, the OTHER's timer is always cleared — no orphan timer outlives this wait.
 * @param {(Promise<void> & { done?: Promise<void>, duration_ms?: number }) | null | undefined} beat
 * @param {number} [fire_ratio] fraction of the resolved clip duration to race `.done` against. Default 1.1 (a
 *   hang-safety ceiling above full length, unchanged for the death-hold caller); the delivery-VFX caller passes
 *   0.8 to fire before completion.
 * @returns {Promise<void>} */
function wait_cast_anim_done(beat, fire_ratio = 1.1) {
  const ceiling_ms = (beat?.duration_ms ?? 0) * fire_ratio
  if (!(ceiling_ms > 0)) return Promise.resolve()
  let timer
  const settle = Promise.race([
    beat?.done ?? Promise.resolve(),
    new Promise((resolve) => {
      timer = setTimeout(resolve, ceiling_ms)
    }),
  ])
  return settle.then(() => clearTimeout(timer))
}

// [bug-B] How many times a world-fight board seat may refuse (UNPLACEABLE = the whole footprint is unstreamed
// void) before the fight is treated as permanently unplaceable. Each attempt re-waits the seat's own bounded
// stream-settle (~4s), so 3 gives terrain ~12s of streaming grace across refreshes before the honest give-up
// (a latch + one toast). With the D230 forest-seat fix a refusal is now genuinely rare — this is the safety net.
const MAX_UNPLACEABLE_ATTEMPTS = 3

// ── [p0-fight-init] ONE-SHOT DIAGNOSTIC LATCHES (first-fight-after-transition input-dead probe) ──────────────
// The next live world→fight transition IS the diagnostic: these fire at most ONCE per page each, so a
// single console capture disambiguates the wiring-race branch (teardown/superseded-build racing a live board)
// from the turn-driver branch (dungeon_store's turn_start dedup). Zero spam by construction; remove with the fix.
let p0_logged_live_teardown = false
let p0_logged_superseded_build = false

// ── [fight-probe] RENDERED-LAYER TELEMETRY (permanent, capped): what the renderer actually DID — beats
// rendered, VFX mounted, rig upserts. The gold rows and live triage read this; store state proved able to
// lie about pixels (267/0 green over a visually dead fight).
const FIGHT_PROBE_CAP = 200
const fight_probe =
  typeof window === 'undefined'
    ? null
    : /** @type {any} */ (window.__ARES_FIGHT_PROBE ??= { beats: [], vfx: [], upserts: [] })
const probe_push = (lane, row) => {
  if (!fight_probe) return
  fight_probe[lane].push({ t: Date.now(), ...row })
  if (fight_probe[lane].length > FIGHT_PROBE_CAP) fight_probe[lane].shift()
}

// ── THE ADAPTER (imperative wiring over the pure folds) ───────────────────────────────────────────────────────

/**
 * Wire a live tactical BoardHandle to the dungeon/fight stores. Returns a `{ destroy, get_board_frame,
 * tick_hover }` handle — destroy on scene teardown; get_board_frame feeds the embed's fight camera (D230);
 * tick_hover re-anchors the entity tooltip AND every living fighter's "cell under a fighter" marker every
 * render tick (call after the fight camera's own apply()).
 * @param {import('@aresrpg/engine3/tactical').BoardHandle} board a built create_tactical_board() handle
 * @param {{ origin?: { x: number, y: number, z: number },
 *   origin_of?: () => ({ origin: { x: number, y: number, z: number }, clear_footprint: boolean } |
 *     Promise<{ origin: { x: number, y: number, z: number }, clear_footprint: boolean }>),
 *   on_fight?: (active: boolean) => void }} [opts] D230: `origin_of` resolves the LIVE origin per build (the cave's
 *   board_anchor while a cave is mounted; a WORLD fight seats on the footprint's dominant high plane — may be async
 *   while the terrain streams) plus `clear_footprint` (arms the render-side footprint clear for open-terrain boards
 *   only). `on_fight` flips the embed's camera/controller
 *   authority: board.camera_lock is BANNED here (its iso dolly flies out through the cave roof — architect
 *   bench law) and it lost the writer war anyway (the walk loop re-poses the camera every frame); the EMBED
 *   is the single camera writer and drives the D4 corner-iso pose itself while `on_fight(true)` holds.
 * @returns {{ destroy: () => void, get_board_frame: () => { origin: {x:number,y:number,z:number}, grid_w: number, grid_h: number } | null, tick_hover: () => void }}
 */
export function create_voxel_fight_adapter(
  board,
  {
    origin = VOXEL_BOARD_ORIGIN,
    origin_of = () => ({ origin, clear_footprint: false }),
    on_fight = () => {},
    on_my_turn = () => {},
    cue_shake = (/** @type {number} */ _magnitude) => {}, // [fight-feel] the fight camera's add_shake (embed wires it) — a magnitude-scaled impact jolt on the ONE camera writer (D230). Default no-op (headless/tests).
    engine = null,
    canvas = null,
  } = {}
) {
  // board #49 / PLACEMENT GHOSTS — idempotent one-time install of the p2p turn/placement stream (fight-stream.js
  // owns its own `installed` latch + no-ops with no active dungeon fight — safe on every board (re)build; this
  // adapter is a LEAF the store cluster never imports back, so it is the cycle-safe hook fight-stream.js's own
  // docstring asks for ("the dungeon bridge on the first sync").
  init_fight_stream()
  /** The fight_id the board is currently built for (null = torn down). Guards same-state rebuilds. */
  let built_for = /** @type {string | null} */ (null)
  /** [p0-fight-init FIX] atomic build: true while a board.build is in flight — a build is uninterruptible
   *  (a genuine exit arriving mid-build DEFERS its teardown to the build's settle; a churn-hold just waits). */
  let building = false
  /** A genuine exit arrived while building — run the teardown once the in-flight build settles. */
  let teardown_deferred = false
  /** A (RE)BUILD for a NEW key arrived while a build is already in flight — apply it once the in-flight build
   *  settles (SERIAL builds). Two concurrent async builds would each resolve their OWN origin_of() seat and
   *  interleave the engine's teardown/create (index.js build() has awaits) — the async-origin race. */
  let build_deferred = false
  /** Whether the embed has been told a fight owns the camera (so on_fight isn't spammed). */
  let fight_on = false
  /** The build_key whose board was REFUSED as unplaceable AFTER exhausting its retries. Sticky: once latched a
   *  fight's footprint is treated as permanently unstreamable, so reconcile early-outs for it — one honest toast,
   *  never a rebuild/re-seat loop. Cleared on teardown (a new fight_id mints a fresh build_key regardless). */
  let unplaceable_key = /** @type {string | null} */ (null)
  /** [bug-B — never strand a live fight] A genuinely-unstreamed footprint is usually TRANSIENT: the terrain is
   *  still streaming in. The seat throws UNPLACEABLE only when NO ground exists in the whole footprint, so a later
   *  reconcile can succeed once the chunks arrive — we RETRY the seat across the next refreshes (each attempt
   *  re-waits the seat's own bounded stream-settle) instead of stranding the fight on the FIRST refusal. Count
   *  attempts per fight; latch (above) + one honest toast only after MAX_UNPLACEABLE_ATTEMPTS genuinely fail. */
  let unplaceable_attempts = 0
  let unplaceable_attempts_key = /** @type {string | null} */ (null)
  /** The live built board's frame (origin + grid dims) — the embed's fight camera reads this (D230). */
  let board_frame = /** @type {{ origin: {x:number,y:number,z:number}, grid_w: number, grid_h: number } | null} */ (
    null
  )
  /** The last-painted highlight signature — skip a repaint when nothing that affects a wash changed. */
  let last_paint_key = ''
  let prev_my_turn = false // D242 rider: rising-edge tracker for the your-turn ground flash (board.flash_cell)
  /** The ids currently upserted, so a despawn (a killed/removed fighter) removes its avatar. */
  const entity_ids = new Set()
  /** Ids with a walk animation IN FLIGHT (handed to entity_move, not yet arrived). While an id is here,
   *  sync_entities must NOT re-place it — the engine's entity_upsert snaps the avatar to its logical cell
   *  (place_avatar), which would teleport a walking body mid-lerp (the exact guard fight-overlay's
   *  reconcile_sprites keeps: "snap to the authoritative cell UNLESS a walk is driving this sprite"). */
  const walking = new Set()
  /** The board CELL the adapter last committed each rig to (upsert snap OR a fold-walk start). The fold's
   *  position-reconcile safety net diffs a mob's fresh chain cell against this: a drift with NO replay-beat
   *  owning the id (the fold moved it but a beat didn't) SMOOTH-WALKS it there instead of teleport-snapping. */
  const placed_cell = /** @type {Map<string, { x: number, y: number }>} */ (new Map())
  /** Mob ids whose DESPAWN is in progress (death beat fired → poof scheduled). Guarantees ONE death beat + ONE
   *  removal per corpse across BOTH triggers (a cast-kill's play_cast beat and the fold's trap/DoT detection),
   *  and stops any reconcile from re-standing the corpse. Sticky for the fight; cleared on teardown. */
  const dying = /** @type {Set<string>} */ (new Set())
  /** [⑤c invisibility veil] ids currently wearing the engine heat-haze veil — so the veil is set/cleared exactly
   *  ONCE per invisibility transition (idempotent, mirrors wire_fight_invisibility's visible-latch), driven by the
   *  fold's f.invisible truth each reconcile. */
  const hazed_ids = /** @type {Set<string>} */ (new Set())
  /** Pending corpse-poof timers — cleared on teardown so a stale poof can never remove a REUSED `mob-N` id that a
   *  fresh fight just spawned (mob ids are per-fight array indices). */
  const despawn_timers = /** @type {Set<ReturnType<typeof setTimeout>>} */ (new Set())
  /** [F1] live cast-VFX handles (flare/orb/impact flipbooks) — disposed on teardown so a torn-down board
   *  never leaves a projectile mid-flight; each prunes itself on natural finish (cast_vfx on_done). */
  const cast_vfx_live = /** @type {Set<{ dispose: () => void }>} */ (new Set())
  /** [entity-anchor] ids the "cell under a fighter" marker is CURRENTLY tracking — the tick_entity_anchors
   *  diff base (mirrors the entity_ids/walking Set-diff pattern above): any id that drops out between two
   *  ticks (dead/despawned/torn down) gets its marker cleared exactly once. */
  const anchored_ids = /** @type {Set<string>} */ (new Set())

  /** [cosmetics-in-fights] The `/v1/encyclopedia` template catalog (template_id → Display), loaded ONCE so the
   *  worn-cosmetic join can map a character's equipped hat/cloak to its quilt appearance. Mirrors the roam
   *  avatar's identical one-shot join (embed_voxel_player.js): a late result is harmless (sync_entities
   *  re-resolves worn every reconcile), and a rejected load (no rpc reachable) just leaves worn GLBs unmounted
   *  — never a crash. Items authored with an explicit `appearance` resolve without this map. */
  let worn_templates = /** @type {Map<string, any>} */ (new Map())
  void read_worn_templates()
    .then((templates) => {
      worn_templates = templates
    })
    .catch((error) => game_log('worn', 'fight cosmetic template join failed — worn GLBs stay unmounted', error))

  /** The adapter's ONE live fight read — the app-wide memoized core projection (fight/project.js
   *  `fight_view`): synchronous engine_view (presentation mask included), one shared computation per core
   *  change (roster rides the core's own ctx now), reference-stable for the 60–120 calls/s tooltip path. */
  const read_board_fight = fight_view
  const read_board_fight_state = () => ({ fight: read_board_fight() })

  // ── the raw board input → the SAME store relay fight-overlay.js uses (the adapter decides MEANING; the engine
  //    only reports WHICH cell was clicked). No tx here — DungeonBoard.jsx owns the draft + commit; the placement
  //    READY owns place_at. ──
  const off_click = board.on(
    'cell_click',
    /** @type {any} */ (cell) => {
      const fight = read_board_fight()
      if (!fight || fight.winner !== -1) return
      // v1.2 NULL CLICK (a real click that MISSED the board): its one meaning is "outside every targetable
      // cell" — forward it to the CORE's deselect rule (store 'board_click': armed ∧ ¬targetable ⇒ disarm;
      // a no-op when nothing is armed). CONTRACT: an off-board click must unselect the armed spell.
      if (!cell) {
        fight_store.getState().input({ type: 'board_click', cell: null, targetable: false })
        return
      }
      const { dungeon } = use_dungeon.getState()
      if (!dungeon) return
      const address = fight.my_entity_id
      // PLACEMENT: a click on one of MY team's FREE start cells is a LOCAL optimistic pick (zero tx) — reuse the
      // EXACT echo reducer + pick stash + masked intent fight-overlay's click_cell uses; READY fires place_at.
      if (fight.placement) {
        const me = address ? fight.fighters.get(address) : null
        if (!me) return
        // PICK-vs-DENY is the CORE's decision (project.placement_click, M3 render contract) — the adapter only
        // relays the verdict: 'pick' → the local pick stash (S2 flip: the ONE local placement truth; READY
        // commits it via place_at), 'deny' → the NO-DEAD-CLICK package (pulse the legal start cells +
        // nudge the banner + a soft deny cue, so the player sees exactly where they CAN place).
        const verdict = project.placement_click(fight_store.getState(), cell)
        if (verdict === 'pick') {
          const picked_cell = encode_cell(cell.x, cell.y)
          use_dungeon_turn.getState().set_placement_pick(picked_cell)
          // Predict the selection through the SAME Placed fold a confirmed receipt uses. The stash above remains
          // READY's tx target; this intent is the rendered fighter-cell truth and reconciles at the receipt floor.
          fight_store.getState().input({
            type: 'intent',
            intent: { kind: 'Placed', character: me.id, cell: picked_cell },
          })
        } else if (verdict === 'deny') {
          board.pulse_cells(fight.placement_cells?.[me.team] ?? [])
          play_fight_sfx('deny')
          use_dungeon_turn.getState().nudge_placement()
        }
        return
      }
      // ACTIVE: only relay on MY turn — a raw click is a turn-draft pick. emit_click(cell) lets DungeonBoard's
      // on_cell_click decide move-vs-cast (a castable mob cell casts, else a reachable cell moves) — the identical
      // decision fight-overlay's move-click relay triggers. cast_only is false: a plain board click is cast-preferred
      // in DungeonBoard already, so one relay covers both without a separate drag surface.
      const active = fight.active_entity_id ? fight.fighters.get(fight.active_entity_id) : null
      // END-TURN PRESS LAW + PRESENTATION GATE (voxel_fight_folds.turn_input_armed): `busy`
      // (use_dungeon) is true from commit_turn's first line — the instant END TURN is pressed, or a background
      // auto-commit fires — through the whole pending window; `presenting` is true while the mob cascade is still
      // animating (the chain hands the turn back to me the moment the paced replay starts). Either disarms the
      // click relay, so a cell click never drafts while my turn is only chain-true but not yet playable.
      const presenting = project.presenting(fight_store.getState()) // S2: derived from the core's unacked wave
      if (!turn_input_armed(!!active && active.id === address, use_dungeon.getState().busy, presenting)) return
      // out-of-board clicks never encode a bogus cell (the engine only emits in-bounds cells, but guard anyway).
      const grid = dungeon_grid_of(dungeon)
      if (cell.x < 0 || cell.x >= grid.width || cell.y < 0 || cell.y >= grid.height) return
      use_dungeon_turn.getState().emit_click(encode_cell(cell.x, cell.y))
    }
  )

  // ── replay: the SAME live combat events fight-overlay reacts to → entity_move / entity_beat. Their payloads
  //    already carry the LEGAL waypoints (emit_fight_deltas / optimistic_walk route via legal_move_path), so the
  //    adapter passes them straight through — zero pathfinding here. The PLAYBACK is split from the EVENT ROUTING
  //    a PLAYER's action plays the instant it arrives (no artificial delay), while a MOB's
  //    action is BUFFERED per turn and drained through the serial pace queue so each mob beat reads ≥3s and never
  //    blurs through (the chain resolves the whole mob cascade in one tx → one synchronous burst of packets). ──

  // [D303] GAIT LAW: a path of
  // ≥3 cells travels at RUN pace, 1-2 cells at WALK pace — players AND mobs (one board language; the ≥3s
  // mob slot floor is separate and unchanged). The ENGINE resolves the loco clip + timeScale from the
  // rig's real inventory (board_entities resolve_gait) so feet track the ground at either pace.
  const RUN_MS_PER_CELL = 170 // ≈5.9 cells/s
  const WALK_MS_PER_CELL = 480 // ≈2.1 cells/s
  /** The actual walk playback — returns the arrival promise. Marks the walk in-flight so this poll's sync_entities
   *  won't teleport the avatar mid-lerp; clears on arrival. Constant cells/second = the retro walk pace (contract).
   *  [terminal-hold] bracketed as a live presentation chain — the terminal gate holds the fight-end surface while
   *  any walk is still playing (a killing wave's approach walk is part of the death sequence that must stay visible). */
  /** [trap-on-mob] THE PAUSE BEAT: the mob has walked ONTO one of MY placed traps —
   *  play the trigger IN PLACE (an earth ERUPTION burst at the cell + the mob's HIT flinch carrying the damage
   *  floater + a magnitude shake/flash/SFX), spring the marker so it detonates ONCE and vanishes, then the caller
   *  RESUMES the remaining walk. Reuses the delivery-VFX (burst_vfx) + entity_beat + impact machinery — NO new art
   *  (earth = the heaviest, gold-tinted ground preset, thematically a trap). A no-engine path skips the burst
   *  (burst_vfx no-ops) but the board still drives the flinch+float, so the pause→trigger→resume SEQUENCE holds. */
  const play_trap_trigger = async (/** @type {string} */ id, /** @type {any} */ hit) => {
    if (!entity_ids.has(id)) return
    const { cell } = hit
    if (hit.killed) dying.add(id) // claim the death before HP remask can make the snapshot fold race this sequence
    game_log('fight-trap', 'PAUSE at trap cell', { id, cell, damage: hit.damage, t: performance.now() })
    // the fold already retired this trap (a committed detonation flips my_traps `gone` at receipt-arrival, and the
    // store subscription repainted the 'trap' channel from engine_view.my_traps) — no client-side spring here.
    const mag = magnitude_scale(hit.damage)
    if (engine && board_frame) {
      const at = cell_cast_world(board_frame.origin, cell)
      const handle = burst_vfx({
        engine,
        at,
        element: 'earth',
        magnitude: mag,
        on_done: () => cast_vfx_live.delete(handle),
      })
      cast_vfx_live.add(handle)
    }
    const feel = IMPACT_FEEL.earth
    play_element_sfx('earth', 'impact')
    cue_shake(feel.shake * mag)
    trigger_fight_flash({ color: feel.flash, intensity: 0.3 * mag, grade: feel.grade })
    game_log('fight-trap', 'trap VFX + floater', { id, cell, damage: hit.damage, t: performance.now() })
    // the mob flinches AT the trap cell, carrying the damage floater (mirrors beats_from_packet's float shape).
    const done = board.entity_beat(id, { anim: 'hit', float: { text: `-${hit.damage}`, kind: 'damage' }, face: cell })
    // COMBAT LOG (realtime): "<mob> triggered a trap for N", streamed WITH the floater at this pause beat.
    emit_trap_line(read_board_fight_state, context.dispatch, { target_id: id, damage: hit.damage })
    void done.then(() => {
      if (hitflash_on()) board.flash_entity?.(id, HIT_FLASH_TINT)
    })
    await wait_cast_anim_done(done) // hold through the natural flinch/floater end — THEN resume the walk
    if (hit.killed && entity_ids.has(id)) {
      const death_done = board.entity_beat(id, { anim: 'death', face: cell })
      emit_death_line(read_board_fight_state, context.dispatch, { target_id: id })
      schedule_corpse_removal(id, death_done)
      await death_done
    }
    game_log('fight-trap', 'RESUME move', { id, t: performance.now() })
  }

  /** A generic queue's trap beat owns only the detonation. Damage and death are distinct later events, so a
   * pushed target visibly finishes its slide before the boom, number, and corpse beats consume the same queue. */
  const play_trap_boom = async (/** @type {any} */ event) => {
    const id = event.entity_id ?? event.target_id
    const { cell } = event
    if (!cell) return
    const mag = magnitude_scale(event.damage ?? 0)
    if (engine && board_frame) {
      const at = cell_cast_world(board_frame.origin, cell)
      const handle = burst_vfx({
        engine,
        at,
        element: 'earth',
        magnitude: mag,
        on_done: () => cast_vfx_live.delete(handle),
      })
      cast_vfx_live.add(handle)
    }
    const feel = IMPACT_FEEL.earth
    play_element_sfx('earth', 'impact')
    cue_shake(feel.shake * mag)
    trigger_fight_flash({ color: feel.flash, intensity: 0.3 * mag, grade: feel.grade })
    if (id) emit_trap_line(read_board_fight_state, context.dispatch, { target_id: id, damage: event.damage ?? 0 })
  }

  /** One queued number/reaction beat. It deliberately does not kill the rig; `play_death_beat` is the next event. */
  const play_damage_beat = async (/** @type {any} */ event) => {
    const id = event.target_id
    if (!id || !entity_ids.has(id)) return false
    if (event.killed) dying.add(id)
    const source = event.source_id ? read_board_fight()?.fighters?.get(event.source_id) : null
    const amount = Math.max(0, Number(event.damage ?? event.heal ?? 0))
    const kind = event.heal != null ? 'heal' : event.is_critical ? 'crit' : 'damage'
    const done = board.entity_beat(id, {
      anim: kind === 'heal' ? 'idle' : 'hit',
      float: { text: `${kind === 'heal' ? '+' : '-'}${amount}`, kind },
      face: source?.cell,
    })
    if (kind !== 'heal' && hitflash_on()) void done.then(() => board.flash_entity?.(id, HIT_FLASH_TINT))
    if (event.source_id)
      emit_effect_line(read_board_fight_state, context.dispatch, {
        entity_id: event.source_id,
        effect: {
          target_id: id,
          damage: event.damage,
          heal: event.heal,
          new_health: event.new_health,
          killed: event.killed,
        },
        is_critical: event.is_critical,
      })
    await done
    return true
  }

  /** One queued death beat, always after its damage number. */
  const play_death_beat = async (/** @type {any} */ event) => {
    const id = event.target_id
    if (!id || !entity_ids.has(id)) return
    dying.add(id)
    const done = board.entity_beat(id, { anim: 'death' })
    emit_death_line(read_board_fight_state, context.dispatch, { target_id: id })
    if (is_mob(id)) schedule_corpse_removal(id, done)
    await done
    if (!is_mob(id)) {
      await wait_cast_anim_done(done)
      remove_corpse(id)
    }
  }

  const play_move = async (packet) => {
    if (!packet?.path?.length || !entity_ids.has(packet.entity_id)) return
    const id = packet.entity_id
    walking.add(id)
    const chain_done = () => walking.delete(id)
    // [W6 #3] KNOCKBACK: a displacement (push/pull) slides FAST with no running legs; on the wall/entity
    // collision the sim flagged (packet.collision), a heavier shake fires as the body lands against the blocker.
    if (packet.knockback) {
      return board
        .entity_move(id, packet.path, { cells_per_second: 1000 / KNOCKBACK_MS_PER_CELL, knockback: true })
        .then(() => {
          // The receipt displacement is now the rendered cell authority. Without this stamp the next poll compares
          // the pre-push mirror with the post-push snapshot and replays the same path as an ordinary walk.
          const destination = packet.path.at(-1)
          if (destination) placed_cell.set(id, { x: destination.x, y: destination.y })
          // [2026-07-11] the thud was shake-only (silent) — a body slamming a wall/entity now SOUNDS like one too.
          if (packet.collision) {
            cue_shake(WALL_HIT_SHAKE) // [fight-feel] the thud rides the fight-cam writer too
            play_sfx('knockback')
          }
        })
        .finally(chain_done)
    }
    // GAIT (D303) is derived from the WHOLE path length ONCE — a trap split into segments must NOT re-classify a
    // 3+ cell run as a series of short walks. [trap-on-mob] split_move_at_traps yields one plain step (no traps)
    // or walk→PAUSE(trigger)→resume steps; each walk segment travels at the shared gait, the trap pauses between.
    const gait = packet.path.length >= 3 ? 'run' : 'walk'
    const cps = 1000 / (gait === 'run' ? RUN_MS_PER_CELL : WALK_MS_PER_CELL)
    try {
      for (const step of split_move_at_traps(packet.path, packet.trap_hits)) {
        if (step.walk.length) await board.entity_move(id, step.walk, { cells_per_second: cps, gait })
        if (step.trap) {
          await play_trap_trigger(id, step.trap)
          if (step.trap.killed) break
        }
      }
    } finally {
      chain_done()
    }
  }
  /** The actual cast playback — a STRICTLY SERIAL sequence (it's a sequence, start to finish): the
   *  attacker's swing + delivery VFX play to completion, THEN the victim's impact package (flash/reaction/shake),
   *  THEN the floating number, THEN — on a kill — the death beat + depop. The victim reaction NEVER fires while
   *  the delivery arc is still traveling (it rides on_impact, the delivery LANDING), and the returned promise
   *  resolves only when that whole chain (incl. any death beat) completes — so a paced mob slot never starts the
   *  NEXT mob's attack while this mob's victim is still reacting. */
  const play_cast = async (packet) => {
    if (!packet?.entity_id) return Promise.resolve()
    return play_cast_inner(packet)
  }
  const play_cast_inner = async (packet) => {
    const caster = read_board_fight()?.fighters?.get(packet.entity_id)
    // COMBAT LOG (realtime): the "<caster> cast <spell>" context line fires HERE — at the cast's own beat (paced
    // for a mob, instant for the player), never batched at packet-dispatch. The per-effect + death lines fire
    // below as their victim beats play (play_victim_reaction). One composition home = fight.js.
    emit_cast_context_line(read_board_fight_state, context.dispatch, {
      entity_id: packet.entity_id,
      spell_id: packet.spell_id,
    })
    // Element resolution, ONE home per fact: the weapon slot is a sentinel with no spell row (its id is
    // the routing fact); a packet whose effects HEAL (and damage nobody) is a heal beat even when its spell id
    // can't resolve (a healer MOB's cast — mob ids aren't in fight-spells.json); everything else reads its
    // on-chain row via element_of_spell (which owns the seed-side heal-kind branch).
    const effects = packet.effects ?? []
    const packet_heals = effects.some((e) => (e?.heal ?? 0) > 0) && !effects.some((e) => (e?.damage ?? 0) > 0)
    const spell_element =
      packet.spell_id === WEAPON_ATTACK_ID ? 'weapon' : packet_heals ? 'heal' : element_of_spell(packet.spell_id)
    // [phase-2 mob VFX] a mob's basic attack isn't in the seed spellbook (element_of_spell → 'neutral'), so a mob
    // cast fell back to the neutral violet. Thread the caster mob's OWN on-chain element so a fire/water/earth/air
    // mob casts its element's VFX+SFX. One home: vfx_map. [M3] read it off the CORE view (engine_view mob rows
    // carry it) — the last use_dungeon read on the cast path died with the render contract.
    const mob_element_code = is_mob(packet.entity_id)
      ? read_board_fight()?.fighters?.get(packet.entity_id)?.element
      : undefined
    const element = resolve_cast_element(spell_element, mob_element_code)
    // [b_spell VFX variety] the per-spell variant object for the cast/burst variant selector (vfx_variants.variant_for):
    // `id` drives the deterministic hash, `classType`+`role` split the family, `element` picks it. Built from the
    // SAME on-chain row element_of_spell reads (fight_spell) ⇒ one home. `role` is now generated end-to-end
    // (the seed projection derives it from kind for today's plain damage/heal seed; a real dot/trap/punishment role
    // in a future seed flows straight through), so the role-gated variant branches are LIVE. A mob/unresolved id
    // (no row) still yields {id, element} ⇒ a fire/water/earth/air mob cast gets its element's variant orb too.
    const cast_row = fight_spell(packet.spell_id)
    const cast_spell = { id: packet.spell_id, classType: cast_row?.class, element, role: cast_row?.role }
    // P0 item 8, MOB half: a mob's CASTER-layer SFX fires HERE — the whoosh lands WITH the attack anim
    // (fight-sfx.js owns the raw/player caster layer and skips mobs; two paths, one voice each).
    // [2026-07-11] a physical weapon swing has no magic windup — mirrors fight-sfx.js's player-side guard +
    // sfx.js's 'weapon:impact'-only coverage comment (melee never voices a caster-layer sound, impact only).
    if (is_mob(packet.entity_id) && element !== 'weapon') play_element_sfx(element, 'cast')

    const render_delivery = !!(engine && board_frame && caster?.cell && packet.target)
    // beats_from_packet always leads with the caster's ATTACK swing; the rest are the struck targets' HIT beats.
    const [caster_beat, ...victim_beats] = beats_from_packet(packet)

    // CLAIM this packet's own kills SYNCHRONOUSLY (before the return) so the fold's despawn — which reconciles
    // on the SAME poll that dispatched this cast — sees them `dying` and SKIPS them, ceding the death to this
    // cast's SEQUENCED hit → number → death order. Without the claim the fold's plain, immediate death
    // beat would race ahead of the delivery-gated one (the cast fires its death only at the orb LANDING). The
    // guard below still skips a mob dying from a DIFFERENT trigger — `my_kills` un-skips only this cast's own.
    const my_kills = new Set(effects.filter((e) => e?.killed).map((e) => e.target_id))
    for (const id of my_kills) dying.add(id)

    // 1) THE ATTACKER'S SWING starts now, facing the STRIKE cell. PLAYER-ONLY: the delivery VFX below WAITS for
    //    ~50% of this swing's length (wait_cast_anim_done, fire_ratio=0.5 — impact syncs with the swing apex,
    //    tuned down from an earlier 80%) before mounting — the W4 impact-resolve (IMPACT_FRAMES' 60% overlap) is
    //    UNCHANGED for every other caller (hit/death/float timing still reads the impact frame). MOBS keep
    //    today's fire-and-forget timing: the same wait stacked onto a paced mob slot (move + wait +
    //    windup/travel/impact) risks tripping the tuned MOB_WAVE_CAP_MS force-drain watchdog — a separate tuned
    //    pacing ceiling this ticket doesn't touch. A mob's swing still plays in full; only the VFX-start gate is
    //    player-only (mob symmetry only when free — this isn't).
    if (caster_beat && entity_ids.has(caster_beat.id)) {
      const beat = board.entity_beat(caster_beat.id, {
        anim: 'attack',
        face: cast_face_target(caster.cell, packet.target),
      })
      if (!is_mob(caster_beat.id)) {
        await wait_cast_anim_done(beat, 0.5)
        // TORN-DOWN GUARD: the ONLY yield point above — a board torn down mid-wait (fight left/forfeited) must
        // never mount VFX on a dead scene or read the (now-nulled) board_frame below. Bail clean: nothing left
        // to play, and nothing left dangling (wait_cast_anim_done already cleared its own fallback timer).
        if (!board_frame || !entity_ids.has(caster_beat.id)) return
      }
    }

    // 2) THE VICTIM REACTION — the flinch (+ hit-flash) carrying the damage float, then (on a kill) the death
    //    beat chained AFTER the hit's impact (order: hit → number → death → depop). Fired only at the
    //    delivery LANDING (below), never before it. Returns a promise resolved when every victim beat + its
    //    death chain completes — the gate the paced slot waits on so mob 2 can't start mid-reaction.
    // AoE victim beats are STRICTLY SEQUENTIAL — one victim's WHOLE beat (flinch →
    // floating number → death → poof) completes before the NEXT victim's beat starts. The same "single queue
    // per turn, nothing parallel ever" law applied across targets — never a simultaneous Promise.all.
    const play_victim_reaction = async () => {
      // COMBAT LOG (realtime), NON-DAMAGE half: heal / absorb / AP-MP-drain effects carry NO victim beat
      // (beats_from_packet only makes beats for positive damage), so their lines stream once HERE — at the
      // delivery landing, the moment the effect lands. The damage lines fire per-victim below, each AT its own
      // flinch/floater beat. Composition home stays fight.js (emit_effect_line).
      for (const effect of effects)
        if ((effect?.damage ?? 0) <= 0)
          emit_effect_line(read_board_fight_state, context.dispatch, {
            entity_id: packet.entity_id,
            effect,
            is_critical: packet.is_critical,
          })
      for (const beat of victim_beats) {
        if (!entity_ids.has(beat.id)) continue
        // a fighter dying from a DIFFERENT trigger (a prior cast / the fold) already owns its ONE death beat — never
        // overwrite it. This cast's OWN kills (my_kills, pre-claimed above) are the exception: play their sequence.
        if (dying.has(beat.id) && !my_kills.has(beat.id)) continue
        const face = caster?.cell ?? undefined // the victim turns toward its attacker (item 7 facing)
        const done = board.entity_beat(beat.id, {
          anim: beat.anim, // always 'hit' — the flinch; a kill chains its death off this beat's done (below)
          float: beat.float ?? undefined,
          face,
        })
        // COMBAT LOG (realtime): the "<caster> hit <target> for N" line streams WITH this victim's floater beat
        // (its damage effect — the 1:1 source beats_from_packet built this beat from). One home = fight.js.
        const dmg_effect = effects.find((e) => e?.target_id === beat.id && (e?.damage ?? 0) > 0)
        if (dmg_effect)
          emit_effect_line(read_board_fight_state, context.dispatch, {
            entity_id: packet.entity_id,
            effect: dmg_effect,
            is_critical: packet.is_critical,
          })
        // [W6 #1] HIT-FLASH — a subtle struck-body tint on THIS victim's impact frame (mid-clip). Kill switch:
        // __ARES_HITFLASH. Every victim beat carries a float and is never the caster, so this never flashes a heal.
        if (beat.float?.kind !== 'heal' && hitflash_on())
          void done.then(() => board.flash_entity?.(beat.id, HIT_FLASH_TINT))
        // the mob-cast HP hold releases on the hit's impact resolve (unchanged fight-intents holds; the adapter
        // only picks the release POINT). A non-finishing multi-mob hit carries no release_target (held for later).
        await done // SERIAL: block until THIS victim's hit + number resolves before its death / the next victim
        // ORDER LAW: hit → number → THEN death → depop. The death beat chains AFTER this hit's impact
        // resolves (board_entities' entity_beat OVERWRITES the live beat, so firing hit+death together clobbers
        // the flinch). A MOB's death also schedules its one poof; a player's death just plays (board_entities owns it).
        if (beat.then_death) {
          const death_done = board.entity_beat(beat.id, { anim: 'death', face })
          // COMBAT LOG (realtime): the "<name> died" line streams AT the death beat. emit_death_line is
          // UNCONDITIONAL (the fold already flipped the slice dead by now — emit_deaths' pre-fold dedup would
          // wrongly swallow it here). ONE per corpse: a mob dying from another trigger was `continue`d above; a
          // trap/DoT kill (no victim beat) logs at the fold's despawn death beat instead. No double-log.
          emit_death_line(read_board_fight_state, context.dispatch, { target_id: beat.id })
          if (is_mob(beat.id)) schedule_corpse_removal(beat.id, death_done)
          await death_done // the next victim only starts once this corpse's death beat has fully played
          // [terminal-hold 2026-07-13] a PLAYER death (the defeat case) holds the chain to the death clip's
          // NATURAL END (entity_beat resolves at IMPACT — mid-clip), so the fight-end surface waits for the whole
          // death animation, not half of it (hit anim → number → death animation, and only then end the
          // fight"). Event-first (.done) with the computed ×1.1 ceiling; MOB corpses keep today's exact timing —
          // their poof choreography (schedule_corpse_removal ≈ impact + DEATH_BEAT_S) REMOVES the rig before its
          // clip end, so .done would never fire and every mob kill would eat the fallback wait for nothing.
          if (!is_mob(beat.id)) {
            await wait_cast_anim_done(death_done)
            remove_corpse(beat.id)
          }
        }
      }
    }
    const play_displacements = async () => {
      for (const displacement of packet.displacements ?? []) {
        fight_state_trace('displacement_play_started', {
          caster_id: packet.entity_id,
          target_id: displacement.target_id,
          requested: displacement.requested,
          blocked: displacement.blocked,
        })
        await play_move({
          fight_id: packet.fight_id,
          entity_id: displacement.target_id,
          path: displacement.path,
          mp_remaining: read_board_fight()?.fighters?.get(displacement.target_id)?.mp ?? 0,
          knockback: true,
          collision: displacement.collision,
        })
        fight_state_trace('displacement_play_finished', {
          caster_id: packet.entity_id,
          target_id: displacement.target_id,
        })
      }
    }
    const play_delivery_reactions = async () => {
      if (packet.split_render) return
      await play_displacements()
      await play_victim_reaction()
    }

    // 3) THE DELIVERY. When it LANDS (on_impact) the impact package fires, THEN the victim reaction — never
    //    before the arc/burst finishes. A headless/no-engine path has no arc, so the reaction is
    //    sequenced on the next microtask (ordering preserved, unit paths never hang).
    probe_push('vfx', {
      caster: packet.entity_id,
      spell_id: packet.spell_id ?? null,
      element,
      delivered: render_delivery,
    })
    return new Promise((resolve) => {
      // SAFETY: the paced slot AWAITS this promise, and the SERIAL pace queue WEDGES on a task that never settles
      // (its tail never links the next slot). So a delivery VFX that never lands (an engine stall, a dispose
      // mid-flight) must NOT hang the cascade — resolve after a hard ceiling regardless (the ≥3s slot floor + the
      // presentation watchdog are the other backstops). A late on_impact still plays its beats harmlessly.
      let settled = false
      let delivery_started = false
      let delivery_fallback = /** @type {ReturnType<typeof setTimeout> | null} */ (null)
      const safety = setTimeout(() => finish(), CAST_SAFETY_MS)
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(safety)
        resolve()
      }
      if (!render_delivery) {
        delivery_started = true
        return void Promise.resolve().then(() => {
          void play_delivery_reactions().then(finish)
        })
      }
      const killed = effects.some((e) => e?.killed)
      const crit = !!packet.is_critical // [W6 #4] the on-chain crit flag — amplifies the impact feel (shake + flash)
      // Magnitude-aware read (a nuke should read bigger than a jab): sum the beat's damage+heal → the vfx_map
      // curve → ONE multiplier shared by the VFX footprint, the camera shake, and the flash intensity.
      const beat_amount = effects.reduce((s, e) => s + Math.max(0, e?.damage ?? 0) + Math.max(0, e?.heal ?? 0), 0)
      // [fight-feel 2026-07-11] TARGET-RELATIVE reference: anchor the magnitude curve on the beat's PRIMARY
      // damaged target's max HP (the headline hit) so a big fraction of a mob's OWN health reads huge at any level.
      const dmg_effects = effects.filter((e) => (e?.damage ?? 0) > 0)
      const primary_dmg = dmg_effects.length ? dmg_effects.reduce((a, e) => (e.damage > a.damage ? e : a)) : null
      const primary_target = primary_dmg ? read_board_fight()?.fighters?.get(primary_dmg.target_id) : null
      const mag_ref = primary_target?.health_max > 0 ? primary_target.health_max * MAG_HP_FRACTION : undefined
      const mag = magnitude_scale(beat_amount, mag_ref)
      const to_world = cell_cast_world(board_frame.origin, packet.target)
      const impact_package = () => {
        // Heal-beat fix: 'heal' has no row in sfx.js's ELEMENT_SFX_COVERAGE (it is not a damage
        // element), so a heal beat (element === 'heal') would silently fall back to the neutral IMPACT thwack —
        // the wrong voice for "someone got healed". Route heals to the dedicated synthesized sfx.js 'heal' cue instead.
        if (element === 'heal') play_fight_sfx('heal')
        else play_element_sfx(element, 'impact') // TARGET layer — one home, both paths, on the land
        // FIX 2026-07-11 (crit/kill sfx were indistinguishable from a normal hit): two ACCENT layers on top of the impact —
        // a crit finally SOUNDS distinct from a normal hit, and a kill gets its own stinger instead of reading
        // identical to any other impact despite the dedicated desaturate grade + death VFX burst below.
        if (crit) play_sfx('crit')
        if (killed) play_sfx('death')
        // [W6 #2] AoE ripple + the AoE grade read: the struck cells = the target cell + every struck fighter's
        // cell (a single-cell seed spell reads as one clean pop; AoE splashes AND washes the screen edges).
        const fstate = read_board_fight()
        const hit_cells = /** @type {{x:number,y:number}[]} */ ([])
        const seen = new Set()
        const add_cell = (/** @type {any} */ c) => {
          if (!c) return
          const k = `${c.x},${c.y}`
          if (!seen.has(k)) {
            seen.add(k)
            hit_cells.push({ x: c.x, y: c.y })
          }
        }
        add_cell(packet.target)
        for (const ef of effects) add_cell(fstate?.fighters?.get(ef?.target_id)?.cell)
        if (hit_cells.length) board.ripple?.(hit_cells, { origin: packet.target ?? hit_cells[0], speed: RIPPLE_SPEED })
        // [2026-07-11] the AoE WASH layer — a splash spell (≥3 struck cells, the SAME threshold the element-wash
        // screen grade below already uses) finally sounds bigger, not just looks bigger.
        if (hit_cells.length >= 3) play_element_sfx(element, 'aoe')
        // [fight-feel 2026-07-11] the impact PACKAGE, magnitude-scaled: a camera shake on the ONE fight-cam
        // writer (a kill jolts with death's heavier magnitude — the engine board.shake is inert here, the fight
        // camera overwrites the pose every frame, D230), plus an element-coloured screen flash + GRADE moment
        // (a KILL desaturates the board · a HEAL warms it · a big AoE washes the edges in the element colour).
        // Crit amplifies both. All camera/CSS — no post-process pass (engine ban stands).
        const feel = IMPACT_FEEL[element] ?? IMPACT_FEEL.neutral
        cue_shake((killed ? IMPACT_FEEL.death.shake : feel.shake) * mag * (crit ? 1.4 : 1))
        const flash = killed ? IMPACT_FEEL.death : feel
        const grade = killed ? 'desaturate' : hit_cells.length >= 3 ? 'element-wash' : feel.grade
        trigger_fight_flash({ color: flash.flash, intensity: (killed ? 0.5 : 0.3) * mag * (crit ? 1.25 : 1), grade })
        // [S-23] the death burst rides the SAME impact clock as the kill it visualises (contact_s=0 — this
        // frame), layered over the element impact at the victim's cell.
        if (killed) {
          const death = burst_vfx({
            engine,
            at: to_world,
            element: 'death',
            magnitude: mag,
            on_done: () => cast_vfx_live.delete(death),
          })
          cast_vfx_live.add(death)
        }
      }
      // THE DELIVERY LANDING is the ONE clock: fire the impact package, THEN the victim reaction (in order),
      // and resolve the cast promise when that reaction completes. BURST elements (earth/weapon) land impact-only
      // on the contact clock; full cast elements travel the windup → projectile → impact arc first.
      const on_delivery = () => {
        if (delivery_started) return
        delivery_started = true
        if (delivery_fallback) clearTimeout(delivery_fallback)
        impact_package()
        void play_delivery_reactions().then(finish)
      }
      // If the renderer's rAF/on_impact never arrives, the packet still owns a complete local sequence. Fire the
      // same impact package + victim chain from the authored travel deadline instead of silently finishing at 4s.
      delivery_fallback = setTimeout(on_delivery, CAST_DELIVERY_FALLBACK_MS)
      const handle = is_burst_element(element)
        ? burst_vfx({
            engine,
            at: to_world,
            element,
            magnitude: mag,
            spell: cast_spell, // [b_spell] per-spell burst variety (earth/weapon) — mirrors the cast_vfx orb hook (burst-suitable variants only)
            on_impact: on_delivery,
            on_done: () => cast_vfx_live.delete(handle),
          })
        : cast_vfx({
            engine,
            from: cell_cast_world(board_frame.origin, caster.cell),
            to: to_world,
            element,
            magnitude: mag,
            spell: cast_spell, // [b_spell] the orb layer swaps to this spell's mapped variant preset (PRESETS-guarded)
            on_impact: on_delivery,
            on_done: () => cast_vfx_live.delete(handle),
          })
      cast_vfx_live.add(handle)
    })
  }

  // ONE renderer-neutral queue owns local predictions and receipt (wave) turns.
  let render_queue = /** @type {ReturnType<typeof create_fight_render_queue> | null} */ (null)
  const is_mob = (id) => typeof id === 'string' && id.startsWith('mob-')
  // P0 item 12 (the mob teleported, then slid back on its turn) — POSITION AUTHORITY. Between the poll's
  // bulk sync (slice cell = the mob's FINAL post-turn cell) and its PACED replay actually walking (the core paces
  // every non-local turn ~3s), `walking` is still empty, so sync_entities re-upserted the mob at its final cell
  // (the TELEPORT); the late replay then visibly lerped it from/back over the path (the SLIDE-BACK). The replay
  // pipeline is the ONE cell authority for a mob from the moment its move is bound until its turn finishes:
  // `replay_owned` spans bind→queue→walk, and sync_entities skips those ids.
  const replay_owned = /** @type {Set<string>} */ (new Set())

  render_queue = create_fight_render_queue({
    on_change: () => {
      if ((render_queue?.size() ?? 0) === 0) reconcile()
    },
  })

  /** Bind renderer-neutral producer specs to this board NOW, before atomically enqueueing the whole source turn.
   * Every closure closes over an immutable payload; no render decision is rebuilt while playback is in flight. */
  const bind_render_turn = (specs) => {
    let active_cast = null
    const bindings = specs.map((spec, index) => {
      if (spec.kind === 'cast') active_cast = spec.payload
      return { spec, index, cast: active_cast }
    })
    return bindings.map(({ spec, index, cast }) => {
      const payload = {
        ...spec.payload,
        source_id: spec.payload?.source_id ?? cast?.entity_id ?? null,
        spell_id: spec.payload?.spell_id ?? cast?.spell_id,
      }
      if (spec.kind === 'cast') payload.effects = fight_cast_beat_effects(payload.source_event)
      if (spec.kind === 'trap_trigger' && payload.damage == null) {
        const damage = specs
          .slice(index + 1)
          .find(
            (row) =>
              row.kind === 'damage' &&
              row.payload?.target_id === payload.target_id &&
              row.source_turn === spec.source_turn
          )
        if (damage) payload.damage = damage.payload.damage
      }
      const render = async () => {
        probe_push('beats', {
          kind: spec.kind,
          id: payload.entity_id ?? payload.target_id ?? null,
          spell_id: payload.spell_id ?? null,
        })
        if (spec.kind === 'move') {
          const packet = {
            ...payload,
            mp_remaining: payload.mp_remaining ?? read_board_fight()?.fighters?.get(payload.entity_id)?.mp ?? 0,
            _fight_render_bound: true,
          }
          await play_move(packet)
          // SPENT-MP FLOATER: a floating number in green shows the MP spent after moving, refined to a bare
          // "-x" with no unit suffix. The move
          // beat carries mp_spent (fight_render_prims.move_mp_spent — twin on both lanes); render it as the bare
          // number in the house mint MP green ('mp' kind → FLOAT_COLOR.mp #4fd6a0) — no unit suffix, the green IS
          // the "this is MP" signal. Only THIS floater changes; the tackle pool-forfeit floater keeps its AP/MP tag.
          if (payload.mp_spent > 0 && payload.entity_id && entity_ids.has(payload.entity_id))
            board.float?.(payload.entity_id, { text: `-${payload.mp_spent}`, kind: 'mp' })
        } else if (spec.kind === 'arrival') {
          if (payload.entity_id && payload.cell) placed_cell.set(payload.entity_id, payload.cell)
          reconcile()
        } else if (spec.kind === 'cast') {
          const packet = { ...payload, _fight_render_bound: true, split_render: true }
          await play_cast(packet)
        } else if (spec.kind === 'displacement') {
          await play_move({
            fight_id: payload.fight_id ?? read_board_fight()?.fight_id,
            entity_id: payload.target_id,
            path: payload.path ?? [],
            mp_remaining: read_board_fight()?.fighters?.get(payload.target_id)?.mp ?? 0,
            knockback: true,
            collision: Number(payload.blocked ?? 0) > 0,
          })
          const destination = payload.path?.at(-1) ?? payload.to
          if (destination) placed_cell.set(payload.target_id, destination)
          reconcile()
        } else if (spec.kind === 'teleport_arrival') {
          // TELEPORT ARRIVAL VFX (a VFX plays at the target too) — the fightcore beat lands here;
          // element mirrors play_cast_inner's own derivation (payload.source_id/spell_id thread from the SAME
          // active cast — bind_render_turn's `cast` binding — since teleport_arrival always rides the same turn's
          // beats array right after its cast+displacement siblings, present.js §7b sequencing).
          if (engine && board_frame && payload.cell) {
            const mob_element_code = is_mob(payload.source_id)
              ? read_board_fight()?.fighters?.get(payload.source_id)?.element
              : undefined
            const element = resolve_cast_element(
              payload.spell_id === WEAPON_ATTACK_ID ? 'weapon' : element_of_spell(payload.spell_id),
              mob_element_code
            )
            const at = cell_cast_world(board_frame.origin, payload.cell)
            const handle = arrival_vfx({ engine, at, element, on_done: () => cast_vfx_live.delete(handle) })
            cast_vfx_live.add(handle)
          }
        } else if (spec.kind === 'trap_place')
          reconcile() // the fold's place_traps (at cast) owns the durable my_traps marker; repaint to reflect it
        else if (spec.kind === 'trap_trigger') await play_trap_boom(payload)
        else if (spec.kind === 'damage' || spec.kind === 'heal') await play_damage_beat(payload)
        else if (spec.kind === 'tackled') {
          // TACKLE BITE: a tackled player plays the hit animation just before moving —
          // the runner FLINCHES carrying the pool-forfeit floater; the producer already ordered this beat
          // strictly before any retry move beat, the adapter only renders it. No HP moves here (the fold
          // adopted the ap/mp strip); the floater voices what the bite cost.
          const id = payload.target_id
          if (id && entity_ids.has(id)) {
            const cost = [
              payload.mp_lost > 0 ? `-${payload.mp_lost} MP` : null,
              payload.ap_lost > 0 ? `-${payload.ap_lost} AP` : null,
            ]
              .filter(Boolean)
              .join('  ')
            // NAME THE TACKLE (the 3rd repeat of tackle confusion): this beat fires on the
            // PLAYER'S OWN turn, so a bare "-2 MP" floater reads as enemy damage. The gothic-caps TACKLED tag
            // prefixes the forfeit so the board says WHAT happened — the move was denied, not "something hit me".
            const label = i18n.t('fights.tackled')
            const done = board.entity_beat(id, {
              anim: 'hit',
              float: { text: cost ? `${label}  ${cost}` : label, kind: 'damage' },
            })
            if (hitflash_on()) void done.then(() => board.flash_entity?.(id, HIT_FLASH_TINT))
            await done
          }
        } else if (spec.kind === 'death') await play_death_beat(payload)
      }
      return { kind: spec.kind, at: spec.at, duration: spec.duration, render, index }
    })
  }

  // ── WAVE DRAIN (S2): the core (fight/present.js) already paces every turn — LOCAL (mine) at natural durations,
  //    each NON-LOCAL (mob/peer) turn over ~3s — into `state.wave` (fight/store.js). This adapter's only job left
  //    is to PLAY each new turn's beats through the SAME bind_render_turn + render_queue this file always used,
  //    and ACK it back through the ONE door (`input({type:'presented', seq})`) — `presenting` (project.presenting)
  //    derives from the unacked wave, never a local latch. EVERY turn — local included — acks at playback
  //    SETTLE ('presented' means PLAYED, so the HUD never reveals a beat before the eye sees it land): a local
  //    kill's death-present hold (project.death_presenting_ids) and the R3b queue guard (sync_entities
  //    wave_claimed) both key on the UNACKED wave, and the old enqueue-time local ack emptied it in the click's
  //    own dispatch — the fold despawned a freshly-killed mob before one beat played (a live repro: the mob
  //    disappeared right away). No render queue ⇒ nothing will ever play: a local turn acks NOW (its state
  //    already painted via prediction); a wedged played promise is capped by the store's tick watchdog. ──
  let last_enqueued_seq = 0
  /** Claim every id this turn's beats will drive — the replay owns their rigs for the WHOLE turn (release at
   *  the turn's settle below, never at a mid-turn arrival: the presented fold holds a mob's cell at pre-turn
   *  until its turn acks, and an early release would walk the rig straight back to that masked cell). */
  const prepare_wave_beats = (turn) => {
    const claimed = new Set()
    for (const spec of turn.beats) {
      if (spec.kind === 'move' && spec.payload?.entity_id) claimed.add(spec.payload.entity_id)
      if (spec.kind === 'displacement' && spec.payload?.target_id) claimed.add(spec.payload.target_id)
    }
    for (const id of claimed) replay_owned.add(id)
    return { beats: turn.beats, claimed }
  }
  const drain_wave = () => {
    const { wave } = fight_store.getState()
    for (const turn of wave) {
      if (turn.seq <= last_enqueued_seq) continue
      last_enqueued_seq = turn.seq
      const { beats, claimed } = prepare_wave_beats(turn)
      const events = bind_render_turn(beats)
      const played = render_queue
        ?.enqueue_turn({ source_turn: `wave:${turn.seq}`, events })
        .catch((error) => game_log('fight-render', 'render turn failed', { seq: turn.seq, error }))
      void played?.finally(() => {
        // release BEFORE the ack folds, so the ack-triggered reconcile snaps the rig true. SOUND only because
        // reconcile's fight authority reads the CORE synchronously (board_fight_authority): the ack reveals the
        // turn's cells in the same tick this release lands. Reading the async context mirror here instead is the
        // BOOT23 mob-rollback bug (voxel_fight_ack_window.test.js).
        for (const id of claimed) replay_owned.delete(id)
        fight_store.getState().input({ type: 'presented', seq: turn.seq })
      })
      // no queue to play through — a LOCAL turn acks immediately (nothing will ever settle; its state already
      // painted via prediction). Non-local no-queue turns keep their store-watchdog cap, exactly as before.
      if (played == null && turn.is_local) fight_store.getState().input({ type: 'presented', seq: turn.seq })
    }
    reconcile() // repaint promptly on every wave change (e.g. the my-turn wash's presenting gate) — idempotent
  }

  // ── the reconcile driver: any engine STATE_UPDATED (a poll folded a fresh dungeon into the fight slice) OR a
  //    picks change (a fresh draft to repaint) re-derives the phase and reconciles the board. Idempotent.
  //    [p0-fight-init FIX] the mount/teardown verdict is the PURE board_lifecycle_decision fold (headless-
  //    tested): a HELD phase mid-fight (the spawn→sync dispatch gap of the placement→active flip) is a WAIT —
  //    the old branch read it as ROAM and tore the LIVE board down (probe-captured), which wiped the input
  //    wiring for the rest of the fight. A build in flight is likewise uninterruptible (exit defers). ──

  /** ONE idempotent wiring re-assert (camera authority + entities + paint) — every coherent reconcile of a
   *  built board lands here, including the post-build completion and the post-D77-force-started repaint.
   *  Exactly one input owner at all times: fight_on(true) stands the walk rig down while the board is wired;
   *  only a genuine teardown() hands the mouse back. `just_built` = this call rides a FRESH build (a new
   *  origin/seat just resolved) ⇒ the entities must ALL re-project onto the new board (RE-PROJECT-ON-SEAT). */
  const ensure_fight_wired = (result, fight, dungeon, { just_built = false } = {}) => {
    if (!fight_on) {
      fight_on = true
      on_fight(true) // the embed swaps to the D4 corner-iso camera + suspends the walk drive
    }
    sync_entities(fight, dungeon, { fresh: just_built })
    paint(result, fight, dungeon)
  }

  const reconcile = () => {
    // THE FIGHT AUTHORITY (BOOT23 rollback fix, 2026-07-17): engine_view derived from the core AT READ TIME.
    // The async-pump `state.fight` mirror that once lagged this read ≥1 dispatch cycle (rolling a mob's rig
    // back at every wave-turn ack) is DELETED APP-WIDE — board_fight_authority's doc keeps the full trace.
    const fight = read_board_fight()
    const { dungeon } = use_dungeon.getState()
    const { address } = use_auth.getState()
    const seat = my_seat_of(dungeon, fight?.my_entity_id ?? address)
    const result = derive_phase(dungeon, fight, seat)

    const build_key = fight && dungeon ? `${fight.fight_id}#${dungeon.room_index}` : null
    // A fight whose board was REFUSED as unplaceable (coords sanity guard) is inert: no rebuild, no wire, no
    // teardown-churn — the honest toast already fired once. A different fight (new fight_id ⇒ new build_key) is
    // unaffected; leaving the world (build_key → null) falls through to the normal teardown that clears this.
    if (unplaceable_key && unplaceable_key === build_key) return
    const decision = board_lifecycle_decision({
      phase: result.phase,
      desired: result.desired,
      unmet: result.unmet,
      has_dungeon: !!dungeon,
      has_fight: !!fight,
      built_for,
      build_key,
      building,
    })

    if (decision === 'hold') return // transiently incoherent mid-fight — the next coherent reconcile re-asserts
    if (decision === 'defer_teardown') {
      teardown_deferred = true // atomic build: the exit runs after the in-flight mount settles
      return
    }
    if (decision === 'teardown') {
      teardown()
      return
    }
    teardown_deferred = false // a want-board reconcile supersedes any deferred exit

    // (RE)BUILD when the fight identity changes (a new dungeon / a fresh room respawns the slice with a new
    // fight_id, or a room's grid re-seeds on room_index). build() is a cheap same-args no-op on a reconcile storm.
    if (decision === 'build') {
      // SERIAL builds (async-origin race): never start a second build while one is in flight — each build
      // resolves its OWN origin_of() seat and the engine's build() awaits (teardown→create) would interleave.
      // Defer; the in-flight build's finally re-reconciles and applies the now-current key against settled state.
      if (building) {
        build_deferred = true
        return
      }
      built_for = build_key
      building = true
      void (async () => {
        try {
          // D230 — the LIVE origin + [WORLD FOOTPRINT CLEAR] flag: the cave's board_anchor while inside (the
          // fixed VOXEL_BOARD_ORIGIN built the board at y=260, in the sky over the cave — with no board
          // appearing. AWAITED: a WORLD board's seat samples the footprint terrain + waits (bounded) for the
          // chunk-stream to settle before seating on the dominant high plane (a cave/never-anchor resolves sync).
          const { origin: live_origin, clear_footprint } = await origin_of()
          // D238 flat: EVERY dungeon fight is a cave board — flat:true skips the engine's terrain ground-sampler
          // (which in-cave reads the OVERWORLD terrain under the board's cave-coord origin → producing a
          // multi-floor/sunken board). Dead-flat at origin.y — a single-level board is required.
          // clear_footprint arms the render-side terrain/grass clear for WORLD boards only (open terrain, no
          // gen-carve) — a cave board leaves it off so its carved ceiling/walls stay.
          const args = { ...build_args_from_dungeon(dungeon, live_origin), flat: true, clear_footprint }
          await board.build(args)
          if (built_for !== build_key) {
            // superseded mid-await — a NEWER build owns the board (teardown can no longer interrupt a build)
            if (!p0_logged_superseded_build) {
              p0_logged_superseded_build = true
              game_log(
                'p0-fight-init',
                `board.build superseded mid-await — built ${build_key}, owner is now ${built_for ?? 'null (torn down)'} (wiring-race probe)`
              )
            }
            return
          }
          board_frame = { origin: live_origin, grid_w: args.grid_w, grid_h: args.grid_h }
          game_log(
            'voxel-fight',
            `board built at [${live_origin.x}, ${live_origin.y}, ${live_origin.z}] ${args.grid_w}×${args.grid_h} (D230)`
          )
          last_paint_key = '' // force a fresh paint after a (re)build
          ensure_fight_wired(result, fight, dungeon, { just_built: true }) // RE-PROJECT every entity on the new seat
          // [prewarm/D3] compile every VFX preset pipeline this fight can mount while the intro beat still covers the
          // screen — moves the ~290ms first-cast WebGPU pipeline-compile hitch into fight-enter (the D221 class).
          // The COMPLETE castable universe (ALL_CAST_ELEMENTS), not just the mobs' elements: the PLAYER's own
          // spellbook element (a fire mage vs earth mobs) is unknown here, and a cold player-element preset would
          // eat its first-draw compile on the live cast — the exact freeze this kills. ~28 pipelines, bounded.
          prewarm_fight_vfx(engine, ALL_CAST_ELEMENTS)
        } catch (error) {
          // No board mounted. board_frame stays null (no camera writer takes over — the fight-entry belt releases
          // the iso cam) and the entity wiring never asserted, so nothing seats over the void.
          board_frame = null
          if (/** @type {any} */ (error)?.code === WORLD_BOARD_UNPLACEABLE) {
            // [bug-B] The seat found NO ground in the whole footprint — usually TRANSIENT (terrain still streaming).
            // RETRY across the next refreshes (each re-waits the seat's bounded stream-settle) before stranding the
            // fight; a later reconcile seats the moment the chunks arrive. Give up loudly (latch + ONE honest toast)
            // only after MAX_UNPLACEABLE_ATTEMPTS genuine failures — the forfeit door (FightControls) stays reachable.
            if (unplaceable_attempts_key !== build_key) {
              unplaceable_attempts_key = build_key
              unplaceable_attempts = 0
            }
            unplaceable_attempts += 1
            if (unplaceable_attempts < MAX_UNPLACEABLE_ATTEMPTS) {
              built_for = null // release the key so the next coherent reconcile (refresh) RE-SEATS as terrain streams
              game_log(
                'voxel-fight',
                `board seat unplaceable for ${build_key} (attempt ${unplaceable_attempts}/${MAX_UNPLACEABLE_ATTEMPTS}) — retrying on the next refresh while terrain streams`,
                error
              )
            } else {
              unplaceable_key = build_key // permanently unplaceable: latch so reconcile early-outs (no rebuild storm)
              push_event_toast({ state: 'error', title: i18n.t('fights.board_place_failed') })
              game_log(
                'voxel-fight',
                `board placement REFUSED for ${build_key} after ${MAX_UNPLACEABLE_ATTEMPTS} attempts — footprint unstreamable; no board mounted (reload or forfeit to leave)`,
                error
              )
            }
          } else {
            // A transient origin/build failure — release the key so a later coherent reconcile retries cleanly.
            if (built_for === build_key) built_for = null
            game_log(
              'voxel-fight',
              `board build FAILED for ${build_key} — will retry on the next coherent reconcile`,
              error
            )
          }
        } finally {
          building = false
          if (teardown_deferred || build_deferred) {
            teardown_deferred = false
            build_deferred = false
            reconcile() // apply the deferred exit / superseding build against settled state (serial)
          }
        }
      })()
      return
    }
    ensure_fight_wired(result, fight, dungeon) // 'wire' — the built board re-asserts idempotently
  }

  /** Remove a dead fighter's rig + drop it from every id mirror. Terminal is not an exception: the board remains
   * visible through the recap gate, and a terminal snapshot must never recreate a corpse during that window.
   * `dying` IS one of those mirrors (a mob model failing to disappear after death is this class of bug):
   * left uncleared, a later truer snapshot reviving this same id (project.js's divergence-correction path) then
   * dying again for real would read entity_fold_action's is_dying STALE-true and skip its despawn forever — no
   * death beat ever fires, so neither this timer NOR the engine's hard death belt (which only arms off an
   * actual death beat) ever removes it. */
  const remove_corpse = (id) => {
    board.entity_remove(id)
    entity_ids.delete(id)
    walking.delete(id)
    replay_owned.delete(id)
    placed_cell.delete(id)
    dying.delete(id)
  }
  /** Poof a corpse ONE death-beat-linger after its death beat's impact resolves — timed INSIDE the death clip
   *  (impact < remove < clip-end) so the rig is gone before board_entities' loco hand-back would crossfade DEATH →
   *  IDLE (the "stands back up" that was cut); the avatar's LoopOnce+clampWhenFinished holds the death pose through
   *  the linger. Idempotent per corpse (dying dedups the two triggers). @param {string} id @param {Promise<void>} done */
  const schedule_corpse_removal = (id, done) => {
    dying.add(id) // one death beat + one poof per corpse — a later cast-kill / fold pass sees this and stands down
    void Promise.resolve(done).finally(() => {
      const timer = setTimeout(() => {
        despawn_timers.delete(timer)
        remove_corpse(id)
      }, DEATH_BEAT_MS)
      despawn_timers.add(timer)
    })
  }

  /** Reconcile every fighter's rig against the fresh fight slice via the pure `entity_fold_action` verdict: create/
   *  snap (upsert), smooth-walk a drifted mob the beats didn't move (walk), despawn a mid-fight mob corpse once
   *  (despawn), or leave a walk/replay/dying id alone (skip); then remove any fighter that left the fight entirely.
   *  @param {any} fight @param {any} dungeon the live view (legal_move_path source for the fold-walk) */
  const sync_entities = (fight, dungeon, { fresh = false } = {}) => {
    // RE-PROJECT-ON-SEAT (a mob once rendered off-board while the others were on it, and a refresh re-seated
    // the whole board): a FRESH build tore the engine's entities controller down and stood up an EMPTY one at the
    // newly-resolved origin (index.js create_board_entities). The adapter's `entity_ids` mirror is now STALE — if
    // any id survived in it, the walking/replay_owned skip-guards below (both gated on `entity_ids.has(f.id)`)
    // would SKIP re-upserting that fighter, stranding it at its old-origin world position (off the re-seated
    // board) or never creating it at all. Clearing the mirror forces EVERY fighter to re-project onto the new
    // board this pass; the in-flight walk/replay flags are meaningless on a board that no longer holds the avatar.
    if (fresh) {
      entity_ids.clear()
      walking.clear()
      placed_cell.clear() // positions RE-PROJECT on the new seat — the fold-walk diff baseline resets with them
      hazed_ids.clear() // rigs re-create on the new seat → the veil re-applies from f.invisible next reconcile
    }
    // [D290] PLACEMENT facing (chars + mobs face each other during placement): each fighter faces the
    // OPPOSING band's centroid — per-team centroid = the declared placement zone if any, else that team's live
    // cells (layout-agnostic; the static south/north didn't oppose on all bands). A re-pick re-runs reconcile →
    // re-faces; ACTIVE passes no override so walk/beat facing holds (D284). CELL-space yaw == engine atan2(Δx,Δz).
    let mid = /** @type {Map<number, { x: number, y: number }> | null} */ (null)
    if (fight.placement) {
      const sum = /** @type {Map<number, [number, number, number]>} */ (new Map()) // team -> [Σx, Σy, n]
      const add = (/** @type {number} */ t, /** @type {number} */ x, /** @type {number} */ y) => {
        const a = sum.get(t) ?? [0, 0, 0]
        sum.set(t, [a[0] + x, a[1] + y, a[2] + 1])
      }
      for (const g of fight.fighters.values()) if (!g.dead) add(g.team, g.cell.x, g.cell.y) // live cells (both teams)
      for (const [t, cs] of Object.entries(fight.placement_cells ?? {})) {
        const arr = /** @type {{ x: number, y: number }[]} */ (cs ?? [])
        if (!arr.length) continue // a team with no declared zone keeps its live-cell centroid
        sum.delete(Number(t)) // a declared placement zone REPLACES that team's live-cell centroid
        for (const c of arr) add(Number(t), c.x, c.y)
      }
      mid = new Map()
      for (const [t, a] of sum) mid.set(t, { x: a[0] / a[2], y: a[1] / a[2] })
    }
    // R3b — ids the unacked wave still references (as actor or victim): their rigs are presentation-owned.
    const wave_claimed = new Set()
    for (const t of fight_store.getState().wave ?? [])
      for (const b of t.beats ?? []) {
        if (b.payload?.entity_id) wave_claimed.add(b.payload.entity_id)
        if (b.payload?.target_id) wave_claimed.add(b.payload.target_id)
      }
    // [cosmetics-in-fights] MY kiosk characters — the ONE home for the worn-cosmetic join (ctx.roster, pumped by
    // the fight edge on sui_data; the fighter payload carries only character_id). read fresh so a late roster heals.
    const roster = fight_store.getState().ctx?.roster ?? []
    for (const f of fight.fighters.values()) {
      const action = entity_fold_action(f, {
        winner: fight.winner,
        has_entity: entity_ids.has(f.id),
        is_dying: dying.has(f.id),
        walking: walking.has(f.id), // let an in-flight walk own the avatar position (mid-lerp teleport guard)
        replay_owned: replay_owned.has(f.id), // item 12: the paced replay owns a buffered/queued mob's cell
        placed: placed_cell.get(f.id) ?? null,
        queued: wave_claimed.has(f.id),
      })
      if (action.kind === 'skip') continue
      if (action.kind === 'despawn') {
        // Live-rig death: play the death beat ONCE (if a cast-kill already fired it this id is `dying` → the
        // fold returned 'skip', not here) then poof after the linger — never re-stand the corpse (after
        // the death animation it should depop, not loop back to idle). The removal lands before the loco crossfade.
        // COMBAT LOG (realtime): this is the death beat for a NON-cast kill (trap / DoT) — the ONLY place those
        // deaths are announced (cast kills log in play_victim_reaction; the `dying`→'skip' split guarantees no
        // double). Streams AT the beat, matching the flinch/floater trap line play_trap_trigger already emitted.
        emit_death_line(read_board_fight_state, context.dispatch, { target_id: f.id })
        schedule_corpse_removal(f.id, board.entity_beat(f.id, { anim: 'death' }))
        continue
      }
      if (action.kind === 'walk') {
        // the fold moved this mob but no beat did — WALK it to its chain cell (reuse play_move's gait+guard) rather
        // than teleport-snapping. Claim the destination in placed_cell NOW so a concurrent reconcile won't re-fire.
        const at = /** @type {{x:number,y:number}} */ (placed_cell.get(f.id))
        const blocked = presentation_blocked_cells(dungeon, fight.fighters, f.id)
        const path = move_path_dungeon({ cell: at }, action.to, { blocked, mp: GRID_CELLS }).map(decode_cell)
        if (path.length) {
          placed_cell.set(f.id, action.to)
          void play_move({ entity_id: f.id, path })
          continue
        }
        // no legal path (an off-grid / non-walk displacement) → fall through to a snap so the rig still ends true
      }
      // 'upsert' (or the no-path walk fallback): create / refresh / snap at the chain cell.
      // Players retain the fight silhouette. Mobs do not receive a context-only black shell: their subtree is
      // exactly the shared overworld factory output (board_entities also enforces this at the render boundary).
      const entity_spec = entity_spec_from_fighter(f)
      // [cosmetics-in-fights] a PLAYER wears MY character's equipped hat/cloak: resolve them off the roster join
      // (character_id → the /v1 `worn` slots) + the encyclopedia templates, and spread onto the spec so
      // board_entities mounts them on the fight rig — the SAME { head, back } shape the roam avatar consumes. A
      // player NOT in my roster (a co-op teammate — that read-model join is boarded separately) keeps worn:null.
      const char = entity_spec.kind === 'mob' ? null : roster.find((c) => c.id === f.character_id)
      const worn = char ? resolve_worn_cosmetics(char, worn_templates) : null
      const spec =
        entity_spec.kind === 'mob'
          ? entity_spec
          : { ...entity_spec, outline: f.team === 0 ? TEAM_COLORS.ally : TEAM_COLORS.enemy, worn }
      const foe = mid && [...mid].find(([t]) => t !== f.team)?.[1] // this fighter's opposing-band centroid
      board.entity_upsert(foe ? { ...spec, facing_yaw: Math.atan2(foe.x - f.cell.x, foe.y - f.cell.y) } : spec)
      probe_push('upserts', { id: f.id, x: f.cell.x, y: f.cell.y })
      entity_ids.add(f.id)
      placed_cell.set(f.id, { x: f.cell.x, y: f.cell.y }) // the rig now stands here — the fold-walk diff baseline
    }
    for (const id of [...entity_ids]) {
      if (fight.fighters.has(id)) continue
      board.entity_remove(id)
      entity_ids.delete(id)
      walking.delete(id)
      placed_cell.delete(id)
      hazed_ids.delete(id)
      dying.delete(id) // this id is fully retired too — same mirror remove_corpse now keeps clean
    }
    // [⑤c INVISIBILITY VEIL] FIX v1.12.31 ⑤ (invisibility wasn't rendering visually). The fold's f.invisible is the
    // ONE truth (the packet-driven wire_fight_invisibility orphaned when the sim-door rework stopped emitting its
    // status snapshots). Render the retro 1.29 law from THIS client's seat: my own + allies' invisibility reads as
    // the engine's translucent heat-haze veil (visual_effect kind:'invisibility'); an invisible ENEMY should
    // vanish entirely — that hide is a targeting rabbit hole (BOARDED), so an enemy stays opaque here, never newly
    // revealed by this veil. Fired ONCE per transition via hazed_ids (set_invisibility is idempotent; the effect-
    // only upsert is a SEPARATE call — board_entities' visual_effect branch returns before the position path).
    const my_team = fight.my_entity_id ? fight.fighters.get(fight.my_entity_id)?.team : 0
    for (const f of fight.fighters.values()) {
      const veiled = !!f.invisible && !f.dead && f.team === my_team
      if (veiled === hazed_ids.has(f.id)) continue
      board.entity_upsert({ id: f.id, visual_effect: { kind: 'invisibility', active: veiled } })
      if (veiled) hazed_ids.add(f.id)
      else hazed_ids.delete(f.id)
    }
  }

  /**
   * Paint the phase-appropriate highlight channels from overlay_intents cell sets. Memoized on a signature so a
   * reconcile storm doesn't repaint an unchanged wash. TERMINAL paints nothing (frozen board).
   */
  const paint = (result, fight, dungeon) => {
    // D300: the VISUAL turn signal is the presentation gate, not the slice. In a solo fight the chain resolves the
    // whole mob cascade inside my commit and hands active_entity_id back to ME, so the slice reads "my turn" the
    // instant the mobs' paced replay starts — the my-turn washes would paint over the mob beats. `presenting`
    // (buffering OR draining — set the instant the FIRST mob beat buffers, closing the paint-before-queue race)
    // gates the wash below and rides paint_key so the drain transition busts the memo and repaints.
    const presenting = project.presenting(fight_store.getState()) // S2: derived from the core's unacked wave
    // MP-ZONE MISCLICK GUARD: MY OWN cast/weapon VFX also busts the memo — move_wash (below) reads
    // the SAME fact and suppresses the wash while it's true, so paint_key must ride BOTH transitions (armed →
    // hidden at cast dispatch, hidden → armed again at the wave's drain-ack) or the wash goes stale mid-turn.
    const cast_presenting = project.cast_presenting(fight_store.getState())
    const replaying = presenting || cast_presenting
    // busy rides the memo signature too — END-TURN PRESS LAW: a busy-only flip (nothing else changed yet, e.g.
    // the instant commit_turn sets busy:true) must still force a repaint, else the memo would skip the very
    // frame that's supposed to clear the wash (paint_key's other inputs are all still pre-commit at that instant).
    const { busy } = use_dungeon.getState()
    const key = paint_key(result, fight, dungeon, replaying, busy)
    if (key === last_paint_key) return
    last_paint_key = key
    // D242 RIDER — your-turn ground flash (engine cue): on the RISING edge of MY active turn, flash my cell so the
    // handoff to me is unmissable (pairs with the DOM "YOUR TURN" banner + chime). Computed here (not the branch
    // below) so placement / a mob's turn / a fresh fight all reset the edge → the first turn of every fight flashes.
    // board.flash_cell auto-cleans (self-removing transient).
    const my_active_turn =
      phase_is_active(result) &&
      !!fight.active_entity_id &&
      fight.active_entity_id === fight.my_entity_id &&
      fight.winner === -1
    if (my_active_turn && !prev_my_turn) {
      const me_cell = fight.fighters.get(fight.my_entity_id)?.cell
      if (me_cell) board.flash_cell(me_cell)
      on_my_turn() // [W6 #5] hero zoom-punch beat — the embed pushes the fight cam IN when your turn opens
    }
    prev_my_turn = my_active_turn
    // D253: highlights CUMULATE, never disappear — REPLACE lifecycle + fade-correct. Compute each channel's
    // cells THIS frame into `lit`, then ONE authoritative pass below: set_cell_state(cells,ch) [instant clear + add =
    // delta-fade] for LIT channels, clear_states(ch) [deferred fade-OUT] for EMPTY. NEVER clear_states-then-add the
    // SAME channel — that cancels the deferred clear yet strands the un-re-added old cells → cumulation (architect D253).
    /** @type {Record<string, {x:number,y:number}[]>} */
    const lit = {}
    if (phase_is_placement(result)) {
      // per-team start cells (the D83 centre cluster the contract accepts) — gate on the phase machine (D112).
      const in_dungeon = !!(use_dungeon.getState().dungeon_id && dungeon)
      const seat = my_seat_of(dungeon, fight.my_entity_id)
      if (placement_active(fight, { in_dungeon, has_my_seat: !!seat, is_placement_phase: true })) {
        const by_team = placement_cells_by_team(fight)
        const mine = fight.my_entity_id ? fight.fighters.get(fight.my_entity_id)?.team : 0
        // my team = 'placement' (the stand-here cells), the enemy zone = 'target' (a distinct tint).
        const my_cells = (by_team[mine ?? 0] ?? []).map(decode_cell)
        const foe_cells = (by_team[mine === 0 ? 1 : 0] ?? []).map(decode_cell)
        if (my_cells.length) lit.placement = my_cells
        if (foe_cells.length) lit.target = foe_cells
        // PLACEMENT GHOSTS — peers' uncommitted picks (engine_view.placement_ghosts, fold.js-owned; cosmetic
        // only). Painted on the 'ghost' channel (board_highlight_style.js) regardless of whose team — a ghost
        // only ever exists for a fight participant, and this board only ever shows THIS fight.
        const ghost_cells = (fight.placement_ghosts ?? []).map((g) => decode_cell(g.cell))
        if (ghost_cells.length) lit.ghost = ghost_cells
      }
    } else if (phase_is_active(result)) {
      const address = fight.my_entity_id
      const active = fight.active_entity_id ? fight.fighters.get(fight.active_entity_id) : null
      const my_turn = !!active && active.id === address && fight.winner === -1
      // END-TURN PRESS LAW: `armed` also gates on `!busy` (voxel_fight_folds.turn_input_armed)
      // — busy is true from the INSTANT end turn is pressed (or an auto-commit fires) through the whole pending
      // window (tx signing → chain confirm → refresh()), so the wash clears at PRESS, not at chain confirmation.
      // A refused commit (pre-flight or executed — either way nothing actually advanced the turn) clears busy
      // with my_turn still true — the wash HONESTLY restores.
      // `armed` = my_turn ⋀ !busy ⋀ !presenting — the ONE input gate: it already suppresses the ENTIRE my-turn
      // wash (mp_range AND the armed cast ranges — blue painted over a mob replay is the same lie) while the mob
      // cascade drains; the authoritative pass below clears them, and the drain repaint (flush's .finally →
      // reconcile, or the watchdog's) repaints the wash on the last settle.
      const armed = turn_input_armed(my_turn, busy, presenting)
      if (armed && active) {
        // AP-AFFORDABILITY GATE (fixes the range highlight persisting post-cast): the wash paints for the
        // armed spell ONLY while the LIVE folded AP affords one more cast — spent budget ⇒ the blue ranges
        // clear and the idle MP default below returns, while the spell stays armed for a re-arm-free next turn.
        const escrow_row = dungeon.escrow?.find((p) => (p.character ?? p.character_id) === active.id)
        const wash_armed = wash_armed_spell({
          armed_spell_id: fight.armed_spell_id,
          active_ap: active.ap,
          is_weapon: fight.armed_spell_id === WEAPON_ATTACK_ID,
          weapon_ap_cost: escrow_row?.weapon?.ap_cost ?? WEAPON_ATTACK_AP,
        })
        // MOVE RANGE + TACKLE BAND — the which-cells DECISION is the CORE's (project.move_wash, M3 render
        // contract): `reach` = LIGHT-GREEN 'mp_range' (the idle default, design ruling 2026-07-17: no spell armed ⇒ the MP
        // range paints, no re-click), `tackle_lost` = the SOFT-RED at-risk band (only while
        // ACTUALLY tackled, exactly the chain contest's mp-loss fraction, NEVER on plain MP spending),
        // mouse-INDEPENDENT. The adapter maps encoded → {x,y} and paints — it decides nothing; `targeting`
        // (an affordable armed spell flips the board to cast mode) + `busy` ride as edge inputs.
        const wash = project.move_wash(fight_store.getState(), { busy, targeting: !!wash_armed })
        if (wash.reach.length) lit.mp_range = wash.reach.map(decode_cell)
        if (wash.tackle_lost.length) lit.path_blocked = wash.tackle_lost.map(decode_cell)
        // CAST RANGE — D241 SPLIT: 'target' (DARK BLUE) = in-range + LOS-clear (castable); 'los_blocked' (LIGHT BLUE) =
        // in-range minus castable. Anchored at the active player's cell.
        // Weapon slot: the sentinel has no seed row — its ring is [1, reach] off the active seat's on-chain
        // Weapon (the SAME reach DungeonBoard's cast_params prices the strike from), so the wash and the click-gate
        // agree cell-for-cell; falls back to the melee floor before the escrow read lands. A real spell reads its
        // seed range as before.
        const range =
          wash_armed === WEAPON_ATTACK_ID
            ? [1, escrow_row?.weapon?.reach ?? WEAPON_ATTACK_RANGE[1]]
            : wash_armed
              ? seed_range_of(wash_armed)
              : null
        if (range) {
          const grid = dungeon_grid_of(dungeon)
          // D284 twin of dungeon.move los_obstacles(): the cast wash clears LOS through obstacles ∪ living bodies
          // (players + mobs), so the dark/light-blue split matches the chain. Endpoints self-excluded by losBlocks.
          const los = [...(dungeon.obstacles ?? [])]
          for (const p of dungeon.escrow ?? []) if (p.alive) los.push(p.cell)
          for (const m of dungeon.mobs ?? []) if (m.alive) los.push(m.cell)
          const flags = seed_cast_flags_of(wash_armed)
          // 1.29 no-stack: a trap-PLACING spell greys MY live trap cells (the chain aborts cast/107 there).
          if (flags.places_trap) flags.trap_cells = fight.my_traps ?? []
          const castable = cast_range_set_dungeon(range, active, grid, los, flags)
          const in_range = manhattan_range_cells(range, active, grid) // every cell within the spell's reach
          // free_cell (traps/glyphs): a mob/obstacle cell is NOT a valid target — and shouldn't read as merely
          // "LOS-blocked" light-blue either. Drop the whole blocker set (obstacles ∪ bodies = `los`) from the
          // light-blue wash so a trap ONLY ever lights FREE cells (not targetable on a mob).
          const free_blocked = flags.free_cell ? new Set(los) : null
          const blocked_cells = [...in_range].filter((c) => !castable.has(c) && !(free_blocked && free_blocked.has(c))) // in-reach, LOS says no
          if (castable.size) lit.target = [...castable].map(decode_cell)
          if (blocked_cells.length) lit.los_blocked = blocked_cells.map(decode_cell)
        }
      }
    }
    // TRAP MARKERS (so a placed trap is visible on the board) — the caster's OWN placed traps, painted
    // persistently and independent of turn/armed state (the keyless read layer drops Fight.fx, so the client
    // mirrors its own committed trap casts). Read straight from engine_view.my_traps (the fold projection — the ONE
    // home, exactly like my_glyphs below): the fold carries the durable record through turns/waves, retires it on
    // the committed detonation (a fighter, dead or alive, on the cell) and excludes presented-occupied cells, so
    // this paint needs no client-side spring/mirror. A won/lost board stops painting them (they clear on teardown).
    if (fight.winner === -1) {
      const traps = fight.my_traps ?? []
      if (traps.length) lit.trap = traps.map(decode_cell)
      // GLYPH ZONES (an orange blob on the ground that stays, like the traps but covering the zone) —
      // the caster's OWN placed glyphs, a persistent orange ground wash over each glyph's full AoE. Read straight
      // from engine_view.my_glyphs (the fold projection — SINGLE home, no overlay module): the fold carries the
      // durable record through turns/waves and expiry-drops it, so this paint needs no client-side spring/mirror.
      if (fight.my_glyphs?.length) lit.glyph = fight.my_glyphs.map(decode_cell)
    }
    // TEAM SEAT GLOW migrated OFF this cell-state paint path (the marker under a
    // fighter must FOLLOW the walking mesh, never pre-jump to the destination cell the instant a move
    // resolves — root-caused to this very block reading fight.fighters' LOGICAL f.cell once per reconcile;
    // see board_highlights.js's entity-anchor design note above CHANNELS). tick_entity_anchors (below, ridden
    // on the same per-frame tick_hover seam) now owns "cell under a fighter" entirely, fed by
    // board.render_position_of's continuous LIVE render XZ instead of a once-per-reconcile snapshot.
    // ONE authoritative pass: replace lit channels (delta-fade in/swap), fade-out the rest. (path/aoe/glyph_hover
    // are hover-owned but still fade-out here on a state change, matching the prior clear-all — the hover repaints
    // them on the next move. [#238] glyph_hover — never `lit`-populated here — is the hover-preview SIBLING of the
    // authoritative `glyph` row above; keeping it in this pass only clears a stale preview on a state change, it
    // can never touch the persistent zone.)
    for (const ch of PAINT_CHANNELS) {
      const cells = lit[ch]
      if (cells && cells.length) board.set_cell_state(cells, ch)
      else board.clear_states(ch)
    }
  }

  /** Tear the board down + hand the camera back to the walk loop. Idempotent (ROAM/EXIT reconcile storms). */
  const teardown = () => {
    if (built_for == null && !fight_on && entity_ids.size === 0) return
    // [terminal-gate2] REGRESSION SENTINEL (the ungated-teardown bypass, a repeat regression class). Sits INSIDE
    // teardown() so EVERY path is covered (the direct reconcile branch AND the deferred build-settle teardown the
    // first placement exposed). The discriminator is TIMING, guaranteed by the async pump: a LEGIT terminal
    // teardown only ever runs after the death-beat-gated present() — whose set(cleared_session) nulls the store
    // dungeon SYNCHRONOUSLY before any reconcile can fold its dispatches — so the LIVE read here is null/
    // non-terminal. Tearing a built board down while the live chain read is STILL WON/FAILED means the frozen
    // board is being destroyed BEFORE its card/sequence — the exact class the derive_phase terminal exemption
    // fixed. If this ever fires, the exemption (or a new bypass) regressed.
    const live_status = use_dungeon.getState().dungeon?.status
    if (built_for != null && (live_status === STATUS_WON || live_status === STATUS_FAILED))
      console.warn(
        `[terminal-gate2] UNGATED teardown of a TERMINAL board (status=${live_status}) — ` +
          'the death sequence/card was preempted; a terminal read reached teardown ahead of the gate'
      )
    if (!p0_logged_live_teardown && built_for != null) {
      p0_logged_live_teardown = true
      game_log(
        'p0-fight-init',
        `adapter teardown of a LIVE board — built_for=${built_for} fight_on=${fight_on} (wiring-race probe)`
      )
    }
    if (fight_on) {
      fight_on = false
      on_fight(false) // the embed resumes the shoulder cam + walk drive (D230 exit leg)
    }
    // [entity-anchor] explicit clear BEFORE board.teardown() — belt-and-suspenders: highlights.dispose()
    // (inside board.teardown()) already wipes every anchor mesh wholesale, but an explicit per-id clear
    // here keeps the invariant visible at this call site too (the two-phase dispose law), not merely
    // inherited from a cascade three modules away.
    for (const id of anchored_ids) board.clear_entity_anchor?.(id)
    anchored_ids.clear()
    board_frame = null
    board.teardown()
    entity_ids.clear()
    walking.clear()
    placed_cell.clear()
    dying.clear() // a torn-down board keeps no corpses — the next fight's fresh mob-N ids start clean
    hazed_ids.clear() // no rigs survive teardown → the veil-latch resets for the next fight
    for (const t of despawn_timers) clearTimeout(t) // never let a stale poof remove a REUSED mob-N id next fight
    despawn_timers.clear()
    // [F1] kill any cast VFX still in flight — a torn-down board has no scene to render an orb/impact into.
    for (const h of cast_vfx_live) h.dispose()
    cast_vfx_live.clear()
    // D19: drop any un-played turn backlog — a torn-down board has nowhere to render the remaining paced beats
    // (the terminal card is the surface). The in-flight slot settles harmlessly; nothing queued behind it runs.
    render_queue?.clear()
    replay_owned.clear() // item 12: a torn-down board has no replays — cells revert to slice truth on rebuild
    last_enqueued_seq = 0 // a fresh fight's wave restarts its seq from 1 — never skip its early turns as "stale"
    built_for = null
    unplaceable_key = null // a fresh session may target a placeable fight — never carry a refusal across teardown
    unplaceable_attempts = 0 // [bug-B] a fresh fight re-earns its full retry budget
    unplaceable_attempts_key = null
    last_paint_key = ''
    // the torn-down fight's trap markers live in the fold (my_traps); the store re-inits per fight, so nothing leaks.
  }

  // subscribe: engine state (poll → fight slice) + picks (a fresh draft repaints its ranges). Run once now so a
  // board already-in-fight at mount reconciles immediately.
  // ── D236 HOVER PATH PREVIEW (restoring the prior full preview system): on MY turn, hovering a reachable cell
  //    paints the exact BFS walk path on the 'path' channel — the same legal_move_path the commit charges,
  //    so the preview can never lie. Clears on leave/unreachable; a reconcile repaint clears it too (the
  //    next hover event repaints — hover is a per-frame-ish stream from the board picker). ──
  const off_hover = board.on(
    'cell_hover',
    /** @type {any} */ (cell) => {
      const fight = read_board_fight()
      const { dungeon } = use_dungeon.getState()
      // 'path_blocked' is NOT cleared here anymore — it is the WASH's static tackle-lost band now
      // (mouse-independent; the per-hover red suffix is dead), owned by paint()'s authoritative pass.
      const clear = () => {
        board.clear_states('path') // D253: real clear (empty-toggle was a no-op → path accumulated per hover)
      }
      if (!cell || !fight || !dungeon || fight.placement || fight.winner !== -1) return clear()
      const active = fight.active_entity_id ? fight.fighters.get(fight.active_entity_id) : null
      // END-TURN PRESS LAW + PRESENTATION GATE: the SAME turn_input_armed gate cell_click uses — a commit in
      // flight (busy) OR the mob cascade still animating (presenting) clears the hover preview (path/AoE)
      // immediately, even while active_entity_id already reads as my turn.
      const presenting = project.presenting(fight_store.getState()) // S2: derived from the core's unacked wave
      if (!turn_input_armed(!!active && active.id === fight.my_entity_id, use_dungeon.getState().busy, presenting))
        return clear()
      const to_enc = encode_cell(cell.x, cell.y)
      // D301b ARMED = TARGETING-ONLY: a spell armed ⇒ the board is in cast mode — NO dark-green steering path (the
      // move affordance is off); only the red AoE below paints on a castable cursor cell. Disarm → the D236 path
      // preview returns. Unarmed: the reachable-cell path preview is unchanged.
      if (fight.armed_spell_id) {
        clear()
      } else {
        // [msg 3254 → 07-17] MP-SPLIT HOVER, green half only: the affordable prefix keeps the D236 dark-green
        // 'path' (the same legal_move_path the commit charges, so the green half can never lie). The soft-red
        // beyond-MP suffix is DEAD: the lost-range read is now the WASH's static
        // 'path_blocked' band (project.move_wash — mouse-independent, tackle-gated), never a per-hover paint.
        const blocked = presentation_blocked_cells(dungeon, fight.fighters, active.id)
        const path = move_path_dungeon(active, cell, { blocked, mp: GRID_CELLS })
        if (!path.length) return clear()
        const { walk } = split_path_at_mp(path, active.mp)
        if (walk.length) board.set_cell_state(walk.map(decode_cell), 'path')
        else board.clear_states('path') // 0 MP: nothing affordable to preview
      }
      // AoE/GLYPH-on-hover: while a spell is armed and the hover is a CASTABLE cell, paint the spell's FULL zone
      // footprint (cross/circle/line/glyph — spell_footprint reuses the sim's own get_aoe_cells, anchored at the
      // cursor cell, oriented caster→target for LINE/CONE/TBAR) so a "cross 1" reads as its whole plus, not one
      // cell. A GLYPH-placing spell paints the orange 'glyph_hover' tint; every other spell the red 'aoe' strike
      // (both outrank target/los_blocked so the zone reads as the actual hit). Cleared with 'path' on leave.
      // D253: set_cell_state REPLACE when lit / clear_states fade-out when not (never clear-then-add the same channel).
      // [#238] the CHANNEL PICK (paint vs clear) routes through hover_footprint_plan (voxel_fight_folds.js) —
      // 'glyph_hover' is its OWN transient channel, never the persistent 'glyph' paint() owns from
      // fight.my_glyphs (see hover_footprint_plan's docstring for the regression this split fixes).
      let foot_cells = /** @type {{x:number,y:number}[]} */ ([])
      if (active && fight.armed_spell_id) {
        const grid2 = dungeon_grid_of(dungeon)
        // D284: LOS blockers = obstacles ∪ living bodies (twin of los_obstacles) so the hover AoE agrees with the wash.
        const los2 = [...(dungeon.obstacles ?? [])]
        for (const p of dungeon.escrow ?? []) if (p.alive) los2.push(p.cell)
        for (const m of dungeon.mobs ?? []) if (m.alive) los2.push(m.cell)
        // S-25 weapon slot: the sentinel has no seed range — use its S-12 melee ring so the hover strike-highlight
        // works (and cast_range_set_dungeon never gets a null range).
        const hover_range =
          fight.armed_spell_id === WEAPON_ATTACK_ID ? WEAPON_ATTACK_RANGE : seed_range_of(fight.armed_spell_id)
        const flags2 = seed_cast_flags_of(fight.armed_spell_id)
        // 1.29 no-stack (the wash's hover twin): MY live trap cells are never a castable hover for a trap spell.
        if (flags2.places_trap) flags2.trap_cells = fight.my_traps ?? []
        const castable2 = cast_range_set_dungeon(hover_range, active, grid2, los2, flags2)
        // The weapon sentinel has no seed row → spell_footprint falls back to the single [cell] (a melee strike).
        if (castable2.has(to_enc)) foot_cells = spell_footprint(fight.armed_spell_id, cell, active.cell)
      }
      const foot_plan = hover_footprint_plan(fight.armed_spell_id, foot_cells)
      if (foot_plan.paint) board.set_cell_state(foot_plan.paint.cells, foot_plan.paint.channel)
      for (const ch of foot_plan.clear) board.clear_states(ch)
    }
  )

  // ── (S-25) the D239 cast DRAG-DROP release listener was REMOVED with the drag-and-release cast system. The
  //    bar now uses CLICK-TO-PICK / CLICK-TO-CAST: a spell is armed by a left-click on its icon (DeckCluster),
  //    then a plain left-click on a board cell casts it — the engine already fires cell_click on that press →
  //    emit_click(cell) → DungeonBoard.on_cell_click, which casts an armed spell on a castable cell (and is a
  //    no-op on a non-castable cell while armed). So the extra window-pointerup raycast is not just redundant
  //    but HARMFUL under click-to-pick (a release over the HUD while a spell stays armed would raycast a cell
  //    behind the bar and cast there) — it is gone. `clicked_cast`/`cast_only` stays in the store, now always
  //    false (a plain click), harmlessly.

  // ── #4 D239 ENTITY TOOLTIP (the tooltip is still "the shitty new one"): the legacy EntityTooltip is
  //    mounted + reads state.fight_hover, but NOBODY fed it on voxel — the plane-era roam raycast that used to
  //    publish fight_hover died with D139, so no tooltip ever rendered (the "shitty new one" is a phantom —
  //    there was NONE). Wire the engine's entity_hover → project the hovered fighter's head to viewport →
  //    dispatch the SAME fight_hover action the legacy tooltip consumes. No tooltip-component change needed.
  //
  //    STUCK-TOOLTIP FIX (tooltip parks top-left, "corresponds to nothing", hover stops updating): the
  //    ORIGINAL wiring projected ONLY inside this entity_hover callback — a one-shot fired on the next
  //    pointermove that CHANGES the picked entity id. But the fight camera moves independently every render
  //    tick (idle wobble, the your-turn hero zoom-punch, impact shakes, the damped-orbit settle) and a mob
  //    can walk — so a screen anchor computed once at pick-time goes stale the instant the camera/fighter
  //    moves again while the mouse sits still (an extremely common pattern: hover a mob, then move the mouse
  //    down to the spell bar to actually cast — the mouse leaving the canvas onto that interactive HUD chrome
  //    also means board_picking never fires another event to update OR clear it, board_picking.js's own fix).
  //    `reproject_hover` re-reads the LIVE fighter + LIVE camera and re-dispatches on EVERY render tick (via
  //    the returned `tick_hover`, embed_voxel.js's frame loop) AND on every entity_hover change — the house
  //    world-locked-plate law (project from the anchor every frame, never cache a screen position).
  const proj = new Vector3()
  /** The currently-hovered fighter id (null = nothing hovered). The one piece of state a per-frame reproject
   *  needs; everything else (fighter/cell/camera) is re-read live so a walk or a camera move is never stale. */
  let hovered_id = /** @type {string | null} */ (null)

  /** Re-projects the CURRENTLY-hovered fighter's head to viewport pixels off the LIVE camera/board_frame/cell
   *  and re-dispatches fight_hover/set — or fight_hover/clear the instant the fighter is no longer valid
   *  (despawned, removed from the slice, or the board itself tore down). Safe to call every frame: a no-op
   *  dispatch when nothing changed is cheap, and EntityTooltip only re-renders on an actual value change. */
  const reproject_hover = () => {
    const id = hovered_id
    if (!id || !engine || !board_frame) return context.dispatch('action/fight_hover/clear', {})
    const fight = read_board_fight()
    const f = fight?.fighters?.get(id)
    const cam = engine.get_camera?.()
    if (!f?.cell || !cam) {
      hovered_id = null // the hovered fighter is gone (despawned / fold removed it) — nothing left to track
      return context.dispatch('action/fight_hover/clear', {})
    }
    const { x: ox, y: oy, z: oz } = board_frame.origin
    // [faithful-mob-sizes 2026-07-13] anchor the tooltip at the fighter's MEASURED head height (the
    // engine's entity_height_of feed + a small margin), never the old constant +2.0 — with mobs at intrinsic
    // per-creature sizes a constant sat inside a tall boss and floated a body-length above a small critter.
    // Pre-load (or on an old facade) the feed's CHARACTER_HEIGHT placeholder ≈ the old 2.0 — same behaviour.
    const head_y = (board.entity_height_of?.(id) ?? 2.0) + 0.15
    proj.set(ox + (f.cell.x + 0.5) * CELL_M, oy + head_y, oz + (f.cell.y + 0.5) * CELL_M).project(cam)
    if (proj.z >= 1) {
      hovered_id = null // behind the camera this frame — treat like any other invalid hover
      return context.dispatch('action/fight_hover/clear', {})
    }
    const rect = canvas?.getBoundingClientRect() ?? {
      left: 0,
      top: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    }
    context.dispatch('action/fight_hover/set', {
      entity_id: id,
      x: rect.left + ((proj.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - proj.y) / 2) * rect.height,
    })
  }

  // ── [entity-anchor] "cell under a fighter" LIVE marker (the highlighted cell below
  //    a fight entity must be distinct from other highlight classes AND follow the mob's actual movement,
  //    never snap to the destination cell before the walk even starts). MUST ride a per-RENDER-frame seam,
  //    not a reconcile-driven paint() pass: the position it feeds (board.render_position_of) changes every
  //    tick of the walk tween, far more often than the discrete state events paint() repaints on. Gated to a
  //    live, undecided fight (fight.winner === -1) — a frozen TERMINAL board / no fight keeps no anchors,
  //    matching the retired ally_seat/enemy_seat wash's own placement/active-only gate. Dead fighters are
  //    skipped (parity with that same retired wash: `if (f.dead || !f.cell) continue`). ──
  const tick_entity_anchors = () => {
    const fight = read_board_fight()
    if (!board_frame || !fight || fight.winner !== -1) {
      for (const id of anchored_ids) board.clear_entity_anchor?.(id)
      anchored_ids.clear()
      return
    }
    const live_ids = new Set()
    for (const f of fight.fighters.values()) {
      if (f.dead) continue
      const pos = board.render_position_of?.(f.id) // null: not yet upserted this pass — next tick catches it
      if (!pos) continue
      board.set_entity_anchor?.(f.id, pos, f.team) // f.team===0 ⇒ ally — mirrors the entity outline's team pick
      live_ids.add(f.id)
    }
    for (const id of anchored_ids) if (!live_ids.has(id)) board.clear_entity_anchor?.(id) // dead/despawned
    anchored_ids.clear()
    for (const id of live_ids) anchored_ids.add(id)
  }

  const off_entity_hover = board.on(
    'entity_hover',
    /** @type {any} */ (id) => {
      hovered_id = id || null
      // P0 item 13a: hover-off (or any invalid hover) clears the hovered fighter's reach wash with the tooltip.
      const clear_hover_reach = () => board.clear_states('range')
      const fight = hovered_id ? read_board_fight() : null
      const f = hovered_id ? fight?.fighters?.get(hovered_id) : null
      if (!f?.cell) {
        clear_hover_reach()
        return reproject_hover()
      }
      // P0 item 13a (hovering a fighter must show their MP range): the hovered fighter's OWN move reach
      // paints on the legacy 'range' channel — [D289] MEDIUM GREEN (their MP reach is MOVEMENT, not a cast),
      // distinct from my LIGHT-green mp_range so "theirs vs mine" reads at a glance. A mob's mp is the honest
      // MOB_MP_MAX ceiling the slice already carries (D126b). Dead paint nothing; fades ride the channel envelope.
      const { dungeon: hover_dungeon } = use_dungeon.getState()
      // D301b ARMED = TARGETING-ONLY: while a spell is armed the board is in cast mode, so the hovered fighter's
      // move-range wash is SUPPRESSED (the tooltip TEXT below still renders by design; a mob's red target/
      // AoE under the cursor is owned by cell_hover and unchanged). A dead fighter paints nothing either way.
      if (hover_dungeon && !f.dead && !fight.armed_spell_id) {
        const reach = move_reachable_set(f, {
          mode: 'dungeon',
          blocked: presentation_blocked_cells(hover_dungeon, fight.fighters, f.id),
        })
        if (reach.size) board.set_cell_state([...reach].map(decode_cell), 'range')
        else clear_hover_reach()
      } else {
        clear_hover_reach()
      }
      reproject_hover()
    }
  )

  const off_state = subscribe_state(reconcile)
  const off_picks = use_dungeon_turn.subscribe(reconcile)
  const off_dungeon = use_dungeon.subscribe(reconcile)
  const off_wave = fight_store.subscribe(drain_wave) // S2: the core's wave — plays + acks new turns (drain_wave)
  reconcile()
  drain_wave() // catch a wave already in flight if the adapter mounts mid-fight

  return {
    destroy() {
      off_click()
      off_hover() // D236 — the hover-path stream dies with the adapter
      off_entity_hover() // D239 — the tooltip feed dies too
      hovered_id = null // no dangling tick_hover reproject after teardown
      context.dispatch('action/fight_hover/clear', {}) // no dangling tooltip after teardown
      off_state()
      off_picks()
      off_dungeon()
      off_wave()
      teardown()
    },
    /** D230 — the live built frame (origin + grid dims) for the embed's D4 fight camera; null = no board. */
    get_board_frame: () => board_frame,
    /** STUCK-TOOLTIP FIX + [entity-anchor] — call once per render tick (embed_voxel.js's frame loop, after
     *  the fight camera's own apply() so it reads the JUST-updated pose): re-anchors the entity tooltip to
     *  the currently-hovered fighter's LIVE projected position (tracks camera motion + fighter movement
     *  continuously instead of freezing at the last pointermove), AND re-syncs every living fighter's
     *  "cell under a fighter" marker to its live render position (tick_entity_anchors) — both need the SAME
     *  every-frame cadence, neither can ride the discrete-event paint() pass. A no-op half when nothing is
     *  hovered / no fight is live. */
    tick_hover: () => {
      reproject_hover()
      tick_entity_anchors()
    },
  }
}

// ── helpers ────────────────────────────────────────────────────────────────────────────────────────────────

/** The engine highlight channels the adapter paints (cleared as a set each repaint). */
// D241 canon channels: mp_range=LIGHT GREEN move reach, path=DARK GREEN steered hover, path_blocked=SOFT RED
// beyond-MP hover suffix (msg 3254), target=DARK BLUE LOS-clear targetable, los_blocked=LIGHT BLUE
// in-range-LOS-blocked, aoe=RED cursor zone. 'range' kept in the clear-loop only (legacy name; the adapter
// now paints move reach on the greened 'mp_range'). ghost=TRANSLUCENT CYAN placement-only peer pick hint
// (engine_view.placement_ghosts — cosmetic, never a trust surface).
// [entity-anchor] 'ally_seat'/'enemy_seat' REMOVED 2026-07-11 — that cell-state wash is retired (see the
// TEAM SEAT GLOW comment in paint()); the "cell under a fighter" marker is now tick_entity_anchors'
// continuous board.set_entity_anchor, not a set_cell_state/clear_states channel this list would clear.
// [#238] 'glyph_hover' joins 'aoe'/'path' as hover-owned (never lit[] here, see the loop comment above) — its
// only job in THIS pass is clearing a stale preview on a state change; 'glyph' stays the sole persistent writer.
const PAINT_CHANNELS = /** @type {const} */ ([
  'placement',
  'ghost',
  'range',
  'mp_range',
  'target',
  'los_blocked',
  'path',
  'path_blocked',
  'aoe',
  'glyph_hover',
  'trap',
  'glyph',
])
const CELL_M = 1.33 // DEFAULT_CELL_SIZE (D231) — cell world size for entity→screen projection
const CAST_H = 1.2 // [F1] chest height (m above the board origin) the cast flare/orb/impact billboards ride at

/** [F1] Board cell → the world point a cast VFX billboard sits at (cell centre, chest height). Mirrors the
 *  tooltip projection map (origin + (cell+0.5)·CELL_M) so a flare/orb lands exactly on the avatar. Exported so
 *  the DEV cast-VFX preview hook (dev_probe.__ARES_DEV_CAST_VFX) reuses the EXACT map — anchored at the same
 *  board._descriptor() origin play_cast reads from board_frame — instead of copying CELL_M/CAST_H (drift-proof).
 *  @param {{x:number,y:number,z:number}} origin @param {{x:number,y:number}} cell @returns {[number,number,number]} */
export function cell_cast_world(origin, cell) {
  return [origin.x + (cell.x + 0.5) * CELL_M, origin.y + CAST_H, origin.z + (cell.y + 0.5) * CELL_M]
}

/** A memo signature for the highlight paint — every input that changes a wash. */
function paint_key(result, fight, dungeon, replaying, busy) {
  let sig = `${result.phase}|${fight.fight_id}|${dungeon.room_index}|${fight.active_entity_id ?? ''}|${fight.armed_spell_id ?? ''}|${fight.winner}|rp:${replaying ? 1 : 0}|busy:${busy ? 1 : 0}|`
  // f.ap rides the sig (07-17): the folded AP spend gates the cast wash (wash_armed_spell) — a debit must repaint.
  for (const [id, f] of fight.fighters) sig += `${id}:${f.dead ? 'x' : `${f.cell.x},${f.cell.y},${f.mp},${f.ap}`}|`
  // the local placement pick moves the stand-here highlight; track it.
  sig += `pp:${use_dungeon_turn.getState().placement_pick ?? ''}`
  // the caster's own trap markers — a just-placed (or just-retired) trap must bust the memo so it repaints.
  sig += `|tr:${(fight.my_traps ?? []).join(',')}`
  // the caster's own glyph zones — a just-placed or expired glyph must bust the memo so the orange wash repaints.
  sig += `|gl:${(fight.my_glyphs ?? []).join(',')}`
  // peers' placement ghosts — a pick/supersede/expiry must bust the memo so the cyan hint repaints.
  sig += `|gh:${(fight.placement_ghosts ?? []).map((g) => `${g.character}:${g.cell}`).join(',')}`
  return sig
}

/** Subscribe to engine STATE_UPDATED (the fight slice's push channel). @param {() => void} cb */
function subscribe_state(cb) {
  const handler = () => cb()
  context.events.on('STATE_UPDATED', handler)
  return () => context.events.off('STATE_UPDATED', handler)
}
