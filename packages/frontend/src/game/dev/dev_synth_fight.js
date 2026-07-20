// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEV-ONLY synthetic terminal-fight harness — the D139 revival (the old __ARES_DEV_FORCE_FIGHT_BOARD died with
// the isometric renderer it mounted; this one drives the VOXEL pipeline through the REAL adapters). Sibling of
// dev_cast.js/dev_probe.js: registered by GameWorldHud's import.meta.env.DEV block, tree-shaken from prod,
// live-module closures (a Playwright-side `import('/src/…')` binds a dead second Vite instance — the documented
// dev_probe trap).
//
// WHY IT EXISTS (the 10th "killed during my turn = fight just removed" report): the death-sequence
// gate (derive_phase's terminal exemption + hold_scene_for_death_beat) needs a PIXELS proof — board alive through
// the killing wave → defeat card → teardown strictly after. A real lethal fight is non-deterministic (RNG mob
// damage) and gas-burning; this mounts the SAME production surfaces with a synthetic chain read instead:
//
//   __ARES_DEV_SYNTH_FIGHT(flavor?)  builds a synthetic DECODED engine Fight (me + one mob, ACTIVE, anchored AT
//                             the player) and folds it through the REAL fight_view → store → sync_engine — the
//                             exact seam refresh() feeds — so the voxel board, fighters, HUD chrome all mount for
//                             real. `flavor` ('world' default | 'dungeon') picks the run context the TERMINAL fold
//                             derives STATUS from (a dungeon LAST-room run → the same STATUS_WON/STATUS_FAILED the
//                             card path branches on) — a faithful dungeon terminal-card proof without a cave.
//   __ARES_DEV_SYNTH_KILL()   folds the FAIL terminal: the mob walked adjacent and my hp hit 0 (ENGINE_DEFEAT →
//                             STATUS_FAILED → the Defeat card). __ARES_DEV_SYNTH_WIN() folds the WIN terminal: the
//                             mob is dead and I am alive, my cast's 40→0 attribution killing it (ENGINE_VICTORY →
//                             STATUS_WON → the Victory card). From here EVERYTHING is production: emit_fight_deltas
//                             reconstructs the killing wave (walk → attack → floater → death clip), DungeonBoard's
//                             terminal effect fires the REAL claim() → note_victory(terminal) → the death-beat-
//                             gated present() (card, then teardown). Nothing here touches the gate itself.
//
// HONESTY BOUNDS: no tx is signed (chain-authorship law untouched — this is a RENDER harness); claim()'s
// background settle_chain WILL fail on the synthetic ids (caught internally — one logged error + the honest
// "unclaimed result" toast, exactly the dead spec's accepted tradeoff). NEVER call with a real session live —
// both hooks refuse while a fight/run is mounted (single-flight board law).

import { context } from '../store.js'
import { use_auth } from '../../auth'
import { use_dungeon } from '../../world-shell/dungeon_store.js'
import { fight_store } from '@aresrpg/fight/store'
import { encode } from '@aresrpg/fight/los'
import { game_log } from '../../core/log.js'

// A real catalog mob (mob_models.json) so the board renders a genuine GLB rig, not the debug cube. Join-key
// only (fight_bridge resolves the GLB via MOB_NAME, never this string — see get_mob_model's variant-miss
// fallback) — the `qa` marker keeps it an obvious non-chain placeholder for the ARTIFACT-FRESHNESS census
// (scripts/artifact_freshness_gate.py), which flags any real-shaped 0x+64hex literal under src/.
const MOB_TEMPLATE = '0xqa51de51de51de51de51de51de51de51de51de51de51de51de51de51de51de51'
const MOB_NAME = 'Aetherwing'
const MOB_LEVEL = 3
const MOB_ELEMENT = 3 // air — the mob's killing cast routes the air VFX/SFX

// Board geometry (playable 13×13; cells are canonical stride-20 — fight-los encode). Mob starts 4 cells out,
// walks adjacent for the kill so the terminal wave carries a real WALK + ATTACK chain, not a teleport hit.
const MY_CELL = { x: 5, y: 6 }
const MOB_CELL_START = { x: 9, y: 6 }
const MOB_CELL_KILL = { x: 6, y: 6 }
// [trap-on-mob proof] a trap MID-path between the mob's start and a survive-and-continue destination: the mob
// walks {9,6}→{8,6}→{7,6}[TRAP]→{6,6}, so the reconstructed path crosses the trap at index 1 and the walk RESUMES
// past it (proving PAUSE→trigger→RESUME). The mob SURVIVES (40→25) so it stays in acted_live_mob_ids.
const TRAP_CELL = { x: 7, y: 6 }
const MOB_CELL_TRAP_DEST = { x: 6, y: 6 }
const MOB_HP_AFTER_TRAP = 25 // 40 → 25 = a 15-damage trap the mob walks off (survives, resumes)

/** The mounted synthetic session (null = none). The terminal fold flips base → VICTORY/DEFEAT on the SAME fight
 *  id, in the SAME flavor (world|dungeon) it was mounted with. */
let synth =
  /** @type {{ fight_id: string, address: string, character_id: string | null, flavor: string } | null} */ (null)

/** A synthetic DECODED engine Fight — the exact shape @aresrpg/sdk decode_fight hands refresh() (the raw
 *  participant.move / mob.move field names fight_view maps). `mob_hp` (default 40 = full) drops to 0 for the WIN
 *  terminal so my cast's 40→0 attribution kills it. @param {{ status: number, my_hp: number, mob_hp?: number,
 *  mob_cell: { x: number, y: number }, fight_id: string, address: string, character_id: string | null,
 *  anchor: { x: number, z: number } }} a */
const decoded_fight = ({ status, my_hp, mob_hp = 40, mob_cell, fight_id, address, character_id, anchor }) => ({
  id: fight_id,
  status, // ENGINE_*: 1 = ACTIVE, 3 = DEFEAT (fight_bridge maps → STATUS_ACTIVE / STATUS_FAILED)
  width: 13,
  height: 13,
  participants: [
    {
      owner: address,
      character: character_id,
      class: '',
      team: 0,
      hp: my_hp,
      max_hp: 100,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: encode(MY_CELL.x, MY_CELL.y),
      ready: true,
      casts_this_turn: 0,
      weapon: null, // bare hands — fight_view normalizes to the unarmed line
    },
  ],
  mobs: [{ template: null, level: MOB_LEVEL, hp: mob_hp, max_hp: 40, cell: encode(mob_cell.x, mob_cell.y), ap: 6, mp: 3 }],
  group_template: MOB_TEMPLATE, // provenance rides the Fight (mob instances are @0x0 on-chain)
  group_base_ap: 6,
  group_base_mp: 3,
  turn_ptr: 0, // my slot — the kill read's same-ptr full-cycle walk marks the mob as acted (walk_acted_actors)
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_deadline_ms:
    Date.now() +
    (typeof window !== 'undefined' && Number((/** @type {any} */ (window)).__ARES_DEV_SYNTH_DEADLINE_MS) > 0
      ? Number((/** @type {any} */ (window)).__ARES_DEV_SYNTH_DEADLINE_MS)
      : 120_000),
  placement_deadline_ms: 0,
  world_seed: 12345n, // §7 turn-seed input — BigInt like the real decode (crit preview math reduces it)
  spawn_id: null,
  obstacles: [],
  holes: [],
  shape_mask: undefined, // legacy rect fallback — a shaped mask is irrelevant to the teardown-timing proof
  start_cells_a: [encode(MY_CELL.x, MY_CELL.y)],
  start_cells_b: [],
  // chain-space anchor; the hook passes offset {0,0} so world === chain — the board seats AT the player.
  anchor_x: anchor.x,
  anchor_z: anchor.z,
})

/** Fold one synthetic read through the REAL refresh() seam: fight_view → store.dungeon → sync_engine. `flavor`
 *  picks the run context fight_view derives the terminal STATUS from: a WORLD fight (no RunPass) and a DUNGEON
 *  LAST room BOTH fold a VICTORY to terminal STATUS_WON and a DEFEAT to STATUS_FAILED — the two statuses the
 *  result-card path (claim → present → FightResult/FightSummary) branches on. So the 'dungeon' flavor exercises
 *  fight_view's dungeon-status branch (a last-room run) WITHOUT mounting a cave: the card reads dungeon.status
 *  only, never run_pass_id, so this is a faithful dungeon terminal-card proof. */
const fold = (fight, version, flavor = 'world') => {
  const dungeon_run = flavor === 'dungeon' ? { id: fight.id, room: 1, world: fight.id } : null
  // S2 FLIP: the synthetic decoded Fight rides the REAL production seam — the core's ONE snapshot door
  // (board_state_from_fight + mirror + adapter subscribe do the rest, exactly like a live chain read).
  const { input } = fight_store.getState()
  if (fight_store.getState().fight_id !== fight.id)
    input({
      type: 'init',
      fight_id: fight.id,
      my_key: null,
      ctx: {
        address: use_auth.getState().address,
        my_entity_id: null,
        creator: use_auth.getState().address,
        run: dungeon_run,
        rooms_total: flavor === 'dungeon' ? 1 : 0,
        mob_names: use_dungeon.getState().mob_names,
        mob_levels: use_dungeon.getState().mob_levels,
        mob_elements: use_dungeon.getState().mob_elements,
        offset: { x: 0, z: 0 }, // identity codec — anchor_x/z above are already world coords
        beat_ctx: { grid_width: 20 },
      },
    })
  input({ type: 'snapshot', fight, version: Number(version) })
  return fight_store.getState().view
}

/** Mount the synthetic ACTIVE fight around the player. Refuses over any live session. @param {string} [flavor]
 *  'world' (default) or 'dungeon' — picks the terminal STATUS the fold derives (see fold()); the ACTIVE mount is
 *  identical either way. */
function synth_fight(flavor = 'world') {
  const flv = flavor === 'dungeon' ? 'dungeon' : 'world'
  const { address } = use_auth.getState()
  if (!address) return { ok: false, reason: 'not signed in' }
  const s = use_dungeon.getState()
  if (s.fight_id || s.run_pass_id) return { ok: false, reason: 'a real fight/run is live — never stomp it' }
  const pos = /** @type {any} */ (window).__voxel_ctl?.get_transform?.()?.position
  if (!pos) return { ok: false, reason: 'no player transform (__voxel_ctl) — session not booted' }
  const anchor = { x: Math.round(pos[0]) || 1, z: Math.round(pos[2]) || 1 }
  // Roster-independent (the /v1 read layer may be empty/down on a QA box): an empty roster leaves the
  // create/retry onboarding overlay over the world — seed ONE synthetic character row through the SAME
  // action/sui_data fold load_roster lands (loaded:true clears both overlays). Store-only, dev-only; a later
  // real load_roster overwrite is harmless (the fight slice never re-reads the roster). DELIBERATELY NO
  // action/select_character: selecting re-keys the live world session host, which HARD-DISPOSES the running
  // session (probe-proven: "adapter DESTROYED #1 building=true" — frozen engine, dead subscriptions, the
  // whole rig silently running on a corpse). The fight slice keys players by ADDRESS, not character id.
  if (!context.get_state().sui?.characters?.length) {
    const dummy_id = `0xqa${Date.now().toString(16)}`.padEnd(66, '0')
    context.dispatch('action/sui_data', {
      characters: [{ id: dummy_id, name: 'QA Dummy', classe: 'senshi', level: 1, in_dungeon: false }],
      loaded: true,
      load_error: null,
      has_claimed_free_character: true,
    })
  }
  const character_id = context.get_state().selected_character_id ?? null
  const fight_id = `0x51f47${Date.now().toString(16)}dead10ca1`.padEnd(66, '0')
  synth = { fight_id, address, character_id, flavor: flv }
  // the exact store shape enter_world_fight seeds (minus refresh/poll — the hook IS the read source), plus the
  // mob identity maps refresh()'s _resolve_mob_identities would have resolved.
  use_dungeon.setState({
    fight_id,
    fight_fresh: false, // no entry cinematic — deterministic capture
    dungeon_id: fight_id,
    world_id: null,
    template_id: null,
    character_id,
    run_pass_id: null,
    run: null,
    rooms: [],
    result_id: null,
    phase: 'playing',
    error: null,
    in_session: false, // WORLD fight: the world stays alive (rigs roam; no cave)
    session_address: address,
    mob_names: { ...use_dungeon.getState().mob_names, [MOB_TEMPLATE]: MOB_NAME },
    mob_levels: { ...use_dungeon.getState().mob_levels, [MOB_TEMPLATE]: MOB_LEVEL },
    mob_elements: { ...use_dungeon.getState().mob_elements, [MOB_TEMPLATE]: MOB_ELEMENT },
  })
  const view = fold(
    decoded_fight({ status: 1, my_hp: 100, mob_hp: 40, mob_cell: MOB_CELL_START, fight_id, address, character_id, anchor }),
    1,
    flv
  )
  game_log('dev', 'SYNTH fight mounted', { fight_id, anchor, flavor: flv, status: view.status })
  return { ok: true, fight_id, anchor, flavor: flv }
}

/** Fold the TERMINAL read for the mounted flavor — WIN (my cast kills the mob → ENGINE_VICTORY → STATUS_WON → the
 *  Victory card) or FAIL (the mob's killing wave → my hp 0 → ENGINE_DEFEAT → STATUS_FAILED → the Defeat card).
 *  From here EVERYTHING is production: DungeonBoard's terminal effect → claim() → the death-beat-gated present()
 *  → the result card, THEN teardown. @param {'win'|'fail'} outcome */
function synth_end(outcome) {
  if (!synth || use_dungeon.getState().fight_id !== synth.fight_id)
    return { ok: false, reason: 'no synthetic fight mounted (__ARES_DEV_SYNTH_FIGHT first)' }
  const { fight_id, address, character_id, flavor } = synth
  const anchor = use_dungeon.getState().dungeon?.anchor ?? { x: 1, z: 1 }
  const win = outcome === 'win'
  // POLL ANALOGUE (probe-named gap: "HELD at EXIT — never_active_seated_this_session"): mark_active_seat fires
  // at sync_engine's tail off a derive that needs the ENGINE slice — which folds the spawn/sync dispatches on a
  // LATER microtask (the documented async pump), so the MOUNT fold's own tail derive always reads a half-init
  // slice (verdict ROAM, no latch). A REAL fight latches on the NEXT 4s poll; this rig has no poll — fold ONE
  // identical ACTIVE re-read first (a no-op delta pass), whose tail derive now sees the settled slice → ACTIVE
  // → the D81 latch marks → the TERMINAL read below EARNS its card instead of routing to EXIT.
  fold(
    decoded_fight({ status: 1, my_hp: 100, mob_hp: 40, mob_cell: MOB_CELL_START, fight_id, address, character_id, anchor }),
    2,
    flavor
  )
  // WIN: the mob is DEAD (hp 0) and I am ALIVE — emit_fight_deltas attributes the mob's 40→0 drop to MY cast (the
  // acting player at turn_ptr 0), so my killing cast + the mob's death beat play, then STATUS_WON opens the
  // Victory card. FAIL: I am DEAD (hp 0), the mob walked adjacent (MOB_CELL_KILL) — its killing wave replays,
  // then STATUS_FAILED opens the Defeat card. Same double-fold + gated present() either way.
  const view = win
    ? fold(
        decoded_fight({ status: 2, my_hp: 100, mob_hp: 0, mob_cell: MOB_CELL_START, fight_id, address, character_id, anchor }),
        3,
        flavor
      )
    : fold(
        decoded_fight({ status: 3, my_hp: 0, mob_hp: 40, mob_cell: MOB_CELL_KILL, fight_id, address, character_id, anchor }),
        3,
        flavor
      )
  synth = null // production owns the rest: DungeonBoard's terminal effect → claim() → gated present()
  game_log('dev', `SYNTH ${win ? 'victory' : 'kill'} folded — production terminal flow owns the sequence`, {
    flavor,
    status: view.status,
  })
  return { ok: true, status: view.status }
}

/** [trap-on-mob proof] Fold a mob-crosses-MY-trap read over the mounted ACTIVE fight — the mob walks from its
 *  start ACROSS a recorded trap to a survive-and-continue destination, losing HP but living. emit_fight_deltas
 *  detects the mob's own drop, plan_trap_hits attributes it to the trap crossing, and the move packet carries
 *  trap_hits ⇒ the adapter's play_move PAUSES the walk at the trap cell for the trigger (eruption VFX + hit
 *  flinch + damage floater), then RESUMES. Stays ACTIVE (no terminal). Call AFTER __ARES_DEV_SYNTH_FIGHT mounts
 *  and the board is up (entity_ids has mob-0), so the paced move actually plays. Backward-compatible ADD. */
function synth_trap() {
  if (!synth || use_dungeon.getState().fight_id !== synth.fight_id)
    return { ok: false, reason: 'no synthetic fight mounted (__ARES_DEV_SYNTH_FIGHT first)' }
  const { fight_id, address, character_id, flavor } = synth
  const anchor = use_dungeon.getState().dungeon?.anchor ?? { x: 1, z: 1 }
  // seed MY trap into the durable my_traps (the ONE fold home) via place_traps — the SAME seam a real trap-cast
  // rides (DungeonBoard.optimistic_cast); the gold marker paints from engine_view.my_traps, no overlay module.
  fight_store.getState().input({
    type: 'predicted',
    intent_id: `synth-trap:${fight_id}`,
    basis_version: fight_store.getState().applied_version + 1,
    actions: [],
    beats: [],
    place_traps: [encode(TRAP_CELL.x, TRAP_CELL.y)],
  })
  // fold ONE ACTIVE delta: the mob walked start→(across the trap)→dest, hp 40→25 (survived); my hp unchanged so no
  // strike beat is attributed to me. turn_ptr stays 0 (a full cycle) ⇒ walk_acted_actors marks the mob ACTED.
  const view = fold(
    decoded_fight({
      status: 1,
      my_hp: 100,
      mob_hp: MOB_HP_AFTER_TRAP,
      mob_cell: MOB_CELL_TRAP_DEST,
      fight_id,
      address,
      character_id,
      anchor,
    }),
    2,
    flavor
  )
  game_log('dev', 'SYNTH trap-cross folded', { trap: TRAP_CELL, dest: MOB_CELL_TRAP_DEST, mob_hp: MOB_HP_AFTER_TRAP })
  return { ok: view.status === 1, trap_cell: TRAP_CELL, dest: MOB_CELL_TRAP_DEST, damage: 40 - MOB_HP_AFTER_TRAP }
}

/** Register the hooks (idempotent; dev builds only — the caller gates on import.meta.env.DEV).
 *  __ARES_DEV_SYNTH_FIGHT(flavor?) mounts an ACTIVE fight ('world'|'dungeon', default 'world');
 *  __ARES_DEV_SYNTH_KILL folds the FAIL terminal (→ Defeat card) and __ARES_DEV_SYNTH_WIN the WIN terminal
 *  (→ Victory card), both in the mounted flavor; __ARES_DEV_SYNTH_TRAP folds a mob-crosses-my-trap ACTIVE read
 *  (the pause→trigger→resume proof). */
export function register_dev_synth_fight() {
  if (typeof window === 'undefined') return
  ;(/** @type {any} */ (window)).__ARES_DEV_SYNTH_FIGHT = synth_fight
  ;(/** @type {any} */ (window)).__ARES_DEV_SYNTH_KILL = () => synth_end('fail')
  ;(/** @type {any} */ (window)).__ARES_DEV_SYNTH_WIN = () => synth_end('win')
  ;(/** @type {any} */ (window)).__ARES_DEV_SYNTH_TRAP = synth_trap
}
