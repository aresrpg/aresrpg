// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CI FIGHT BOTS — the fight lifecycle proved by SDK-driven bots against a disposable LOCALNET, with ZERO
// browser. Browser-driven fight verification is ruled out for CI (standing ruling): a headless page spends
// minutes of wall time to exercise the same PTBs these bots submit directly, and its failures are renderer
// failures, not chain failures. Everything here composes the SAME @aresrpg/sdk builders the client ships, so a
// green run is a statement about the GAME, not about a test harness.
//
// Five legs, each an independent verdict row:
//   SOLO      one bot drives a world fight end to end (create → place → turns → terminal → settle) and the
//             settled FightResult must carry xp.
//   COOP      two bots, ONE fight: both seat, the turn queue hands the turn between them, both act on their
//             own turn, and the fight reaches a terminal status.
//   SPECTATE  a THIRD identity that never seats reconstructs the same fight from reads alone; its HP/cell
//             projection must equal what the players saw (fold parity at the read level).
//   TIMEOUT   a bot deliberately idles past its turn deadline and the permissionless `turns::crank` must
//             carry the fight FORWARD instead of wedging it (the class that burned us).
//   CRAFT     a bot loots the starter farmer tool, gathers the starter recipe's materials from seeded world
//             nodes, then drives the deployed-shape SDK craft PTB; the output must land in its character kiosk.
//
// EVERY wait is bounded and fails LOUD — a bot that waits forever is the disease this cures. Any leg failure
// exits non-zero with the verdict table printed.
//
//   node scripts/fight_bots.mjs                       # against an already-booted gold stack
//   node scripts/fight_bots.mjs --legs solo,coop      # a subset
import fs from 'node:fs'
import path from 'node:path'

import { CHAIN_MIN_TURN_MS } from '../packages/fight/src/draft_budget.js'
import { join_fight_ptb, create_member_fight_ptb } from '../packages/sdk/src/fight.js'
import { world_inner_field_id, WORLD_VERSION } from '../packages/sdk/src/sui/read/world_inner.js'
import { Driver } from '../test/localnet/bots/framework/driver.js'
import { build_context, make_kiosk_client } from '../test/localnet/bots/framework/context.js'
import {
  ENV_FAIL,
  PRODUCT_FAIL,
  exit_code_for,
  run_boot_gate,
  run_leg_gate,
} from '../test/localnet/bots/framework/gate.js'
import { Transaction } from '../test/localnet/bots/framework/deps.js'
import { make_client, submit, get_fields, get_object, SubmitStats } from '../test/localnet/bots/framework/sui.js'
import {
  reach_zone,
  read_zone_spawns,
  is_terminal_fight_status,
  manhattan,
} from '../test/localnet/bots/framework/world_flow.js'
import {
  P,
  RPC,
  FAUCET,
  API,
  signerOf,
  ensureDeps,
  bootStack,
  waitHealthy,
  waitApi,
  prepIsolatedConfig,
  prepMoveCopy,
  genKeypairs,
  faucet,
  importSigner,
  publishKiosk,
  runCeremony,
  runEnable,
  runSeed,
  readManifests,
  sdkBlock,
  makeClient,
  adminDials,
  tryCreateCharacter,
} from '../test/gold/lib_gold.mjs'

const GAS_BUDGET = 1_000_000_000 // 1 SUI — disposable localnet, &Random-safe fixed ceiling
const GRID_W = 20
const POLL_MS = 150
const SEARCH_MAX_HOPS = 3
const SEARCH_LEG_TIMEOUT_MS = 90_000
const SEARCH_ZONE_READ_TIMEOUT_MS = 15_000
const SEARCH_API_TIMEOUT_MS = 5_000
const SEARCH_TRAVEL_BLOCKS_PER_SECOND = 900
const PASS_GRACE_MS = 250
const TURN_MS_MIN = 5_000 // config.move TURN_MS_MIN — the shortest turn the chain will clamp to
const DEFAULT_TURN_MS = 45_000 // config.move DEFAULT_TURN_MS — restored after the timeout leg
const BOOT_WALL_MS = 12 * 60_000
const FIGHT_LEG_WALL_MS = 5 * 60_000
const CRAFT_LEG_WALL_MS = 180_000
const CRAFT_MAX_ATTEMPTS = 8 // starter roll is 50% at L1; eight fully-funded attempts bound the RNG tail

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)))
const unwrap = (v) => (v && typeof v === 'object' && 'fields' in v ? v.fields : v)
const cell_x = (c) => c % GRID_W
const cell_y = (c) => Math.floor(c / GRID_W)
const log = (m) => console.log(`[fight-bots] ${m}`)

/** Every wait in this driver goes through here: a bounded poll whose expiry is a LOUD, named failure. */
async function wait_until(label, predicate, { timeout_ms = 30_000, interval_ms = POLL_MS } = {}) {
  const expires_at = Date.now() + timeout_ms
  let last = null
  while (Date.now() < expires_at) {
    last = await predicate()
    if (last) return last
    await sleep(interval_ms)
  }
  throw new Error(`TIMEOUT after ${timeout_ms}ms waiting for: ${label}`)
}

/** Bound a whole mutation leg too: individual polls cannot protect a transaction or network call that stalls. */
export async function with_timeout(label, effect, timeout_ms) {
  let timer = null
  try {
    return await Promise.race([
      effect(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`TIMEOUT after ${timeout_ms}ms running: ${label}`)), timeout_ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`)
}

/** The post-#1612 client rule: biggest-first stacks until their sum covers the recipe need. */
function covering_stack_ids(stacks, target) {
  if (!(target > 0)) return null
  const chosen = []
  let remaining = target
  for (const stack of [...stacks].sort((a, b) => b.amount - a.amount)) {
    if (remaining <= 0) break
    chosen.push(stack.id)
    remaining -= stack.amount
  }
  return remaining <= 0 ? chosen : null
}

// ── fight reads ─────────────────────────────────────────────────────────────────────────────────────────────
// The gate lane's `read_fight` projects ONE character's view; the coop/spectate legs need the whole table
// (every seat, the queue and the turn pointer), so this reads the same object into the full shape. Read-only —
// the gate lane and packages/sdk are never written.
async function read_fight_table(client, fight_id) {
  const object = await get_object(client, fight_id)
  const f = object?.content?.fields
  if (!f) throw new Error(`fight ${fight_id} unreadable`)
  const board = unwrap(f.board) ?? {}
  return {
    version: object.version ?? null,
    status: Number(f.status ?? -1),
    turn_ptr: Number(f.turn_ptr ?? 0),
    turn_ms: Number(f.turn_ms ?? 0),
    turn_deadline_ms: Number(f.turn_deadline_ms ?? 0),
    placement_deadline_ms: Number(f.placement_deadline_ms ?? 0),
    queue: (f.queue ?? []).map(unwrap).map((a) => ({ is_mob: !!a.is_mob, idx: Number(a.idx ?? 0) })),
    participants: (f.participants ?? []).map(unwrap).map((p) => ({
      character: p.character,
      cell: Number(p.cell ?? 0),
      hp: Number(p.hp ?? 0),
      ap: Number(p.ap ?? 0),
      mp: Number(p.mp ?? p.base_mp ?? 6),
      weapon_ap_cost: Number(unwrap(p.weapon)?.ap_cost ?? 1),
    })),
    mobs: (f.mobs ?? []).map(unwrap).map((m) => ({ cell: Number(m.cell ?? 0), hp: Number(m.hp ?? 0) })),
    start_a: (board.start_cells_a ?? []).map(Number),
    walls: new Set([...(board.obstacles ?? []).map(Number), ...(board.holes ?? []).map(Number)]),
  }
}

/** The seat whose turn it is right now, or null when a mob holds the queue slot. */
function active_seat(state) {
  const slot = state.queue[state.turn_ptr]
  if (!slot || slot.is_mob) return null
  return state.participants[slot.idx] ?? null
}

/** `act_pass` is throttled by the chain's anti-bot floor — wait for the window rather than eat abort 108. */
async function wait_for_pass_window(state) {
  const earliest = state.turn_deadline_ms - state.turn_ms + CHAIN_MIN_TURN_MS
  await sleep(earliest + PASS_GRACE_MS - Date.now())
}

// ── bots ────────────────────────────────────────────────────────────────────────────────────────────────────
/** One SDK-driven bot: a funded localnet wallet + one of its characters, bound to the gold manifest ids. */
async function make_bot({ manifest, wallet, character, name }) {
  const ids_block = manifest.ids.aresrpg
  const client = make_client(manifest.rpc, 'localnet')
  const signer = await signerOf(wallet.privkey)
  const kiosk_client = make_kiosk_client(client, 'testnet', {
    personalKioskRulePackageId: manifest.ids.kiosk,
    kioskLockRulePackageId: manifest.ids.kiosk,
    royaltyRulePackageId: manifest.ids.kiosk,
  })
  const context = build_context({ manifest: { ids: { aresrpg: ids_block } }, network: 'localnet', kiosk_client })
  const driver = new Driver({
    bot: { name, address: wallet.address, keypair: signer },
    context,
    client,
    signer,
    coverage: { record: () => [] },
    stats: new SubmitStats(),
    submit_fn: submit,
    budget: GAS_BUDGET,
  })
  return { name, client, signer, context, driver, address: wallet.address, ids: driver.select_character(character) }
}

/**
 * The world's dials (zone_size above all) drive every zone key this driver derives.
 *
 * `World` is a SHELL — `{ id, inner: Versioned }` — that holds no world facts; the payload is a
 * `Field<u64, WorldInner>` on the Versioned's own UID. Reading the shell as if it were the payload does not
 * fail: it yields every field absent, i.e. a ZEROED world, and the caller then derives zone keys against a
 * default zone_size that is not this world's (here: 512 vs the dialled 32) and finds no spawns anywhere. So the
 * field address comes from the SDK's own derivation — one home for that fact — and an undecodable payload
 * THROWS rather than surfacing as an empty-but-present world.
 */
async function read_world(client, world_id) {
  const shell = await get_fields(client, world_id)
  const inner_ref = unwrap(shell?.inner)
  const versioned_id = unwrap(inner_ref?.id)?.id ?? inner_ref?.id?.id ?? inner_ref?.id
  assert(typeof versioned_id === 'string', `world ${world_id} carries no Versioned inner — cannot read its dials`)
  const field = await get_object(client, world_inner_field_id(versioned_id, WORLD_VERSION))
  const payload = unwrap(unwrap(field?.content?.fields)?.value)
  assert(
    payload && payload.zone_size != null,
    `world ${world_id} payload unreadable at version ${WORLD_VERSION} — refusing to fight in a zeroed world`
  )
  return {
    id: world_id,
    offset_x: Number(payload.offset_x ?? 0),
    offset_z: Number(payload.offset_z ?? 0),
    zone_size: Number(payload.zone_size),
    bounds_x: Number(payload.bounds_x),
    bounds_z: Number(payload.bounds_z),
  }
}

/** The matrix drive's search picker: nearest undiscovered zone centre around the standing checkpoint. */
async function next_search_target(manifest, world, standing, excluded) {
  const response = await fetch(`${manifest.api}/v1/zones?world=${encodeURIComponent(world.id)}`, {
    signal: AbortSignal.timeout(SEARCH_API_TIMEOUT_MS),
  })
  assert(response.ok, `SEARCH zone-list read failed with HTTP ${response.status}`)
  const body = await response.json()
  assert(Array.isArray(body?.zones), 'SEARCH zone-list response carries no zones array')

  const known = new Set(body.zones.map((row) => `${row.zx}:${row.zy}`))
  for (const key of excluded) known.add(key)
  const { zone_size } = world
  const cx = Math.floor(standing.x / zone_size)
  const cy = Math.floor(standing.z / zone_size)
  const choices = []

  // Match the matrix drive's bounded nearest-ring scan. A hop is one paid search, not one ring radius.
  for (let radius = 0; radius <= 16 && choices.length === 0; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        const zx = cx + dx
        const zy = cy + dy
        if (zx < 0 || zy < 0 || known.has(`${zx}:${zy}`)) continue
        const chain_x = Math.min(world.bounds_x - 1, zx * zone_size + Math.floor(zone_size / 2))
        const chain_z = Math.min(world.bounds_z - 1, zy * zone_size + Math.floor(zone_size / 2))
        if (
          chain_x < 0 ||
          chain_z < 0 ||
          Math.floor(chain_x / zone_size) !== zx ||
          Math.floor(chain_z / zone_size) !== zy
        )
          continue
        const distance = Math.hypot(chain_x - standing.x, chain_z - standing.z)
        choices.push({ zx, zy, chain_x, chain_z, distance })
      }
    }
  }

  choices.sort((a, b) => a.distance - b.distance || a.zx - b.zx || a.zy - b.zy)
  const [target] = choices
  return target
    ? {
        ...target,
        wait_ms: Math.max(150, Math.ceil((target.distance / SEARCH_TRAVEL_BLOCKS_PER_SECOND) * 1_000)),
      }
    : null
}

/**
 * SEARCH leg: inspect the checkpoint zone first, then search at most three fresh zones before engaging.
 * Every read and the whole leg are bounded; depletion therefore ends in an explicit failure, never a hang.
 */
async function search_populated_zone(bot, manifest, world) {
  const pkg_origin = manifest.ids.aresrpg.PACKAGE_ID
  const melee_template = manifest.seed?.mobs?.melee?.id ?? null
  const initial = await reach_zone({
    driver: bot.driver,
    client: bot.client,
    ids: bot.ids,
    world,
    pkg_origin,
    prefer_template: melee_template,
  })
  if (initial?.mob) {
    log(`SEARCH found populated checkpoint zone ${initial.zx}:${initial.zy}`)
    return initial
  }

  let standing = initial.spawn
  const tried = new Set([`${initial.zx}:${initial.zy}`])
  const trace = [...(initial.trace ?? [])]
  log(`SEARCH checkpoint zone ${initial.zx}:${initial.zy} is depopulated; scouting up to ${SEARCH_MAX_HOPS} zones`)

  for (let hop = 1; hop <= SEARCH_MAX_HOPS; hop += 1) {
    const target = await next_search_target(manifest, world, standing, tried)
    assert(target, `SEARCH exhausted the nearest-zone ring before hop ${hop}/${SEARCH_MAX_HOPS}`)
    tried.add(`${target.zx}:${target.zy}`)
    log(`SEARCH hop ${hop}/${SEARCH_MAX_HOPS} → zone ${target.zx}:${target.zy}`)
    await sleep(target.wait_ms)

    const searched = await bot.driver.search({
      world_id: world.id,
      ...bot.ids,
      x: target.chain_x - world.offset_x,
      z: target.chain_z - world.offset_z,
      offset_x: world.offset_x,
      offset_z: world.offset_z,
    })
    const already = searched?.res?.abort_code === 105
    assert(
      searched?.res?.ok || already,
      `SEARCH hop ${hop}/${SEARCH_MAX_HOPS} failed in zone ${target.zx}:${target.zy}: ${
        searched?.res?.abort_code ?? searched?.res?.error ?? 'no receipt'
      }`
    )
    trace.push({
      step: 'search',
      hop,
      zx: target.zx,
      zy: target.zy,
      ok: !!searched?.res?.ok || already,
      abort_code: searched?.res?.abort_code,
    })

    const rows = await wait_until(
      `SEARCH zone ${target.zx}:${target.zy} becomes readable`,
      () => read_zone_spawns(bot.client, pkg_origin, world.id, target.zx, target.zy),
      { timeout_ms: SEARCH_ZONE_READ_TIMEOUT_MS }
    )
    const mobs = rows.mobs ?? []
    const nodes = rows.resources ?? []
    const mob = (melee_template && mobs.find((row) => row.template_id === melee_template)) || mobs[0] || null
    if (mob) {
      log(`SEARCH found ${mobs.length} live group(s) in zone ${target.zx}:${target.zy}`)
      return {
        ok: true,
        search: searched,
        zx: target.zx,
        zy: target.zy,
        spawn: { x: target.chain_x, z: target.chain_z },
        mobs,
        nodes,
        mob,
        node: nodes[0] ?? null,
        trace,
      }
    }
    standing = { x: target.chain_x, z: target.chain_z }
    log(`SEARCH zone ${target.zx}:${target.zy} is depopulated`)
  }

  throw new Error(`SEARCH exhausted ${SEARCH_MAX_HOPS} zones without finding a live mob group`)
}

async function discover_zone(bot, manifest, world) {
  return with_timeout(
    'SEARCH populated-zone leg',
    () => search_populated_zone(bot, manifest, world),
    SEARCH_LEG_TIMEOUT_MS
  )
}

/**
 * Claim a live world group into a Fight through the door its derivation demands. A member-list (format-3) zone
 * refuses the legacy claim door and vice versa — the chain enforces the pairing — so the door is chosen by the
 * row's own committed roster rather than assumed.
 */
async function create_open_fight(bot, world, zone) {
  const group = zone.mob
  const shared = {
    world_id: world.id,
    kiosk_id: bot.ids.kiosk_id,
    personal_kiosk_cap_id: bot.ids.personal_kiosk_cap_id,
    character_id: bot.ids.character_id,
    spawn_id: group.spawn_id,
    zx: zone.zx,
    zy: zone.zy,
  }
  if (!group.members?.length) {
    const created = await bot.driver.create_fight({ ...shared, ...bot.ids, mob_template_id: group.template_id })
    assert(created?.fight_id, `create_fight failed: ${created?.res?.abort ?? 'no fight id'}`)
    return created.fight_id
  }
  const result = await submit({
    client: bot.client,
    signer: bot.signer,
    budget: GAS_BUDGET,
    tx: create_member_fight_ptb(bot.context)({ ...shared, member_template_ids: group.members }),
  })
  assert(result?.ok, `create_member_fight failed: ${result?.abort ?? result?.error ?? 'no receipt'}`)
  const fight_id = result.created('::fight::Fight') ?? result.event('::fight::FightCreated')?.fight
  assert(fight_id, 'create_member_fight executed but produced no Fight')
  return fight_id
}

/** Seat every bot on a free start cell and wait for the fight to leave PLACEMENT (force-starting if overdue). */
async function place_and_start(bots, fight_id) {
  const taken = new Set()
  for (const bot of bots) {
    const state = await read_fight_table(bot.client, fight_id)
    if (is_terminal_fight_status(state.status) || state.status === 1) break
    const cell = state.start_a.find((c) => !taken.has(c)) ?? state.start_a[0]
    taken.add(cell)
    const placed = await bot.driver.place({ fight_id, character_id: bot.ids.character_id, cell })
    assert(placed?.res?.ok, `place failed for ${bot.name}: ${placed?.res?.abort ?? 'no receipt'}`)
  }
  return wait_until(
    'the fight leaves placement',
    async () => {
      const state = await read_fight_table(bots[0].client, fight_id)
      if (state.status === 1 || is_terminal_fight_status(state.status)) return state
      if (state.placement_deadline_ms > 0 && Date.now() >= state.placement_deadline_ms)
        await bots[0].driver.force_start({ fight_id })
      return null
    },
    { timeout_ms: 90_000 }
  )
}

/**
 * Drive a live fight to a terminal status: whoever the queue hands the turn to acts, and the ORDER the chain
 * handed turns out is recorded (that record is the coop leg's turn-order proof).
 */
async function drive_to_terminal(bots, fight_id, { max_turns = 24 } = {}) {
  const by_character = Object.fromEntries(bots.map((bot) => [bot.ids.character_id, bot]))
  const turn_order = []
  const actions_by_bot = new Map()
  for (let turn = 0; turn < max_turns; turn += 1) {
    const state = await read_fight_table(bots[0].client, fight_id)
    if (is_terminal_fight_status(state.status)) break
    const seat = active_seat(state)
    if (!seat) {
      await sleep(POLL_MS) // a mob holds the slot — the chain resolves mob waves inside the pass that opened them
      continue
    }
    const bot = by_character[seat.character]
    assert(bot, `the turn queue handed the turn to an unknown character ${seat.character}`)
    turn_order.push(bot.name)
    const actions = await take_turn(bot, fight_id, seat)
    actions_by_bot.set(bot.name, (actions_by_bot.get(bot.name) ?? 0) + actions.filter((a) => a !== 'pass').length)
  }
  const final = await read_fight_table(bots[0].client, fight_id)
  return { final, turn_order, actions_by_bot }
}

/** One bot's whole turn: close on the nearest living mob, strike while AP allows, then end the turn. */
async function take_turn(bot, fight_id, seat) {
  const actions = []
  let state = await read_fight_table(bot.client, fight_id)
  const living = () => state.mobs.filter((m) => m.hp > 0)
  const me = () => state.participants.find((p) => p.character === seat.character)
  // Every LIVING body blocks a cell, allies included — pathing that only avoided mobs walked a coop bot straight
  // into its teammate and the chain refused the whole move (`actions::EIllegalMove`). A solo fight never has an
  // ally to collide with, which is exactly why this only ever surfaced with two bots on one board.
  const occupied = () => [...living(), ...state.participants.filter((p) => p.character !== seat.character && p.hp > 0)]

  const target = living().reduce(
    (best, m) => (best == null || manhattan(me().cell, m.cell) < manhattan(me().cell, best.cell) ? m : best),
    null
  )
  if (target && manhattan(me().cell, target.cell) > 1) {
    const destination = step_toward(me().cell, target.cell, me().mp, state.walls, occupied())
    if (destination != null) {
      const moved = await bot.driver.act_move({ fight_id, character_id: seat.character, cell: destination })
      assert(moved?.res?.ok, `act_move failed for ${bot.name}: ${moved?.res?.abort_code ?? 'no receipt'}`)
      actions.push('move')
      state = await read_fight_table(bot.client, fight_id)
    }
  }

  for (let strike = 0; strike < 6; strike += 1) {
    if (is_terminal_fight_status(state.status)) return actions
    const self = me()
    const adjacent = state.mobs.find((m) => m.hp > 0 && manhattan(self.cell, m.cell) === 1)
    if (!adjacent || self.ap < self.weapon_ap_cost || self.hp <= 0) break
    const hit = await bot.driver.act_weapon({ fight_id, character_id: seat.character, target_cell: adjacent.cell })
    assert(hit?.res?.ok, `act_weapon failed for ${bot.name}: ${hit?.res?.abort_code ?? 'no receipt'}`)
    actions.push('weapon')
    state = await read_fight_table(bot.client, fight_id)
  }

  if (is_terminal_fight_status(state.status)) return actions
  await wait_for_pass_window(state)
  const passed = await bot.driver.act_pass({ fight_id, character_id: seat.character })
  assert(passed?.res?.ok, `act_pass failed for ${bot.name}: ${passed?.res?.abort_code ?? 'no receipt'}`)
  actions.push('pass')
  return actions
}

/** Greedy manhattan reduction over standable cells — the real path cost never exceeds the step count. */
function step_toward(from, to, mp, walls, mobs) {
  const standable = (cell) =>
    cell >= 0 && cell < 380 && !walls.has(cell) && !mobs.some((m) => m.hp > 0 && m.cell === cell)
  const neighbours = (cell) => {
    const out = []
    if (cell_x(cell) > 0) out.push(cell - 1)
    if (cell_x(cell) < GRID_W - 1) out.push(cell + 1)
    if (cell_y(cell) > 0) out.push(cell - GRID_W)
    out.push(cell + GRID_W)
    return out
  }
  let goal = null
  for (const n of neighbours(to))
    if (standable(n) && (goal == null || manhattan(from, n) < manhattan(from, goal))) goal = n
  if (goal == null || goal === from) return null
  let current = from
  for (let step = 0; step < mp && current !== goal; step += 1) {
    const next = neighbours(current)
      .filter(standable)
      .reduce((best, n) => (best == null || manhattan(n, goal) < manhattan(best, goal) ? n : best), null)
    if (next == null || manhattan(next, goal) >= manhattan(current, goal)) break
    current = next
  }
  return current === from ? null : current
}

// ── LEG 1 · SOLO ────────────────────────────────────────────────────────────────────────────────────────────
async function leg_solo({ manifest }) {
  const [solo] = identities(manifest)
  const bot = await make_bot({ manifest, wallet: solo.wallet, character: solo.character, name: 'solo' })
  const world = await read_world(bot.client, manifest.world_id)
  const zone = await discover_zone(bot, manifest, world)
  const fight_id = await create_open_fight(bot, world, zone)
  await place_and_start([bot], fight_id)
  const { final, turn_order } = await drive_to_terminal([bot], fight_id)

  assert(is_terminal_fight_status(final.status), `solo fight not terminal (status=${final.status})`)
  const settle = await bot.driver.settle_open_world({ fight_id, ...bot.ids })
  assert(settle?.res?.ok, `solo settle failed: ${settle?.res?.abort ?? 'no settle receipt'}`)
  const xp_share = Number(settle.res.event('::results::ResultOpened')?.xp_share ?? 0)
  assert(xp_share > 0, `solo settled with no xp (xp_share=${xp_share}) — a victory must pay`)

  return {
    fight_id,
    status: final.status,
    turns: turn_order.length,
    outcome: 'victory',
    xp_share,
    result_id: settle.result_id,
  }
}

// ── LEG 2 · COOP ────────────────────────────────────────────────────────────────────────────────────────────
async function leg_coop({ manifest }) {
  const [, first, second] = identities(manifest)
  const [a, b] = await Promise.all([
    make_bot({ manifest, wallet: first.wallet, character: first.character, name: 'coop_a' }),
    make_bot({ manifest, wallet: second.wallet, character: second.character, name: 'coop_b' }),
  ])
  const world = await read_world(a.client, manifest.world_id)
  const zone = await discover_zone(a, manifest, world)

  const fight_id = await create_open_fight(a, world, zone)

  // B joins during PLACEMENT — `fight::join` is a plain public call, so it goes through the SDK builder directly.
  const joined = await submit({
    client: b.client,
    signer: b.signer,
    budget: GAS_BUDGET,
    tx: join_fight_ptb(b.context)({
      fight_id,
      kiosk_id: b.ids.kiosk_id,
      personal_kiosk_cap_id: b.ids.personal_kiosk_cap_id,
      character_id: b.ids.character_id,
    }),
  })
  assert(joined?.ok, `coop join failed: ${joined?.abort_code ?? joined?.error ?? 'no receipt'}`)

  const seated = await wait_until(
    'both characters seated in the coop fight',
    async () => {
      const state = await read_fight_table(a.client, fight_id)
      const characters = state.participants.map((p) => p.character)
      return characters.includes(a.ids.character_id) && characters.includes(b.ids.character_id) ? state : null
    },
    { timeout_ms: 30_000 }
  )
  assert(seated.participants.length >= 2, `coop fight seated ${seated.participants.length} participants, expected 2`)

  await place_and_start([a, b], fight_id)
  // Capture the read layer's view WHILE the fight is live: the per-world index carries LIVE fights, so a
  // terminal one is legitimately gone from it — asserting after the fact would be asserting the wrong thing.
  const indexer = await capture_live_projection(manifest, fight_id)
  const { final, turn_order, actions_by_bot: acted } = await drive_to_terminal([a, b], fight_id)

  assert(is_terminal_fight_status(final.status), `coop fight never reached a terminal status (${final.status})`)
  assert(turn_order.includes('coop_a') && turn_order.includes('coop_b'), `only one bot ever held a turn: ${turn_order}`)
  assert(
    turn_order.some((name, i) => i > 0 && name !== turn_order[i - 1]),
    `the turn never changed hands — turn order not respected: ${turn_order.join(' → ')}`
  )

  return {
    fight_id,
    status: final.status,
    participants: final.participants.length,
    turn_order: turn_order.join('→'),
    actions_by_bot: Object.fromEntries(acted),
    indexer,
  }
}

/**
 * The indexer's projection of a LIVE fight (`/v1/fights?world=…`), waited for with a bound because checkpoint
 * ingestion is asynchronous. Failure is returned as data — the spectate leg decides whether an unreachable read
 * layer is fatal, and never reports a green it did not observe.
 */
async function capture_live_projection(manifest, fight_id) {
  try {
    return await wait_until(
      'the indexer projects the live fight',
      async () => {
        const response = await fetch(`${manifest.api}/v1/fights?world=${manifest.world_id}`).catch(() => null)
        if (!response?.ok) return null
        const row = ((await response.json()).fights ?? []).find((f) => f.fight_id === fight_id)
        return row ? { status: row.status, characters: (row.participants ?? []).map((p) => p.character).sort() } : null
      },
      { timeout_ms: 60_000, interval_ms: 500 }
    )
  } catch (error) {
    return { unavailable: error.message }
  }
}

/**
 * Four distinct identities — [solo, coop_a, coop_b, idler] — one character per WALLET so no two legs ever share
 * a seat (a shared character would let one leg's fight state leak into another's asserts). Derived from the
 * manifest's own roster rather than fixed indices, so it holds for any boot that funds four actors.
 */
function identities(manifest) {
  const seen = new Set()
  const rows = []
  for (const character of manifest.characters) {
    const index = character.wallet_index ?? character.wallet
    const wallet = manifest.wallets[index]
    if (seen.has(index) || !wallet?.privkey) continue
    seen.add(index)
    rows.push({ character, wallet })
  }
  assert(rows.length >= 4, `need 4 distinct funded identities, found ${rows.length}`)
  return rows
}

// ── LEG 3 · SPECTATE ────────────────────────────────────────────────────────────────────────────────────────
// A third identity that NEVER seats follows the same fight from reads alone. Its reconstruction must equal the
// players' end state — fold parity at the read level. The chain object is the oracle; /v1 is asserted too when
// the read layer has projected the fight, and its absence is REPORTED, never silently passed.
async function leg_spectate({ manifest, coop }) {
  assert(coop?.fight_id, 'spectate needs the coop fight — that leg must run first')
  const { fight_id } = coop

  // A bare read client: no signer, no seat, nothing but the RPC — exactly an unauthenticated observer.
  const observer = make_client(manifest.rpc, 'localnet')
  const seen = await read_fight_table(observer, fight_id)

  assert(is_terminal_fight_status(seen.status), `spectator sees a non-terminal fight (status=${seen.status})`)
  assert(
    seen.participants.length === coop.participants,
    `spectator reconstructs ${seen.participants.length} seats, players ended with ${coop.participants}`
  )

  const projection = seen.participants.map((p) => ({ character: p.character, hp: p.hp, cell: p.cell }))
  assert(
    projection.every((p) => Number.isFinite(p.hp) && Number.isFinite(p.cell)),
    'spectator projection carries a non-numeric hp/cell — the decode is lying rather than failing'
  )

  // FOLD PARITY AT THE READ LEVEL: the indexer's live projection of this same fight must name the SAME seats
  // the chain does. An unreachable or never-projected read layer FAILS here — it is never reported as a pass.
  const { indexer } = coop
  assert(!indexer?.unavailable, `the indexer never projected the live fight: ${indexer?.unavailable}`)
  const chain_characters = seen.participants.map((p) => p.character).sort()
  assert(
    JSON.stringify(indexer.characters) === JSON.stringify(chain_characters),
    `indexer seats ${JSON.stringify(indexer.characters)} ≠ chain seats ${JSON.stringify(chain_characters)}`
  )

  return {
    fight_id,
    status: seen.status,
    seats_reconstructed: projection.length,
    hp_at_end: projection.map((p) => p.hp).join(','),
    indexer: `live projection matched ${indexer.characters.length} seats (status ${indexer.status})`,
  }
}

// ── LEG 4 · TIMEOUT ─────────────────────────────────────────────────────────────────────────────────────────
// A bot seats, the fight starts, and then it does NOTHING. The permissionless `turns::crank` must forfeit the
// overdue turn and carry the fight forward. A wedged fight — the class that burned us — fails this leg.
async function leg_timeout({ manifest }) {
  const [, , , idler_identity] = identities(manifest)
  const idler = await make_bot({
    manifest,
    wallet: idler_identity.wallet,
    character: idler_identity.character,
    name: 'idler',
  })

  // The dial is captured INTO the Fight at creation, so shrink it, create, then restore: a 45s default would
  // spend three quarters of the whole matrix's budget idling.
  await set_turn_dial(manifest, TURN_MS_MIN)
  let fight_id = null
  try {
    const world = await read_world(idler.client, manifest.world_id)
    const zone = await discover_zone(idler, manifest, world)
    fight_id = await create_open_fight(idler, world, zone)

    const ready = await wait_until(
      'timeout fight readable',
      async () => {
        const state = await read_fight_table(idler.client, fight_id)
        return state.start_a.length > 0 || state.participants.length > 0 ? state : null
      },
      { timeout_ms: 20_000 }
    )
    const placed = await idler.driver.place({
      fight_id,
      character_id: idler.ids.character_id,
      cell: ready.start_a[0] ?? ready.participants[0].cell,
    })
    assert(placed?.res?.ok, `timeout place failed: ${placed?.res?.abort_code ?? 'no receipt'}`)

    const active = await wait_until(
      'timeout fight active',
      async () => {
        const state = await read_fight_table(idler.client, fight_id)
        if (state.status === 1) return state
        if (state.placement_deadline_ms > 0 && Date.now() >= state.placement_deadline_ms)
          await idler.driver.force_start({ fight_id })
        return null
      },
      { timeout_ms: 60_000 }
    )
    assert(active.turn_deadline_ms > 0, 'an active fight carries no turn deadline — nothing could ever crank it')

    // THE IDLE: do nothing at all until the turn is genuinely overdue.
    const before = active
    await sleep(before.turn_deadline_ms - Date.now() + 750)
    const overdue = await read_fight_table(idler.client, fight_id)
    assert(
      Date.now() >= overdue.turn_deadline_ms,
      `the turn deadline moved without anyone acting (${overdue.turn_deadline_ms})`
    )

    const cranked = await idler.driver.crank({ fight_id })
    assert(cranked?.res?.ok, `crank refused an overdue fight: ${cranked?.res?.abort_code ?? 'no receipt'}`)

    const advanced = await wait_until(
      'the cranked fight moves forward',
      async () => {
        const state = await read_fight_table(idler.client, fight_id)
        const moved =
          is_terminal_fight_status(state.status) ||
          state.turn_deadline_ms > before.turn_deadline_ms ||
          state.turn_ptr !== before.turn_ptr
        return moved ? state : null
      },
      { timeout_ms: 30_000 }
    )

    return {
      fight_id,
      turn_ms: before.turn_ms,
      idled_past_deadline: true,
      crank_digest: cranked?.res?.digest ?? null,
      advanced_to: is_terminal_fight_status(advanced.status)
        ? `terminal(${advanced.status})`
        : advanced.turn_ptr !== before.turn_ptr
          ? `turn_ptr ${before.turn_ptr}→${advanced.turn_ptr}`
          : `turn rearmed (+${advanced.turn_deadline_ms - before.turn_deadline_ms}ms deadline)`,
    }
  } finally {
    await set_turn_dial(manifest, DEFAULT_TURN_MS).catch((error) =>
      log(`WARNING: turn dial not restored — ${error.message}`)
    )
  }
}

/** Admin-dial the global turn duration. The publisher owns the AdminCap on this disposable chain. */
async function set_turn_dial(manifest, value_ms) {
  const ids = manifest.ids.aresrpg
  const client = make_client(manifest.rpc, 'localnet')
  const signer = await signerOf(manifest.publisher.privkey)
  const tx = new Transaction()
  tx.moveCall({
    target: `${ids.LATEST_PACKAGE_ID}::config::set_turn_duration_ms`,
    arguments: [
      tx.object(ids.ADMIN_ARESRPG),
      tx.object(ids.GAME_CONFIG),
      tx.pure.u64(value_ms),
      tx.object(ids.VERSION),
    ],
  })
  const result = await submit({ client, signer, tx, budget: GAS_BUDGET })
  assert(result?.ok, `set_turn_duration_ms(${value_ms}) failed: ${result?.abort_code ?? result?.error ?? 'no receipt'}`)
  return result
}

// ── LEG 5 · CRAFT ───────────────────────────────────────────────────────────────────────────────────────────
// The active corpus seeds live iron-ore nodes, so this leg uses the real gather/job acquisition path rather than
// an admin fixture grant. Gathering is tool-gated: the preferred melee mob guarantees the starter farmer tool in
// its loot table, so the bot first wins + settles a real fight, mints that sanctioned rolled drop, equips it, then
// gathers. Every craft attempt consumes TWO distinct gathered stacks through Driver.craft → SDK craft_ptb. This is
// both the #1494 driven starter craft and the cheap cross-stack case; the bounded pool absorbs the reference 50%
// level-1 success roll without ever retrying an executed failure as though it had not happened.
async function leg_craft(input) {
  return drive_craft(input)
}

async function drive_craft({ manifest }) {
  const [crafter_identity] = identities(manifest)
  const bot = await make_bot({
    manifest,
    wallet: crafter_identity.wallet,
    character: crafter_identity.character,
    name: 'crafter',
  })
  const starter = manifest.seed?.recipes?.[0]
  assert(starter?.recipe && starter?.output, 'the active seed carries no starter recipe/output ids')

  const recipe_fields = await get_fields(bot.client, starter.recipe)
  const ingredients = (recipe_fields?.inputs ?? []).map(unwrap)
  assert(ingredients.length === 1, `starter recipe has ${ingredients.length} ingredient rows, expected 1`)
  const ingredient_template_id = String(ingredients[0]?.template ?? '')
  const ingredient_need = Number(ingredients[0]?.quantity ?? 0)
  const ore_template_id = manifest.seed?.items?.iron_ore
  assert(
    ingredient_template_id === ore_template_id && ingredient_need >= 2,
    `starter recipe is not the seeded iron_ore cross-stack recipe (template=${ingredient_template_id}, need=${ingredient_need})`
  )

  // Bootstrap the gather tool through ordinary fight loot: no admin mint and no fixture grant.
  const world = await read_world(bot.client, manifest.world_id)
  const zone = await discover_zone(bot, manifest, world)
  const fight_id = await create_open_fight(bot, world, zone)
  await place_and_start([bot], fight_id)
  const fought = await drive_to_terminal([bot], fight_id)
  assert(is_terminal_fight_status(fought.final.status), `craft bootstrap fight not terminal (${fought.final.status})`)
  const settle = await bot.driver.settle_open_world({ fight_id, ...bot.ids })
  assert(settle?.res?.ok && settle.result_id, `craft bootstrap settle failed: ${settle?.res?.abort ?? 'no result'}`)
  assert(
    Number(settle.res.event('::results::ResultOpened')?.xp_share ?? 0) > 0,
    'craft bootstrap fight did not win — no sanctioned loot path is available'
  )

  const tool_template_id = manifest.seed?.items?.tool_farmer
  assert(tool_template_id, 'the active seed carries no starter farmer tool template')
  const tool = await bot.driver.mint_rolled({
    result_id: settle.result_id,
    item_template_id: tool_template_id,
    ...bot.ids,
  })
  assert(tool?.res?.ok && tool.item_id, `starter tool loot mint failed: ${tool?.res?.abort ?? 'no item'}`)
  const equipped = await bot.driver.equip({
    ...bot.ids,
    item_id: tool.item_id,
    item_template_id: tool_template_id,
  })
  assert(equipped?.res?.ok, `starter farmer tool equip failed: ${equipped?.res?.abort ?? 'no receipt'}`)

  // The dialled rig authors exactly 16 nodes in every discovered zone. Pre-gather the bounded attempt pool while
  // each tier-1 harvest yields one unit, preserving two distinct input objects for EVERY probabilistic attempt.
  const wanted_stacks = ingredient_need * CRAFT_MAX_ATTEMPTS
  const nodes = zone.nodes.filter((node) => node.template_id === ore_template_id && node.remaining > 0)
  assert(nodes.length >= wanted_stacks, `need ${wanted_stacks} live starter-material nodes, found ${nodes.length}`)
  const gathered_stacks = []
  for (const node of nodes.slice(0, wanted_stacks)) {
    const gathered = await bot.driver.gather({
      world_id: world.id,
      ...bot.ids,
      zx: zone.zx,
      zy: zone.zy,
      node_index: node.node_index,
      template_id: ore_template_id,
      protector_template_id: zone.mob.template_id,
    })
    const event = gathered?.res?.event('::gathering::ResourceGathered')
    const amount = Number(event?.quantity ?? 0)
    assert(
      gathered?.res?.ok && gathered.item_id,
      `gather node ${node.node_index} failed: ${gathered?.res?.abort ?? 'no item'}`
    )
    assert(amount === 1, `gather node ${node.node_index} yielded ${amount}, expected one unit for cross-stack proof`)
    gathered_stacks.push({ id: gathered.item_id, amount })
  }

  let available = gathered_stacks
  let successful = null
  let attempts = 0
  for (; attempts < CRAFT_MAX_ATTEMPTS; attempts += 1) {
    const input_item_ids = covering_stack_ids(available, ingredient_need)
    assert(input_item_ids?.length >= 2, `attempt ${attempts + 1} did not select two covering material stacks`)
    const crafted = await bot.driver.craft({
      recipe_id: starter.recipe,
      ...bot.ids,
      input_item_ids,
      output_template_id: starter.output,
    })
    assert(crafted?.res?.ok, `SDK craft PTB refused legal inputs: ${crafted?.res?.abort ?? 'no receipt'}`)
    const event = crafted.res.event('::crafting::Crafted')
    assert(event?.recipe === starter.recipe, 'craft receipt carries no matching Crafted event')
    available = available.filter((stack) => !input_item_ids.includes(stack.id))
    if (!event.success) {
      assert(!crafted.item_id, 'a failed craft roll unexpectedly created an Item')
      continue
    }
    assert(crafted.item_id, 'a successful craft event produced no Item object id')
    successful = {
      digest: crafted.res.digest,
      output_item_id: crafted.item_id,
      input_stack_count: input_item_ids.length,
    }
    break
  }
  assert(successful, `starter craft missed ${CRAFT_MAX_ATTEMPTS} bounded success rolls`)

  const output = await wait_until(
    `crafted output ${successful.output_item_id} lands in character kiosk ${bot.ids.kiosk_id}`,
    async () => {
      const object = await get_object(bot.client, successful.output_item_id).catch(() => null)
      const wrapper_id = object?.owner?.ObjectOwner
      const wrapper = wrapper_id ? await get_object(bot.client, wrapper_id).catch(() => null) : null
      const kiosk_id = wrapper?.owner?.ObjectOwner
      const template = object?.content?.fields?.template
      return kiosk_id === bot.ids.kiosk_id && template === starter.output ? object : null
    },
    { timeout_ms: 20_000 }
  )
  assert(output, 'crafted output kiosk readback returned no object')

  return {
    recipe: starter.label ?? starter.recipe,
    craft_digest: successful.digest,
    output_item_id: successful.output_item_id,
    kiosk_id: bot.ids.kiosk_id,
    material_acquisition: 'gather/job (tool from sanctioned fight loot; ore from seeded zone nodes)',
    craft_attempts: attempts + 1,
    cross_stack: `${successful.input_stack_count} gathered stacks (sum-covers)`,
  }
}

// ── boot ────────────────────────────────────────────────────────────────────────────────────────────────────
// The SAME primitives `test/gold/up_gold.mjs` boots with, in the same order, stopping at what a FIGHT needs:
// stack → isolated CLI config → publish (ceremony + enable) → seed → admin dials → funded actors + characters.
// up_gold continues into the browser suite's fixtures (marketplace sales, runtime catalogs, full-kit levelling);
// those need the private seed repo's authored corpus and none of them is reachable from a fight, so this boot
// stops short of them deliberately. The corpus is `active` — packages/move/scripts/seed_content.json, which
// ships IN this repo, so CI needs no private content and no secrets.
const BOOT_ACTORS = 4

async function boot() {
  const t0 = Date.now()
  fs.rmSync(P.DEPLOY, { force: true })
  ensureDeps()

  const [sponsor] = await genKeypairs(1)
  bootStack(sponsor.privkey)
  const chain_id = await waitHealthy()
  await waitApi()
  log(`localnet healthy · chainId=${chain_id} · api=${API}`)

  prepIsolatedConfig()
  prepMoveCopy()
  const [publisher] = await genKeypairs(1)
  await faucet(publisher.address, 4)
  importSigner(publisher)
  const kiosk = publishKiosk()
  log(`kiosk published → ${kiosk}`)

  const { actors } = JSON.parse(
    fs.readFileSync(path.join(P.REPO, 'packages', 'sdk', 'src', 'deployment', 'release.json'), 'utf8')
  ).networks.testnet
  process.env.ARES_OWNER_ADDRESS = actors.owner
  process.env.ARES_TREASURY_ADDRESS = actors.treasury
  process.env.STAMP_ALL_TARGET = path.join(P.BUILD, 'scripts', 'out', 'release.json')
  runCeremony(publisher.privkey)
  runEnable(publisher.privkey)
  process.env.GOLD_CORPUS = 'active'
  runSeed(publisher.privkey)

  const { cer, seed } = readManifests()
  const ids = sdkBlock(cer)
  const world_id = seed.world?.id
  assert(world_id, 'the seed manifest carries no world id — nothing to fight in')

  const client = await makeClient()
  // Keep the world's AUTHORED zone geometry: the seeded world anchors mob difficulty on its spawn zone, and
  // re-dialling zone_size afterwards moves every spawn far off that anchor, leaving a world with no eligible
  // mobs at all — searches still succeed, so it looks fine right up until no fight can ever be created.
  const authored = await read_world(make_client(RPC, 'localnet'), world_id)
  const dials = await adminDials({
    client,
    signer: await signerOf(publisher.privkey),
    ids,
    world_id,
    zone_size: authored.zone_size,
  })
  assert(dials.ok, `admin dials failed on-chain: ${dials.abort} (digest ${dials.digest})`)
  log(`world dials applied · zone_size preserved at ${authored.zone_size}`)

  const wallets = await genKeypairs(BOOT_ACTORS)
  for (const wallet of wallets) await faucet(wallet.address, 2)
  const classes = ['senshi', 'yajin', 'tomoda', 'shugo']
  const characters = []
  for (const [index, wallet] of wallets.entries()) {
    const character_class = classes[index % classes.length]
    const minted = await tryCreateCharacter({
      client,
      wallet,
      ids,
      kiosk_pkg: kiosk,
      name: `bot_w${index}_${Date.now() % 100000}`,
      character_class,
    })
    assert(
      minted.ok && minted.character_id && minted.kiosk_id && minted.personal_kiosk_cap_id,
      `character mint failed for wallet ${index}: ${minted.reason ?? minted.abort ?? 'missing kiosk state'}`
    )
    characters.push({
      wallet: index,
      wallet_index: index,
      slot: 0,
      character_id: minted.character_id,
      kiosk_id: minted.kiosk_id,
      personal_kiosk_cap_id: minted.personal_kiosk_cap_id,
      class: character_class,
    })
    log(`character minted for w${index} (${character_class}) → ${minted.character_id}`)
  }

  const manifest = {
    network: 'localnet',
    chain_id,
    rpc: RPC,
    faucet: FAUCET,
    api: API,
    ids: { aresrpg: ids, kiosk },
    world_id,
    seed,
    publisher,
    wallets,
    characters,
    booted_ms: Date.now() - t0,
  }
  fs.mkdirSync(path.dirname(P.DEPLOY), { recursive: true })
  fs.writeFileSync(P.DEPLOY, JSON.stringify(manifest, null, 2))
  log(`boot complete in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${P.DEPLOY}`)
  return manifest
}

// ── runner ──────────────────────────────────────────────────────────────────────────────────────────────────
const LEGS = [
  { name: 'solo', run: leg_solo, timeout_ms: FIGHT_LEG_WALL_MS },
  { name: 'coop', run: leg_coop, timeout_ms: FIGHT_LEG_WALL_MS },
  { name: 'spectate', run: leg_spectate, timeout_ms: FIGHT_LEG_WALL_MS },
  { name: 'timeout', run: leg_timeout, timeout_ms: FIGHT_LEG_WALL_MS },
  { name: 'craft', run: leg_craft, timeout_ms: CRAFT_LEG_WALL_MS },
]

async function main() {
  const requested = (process.argv.find((a) => a.startsWith('--legs='))?.split('=')[1] ?? '').split(',').filter(Boolean)
  const selected = requested.length ? LEGS.filter((l) => requested.includes(l.name)) : LEGS

  // `--boot` stands the localnet up first (what CI does); without it the driver runs against a stack already up.
  if (process.argv.includes('--boot'))
    await run_boot_gate({
      boot,
      bound: with_timeout,
      timeout_ms: BOOT_WALL_MS,
      log,
    })
  if (!fs.existsSync(P.DEPLOY))
    throw new Error(`no manifest at ${P.DEPLOY} — run with --boot, or boot via node test/gold/up_gold.mjs`)
  const manifest = JSON.parse(fs.readFileSync(P.DEPLOY, 'utf8'))
  log(`manifest ${P.DEPLOY} · rpc=${manifest.rpc} · api=${manifest.api} · world=${manifest.world_id}`)

  const rows = []
  const carry = {}
  const started = Date.now()
  for (const leg of selected) {
    const row = await run_leg_gate({
      name: leg.name,
      run: leg.run,
      input: { manifest, ...carry },
      bound: with_timeout,
      timeout_ms: leg.timeout_ms,
    })
    rows.push(row)
    if (row.ok) {
      carry[leg.name] = row.detail
      log(`✓ ${leg.name} (${row.ms}ms) ${JSON.stringify(row.detail)}`)
    } else log(`✗ ${leg.name} · ${row.failure_kind} (${row.ms}ms) ${row.error}`)
  }

  const verdict = {
    ok: rows.every((r) => r.ok),
    failure_kind: rows.every((r) => r.ok) ? null : PRODUCT_FAIL,
    network: 'localnet',
    chain_id: manifest.chain_id,
    wall_ms: Date.now() - started,
    legs: rows,
  }
  fs.mkdirSync(P.OUT, { recursive: true })
  const out = path.join(P.OUT, 'fight_bots_verdict.json')
  fs.writeFileSync(out, JSON.stringify(verdict, null, 2))

  console.log(`\n${'LEG'.padEnd(10)}${'VERDICT'.padEnd(16)}${'WALL'.padEnd(10)}DETAIL`)
  for (const row of rows)
    console.log(
      `${row.leg.padEnd(10)}${(row.ok ? 'PASS' : row.failure_kind).padEnd(16)}` +
        `${`${(row.ms / 1000).toFixed(1)}s`.padEnd(10)}` +
        `${row.ok ? JSON.stringify(row.detail) : row.error}`
    )
  console.log(`\ntotal ${(verdict.wall_ms / 1000).toFixed(1)}s · verdict → ${out}`)
  return verdict.ok ? 0 : exit_code_for(PRODUCT_FAIL)
}

if (import.meta.main)
  main()
    .then((exit_code) => {
      process.exitCode = exit_code
    })
    .catch((error) => {
      const failure_kind = error.failure_kind ?? ENV_FAIL
      console.error(`[fight-bots] ${failure_kind}: ${error.stack ?? error.message}`)
      process.exitCode = exit_code_for(failure_kind)
    })
