// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD SPAWNS — the last visible link of the discovery loop: render the CHAIN spawns of the CURRENT +
// adjacent discovered zones as real, interactable fixtures in the overworld. Where the CompassStrip only
// draws bearing pips, this places the actual rigs you walk up to, attack, and stand near to gather.
//
// DATA (SPEC §14 /v1 read layer): the SAME sources the CompassStrip reads — `get_zones` tells us which of
// the 3×3 neighbourhood zones are discovered; zone_rows.js (the search-cost-rework seed-derivation home)
// turns each zone's stored {seed, bitmaps} into the live rows {spawn_id, kind, index, x, z, template_id,
// size|remaining, job, tier, spawned_at_ms, group_seed} with WORLD-ABSOLUTE x/z. The mob row's `template_id` is a Sui object
// ID → `get_mob_template` resolves it (cached) to the roster NAME + level band; `group_seed` + the /v1/config
// dials derive each member's EXACT level + archi flag (spawn_compose.js — the chain's own discovery-time
// derivation); `spawned_at_ms` feeds the §8 aging XP bonus. ONE 6 s short-poll, paused while the tab is hidden.
//
// RENDER (ported, not reinvented): the rig lifecycle is lifted from ambient_mobs.js — the module-cached
// GLB fetch+SkeletonUtils-clone, apply_avatar_material, the idle mixer, world-size normalisation, and the
// feet_of(ground_surface_y) grounding law — but driven by CHAIN rows. Each group member independently ambles a
// few blocks around its OWN spawn anchor (ambient_placement.js WANDER core, seeded off spawn_id
// so refreshes never teleport it) or holds idle, cross-blending an idle↔walk clip; the terrain-resolved group
// HOME + claim logic never move. Resource nodes render ONE instance per chain row (client rider, UPGRADE_NOTES2.md
// §CLIENT RIDER — a "wheat field" is now K adjacent ResourceSpawn rows the CHAIN itself grows via
// foundation/world_math.move::grow_cluster, each remaining:1 at its own authored (x,z); the client no longer
// grows a blob off one anchor — see spawn_rigs.js create_gather_layer), textured with the gatherable's own
// procedural art (ENGINE_AAA_PLAN §5.3, B8): wheat/herb/ore read distinctly at gather distance, a harvested
// cell's whole row disappears from /v1 on the next poll (reconcile/teardown below — generic, no per-node
// special-casing), apex-tier nodes carry a capped gold glow. Range-gated like ambient; suspended in a dungeon.
//
// INTERACT: the group card is a HEADER (group level band + the ticking §8 aging XP bonus)
// over ONE LINE PER MOB (no ×N collapse) — a UNIT, visibly unlike a player's single bold pill. Within
// PROXIMITY_M — mirroring the gather distance — a mob group gets a gold
// card HIGHLIGHT + the [R] ATTACK prompt in the shared PromptStack (same F/G/E language); a resource arms the
// [G] gather prompt via action/gather_target, held with HYSTERESIS (pick_gather_target — spawn_rigs.js) so the
// reticle doesn't flicker between two chain cells ~1 block apart as the player crosses their equidistant line.
// [R] press OR a click fires the EXISTING `create_world_fight` claim+create PTB (spawn_id + world_id +
// mob_template_id — the row carries all three); on success we re-poll so the claimed group vanishes. We only
// manage the gather target WE set, never stomping a JobsDrawer selection.

import { Raycaster, Vector2 } from 'three'
import { get_mob_template } from '@aresrpg/sdk/game'
import { zone_of_world } from '@aresrpg/sdk/coords'
import { spawn_rows as core_spawn_rows } from '@aresrpg/world/spawns_zones'
import { engage_offset } from '@aresrpg/world/spawns_reconcile'
import { group_engage_blocked } from '@aresrpg/world/nearby_fights'

import i18n from '../i18n'
import { cancel_engage_timing, start_engage_timing } from '../core/engage_timing.js'
import { game_log } from '../core/log.js'
import { display_mob_name } from '../content/mob_name_overrides'
import { report_error } from '../core/report.js'
import { get_config } from '../rpc/client'
import { subscribe_zones } from '../rpc/zones_poll'
import { zone_rows_v1, zone_rows_chain, zone_world_doc } from './zone_rows.js'
import { get_sdk } from '../chain/sdk'
import { use_world_binding } from '../world-shell/session_gate.js'
import { spawns_store, spawns_input } from '../world-shell/spawns_adapter.js'
import { publish_claim_checkpoint_receipt } from '../world-shell/world_checkpoint.js'
import { create_world_fight } from '../world-shell/dungeon_engage_actions.js'
import { recover_fight_entry_refusal } from '../world-shell/dungeon_settlement.js'
import { instrument_cpu_callback } from './cpu_span.js'
import { use_dungeon } from '../world-shell/dungeon_store.js'
import { as_one_toast } from '../world-shell/dungeon_actions.js'
import { use_party } from '../world-shell/party_store.js'
import { enter_world_fight, resume_world_fight } from '../world-shell/world_fight.js'
import { use_prompt_stack } from '../world-shell/prompt_stack.js'

import { cardinal_of } from './screens/hud/world/compass_math.js'
import { engage_block, engage_block_copy_key } from './engage_gate.js'
import { start_fight_engage } from './fight_engage.js'
import { push_event_toast } from './core/toast.js'
import { context } from './core/game.js'
import { fight_store } from '@aresrpg/fight/store'
import { parse_move_abort } from './core/abort_copy.js'
import { plate_occluded, project_plate } from './nameplate_occlusion.js'
import { render_group_card, update_group_aging } from './spawn_card.js'
import {
  create_rig_layer,
  create_gather_layer,
  resource_visual,
  resolve_group_seat,
  select_rig_budget,
} from './spawn_rigs.js'
import { apply_veil } from './spawn_veil.js'
import { world_fight_active, world_fight_session } from '../world-shell/fight_session_scope.js'

const POLL_MS = 6000 // the CompassStrip zone cadence — reused, never a second loop
// (The search fast-path grace + all receipt/poll reconcile discipline live in the spawns CORE now —
// @aresrpg/world spawns_zones: receipt-proven adds are grace-shielded, removals are tombstoned there.)
const LOAD_RADIUS_M = 90 // place a spawn's rigs once the player is this close
const DESPAWN_RADIUS_M = 120 // …and drop them past this (hysteresis: no spawn/despawn thrash at the edge)
// RIG BUDGET (P0 OOM ceiling 2026-07-11): hard caps on concurrent RESIDENT rigs, independent of the on-chain
// density dial (which went 3-8 → 12-24 groups/zone with no cap). Groups are the heavy tier — each member is a
// SkeletonUtils clone (skeleton + mixer, MB each) — so they cap tighter; resource clusters are light billboards.
// PLACE_PER_FRAME makes spawn-in INCREMENTAL: even if the initial ingest lands hundreds of in-range spawns, at
// most this many rigs of each kind mount per frame → no single-frame burst on world entry. Eviction is
// nearest-first (farthest despawns first) with a swap-margin hysteresis so boundary jitter can't thrash.
const GROUP_BUDGET = 32 // max resident mob GROUPS (tunable; each is 1–6 skinned rigs)
// max resident resource-node PATCHES (lighter: shared geo/mat, ONE (or two, ore) InstancedMesh draw call each
// regardless of its up-to-20-instance patch size — see spawn_rigs.js create_gather_layer).
const NODE_BUDGET = 48
const PLACE_PER_FRAME = 4 // ≤ this many NEW groups AND nodes mount per frame — the anti-burst incremental gate
const SWAP_MARGIN_M = 12 // a resident rig is only displaced by an unplaced one nearer by more than this (blocks)
const SWAP_MARGIN_SQ = SWAP_MARGIN_M * SWAP_MARGIN_M
const TELEMETRY_MS = 60000 // house telemetry: one rig/node/heap line per minute so a live session self-reports
const HEAPTRACE_MS = 10000 // [heaptrace] dev leak-hunt cadence (gated on ?heaptrace=1) — dense enough for a 10-min sweep
// PROXIMITY / GATHER HYSTERESIS moved INTO the spawns core (D770a W2 — the render-contract fix): this renderer
// reports `player_pos` plus placed group geometry; the fold owns [G]/[R] targets (frame loop below).
const NAMETAG_CULL_M = 40 // hide a plate past this many blocks
const NAMETAG_FADE_M = 34 // …fade it in over the last few blocks instead of a hard pop
const OCCLUDED_OPACITY = 0.2 // plate faded when terrain sits between it and the eye
const CLICK_SLOP_PX = 6 // pointerdown→up drift under which a press counts as a CLICK not a drag (drag-click law)

/**
 * @param {{ engine: any, canvas?: HTMLElement | null, get_player_pos: () => ArrayLike<number> }} args
 * @returns {{ set_hidden: (h: boolean) => void, dispose: () => void }}
 */
export function create_world_spawns({ engine, canvas = null, get_player_pos }) {
  const sample = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
    engine.sample_block?.(x, y, z) ?? 0
  const raycaster = new Raycaster()
  const ndc = new Vector2()
  let raf = 0
  let last_t = performance.now()
  let fight_veiled = false // in-fight visual veil (edge-detected in frame_body; see the block there)
  let last_telemetry = 0 // house telemetry throttle (rig/node/heap once per TELEMETRY_MS)
  let last_heaptrace = 0 // [heaptrace] leak-hunt throttle (gated on ?heaptrace=1)
  const HEAPTRACE = typeof location !== 'undefined' && location.search.includes('heaptrace')
  let disposed = false
  let dims_world = /** @type {string | null} */ (null) // world whose doc facts were fed into the spawns core
  let poll_seq = 0 // versioned-snapshot stamp (the core discards out-of-order polls)
  // Discovered-zone list — the ONE shared /v1/zones poll (rpc/zones_poll.js — #242), also read by CompassStrip
  // and DiscoveryPrompts, instead of this loop fetching it independently on its own 6s tick.
  let zones_view = /** @type {{ data: any, error: unknown, loading: boolean, stale: boolean }} */ ({
    data: null,
    error: null,
    loading: false,
    stale: false,
  })
  let zones_world_id = /** @type {string | null} */ (null)
  let unsubscribe_zones = () => {}
  const ensure_zones_subscription = (/** @type {string | null} */ world_id) => {
    if (zones_world_id === world_id) return
    unsubscribe_zones()
    zones_world_id = world_id
    unsubscribe_zones = world_id
      ? subscribe_zones(world_id, (v) => {
          zones_view = v
        })
      : () => {}
  }
  let polling = false
  let engaging = false
  let resumed = false // one-shot guard: fire the world-fight reconnect read once the world binds (see poll)
  let my_gather_key = /** @type {string | null} */ (null) // the gather_target WE set (never stomp another writer's)
  let attack_entry = /** @type {any} */ (null) // the mob group the [R] prompt + card-highlight point at
  let attack_target_engageable = false // is attack_entry within the ENGAGE ring (gold) or only VISIBLE?
  let attack_target_block = /** @type {import('./engage_gate.js').EngageBlock | null} */ (null) // #861: the
  // gate answer the CURRENTLY registered pill was built from — part of set_attack_target's idempotence key, so
  // a session that starts (or ends) a fight re-registers the pill on the very next frame instead of leaving a
  // gold pill over a press that can no longer fire.
  let render_probe_at = /** @type {number | null} */ (null) // cert ts of the latest search fast-path → one cert→visible log

  /** @type {Map<string, any>} */
  const entries = new Map() // key `${zx}:${zy}:${kind}:${spawn_id}` → live spawn entry
  // Retained rig-budget views. Entries themselves carry the transient d2 field, avoiding four arrays plus
  // one `{key,d2}` object per tracked spawn on every display frame.
  /** @type {{key:string,d2:number}[]} */ const mob_placed = []
  /** @type {{key:string,d2:number}[]} */ const mob_cand = []
  /** @type {{key:string,d2:number}[]} */ const res_placed = []
  /** @type {{key:string,d2:number}[]} */ const res_cand = []
  const projected_plate = { left: 0, top: 0 }

  // GameConfig dials the composition mirror needs (spawn_compose.js): archimob_bp + team_size_bound off
  // /v1/config `dials{}` — a dial only exists there once a DialChanged ever fired, so absent/failed reads
  // leave `null` and the card falls back to the chain defaults (50 bp / 6). One-shot fetch (config-grade);
  // placed cards re-render when it lands so a pre-fetch render never sticks with drifted flags.
  let dials = /** @type {{ archimob_bp: number | null, team_bound: number | null }} */ ({
    archimob_bp: null,
    team_bound: null,
  })
  get_config()
    .then((cfg) => {
      dials = {
        archimob_bp: cfg?.dials?.archimob_bp != null ? Number(cfg.dials.archimob_bp) : null,
        team_bound: cfg?.dials?.team_size_bound != null ? Number(cfg.dials.team_size_bound) : null,
      }
      if (dials.archimob_bp == null && dials.team_bound == null) return
      for (const e of entries.values()) if (e.kind === 'mob' && e.chip) render_mob_card(e)
    })
    .catch(() => {}) // defaults hold — the card mirrors config.move's own DEFAULT_* constants

  // template_id (Sui object ID) → { name, min_level, max_level } roster facts, resolved once per template on chain
  // (min/max = the template BAND the per-member level roll draws within — spawn_compose derives the exact levels).
  /** @type {Map<string, { name: string, min_level: number, max_level: number, element: number } | null>} */
  const tmpl_cache = new Map()
  const tmpl_pending = new Set()
  const short_id = (/** @type {string} */ id) => String(id).slice(0, 8) // transient placeholder until the read lands
  const resolve_template = (/** @type {string} */ id) => {
    if (tmpl_cache.has(id)) return tmpl_cache.get(id)
    if (!tmpl_pending.has(id)) {
      tmpl_pending.add(id)
      get_sdk()
        .then((sdk) => get_mob_template({ grpc_client: sdk.grpc_client })(id))
        .then((tpl) => {
          const facts = tpl
            ? {
                // display_mob_name: interim swap for a shipped-but-unacceptable chain name (#521) — the
                // model resolver (game/data/mobs.js get_mob_model) undoes it before its catalog lookup,
                // so the group card AND the roaming rig both stay correct off this one cached value.
                name: display_mob_name(tpl.name) || short_id(id),
                min_level: tpl.min_level,
                max_level: tpl.max_level ?? tpl.min_level,
                element: tpl.element ?? 255, // carried into note_group_identity so the fight board resolves the mob's cast element
              }
            : null
          tmpl_cache.set(id, facts)
          // The async roster read re-enters the ONE spawns store as data (the reducer-door law) so the map /
          // minimap markers carry the NAME + level band as a pure projection (spawn_markers) — never a second
          // per-surface template read. The 3-D card still reads this same cache synchronously below.
          if (facts) spawns_input({ type: 'template_resolved', template_id: id, ...facts })
          refresh_mob_card(id) // re-render any placed group of this template now its name is known
        })
        .catch(() => tmpl_cache.set(id, null))
        .finally(() => tmpl_pending.delete(id))
    }
    return undefined // not resolved yet
  }

  // the 3D mob-group rig layer (member placement + GLB load + per-member roam) — bound to this instance's engine,
  // ground oracle, and template resolver; `is_disposed` lets a mid-flight async GLB load bail after teardown.
  const rigs = create_rig_layer({
    engine,
    sample,
    resolve_template,
    is_disposed: () => disposed,
    is_veiled: () => fight_veiled,
  })
  // the resource-node FIELD PATCH layer (spawn_rigs.js) — builds/teardowns each node's grid-adjacent instanced
  // patch and drives its per-frame sway + depletion state; bound to this instance's engine + ground oracle (every
  // patch cell seats independently via the SAME sample() the mob rig layer above already uses).
  const gather = create_gather_layer({ engine, sample })

  // one fixed overlay for every nameplate (the z law: z-11, body-appended, under the HUD, over the world).
  const layer = document.createElement('div')
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:11'
  document.body.appendChild(layer)
  let cinematic_hidden = false
  let world_paused = false
  let resume_projection_pending = false
  const sync_layer_hidden = () => {
    layer.style.display = cinematic_hidden || world_paused || resume_projection_pending ? 'none' : ''
  }

  const canvas_rect = () => {
    const cv = canvas ?? /** @type {HTMLElement | null} */ (document.querySelector('canvas'))
    return cv?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
  }

  // ── data sources (SHARED with the CompassStrip — same binding home, same RPC cache, same SDK read) ─────────
  const current_world_id = () => {
    const character_id = context.get_state().selected_character_id
    const b = use_world_binding.getState()
    return b.character_id === character_id ? (b.world ?? null) : null
  }
  const fetch_zone_spawns = async (
    /** @type {string} */ world_id,
    /** @type {number} */ zx,
    /** @type {number} */ zy
  ) => zone_rows_v1(world_id, zx, zy) // rows DERIVE from the zone's stored seed (zone_rows.js — the one home)

  // Resolve zone_size + the world↔chain offset (bounds/2) once per world, off the SHARED World-doc read
  // (zone_rows.js home), and feed it into the spawns CORE — the one place chain coords become world space.
  const ensure_world_dims = async (/** @type {string} */ world_id) => {
    if (dims_world === world_id) return
    const doc = await zone_world_doc(world_id)
    spawns_input({ type: 'world_doc', doc })
    if (doc) dims_world = world_id
  }

  // SYNC the render residency from the CORE's row projection (D770a W2): the core owns WHICH rows exist
  // (receipt/poll reconcile, grace shields, tombstones); this map owns only their RENDER lifecycle (rigs,
  // chips, budget). A `pending` claim row hides its group — the optimistic fight-entry beat as data.
  const sync_from_core = () => {
    /** @type {Map<string, any>} */
    const listed = new Map()
    for (const r of core_spawn_rows(spawns_store.getState())) listed.set(r.key, r)
    for (const [key, entry] of entries)
      if (!listed.has(key)) {
        teardown(entry)
        entries.delete(key)
      }
    for (const [key, next] of listed) {
      const cur = entries.get(key)
      if (cur) {
        cur.row = next.row // keep the placed rig; refresh the row (remaining/size can change)
        const engaged = next.pending === 'claim'
        if (engaged !== !!cur.engaged) set_group_engaged(cur, engaged)
      } else {
        entries.set(key, {
          key,
          row: next.row,
          zx: next.zx,
          zy: next.zy,
          kind: next.kind,
          placed: false,
          cx: 0,
          cy: 0,
          cz: 0,
          members: [],
          mesh: null,
          chip: null,
          engaged: next.pending === 'claim',
        })
      }
    }
  }

  // ── the ONE short-poll: current + adjacent discovered zones → ONE versioned snapshot into the core ─────────
  const poll = async () => {
    if (disposed || polling || document.hidden) return
    const world_id = current_world_id()
    ensure_zones_subscription(world_id)
    if (!world_id) {
      if (entries.size) {
        spawns_input({ type: 'world_bound', world_id: null }) // left the world → the core resets
        sync_from_core() // …and every rig tears down
      }
      return
    }
    // RECONNECT (one-shot per session): the first poll with a bound world re-mounts a world fight the character
    // is mid-way through (page refresh / fresh boot). resume_world_fight is a keyless RPC read that no-ops when
    // there is no live fight or a session is already up — safe to fire exactly once here.
    if (!resumed) {
      resumed = true
      const character_id = context.get_state().selected_character_id
      if (character_id) void resume_world_fight(character_id)
    }
    polling = true
    try {
      await ensure_world_dims(world_id)
      if (spawns_store.getState().world_id !== world_id) spawns_input({ type: 'world_bound', world_id }) // ferry belt
      const { zone_size, offset_x, offset_z } = spawns_store.getState()
      const p = get_player_pos()
      // Player pos is SIGNED WORLD space → the chain zone KEY (data/claim/gather) translates world→chain then floors.
      const cell = zone_of_world(Number(p[0]), Number(p[2]), zone_size, offset_x, offset_z)
      if (!cell) return
      const zdata = zones_view.data // the shared poll's latest snapshot — stale-on-error, never a hard null flip
      const discovered = (zdata?.zones ?? []).filter((z) => z.discovered !== false)
      const discovered_keys = new Set(discovered.map((z) => `${z.zx}:${z.zy}`))
      /** @type {Array<{zx:number,zy:number}>} */
      const cells = []
      for (let dx = -1; dx <= 1; dx += 1)
        for (let dy = -1; dy <= 1; dy += 1) {
          const zx = cell.zx + dx
          const zy = cell.zy + dy
          if (zx >= 0 && zy >= 0 && discovered_keys.has(`${zx}:${zy}`)) cells.push({ zx, zy })
        }
      const fetched = await Promise.all(
        cells.map(async (c) => ({ ...c, rows: await fetch_zone_spawns(world_id, c.zx, c.zy).catch(() => null) }))
      )
      if (disposed) return
      // ONE atomic reconcile input: the discovered-zone list + the fetched neighbourhood rows. The CORE owns
      // the discipline (stale-version discard, receipt grace shields, tombstones); this adapter only ferries.
      poll_seq += 1
      spawns_input({
        type: 'zones_rows_snapshot',
        version: poll_seq,
        zones: discovered.map((z) => ({ zx: z.zx, zy: z.zy, discovered_at_ms: z.discovered_at_ms ?? null })),
        cells: fetched.filter((c) => Array.isArray(c.rows)),
      })
      sync_from_core()
      if (drop_claimed_ghosts()) sync_from_core() // fold visible_fights truth in the SAME tick (#480)
    } finally {
      polling = false
    }
  }

  // ── SEARCH FAST-PATH — the gap between mobs appearing and search done was too slow ──
  // discovery_actions.js dispatches the `zone_searched` RECEIPT into the core the instant the tx CERTIFIES
  // (checkpoint+zone+hunt_zone advance atomically there) and broadcasts the same beat on the shared bus. The
  // steady-state /v1 poll would only SEE the new spawns seconds later (indexer ~1.5s + api cache 5s + client
  // LRU 3s), so THIS listener reads the zone the tx just wrote CHAIN-DIRECT (zone_rows_chain — atomically
  // consistent post-cert) and ferries the rows in as a PROVEN top-up: the core grace-shields them against the
  // lagging poll, the next frame places them. READ-ONLY: no tx, zero gas, money rails untouched.
  const on_zone_searched = async (/** @type {{ world_id:string, zx:number, zy:number, at_cert?:number }} */ ev) => {
    const { world_id, zx, zy, at_cert } = ev ?? {}
    if (disposed || !world_id || world_id !== current_world_id()) return
    await ensure_world_dims(world_id)
    const rows = await zone_rows_chain(world_id, zx, zy).catch(() => null)
    if (disposed || !rows?.length) return
    // Tag the cert instant BEFORE the ferry so place() emits the one-shot cert→visible delta for the first
    // NEW spawn (the fix's own proof it renders < 1s); _searched marks ride the sync below.
    if (at_cert != null) render_probe_at = at_cert
    const before = new Set(entries.keys())
    spawns_input({ type: 'zone_rows', zx, zy, proven: true, rows })
    sync_from_core() // search fast-path: new rows in-world + on the minimap the same beat
    for (const [key, e] of entries) if (!before.has(key)) e._searched = true
    console.info(
      `[world-spawns] search fast-path: zone ${zx}:${zy} → ${rows.length} spawns chain-direct` +
        (at_cert != null ? ` (data @ ${Math.round(performance.now() - at_cert)}ms after cert)` : '')
    )
  }

  // Feed the spawns core the exact terrain-resolved group HOME used by the renderer plus its stable member
  // anchors. The home backs ENGAGE legality; members back the wider [R] visibility ring. An empty e.members
  // (teardown) clears both, reverting an unplaced group to its row-anchor fallback.
  const feed_group_geometry = (/** @type {any} */ e) =>
    spawns_input({
      type: 'member_positions',
      key: e.key,
      home: { x: e.cx, z: e.cz },
      members: e.members.map((/** @type {any} */ m) => ({ x: m.ax, z: m.az })),
    })

  // ── placement (in-range only) ──────────────────────────────────────────────────────────────────────────────
  const place = (/** @type {any} */ e) => {
    // MobTemplate carries no visual field — the model resolves off its NAME (get_mob_model), not the raw
    // template_id, so the rig layer needs the read resolve_template already fetches for the card. Block mob
    // placement until it settles (success or a definitive miss) so a rig never spawns on a wrong archetype it
    // can't self-correct — same "retry next scan" shape as the unstreamed-column guard below.
    if (e.kind === 'mob' && resolve_template(e.row.template_id) === undefined) return false
    // ONE seat resolver (spawn_rigs.js): a clean walkable column when there is one (mobs nudge off tree/cliff/
    // water; a resource takes its exact point), else FLOAT on the surface so a group over WATER or steep terrain
    // still RENDERS instead of silently vanishing while its compass pip shows it. null =
    // the column is genuinely unstreamed → retry on the next scan as chunks arrive.
    const seat = resolve_group_seat({
      sample,
      x: e.row.x,
      z: e.row.z,
      scan_from_y: Number(get_player_pos()[1]),
      nudge: e.kind === 'mob',
    })
    if (!seat) return false
    e.cx = seat.x
    e.cz = seat.z
    e.cy = seat.y
    if (seat.mode === 'float')
      // house telemetry (never a silent skip): one line naming why the anchor couldn't seat cleanly.
      console.info(
        `[world-spawns] ${e.kind} ${e.row.spawn_id} floated on the surface — no dry footing near its anchor ` +
          `(over water or steep terrain); rendering there instead of skipping`
      )
    if (e.kind === 'mob') {
      rigs.place_members(e)
      // Feed the placed home + member spawn anchors to the core as one TYPED INPUT. Stable leash centres
      // (mem.ax/az), not live roam, keep the widened prompt from flickering. Cleared on teardown.
      feed_group_geometry(e)
    } else gather.build(e) // resource → the crossed-card sprite cluster (spawn_rigs.js)
    e.placed = true
    spawn_chip(e)
    // SEARCH FAST-PATH proof (one line per search): the first chain-direct spawn to become VISIBLE reports the
    // full cert→visible latency. Nulls render_probe_at so only the first entry logs.
    if (render_probe_at != null && e._searched) {
      console.info(
        `[world-spawns] search fast-path: first spawn VISIBLE ${Math.round(performance.now() - render_probe_at)}ms after cert`
      )
      render_probe_at = null
    }
    return true
  }

  // ── the group card: ONE plate, ONE LINE PER MOB (no ×N collapse) ────────────────────────
  const render_mob_card = (/** @type {any} */ e) => {
    if (!e.chip) return
    const tpl = resolve_template(e.row.template_id) // place() gated placement on this settling → resolved here
    render_group_card(e.chip, {
      name: tpl?.name ?? short_id(e.row.template_id),
      min_level: tpl?.min_level ?? 0,
      max_level: tpl?.max_level ?? tpl?.min_level ?? 0,
      size: Number(e.row.size) || 1,
      spawned_at_ms: Number(e.row.spawned_at_ms) || 0,
      // the DISCOVERY-time composition seed + the config dials → exact per-member levels + archi rows
      // (spawn_compose.js mirrors the chain's derivation; null dials fall back to the chain defaults there).
      group_seed: e.row.group_seed ?? null,
      archimob_bp: dials.archimob_bp,
      team_bound: dials.team_bound,
    })
  }
  const refresh_mob_card = (/** @type {string} */ template_id) => {
    for (const e of entries.values())
      if (e.kind === 'mob' && e.chip && e.row.template_id === template_id) render_mob_card(e)
    // the minimap markers pick up the name/level band from the store's template_resolved fold (resolve_template)
  }

  const spawn_chip = (/** @type {any} */ e) => {
    const chip = document.createElement('div')
    const mob = e.kind === 'mob'
    chip.style.cssText =
      'position:absolute;transform:translate(-50%,-100%);padding:3px 8px;white-space:nowrap;text-align:center;' +
      'font:600 10px/1.5 "JetBrains Mono",monospace;letter-spacing:.14em;text-transform:uppercase;' +
      `color:${mob ? '#f5d0a9' : '#bfe0ff'};background:rgba(10,10,15,.78);` +
      `border:1px solid ${mob ? 'rgba(200,150,60,.5)' : 'rgba(74,158,255,.5)'};` +
      `text-shadow:0 0 6px ${mob ? 'rgba(200,150,60,.6)' : 'rgba(74,158,255,.6)'};` +
      'display:none;pointer-events:none;transition:opacity .18s ease,border-color .18s ease,box-shadow .18s ease'
    layer.appendChild(chip)
    e.chip = chip
    if (mob) render_mob_card(e)
    // Design ruling 2026-07-12: the plate shows the REAL resource name (from the @aresrpg/sdk/jobs roster — the item
    // display name), never the "(N left)" charge counter. One node = one gather is a SEED knob (world
    // re_min_qty/re_max_qty), not a client artifact — the chain's `remaining` still drives the depletion
    // visual for any world seeded with multi-charge nodes; `compass.resource` is the localized fallback.
    else
      chip.textContent =
        resource_visual(Number(e.row.job) || 0, Number(e.row.tier) || 1).name || i18n.t('compass.resource')
  }

  // Card treatment on the group you're close enough to target: GOLD glow when claimable (design-system gold
  // #c8963c + the house glow), default border otherwise.
  const set_highlight = (/** @type {any} */ e, /** @type {'off'|'claimable'} */ mode) => {
    if (!e?.chip) return
    e.chip.style.borderColor = mode === 'claimable' ? '#c8963c' : 'rgba(200,150,60,.5)'
    e.chip.style.boxShadow = mode === 'claimable' ? '0 0 20px rgba(200,150,60,.55)' : 'none'
  }

  // GLOBAL-SEARCH claim: the proximity gate lives in the CORE now (claim_intent measures with `engage_d2` — the
  // nearer of the group's derivation anchor and its rendered home). A refused intent on the CLICK path (on_up
  // raycasts placed rigs to the despawn radius) teaches "get closer" instead of firing a doomed claim — and
  // NAMES THE WAY (#1318: a bare "get closer" cost a 6-point spiral). The bearing comes from the core's engage
  // geometry through the compass strip's own 8 labels, so the hint and the strip can never disagree.
  const hint_too_far = (/** @type {string|null} */ key = null) => {
    const offset = key ? engage_offset(spawns_store.getState(), key) : null
    const title = offset
      ? i18n.t('discovery.engage_too_far_dir', {
          dist: Math.max(1, Math.ceil(offset.distance)), // never UNDERSTATE the gap — 6.4m must not read "6m" at a 6m ring
          dir: cardinal_of(offset.dx, offset.dz),
        })
      : i18n.t('discovery.engage_too_far')
    push_event_toast({ state: 'info', title })
  }

  // #861 — the live inputs of the ONE engage gate (engage_gate.js). This is the whole effectful half: the
  // predicate itself is pure, so both the pill's presentation and engage()'s press door decide off the SAME
  // fact and can never disagree about whether — or why — a press is refused.
  const engage_state = () => {
    const phase = use_dungeon.getState()
    return {
      engaging,
      fight_session_id: world_fight_session(phase) ? phase.fight_id : (phase.run_pass_id ?? null),
      character_id: context.get_state().selected_character_id,
    }
  }

  // NO SILENT FAILURES (docs craft law): a refused press always leaves a trace. Player-relevant blocks get the
  // house event toast — the same copy the on-chain refusal words this way; the in-flight re-entry latch is
  // internal (the frame loop has already cleared the pill), so it takes the debug-gated log line instead.
  const refuse_engage = (/** @type {import('./engage_gate.js').EngageBlock} */ block) => {
    const copy_key = engage_block_copy_key(block)
    if (copy_key) push_event_toast({ state: 'info', title: i18n.t(copy_key) })
    else game_log('world-spawns', `engage press refused — ${block}`)
  }

  // FIGHT-ENTRY OPTIMISTIC BEAT (press → authoritative task + spectacle in one turn) — the engaged group hides
  // immediately (mob disappearance is part of the beat) and returns on a failed/refused tx.
  // `e.engaged` parks the frame loop for this entry (roam/draw_chip/nearest-targeting all skip it — draw_chip
  // re-writes chip display every frame, so a bare style write would be stomped); the visibility one-shots here.
  // The cinematic itself (camera/sword/sting) is fight_entry.js's, driven over the shared bus (events below).
  const set_group_engaged = (/** @type {any} */ e, /** @type {boolean} */ on) => {
    e.engaged = on
    for (const mem of e.members) if (mem.rig) mem.rig.root.visible = !on
    if (e.mesh) e.mesh.visible = !on
    if (e.chip) e.chip.style.display = on ? 'none' : '' // !on hands display back to the frame loop's draw_chip
  }

  // register/clear the [R] ATTACK prompt in the shared PromptStack (same F/G/E language) for `e`, moving the card
  // highlight with it. The core now arms on the WIDER visibility ring (ATTACK_VISIBLE_M from the nearest member —
  // design ruling 2026-07-18), so an armed group is not always claimable: `engageable` (the core's ENGAGE-ring flag) drives
  // GOLD when claimable, the default border when only VISIBLE (a press there gets engage()'s honest "get closer").
  // Idempotent per (target, engageable). The PromptStack renderer owns the key + click.
  const set_attack_target = (/** @type {any} */ e, /** @type {boolean} */ engageable = false) => {
    // #861 — ONE gate, read here for PRESENTATION and again inside engage() as the last line of defense, so the
    // pill can never promise a press that cannot fire. A blocked pill renders the house honest-block variant
    // (`busy` — gold→muted, still clickable, label = the reason) exactly like the [G] gather gate.
    const block = e ? engage_block(engage_state()) : null
    if (e === attack_entry && engageable === attack_target_engageable && block === attack_target_block) return
    if (attack_entry && attack_entry !== e) set_highlight(attack_entry, 'off')
    attack_entry = e
    attack_target_engageable = engageable
    attack_target_block = block
    const { register_prompt, clear_prompt } = use_prompt_stack.getState()
    if (e) {
      const copy_key = engage_block_copy_key(block)
      set_highlight(e, engageable && !block ? 'claimable' : 'off')
      register_prompt({
        id: 'attack',
        key: 'R', // #594: mount/ride now registers for real under KeyX (embed_voxel_player.js); AZERTY-safe (KeyR)
        label: copy_key ? i18n.t(copy_key) : i18n.t('discovery.attack'),
        priority: 90, // most-actionable: a group you're standing in anchors the stack bottom
        busy: !!block,
        on_trigger: () => engage(e), // ONE press door: engage() re-reads the gate and surfaces the same reason
      })
    } else {
      clear_prompt('attack')
    }
  }

  const teardown = (/** @type {any} */ e) => {
    for (const mem of e.members) rigs.dispose_member(mem) // stop mixer + dispose per-clone skeleton, REMOVE-ONLY
    e.members = []
    if (e.kind === 'mob') feed_group_geometry(e) // empty now → clear this group's rendered geometry in the core
    if (e.mesh) gather.teardown(e) // resource cluster: remove the group (shared geo/tex kept) + free its material
    e.chip?.remove()
    e.chip = null
    e.placed = false
    if (e === attack_entry) set_attack_target(null) // the highlighted target left → drop its [R] prompt
    if (my_gather_key && my_gather_key === `${e.zx}:${e.zy}:${e.row.spawn_id}`) release_gather()
  }

  // ── gather proximity (feeds the existing [G] PromptStack prompt via action/gather_target) ────────────────────
  const set_gather = (/** @type {any} */ e) => {
    const world_id = current_world_id()
    my_gather_key = `${e.zx}:${e.zy}:${e.row.spawn_id}`
    context.dispatch('action/gather_target', {
      node_id: my_gather_key,
      resource_id: e.row.template_id, // JobsDrawer falls back to the raw id when unmapped
      template_id: e.row.template_id,
      tier: Number(e.row.tier) || 0,
      job: Number(e.row.job) || 0,
      remaining: Number(e.row.remaining) || 0,
      world_id,
      zx: e.zx,
      zy: e.zy,
      spawn_id: e.row.spawn_id, // STABLE per-world node handle; gather_actions resolves the live positional node_index
    })
  }
  const release_gather = () => {
    const cur = context.get_state().gather_target
    if (my_gather_key && cur?.node_id === my_gather_key) context.dispatch('action/gather_target', null)
    my_gather_key = null
  }

  // ── click OR [R] on a mob group → claim_intent through the CORE door, then the EXISTING claim+create PTB ────
  // ENGAGE-GROUP GATE: a mob group a LIVE fight already claimed is un-attackable.
  // The truth is CHAIN/RPC (the nearby-fights poll folds OTHER players' + my alt's fights into visible_fights,
  // keyed by the claimed spawn_id) — NEVER local session state, which account 2 could not have known. ONE home
  // for the decision, read by both the [R] affordance arming and engage() below.
  const group_has_live_fight = (/** @type {any} */ e) =>
    e?.kind === 'mob' && group_engage_blocked(context.get_state().visible_fights, e.row?.spawn_id)

  // GHOST DROP (#480 "someone got there first" bounce): fold a group_has_live_fight fact through the SAME
  // claim_failed/ghost door the on-chain zones-108 abort already uses (fold_claim_failed → remove_row_proven,
  // spawns_zones.js) — the refusal itself IS chain truth (visible_fights), so treating it exactly like a
  // proven ghost claim is correct, not a new concept. This does NOT touch spawns_reconcile.js's deliberate
  // additive-merge (issue #367: an ordinary background zone poll must never SILENTLY despawn a visible group
  // with no explained cause) — visible_fights is already an EXPLAINED signal (world_fights_discovery plants a
  // sword marker for it elsewhere), so retiring the stale idle-group marker in favour of that honest cue is
  // not a silent vanish.
  const drop_ghost = (/** @type {any} */ e) => spawns_input({ type: 'claim_failed', key: e.key, ghost: true })

  // AMBIENT GHOST SWEEP: a group ANOTHER player claims never reaches engage()'s gate unless THIS player
  // personally presses [R] on it — so a marker nobody here ever tried to engage could sit forever. Reusing
  // the SAME visible_fights truth once per steady poll (the EXISTING 6s cadence — never a new poll, per the
  // reducer-discipline law: async facts already reaching the client re-enter as inputs) retires any
  // currently-tracked marker a live fight already claimed, whether or not it was ever pressed.
  const drop_claimed_ghosts = () => {
    let dropped = false
    for (const e of entries.values()) {
      if (e.engaged || !group_has_live_fight(e)) continue // e.engaged: OUR OWN in-flight claim owns this row
      drop_ghost(e)
      dropped = true
    }
    return dropped
  }

  const engage = async (/** @type {any} */ e) => {
    // #1010 — THE LAST SILENT RETURN on this press door. Every refusal below is loud since #861; this one still
    // swallowed a press whole — no tx, no toast, no log, the exact observable that reopened the closed row. A
    // press reaches here with no group when an armed prompt lost its entry between the arm frame and the press,
    // or when a rig click's hit-test walk resolves no `__spawn_entry`. There is nothing honest to TELL the
    // player (the group they aimed at is simply not there), so it takes refuse_engage's internal channel —
    // ring-buffered for the crash breadcrumb — plus a console line, because an armed press landing here is a
    // bug in the arming, not a player mistake.
    if (!e) {
      console.error('[world-spawns] engage press with no target group — the armed prompt lost its entry')
      return game_log('world-spawns', 'engage press refused — no_target (armed prompt lost its group)')
    }
    // #861 — THE SAME gate the pill above renders from, re-read here at press time (state can move between the
    // frame that armed the pill and the press). [world-fight mobs] rigs stay placed during a WORLD fight
    // (in_cave = cave-only), so a direct rig CLICK can reach here mid-fight — the fight_session block is what
    // stops a second claim+create tx. Cross-domain locks are ADAPTER logic (the core never reads another
    // domain's store — seams law), which is why the store reads happen HERE and the gate itself stays pure.
    const block = engage_block(engage_state())
    if (block) return refuse_engage(block)
    const character_id = context.get_state().selected_character_id
    // ENGAGE-GROUP GATE (leg ①): refuse LOCALLY here — BEFORE claim_intent / compose / submit — with the SAME
    // honest "already taken" copy the on-chain zones-108 abort surfaces, so account 2's engage of a group
    // account 1 already claimed never composes a doomed, gas-burning tx. The pre-sign liveness re-check
    // (create_world_fight) shrinks the residual poll-lag window this 6s-polled truth can't.
    if (group_has_live_fight(e)) {
      push_event_toast({ state: 'info', title: i18n.t('errors.fight_group_claimed') })
      // The refusal IS chain truth — drop the SAME marker synchronously so this exact bounce can never repeat
      // (#480: a stale marker used to survive its own refusal toast and re-fire the identical "gone" bounce
      // on every future press until an unrelated poll noticed, which — see drop_claimed_ghosts above — it
      // never reliably did on its own for a group nobody re-engaged).
      drop_ghost(e)
      sync_from_core()
      return
    }
    // THE DOOR DECIDES (D770a W2): claim_intent re-checks proximity with the core's `engage_d2` + pending state in the
    // fold. A refused intent (far click — on_up raycasts placed rigs to the despawn radius) teaches "get
    // closer" instead of firing a doomed claim; an accepted one marks the row pending (the optimistic hide as
    // data) and emits the claim_tx request THIS adapter executes.
    spawns_input({ type: 'claim_intent', key: e.key })
    if (!spawns_store.getState().pending.has(`claim:${e.key}`)) return hint_too_far(e.key)
    start_engage_timing('world')
    const request = spawns_store.getState().tx_request
    engaging = true
    set_attack_target(null) // drop the [R] pill immediately; the receipt removes the claimed group
    // OPTIMISTIC — paint the aggregate engage toast at INTENT, start the authoritative claim+create task, then
    // launch the sword/camera/mob-disappearance presentation in the same turn. The animation runs UNDER the tx
    // and is absent from the returned task, so its completion can never delay the receipt handoff or board mount.
    // Success keeps the group hidden; failure restores it + aborts the beat while the engage toast names why.
    const anchor = e.placed ? [e.cx, e.cy, e.cz] : [e.row.x, Number(get_player_pos()[1]), e.row.z]
    try {
      const submitted = as_one_toast(i18n.t('fights.action_engage'), () =>
        start_fight_engage({
          submit: async () => {
            // OPENNESS (HUD toggle): a PUBLIC fight anyone in placement may join; a GROUP fight only my current
            // party (fight.move public_fight + party_id). GROUP with no party → a truly private solo fight (the
            // on-chain join gate refuses everyone), a valid choice. One home: the spawns core atom (the claim_tx
            // request carries is_public). Land same-wallet Party membership first so a private fight carries the
            // real Party id and each owned alt's later character-specific join PTB can pass ENotParty.
            // A PUBLIC fight discards the party id (party_id stays null below), so pre-forming an owned party is a
            // wasted on-chain create tx — skip it entirely. Only a GROUP (private) fight seats the party FIRST.
            if (!request.payload.is_public) {
              const owned_party_ready = await use_party.getState().ensure_owned_party()
              if (!owned_party_ready) {
                const reason = use_party.getState().error ?? i18n.t('errors.tx_failed')
                throw new Error(reason)
              }
            }
            const { world_id, spawn_id, zx, zy, template_id, member_template_ids, is_public } = request.payload
            const party_id = is_public ? null : use_party.getState().party_id
            // The request carries spawn_id + template + the GROUP's zone (zx,zy) → the global-search claim door;
            // claim any discovered zone's group you can reach. A format-3 row also carries its member ROSTER,
            // which is what selects the member claim door inside create_world_fight (#1110) — the fold's request
            // row is that roster's one home, so nothing here decides anything. The aggregate intent toast owns
            // this whole task.
            return create_world_fight({
              world_id,
              spawn_id,
              zx,
              zy,
              mob_template_id: template_id,
              member_template_ids,
              character_id,
              is_public,
              party_id,
            })
          },
          // `fight::111` is a zero-gas preflight input, not a terminal chore: open the exact pending result through
          // its shared tx flight, feed that receipt back through start_fight_engage, then submit this claim once.
          recover_refusal: (error) => recover_fight_entry_refusal(use_dungeon, character_id, error),
          present: () => {
            sync_from_core()
            context.events.emit('fight_entry/engage', { anchor })
          },
          on_present_error: (error) =>
            report_error(error, { area: 'fight-entry', action: 'world_engage_presentation' }),
        })
      )
      const { fight_id, group } = await submitted
      const { world_id, is_public } = request.payload
      // MOUNT the tactical board on the minted fight — the create receipt carries its id. Same run-pass-less
      // session the reconnect leg enters; the shared dungeon store's refresh/sync_engine paints the board+HUD.
      if (fight_id) {
        // CARRY THE CLAIMED GROUP'S IDENTITY across the claim into the fight escrow's ONE home (the store's
        // mob_names/mob_levels — exactly what a dungeon fight gets from load_world_meta). The group card already
        // resolved this template's name/level (placement gated on it), and the Fight's group_template equals this
        // spawn's template_id (the claim PTB asserts EWrongTemplate), so the board renders the real skin+nameplate
        // from the first frame instead of the 'Mob'/hash fallback while _resolve_mob_identities backfills.
        const tpl = resolve_template(e.row.template_id)
        if (tpl?.name)
          use_dungeon.getState().note_group_identity(e.row.template_id, tpl.name, tpl.min_level, tpl.element)
        // The claimed group rides into the session as a FACT (#609): a defeat gives exactly this group back.
        enter_world_fight({ fight_id, world_id, character_id, is_public, world_group: group ?? null })
      }
      // THE CLAIM RECEIPT through the door: removes the row (tombstoned against the lagging poll), advances
      // checkpoint+hunt_zone to the group, emits the fight_entry handoff. The re-poll stays for freshness.
      void publish_claim_checkpoint_receipt(character_id, world_id, e.key, fight_id ?? null, e.row)
      sync_from_core()
      void poll()
    } catch (error) {
      cancel_engage_timing()
      /* already surfaced by the intent-time engage toast's humaniser */
      // GRACEFUL 108 (zones::ESpawnNotFound — the rendered group no longer exists in that zone: claimed by
      // another player, or a stale gRPC read served a ghost row): the honest reaction is claim_failed with
      // ghost=true — the fold DROPS the row NOW — plus ONE re-poll; never a retry of an EXECUTED failure
      // (tx-retry burn law). A non-ghost failure clears the pending row → the group returns with the world view.
      const abort = parse_move_abort(error)
      const ghost = abort?.module === 'zones' && abort.code === 108
      spawns_input({ type: 'claim_failed', key: e.key, ghost })
      sync_from_core()
      context.events.emit('fight_entry/abort') // fight_entry releases the camera + despawns its sword
      if (ghost) void poll()
    } finally {
      engaging = false
    }
  }

  /** @type {{ x:number, y:number, button:number } | null} */
  let press = null
  const on_down = (/** @type {PointerEvent} */ ev) => {
    press = { x: ev.clientX, y: ev.clientY, button: ev.button }
  }
  const on_up = (/** @type {PointerEvent} */ ev) => {
    const p = press
    press = null
    if (!p || p.button !== 0) return
    if (Math.hypot(ev.clientX - p.x, ev.clientY - p.y) > CLICK_SLOP_PX) return // a drag (camera), not a click
    const phase = use_dungeon.getState()
    if (world_fight_session(phase) || phase.in_session) return
    const cam = engine.get_camera?.()
    if (!cam) return
    const rect = canvas_rect()
    const locked = !!document.pointerLockElement // FPS aim → screen centre; free mouse → the cursor
    ndc.set(
      locked ? 0 : ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      locked ? 0 : -((ev.clientY - rect.top) / rect.height) * 2 + 1
    )
    raycaster.setFromCamera(ndc, cam)
    /** @type {any[]} */
    const roots = []
    for (const e of entries.values())
      if (e.kind === 'mob' && e.placed) for (const mem of e.members) if (mem.rig) roots.push(mem.rig.root)
    if (!roots.length) return
    const hit = raycaster.intersectObjects(roots, true)[0]
    if (!hit) return
    let o = hit.object
    while (o && !o.userData?.__spawn_entry) o = o.parent
    // ONE press door for both inputs (#1010): a hit that walked all the way up without finding an entry is a
    // MISS, and engage() is where a miss is named — dropping it here would be a second silent no-op.
    void engage(o?.userData?.__spawn_entry ?? null)
  }
  ;(canvas ?? window).addEventListener('pointerdown', /** @type {any} */ (on_down))
  window.addEventListener('pointerup', /** @type {any} */ (on_up))

  // Apply the rig budget for ONE kind (P0): evict the farthest over-budget/displaced residents, then place the
  // nearest under-budget candidates — at most PLACE_PER_FRAME per call (incremental spawn-in, no burst). place()
  // may defer on an unstreamed column (returns false) → it simply retries next frame as chunks arrive.
  const apply_budget = (
    /** @type {{key:string,d2:number}[]} */ placed,
    /** @type {{key:string,d2:number}[]} */ candidates,
    /** @type {number} */ budget
  ) => {
    if (candidates.length === 0 && placed.length <= budget) return
    const { evict, place: to_place } = select_rig_budget({
      placed,
      candidates,
      budget,
      swap_margin_sq: SWAP_MARGIN_SQ,
      place_limit: PLACE_PER_FRAME,
    })
    for (const key of evict) {
      const e = entries.get(key)
      if (e) teardown(e)
    }
    for (const key of to_place) {
      const e = entries.get(key)
      if (e && !e.placed) place(e)
    }
  }

  // House telemetry (P0 probe): one throttled line — resident groups/rigs vs budget, resident nodes vs budget,
  // JS heap (Chrome-only), total tracked entries. The no-cap crash was invisible with no counter; this makes the
  // live load LOUD so the next live session self-reports whether the cap binds and the heap holds flat.
  // Design ruling 2026-07-19 (annoying logs): this used to be a raw console.info, printing unconditionally on EVERY
  // player's console for the whole session. game_log is the house gate (core/log.js — DEV build / `?debug=1` /
  // localStorage.ares_debug only); ring-buffered+breadcrumbed either way, so a crash report still carries the
  // last telemetry line even when the console stayed silent for a real player.
  const log_telemetry = () => {
    let groups = 0
    let rigs = 0
    let nodes = 0
    for (const e of entries.values()) {
      if (!e.placed) continue
      if (e.kind === 'mob') {
        groups += 1
        for (const mem of e.members) if (mem.rig) rigs += 1
      } else nodes += 1
    }
    const heap = /** @type {any} */ (performance)?.memory?.usedJSHeapSize
    const heap_mb = heap ? `${(heap / 1048576).toFixed(0)}MB` : 'n/a'
    game_log(
      'world-spawns',
      `telemetry: groups=${groups}/${GROUP_BUDGET} rigs=${rigs} nodes=${nodes}/${NODE_BUDGET} ` +
        `heap=${heap_mb} entries=${entries.size}`
    )
  }

  // [heaptrace] ONE-SHOT DEV LEAK PROBE (P0 OOM hunt 2026-07-12; gated ?heaptrace=1 → zero-cost off, delete with
  // the fix). The house telemetry above tracks only PLACED spawn entries — the OOM climbs while those stay flat,
  // so the leak is an UNTRACKED population. `usedJSHeapSize` is JS-side, so this counts the JS retainers the heap
  // sees: the whole render scene-graph (the UNION of every mounted subsystem — fight board, VFX, remotes, auras,
  // rigs), the unique geometry/material JS wrappers under it, the game EventEmitter's listener population (the
  // torn-listener class), live DOM nodes (detached-but-referenced plates), and the growable store arrays. The
  // counter that climbs monotonically WITH the heap names the leak.
  const log_heaptrace = () => {
    /** @type {Record<string, number>} */ const by_type = {}
    const geos = new Set()
    const mats = new Set()
    let scene_nodes = 0
    const scene = engine.get_scene?.()
    if (scene)
      scene.traverse((/** @type {any} */ o) => {
        scene_nodes += 1
        by_type[o.type] = (by_type[o.type] ?? 0) + 1
        if (o.geometry?.uuid) geos.add(o.geometry.uuid)
        const m = o.material
        if (Array.isArray(m)) for (const mm of m) mm?.uuid && mats.add(mm.uuid)
        else if (m?.uuid) mats.add(m.uuid)
      })
    // game EventEmitter listener census (setMaxListeners(0) means a leak here never warns)
    const ev = /** @type {any} */ (context).events
    let listeners = 0
    const names = ev?.eventNames?.() ?? []
    for (const n of names) listeners += ev.listenerCount?.(n) ?? 0
    const su = ev?.listenerCount?.('STATE_UPDATED') ?? 0
    const gs = /** @type {any} */ (context.get_state?.() ?? {})
    const { fight } = gs
    const stats = engine.get_stats?.() ?? {}
    const top = Object.entries(by_type)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ')
    const heap = /** @type {any} */ (performance)?.memory?.usedJSHeapSize
    console.info(
      `[heaptrace] heap=${heap ? (heap / 1048576).toFixed(0) : '?'}MB | scene=${scene_nodes} geo=${geos.size} mat=${mats.size} ` +
        `| dom=${document.getElementsByTagName('*').length} layer=${layer.childElementCount} ` +
        `| listeners=${listeners}(${names.length}ev,su=${su}) ` +
        `| fighters=${fight?.fighters?.size ?? 0} msgs=${gs.message_history?.length ?? 0} ` +
        `chars=${gs.sui?.characters?.length ?? 0} items=${gs.sui?.items?.length ?? 0} toks=${gs.sui?.tokens?.length ?? 0} ` +
        `| chunks=${stats.resident_chunks ?? '?'} far=${stats.far_section_count ?? '?'} entries=${entries.size} ` +
        `| top=[${top}]`
    )
  }

  // ── per-frame: range-gate placement, roam + tick rigs, project plates, pulse crystals, arm the prompts ────────
  const frame_body = (/** @type {number} */ now) => {
    raf = requestAnimationFrame(frame)
    const dt = Math.min(0.1, (now - last_t) / 1000)
    last_t = now
    const cam = engine.get_camera?.()
    const p = get_player_pos()
    const px = Number(p[0])
    const pz = Number(p[2])
    // The suspend signal is the CAVE plane (`in_session`), not `dungeon_id`: a WORLD fight aliases its id there
    // but keeps the overworld alive. Its rigs stay resident; the scoped gate below veils their visuals/actions.
    const in_cave = use_dungeon.getState().in_session
    const world_fight = world_fight_active(fight_store.getState())
    const rect = canvas_rect()
    const t = now / 1000
    gather.tick(t) // one global pulse of the shared apex-node glow

    // RENDER CONTRACT (D770a W2): the renderer only REPORTS where the body is — the core's fold owns the
    // [G] hysteresis + [R] proximity arming off the reported group homes (a standing-still frame is a no-op commit).
    spawns_input({ type: 'player_pos', x: px, z: pz })

    // The scoped WORLD-fight veil covers mob rigs, resource meshes and chips while leaving them resident, then
    // restores them without pop-in. Edge detection keeps the mask to one pass per transition.
    if (world_fight !== fight_veiled) {
      fight_veiled = world_fight
      apply_veil(entries.values(), fight_veiled)
    }

    // RIG-BUDGET views — resident (in-range) vs unplaced-in-load-range, per kind. Built every frame (suspended in
    // a cave); the arbiter after the loop caps each set nearest-first + incrementally. Placement flows ONLY there.
    const placing = !in_cave
    mob_placed.length = 0
    mob_cand.length = 0
    res_placed.length = 0
    res_cand.length = 0

    for (const e of entries.values()) {
      const ax = e.placed ? e.cx : e.row.x
      const az = e.placed ? e.cz : e.row.z
      const d2 = (ax - px) ** 2 + (az - pz) ** 2
      if (e.placed && (in_cave || d2 > DESPAWN_RADIUS_M * DESPAWN_RADIUS_M)) {
        teardown(e)
        continue
      }
      if (placing) {
        e.d2 = d2
        if (e.placed) (e.kind === 'mob' ? mob_placed : res_placed).push(e)
        else if (d2 <= LOAD_RADIUS_M * LOAD_RADIUS_M) (e.kind === 'mob' ? mob_cand : res_cand).push(e)
      }
      if (!e.placed) continue // placement is arbitrated by the rig budget after the loop (capped, nearest-first)
      if (e.engaged) continue // fight-entry optimistic beat owns this group (hidden; no roam/chip/targeting)
      if (fight_veiled) continue // in-fight veil owns EVERY population's visuals (no roam/sway/chip re-stomps)

      if (e.kind === 'mob') {
        // per-member wander (idle/walk state machine + ground-snap + rig transform + anim blend), then anchor the
        // card on the live CENTROID of the members so it stays glued to the visible cluster as they amble.
        let sx = 0
        let sy = 0
        let sz = 0
        let max_h = 0 // [reference-faithful-mob-sizes 2026-07-13] tallest MEASURED member (mem.rig.h) — see below
        for (const mem of e.members) {
          rigs.roam_member(mem, dt)
          sx += mem.mx
          sy += mem.cy
          sz += mem.mz
          if (mem.rig && mem.rig.h > max_h) max_h = mem.rig.h
        }
        const cnt = e.members.length
        // [reference-faithful-mob-sizes 2026-07-13] the chip used to float at a CONSTANT MOB_TARGET_H+0.35 — with
        // every mob now rendered at its own intrinsic (source-authored) height, a flat constant would float a
        // silkling's tag a body-length above its head while a bear's sinks into its own back. Anchor at the
        // group's tallest MEASURED member's head + the same 0.35 margin instead (mirrors cave_mobs.js's tag
        // lift exactly); max_h is 0 before any rig has loaded, so the 1.4 floor covers that window.
        const lift = Math.max(1.4, max_h + 0.35)
        draw_chip(e, cam, rect, cnt ? sx / cnt : e.cx, cnt ? sy / cnt : e.cy, cnt ? sz / cnt : e.cz, lift)
        if (e.row.spawned_at_ms) update_group_aging(e.chip, Number(e.row.spawned_at_ms))
      } else {
        // sway the cluster (family-aware; ore stays static) + re-fold depletion when `remaining` changes.
        gather.sway(e, t)
        if (e.row.remaining !== e.applied_remaining) gather.apply_state(e)
        draw_chip(e, cam, rect, e.cx, e.cy, e.cz, (e.visual?.h ?? 1.2) + 0.4)
      }
    }

    // [G]/[R] TARGETS ARE CORE DECISIONS (D770a W2 — hysteresis + proximity arming live in the fold, keyed
    // exactly like `entries`): this adapter only routes them into the existing PromptStack / gather_target
    // plumbing, gated by the cross-domain fight/cave locks IT owns (the core never reads another store).
    const core = spawns_store.getState()
    const target_res =
      !in_cave && !world_fight && core.gather_target_key ? (entries.get(core.gather_target_key) ?? null) : null

    // arm/clear the [G] gather prompt — only for targets WE own (never stomp a JobsDrawer selection).
    // [world-fight mobs] fight-gated like [R] below: rigs stay VISIBLE during a world fight, but no gather
    // prompt arms mid-fight (a [G] press firing a gather tx from inside a fight would be a second tx door).
    const cur = context.get_state().gather_target
    const mine = my_gather_key != null && cur?.node_id === my_gather_key
    if (target_res) {
      const key = `${target_res.zx}:${target_res.zy}:${target_res.row.spawn_id}`
      if ((cur == null || mine) && key !== my_gather_key) set_gather(target_res)
    } else if (mine) {
      release_gather()
    }

    // arm/clear the [R] ATTACK prompt + card highlight off the core's WIDER visibility ring; `attack_engageable`
    // decides gold-vs-visible (PromptStack owns key+click). The core owns both flags — this only routes them.
    const attack_armed =
      !in_cave && !engaging && !world_fight && core.attack_target_key
        ? (entries.get(core.attack_target_key) ?? null)
        : null
    // a group a LIVE fight already claimed arms VISIBLE, never gold-claimable — the honest "taken" cue paired with
    // the observer sword world_fights_discovery already plants on it; a press still routes to engage()'s refuse.
    set_attack_target(attack_armed, !!(attack_armed && core.attack_engageable) && !group_has_live_fight(attack_armed))

    // RIG BUDGET (P0): cap resident rigs nearest-first, INCREMENTALLY (≤ PLACE_PER_FRAME each). Placement flows
    // ONLY here (never inline) so the cap + anti-burst hold from the very first frame in the world.
    if (placing) {
      // veiled: no NEW rigs of EITHER kind (a mob rig OR a gatherable node born mid-fight would bypass the
      // edge-detected flip-pass veil and mount visible above the board — bug 07-19); all resume on unveil.
      if (!fight_veiled) {
        apply_budget(mob_placed, mob_cand, GROUP_BUDGET)
        apply_budget(res_placed, res_cand, NODE_BUDGET)
      }
    }
    if (now - last_telemetry >= TELEMETRY_MS) {
      last_telemetry = now
      log_telemetry()
    }
    if (HEAPTRACE && now - last_heaptrace >= HEAPTRACE_MS) {
      last_heaptrace = now
      log_heaptrace()
    }
    // Route return exposes the layer only after this frame refreshed every projected card. Because the layer
    // is body-appended, showing it before the first frame would briefly revive the stale pre-route pixels.
    if (resume_projection_pending) {
      resume_projection_pending = false
      sync_layer_hidden()
    }
  }

  const frame = instrument_cpu_callback('scene', frame_body)

  // Project the card at its (centroid) head anchor through the ONE shared plate projector — world-locked (bob
  // cancelled at source) + behind-camera culled (nameplate_occlusion.js). This owns only the range-fade band +
  // occlusion opacity; position + visibility live in the shared home so all three plate paths behave identically.
  const draw_chip = (/** @type {any} */ e, /** @type {any} */ cam, /** @type {any} */ rect, x, y, z, lift) => {
    if (!e.chip || !cam) return
    const head_y = y + lift
    const dist = Math.hypot(x - cam.position.x, head_y - cam.position.y, z - cam.position.z)
    const dfade = Math.max(0, Math.min(1, (NAMETAG_CULL_M - dist) / (NAMETAG_CULL_M - NAMETAG_FADE_M)))
    const px = dfade > 0 ? project_plate(cam, rect, x, head_y, z, projected_plate) : null
    e.chip.style.display = px ? 'block' : 'none'
    if (!px) return
    e.chip.style.left = `${px.left}px`
    e.chip.style.top = `${px.top}px`
    const occ = plate_occluded(engine, x, head_y, z, cam) ? OCCLUDED_OPACITY : 1
    e.chip.style.opacity = `${(occ * dfade).toFixed(3)}`
  }

  raf = requestAnimationFrame(frame)
  void poll()
  const timer = setInterval(poll, POLL_MS)
  // OPTIMISTIC render on search-cert (see on_zone_searched): the /v1 poll above is the steady-state reconciler;
  // this collapses the cert→mobs-visible gap from a 6s poll tick + indexer/cache lag to one chain-direct read.
  context.events.on('discovery/zone_searched', on_zone_searched)

  return {
    // CLEAN FOOTAGE parity (ambient/remotes): hide every plate for cinematic recording (rigs stay in scene).
    set_hidden(h) {
      cinematic_hidden = !!h
      sync_layer_hidden()
    },
    // RENDER-PAUSE (pauses the webgpu stuff off the game-world route): this loop's own rAF is
    // independent of the engine's frame_loop, so engine.stop() alone never stopped spawn range-gating/DOM-
    // plate projection while browsing a meta page. Cancel/re-arm in lockstep (embed_voxel.js's set_paused).
    // The setInterval poll (chain reads) is left running — cheap, and a route-return should show fresh state.
    set_paused(p) {
      const next_paused = !!p
      if (next_paused !== world_paused) {
        world_paused = next_paused
        resume_projection_pending = !world_paused
      }
      sync_layer_hidden()
      if (world_paused) {
        if (raf) cancelAnimationFrame(raf)
        raf = 0
      } else if (!raf) {
        last_t = performance.now()
        raf = requestAnimationFrame(frame)
      }
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      clearInterval(timer)
      unsubscribe_zones()
      context.events.off('discovery/zone_searched', on_zone_searched)
      ;(canvas ?? window).removeEventListener('pointerdown', /** @type {any} */ (on_down))
      window.removeEventListener('pointerup', /** @type {any} */ (on_up))
      release_gather()
      set_attack_target(null)
      for (const e of entries.values()) teardown(e)
      entries.clear()
      // no minimap-store clear: the map projects the ONE spawns store, which resets on world unbind (poll's
      // world_bound:null) / the session-gate ferry — no render-owned copy to wipe.
      layer.remove()
    },
  }
}
