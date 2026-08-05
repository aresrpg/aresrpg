// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// AUTO-SEARCH (#1106) — the scouting loop's pure core: walk to a zone inside a configured distance
// annulus, search it, and stop at the first WANTED row it reveals — a mob group, a gathering node, or
// either, per the `targets` axis (#2029). A small fold over plain data —
// `reduce_auto_search(state, input, now)` — with ZERO effects and no clock of its own. Time is an input.
//
// THE SHAPE: every source the loop needs (the player's standing position, the zone grid, the fresh-TTL zone
// set, whether the [F] gate is armed here, and the revealed spawn markers) arrives as ONE `world` snapshot
// input; the fold decides everything and answers with COMMAND rows the adapter performs:
//   walk (steer the body to x/z) · approach (a walk that announces the sighted group) · search (pull the same
//   [F] lever a human presses) · found (the popup + the alarm + auto-disable) · halt (cancel an in-flight walk) ·
//   exhausted (no zone left in range — an honest stop).
//
// SPEND ORDER: known-rows scan → approach; only when NO revealed zone holds a wanted row does a leg walk to the
// next zone and pay for its search. And an `interrupted` input (the player taking the body back) disarms.
// Nothing here knows about React, the engine, the chain, or a transaction — that is auto_search_adapter.js.
//
// THE SPEND GATE: `armed` has exactly ONE door — `fee_confirm` after a `toggle` raised `fee_pending`. Each
// zone search is a real SUI transaction, so an enable can never skip the disclosure (proven in the tests),
// and a search is single-flight by construction: the fold leaves `search` phase only on a receipt, a
// failure, or its own timeout — the spawns door's per-zone pending is the second, independent guard.

import { gather_resource_for } from '@aresrpg/sdk/jobs'

/** The default scouting annulus (blocks from the world centre) — the issue's stated defaults. */
export const DEFAULT_RANGE_FROM_M = 1000
export const DEFAULT_RANGE_TO_M = 3000

// WHAT THE LOOP IS LOOKING FOR (#2029). A revealed zone shows two kinds of row — mob groups and gathering
// nodes — and until now only mobs could ever end a run. The axis is an ENUM, not two booleans, because
// "neither" is not a scouting run: it would burn gas on zone searches that can never stop.
export const TARGET_MODES = /** @type {const} */ (['mobs', 'gatherables', 'both'])
/** Today's shipped behaviour stays the default: the loop hunts mobs unless the player says otherwise. */
export const DEFAULT_TARGETS = 'mobs'
/** Standing this close to a target group counts as arrived (the auto-run steerer plants well inside it). */
export const ARRIVE_RADIUS_M = 6
/** A walk leg that makes no progress for this long is abandoned (cliff / water / player took over). */
export const LEG_TIMEOUT_MS = 45_000
/** After a receipt, wait this long for the zone's rows to ferry in before declaring the zone a miss. */
export const SCAN_GRACE_MS = 8_000

/** The zone-grid key both this fold and its adapter agree on (the spawns core's own `zx:zy` shape). */
export const zone_key_of = (zx, zy) => `${zx}:${zy}`

/** A zone index's centre in SIGNED WORLD space (chain centre `(idx+0.5)*size`, translated by the offset). */
export const zone_center_world = (idx, zone_size, offset) => (idx + 0.5) * zone_size - offset

/**
 * The persisted half of the state — what the player CONFIGURED, as opposed to what a run is doing. The run
 * state (armed / fee_pending / phase / target) deliberately never leaves memory: see auto_search_pref.js.
 * @typedef {{ from_m: number, to_m: number, wanted: string[], wanted_resources: string[],
 *   targets: 'mobs'|'gatherables'|'both' }} AutoSearchSettings
 */

/**
 * @typedef {AutoSearchSettings & { armed: boolean, fee_pending: boolean, config_open: boolean,
 *   phase: 'idle'|'travel'|'search'|'scan'|'approach'|'found',
 *   target: any, leg_at: number, scan_at: number, skipped: string[], found: any,
 *   command: any, seq: number }} AutoSearchState
 */

/** The configured group, lifted out of any state — the one shape the pref module reads and writes. */
export const settings_of = (/** @type {AutoSearchState} */ state) => ({
  from_m: state.from_m,
  to_m: state.to_m,
  wanted: state.wanted,
  wanted_resources: state.wanted_resources,
  targets: state.targets,
})

/** @returns {AutoSearchState} */
export const blank_auto_search = () => ({
  armed: false,
  fee_pending: false,
  config_open: false,
  from_m: DEFAULT_RANGE_FROM_M,
  to_m: DEFAULT_RANGE_TO_M,
  wanted: [],
  wanted_resources: [],
  targets: DEFAULT_TARGETS,
  phase: 'idle',
  target: null,
  leg_at: 0,
  scan_at: 0,
  skipped: [],
  found: null,
  command: null,
  seq: 0,
})

/** Attach ONE command row (the adapter performs the newest `seq` it has not seen). */
const with_command = (state, command) => ({ ...state, seq: state.seq + 1, command: { seq: state.seq + 1, ...command } })

/** Is a run actually in flight? (armed, or still winding down a phase) */
const is_running = (state) => state.armed || state.phase !== 'idle'

/** Stop everything: disarm, drop the target, and halt an in-flight walk (only when there was one). */
const halt = (state, extra = {}) => {
  const stopped = { ...state, ...extra, armed: false, phase: 'idle', target: null }
  return is_running(state) ? with_command(stopped, { kind: 'halt' }) : stopped
}

const distance = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz)

/**
 * The NEAREST zone (to the player) whose centre lies inside the configured annulus around the world centre,
 * is not fresh-TTL, and has not already been tried this run. Pure over the snapshot. Null when none is left.
 * @returns {{ zx: number, zy: number, x: number, z: number } | null}
 */
export function pick_zone(state, world) {
  const { player, zone_size, offset_x, offset_z, world_frame_ready, fresh_keys } = world
  // A world bind resets the shared spawn frame before its World doc lands. Those reset zeros are placeholders,
  // never a coordinate calibration; fail shut until the one world-doc fold marks the frame ready (#2180).
  if (world_frame_ready === false || !player || !Number.isFinite(zone_size) || zone_size <= 0) return null
  const off_limits = new Set([...state.skipped, ...(fresh_keys ?? [])])
  const span = (offset, reach) => ({
    lo: Math.max(0, Math.floor((offset - reach) / zone_size)),
    hi: Math.floor((offset + reach) / zone_size),
  })
  const x_span = span(offset_x, state.to_m)
  const z_span = span(offset_z, state.to_m)
  let best = null
  for (let zx = x_span.lo; zx <= x_span.hi; zx += 1) {
    const cx = zone_center_world(zx, zone_size, offset_x)
    for (let zy = z_span.lo; zy <= z_span.hi; zy += 1) {
      if (off_limits.has(zone_key_of(zx, zy))) continue
      const cz = zone_center_world(zy, zone_size, offset_z)
      const from_center = Math.hypot(cx, cz)
      if (from_center < state.from_m || from_center > state.to_m) continue
      const reach = distance(player.x, player.z, cx, cz)
      if (!best || reach < best.reach) best = { zx, zy, x: cx, z: cz, reach }
    }
  }
  if (best && import.meta.env?.DEV)
    console.info('[auto-search/pick]', {
      zx: best.zx,
      zy: best.zy,
      cx: best.x,
      cz: best.z,
      from_center: Math.hypot(best.x, best.z),
      from_m: state.from_m,
      to_m: state.to_m,
      offset_x,
      offset_z,
    })
  return best ? { zx: best.zx, zy: best.zy, x: best.x, z: best.z } : null
}

/** Take the next zone: emit its walk leg, or stop honestly when the annulus is exhausted. */
const retarget = (state, world, now) => {
  const next = pick_zone(state, world)
  if (!next) return with_command({ ...state, armed: false, phase: 'idle', target: null }, { kind: 'exhausted' })
  return with_command({ ...state, phase: 'travel', target: next, leg_at: now }, { kind: 'walk', x: next.x, z: next.z })
}

/** Retire the current zone (searched, missed, or unreachable) and take the next one. */
const skip_current = (state, world, now) => {
  const key = state.target ? zone_key_of(state.target.zx, state.target.zy) : null
  const skipped = key && !state.skipped.includes(key) ? [...state.skipped, key] : state.skipped
  return retarget({ ...state, skipped }, world, now)
}

/** The zone the player stands in, in the same chain-key space the picker uses. */
const standing_zone = ({ player, zone_size, offset_x, offset_z }) => {
  const cx = Math.floor((player.x + offset_x) / zone_size)
  const cz = Math.floor((player.z + offset_z) / zone_size)
  return cx < 0 || cz < 0 ? null : { zx: cx, zy: cz }
}

const in_target_zone = (state, world) => {
  const here = standing_zone(world)
  return !!here && here.zx === state.target?.zx && here.zy === state.target?.zy
}

/**
 * The SELECTION KEY of a revealed row, or null when this row is not something the loop can be told to want.
 * A mob group is its template id; a gathering node is its roster id — the same items.json slug the jobs
 * panel lists, derived from the (job, tier) pair the chain row carries. The `targets` axis decides which
 * kinds are eligible at all, so a mobs-only run never approaches a node it happens to walk past (#2029).
 */
const selection_key = (state, marker) => {
  const wants_mobs = state.targets === 'mobs' || state.targets === 'both'
  const wants_nodes = state.targets === 'gatherables' || state.targets === 'both'
  if (marker.kind === 'mob') return wants_mobs ? (marker.template_id ?? null) : null
  if (marker.kind === 'resource' && wants_nodes) return gather_resource_for(marker.job, marker.tier)?.id ?? null
  return null
}

/** The wanted rows the reveal exposed, nearest first — mob groups and/or gathering nodes per `targets`. */
const wanted_markers = (state, world) =>
  (world.markers ?? [])
    .map((m) => ({ marker: m, key: selection_key(state, m) }))
    .filter(
      ({ marker, key }) =>
        key !== null &&
        (marker.kind === 'mob' ? state.wanted : state.wanted_resources).includes(key)
    )
    .map(({ marker, key }) => ({
      ...marker,
      template_id: key,
      reach: distance(world.player.x, world.player.z, Number(marker.x), Number(marker.z)),
    }))
    .sort((a, b) => a.reach - b.reach)

/**
 * THE KNOWN-ROWS SCAN — the nearest wanted group among the rows ALREADY revealed, as an approach leg, or null
 * when none is known. Every zone search is a real transaction, so this is checked BEFORE any leg that could
 * spend: a mob standing in an already-revealed zone is never paid for a second time. The `approach` row is a
 * walk that ANNOUNCES the sighting — one home for both the known-rows entry and the post-reveal one.
 */
const approach_match = (state, world, now) => {
  const [hit] = wanted_markers(state, world)
  if (!hit) return null
  const target = { x: Number(hit.x), z: Number(hit.z), template_id: hit.template_id, name: hit.name ?? null }
  return with_command({ ...state, phase: 'approach', leg_at: now, target }, { kind: 'approach', ...target })
}

const fold_world = (state, world, now) => {
  if (!state.armed || !world.player) return state
  switch (state.phase) {
    case 'idle':
      return approach_match(state, world, now) ?? retarget(state, world, now)

    case 'travel': {
      const known = approach_match(state, world, now)
      if (known) return known
      if (in_target_zone(state, world) && world.search_armed)
        return with_command({ ...state, phase: 'search', leg_at: now }, { kind: 'search' })
      // never arrived (or arrived onto a gate that never opened) — retire this zone, take the next
      return now - state.leg_at > LEG_TIMEOUT_MS ? skip_current(state, world, now) : state
    }

    case 'search':
      // the receipt/failure inputs own the normal exits; this is the only-if-the-world-swallowed-it floor
      return now - state.leg_at > LEG_TIMEOUT_MS ? skip_current(state, world, now) : state

    case 'scan': {
      const known = approach_match(state, world, now)
      if (known) return known
      // the reveal's own rows ferry in a beat after the receipt — only call it a miss once they land
      // (any row from this zone) or the grace elapses, never on the empty tick right after the tx.
      const zone_landed = (world.markers ?? []).some((m) => m.zx === state.target?.zx && m.zy === state.target?.zy)
      return zone_landed || now - state.scan_at > SCAN_GRACE_MS ? skip_current(state, world, now) : state
    }

    case 'approach': {
      const reach = distance(world.player.x, world.player.z, state.target.x, state.target.z)
      // arrived — or the body could not get there; the FIND is real either way, so report it honestly.
      if (reach > ARRIVE_RADIUS_M && now - state.leg_at <= LEG_TIMEOUT_MS) return state
      return with_command(
        { ...state, armed: false, phase: 'found', found: state.target },
        {
          kind: 'found',
          template_id: state.target.template_id,
          name: state.target.name,
          x: state.target.x,
          z: state.target.z,
        }
      )
    }

    default:
      return state
  }
}

/** A fresh run: the per-run memory (tried zones, last find) never leaks across arms. */
const fresh_run = { phase: 'idle', target: null, skipped: [], found: null, leg_at: 0, scan_at: 0 }

/**
 * THE door. Pure: same (state, input, now) → same state, no effect, and the SAME reference back when an
 * input changes nothing.
 * @param {AutoSearchState} state @param {any} input @param {number} now @returns {AutoSearchState}
 */
// Complexity retained (#2069): this is the exhaustive reducer door for the auto-search state machine; splitting transitions would divide ownership of its invariants.
export function reduce_auto_search(state, input, now) {
  switch (input.type) {
    // THE SPEND GATE — enabling only ever raises the fee disclosure; `fee_confirm` is the one door to armed.
    case 'toggle':
      return input.value ? { ...state, fee_pending: true, armed: false } : halt(state, { fee_pending: false })
    case 'fee_confirm':
      return { ...state, ...fresh_run, fee_pending: false, armed: true }
    case 'fee_cancel':
      return { ...state, fee_pending: false, armed: false }

    case 'config_open':
      return halt(state, { config_open: true })
    case 'config_close':
      return { ...state, config_open: false }
    case 'config_set': {
      const a = Number.isFinite(Number(input.from_m)) ? Math.max(0, Number(input.from_m)) : state.from_m
      const b = Number.isFinite(Number(input.to_m)) ? Math.max(0, Number(input.to_m)) : state.to_m
      const wanted = Array.isArray(input.wanted) ? input.wanted.map(String) : state.wanted
      const wanted_resources = Array.isArray(input.wanted_resources)
        ? input.wanted_resources.map(String)
        : state.wanted_resources
      // An unknown mode is ignored rather than stored: `targets` is the enum the whole predicate reads.
      const targets = TARGET_MODES.includes(input.targets) ? input.targets : state.targets
      return { ...state, from_m: Math.min(a, b), to_m: Math.max(a, b), wanted, wanted_resources, targets }
    }

    // The world's OWN spawn table arrived (or changed with the world): a wanted template that cannot spawn
    // here is not a target, it is an unfindable one — prune it. NEVER widens the selection, and an unknown
    // table (an unread World doc) never reaches this door, so a selection is only ever cut by real truth.
    // It is the MOB table: the gatherable selection is not its business and is never touched here.
    case 'world_mobs': {
      const allowed = new Set((input.template_ids ?? []).map(String))
      const wanted = state.wanted.filter((id) => allowed.has(id))
      return wanted.length === state.wanted.length ? state : { ...state, wanted }
    }

    case 'world':
      return fold_world(state, input, now)

    case 'zone_searched':
      if (state.phase !== 'search' || state.target?.zx !== input.zx || state.target?.zy !== input.zy) return state
      return { ...state, phase: 'scan', scan_at: now }
    case 'search_failed': {
      // A refused/failed search RETIRES the zone: re-picking it would re-fire the same doomed transaction
      // forever, and every one of those costs real gas.
      if (state.phase !== 'search' || state.target?.zx !== input.zx || state.target?.zy !== input.zy) return state
      const key = zone_key_of(input.zx, input.zy)
      return { ...state, phase: 'idle', skipped: state.skipped.includes(key) ? state.skipped : [...state.skipped, key] }
    }

    // THE PLAYER ALWAYS WINS (auto_run.js): the moment they take the body back — a movement key, Esc, or a
    // marker of their own — the scouting is over, so the toggle must stop claiming otherwise. The steerer's
    // OWN churn (its next leg, our halt, a stuck leg) rides the same announcement, hence the reason filter.
    case 'interrupted':
      return input.reason === 'player' && is_running(state) ? halt(state) : state

    // HARD STOPS — a fight, a world rebind, or the panel unmounting all speak through the same two inputs.
    case 'fight_entry':
    case 'world_unbound':
      return halt(state)

    default:
      return state
  }
}
