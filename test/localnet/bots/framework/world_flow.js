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

import { derive_zone } from '../../../../packages/sim/src/zone_derive.js'

import { deriveDynamicFieldID, bcs } from './deps.js'
import { get_fields } from './sui.js'

// ── combat grid (foundation combat_grid.move): fixed encoding STRIDE 20, cell = y*20 + x, 380 cells ─────────
const GRID_W = 20
const GRID_CELLS = 380
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

/** Parse a Fight object into the flat combat state the solver needs (self cell/mp, living mobs, walls). */
export async function read_fight(client, fight_id, character_id) {
  const f = await get_fields(client, fight_id).catch(() => null)
  if (!f) return { status: -1, self_cell: null, self_mp: 0, mobs: [], walls: new Set() }
  const status = Number(f.status ?? -1)
  const participants = (f.participants ?? []).map(unwrap)
  const self = participants.find((p) => p.character === character_id) ?? participants[0]
  const mobs = (f.mobs ?? []).map(unwrap).map((m) => ({ cell: Number(m.cell ?? 0), hp: Number(m.hp ?? 0) }))
  const board = unwrap(f.board) ?? {}
  const obstacles = (board.obstacles ?? []).map(Number)
  const holes = (board.holes ?? []).map(Number)
  const start_a = (board.start_cells_a ?? []).map(Number)
  const walls = new Set([...obstacles, ...holes])
  return {
    status,
    self_cell: self != null ? Number(self.cell) : null,
    self_mp: self != null ? Number(self.mp || self.base_mp || 6) : 6,
    mobs,
    start_a,
    walls,
  }
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

/**
 * Create a fight against `zone.mob`, place on a real start cell, and drive it to VICTORY, then settle.
 * @returns {Promise<{ fight_id:string|null, settle:any, won:boolean, xp_share:number, result_id:string|null,
 *   turn_gas:number[], reason?:string }>}
 */
export async function win_fight({ driver, client, ids, world, zone, max_turns = 24 }) {
  if (!zone?.mob)
    return {
      fight_id: null,
      settle: null,
      won: false,
      xp_share: 0,
      result_id: null,
      turn_gas: [],
      reason: 'no_group_in_zone',
    }
  const cf = await driver.create_fight({
    world_id: world.id,
    ...ids,
    spawn_id: zone.mob.spawn_id,
    zx: zone.zx,
    zy: zone.zy,
    mob_template_id: zone.mob.template_id,
  })
  const fight_id = cf?.fight_id
  if (!fight_id)
    return {
      fight_id: null,
      settle: null,
      won: false,
      xp_share: 0,
      result_id: null,
      turn_gas: [],
      create: cf,
      reason: 'create_fight_failed',
    }

  // place on a real near-side start cell (the last ready auto-starts a solo fight → ACTIVE)
  let fb = await read_fight(client, fight_id, ids.character_id)
  const start = fb.start_a?.[0] ?? fb.self_cell ?? 0
  await driver.place({ fight_id, character_id: ids.character_id, cell: start })

  const turn_gas = []
  for (let turn = 0; turn < max_turns; turn++) {
    fb = await read_fight(client, fight_id, ids.character_id)
    if (fb.status !== 1) break // 0 placement / 2 victory / 3 defeat / -1 unreadable → done
    const living = fb.mobs.filter((m) => m.hp > 0)
    if (living.length === 0 || fb.self_cell == null) break

    // approach the nearest living mob if not already adjacent
    const T = nearest_mob(fb.self_cell, living)
    if (manhattan(fb.self_cell, T.cell) > 1) {
      const dest = step_toward(fb.self_cell, T.cell, fb.self_mp, fb.walls, living)
      if (dest != null) {
        const mv = await driver.act_move({ fight_id, character_id: ids.character_id, cell: dest })
        if (mv?.res?.gasMist != null) turn_gas.push(mv.res.gasMist)
        fb = await read_fight(client, fight_id, ids.character_id)
      }
    }

    // strike an ADJACENT living mob until it dies (over-strike aborts harmlessly on the dead cell) or AP runs out
    const adj = fb.mobs.filter((m) => m.hp > 0).find((m) => manhattan(fb.self_cell, m.cell) === 1)
    if (adj) {
      for (let s = 0; s < 6; s++) {
        const w = await driver.act_weapon({ fight_id, character_id: ids.character_id, target_cell: adj.cell })
        if (w?.res?.gasMist != null) turn_gas.push(w.res.gasMist)
        if (!w?.res?.ok) break // dead target, out of AP, or fight ended
      }
    }

    // end the turn (mobs act). ESomeoneOverdue (108) → crank the queue forward, then continue.
    const p = await driver.act_pass({ fight_id, character_id: ids.character_id })
    if (!p?.res?.ok && p?.res?.abort_code === 108) await driver.crank({ fight_id })
  }

  const settle = await driver.settle_open_world({ fight_id, ...ids })
  const opened = settle?.res?.event?.('::results::ResultOpened')
  const xp_share = Number(opened?.xp_share ?? 0)
  return { fight_id, settle, won: xp_share > 0, xp_share, result_id: settle?.result_id ?? null, turn_gas }
}
