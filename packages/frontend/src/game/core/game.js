// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The client engine — a framework-agnostic state core + WS netcode, extracted from the AresRPG
// dapp's core/game/game.js (the proven module/reducer/observer system), stripped of Three.js,
// voxel, and Vue. React binds to it via src/store.js (useSyncExternalStore over STATE_UPDATED);
// the imperative Three roam scene reads get_state() in its own render loop. Truth is the server:
// the client dispatches actions + sends packets, and renders the reduced state/events.
//
// Shape: `events` re-emits every action type + STATE_UPDATED; `actions` (dispatch) and `packets`
// (decoded WS frames) are merged and folded through every module's reduce() into the next state.
// Modules are `() => { reduce?, observe?, tick?, post_render? }`; observe(context) runs once.

import { EventEmitter } from 'events'
import { PassThrough } from 'stream'

import { aiter } from 'iterator-helper'

import { combine } from './iterator.js'
import { MODULES } from './modules/index.js'
import { dismiss_toast } from './toast.js'
import { actions, dispatch_action } from './action_input.js'
import { game_log } from '../../core/log.js'
import { report_error } from '../../core/report.js'

/** @typedef {typeof INITIAL_STATE} State */
/** @typedef {{ type: string, payload?: any }} Action */
/** @typedef {(state: State, action: Action) => State} Reducer */
/** @typedef {(context: Context) => void} Observer */
/** @typedef {() => { reduce?: Reducer, observe?: Observer }} Module */

export const INITIAL_STATE = {
  /** @type {string | null} */
  selected_character_id: null,

  /**
   * Whether the tactical fight board is showing — a visual-only mode that replaces the roam view
   * with a 12x12 schematic. Flipped by the center-top Fight toggle (action/fight_mode). The React
   * Hud mounts the board off this; the imperative roam scene may read it to pause its own input.
   * No combat netcode is attached this pass.
   * @type {boolean}
   */
  fight_mode: false,

  /**
   * The LIVE world session's presentation (docs/design/hack_mode_spec.md) — 'hackgrid' while the player is on
   * the retrowave grid, 'terrain' otherwise. Published by embed_voxel's create_session, which is the ONE place
   * the mode is resolved (URL over saved pref, spectate always terrain), and re-published on every in-place
   * session reboot — so a settings toggle reaches the HUD live, with no page reload and no second pref read.
   * @type {'terrain' | 'hackgrid'}
   */
  world_presentation: 'terrain',

  /**
   * Blocking upgrade modal latch. A sponsor refusal tagged `outdated-package` enters through run_tx (or the
   * direct sponsored onboarding wrapper) as `action/sponsor_upgrade_required`; player.js folds it true. There
   * is deliberately no dismiss action: refreshing onto the latest package is the only safe continuation.
   * @type {boolean}
   */
  sponsor_upgrade_required: false,

  /**
   * The player avatar's current world cell, published by the imperative roam scene ONLY when the
   * cell changes (never per-frame). null until the scene mounts / before the first move. Read by
   * the React Minimap, which redraws terrain via world_cell(seed, …) so it matches the scene.
   * @type {{ x: number, y: number, seed: number } | null}
   */
  player_cell: null,

  /**
   * The roam scene's throttled live pose (~6 Hz — the frame loop's %10 gate): avatar position, camera
   * yaw (rig azimuth, the compass heading basis) and the engine fps. Published by embed_voxel.js's
   * frame loop; read by the CompassStrip (3A top-strip — position + fps render there since the old DOM
   * coords chip was deleted). null until the walker session's first publish (spectate never publishes).
   * @type {{ x: number, y: number, z: number, yaw: number, fps: number } | null}
   */
  player_pose: null,

  /**
   * The server's AUTHORITATIVE position for OUR selected character ({ x, y, z }), folded from the
   * `characterPosition` broadcast the server sends for our own id (FORCE_POSITION on select / fight
   * snap). The roam scene reads this to spawn the avatar at the real position (not hardcoded 0,0) and
   * to reconcile a snap-back, instead of diverging until the anti-teleport guard freezes the server.
   * null until the first authoritative broadcast arrives.
   * @type {{ x: number, y: number, z: number } | null}
   */
  local_position: null,

  sui: {
    /** @type {boolean} true once the read-model has been fetched at least once (empty vs loading) */
    loaded: false,
    /** @type {string | null} a human reason the roster fetch/connect failed (the read-model never
     *  resolved) — drives the roster UI's error + Retry terminal state so it never sticks on "loading".
     *  null = no error. Cleared the moment a connect/fetch succeeds. */
    load_error: null,
    /** @type {any[]} on-chain characters (from the server's FalkorDB read-model) */
    characters: [],
    /** @type {boolean} has this account already claimed its one free character on-chain (the C2
     *  free-vs-paid marker)? The client CANNOT infer this from the count (the count drops to 0 on
     *  delete while the on-chain claim is permanent), so the server surfaces it in the roster payload.
     *  Drives the create-screen's free-vs-paid CTA so it matches the server's mint routing. */
    has_claimed_free_character: false,
    /** @type {number | null} the LIVE additional-character price in SUI (from the server env), so the
     *  create-screen shows the REAL price instead of a hardcoded client mirror that can drift. */
    character_price_sui: null,
    /** @type {any[]} */
    items: [],
    /** @type {Record<string, any>} receipt-proven loot rows held until a snapshot includes each exact id */
    settled_item_floor: {},
    /** @type {Record<string, number>} in-flight consumable units per item id — the bag renders chain − pending */
    pending_uses: {},
    /** @type {Record<string, any>} receipt-proven mint rows held until a roster snapshot includes each exact id */
    minted_character_floor: {},
    /** @type {any[]} */
    items_for_sale: [],
    /** @type {bigint | null} */
    balance: null,
    /** @type {any[]} */
    tokens: [],
    /** @type {any[]} */
    admin_caps: [],
    /** @type {any[]} */
    finished_crafts: [],
    /** @type {any[]} */
    recipes: [],
  },

  /** @type {any[]} chat log (Stage 5) */
  message_history: [],

  /**
   * ADVISORY peer OBSERVATIONS (realtime constitution D2) — what the p2p room reported seeing, and nothing
   * more. ONE writer: core/modules/presence.js. It answers no authority question: not who is online, not who
   * is in this world, not who owns a character. Each row carries `observed_at` so a consumer can ask how old
   * the observation is before acting on it.
   * @type {Map<string, any>}
   */
  observed_peers: new Map(),
  /**
   * MY OWN followers' render rows — locally driven, derived from accepted on-chain party membership. ONE
   * writer: world-shell/group_wiring.js's apply_follow. A separate home from the map above because it is a
   * separate FACT: these rows are mine by construction, never an observation. The renderer composes the two
   * (core/render_rows.js); nothing else may.
   * @type {Map<string, any>}
   */
  owned_follow_render_rows: new Map(),
  /** @type {Map<string, any>} */
  visible_mobs_group: new Map(),
  /**
   * In-range RESOURCE NODES (id -> { id, position, resource_id, job_id, tier }), owned by
   * core/modules/resource_nodes.js. The server is the sole authority (deterministic spawner + chunk
   * reconcile); the client only RENDERS this stream as placeholder gather-node props the roam scene
   * reconciles each frame (mirrors visible_mobs_group). Never computed/spawned client-side.
   * @type {Map<string, { id: string, position: import('@koshi/protocol/types').Position, resource_id: string, job_id: string, tier: number }>}
   */
  visible_resource_nodes: new Map(),
  /**
   * In-range fight MARKERS (id -> nearby_fights.js marker: { id, position, public, status, started,
   * participant_ids, participant_count, mob_count, distance }), reconciled each poll by
   * game/world_fights_discovery.js off the /v1/fights?world read (replacing the dead WS packet source). Each is
   * ANOTHER player's fight within 50 blocks (a row in the fights modal). A fight the local player is a
   * participant of is NOT here (it has its own board via world_fight.js). FIX-1: a marker never auto-enters.
   * @type {Map<string, import('@aresrpg/world').to_fight_marker>}
   */
  visible_fights: new Map(),

  /**
   * In-dungeon ROOM-fight rows (fight_id -> to_dungeon_fight row: the marker + { run_pass_id, room, owner }),
   * reconciled by game/world_fights_discovery.js off /v1/dungeon-runs for my PARTY members while I am in a
   * dungeon. The same FightsModal renders these (join via dungeon::join_fight — "team up for the boss room").
   * @type {Map<string, import('@aresrpg/world').to_dungeon_fight>}
   */
  visible_dungeon_fights: new Map(),

  /**
   * The nearby-fights modal UI flag, owned by core/modules/player.js. null = closed; `{ focus_id }` = open,
   * optionally focused on one fight (clicked sword). The roam scene dispatches `action/fights_modal` on a
   * sword click; the HUD reads this + renders the teams + Join/Spectate. Pure UI (no gameplay).
   * @type {{ focus_id: string | null } | null}
   */
  fights_modal: null,

  /**
   * The world player social context menu, owned by core/modules/player.js. null = closed; an open
   * payload `{ character_id, name, x, y }` is dispatched by the roam scene (roam.js) on a LEFT-CLICK
   * of ANOTHER player's sprite — `x`/`y` are the VIEWPORT cursor coords the React PlayerMenu anchors
   * to. The menu sends the existing party/duel commands by `character_id`/`name`. Pure UI (no gameplay).
   * @type {{ character_id: string, name: string, x: number, y: number } | null}
   */
  player_menu: null,

  /**
   * WS-B lobby NPC proximity prompt, owned by core/modules/player.js. null = the player is not near any
   * interactable NPC; an open payload `{ npc_id, label }` is dispatched by the roam scene (roam.js) on the
   * edge when the avatar walks within range of the lobby NPC. The React NpcPrompt renders a "press E"
   * affordance off it; pressing the key opens `dungeons_modal`. Pure UI (no gameplay).
   * @type {{ npc_id: string, label: string } | null}
   */
  npc_prompt: null,

  /**
   * WS-B dungeon browser/create modal open flag, owned by core/modules/player.js. false = closed. Opened
   * from the NPC prompt (or a future launcher). This is the SHELL container; WS-C wires its on-chain
   * browse/create list + PTBs. Pure UI toggle.
   * @type {boolean}
   */
  dungeons_modal: false,

  /**
   * Artisan-commission modal open flag, owned by core/modules/player.js. false = closed. Opened from the
   * artisan NPC (the parallel Move v2 lane) or the DEV window hook; the CommissionModal renders off it.
   * Pure UI toggle — the commission reads/writes live behind the chain-decoupled commission_actions.js.
   * @type {boolean}
   */
  commissions_modal: false,

  // The live tactical fight is NOT game-core state (S2 mirror kill): fight truth lives in
  // fight/store.js alone and every consumer reads it synchronously via `use_fight_view()` (game/store.js) /
  // `fight_view()` (fight/index.js). The old `state.fight` copy folded through this file's ASYNC action pump and lagged the
  // core ≥1 dispatch cycle — the AP-desync root. It must never come back.

  /**
   * The board-hover tooltip target (combat only), owned by core/modules/fight.js. null when the cursor
   * is over no fighter. `entity_id` is the fighter sprite under the cursor (resolved by roam's raycast in
   * roam.js pointermove); `x`/`y` are the VIEWPORT cursor coords the React EntityTooltip anchors to. Pure
   * presentation — published by the imperative roam layer on pointermove, read by the tooltip which renders
   * the fighter's name + HP off the core fight view (use_fight_view — never recomputed). Cleared on pointerleave
   * / when no fighter is under the cursor; the tooltip also self-hides when not in a fight.
   * @type {{ entity_id: string, x: number, y: number } | null}
   */
  fight_hover: null,

  /**
   * The end-of-fight result modal, owned by core/modules/player_experience.js. null when no result
   * is showing. Opened on a player WIN (`packet/fightEnded`, our team) in a `pending` state (the
   * reward tx is being signed/submitted), then `resolved` once the on-chain xp/level delta lands via
   * the suiEvent→refetch path (truth is the chain; the wire never carries the xp). Closed by the
   * modal's Close button. The React FightResult reads this; it never computes the reward.
   * @type {import('./modules/player_experience.js').FightResultSlice | null}
   */
  fight_result: null,

  /**
   * The end-of-fight DEFEAT/abandon recap, owned by core/modules/fight.js. null when no recap shows.
   * Opened off the server's `fightSummary` packet on a LOSS / ABANDON / DEATH (the WIN celebration is
   * owned by `fight_result`). A SEPARATE persistent slice (not `fight.summary`) so the modal SURVIVES
   * `fightsDespawn` tearing the `fight` slice down — the c157-A bug where the recap flashed and vanished
   * on abandon. Closed by the modal's Close button. React (FightSummary.jsx) renders it.
   * @type {{ summary: import('./modules/fight.js').FightSummary, won: boolean } | null}
   */
  fight_summary: null,

  /**
   * The transient level-up congrats card, owned by core/modules/player_experience.js. null when not
   * showing. Set when the active character's on-chain experience delta crosses one or more levels
   * (the chain already credited +5 characteristic points + 1 spell point per level); a momentary
   * center celebration (NOT a drawer), dismissed by its Close button. React (LevelUp.jsx) renders it.
   * @type {import('./modules/player_experience.js').LevelUpSlice | null}
   */
  level_up: null,

  /**
   * The transient JOB level-up congrats card, owned by core/modules/job_progression.js. null when not
   * showing. Set when the active character's on-chain per-job xp (`character.jobs[job_id]`) crosses a job
   * level; a momentary center celebration naming the concrete unlocks (new resources / recipes / better
   * yield). React (JobLevelUp.jsx) renders it. Sibling of `level_up` (character), kept a separate slice.
   * @type {import('./modules/job_progression.js').JobLevelUpSlice | null}
   */
  job_level_up: null,

  /**
  /**
   * The OFF-CHAIN resource inventory (Wave CRAFT, #39 settle parked), owned by core/modules/craft.js: a
   * map of items.json id -> owned count, mirrored from the server's `res:<id>` ledger (the SAME ledger
   * gathering accrues into + crafting consumes/produces). The SERVER is authoritative — it pushes a full
   * `resourceInventory` snapshot on connect/select + after every craft; gather deltas are folded
   * client-side from `gatherDone` between snapshots. The JobsDrawer reads it for the ingredient have/need
   * gate. NEVER in localStorage (game data comes from the server; localStorage = preferences only).
   * @type {Record<string, number>}
   */
  resources: {},

  /**
   * The live gather state (Wave GATHER), owned by core/modules/resource_nodes.js. The SERVER is the sole
   * authority on the gather timer + the on-chain mint; the client only renders the server-authoritative
   * `gatherProgress` it pushes (the roam scene extrapolates the 3D progress ring from `per_ms` +
   * `started_at_ms`; the JobsDrawer reads it). null/idle when no harvest is running. NEVER in localStorage.
   * @type {{
   *   active: boolean,
   *   node_id: string,
   *   resource_id: string,
   *   job_id: string,
   *   per_ms: number,
   *   started_at_ms: number,
   * } | null}
   */
  gather: null,

  /**
   * The world resource node the player SELECTED to gather, owned by core/modules/resource_nodes.js. Set by
   * a roam node-click or the JobsDrawer Gather button; read by the JobsDrawer to surface the Gather
   * affordance and by the roam scene to walk the avatar into range + send the gather command. null when
   * nothing is targeted; cleared when the targeted node despawns / the harvest completes. Pure UI intent.
   * @type {{
   *   node_id: string,
   *   resource_id: string,
   *   job_id: string,
   *   tier: number,
   *   position: import('@koshi/protocol/types').Position,
   * } | null}
   */
  gather_target: null,

  /**
   * The tutorial questbook progress, owned by core/modules/quests.js. The SERVER is the sole authority
   * on per-character quest progress (transient Redis); the client renders the STATIC chain
   * (@aresrpg/sdk/quests) merged with this live progress and never computes completion. `progress` maps a
   * quest id to its live { count, completed }; a quest ABSENT from the map is not yet trackable (the
   * drawer greys it as "coming soon"). `active_quest_id` is the highlighted current objective.
   * This state is never stored in localStorage and remains null until the first questsUpdate pushes
   * after character selection.
   * @type {{
   *   progress: Record<string, { count: number, completed: boolean }>,
   *   active_quest_id: string | null,
   * } | null}
   */
  quests: null,
}

/**
 * @param {EventEmitter} emitter @param {string} event @param {any} [default_value]
 * @returns {() => any}
 */
function last_event_value(emitter, event, default_value = null) {
  let value = default_value
  emitter.on(event, (new_value) => {
    value = new_value
  })
  return () => value
}

const events = new EventEmitter()
events.setMaxListeners(0) // many modules + React subscribers observe STATE_UPDATED
const packets = new PassThrough({ objectMode: true })
const get_state = last_event_value(events, 'STATE_UPDATED', INITIAL_STATE)

/** D145b: the WS wire client (@koshi/protocol create_client) is EXCISED — chain-direct build has no
 * transport. This stays PERMANENTLY null as send_packet's dead-man switch: every legacy send_packet
 * call warns + no-ops (the WS-dead design), and no code path can ever assign it again.
 * @type {{ send: (type: string, payload: any) => void, controller: AbortController } | null} */
const ares_client = null

/** @typedef {typeof context} Context */
export const context = {
  events,
  get_state,
  /** @param {string} type @param {any} [payload] */
  dispatch(type, payload) {
    dispatch_action(type, payload)
  },
  /** @param {string} type @param {any} payload — type is the full 'packet/xxx' name */
  send_packet(type, payload) {
    if (!ares_client || ares_client.controller.signal.aborted) {
      game_log('net', 'cannot send packet, not connected', type)
      return
    }
    ares_client.send(/** @type {any} */ (type), payload)
  },
}

// DEV-only engine handle (gated by import.meta.env.DEV — absent in production builds). Lets the
// Playwright mouse harness drive the otherwise server-only paths it cannot reach offline: most
// importantly dispatching a synthetic fight slice so the tactical overlay mounts and a REAL mouse
// click on a cell can be round-tripped (board cells are 3D meshes, not DOM nodes — see roam.js
// `__ARES_FIGHT_BOARD.cell_to_screen` + fight-overlay.js `__ARES_FIGHT_OVERLAY`). It exposes only
// dispatch + get_state, never new authority. Inert in prod (the branch + the object are tree-shaken out).
if (import.meta.env.DEV && typeof window !== 'undefined') /** @type {any} */ (window).__ARES_ENGINE = context

// instantiate modules, run their one-time observers, then start the reduce loop
const modules = MODULES.map((create) => create())

// DEFENSE-IN-DEPTH (root-class kill): this one-time observe pass runs OUTSIDE the safe_reduce guards below,
// so a single module's observe() throw would abort the loop and every module AFTER it would never wire its
// listeners — silently killing whole subsystems (audio/combat/quests) while the app otherwise runs. ISOLATE
// each observe so one broken module can never silence the rest; a throw is LOUD (names the module) not fatal.
modules.forEach(({ observe }, i) => {
  try {
    observe?.(context)
  } catch (error) {
    game_log(
      'engine',
      `module '${MODULES[i]?.name || i}' observe() threw (isolated); its listeners are not wired, the rest still observe`,
      error
    )
  }
})

aiter(combine(actions, packets))
  .reduce(
    (last_state, /** @type {Action} */ action) => {
      // NEVER-FREEZE INVARIANT (client safe_reduce, mirrors the server one): a throw in ANY module reducer
      // or STATE_UPDATED observer must NEVER kill this reduce loop. If it did, the loop's promise rejected
      // (the .catch below), STATE_UPDATED stopped firing forever, and BOTH the React HUD + the Three rAF
      // loop froze together — a cast->freeze regression. So a throwing reducer keeps that module's prior
      // state + logs; a throwing observer is caught so the loop survives and the next action re-emits.
      const state = modules.reduce((intermediate, { reduce }) => {
        if (!reduce) return intermediate
        try {
          return reduce(intermediate, action) ?? intermediate
        } catch (error) {
          game_log('engine', `reducer threw on '${action.type}'; module state preserved, loop alive`, error)
          report_error(error, { area: 'engine-loop', action: 'reducer', action_type: action.type })
          return intermediate
        }
      }, last_state)
      // Action-type listeners: guard so a throw can't kill the reduce loop (the next action still processes).
      try {
        events.emit(action.type, action.payload)
      } catch (error) {
        game_log('engine', `action '${action.type}' listener threw; loop preserved`, error)
        report_error(error, { area: 'engine-loop', action: 'listener', action_type: action.type })
      }
      // STATE_UPDATED: ISOLATE each listener. emit() runs listeners synchronously, so one throwing observer
      // aborts the REST (Node EventEmitter) and starves React's store-notify (useSyncExternalStore) = the
      // freeze. A per-listener try/catch guarantees EVERY listener still runs, closing the freeze class
      // beyond the known c215/c217 triggers (qa-code's structural completion of the safe_reduce guard).
      for (const state_listener of events.listeners('STATE_UPDATED')) {
        try {
          state_listener(state)
        } catch (error) {
          game_log('engine', 'a STATE_UPDATED listener threw (isolated); React not starved', error)
          report_error(error, { area: 'engine-loop', action: 'state_listener' })
        }
      }
      return state
    },
    { ...INITIAL_STATE }
  )
  .catch((error) => {
    // the never-freeze invariant BREACHED — both the HUD and the render loop are now frozen. Maximum loudness.
    game_log('engine', 'reduce loop crashed', error)
    report_error(error, { area: 'engine-loop', action: 'reduce_loop_crashed' })
  })

// kick the reducers so STATE_UPDATED fires once with the initial state
context.dispatch('action/init')
