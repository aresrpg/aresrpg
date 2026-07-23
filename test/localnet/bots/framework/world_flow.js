// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD FLOW — the RUNTIME-COORD layer every live bot shares (gameplay + balance). The shipped world model is
// PROCEDURAL: a zone's contents (mob groups + resource nodes, their spawn_ids and positions) are ROLLED FRESH
// by each `search_zone` from `&Random` — they are NOT static seed data, so no manifest coord can name them. A
// bot must DISCOVER them at run time. This module is the single home for that flow:
//
//   reach_zone  — enter the world (which rolls a random spawn near the world centre), read the exact spawn out
//                 of the `WorldJoined` event, SEARCH AT THAT SPAWN (travel distance 0 → always passes the §17.3
//                 travel-verify, unlike searching at a fixed offset ~700 blocks away), then read the discovered
//                 zone's live DF to learn the REAL (zx, zy), mob spawn_ids and resource node indices.
//   win_fight   — create the fight against a discovered group, place on a real start cell, and drive a minimal
//                 tactical loop (approach the nearest living mob within MP, strike it while AP lasts, end turn)
//                 to a VICTORY, then settle — the only path that grants xp/loot (settlement §7). Reads the
//                 granted xp straight off the `ResultOpened` event (the live write-path proof; the Character's
//                 top-level `experience` field is the frozen creation genesis, not post-fight xp).
//
// Depends only on the Driver's public methods + framework/sui.js reads (no SDK internals). The localnet world is
// admin-tuned for reachability (harness/lib.mjs tuneWorld: tiny zones, fast speed, strong L1 combat) so these
// REAL Move paths (travel-verify, zone discovery, fight create/act/settle) run honestly in a short bot sprint.

import { CHAIN_MIN_TURN_MS } from '../../../../packages/fight/src/draft_budget.js'
import { derive_zone } from '../../../../packages/sim/src/zone_derive.js'

import { deriveDynamicFieldID, bcs } from './deps.js'
import { classify_throw, get_object } from './sui.js'

// ── combat grid (foundation combat_grid.move): fixed encoding STRIDE 20, cell = y*20 + x, 380 cells ─────────
const GRID_W = 20
const GRID_CELLS = 380
const FIGHT_POLL_INTERVAL_MS = 100
const FIGHT_EFFECT_TIMEOUT_MS = 15_000
const FIGHT_READ_RETRY_MS = 50
const PASS_CLOCK_GRACE_MS = 100
const cell_x = (c) => c % GRID_W
const cell_y = (c) => Math.floor(c / GRID_W)
export const manhattan = (a, b) => Math.abs(cell_x(a) - cell_x(b)) + Math.abs(cell_y(a) - cell_y(b))

// ── live zone read (search-cost rework): the Zone DF stores {seed, consumed-bitmaps} — the rows DERIVE ───────
// via @aresrpg/sim's zone_derive (the byte-exact mirror of the chain's zone_comp/zone_gen), joined with the
// World object's spawn tables. Same {mobs, resources} shape out; `spawn_id` is now a derived 64-bit DECIMAL
// STRING (> 2^53 — Number would corrupt it; tx.pure.u64 takes it verbatim) and `node_index` is the DERIVATION
// index (stable across consumption — exactly what gathering::gather expects). (import hoisted top-of-file)

const zone_key_bcs = bcs.struct('ZoneKey', { zx: bcs.u32(), zy: bcs.u32() })

/** Unwrap a JSON-RPC MoveStruct/element: nested structs show as `{ type, fields }`, scalars pass through. */
const unwrap = (v) => (v && typeof v === 'object' && 'fields' in v ? v.fields : v)

/** Tolerant vector<u8> json (number[] | base64 string | absent) → plain byte array. */
const to_bytes = (v) => {
  if (v == null) return []
  if (Array.isArray(v)) return v.map(Number)
  if (typeof v === 'string') return [...Buffer.from(v, 'base64')]
  return []
}

/**
 * Read the LIVE spawns of zone `(zx, zy)` in `world_id` — Zone DF state + World tables → derived rows — or
 * null when the zone is undiscovered.
 * @returns {Promise<{ mobs: Array<{spawn_id:string,template_id:string,x:number,z:number,group_size:number}>,
 *   resources: Array<{node_index:number,spawn_id:string,template_id:string,x:number,z:number,remaining:number}> } | null>}
 */
export async function read_zone_spawns(client, pkg_origin, world_id, zx, zy) {
  const field_id = deriveDynamicFieldID(
    world_id,
    `${pkg_origin}::zones::ZoneKey`,
    zone_key_bcs.serialize({ zx, zy }).toBytes()
  )
  const [o, w] = await Promise.all([
    client.getObject({ id: field_id, options: { showContent: true } }).catch(() => null),
    client.getObject({ id: world_id, options: { showContent: true } }).catch(() => null),
  ])
  const value = unwrap(o?.data?.content?.fields?.value)
  const wf = w?.data?.content?.fields
  if (!value || !wf) return null
  const world = {
    zone_size: Number(wf.zone_size),
    bounds_x: Number(wf.bounds_x),
    bounds_z: Number(wf.bounds_z),
    min_groups: Number(wf.min_groups),
    max_groups: Number(wf.max_groups),
    min_nodes: Number(wf.min_nodes),
    max_nodes: Number(wf.max_nodes),
    mobs: (wf.mobs ?? []).map(unwrap).map((m) => ({
      template_id: m.template_id,
      rate_bp: Number(m.rate_bp ?? 0),
      min_group: Number(m.min_group ?? 1),
      max_group: Number(m.max_group ?? 1),
      level: 0, // §4 eligibility DF — unauthored on the localnet harness (the dormant path)
    })),
    resources: (wf.resources ?? []).map(unwrap).map((r) => ({
      template_id: r.template_id,
      rate_bp: Number(r.rate_bp ?? 0),
      min_qty: Number(r.min_qty ?? 1),
      max_qty: Number(r.max_qty ?? 1),
      job: Number(r.job ?? 0),
      tier: Number(r.tier ?? 1),
    })),
  }
  const rows = derive_zone({
    zone: {
      seed: value.seed,
      discovered_at_ms: Number(value.discovered_at_ms ?? 0),
      mob_bitmap: to_bytes(value.mob_bitmap),
      res_bitmap: to_bytes(value.res_bitmap),
    },
    zx,
    zy,
    world,
    team_bound: 6, // the localnet harness runs the config default (config.move DEFAULT_TEAM_SIZE)
  })
  const mobs = rows
    .filter((r) => r.kind === 'mob')
    .map((m) => ({ spawn_id: m.spawn_id, template_id: m.template_id, x: m.x, z: m.z, group_size: m.size }))
  const resources = rows
    .filter((r) => r.kind === 'resource')
    .map((r) => ({
      node_index: r.index,
      spawn_id: r.spawn_id,
      template_id: r.template_id,
      x: r.x,
      z: r.z,
      remaining: r.remaining,
    }))
  return { mobs, resources }
}

/**
 * Reach a live, discovered zone: enter the world, SEARCH AT the rolled spawn, and read the zone's real spawns.
 * @returns {Promise<{ ok:boolean, zx:number, zy:number, spawn:{x:number,z:number}, mobs:any[], nodes:any[],
 *   mob:any|null, node:any|null, trace:any[] }>}
 */
export async function reach_zone({
  driver,
  client,
  ids,
  world,
  pkg_origin,
  prefer_template = null,
  content = null,
  offline = false,
}) {
  const offset_x = Number(world.offset_x ?? 0)
  const offset_z = Number(world.offset_z ?? 0)
  const zsize = Number(world.zone_size ?? 512)
  // the DF key type resolves through the ORIGIN package id (dynamic-field type tags use the defining package)
  pkg_origin = pkg_origin ?? driver?.context?.ids?.aresrpg?.PACKAGE_ID
  const trace = []

  // 1. enter → the chain rolls a random spawn near the world centre and emits it in WorldJoined (chain coords)
  const jw = await driver.enter_world({ world_id: world.id, ...ids })
  const joined = jw?.res?.event?.('::zones::WorldJoined')
  trace.push({ step: 'enter_world', ok: !!jw?.res?.ok, abort_code: jw?.res?.abort_code })
  const spawn = { x: Number(joined?.x ?? offset_x), z: Number(joined?.z ?? offset_z) } // CHAIN coords

  // 2. search AT the spawn (distance 0 → passes travel-verify). search_zone_ptb re-applies the offset, so we
  //    hand it WORLD coords (chain − offset); world_to_chain reverses them back to the exact chain spawn.
  const sr = await driver.search({
    world_id: world.id,
    ...ids,
    x: spawn.x - offset_x,
    z: spawn.z - offset_z,
    offset_x,
    offset_z,
  })
  const searched = sr?.res?.event?.('::zones::ZoneSearched')
  // EZoneFresh (105) = someone already searched this zone; discovery is GLOBAL so it is still usable — derive
  // the zone key from the spawn position. Otherwise take the authoritative (zx,zy) from the ZoneSearched event.
  const already = sr?.res?.abort_code === 105
  const ok = !!sr?.res?.ok || already
  const zx = Number(searched?.zx ?? Math.floor(spawn.x / zsize))
  const zy = Number(searched?.zy ?? Math.floor(spawn.z / zsize))
  trace.push({ step: 'search', ok, abort_code: sr?.res?.abort_code })

  // 3. resolve the group + node. LIVE: read the discovered zone's DF (real spawn_ids + node indices). OFFLINE
  //    (MockChain models neither the zone DF nor a real board): fall back to the manifest `content` hints so
  //    the self-test still BUILDS create_fight/gather (coverage) — the mock ignores the coords anyway.
  let mobs = []
  let nodes = []
  let z = { zx, zy }
  if (offline) {
    const cm = content?.mobs?.[0]
    const cn = content?.gather?.[0]
    if (cm) mobs = [{ spawn_id: cm.spawn_id ?? 1, template_id: cm.template_id, x: 0, z: 0, group_size: 1 }]
    if (cn)
      nodes = [{ node_index: cn.node_index ?? 0, spawn_id: 0, template_id: cn.template_id, x: 0, z: 0, remaining: 1 }]
    z = { zx: Number(cm?.zx ?? 0), zy: Number(cm?.zy ?? 0) }
  } else if (ok) {
    const zone = await read_zone_spawns(client, pkg_origin, world.id, zx, zy)
    mobs = zone?.mobs ?? []
    nodes = zone?.resources ?? []
  }
  // prefer the melee template (winnable — no healer net-heal) when present; else the first discovered group
  const mob = (prefer_template && mobs.find((m) => m.template_id === prefer_template)) || mobs[0] || null
  const node = nodes[0] || null
  return { ok, search: sr, zx: z.zx, zy: z.zy, spawn, mobs, nodes, mob, node, trace }
}

// ── fight board read + minimal tactical solver ──────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const unreadable_fight = (error = null) => ({
  version: null,
  status: -1,
  placement_deadline_ms: 0,
  turn_deadline_ms: 0,
  turn_ms: 0,
  self_cell: null,
  self_hp: 0,
  self_ap: 0,
  self_mp: 0,
  self_weapon_ap_cost: 1,
  mobs: [],
  start_a: [],
  walls: new Set(),
  read_error: error == null ? null : String(error?.message ?? error),
})

const transient_read_error = (error) => {
  const outcome = classify_throw(error)
  return outcome === 'network' || outcome === 'version_conflict' || outcome === 'equivocation'
}

/** Settlement is legal only for the two terminal raw Fight statuses. */
export const is_terminal_fight_status = (status) => status === 2 || status === 3

/** Parse a Fight object into the flat combat state the solver needs (self cell/AP/MP, living mobs, walls). */
export async function read_fight(client, fight_id, character_id) {
  let object = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      object = await get_object(client, fight_id)
      break
    } catch (error) {
      if (attempt === 0 && transient_read_error(error)) {
        await sleep(FIGHT_READ_RETRY_MS)
        continue
      }
      return unreadable_fight(error)
    }
  }
  const f = object?.content?.fields
  if (!f) return unreadable_fight()
  const status = Number(f.status ?? -1)
  const participants = (f.participants ?? []).map(unwrap)
  const self = participants.find((p) => p.character === character_id) ?? participants[0]
  const weapon = unwrap(self?.weapon) ?? {}
  const mobs = (f.mobs ?? []).map(unwrap).map((m) => ({ cell: Number(m.cell ?? 0), hp: Number(m.hp ?? 0) }))
  const board = unwrap(f.board) ?? {}
  const obstacles = (board.obstacles ?? []).map(Number)
  const holes = (board.holes ?? []).map(Number)
  const start_a = (board.start_cells_a ?? []).map(Number)
  const walls = new Set([...obstacles, ...holes])
  return {
    version: object.version ?? null,
    status,
    placement_deadline_ms: Number(f.placement_deadline_ms ?? 0),
    turn_deadline_ms: Number(f.turn_deadline_ms ?? 0),
    turn_ms: Number(f.turn_ms ?? 0),
    self_cell: self != null ? Number(self.cell) : null,
    self_hp: self != null ? Number(self.hp ?? 0) : 0,
    self_ap: self != null ? Number(self.ap ?? 0) : 0,
    self_mp: self != null ? Number(self.mp ?? self.base_mp ?? 6) : 0,
    self_weapon_ap_cost: Number(weapon.ap_cost ?? 1),
    mobs,
    start_a,
    walls,
    read_error: null,
  }
}

/**
 * Poll the authoritative Fight object until `predicate` matches. Successful-but-stale reads remain eligible;
 * each thrown fetch/version race gets one immediate read retry inside `read_fight`.
 */
export async function poll_fight({
  client,
  fight_id,
  character_id,
  predicate,
  timeout_ms = FIGHT_EFFECT_TIMEOUT_MS,
  interval_ms = FIGHT_POLL_INTERVAL_MS,
}) {
  const expires_at = Date.now() + timeout_ms
  let fight = await read_fight(client, fight_id, character_id)
  while (!predicate(fight) && fight.read_error == null && Date.now() < expires_at) {
    await sleep(interval_ms)
    fight = await read_fight(client, fight_id, character_id)
  }
  return { matched: predicate(fight), fight }
}

/** In-grid, not a wall, not on a living mob (a standable cell). */
function standable(cell, walls, mobs) {
  if (cell < 0 || cell >= GRID_CELLS || walls.has(cell)) return false
  return !mobs.some((m) => m.hp > 0 && m.cell === cell)
}

/** The 4 orthogonal neighbours of `cell` that exist on the grid stride. */
function neighbours(cell) {
  const out = []
  if (cell_x(cell) > 0) out.push(cell - 1)
  if (cell_x(cell) < GRID_W - 1) out.push(cell + 1)
  if (cell_y(cell) > 0) out.push(cell - GRID_W)
  out.push(cell + GRID_W)
  return out
}

/** Nearest living mob to `from` (manhattan). */
function nearest_mob(from, mobs) {
  let best = null
  for (const m of mobs) if (m.hp > 0 && (best == null || manhattan(from, m.cell) < manhattan(from, best.cell))) best = m
  return best
}

/**
 * A destination up to `mp` clear orthogonal steps from `C` toward a cell ADJACENT to mob `T` — greedy manhattan
 * reduction over standable cells only, so the real BFS path cost is ≤ our step count ≤ mp (act_move never aborts
 * for distance). Returns null when already adjacent or no progress is possible.
 */
function step_toward(C, T, mp, walls, mobs) {
  // goal = the standable neighbour of T closest to C
  let goal = null
  for (const n of neighbours(T))
    if (standable(n, walls, mobs) && (goal == null || manhattan(C, n) < manhattan(C, goal))) goal = n
  if (goal == null || goal === C) return null
  let cur = C
  for (let s = 0; s < mp && cur !== goal; s++) {
    let next = null
    for (const n of neighbours(cur))
      if (
        standable(n, walls, mobs) &&
        manhattan(n, goal) < manhattan(cur, goal) &&
        (next == null || manhattan(n, goal) < manhattan(next, goal))
      )
        next = n
    if (next == null) break
    cur = next
  }
  return cur === C ? null : cur
}

const fight_failure = (fight_id, turn_gas, reason, detail = {}) => ({
  fight_id,
  settle: null,
  won: false,
  xp_share: 0,
  result_id: null,
  turn_gas,
  reason,
  ...detail,
})

const driven_failure = (step, driven) =>
  driven?.res?.abort ?? driven?.res?.error ?? `${step}_failed (${driven?.res?.class ?? 'unknown'})`

const mutated_version = (driven, fight_id) =>
  (driven?.res?.objectChanges ?? []).find(
    (change) => change?.objectId === fight_id && (change.type === 'mutated' || change.type === 'created')
  )?.version ?? null

const version_reached = (actual, expected) => {
  if (actual == null || expected == null) return false
  try {
    return BigInt(actual) >= BigInt(expected)
  } catch {
    return actual === expected
  }
}

const poll_fight_change = ({ client, fight_id, character_id, version, driven }) => {
  const expected_version = mutated_version(driven, fight_id)
  return poll_fight({
    client,
    fight_id,
    character_id,
    predicate: (fight) =>
      fight.status !== -1 &&
      (expected_version == null
        ? version == null || fight.version !== version
        : version_reached(fight.version, expected_version)),
  })
}

async function wait_for_active_fight({ driver, client, fight_id, character_id, initial }) {
  let fight = initial
  let forced = null
  let expires_at = Date.now() + FIGHT_EFFECT_TIMEOUT_MS
  while (Date.now() < expires_at) {
    if (fight.read_error) return { fight, forced, reason: `fight_read_failed: ${fight.read_error}` }
    if (fight.status === 1 || is_terminal_fight_status(fight.status)) return { fight, forced, reason: null }
    if (fight.placement_deadline_ms > 0)
      expires_at = Math.max(expires_at, fight.placement_deadline_ms + FIGHT_EFFECT_TIMEOUT_MS)
    if (
      fight.status === 0 &&
      fight.placement_deadline_ms > 0 &&
      Date.now() >= fight.placement_deadline_ms &&
      forced == null
    ) {
      forced = await driver.force_start({ fight_id })
      if (!forced?.res?.ok) return { fight, forced, reason: driven_failure('force_start', forced) }
    }
    await sleep(FIGHT_POLL_INTERVAL_MS)
    fight = await read_fight(client, fight_id, character_id)
  }
  const read_note = fight.read_error ? `, read=${fight.read_error}` : ''
  return { fight, forced, reason: `fight_not_active(status=${fight.status}${read_note})` }
}

const emitted = (driven, name) => driven?.res?.event?.(`::fight_events::${name}`) != null

const killed_mob = (driven) =>
  (driven?.res?.events ?? []).some(
    (event) =>
      String(event?.type ?? '').endsWith('::fight_events::Hit') &&
      event?.parsedJson?.victim_is_mob === true &&
      Number(event?.parsedJson?.remaining_hp ?? 1) === 0
  )

async function wait_for_pass_window(fight) {
  if (fight.turn_deadline_ms <= 0 || fight.turn_ms <= 0) return
  const pass_at = fight.turn_deadline_ms - fight.turn_ms + CHAIN_MIN_TURN_MS
  const wait_ms = pass_at - Date.now() + PASS_CLOCK_GRACE_MS
  if (wait_ms > 0) await sleep(wait_ms)
}

/**
 * Create a fight against `zone.mob`, place on a real start cell, and drive it to VICTORY, then settle.
 * @returns {Promise<{ fight_id:string|null, settle:any, won:boolean, xp_share:number, result_id:string|null,
 *   turn_gas:number[], reason?:string }>}
 */
export async function win_fight({ driver, client, ids, world, zone, max_turns = 24 }) {
  if (!zone?.mob) return fight_failure(null, [], 'no_group_in_zone')
  const cf = await driver.create_fight({
    world_id: world.id,
    ...ids,
    spawn_id: zone.mob.spawn_id,
    zx: zone.zx,
    zy: zone.zy,
    mob_template_id: zone.mob.template_id,
  })
  const fight_id = cf?.fight_id
  if (!fight_id) return fight_failure(null, [], driven_failure('create_fight', cf), { create: cf })

  // Wait for the created shared object before choosing a real near-side cell. `place` is PLACE + READY; a solo
  // fight auto-starts, while force_start is legal only after the immutable placement deadline.
  const created = await poll_fight({
    client,
    fight_id,
    character_id: ids.character_id,
    predicate: (fight) => fight.status === 0 && (fight.start_a.length > 0 || fight.self_cell != null),
  })
  if (!created.matched)
    return fight_failure(
      fight_id,
      [],
      `fight_not_readable_after_create(status=${created.fight.status}, read=${created.fight.read_error ?? 'none'})`,
      { create: cf }
    )
  let fb = created.fight
  const start = fb.start_a?.[0] ?? fb.self_cell ?? 0
  const placed = await driver.place({ fight_id, character_id: ids.character_id, cell: start })
  if (!placed?.res?.ok)
    return fight_failure(fight_id, [], driven_failure('place', placed), { create: cf, place: placed })
  const placed_visible = await poll_fight_change({
    client,
    fight_id,
    character_id: ids.character_id,
    version: fb.version,
    driven: placed,
  })
  if (!placed_visible.matched)
    return fight_failure(fight_id, [], 'place_effect_not_visible', { create: cf, place: placed })
  const active = await wait_for_active_fight({
    driver,
    client,
    fight_id,
    character_id: ids.character_id,
    initial: placed_visible.fight,
  })
  if (active.reason)
    return fight_failure(fight_id, [], active.reason, {
      create: cf,
      place: placed,
      force_start: active.forced,
    })
  fb = active.fight

  const turn_gas = []
  turns: for (let turn = 0; turn < max_turns; turn++) {
    if (is_terminal_fight_status(fb.status)) break
    if (fb.status !== 1) return fight_failure(fight_id, turn_gas, `fight_left_active_drive(status=${fb.status})`)
    const living = fb.mobs.filter((m) => m.hp > 0)
    if (living.length === 0 || fb.self_cell == null) break

    // approach the nearest living mob if not already adjacent
    const T = nearest_mob(fb.self_cell, living)
    if (manhattan(fb.self_cell, T.cell) > 1) {
      const dest = step_toward(fb.self_cell, T.cell, fb.self_mp, fb.walls, living)
      if (dest != null) {
        const { version } = fb
        const mv = await driver.act_move({ fight_id, character_id: ids.character_id, cell: dest })
        if (mv?.res?.gasMist != null) turn_gas.push(mv.res.gasMist)
        if (!mv?.res?.ok) return fight_failure(fight_id, turn_gas, driven_failure('act_move', mv), { action: mv })
        const changed = await poll_fight_change({
          client,
          fight_id,
          character_id: ids.character_id,
          version,
          driven: mv,
        })
        if (!changed.matched) return fight_failure(fight_id, turn_gas, 'act_move_effect_not_visible', { action: mv })
        fb = changed.fight
        if (is_terminal_fight_status(fb.status)) break
      }
    }

    // Strike an adjacent mob until it dies or AP runs out. Every successful mutation is read back before another
    // signed action, so a killing hit never turns into a gas-burning over-strike against the terminal fight.
    const adj =
      fb.self_hp <= 0 || fb.self_ap < fb.self_weapon_ap_cost
        ? null
        : fb.mobs.filter((m) => m.hp > 0).find((m) => manhattan(fb.self_cell, m.cell) === 1)
    if (adj) {
      for (let s = 0; s < 6; s++) {
        const { version } = fb
        const w = await driver.act_weapon({ fight_id, character_id: ids.character_id, target_cell: adj.cell })
        if (w?.res?.gasMist != null) turn_gas.push(w.res.gasMist)
        if (!w?.res?.ok) return fight_failure(fight_id, turn_gas, driven_failure('act_weapon', w), { action: w })
        const changed = await poll_fight_change({
          client,
          fight_id,
          character_id: ids.character_id,
          version,
          driven: w,
        })
        if (!changed.matched) return fight_failure(fight_id, turn_gas, 'act_weapon_effect_not_visible', { action: w })
        fb = changed.fight
        if (emitted(w, 'Victory') || emitted(w, 'Defeat') || is_terminal_fight_status(fb.status)) break turns
        if (killed_mob(w) || !fb.mobs.some((mob) => mob.hp > 0 && mob.cell === adj.cell)) break
        if (fb.self_hp <= 0) break
        if (fb.self_ap < fb.self_weapon_ap_cost) break
      }
    }

    // End the turn (mobs act). Any returned abort has a digest and therefore surfaces; it is never a retry signal.
    await wait_for_pass_window(fb)
    const { version } = fb
    const p = await driver.act_pass({ fight_id, character_id: ids.character_id })
    if (!p?.res?.ok) return fight_failure(fight_id, turn_gas, driven_failure('act_pass', p), { action: p })
    const changed = await poll_fight_change({
      client,
      fight_id,
      character_id: ids.character_id,
      version,
      driven: p,
    })
    if (!changed.matched) return fight_failure(fight_id, turn_gas, 'act_pass_effect_not_visible', { action: p })
    fb = changed.fight
  }

  // A receipt says the mutation executed; the Fight object says settlement is legal. Never infer one from the
  // other: poll until the persisted raw status is exactly VICTORY/DEFEAT before consuming the shared Fight.
  const terminal = await poll_fight({
    client,
    fight_id,
    character_id: ids.character_id,
    predicate: (fight) => is_terminal_fight_status(fight.status),
  })
  if (!terminal.matched)
    return fight_failure(
      fight_id,
      turn_gas,
      `fight_not_terminal(status=${terminal.fight.status}, read=${terminal.fight.read_error ?? 'none'})`
    )
  const settle = await driver.settle_open_world({ fight_id, ...ids })
  if (!settle?.res?.ok)
    return fight_failure(fight_id, turn_gas, driven_failure('settle_open_world', settle), { settle })
  const opened = settle?.res?.event?.('::results::ResultOpened')
  const xp_share = Number(opened?.xp_share ?? 0)
  return { fight_id, settle, won: xp_share > 0, xp_share, result_id: settle?.result_id ?? null, turn_gas }
}
