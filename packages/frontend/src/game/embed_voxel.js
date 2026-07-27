// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D137/D158/D160/D161 — the voxel WORLD mount: THE renderer, the ONE engine session, the player's avatar.
//
// D158 SINGLE-BOOT LAW: the engine session is a MODULE SINGLETON — mounts ATTACH (reparent container+overlay),
// destroy() detaches + schedules a 300ms-grace dispose a remount cancels. A second boot is impossible.
// D161 (supersedes the loading screen): NO bar, NO veil — boot straight into the scene under a BLUR
// that melts to clarity at FIRST CHUNK; movement unlocks on the same signal. 10s hard-cap = the safety floor.
// D160/D191/D192/D193: the player's on-chain character walks on the ENG-24 controller as the ENGINE'S OWN
// avatar (create_character_avatar — lit/grounded/shadowed, hair via hair_url, #20 on-chain recolor via the
// CPU compositor); mouse-drag orbits, WASD/arrows move (the mouse-or-keys law), camera follows.
// D154: ONE input gate — a focused text field makes ALL game keys inert.
//
// NO game logic here (nor in the adapter): fight rules/drafts/txs live in DungeonBoard.jsx + dungeon_store.js.

import { create_character_controller, find_open_spawn, ground_surface_y, make_block_env } from '@aresrpg/engine3/player'
import { create_engine, world_config_for_biome, world_region_at } from '@aresrpg/engine3'
import { DEFAULT_WORLD_OFFSET } from '@aresrpg/sdk/coords'

import { create_tactical_board } from '@aresrpg/engine3/tactical'

import { create_voxel_fight_adapter, VOXEL_BOARD_ORIGIN } from '../world-shell/voxel_fight_adapter.js'
import { use_dungeon } from '../world-shell/dungeon_store.js'
import { use_party, wire_party_p2p } from '../world-shell/party_store.js'
import { wire_group_loop } from '../world-shell/group_wiring.js'
import { wire_fast_travel_effects } from '../world-shell/fast_travel_effects.js'
import { wire_join_request_effect } from '../world-shell/join_request_effect.js'
import { wire_commission_p2p } from '../world-shell/commission_inbox.js'
import { use_world_binding } from '../world-shell/session_gate.js'
import { read_world_biome } from '../world-shell/world_biome.js'
import { resolve_engine_recipe } from '../chain/deployment'
import { join_lobby } from '../p2p/lobby-room.js'
import { get_saved_quality } from './screens/hud/world/quality_pref.js'
import { apply_saved_engine_flags, resolve_hack_mode } from './screens/hud/world/engine_flags_pref.js'
import {
  can_persist_world_position,
  flush_world_position,
  note_world_position,
  read_world_chain_anchor,
  read_world_position,
} from '../world-shell/spawns_adapter.js'
import { should_reuse_pending_session } from './voxel_session_identity.js'
import { resume_zone_music, set_zone_music, stop_zone_music, suspend_zone_music } from './core/audio/ambient_music.js'
import { create_region_follower, region_zone_key } from './core/audio/region_music.js'
import { resolve_boot_spawn } from '@aresrpg/world/checkpoint'

import { read_checkpoint_spawn, resolve_checkpoint_spawn } from '../world-shell/world_checkpoint.js'
import { register_travel_resync_target } from '../world-shell/travel_recovery.js'
import { create_boot_veil } from './embed_voxel_boot.js'
import { read_spawn_column_gate } from './spawn_column_gate.js'
import { create_spectate_camera } from './embed_voxel_spectate.js'
import { create_fight_camera } from './embed_voxel_fight_camera.js'
import { is_mobile } from './core/mobile_mode.js'
import { create_fight_entry, prefers_reduced_motion } from './fight_entry.js'
import { plant_fight_sword } from './fight_sword.js'
import { instrument_cpu_callback } from './cpu_span.js'
import { prewarm_fight_vfx } from './fight_cast_vfx.js'
import { ALL_CAST_ELEMENTS } from './vfx_map.js'
import { play_fight_sfx } from './core/audio/sfx.js'
import { create_player } from './embed_voxel_player.js'
import { create_remote_players } from './remote_players.js'
import { create_world_spawns } from './world_spawns.js'
import { create_world_fights_discovery } from './world_fights_discovery.js'
import { create_world_props } from './world_props.js'
import { resolve_world_board_origin } from './world_board_seat.js'
import { push_progress_toast, resolve_progress_toast, push_event_toast } from './core/toast.js'
import { context } from './store.js'
import { use_spectate_gate } from '../stores/spectate_gate'
import { use_auth } from '../auth'
import i18n from '../i18n'
import { game_log } from '../core/log.js'
import { report_error } from '../core/report.js'

const DISPOSE_GRACE_MS = 300
// Physics-gate FAILSAFE ceiling (D188): the REAL gate is "spawn-column ground resident" — a healthy boot
// passes it in ~seconds. This ceiling only trips when that signal can NEVER come (a pathological never-solid
// column, e.g. a restored pose over water): a safety gate that hangs its player forever is worse than the
// fall. GENEROUS on purpose (not a tuned timing knob — the ground-resident signal is the gate) so a slow-but-
// normal load always releases on the real signal first; the ceiling fires only on a genuinely stuck column,
// after which the under-map rescue below snaps the body back onto the ground the moment it lands.
const PHYSICS_GATE_CEILING_MS = 15_000
// The board's SEALED render stride (D231: "squares too big, −33%" → 1.33 m/cell). This is engine
// tactical/board.js DEFAULT_CELL_SIZE, which the tactical entrypoint does NOT re-export — mirrored here (the
// fight-cam framing below reads the same const). Stable sealed contract, not a runtime-derived number.
const BOARD_CELL_M = 1.33
// D230 world-fight board placement: a MAX (17×19-cell) board CENTERED on the mob-group anchor (mirrors
// cave_room's board_anchor centering), so a WORLD fight's board sits AT the group instead of the y=260 sky.
// 17×19 = the board generator's MAX_W×MAX_H (engine binding/board_anchor.js); a smaller live board still
// centers acceptably (the same tolerance the cave path accepts).
const WORLD_BOARD_HALF_X = (17 * BOARD_CELL_M) / 2
const WORLD_BOARD_HALF_Z = (19 * BOARD_CELL_M) / 2
// D186 (hardcoded rather than search-derived): the ONE world spawn — a fixed scenic open spot.
// COORD CODEC ANCHOR (2026-07-10): world space is now SIGNED and origin-centred (world (0,0) = chain
// bounds/2), so the spawn moves to the ORIGIN.
// AMENDED 2026-07-11 (time-to-play lane runtime probe): the old [0.5,131,0.5] is SUBMERGED in the live
// gen — water y127-134, seabed y126 (the earlier offline "surface y=130 dry land" probe no longer matches
// the shipped worldgen); a fresh no-checkpoint spawn sank and floor-netted underwater. Nearest dry flat
// grass column probed live at [3.5,138,4.5] — feet on solid ground. The D188c boot scan still re-verifies
// the column every session (find_open_spawn spirals off any bad column).
const WORLD_SPAWN = /** @type {[number, number, number]} */ ([3.5, 138, 4.5])
// Spectate camera + params live in embed_voxel_spectate.js (600-LoC law split).

/** @type {any} the ONE live world session (D158) */
let session = null
/** S6 compat-floor hint — shown ONCE per page when the WebGL fallback engages (pre-WebGPU device). */
let compat_hint_shown = false
/** D175: the attach epoch — increments per mount; stale destroys/pauses (new-before-old remounts) no-op. */
let attach_epoch = 0

/** D157 prod fold-in: the HUD's engine access (QualitySelect.set_tier etc.) — a real module path, not the
 *  DEV-gated window global. Null when no world session is live. */
export const get_voxel_engine = () => session?.engine ?? null

/** @type {any} the world_config actually handed to create_engine for the live session — null pre-boot.
 *  Read-only accessor (mirrors get_voxel_engine's D157 "real module path" pattern) proving the biome→recipe
 *  boot-seam wiring (DECISIONS 07-12): its `.name`/`.seed` are each WORLD_CONFIGS entry's identity fields
 *  (packages/engine/src/config/worlds/*.js). */
let active_world_config = null
export const get_active_world_config = () => active_world_config

export { should_reuse_pending_session }

/** This session's OWN exclusive ownership of the ambient_music.js zone-music channel (D226 one-home law,
 *  issue #17 — "two audio tracks can overlap"): spectate is display-only and never arms it (the documented
 *  OFF-BY-DEFAULT silence), and FOLLOW hands the channel to follow.ts's OWN arm (the followed character's
 *  world — which can differ from this session's own bound_world) — so a follow session must never
 *  independently arm/re-arm it, or the two owners fight over the SAME 2-element roam/battle singleton. A
 *  normal resident session (neither spectate nor follow) with a bound world is the sole remaining owner.
 *  Pure — unit-tested without the engine.
 *  @param {boolean} spectate @param {boolean} follow @param {string | null} bound_world @returns {boolean} */
export const owns_ambient_music = (spectate, follow, bound_world) => !spectate && !follow && !!bound_world

/** Build the full session: engine (fixed world) + blur-boot + avatar/controller + board + adapter. */
function create_session(
  /** @type {string | undefined} */ tier, // undefined ⇒ engine device-detection (detect_starting_tier, engine.js:507)
  /** @type {any} */ character,
  /** @type {HTMLElement} */ host,
  /** @type {boolean} */ spectate = false,
  /** @type {boolean} */ follow = false
) {
  // [TIME-TO-PLAY instrumentation] the north star — "a time to play the fastest as possible". Marks
  // world-mount (t_boot) → focus_ready (world visible, below) → physics live (standing + controllable, in the
  // frame loop). The DELTAS are the world-boot cost we optimize; performance.now() is absolute-from-page-load
  // (the true time-to-play a returning player feels). Cheap, DEV+prod (readable from the console).
  const t_boot = performance.now()
  // container = what mounts reparent (the engine's D155 reroute may replaceWith() the canvas — never hold it).
  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;inset:0'
  const canvas = Object.assign(document.createElement('canvas'), { className: 'roam-canvas' })
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
  container.appendChild(canvas)
  // D176 (the black-canvas harness + the demo-lit/app-black discriminator): the engine MUST
  // meet an IN-DOM, laid-out canvas. The original D137 embed appended before creating the engine — the D158
  // singleton rewrite inverted that, so the renderer sized itself against a DETACHED 0×0 canvas and painted
  // nothing into a CSS-stretched void (pure black, isConnected=true, zero errors — the exact probe verdict;
  // every dark-app report dates from D158). Attach FIRST, create SECOND — the demo's own order.
  host.appendChild(container)

  // D210 — ONE world model (the fixed/streaming split is DELETED engine-side): the ring streams around
  // the camera, chunks generate as you move, and zone_origin/zone_size_m configure ONLY the border box
  // (default 600 m, D205 — the fence is what makes the world finite). The follow-cam at the character IS
  // the load focus; 'focus_ready' fires at ~1.3 s (the boot veil keys on it). BOTH modes pass the SAME
  // zone_origin so spectator and walker share one fence; spectate just streams a smaller ring (r4 ≈ 128 m
  // diorama — <1 s paint) around the D201 pan camera, which streams wherever it points for free.
  // FIVE WORLDS (BIOMES Phase 0): a temporary `?biome=<name>` switch selects one of the trailer worlds
  // (rainforest/riviera/everest/everglades/paradise). Absent param = RAINFOREST — picked the
  // jungle as the LOBBY world (07-07); the engine-side DEFAULT recipe remains a dev/test artifact.
  // FRONTEND WIRING (DECISIONS 07-12): the recipe now follows the BOUND WORLD's chain biome when no URL
  // override is present — precedence url > chain > default (chain/deployment.ts `resolve_engine_recipe`
  // + `engine_recipe_for_biome`'s pinned table). `read_world_biome` is a synchronous cache read
  // (world_biome.js) — GameWorldHost awaits `resolve_world_biome` before a resident mount, so it is already
  // populated here; spectate/unbound sessions read a falsy `bound_world` and fall straight to DEFAULT
  // (byte-identical to the prior unconditional RAINFOREST fallback — Testlands' own "testlands" biome is
  // unmapped and falls through the SAME path, so a live session there never changes recipe).
  const bound_world = use_world_binding.getState().world ?? null
  const recipe_name = resolve_engine_recipe({
    url_biome: new URLSearchParams(location.search).get('biome'),
    chain_biome: bound_world ? read_world_biome(bound_world) : null,
  })
  // GRADUATED SETTINGS (FLAGS → SETTINGS PAGE): push the persisted/URL-resolved value of the 3 globalThis-backed keeper
  // flags (sun_follow/sky_couple/taau_medium — engine_flags_pref.js's header survey) into the SAME
  // `__ARES_*` globals core/renderer.js reads, BEFORE create_engine() constructs the renderer — every
  // (re)boot of this function (fresh mount AND a live tier-reboot) re-applies fresh, so a settings change
  // saved via engine_flags.js is live the moment the session next re-creates.
  apply_saved_engine_flags()
  // HACK MODE (docs/design/hack_mode_spec.md §1.5) — the world PRESENTATION, resolved ONCE here beside the
  // biome recipe because it is a composition-root selection, not a runtime branch: 'hackgrid' builds no
  // gen/mesh/far workers, no ring, no water/ambience/atmosphere, and answers the collision/residency oracle
  // with a constant plane, so every downstream consumer (controller, boot veil, entity grounding, board
  // seating) inherits the flat world through the SAME surface it already reads. SPECTATE is excluded: the
  // login backdrop stays the scenic terrain vista — hack is a preference for sessions you PLAY.
  const presentation = !spectate && resolve_hack_mode(location.search) ? 'hackgrid' : 'terrain'
  // The HUD needs the SAME answer (hack mode streams the owner's playlist instead of our beds — the radio
  // widget mounts on this). Publishing it through the reducer door here, at the one place the mode is
  // resolved, is what makes a settings flip reach the HUD live: set_hack_mode re-creates the session, which
  // re-runs this line. No second pref read, no page reload, and spectate is correctly never the grid.
  context.dispatch('action/world_presentation', presentation)
  const world_config = world_config_for_biome(recipe_name)
  active_world_config = world_config // DEV/proof accessor — get_active_world_config()
  // Resident bound-world music refines this session's base biome to `${world}:${region}` while the player roams.
  // Spectate/unbound sessions never arm (the documented OFF-BY-DEFAULT world-view silence). FOLLOW sessions
  // never arm it either (D226 one-home fix, issue #17 "double music playback"): the follow store
  // (src/follow.ts) is this channel's EXCLUSIVE owner while following — it arms the FOLLOWED character's
  // world, which can differ from this session's own bound_world, so a follow session's boot-arm/region-
  // follower must stand down entirely rather than fight follow.ts for the SAME 2-element ambient_music.js
  // singleton. owns_ambient_music is the one pure gate for both call sites below. The base biome mirrors
  // follow.ts world_to_biome exactly (chain biome, 'arctic' fallback) so a non-region world's key equals
  // what this session armed — the follower then never fires a switch there.
  const region_follower = owns_ambient_music(spectate, follow, bound_world)
    ? create_region_follower({ arm: (key) => set_zone_music(key) })
    : null
  const region_base_biome = (bound_world ? read_world_biome(bound_world) : null) ?? 'arctic'
  const engine = spectate
    ? create_engine({ canvas, tier, zone_origin: [0, 0], load_radius: 4, world_config, presentation })
    : create_engine({ canvas, tier, zone_origin: [0, 0], world_config, presentation })
  if (owns_ambient_music(spectate, follow, bound_world)) set_zone_music(region_base_biome)
  // BOUNDLESS WORLD + COORD CODEC: world space is SIGNED and centred on the origin,
  // so the finite fence is symmetric — ±(bounds/2) on each axis. That half-extent is exactly the world↔chain
  // offset (DEFAULT_WORLD_OFFSET = the default world's bounds/2 = 250 000), so the fence and the coord codec
  // derive from ONE number instead of a bare magic constant. The movement clamp stays (a body can't escape
  // 500k×500k) but the barrier glow sits 250 km out, unreachable. (A per-world bounds would refresh this from
  // the World doc once loaded; today the single live world uses the default bounds, so the const is exact.)
  engine.set_zone_bounds?.({
    min_x: -DEFAULT_WORLD_OFFSET,
    min_z: -DEFAULT_WORLD_OFFSET,
    max_x: DEFAULT_WORLD_OFFSET,
    max_z: DEFAULT_WORLD_OFFSET,
  })
  // ENGINE FATAL SURFACE (S-Sentry): a boot_error is a dead 3D view — LOUD to us (report_error carries the raw
  // GPU/shader cause) and CLEAR to the player (an honest error toast instead of the unexplained black canvas).
  engine.on('boot_error', (/** @type {unknown} */ error) => {
    game_log('voxel', 'engine boot failed', error)
    report_error(error, { area: 'engine', action: 'boot' })
    push_event_toast({ state: 'error', title: i18n.t('world.engine_boot_failed') })
  })
  // witness-r4 CHURN FIX — GPU-crash half: renderer.js already detects a lost WebGPU device (or its WebGL
  // context-loss equivalent — three's onDeviceLost hook is backend-agnostic) and attempts ONE silent re-init;
  // nothing app-side ever surfaced that to the player, so a device loss read as an unexplained black canvas
  // ("GPU-crash cycles" in the churn report). A sticky progress toast makes the recovery HONEST end to end —
  // never a silent black — instead of console-only breadcrumbs. The crash's ROOT CAUSE stays out of this
  // fence (another lane's problem); this is the RECOVERY signal only.
  let device_lost_toast_id = /** @type {number | null} */ (null)
  engine.on('device_lost', () => {
    device_lost_toast_id = push_progress_toast({ title: i18n.t('world.renderer_restarting') })
  })
  engine.on('device_restored', (/** @type {boolean} */ ok) => {
    // a FAILED restore is the fatal outcome (a successful auto-recovery is a non-event) — loud to us
    if (!ok)
      report_error(new Error('GPU device lost — renderer restore failed'), { area: 'engine', action: 'device_restore' })
    if (device_lost_toast_id == null) return
    resolve_progress_toast(device_lost_toast_id, {
      state: ok ? 'success' : 'error',
      title: i18n.t(ok ? 'world.renderer_restored' : 'world.renderer_restart_failed'),
    })
    device_lost_toast_id = null
  })

  // The provisional spawn Y is resolved below after the veil is created; expose the live variable to its
  // residency poll so a restored/checkpoint x/z replaces WORLD_SPAWN before the first 250 ms sample.
  let boot_spawn = WORLD_SPAWN
  // D161/D174/D177/D205 — the boot veil (blur + focus-ready signals + daylight poke): embed_voxel_boot.js
  // (600-LoC law split). Resident sessions now share the spawn-column residency truth with physics below.
  // P2 blur sweep (the blurry loading was removed in fight — not useful there): a live
  // dungeon context — entry, refresh-into-fight, resume, board-gen wait — must NEVER sit under the boot blur
  // (the veil's readiness oracle samples the OVERWORLD spawn column, which a cave session never satisfies;
  // the sword ceremony is the fight's wait-cover). The predicate reads the dungeon slice LIVE so a resume
  // that lands mid-boot melts the veil the moment the context exists.
  create_boot_veil({
    engine,
    container,
    spectate,
    world_spawn: () => boot_spawn,
    in_fight: () => {
      const s = use_dungeon.getState()
      return !!(s.dungeon || s.dungeon_id)
    },
  })
  // ENG-20: the ENGINE is the one WebGPU-detection home — one warn on the floor, nothing else branches.
  const backend = engine.get_stats?.().renderer_backend
  if (backend === 'webgl') {
    game_log('voxel', 'webgl floor active — tactical board/cave render as engine no-ops (ENG-20)')
    // S6 COMPATIBILITY FLOOR: the WebGL heightmap fallback is the PROVEN pre-WebGPU
    // path — backend.js picks it SYNCHRONOUSLY on a missing navigator.gpu (no failed-probe delay). Tell the
    // player ONCE, honestly, that they're in reduced-visual compat mode instead of silently degrading. Gated
    // to gameplay (not the login backdrop) + latched so a live tier-reboot doesn't re-nag.
    if (!spectate && !compat_hint_shown) {
      compat_hint_shown = true
      push_event_toast({ state: 'info', title: i18n.t('world.compat_mode') })
    }
  }
  // [TTP] focus_ready = the player's neighborhood is resident (world visible + walkable) — the first half of
  // time-to-play, measured for BOTH spectate and session boots. Logged once.
  let t_focus = 0
  engine.on('load_progress', (/** @type {{phase:string,loaded?:number,total?:number}} */ p) => {
    if (!t_focus && (p.phase === 'focus_ready' || p.phase === 'done')) {
      t_focus = performance.now()
      game_log(
        'TTP',
        `focus_ready (world visible) +${(t_focus - t_boot).toFixed(0)}ms world-boot · ${t_focus.toFixed(0)}ms from page load` +
          ` · resident=${p.loaded ?? '?'} / ${p.total ?? '?'} chunks`
      )
    }
  })
  engine.start()

  // D162 (qa-blocked front door): roam.js's NPC-proximity dispatcher died with D139 — nothing set npc_prompt
  // on voxel, so NpcPrompt returned null and its E handler never bound. Until #47's dungeon-dimension map
  // entry, the gate is an ALWAYS-LIVE world affordance: the session dispatches the prompt on boot and clears
  // it on dispose. (NpcPrompt itself keeps all its gating: modal-open, fight-mode, stuck/exploring honesty.)
  if (!spectate) context.dispatch('action/npc_prompt', { npc_id: 'dungeon_gate', label: 'dungeons' })

  // ── D183 SPECTATE BACKDROP (a simple fast world behind the login card): NO controller, NO avatar,
  //    NO input, NO board — a static scenic vista (the architect's ENG-24-contract framing: lifted, pitched
  //    down; orientation = (yaw, pitch) RADIANS). Posed once terrain answers; the D177 poke keeps daylight. ──
  if (spectate) {
    if (import.meta.env.DEV) /** @type {any} */ (window).__voxel_engine = engine // probes/QualitySelect parity
    // D183+D184+D201 SPECTATE BACKDROP: NO controller, NO game input — the hands-on iso camera lives in
    // embed_voxel_spectate.js (pan clamped in-zone, yaw, pitch LOCKED; the APP deliberately drives it —
    // one writer: the first set trips the engine's D185 standdown, the designed interplay).
    // D206 (the spectate view must show other players too): join the p2p lobby as the #19 SILENT
    // OBSERVER (null id — lobby-room's documented read-only spectator: receives pos/chat/state, sends
    // nothing; on login the SAME room re-identifies, no reconnect) + render every presence entry as a
    // live avatar. Chat flows into message_history for the D207 read-only overlay for free.
    join_lobby(null)
    const remotes = create_remote_players(engine, canvas) // D232 — plates project through THIS canvas's rect
    // INTERACTION GATE: the backdrop is DISPLAY-ONLY until the visitor chose "watch the
    // live world" (use_spectate_gate.chosen) OR is logged in (use_auth.address — the S-57 confirmed-unbound
    // spectate is a logged-in state). Read live per drag; the auto-drift plays regardless (ambience, not input).
    const can_interact = () => use_spectate_gate.getState().chosen || !!use_auth.getState().address
    const iso_cleanup = create_spectate_camera(engine, WORLD_SPAWN, canvas, can_interact)
    const cleanup = () => {
      remotes.dispose()
      iso_cleanup()
    }
    const set_frame_paused = (/** @type {boolean} */ paused) => {
      remotes.set_paused?.(paused)
      iso_cleanup.set_paused(paused)
    }
    return {
      engine,
      board: null,
      adapter: null,
      container,
      cleanup,
      dispose_timer: null,
      mode: 'spectate',
      set_frame_paused,
      world_id: bound_world,
    }
  }

  // ── D160: spawn + controller + avatar ─────────────────────────────────────────────────────────────────────
  // D186: the HARDCODED scenic spawn (a simplification — no boot-time search; the D173 entombment
  // guard below stays as the safety net if the world ever grows over the constant).
  // ONE bound sampler home — the controller, the D173 guard, the D188 gate, the D188c scan AND the camera
  // arm all read through this closure (the guard once passed engine.sample_block DETACHED: a this-loss
  // class). D211: the oracle is SWAPPABLE — inside the dungeon cave the room's own sampler takes over
  // (standalone cave chunks never enter the streamed ring's store, D141), the world oracle returns on exit.
  // [FIRST-LOAD]: a basic voxel plane lets the player keep moving while the world is loading.
  // The overworld sampler composes the engine's ANALYTIC ground fallback: a not-yet-streamed column reads
  // the generator's surface height as solid ground (solid below surface_y, air above) so the physics/input
  // gate opens at t≈0 and the body walks on the about-to-materialize terrain, instead of falling through
  // void until chunks stream in. Resident chunks return voxel truth (caves stay caves). `sample_block_analytic`
  // is WebGPU-engine only → falls back to plain sample_block on the WebGL floor (a fully-resident heightmap).
  const world_sample = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
    engine.sample_block_analytic?.(x, y, z) ?? engine.sample_block?.(x, y, z) ?? 0
  /** @type {((x:number,y:number,z:number)=>number) | null} */ let cave_sample = null
  const sample = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
    (cave_sample ?? world_sample)(x, y, z)
  // Block-class SSOT (solid vs fluid vs flora) — the camera arm's collision oracle (D195). A naive
  // truthy-sample here would make the camera collide with WATER and cross-flora. Demo parity (walk_mode:48).
  // block_id_at rides the SAME env bag (world/cave-swappable, D211) — the raw sampler, additive alongside
  // solid_at/liquid_at, so footstep/water ambience (embed_voxel_player.js frame2) reads ground material
  // through the identical accessor the physics uses, cave override included for free.
  const env = { ...make_block_env(sample), block_id_at: sample }

  // SESSION POSITION RESTORE — GameWorldHost awaited the IndexedDB edge before mounting, and an accepted row
  // re-entered through the spawns reducer's `player_pos` door. This synchronous render point only projects that
  // reduced, identity-scoped candidate into the boot arbiter; every claim/travel decision still reads chain
  // truth. "Does real ground exist there" cannot be answered before streaming, so the D173 entombment guard
  // below remains the terrain check for every chosen boot position.
  boot_spawn = WORLD_SPAWN
  let boot_yaw = 0
  let restored = false
  let from_checkpoint = false
  if (character?.id) {
    const world_id = use_world_binding.getState().world ?? null
    // The adapter returns reducer state only when it belongs to this exact character+world.
    const stored = read_world_position(character.id, world_id)
    const bounds = engine.get_zone_bounds?.() ?? null
    const in_bounds =
      !bounds ||
      !stored ||
      (stored.x >= bounds.min_x && stored.x <= bounds.max_x && stored.z >= bounds.min_z && stored.z <= bounds.max_z)
    if (stored && !in_bounds) game_log('voxel', 'stored session position outside the zone fence — ignored', stored)
    const session = stored && in_bounds ? stored : null
    // CHAIN TRUTH (§5): use the canonical checkpoint cache populated before mount. The pure boot projection
    // applies the distance guard again, so a local row can never outrank a disagreeing chain anchor.
    const checkpoint =
      world_id && (read_world_chain_anchor(character.id, world_id) ?? read_checkpoint_spawn(character.id, world_id))
    const chosen = resolve_boot_spawn({ checkpoint, session, fallback: WORLD_SPAWN, y_seed: WORLD_SPAWN[1] })
    boot_spawn = chosen.position
    boot_yaw = chosen.yaw
    restored = chosen.source === 'session'
    from_checkpoint = chosen.source === 'checkpoint'
  }

  // D204: get_bounds ARMS the engine's physical border — every fixed step hard-clamps the body inside
  // the zone fence on ALL states (walk, jump arcs, falls: crossing axis stops, velocity zeroes, slide
  // along never through) + OOB RESCUE (a body already outside snaps back, loud warn). Without this line
  // the fence is inert and a jump escapes the world.
  const ctl = create_character_controller({
    sample_block: sample,
    position: [...boot_spawn],
    yaw: boot_yaw,
    get_bounds: () => engine.get_zone_bounds?.() ?? null,
  })
  game_log(
    'voxel',
    `spawn = [${boot_spawn.join(', ')}]` +
      (from_checkpoint
        ? ' (on-chain checkpoint)'
        : restored
          ? ' (restored session position)'
          : ' (WORLD_SPAWN default, D186)')
  )

  // checkpoint::102 RECOVERY — the tx chokepoints expose one persistent action; this live-session target does
  // the refresh boot path's chain-truth half IN PLACE. Re-read the namespaced checkpoint (never the stale cache),
  // convert it through resolve_checkpoint_spawn, then hard-place the existing controller at that exact x/z.
  // No transaction is submitted or retried here. The ground oracle only supplies the checkpoint's render Y.
  let travel_resync_live = true
  const dispose_travel_resync = register_travel_resync_target(async () => {
    const world_id = use_world_binding.getState().world ?? null
    if (!travel_resync_live || !character?.id || !world_id || cave_sample) return false
    const checkpoint = await resolve_checkpoint_spawn(character.id, world_id)
    if (!travel_resync_live || !checkpoint || use_world_binding.getState().world !== world_id || cave_sample)
      return false
    const surface_y = ground_surface_y(world_sample, Math.floor(checkpoint.x), Math.floor(checkpoint.z))
    const destination = /** @type {[number, number, number]} */ ([
      checkpoint.x,
      surface_y == null ? WORLD_SPAWN[1] : surface_y + 1,
      checkpoint.z,
    ])
    ctl.teleport(destination)
    // Keep the reducer + persistence edge aligned too. The freshly resolved checkpoint is captured as this
    // row's anchor, so a later ordinary remount cannot resurrect the pre-resync pose over chain truth.
    void note_world_position({
      character_id: character.id,
      world_id,
      x: destination[0],
      z: destination[2],
    })
    void flush_world_position()
    game_log('checkpoint', `resynced live body to proven position [${destination.join(', ')}]`)
    return true
  })

  // D173 ENTOMBMENT GUARD (a camera once woke INSIDE a tree — the forest grew around a saved pre-forest
  // pose). Structural invariant: whatever chose the boot position — the fresh spawn above today, ANY future
  // stored-position restore tomorrow — a body inside solid occupancy at the moment terrain is fully resident
  // snaps to find_open_spawn. No boot may ever start buried, however much the world grows around a save.
  {
    let checked = false
    engine.on('load_progress', (/** @type {{phase:string}} */ p) => {
      // D205: 'focus_ready' (~3-4 s) is the honest moment — the spawn NEIGHBORHOOD is resident, which is
      // all this guard + the D188c scan ever sample; waiting for 'done' would idle them ~33 s at 600 m.
      // D213-app (architect warning): NEVER top-down-scan the in-cave player — the cave roof reads as
      // valid ground (the demo's exact roof-spawn bug). In-cave positions are cave_session's business.
      if (cave_sample) return
      if (checked || (p.phase !== 'focus_ready' && p.phase !== 'done' && p.phase !== 'far')) return
      checked = true
      try {
        // D188(c) — the spawn-coord question answers itself EVERY boot: first solid under the spawn column,
        // logged with its block id (a FLUID id {5,24} or a y far below the expected line = wrong constant).
        // boot_spawn (not the WORLD_SPAWN literal) — a restored session position boots somewhere else entirely.
        let scan_y = -1
        let scan_id = 0
        for (let y = Math.floor(boot_spawn[1]) + 20; y >= 60; y -= 1) {
          const b = sample(Math.floor(boot_spawn[0]), y, Math.floor(boot_spawn[2]))
          if (b) {
            scan_y = y
            scan_id = b
            break
          }
        }
        // D210: the spiral can fire 'focus_ready' a beat before THIS column's upload lands — an empty scan
        // is a RACE, not a verdict: release the one-shot and let 'done'/'far' re-run both checks honestly.
        if (scan_id === 0 && p.phase === 'focus_ready') {
          checked = false
          return
        }
        game_log(
          'voxel',
          `spawn column sample = block ${scan_id} at y=${scan_y} under [${boot_spawn.join(', ')}] ` +
            `(D188c — want solid ground at y≈${Math.floor(boot_spawn[1]) - 1}; FLUID ids are 5/24)`
        )
        const pos = ctl.get_transform().position
        const bx = Math.floor(pos[0])
        const bz = Math.floor(pos[2])
        const feet = sample(bx, Math.floor(pos[1]), bz)
        const head = sample(bx, Math.floor(pos[1]) + 1, bz)
        // BOTH blocks occupied = buried (feet-only is the normal standing graze: the settle tick rests the
        // feet plane a hair inside the ground block — a false ENTOMBED + same-spot warp every boot without
        // this). Real burials (world grew over a save, canopy, water sink) fill the whole body column.
        if (feet && head) {
          // Rescue NEAR the burial (architect's root-fix shape): wake beside where you stood, not across
          // the map; world-centre only if the whole neighborhood is solid (max_r=40 search exhausts).
          const rescue = find_open_spawn?.(sample, bx, bz) ?? find_open_spawn?.(sample, 150, 150) ?? [...WORLD_SPAWN] // last resort: home. (Was `spawn_fallback` — an UNDEFINED ref the catch ate.)
          ctl.teleport(rescue)
          game_log(
            'voxel',
            `ENTOMBED at [${bx}, ${Math.floor(pos[1])}, ${bz}] — rescued to [${rescue.join(', ')}] (D173)`
          )
        }
      } catch {
        /* guard never breaks boot */
      }
    })
  }

  // D206 (session half): the walker must be SEEN — roam's cell-change broadcast died with D139 and nobody
  // has announced a position since (every walker was invisible to every peer). The frame loop below
  // broadcasts on cell change; state (colors → remote rigs, party id) publishes once at mount through the
  // party store's single chokepoint; the p2p party signals re-wire here too (their roam-mount call died with
  // roam). Remote players render via the same one-home layer spectate uses.
  if (character?.id) {
    wire_party_p2p()
    // MULTICHAR group loop (flagship system): the pure @aresrpg/party group_loop reducer + its edges —
    // owned-alt world alignment, formation follow, placement-window fight joins, HUD seat focus.
    wire_group_loop()
    // FAST TRAVEL: arm the dragon-ride effect edges (resolve /v1 world+pos → gate → join/fly, + lifecycle
    // toasts). Idempotent, one subscription for the app lifetime — survives the cross-world session swap.
    wire_fast_travel_effects()
    // CREATE→PLAY JOIN (v33): arm the join-request edge — the create receipt's join_request drives the
    // actual world join off the SAME join/boot seam. Idempotent, one subscription for the app lifetime.
    wire_join_request_effect()
    // Commission Flow v2: surface incoming artisan-commission requests (toast + chime + inbox) — idempotent,
    // filtered by my wallet, off the SAME lobby room. Beside wire_party_p2p so both p2p consumers arm together.
    wire_commission_p2p()
    // D222-reopen: pass the IN-HAND character — the store read races the mount (see _publish_state).
    use_party.getState()._publish_state(character)
  }
  const remotes = create_remote_players(engine, canvas) // D232 — plates project through THIS canvas's rect
  // WORLD SPAWNS — the CHAIN spawns of the current + adjacent discovered zones as interactable fixtures:
  // click a mob group → the claim+create world-fight PTB; stand near a resource → the [G] gather prompt.
  // Range-gated + dungeon-suspended; projects plates through THIS canvas's rect.
  const world_spawns = create_world_spawns({
    engine,
    canvas,
    get_player_pos: () => ctl.get_transform().position,
  })
  // NEARBY FIGHTS — the "See fights in the area" discovery loop: a sibling of world_spawns that
  // polls /v1/fights?world, folds OTHER players' fights within 50 blocks into state.visible_fights, and arms the
  // [V] PromptStack prompt → the FightsModal panel (spectate/join). Design ruling 2026-07-19: also plants the fight_sword.js
  // herald for OTHER players' still-forming fights (engine passed through for the plant/despawn + ground-sample);
  // suspended in a dungeon.
  const world_fights = create_world_fights_discovery({ get_player_pos: () => ctl.get_transform().position, engine })
  // WORLD PROPS — sparse FlameFX ambience camps (bonfire + candle torches) dusted across the overworld on a
  // deterministic grid, grounded on the real surface, range-gated + dungeon-suspended. Decorative only (no chain,
  // no interaction); the WORLD-PROPS d_world VFX lane's overworld half (the dungeon half lives in cave_scene).
  // Skipped entirely in hack mode: the camps are pure terrain decoration, and "not be bothered by the real
  // terrain" means a clean grid (hack_mode_spec.md §1.5).
  const world_props =
    presentation === 'hackgrid'
      ? null
      : create_world_props({ engine, get_player_pos: () => ctl.get_transform().position })
  // TR-97 SKY DRAGON (trailer): `?dragon=1` (variant via `?dragon=frost|fire|void`) soars a scripted dragon
  // high across the demo sky for trailer capture. Absent by default — the module only imports when the
  // flag is set (zero cost otherwise). Lazy import mirrors cave_session (never loaded for a flagless session).
  /** @type {{ dispose: () => void } | null} */ let sky_dragon = null
  if (!spectate && new URLSearchParams(location.search).get('dragon')) {
    void import('./sky_dragon.js')
      .then((m) => {
        sky_dragon = m.create_sky_dragon({ engine, center: WORLD_SPAWN })
      })
      .catch((error) => game_log('voxel', 'sky dragon spawn failed:', error))
  }
  // D211: the cave transition — in_session (create/JOIN/RESUME alike) mounts the ENG-17 room + teleports
  // the player in, "no questions asked"; exit tears down + returns. Lazy import: the dungeon store never
  // loads for a session that never touches dungeons.
  /** @type {{ dispose: () => void } | null} */ let cave_session = null
  /** @type {[number, number, number] | null} */ let net_home = null // D188-cave: in-cave falls return to the cave entry
  void import('./cave_session.js')
    .then((m) => {
      cave_session = m.create_cave_session({
        engine,
        ctl,
        canvas, // D232 — cave_mobs projects plates through THIS canvas's rect (never a stray querySelector hit)
        swap_sampler: (fn) => {
          cave_sample = fn
        },
        set_home: (pos) => {
          net_home = pos
        },
      })
    })
    .catch((error) => {
      game_log('voxel', 'cave session wiring failed (dungeons stay lobby-only):', error)
      report_error(error, { area: 'engine', action: 'cave_session_wiring' })
    })

  // The fight turntable camera (embed_voxel_fight_camera.js) + the local player (avatar/aura/
  // plate/input/mount/broadcast/walk-cam — embed_voxel_player.js), split at the 600-LoC law. The player
  // stands down when the fight camera is the live writer (is_fight); its cinematic mode asks the session to
  // hide the OTHER DOM plate layers (remote players / world spawns), its own plate it hides.
  // Fixed-angle orthographic on every device (the isometric view is now the default) — the old
  // `?isometric` opt-in dial is retired.
  const fight_camera = create_fight_camera({
    engine,
    canvas,
    board_cell_m: BOARD_CELL_M,
    mobile: is_mobile(),
  })
  // ONE eligibility predicate for BOTH cadence writes and explicit flushes (pagehide / quality re-boot).
  // The complete run identity closes optimistic entry (`in_session`), between-room (`run_pass_id`), and
  // pre-camera world-fight (`fight_id`) windows; cave_sample independently covers the cave transition.
  const can_persist_position = () => {
    const dungeon = use_dungeon.getState()
    return can_persist_world_position({
      character_id: character?.id ?? null,
      world_id: bound_world,
      in_fight: fight_camera.is_active() || !!dungeon.fight_id,
      in_dungeon: !!(dungeon.in_session || dungeon.run_pass_id || dungeon.dungeon || dungeon.dungeon_id),
      in_cave: !!cave_sample,
    })
  }
  const flush_position = () => {
    if (can_persist_position()) void flush_world_position()
  }
  let physics_live = false // Lane 66: ONE readiness bit gates both input and controller ticks.
  const player = create_player({
    engine,
    canvas,
    character,
    ctl,
    env,
    world_id: bound_world,
    initial_yaw: boot_yaw, // session-position restore (or 0 for the WORLD_SPAWN default) — the shoulder cam seeds the same look direction
    is_fight: () => fight_camera.is_active(),
    // Keys/sticks may arm while loading, but feed() stays inert until the exact same `physics_live` bit that
    // permits ctl.tick. A held direction therefore takes effect on the first resident-column frame, without
    // waiting for focus_ready or requiring a second key press.
    is_ready: () => physics_live,
    on_cinematic_change: (/** @type {boolean} */ on) => {
      remotes.set_hidden?.(on)
      world_spawns.set_hidden?.(on)
      world_props?.set_hidden?.(on)
    },
  })
  game_log(
    'boot-trace',
    `input events armed +${(performance.now() - t_boot).toFixed(0)}ms; input+controller wait for resident column ` +
      `[${Math.floor(boot_spawn[0])}, ${Math.floor(boot_spawn[2])}]`
  )

  // ── the frame loop: tick physics, pose the avatar, follow with the camera. ──────────────────────────────

  let raf = 0
  let last_t = performance.now()
  const gate_t0 = performance.now() // D188 failsafe clock — the gate may never hang its player (a real repro hung at y=163 over the bay)
  let gate_timed_out = false // D188-recovery — a failsafe drop re-snaps once real ground lands
  let under_map_settled = false // D188 refresh rescue — latches once the body has rested on real ground; gameplay owns Y after
  let gate_wait_logged = false
  const frame_body = (/** @type {number} */ now) => {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.1, (now - last_t) / 1000)
    last_t = now
    fight_camera.integrate(dt) // D251 — damped+inertial orbit (inert unless the fight camera is the live writer)
    // D188/Lane-66 PHYSICS GATE: checkpoint/session positions carry x/z with a provisional Y, so the old
    // `seed_y - 1` voxel test could remain resident AIR forever. Hold until the feet column's GROUND CHUNK is
    // resident, then snap to its open-ground surface (when one exists) and release controller+gravity.
    if (!physics_live) {
      const column_gate = read_spawn_column_gate({
        spawn: boot_spawn,
        is_column_resident: (x, z) => engine.is_column_resident?.(x, z) ?? false,
        sample_block: (x, y, z) => engine.sample_block?.(x, y, z) ?? 0,
      })
      if (column_gate.ready) {
        if (column_gate.ground_y !== null) ctl.teleport([boot_spawn[0], column_gate.ground_y + 1, boot_spawn[2]])
        physics_live = true
        const t_play = performance.now()
        const stats = engine.get_stats?.() ?? {}
        game_log(
          'TTP',
          `TIME-TO-PLAY ${(t_play - t_boot).toFixed(0)}ms world-boot · ${t_play.toFixed(0)}ms from page load ` +
            `— feet column resident, ground=${column_gate.ground_y ?? 'drop'}, physics+movement live ` +
            `· resident=${stats.resident_chunks ?? 0} chunks · focus_ready=${t_focus > 0}`
        )
      } else if (!gate_wait_logged) {
        gate_wait_logged = true
        const stats = engine.get_stats?.() ?? {}
        const x = Math.floor(boot_spawn[0])
        const y = Math.floor(boot_spawn[1]) - 1
        const z = Math.floor(boot_spawn[2])
        game_log(
          'boot-trace',
          `physics gate waiting +${(performance.now() - t_boot).toFixed(0)}ms: column resident=false, ` +
            `seed-below raw=${engine.sample_block?.(x, y, z) ?? 0}, analytic=${sample(x, y, z)}, ` +
            `resident=${stats.resident_chunks ?? 0} chunks`
        )
      } else if (now - gate_t0 > PHYSICS_GATE_CEILING_MS) {
        // D188 FAILSAFE (a real repro hung FOREVER over the bay): a wet/never-solid spawn column means this gate's
        // condition can NEVER pass — a safety gate that can hang its player is worse than the fall it
        // prevents. Engage anyway, loudly; the under-map rescue below + the floor net self-heal the void fall.
        physics_live = true
        gate_timed_out = true
        game_log(
          'voxel',
          `physics gate hit the ${PHYSICS_GATE_CEILING_MS}ms failsafe over a never-resident column (D188) — engaging physics anyway`
        )
      }
    } else if (!under_map_settled && !cave_sample) {
      // UNDER-MAP RESCUE (a slow-refresh repro: stuck under the map while the
      // chunk loads overhead). On a slow boot the body can end up BELOW its spawn column — released over
      // void by the failsafe, or dropped by streaming churn after release — and then terrain materializes
      // OVERHEAD, entombing it. The moment the spawn column is resident, if the body sits below its ground,
      // SNAP it up onto the spawn (whose ground-below the gate just confirmed solid = a valid standing spot).
      // Fires on ANY cause (not only the failsafe); one snap, then latch. Latches equally the instant the body
      // rests on real ground (on_ground) so a healthy boot is a no-op and gameplay owns Y from there (caves/
      // pits/jumps are legitimately "below" things). Overworld only.
      const below = sample(Math.floor(boot_spawn[0]), Math.floor(boot_spawn[1]) - 1, Math.floor(boot_spawn[2]))
      const t0 = ctl.get_transform()
      if (below && t0.position[1] < boot_spawn[1] - 2) {
        ctl.teleport([...boot_spawn])
        gate_timed_out = false
        under_map_settled = true
        game_log(
          'voxel',
          `UNDER-MAP RESCUE — body at y=${t0.position[1].toFixed(1)} below the resident spawn ground, ` +
            `snapped to spawn [${boot_spawn.join(', ')}] (D188 refresh repro)`
        )
      } else if (t0.on_ground) {
        under_map_settled = true // rested on real ground — done; hand vertical control to gameplay
      }
    }
    // D195/D188 — feed the controller (input → movement with the rig's azimuth as the basis; the D154/D161
    // inert gate + the mount ×1.5 + the veteran-aura edge-broadcast ride inside; physics-gated tick).
    player.feed(dt, physics_live)
    const t = ctl.get_transform()
    // D188(a) FLOOR NET: below the world bottom = a void fall the entombment guard can't see — teleport
    // HOME, loudly. Home is SESSION-AWARE (qa: an in-cave fall once warped to the overworld spawn while
    // the state stayed in-cave — body/state divergence): cave entry while inside, world spawn otherwise.
    // D213-REOPEN BELT: `cave_sample` is the in-cave discriminator (the cave's own collision oracle is
    // swapped in ⇔ we're inside). While it's active the net MUST return to the CAVE — never WORLD_SPAWN —
    // even if `net_home` were somehow null (mount race / partial state): fall back to the live session
    // handle's cave entry. Only truly overworld (no cave oracle) do we use WORLD_SPAWN.
    if (t.position[1] < -10) {
      // in-cave (cave_sample swapped in) → the cave entry (net_home, or the session handle as belt);
      // overworld → net_home (null there) ?? WORLD_SPAWN. cave_home is non-null whenever we're in-cave.
      const cave_home = cave_sample ? (net_home ?? cave_session?.get_cave_home?.() ?? null) : null
      const home = cave_home ?? net_home ?? WORLD_SPAWN
      ctl.teleport([...home])
      game_log('voxel', `floor net → ${cave_home ? 'CAVE entry' : 'world spawn'}`)
      game_log(
        'voxel',
        `FELL BELOW THE WORLD at y=${t.position[1].toFixed(1)} — teleported to [${home.join(', ')}] (D188)`
      )
    }
    player.frame2(t, dt) // broadcast our pose/cell + pose the avatar/mount/plate + aura, then the walk camera (a fight hides the body)
    // LAST POSITION input — the world-shell adapter owns the ~5s IndexedDB cadence. The SAME predicate gates
    // pagehide below, so a frozen world-fight controller and a cave/dungeon controller can never persist.
    if (can_persist_position())
      void note_world_position({
        character_id: character.id,
        world_id: bound_world,
        x: t.position[0],
        z: t.position[2],
      })
    // PER-REGION ZONE MUSIC tick (region_music.js): time-gated internally (~2s), the engine region probe
    // runs only on accepted samples. Skipped while a cave owns the controller (cave-local coords would
    // sample the wrong overworld region — same guard as the position note above); a fight freezes ctl at
    // its last overworld spot, so the armed region simply holds through combat (the _battle twin plays).
    if (region_follower && !cave_sample)
      region_follower.tick(performance.now(), () =>
        region_zone_key(
          /** @type {string} */ (bound_world),
          world_region_at(t.position[0], t.position[2]),
          region_base_biome
        )
      )
    // D230 — ONE CAMERA WRITER: while a fight owns the scene the fight camera drives from the live board
    // frame (embed_voxel_fight_camera.js); the walk follow-camera + the fight body-hide ran inside
    // player.frame2 above. A missing board frame is a no-op inside apply.
    if (fight_camera.is_active()) {
      fight_camera.apply(dt, () => adapter?.get_board_frame?.())
      // STUCK-TOOLTIP FIX (a tooltip could park top-left and stop tracking on hover) — re-anchor the entity
      // tooltip to its LIVE projected position every frame, AFTER the camera's own apply() just moved it.
      // The old wiring only re-projected on the next pointermove that changed the picked entity, so the
      // camera's own motion (idle wobble, the your-turn zoom-punch, impact shakes) drifted the anchor off
      // the fighter with the mouse sitting still. A no-op when nothing is hovered.
      adapter?.tick_hover?.()
    }
  }
  const frame = instrument_cpu_callback('scene', frame_body)
  raf = requestAnimationFrame(frame)

  // RENDER-PAUSE (pause the webgpu stuff when navigating to other pages): engine.stop()/start()
  // (wired below via mount_voxel_scene's set_paused) only freezes the terrain/atmosphere render loop — THIS
  // session's own loop (physics, camera, avatar pose, position broadcast) plus remotes/world_spawns each run
  // an INDEPENDENT rAF, so all three kept ticking at full tilt regardless of route — the measured cost while
  // browsing the encyclopedia (confirmed live: engine.get_stats().fps froze bit-identical while
  // these loops' own rAFs kept firing). Cancel/re-arm all three in lockstep so a route-away truly stops every
  // per-frame consumer; resume re-arms instantly with zero state loss (ctl/avatar/camera untouched — only
  // each loop's wall-clock `last_t` is bumped so the first frame back doesn't see a multi-second dt).
  const set_frame_paused = (/** @type {boolean} */ paused) => {
    if (paused) {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    } else if (!raf) {
      last_t = performance.now()
      raf = requestAnimationFrame(frame)
    }
    remotes.set_paused?.(paused)
    world_spawns.set_paused?.(paused)
    fight_camera.set_paused(paused) // release the hidden fight's global wheel capture before meta-page scroll
    // GHOST-PLATE FIX (a screenshot showed the self nametag chip stuck on-screen over Equipment/Encyclopedia) —
    // this session's own rAF drove the local plate's projection; cancelling it here froze the chip at its last
    // visible state instead of hiding it (document.body-appended, so route content rendered under it). Hides/
    // shows my_plate in lockstep with the same pause signal (embed_voxel_player.js:set_paused).
    player.set_paused?.(paused)
  }

  // FIGHT-ENTRY CINEMATIC — off the earliest post-tx-success signal (use_dungeon.fight_id set),
  // snap to iso + orbit the battlefield while the board builds + drop the herald sword; on_fight(true) (board
  // ready) settles it with the boom. fight_entry owns beats 1–2 (prepare + sword); the fight camera owns the
  // settle. Declared BEFORE the adapter so its on_fight closure can hand the board-ready signal here.
  const fight_entry = create_fight_entry({
    engine,
    fight_camera,
    board_cell_m: BOARD_CELL_M,
    get_cave_anchor: () => cave_session?.get_board_anchor?.() ?? null,
    get_player_pos: () => ctl.get_transform().position,
  })

  // the board mounts nothing until build() (adapter-driven off the live fight phase).
  const board = create_tactical_board({ engine, canvas, default_origin: VOXEL_BOARD_ORIGIN })
  // D230 — LIVE origin: the cave's board_anchor while a cave is mounted (the fixed VOXEL_BOARD_ORIGIN sat
  // at y=260 — the fight board built in the SKY); on_fight flips this loop's camera authority.
  const adapter = create_voxel_fight_adapter(board, {
    origin: VOXEL_BOARD_ORIGIN,
    // D230 LIVE origin + [WORLD FOOTPRINT CLEAR] flag, resolved in priority order (clear_footprint = WORLD only,
    // arming the render-side terrain/grass clear; a cave is a carved room so it never clears):
    //   1) the mounted cave's board_anchor (DUNGEON path — unchanged, no clear);
    //   2) a WORLD fight's on-chain mob-group anchor (SPEC §7): seat a flat board on the footprint's DOMINANT HIGH
    //      plane (resolve_world_board_origin samples the AABB over the streamed terrain, waits for it to settle,
    //      picks the p90 surface) so the board is NEVER below the land nor pierced — the clear carves the residual
    //      (the old single-anchor sample sank/poked it);
    //   3) VOXEL_BOARD_ORIGIN (y=260 sky) — the never-expected fallback, LOUD.
    origin_of: async () => {
      const cave_anchor = cave_session?.get_board_anchor?.()
      if (cave_anchor) return { origin: cave_anchor, clear_footprint: false }
      const a = use_dungeon.getState().dungeon?.anchor
      if (a && Number.isFinite(a.x) && Number.isFinite(a.z))
        return {
          origin: await resolve_world_board_origin({
            sample,
            anchor: a,
            player_y: () => ctl.get_transform().position[1], // last resort: the nearby player's ground (unstreamed footprint)
            // powers the coords sanity guard: an unseatable anchor absurdly far from the player is a regression —
            // refuse (throw WORLD_BOARD_UNPLACEABLE, caught in the adapter → one honest toast) rather than seat into void.
            player_xz: () => {
              const pos = ctl.get_transform().position
              return { x: pos[0], z: pos[2] }
            },
            half_x: WORLD_BOARD_HALF_X,
            half_z: WORLD_BOARD_HALF_Z,
            step: BOARD_CELL_M * 2, // coarse footprint grid (~every 2 cells) — a p90 needs no per-block scan
          }),
          clear_footprint: true,
        }
      game_log(
        'voxel',
        'fight board has NO anchor (no cave, no world anchor) — building at VOXEL_BOARD_ORIGIN (y=260 SKY); the board will be OFF-SCREEN. Never-expected D230 fallback.'
      )
      return { origin: VOXEL_BOARD_ORIGIN, clear_footprint: false }
    },
    engine, // D239 — entity→screen projection for the fight tooltip
    canvas, // D239 — the cast drag-drop raycast + tooltip rect
    on_my_turn: () => fight_camera.trigger_zoom_punch(), // [W6 #5] hero zoom-punch — push the fight cam in when your turn opens
    cue_shake: fight_camera.add_shake, // [fight-feel] impact jolt on the ONE camera writer (D230) — the adapter's impact package scales it by magnitude/crit
    // D230 — flip the ONE camera writer (motion blur off + the azimuth/damping reset + the log live inside). When
    // the board becomes READY, set_active(true) SETTLES a running fight-entry prepare (the boom); on_board_ready
    // yields the herald sword to the board (the cinematic's beat 3).
    on_fight: (/** @type {boolean} */ on) => {
      fight_camera.set_active(on)
      if (on) fight_entry.on_board_ready()
    },
  })

  // DEV qa rig (window hooks + __dev_engage/__dev_start_fight) — embed_voxel_dev.js (600-LoC split).
  if (import.meta.env.DEV)
    void import('./embed_voxel_dev.js').then((m) =>
      m.install_dev_rig({
        engine,
        board,
        ctl,
        cam: player.get_cam(),
        canvas,
        get_avatar: player.get_avatar,
        trigger_zoom_punch: fight_camera.trigger_zoom_punch, // [W6 #5] dev preview: __ARES_DEV_ZOOM_PUNCH() fires the hero zoom beat
        cue_shake: fight_camera.add_shake, // [fight-feel] dev preview: __ARES_DEV_CAST_VFX fires the real magnitude-scaled impact shake
        // fight-entry cinematic A/B: __ARES_DEV_FIGHT_ENTRY() previews the iso snap + slow orbit + herald sword
        // (+ sting) around the player, then releases (no real board in the synthetic preview — the board-ready
        // settle/boom is proven by the unit test + a live fight).
        trigger_fight_entry: () => {
          const p = ctl.get_transform().position
          const half = (BOARD_CELL_M * 11) / 2
          fight_camera.begin_prepare({
            frame: { origin: { x: p[0] - half, y: p[1], z: p[2] - half }, grid_w: 11, grid_h: 11 },
            reduced: prefers_reduced_motion(), // honor the OS setting so the reduced path is A/B-able too
          })
          play_fight_sfx('fight_start')
          const s = plant_fight_sword({ engine, anchor: [p[0], p[1], p[2]] })
          setTimeout(() => {
            s.dispose()
            fight_camera.set_active(false)
          }, 4500)
        },
      })
    )

  // ── [prewarm/D3 — "still freeze on first cast of a spell type + freezes when the fight is over
  // too"] BOOT-prewarm the WHOLE castable universe (every cast layer + the end-of-fight death/KO burst — soul_death
  // is a BURST_VFX element in ALL_CAST_ELEMENTS) ONCE, deferred to the first idle gap after boot. The adapter's
  // per-fight prewarm still runs, but it RACES the fight-start board build (rAF-starved), so the very FIRST fight's
  // first cast — and its final KO — could still eat a cold ~290ms pipeline compile. Compiling in the calm post-boot
  // lull closes that: pipelines are cached by node-graph key at the renderer level and persist for the session, so
  // one boot warm covers every later fight. Idle-scheduled so it never delays time-to-play; cancelled on teardown. ──
  let cancel_boot_prewarm = /** @type {() => void} */ (() => {})
  const run_boot_prewarm = () => {
    cancel_boot_prewarm = prewarm_fight_vfx(engine, ALL_CAST_ELEMENTS)
  }
  const has_idle = typeof requestIdleCallback === 'function'
  const boot_prewarm_handle = has_idle
    ? requestIdleCallback(run_boot_prewarm, { timeout: 3000 })
    : setTimeout(run_boot_prewarm, 1500)

  const cleanup = () => {
    stop_zone_music()
    travel_resync_live = false
    dispose_travel_resync()
    if (has_idle) cancelIdleCallback(boot_prewarm_handle)
    else clearTimeout(boot_prewarm_handle)
    cancel_boot_prewarm() // drop any throwaway prewarm handles still mid-compile
    context.dispatch('action/npc_prompt', null) // D162: the gate affordance dies with the session
    context.dispatch('action/player_pose', null) // the CompassStrip self-gates on pose — never a stale strip over spectate
    context.dispatch('action/world_presentation', 'terrain') // the grid dies with its session (so does its radio)
    cancelAnimationFrame(raf)
    fight_camera.dispose() // D238/D250/D264a — the fight-orbit pointer + wheel listeners die with the session
    fight_entry.dispose() // the fight-entry store subscription + any herald sword die with the session
    player.dispose() // D195/D191/D227/TR-97 — shoulder cam + key listeners + avatar/aura/plate/mount all die here
    sky_dragon?.dispose() // TR-97 — the sky dragon dies with the session
    remotes.dispose() // D206 — remote rigs die with the session
    world_spawns.dispose() // chain zone spawns (mob groups + resource nodes) die with the session
    world_fights.dispose() // nearby-fights discovery poll + its [V] prompt die with the session
    world_props?.dispose() // FlameFX overworld ambience camps die with the session (absent in hack mode)
    cave_session?.dispose() // D211 — cave room + oracle swap die with the session
  }

  // `character` is stashed so a LIVE tier swap (reboot_voxel_session_tier) can re-create this session at a
  // new quality without a page reload — it re-drives the same avatar from the same character handle.
  return {
    engine,
    board,
    adapter,
    container,
    cleanup,
    set_frame_paused,
    flush_position,
    dispose_timer: null,
    mode: 'session',
    character,
    world_id: bound_world,
    follow, // reboot_voxel_session_tier's own zone-music ownership on re-create (owns_ambient_music)
  }
}

// pagehide suspends audio first, then synchronously disposes GPU state unless BFCache keeps this document.
// A persisted page retains its engine/session but no live media stream; pageshow resumes the armed bed once.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', (/** @type {PageTransitionEvent} */ e) => {
    suspend_zone_music()
    if (e.persisted || !session) return
    session.flush_position?.() // no-op unless the unload occurs while free-walking in the overworld
    if (session.dispose_timer) clearTimeout(session.dispose_timer)
    dispose_session()
  })
  window.addEventListener('pageshow', (/** @type {PageTransitionEvent} */ e) => {
    if (e.persisted) resume_zone_music()
  })
}

// D158/HMR (dark + input-dead world under dev hot-reload storms): a hot-replaced module orphans its
// `session` binding WITH a live engine — the NEW module's singleton is null, so the next mount boots engine #2
// over the old one's canvas/listeners (dark world, dead input: the exact double-boot class the singleton
// exists to kill, reintroduced by HMR). Dispose the old module's session at replace time; the remount then
// creates cleanly. Prod builds strip this block.
if (import.meta.hot) {
  // Belt: release the GPU session BEFORE any replacement (no orphaned device/listeners even transiently).
  import.meta.hot.dispose(() => {
    if (session?.dispose_timer) clearTimeout(session.dispose_timer)
    dispose_session()
  })
  // D170 (incident 2026-07-12) — NEVER hot-swap a GPU root. A dev vite restart dropped NO_HMR=1 while a
  // dozen lanes saved engine files; every save hot-replaced an engine module UNDER the live session, so the
  // dispose() above tore the canvas down — but the page did NOT reload: a SILENT DEAD CANVAS that had to
  // hand-refresh, with menu-music reclaiming the emptied lobby. The old `accept(() => invalidate())` was not
  // enough: invalidate() only propagates to IMPORTERS, and this module's static importer chain (render_quality.js
  // → HUD components) hits React-Refresh boundaries that ABSORB the update — leaving the session disposed but the
  // page un-reloaded. So force the reload OURSELVES: loud (so a future dropped-NO_HMR is self-diagnosing, never
  // silent again) + a hard reload that can NEVER be absorbed upstream. DEV builds strip this whole block.
  import.meta.hot.accept(() => {
    game_log(
      'embed_voxel',
      'HMR replaced a live GPU-root module — forcing a full reload (the voxel embed cannot ' +
        'hot-swap WebGPU/engine state). Seeing this in a dev loop means NO_HMR=1 was dropped from the vite server.'
    )
    window.location.reload()
  })
}

/** Tear the session down for real (grace elapsed, no re-attach). */
function dispose_session() {
  if (!session) return
  const s = session
  session = null
  if (s.dom_watchdog) clearInterval(s.dom_watchdog)
  try {
    s.cleanup()
    s.adapter?.destroy()
    s.engine.dispose()
  } catch (error) {
    game_log('voxel', 'session dispose failed', error)
  }
  s.container.remove()
}

/** D179 SELF-HEAL WATCHDOG — arm the detached-container re-attach net on the live session (idempotent: one
 *  interval per session). The one-shot assert at mount was blind to LATER detachment (React removing the
 *  host subtree around a still-live session); this re-checks every 2 s for the session's life and re-parents
 *  the SAME container/canvas/engine back onto the last host a real mount used — idempotent (same GPU context,
 *  nothing rebuilds), no React round-trip. A gone host stays loud. Shared by mount_voxel_scene AND the live
 *  tier swap (reboot_voxel_session_tier), which re-creates the session outside the mount path. */
function ensure_dom_watchdog() {
  if (!session || session.dom_watchdog) return
  session.dom_watchdog = setInterval(() => {
    if (!session || document.hidden) return
    if (!session.container.isConnected) {
      game_log('voxel', 'CANVAS LEFT THE DOCUMENT (D179): container detached while the session lives', {
        epoch: attach_epoch,
        has_timer: !!session.dispose_timer,
        canvases_in_doc: document.querySelectorAll('canvas').length,
      })
      report_error(new Error('D179 canvas left the document while the session lives'), {
        area: 'engine',
        action: 'dom_watchdog',
      })
      if (session.host?.isConnected) session.host.appendChild(session.container)
      else
        game_log('voxel', 'CANVAS SELF-HEAL SKIPPED: the last known host is ALSO detached — a real remount is required')
    }
  }, 2000)
}

/**
 * Re-boot the LIVE world session at a new quality tier IN PLACE — no page reload. The atlas texel size
 * (32/64/128) and ring radius (4/7/8) are baked at engine CONSTRUCTION and every tier changes at least one,
 * so a real tier change must re-create the engine+session — behind create_session's own boot veil, while the
 * PAGE, auth session, Zustand stores and chain state stay live (only the world re-streams). Strictly better
 * than location.reload() even on GPU memory: engine.dispose() frees the pools/device SYNCHRONOUSLY before the
 * new engine allocates, so there is no cross-document double-stack (the "Aw-Snap on quality-change reload").
 * attach_epoch is deliberately NOT bumped — GameWorldHost's original mount handle gates on
 * `my_epoch === attach_epoch`, so keeping it lets that handle transparently drive the fresh session (a bump
 * would strand it → leak on unmount). Blocked during a dungeon run (it owns the board + cave_session — the
 * boot veil's in_fight signal); returns a reason the caller toasts.
 * @param {string} tier one of the engine tiers ('low'|'medium'|'high')
 * @returns {{ ok: true } | { ok: false, reason: 'no_session' | 'fight' }}
 */
export function reboot_voxel_session_tier(tier) {
  if (!session || session.mode !== 'session' || !session.host) return { ok: false, reason: 'no_session' }
  const dungeon = use_dungeon.getState()
  if (dungeon.in_session || dungeon.run_pass_id || dungeon.dungeon || dungeon.dungeon_id || dungeon.fight_id)
    return { ok: false, reason: 'fight' }
  const { host, character, follow } = session
  // Commit the freshest pose NOW (the ~5s cadence + no in-place pagehide would else rewind the player), then
  // tear down (synchronous GPU release) and rebuild at the new tier on the SAME host — create_session
  // re-attaches the container in-DOM, re-reads the pose, and raises its own boot veil over the re-stream.
  // `follow` rides along from the dying session so a live tier-reboot mid-follow never resurrects this
  // session's OWN zone-music ownership (owns_ambient_music) — follow.ts stays the exclusive owner throughout.
  session.flush_position?.()
  dispose_session()
  session = create_session(tier, character, host, false, follow)
  session.host = host
  ensure_dom_watchdog()
  return { ok: true }
}

/**
 * Mount the voxel world into `host` — attaches to the LIVE session or creates the one session (D158).
 * Mirrors mount_scene's `{ set_paused, destroy }` contract so GameWorldHost drives it identically.
 * @param {HTMLElement} host
 * @param {any | null} [character] the selected on-chain character (class/gender/colors) — drives the avatar
 * @param {{ tier?: string, spectate?: boolean, follow?: boolean }} [opts]
 * @returns {{ set_paused: (paused: boolean) => void, destroy: () => void }}
 */
export function mount_voxel_scene(host, character = null, { tier, spectate = false, follow = false } = {}) {
  // follow-cam avatar/camera variants stay engine-side concerns (create_session drives them via `character`
  // already); `follow` ALSO threads into create_session below to gate this session's OWN zone-music
  // ownership (owns_ambient_music, issue #17) — no longer a dropped no-op.
  // S1 boot-tier precedence: display-only spectate is always low; gameplay uses explicit then saved tier.
  // No gameplay pref stays undefined so create_engine detects the device tier (mobile floors to low).
  const boot_tier = spectate ? 'low' : (tier ?? (get_saved_quality() || undefined))
  const mode = spectate ? 'spectate' : 'session'
  const incoming_world_id = use_world_binding.getState().world ?? null
  const incoming_character_id = character?.id ?? null
  const incoming_identity = {
    mode,
    world_id: incoming_world_id,
    character_id: incoming_character_id,
    follow: !!follow,
  }
  if (session?.dispose_timer) {
    clearTimeout(session.dispose_timer)
    session.dispose_timer = null
  }
  // The singleton closes over every identity field below. A same-world A→B switch therefore flushes A's
  // eligible pose, disposes A's GLB/controller/broadcast closures, and creates B; only an exact React remount
  // reuses the pending session. Mode/follow changes are equally real session changes.
  if (
    session &&
    !should_reuse_pending_session(
      {
        mode: session.mode,
        world_id: session.world_id ?? null,
        character_id: session.character?.id ?? null,
        follow: !!session.follow,
      },
      incoming_identity
    )
  ) {
    session.flush_position?.()
    dispose_session()
  }
  // Re-key presence only AFTER A's cleanup, but BEFORE create_session publishes B's colors/state. A follow
  // scene observes another character without replacing the resident player's lobby identity.
  if (mode === 'session' && !follow && incoming_character_id) join_lobby(incoming_character_id)
  if (!session)
    session = create_session(boot_tier, character, host, spectate, follow) // D176: attaches INSIDE create (in-DOM before engine)
  else host.appendChild(session.container) // later mounts reparent the live session
  session.host = host // witness-r4 — the watchdog's self-heal re-attach target (below): the last host a REAL
  // mount call actually used, never a guess. Refreshed on every mount, so a later legitimate re-host still wins.
  // D175: React may mount new before old unmounts; the stale destroy used to kill the newly attached session.
  // Each mount takes an epoch so a stale destroy cannot stop, pause, or dispose the newer session.
  attach_epoch += 1
  const my_epoch = attach_epoch
  // INVARIANT, not hope (lead's order): the container must be IN the live DOM after attach — loudly. And a
  // WATCHDOG (D179): the one-shot assert was blind to LATER detachment (React removing the host subtree
  // around a still-live session) — now checked every 2s for the session's life; a detached container is
  // re-announced with full diagnostics until a mount re-appends it.
  if (!session.container.isConnected) {
    game_log('voxel', 'ATTACH BROKEN: container not connected after appendChild (D175 — report this)')
    report_error(new Error('D175 attach broken — container not connected after appendChild'), {
      area: 'engine',
      action: 'attach',
    })
  }
  ensure_dom_watchdog()
  // destroy() pauses the session-local rAFs immediately while the remount grace runs. A real re-attach owns
  // them again, so resume here before the host reapplies its route/document visibility state synchronously.
  session.set_frame_paused?.(false)
  session.engine.start()

  let destroyed = false
  return {
    set_paused: (/** @type {boolean} */ paused) => {
      if (!session || destroyed || my_epoch !== attach_epoch) return // a newer mount owns the session
      if (paused) session.engine.stop()
      else session.engine.start()
      session.set_frame_paused?.(paused) // spectate mode has no local frame loop — optional chain no-ops there
    },
    destroy: () => {
      if (destroyed) return
      destroyed = true
      if (!session) return
      if (my_epoch !== attach_epoch) return // D175: stale destroy (new-before-old remount) — hands off.
      session.engine.stop()
      // Freeze the engine plus session-owned rAFs instead of burning another 300 ms during the remount grace.
      session.set_frame_paused?.(true)
      const dispose_epoch = my_epoch
      session.dispose_timer = setTimeout(() => {
        if (dispose_epoch !== attach_epoch) return // a mount arrived during the grace via a fresh handle
        dispose_session()
      }, DISPOSE_GRACE_MS)
    },
  }
}
