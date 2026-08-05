// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SPAWNS + ZONES — the D770a W2 core: where am I PROVEN to be and what exists/is claimable there. ONE atom
// behind ONE `input(msg, now)` door; every fact advances on the same clock — tx RECEIPTS (a search advances
// the checkpoint AND discovers the zone AND seeds rows; a claim advances the checkpoint AND removes the
// group) reconciled with the versioned 6s /v1 snapshot, order-independently: a poll never regresses a
// receipt-proven fact (grace-shielded adds, tombstoned removals), and a poll that agrees converges as a
// no-op. The two render-contract violations the census convicted move IN here: the gather-target HYSTERESIS
// and the [G]/[R] PROXIMITY ARMING are fold state now — the renderer reports `player_pos` and reads targets;
// it decides nothing. The pure machinery (rules, ingest, reconcile folds) lives in spawns_reconcile.js.
//
// Effects live at the edges as exported subscriptions: tx intents come in through the door, the core emits
// `tx_request` rows (search_tx / claim_tx / gather_tx) an adapter executes, and receipts/failures come back
// through the door as typed inputs. Presentation is DATA: the beat stream ({kind, duration, payload}) carries
// the search progress sweep and the reveal chime/banner/FOV-pulse the frontend previously inlined.

import { createStore } from 'zustand/vanilla'
import { zone_of, zone_of_world, world_offsets, DEFAULT_ZONE_SIZE, chain_to_world } from '@aresrpg/sdk/coords'
import { gather_resource_for } from '@aresrpg/sdk/jobs'

import { OPENNESS_PUBLIC, OPENNESS_GROUP } from './openness.js'
import { resolve_boot_spawn, normalize_chain_anchor } from './checkpoint.js'
import {
  PROXIMITY_M,
  SEARCH_PROGRESS_MS,
  zone_searchable,
  engage_d2,
  zone_key,
  zone_row_of,
  parse_key,
  blank_world,
  with_beats,
  with_request,
  remove_row_proven,
  clear_pending,
  retarget,
  fold_snapshot,
  fold_zone_rows,
} from './spawns_reconcile.js'

/** @typedef {import('./spawns_reconcile.js').SpawnBeat} SpawnBeat */
/** @typedef {import('./spawns_reconcile.js').SpawnTxRequest} SpawnTxRequest */
/**
 * @typedef {ReturnType<typeof blank_world> & {
 *   openness: 'public'|'group',
 *   beats: SpawnBeat[], beat_seq: number,
 *   tx_request: SpawnTxRequest|null, req_seq: number,
 *   fight_entry: { seq: number, fight_id: string }|null,
 *   input: (input: any, now?: number) => void,
 * }} SpawnsState
 */

// ── the per-input folds (composed inside the one door) ───────────────────────────────────────────────────────

const fold_world_doc = (state, { doc }) => {
  if (!doc) return state
  const off = world_offsets(doc)
  const zone_size = Number(doc.zone_size ?? 0) || DEFAULT_ZONE_SIZE
  const zone_ttl_ms = Number(doc.zone_ttl_ms ?? 0) || null
  const same =
    state.world_frame_ready &&
    state.zone_size === zone_size &&
    state.offset_x === off.x &&
    state.offset_z === off.z &&
    state.zone_ttl_ms === zone_ttl_ms
  return same ? state : { ...state, world_frame_ready: true, zone_size, offset_x: off.x, offset_z: off.z, zone_ttl_ms }
}

// chain-space {x,z}. 'read' (chain-direct) is truth and applies; 'indexed' (/v1 doc position, laggy) only
// SEEDS when this session holds no better fact — never clobbers a live receipt/read value.
// The stored checkpoint is the whole CHAIN ANCHOR, not a bare point: the travel budget the boot arbiter
// judges a local pose against (#2231) is `time_ms` + the world's `speed_budget` + the mount half, all read
// off the chain in the same breath as the position (world-shell/world_checkpoint.js). This door only moves
// the bag into world space — `normalize_chain_anchor` (checkpoint.js) is the one home for reading its fields.
const fold_checkpoint_resolved = (state, input) => {
  if (input.world_id && state.world_id && input.world_id !== state.world_id) return state
  if (!Number.isFinite(Number(input.x)) || !Number.isFinite(Number(input.z))) return state
  if (input.source === 'indexed' && (state.checkpoint || state.hunt_zone)) return state
  const cell = zone_of(Number(input.x), Number(input.z), state.zone_size)
  const anchor = input.world_position ?? input
  const checkpoint =
    input.source === 'indexed'
      ? state.checkpoint // an indexed doc position seeds the hunt zone only (not a boot-grade position)
      : normalize_chain_anchor({
          ...anchor,
          x: chain_to_world(Number(input.x), state.offset_x),
          z: chain_to_world(Number(input.z), state.offset_z),
        })
  return { ...state, checkpoint, hunt_zone: cell ? { zx: cell.zx, zy: cell.zy } : state.hunt_zone }
}

const fold_search_intent = (state, input, now) => {
  if (!state.world_id || !Number.isFinite(Number(input.x)) || !Number.isFinite(Number(input.z))) return state
  const cell = zone_of_world(Number(input.x), Number(input.z), state.zone_size, state.offset_x, state.offset_z)
  if (!cell) return state
  const row = zone_row_of(state.zones, cell.zx, cell.zy)
  if (!zone_searchable(row, state.zone_ttl_ms, now)) return state // EZoneFresh mirror — never a doomed tx
  const subject = `search:${cell.zx}:${cell.zy}`
  if (state.pending.has(subject)) return state // single-flight as data — a press in flight never re-fires
  const pending = new Map(state.pending)
  pending.set(subject, { kind: 'search', at: now })
  return with_beats(
    with_request({ ...state, pending }, 'search', {
      world_id: state.world_id,
      x: Number(input.x),
      z: Number(input.z),
      zx: cell.zx,
      zy: cell.zy,
    }),
    now,
    [{ kind: 'search_progress', duration: SEARCH_PROGRESS_MS, payload: { zx: cell.zx, zy: cell.zy } }]
  )
}

// THE SEARCH RECEIPT — one clock: the SAME input advances the checkpoint (the proven standing position the
// tx was fired with, SIGNED WORLD), discovers/refreshes the zone (receipt-proven, so a lagging snapshot
// cannot un-discover it inside the grace), re-keys the hunt zone, resolves the pending press, and emits the
// reveal beats. Rows ride the paired chain-direct `zone_rows` input (same receipt clock).
const fold_zone_searched = (state, input, now) => {
  const zx = Number(input.zx)
  const zy = Number(input.zy)
  if (!Number.isFinite(zx) || !Number.isFinite(zy)) return state
  const zk = zone_key(zx, zy)
  const prev = state.zones.get(zk)
  // A known zone can only pass search_internal after its TTL, and that on-chain path writes a fresh seed +
  // resets both consumption bitmaps. Make that one-zone generation swap explicit on the RECEIPT beat; no
  // search result can infer deletion from an omitted OTHER zone.
  const rerolled = prev?.discovered_at_ms != null
  const zones = new Map(state.zones)
  zones.set(zk, {
    discovered_at_ms: now, // provisional stamp; the snapshot adopts the indexer's real stamp on catch-up
    proven_at: now,
    rows: rerolled ? new Map() : (prev?.rows ?? new Map()),
    row_proven: rerolled ? new Map() : (prev?.row_proven ?? new Map()),
  })
  const tombstones = rerolled ? new Map(state.tombstones) : state.tombstones
  const group_homes = rerolled ? new Map(state.group_homes) : state.group_homes
  if (rerolled) {
    for (const key of tombstones.keys()) if (key.startsWith(`${zk}:`)) tombstones.delete(key)
    for (const key of group_homes.keys()) if (key.startsWith(`${zk}:`)) group_homes.delete(key)
  }
  const x = Number(input.x)
  const z = Number(input.z)
  const checkpoint = Number.isFinite(x) && Number.isFinite(z) ? { x, z } : state.checkpoint
  const reconciled = { ...state, zones, tombstones, group_homes, checkpoint, hunt_zone: { zx, zy } }
  const next = clear_pending(rerolled ? retarget(reconciled) : reconciled, `search:${zx}:${zy}`)
  return with_beats(next, now, [
    { kind: 'reveal_chime' },
    { kind: 'reveal_banner', payload: input.found ?? null },
    { kind: 'fov_pulse' },
  ])
}

const fold_claim_intent = (state, input, now) => {
  const { key } = input
  const k = parse_key(key)
  const row = state.zones.get(k.zone)?.rows.get(k.rk)
  if (!row || row.kind !== 'mob' || state.pending.has(`claim:${key}`)) return state
  // ONE ENGAGE ORIGIN (#1318): the door measures with `engage_d2` — the same rule the [R] pill's
  // `attack_engageable` flag reads, so the gold ring and the press door can never disagree about legality.
  // (negated form on purpose: a NaN distance from a garbage position must REFUSE, never fall through)
  if (!state.player || !(engage_d2(state, key, row, state.player) <= PROXIMITY_M * PROXIMITY_M)) return state
  const pending = new Map(state.pending)
  pending.set(`claim:${key}`, { kind: 'claim', at: now })
  return retarget(
    with_request({ ...state, pending }, 'claim', {
      world_id: state.world_id,
      key,
      spawn_id: row.spawn_id,
      zx: k.zx,
      zy: k.zy,
      template_id: row.template_id,
      // FORMAT 3 (#1110) — the pack's SEATED roster, exactly as the zone derivation served it (`derive_zone`
      // row `.members`, already trimmed to `size` the way the claim door trims it). A format-1/2 row has no
      // roster and gets an empty list: PRESENCE is the format signal the executor derives its claim door from,
      // never a flag. This request row is the roster's one home on the way to the chain.
      member_template_ids: Array.isArray(row.members) ? row.members : [],
      is_public: state.openness === OPENNESS_PUBLIC,
    })
  )
}

// THE CLAIM RECEIPT — the same clock again: the group is GONE (receipt-proven removal, tombstoned against
// lagging polls), the checkpoint advances to the group's position (the door travel-verified the character
// to it), the hunt zone follows, and the fight handoff row is emitted — the exact seam the fight core's
// solo-lifecycle scenario picks up.
const fold_claim_receipt = (state, input, now) => {
  const k = parse_key(input.key)
  const row = state.zones.get(k.zone)?.rows.get(k.rk)
  const removed = remove_row_proven(clear_pending(state, `claim:${input.key}`), input.key, now)
  const checkpoint = row ? { x: row.x, z: row.z } : removed.checkpoint
  const hunt_zone = Number.isFinite(k.zx) && Number.isFinite(k.zy) ? { zx: k.zx, zy: k.zy } : removed.hunt_zone
  const fight_id = input.fight_id ?? null
  return retarget({
    ...removed,
    checkpoint,
    hunt_zone,
    fight_entry: fight_id ? { seq: (state.fight_entry?.seq ?? 0) + 1, fight_id } : removed.fight_entry,
  })
}

const fold_gather_intent = (state, _input, now) => {
  const key = state.gather_target_key
  if (!key) return state
  const k = parse_key(key)
  const row = state.zones.get(k.zone)?.rows.get(k.rk)
  if (!row || row.kind !== 'resource' || state.pending.has(`gather:${key}`)) return state
  const pending = new Map(state.pending)
  pending.set(`gather:${key}`, { kind: 'gather', at: now })
  return with_request({ ...state, pending }, 'gather', {
    world_id: state.world_id,
    key,
    spawn_id: row.spawn_id,
    zx: k.zx,
    zy: k.zy,
    template_id: row.template_id,
    job: Number(row.job) || 0,
    tier: Number(row.tier) || 0,
  })
}

// THE GATHER RECEIPT — one charge consumed on-chain: decrement `remaining` (receipt-shielded so the lagging
// poll cannot bounce it back up); the LAST charge removes the node (tombstoned removal).
const fold_gather_receipt = (state, input, now) => {
  const k = parse_key(input.key)
  const zone = state.zones.get(k.zone)
  const row = zone?.rows.get(k.rk)
  const cleared = clear_pending(state, `gather:${input.key}`)
  if (!zone || !row) return cleared
  const remaining = Math.max(0, (Number(row.remaining) || 0) - 1)
  if (remaining === 0) return retarget(remove_row_proven(cleared, input.key, now))
  const rows = new Map(zone.rows)
  rows.set(k.rk, { ...row, remaining })
  const row_proven = new Map(zone.row_proven)
  row_proven.set(k.rk, now) // shield the decremented fact from the pre-receipt snapshot
  const zones = new Map(cleared.zones)
  zones.set(k.zone, { ...zone, rows, row_proven })
  return { ...cleared, zones }
}

// A MobTemplate's roster facts, resolved once per template by the effect edge (the async chain read) and fed
// back through the door as data — so the map/hover NAME + level band is a pure projection of the ONE store,
// never a second per-surface read. The name is already display-overridden at the edge; the core just stores it.
const fold_template_resolved = (state, input) => {
  const id = input.template_id
  if (!id || state.templates.has(id)) return state // one home per template; the first resolve wins
  const templates = new Map(state.templates)
  templates.set(id, {
    name: input.name ?? null,
    min_level: Number(input.min_level) || 0,
    max_level: Number(input.max_level ?? input.min_level) || 0,
    element: input.element ?? 255,
  })
  return { ...state, templates }
}

const fold_player_pos = (state, input) => {
  const x = Number(input.x)
  const z = Number(input.z)
  if (!Number.isFinite(x) || !Number.isFinite(z)) return state
  if (state.player && state.player.x === x && state.player.z === z) return state
  return retarget({ ...state, player: { x, z } })
}

// A PLACED mob group's stable geometry (world space): `home` is the exact terrain-resolved seat used by BOTH the
// [R] prompt and claim legality. The renderer's member list signals placement/teardown, but individual roaming
// members never widen the claim ring. The core never reaches out for either fact.
const fold_member_positions = (state, input) => {
  const { key } = input
  if (!key) return state
  const list = Array.isArray(input.members) ? input.members : []
  if (list.length === 0) {
    if (!state.group_homes.has(key)) return state
    const group_homes = new Map(state.group_homes)
    group_homes.delete(key)
    return retarget({ ...state, group_homes })
  }
  const home_x = Number(input.home?.x)
  const home_z = Number(input.home?.z)
  if (!Number.isFinite(home_x) || !Number.isFinite(home_z)) return state
  const group_homes = new Map(state.group_homes)
  group_homes.set(key, { x: home_x, z: home_z })
  return retarget({ ...state, group_homes })
}

// ── the door ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * THE pure spawns/zones fold. Time is an input (`now`); the fold never reads a clock, never performs an
 * effect, and returns the SAME state reference when an input changes nothing.
 * @param {SpawnsState} state
 * @param {any} input
 * @param {number} now
 * @returns {SpawnsState}
 */
export function reduce_spawns(state, input, now) {
  switch (input.type) {
    case 'world_bound': {
      const world_id = input.world_id ?? null
      // a world change is a RESET input: zone facts never survive a rebind; the openness pref does.
      return world_id === state.world_id ? state : { ...state, ...blank_world(), world_id }
    }
    case 'world_doc':
      return fold_world_doc(state, input)
    case 'checkpoint_resolved':
      return fold_checkpoint_resolved(state, input)
    case 'zones_rows_snapshot':
      return fold_snapshot(state, input, now)
    case 'zone_rows':
      return fold_zone_rows(state, input, now)
    case 'search_intent':
      return fold_search_intent(state, input, now)
    case 'search_failed':
      return clear_pending(state, `search:${input.zx}:${input.zy}`)
    case 'zone_searched':
      return fold_zone_searched(state, input, now)
    case 'claim_intent':
      return fold_claim_intent(state, input, now)
    case 'claim_receipt':
      return fold_claim_receipt(state, input, now)
    case 'claim_failed': {
      const cleared = clear_pending(state, `claim:${input.key}`)
      // zones::ESpawnNotFound (108): the rendered group no longer exists on-chain — drop the ghost NOW.
      return retarget(input.ghost ? remove_row_proven(cleared, input.key, now) : cleared)
    }
    case 'gather_intent':
      return fold_gather_intent(state, input, now)
    case 'gather_receipt':
      return fold_gather_receipt(state, input, now)
    case 'gather_failed':
      return clear_pending(state, `gather:${input.key}`)
    case 'player_pos':
      return fold_player_pos(state, input)
    case 'member_positions':
      return fold_member_positions(state, input)
    case 'template_resolved':
      return fold_template_resolved(state, input)
    case 'openness_set': {
      const openness = input.value === OPENNESS_GROUP ? OPENNESS_GROUP : OPENNESS_PUBLIC
      return openness === state.openness ? state : { ...state, openness }
    }
    default:
      return state
  }
}

// ── store + subscriptions (the package exports subscriptions, never performs effects) ────────────────────────

const make_spawns_input =
  (set, get) =>
  (input, now = Date.now()) => {
    const state = get()
    const next = reduce_spawns(state, input, now)
    if (next !== state) set(next, true)
  }

/** @returns {import('zustand/vanilla').StoreApi<SpawnsState>} */
export function create_spawns_store() {
  return createStore((set, get) => ({
    ...blank_world(),
    openness: OPENNESS_PUBLIC,
    beats: [],
    beat_seq: 0,
    tx_request: null,
    req_seq: 0,
    fight_entry: null,
    input: make_spawns_input(set, get),
  }))
}

/**
 * Effect edge: a newly settled non-null world binding requests its entry zone rows immediately. The executor
 * returns every async result through this store's `input` door; this subscription only observes the delta.
 */
export function subscribe_world_rows_request(store, on_request) {
  return store.subscribe((state, prev) => {
    if (state.world_id && state.world_id !== prev.world_id) on_request(state.world_id)
  })
}

/** Effect edge: one call per NEW tx request row (search_tx / claim_tx / gather_tx). */
export function subscribe_spawn_tx(store, on_request) {
  return store.subscribe((state, prev) => {
    if (state.tx_request && state.tx_request !== prev.tx_request) on_request(state.tx_request)
  })
}

/** Effect edge: one call per NEW presentation beat, in order. */
export function subscribe_spawn_beats(store, on_beat) {
  let last = store.getState().beat_seq
  return store.subscribe((state) => {
    if (state.beat_seq === last) return
    for (const b of state.beats) if (b.seq > last) on_beat(b)
    last = state.beat_seq
  })
}

/** Effect edge: the claim → fight handoff (the exact seam the fight core's solo scenario picks up). */
export function subscribe_fight_entry(store, on_entry) {
  return store.subscribe((state, prev) => {
    if (state.fight_entry && state.fight_entry !== prev.fight_entry) on_entry(state.fight_entry)
  })
}

// ── projections (renderer-complete data — consumers compute nothing) ─────────────────────────────────────────

/** Flat spawn rows for the rig renderer: `{key, zx, zy, kind, row, pending}` — a pending claim marks the row
 *  (the renderer hides it: the optimistic fight-entry beat as data; a failed claim clears it back). */
export function spawn_rows(state) {
  const out = []
  for (const [zk, zone] of state.zones) {
    const [zx, zy] = zk.split(':').map(Number)
    for (const [rk, row] of zone.rows) {
      const key = `${zk}:${rk}`
      out.push({ key, zx, zy, kind: row.kind, row, pending: state.pending.get(`claim:${key}`)?.kind ?? null })
    }
  }
  return out
}

/**
 * The canonical zone rectangles intersecting a world-space map viewport. Zone ids stay in CHAIN grid space
 * (`zx:zy`), while bounds are translated once into signed WORLD space for renderers. This is the one
 * zone-grid projection shared by map surfaces: callers choose a viewport, never repeat zone-size/offset math.
 * Max edges are exclusive, matching the chain's `pos / zone_size` ownership rule.
 * @param {Pick<SpawnsState, 'zone_size'|'offset_x'|'offset_z'>} state
 * @param {{ min_x:number, min_z:number, max_x:number, max_z:number }} viewport
 * @returns {{ id:string, zx:number, zy:number,
 *   bounds:{ min_x:number, min_z:number, max_x:number, max_z:number } }[]}
 */
export function zone_map_rects(state, viewport) {
  const zone_size = Number(state?.zone_size)
  const offset_x = Number(state?.offset_x)
  const offset_z = Number(state?.offset_z)
  const min_x = Number(viewport?.min_x)
  const min_z = Number(viewport?.min_z)
  const max_x = Number(viewport?.max_x)
  const max_z = Number(viewport?.max_z)
  if (
    !Number.isFinite(zone_size) ||
    zone_size <= 0 ||
    ![offset_x, offset_z, min_x, min_z, max_x, max_z].every(Number.isFinite) ||
    min_x >= max_x ||
    min_z >= max_z
  )
    return []

  const axis_cells = (low, high, offset) => {
    const first = Math.max(0, Math.floor((low + offset) / zone_size))
    const last = Math.ceil((high + offset) / zone_size) - 1
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index)
  }
  const x_cells = axis_cells(min_x, max_x, offset_x)
  const z_cells = axis_cells(min_z, max_z, offset_z)
  return z_cells.flatMap((zy) =>
    x_cells.map((zx) => ({
      id: zone_key(zx, zy),
      zx,
      zy,
      bounds: {
        min_x: zx * zone_size - offset_x,
        min_z: zy * zone_size - offset_z,
        max_x: (zx + 1) * zone_size - offset_x,
        max_z: (zy + 1) * zone_size - offset_z,
      },
    }))
  )
}

// A resource's (job, tier) → its gatherable display NAME, via @aresrpg/sdk/jobs' gather_resource_for — the ONE
// home shared with the 3-D node prop (spawn_rigs resource_visual) and the compass — the pip/marker label, never
// a charge counter.
const resource_marker_name = (job, tier) => gather_resource_for(job, tier)?.name ?? null

/** Flat OVERWORLD MARKERS — the ONE projection the big map, the minimap, AND the compass all plot from (killing
 *  the render-published `use_world_spawns` copy and the compass's private `zone_rows_v1` fetch). World-space x/z
 *  (offset already applied at ingest), the mob roster name+level band from the folded template facts, the
 *  resource name pure from (job,tier). Consumers compute nothing — they filter (compass: to the standing cell). */
export function spawn_markers(state) {
  const out = []
  for (const [zk, zone] of state.zones) {
    const [zx, zy] = zk.split(':').map(Number)
    for (const [rk, row] of zone.rows) {
      const key = `${zk}:${rk}`
      /** @type {any} */
      const m = {
        key,
        kind: row.kind,
        x: Number(row.x),
        z: Number(row.z),
        spawn_id: row.spawn_id,
        zx,
        zy,
        template_id: row.template_id,
        job: Number(row.job) || 0,
        tier: Number(row.tier) || 0,
        size: Number(row.size) || 0,
        pending: state.pending.get(`claim:${key}`)?.kind ?? null,
      }
      if (row.kind === 'mob') {
        const tpl = state.templates.get(row.template_id)
        if (tpl) {
          m.name = tpl.name
          m.level_min = tpl.min_level
          m.level_max = tpl.max_level
        }
      } else m.name = resource_marker_name(row.job, row.tier)
      out.push(m)
    }
  }
  return out
}

/** ENGAGE ELIGIBILITY — the mob groups a player could fight: present in the store and not already claimed
 *  (a pending-claim row is mid-optimistic-hide; a receipt/ghost has already removed a gone one). The [R]
 *  proximity arming (attack_target) rides on top; this is the presence set every surface agrees on. */
export function engage_candidates(state) {
  return spawn_rows(state).filter((r) => r.kind === 'mob' && r.pending !== 'claim')
}

/** The armed [G] target's full row (or null) — the hysteresis decision, already made. */
export function gather_target(state) {
  if (!state.gather_target_key) return null
  const k = parse_key(state.gather_target_key)
  const row = state.zones.get(k.zone)?.rows.get(k.rk)
  return row ? { key: state.gather_target_key, zx: k.zx, zy: k.zy, row } : null
}

/** The armed [R] target's full row (or null) — nearest claimable group within proximity. */
export function attack_target(state) {
  if (!state.attack_target_key) return null
  const k = parse_key(state.attack_target_key)
  const row = state.zones.get(k.zone)?.rows.get(k.rk)
  return row ? { key: state.attack_target_key, zx: k.zx, zy: k.zy, row } : null
}

/** The zone under the player when it is searchable NOW (the [F] gate), else null. */
export function searchable_zone(state, now) {
  if (!state.world_id || !state.player) return null
  const cell = zone_of_world(state.player.x, state.player.z, state.zone_size, state.offset_x, state.offset_z)
  if (!cell) return null
  const row = zone_row_of(state.zones, cell.zx, cell.zy)
  return zone_searchable(row, state.zone_ttl_ms, now) ? cell : null
}

/** The [F]/[G]/[R] AFFORDANCE ROWS as data, pending-until-settle included — the one prompt contract. */
export function affordance_rows(state, now) {
  const rows = []
  const search = searchable_zone(state, now)
  if (search)
    rows.push({
      id: 'search',
      key: 'F',
      pending: state.pending.has(`search:${search.zx}:${search.zy}`),
      payload: search,
    })
  const g = gather_target(state)
  if (g) rows.push({ id: 'gather', key: 'G', pending: state.pending.has(`gather:${g.key}`), payload: g })
  const r = attack_target(state)
  if (r) rows.push({ id: 'attack', key: 'R', pending: state.pending.has(`claim:${r.key}`), payload: r })
  return rows
}

/** The boot-spawn arbiter over the atom's checkpoint (chain truth wins — see checkpoint.js). `now` is the
 *  instant the session pose claims: the travel budget it is judged against is measured from there. */
export function boot_spawn(state, { session, fallback, y_seed }, now) {
  return resolve_boot_spawn({ checkpoint: state.checkpoint, session, fallback, y_seed, now })
}
