// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Gold-only progression bootstrap for the isolated full-kit coop actors. Every level comes from the shipped
// enter/search/create/join/place/fight/settle/open doors; the final gate reads each Character's live Progression.
import { CHAIN_MIN_TURN_MS } from '../../../packages/fight/src/draft_budget.js'
import { build_context, make_kiosk_client } from '../../localnet/bots/framework/context.js'
import { Driver } from '../../localnet/bots/framework/driver.js'
import { join_fight_ptb, open_result_ptb, settle_fight_ptb } from '../../localnet/bots/framework/sdk.js'
import { get_fields, get_object, LOCALNET_GAS_BUDGET, submit, SubmitStats } from '../../localnet/bots/framework/sui.js'
import {
  is_terminal_fight_status,
  manhattan,
  poll_fight,
  reach_zone,
  read_fight,
} from '../../localnet/bots/framework/world_flow.js'
import { signerOf } from '../lib_gold.mjs'
import { split_verdict } from '../specs_multiplayer/coop_kernel.mjs'

const unwrap = (value) => (value && typeof value === 'object' && 'fields' in value ? value.fields : value)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const as_bool = (value) => value === true || value === 'true'
const GRID_WIDTH = 20
const GRID_CELLS = 380
const POLL_INTERVAL_MS = 100
const FIGHT_EFFECT_TIMEOUT_MS = 15_000
const MAX_FIGHT_ACTIONS = 128
const PASS_CLOCK_GRACE_MS = 100
class CoopFightTerminalTimeoutError extends Error {
  constructor(fight_id, fight) {
    super(
      `coop full-kit terminal poll timed out for fight ${fight_id} ` +
        `(status=${fight?.status ?? -1}, read=${fight?.read_error ?? 'none'})`
    )
    this.name = 'CoopFightTerminalTimeoutError'
  }
}
async function progression_field(client, character_id) {
  let cursor = null
  do {
    const page = await client.getDynamicFields({
      parentId: character_id,
      ...(cursor ? { cursor } : {}),
    })
    const row = (page.data ?? []).find((field) =>
      String(field.name?.type ?? '').includes('::character_link::ProgressionKey')
    )
    if (row?.objectId) return get_fields(client, row.objectId)
    cursor = page.hasNextPage ? page.nextCursor : null
  } while (cursor)
  return null
}
export async function read_character_progression(client, character_id) {
  const field = await progression_field(client, character_id)
  const value = unwrap(field?.value)
  if (value?.level == null || value?.xp == null) return null
  return { level: Number(value.level), xp: BigInt(value.xp) }
}
function driver_for({ client, ids, kiosk_pkg, wallet, signer }) {
  const kiosk_client = make_kiosk_client(client, 'testnet', {
    personalKioskRulePackageId: kiosk_pkg,
    kioskLockRulePackageId: kiosk_pkg,
    royaltyRulePackageId: kiosk_pkg,
  })
  const context = build_context({
    manifest: { ids: { aresrpg: ids } },
    network: 'localnet',
    kiosk_client,
  })
  return new Driver({
    bot: { name: 'coop_full_kit_bootstrap', address: wallet.address, keypair: signer },
    context,
    client,
    signer,
    coverage: { record: () => [] },
    stats: new SubmitStats(),
    // One rebuild is safe only for a thrown pre-execution fetch/version race. submit() returns every digest-bearing
    // abort immediately, so the leveler never repeats a gas-burning executed action.
    submit_fn: (args) => submit({ ...args, max_retries: 1 }),
    budget: LOCALNET_GAS_BUDGET,
  })
}
async function actor_for({ client, ids, kiosk_pkg, wallets, fighter }) {
  const wallet = wallets[fighter.wallet_index]
  if (!wallet) throw new Error(`coop full-kit fighter wallet ${fighter.wallet_index} is missing`)
  const signer = await signerOf(wallet.privkey)
  const driver = driver_for({ client, ids, kiosk_pkg, wallet, signer })
  driver.select_character(fighter)
  const character = {
    character_id: fighter.character_id,
    kiosk_id: fighter.kiosk_id,
    personal_kiosk_cap_id: fighter.personal_kiosk_cap_id,
  }
  return { fighter, driver, character }
}
const driven_failure = (stage, driven) =>
  driven?.res?.abort ??
  driven?.res?.error ??
  `${stage} failed (${driven?.res?.class ?? driven?.res?.status ?? 'unknown'})`
function require_driven(stage, driven) {
  if (!driven?.res?.ok) throw new Error(`coop full-kit ${stage}: ${driven_failure(stage, driven)}`)
  return driven
}
function drive_builder(actor, stage, builder, args) {
  return actor.driver._drive(stage, () => builder(actor.driver.context)(args))
}
const version_reached = (actual, expected) => {
  try {
    return BigInt(actual) >= BigInt(expected)
  } catch {
    return actual === expected
  }
}
async function read_party_fight(client, fight_id) {
  try {
    const object = await get_object(client, fight_id)
    const fields = object?.content?.fields
    if (!fields) throw new Error('missing Fight fields')
    const board = unwrap(fields.board) ?? {}
    const group = unwrap(fields.group) ?? {}
    const shape_mask = (board.shape_mask ?? []).map(BigInt)
    const off_shape = shape_mask.length
      ? Array.from({ length: GRID_CELLS }, (_, cell) => cell).filter(
          (cell) => (((shape_mask[Math.floor(cell / 64)] ?? 0n) >> BigInt(cell % 64)) & 1n) === 0n
        )
      : []
    const participants = (fields.participants ?? []).map(unwrap).map((participant) => ({
      character: String(participant.character),
      cell: Number(participant.cell ?? 0),
      hp: Number(participant.hp ?? 0),
      wisdom: Number(unwrap(participant.stats)?.wisdom ?? 0),
    }))
    const mobs = (fields.mobs ?? []).map(unwrap).map((mob) => ({
      cell: Number(mob.cell ?? 0),
      hp: Number(mob.hp ?? 0),
    }))
    const active = unwrap((fields.queue ?? [])[Number(fields.turn_ptr ?? 0)])
    return {
      status: Number(fields.status ?? -1),
      read_error: null,
      participants,
      mobs,
      active_character:
        active && !as_bool(active.is_mob) ? (participants[Number(active.idx ?? 0)]?.character ?? null) : null,
      turn_deadline_ms: Number(fields.turn_deadline_ms ?? 0),
      turn_ms: Number(fields.turn_ms ?? 0),
      start_a: (board.start_cells_a ?? []).map(Number),
      walls: new Set([...off_shape, ...(board.obstacles ?? []).map(Number), ...(board.holes ?? []).map(Number)]),
      group_xp: BigInt(group.xp ?? 0),
      aged_bp: Number(fields.aged_bp ?? 0),
      xp_mult: Number(fields.xp_mult ?? 0),
    }
  } catch (error) {
    return { status: -1, read_error: String(error?.message ?? error) }
  }
}
async function require_party_fight({ client, fight_id, stage, predicate, timeout_ms = FIGHT_EFFECT_TIMEOUT_MS }) {
  const expires_at = Date.now() + timeout_ms
  let state = await read_party_fight(client, fight_id)
  while ((state.read_error != null || !predicate(state)) && Date.now() < expires_at) {
    await sleep(POLL_INTERVAL_MS)
    state = await read_party_fight(client, fight_id)
  }
  if (state.read_error != null || !predicate(state))
    throw new Error(
      `coop full-kit ${stage} timed out for fight ${fight_id} ` +
        `(status=${state.status}, read=${state.read_error ?? 'none'})`
    )
  return state
}
async function require_fight_effect({ client, fight_id, character_id, previous_version, driven, stage }) {
  const expected_version = (driven?.res?.objectChanges ?? []).find(
    (change) => change?.objectId === fight_id && (change.type === 'mutated' || change.type === 'created')
  )?.version
  const visible = await poll_fight({
    client,
    fight_id,
    character_id,
    predicate: (fight) =>
      fight.status !== -1 &&
      (expected_version == null
        ? previous_version == null || String(fight.version) !== String(previous_version)
        : version_reached(fight.version, expected_version)),
  })
  if (!visible.matched)
    throw new Error(
      `coop full-kit ${stage} timed out for fight ${fight_id} ` +
        `(status=${visible.fight.status}, read=${visible.fight.read_error ?? 'none'})`
    )
  return visible.fight
}
async function discover_leveler_group({ driver, client, character, game_ids, world, fixture }) {
  let last = null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    last = await reach_zone({
      driver,
      client,
      ids: character,
      world,
      pkg_origin: game_ids.PACKAGE_ID,
      prefer_template: fixture.mob_template_id,
    })
    if (last?.mob?.template_id === fixture.mob_template_id) return last
  }
  throw new Error(`coop full-kit leveler found no live group after 6 searches: ${JSON.stringify(last?.trace ?? [])}`)
}
async function create_public_fight({ senshi, client, ids, world, fixture }) {
  const zone = await discover_leveler_group({
    driver: senshi.driver,
    client,
    character: senshi.character,
    game_ids: ids,
    world,
    fixture,
  })
  const created = require_driven(
    'senshi create public fight',
    await senshi.driver.create_fight({
      world_id: world.id,
      ...senshi.character,
      spawn_id: zone.mob.spawn_id,
      zx: zone.zx,
      zy: zone.zy,
      mob_template_id: zone.mob.template_id,
      is_public: true,
      party_id: null,
    })
  )
  if (!created.fight_id) throw new Error('coop full-kit create returned no fight id')
  await require_party_fight({
    client,
    fight_id: created.fight_id,
    stage: 'create visibility',
    predicate: (fight) => fight.status === 0 && fight.participants.length === 1 && fight.start_a.length > 0,
  })
  return created.fight_id
}
async function join_all({ actors, senshi, client, fight_id }) {
  let expected_seats = 1
  for (const actor of actors) {
    if (actor === senshi) continue
    require_driven(
      `${actor.fighter.class} join public fight`,
      await drive_builder(actor, 'join_fight', join_fight_ptb, {
        fight_id,
        ...actor.character,
        party_id: null,
      })
    )
    expected_seats += 1
    await require_party_fight({
      client,
      fight_id,
      stage: `${actor.fighter.class} seat visibility`,
      predicate: (fight) => fight.status === 0 && fight.participants.length === expected_seats,
    })
  }
}
async function place_and_ready_all({ actors, senshi, client, fight_id }) {
  const placement = await require_party_fight({
    client,
    fight_id,
    stage: 'all seats before placement',
    predicate: (fight) => fight.status === 0 && fight.participants.length === actors.length,
  })
  const cells = new Map(placement.participants.map((participant) => [participant.character, participant.cell]))
  const occupied = new Set(
    placement.participants
      .filter((participant) => participant.character !== senshi.fighter.character_id)
      .map((participant) => participant.cell)
  )
  const [senshi_cell] = placement.start_a
    .filter((cell) => !occupied.has(cell) && path_to_mob(placement, senshi.fighter.character_id, cell) !== null)
    .sort(
      (left, right) =>
        path_to_mob(placement, senshi.fighter.character_id, left).length -
        path_to_mob(placement, senshi.fighter.character_id, right).length
    )
  if (senshi_cell == null) throw new Error(`coop full-kit senshi has no reachable start cell in fight ${fight_id}`)
  const ready_order = [...actors.filter((actor) => actor !== senshi), senshi]
  for (const actor of ready_order) {
    const before = await read_fight(client, fight_id, actor.fighter.character_id)
    const placed = require_driven(
      `${actor.fighter.class} place and ready`,
      await actor.driver.place({
        fight_id,
        character_id: actor.fighter.character_id,
        cell: actor === senshi ? senshi_cell : cells.get(actor.fighter.character_id),
      })
    )
    await require_fight_effect({
      client,
      fight_id,
      character_id: actor.fighter.character_id,
      previous_version: before.version,
      driven: placed,
      stage: `${actor.fighter.class} placement visibility`,
    })
  }
  return require_party_fight({
    client,
    fight_id,
    stage: 'last-ready activation',
    predicate: (fight) => fight.status === 1 || is_terminal_fight_status(fight.status),
  })
}
function neighbours(cell) {
  const x = cell % GRID_WIDTH
  const out = []
  if (x > 0) out.push(cell - 1)
  if (x < GRID_WIDTH - 1) out.push(cell + 1)
  if (cell >= GRID_WIDTH) out.push(cell - GRID_WIDTH)
  if (cell + GRID_WIDTH < GRID_CELLS) out.push(cell + GRID_WIDTH)
  return out
}
function path_to_mob(state, character_id, start_cell = null) {
  const self = state.participants.find((participant) => participant.character === character_id)
  const mob = state.mobs.find((row) => row.hp > 0)
  if (!self || !mob) return null
  const origin = start_cell ?? self.cell
  const blocked = new Set([
    ...state.participants
      .filter((participant) => participant.hp > 0 && participant.character !== character_id)
      .map((participant) => participant.cell),
    ...state.mobs.filter((row) => row.hp > 0).map((row) => row.cell),
  ])
  const queue = [origin]
  const previous = new Map([[origin, null]])
  let goal = null
  while (queue.length > 0) {
    const cell = queue.shift()
    if (manhattan(cell, mob.cell) === 1) {
      goal = cell
      break
    }
    for (const next of neighbours(cell)) {
      if (previous.has(next) || state.walls.has(next) || blocked.has(next)) continue
      previous.set(next, cell)
      queue.push(next)
    }
  }
  if (goal == null) return null
  const path = []
  for (let cell = goal; cell !== origin; cell = previous.get(cell)) path.push(cell)
  return path.reverse()
}
async function wait_for_pass_window(state) {
  if (state.turn_deadline_ms <= 0 || state.turn_ms <= 0) return
  const pass_at = state.turn_deadline_ms - state.turn_ms + CHAIN_MIN_TURN_MS
  const wait_ms = pass_at - Date.now() + PASS_CLOCK_GRACE_MS
  if (wait_ms > 0) await sleep(wait_ms)
}
async function drive_action({ actor, client, fight_id, action, args }) {
  const before = await read_fight(client, fight_id, actor.fighter.character_id)
  const driven = require_driven(
    `${actor.fighter.class} ${action}`,
    await actor.driver[action]({
      fight_id,
      character_id: actor.fighter.character_id,
      ...args,
    })
  )
  return require_fight_effect({
    client,
    fight_id,
    character_id: actor.fighter.character_id,
    previous_version: before.version,
    driven,
    stage: `${actor.fighter.class} ${action} visibility`,
  })
}
async function pass_turn({ actor, state, client, fight_id }) {
  await wait_for_pass_window(state)
  await drive_action({ actor, client, fight_id, action: 'act_pass', args: {} })
}
async function drive_senshi_turn({ senshi, state, client, fight_id }) {
  const board = await read_fight(client, fight_id, senshi.fighter.character_id)
  if (board.status !== 1) return
  const mob = board.mobs.find((row) => row.hp > 0)
  if (!mob) return
  if (board.self_cell == null || board.self_hp <= 0)
    throw new Error(`coop full-kit senshi cannot carry fight ${fight_id}: no living seat`)
  if (manhattan(board.self_cell, mob.cell) > 1) {
    if (board.self_mp <= 0) {
      await pass_turn({ actor: senshi, state, client, fight_id })
      return
    }
    const path = path_to_mob(state, senshi.fighter.character_id)
    if (!path?.length) throw new Error(`coop full-kit senshi has no path to the living mob in fight ${fight_id}`)
    const destination = path[Math.min(board.self_mp, path.length) - 1]
    await drive_action({
      actor: senshi,
      client,
      fight_id,
      action: 'act_move',
      args: { cell: destination },
    })
    return
  }
  if (board.self_ap >= board.self_weapon_ap_cost) {
    await drive_action({
      actor: senshi,
      client,
      fight_id,
      action: 'act_weapon',
      args: { target_cell: mob.cell },
    })
    return
  }
  await pass_turn({ actor: senshi, state, client, fight_id })
}
async function drive_to_terminal({ actors, senshi, client, fight_id }) {
  const by_character = new Map(actors.map((actor) => [actor.fighter.character_id, actor]))
  for (let action = 0; action < MAX_FIGHT_ACTIONS; action += 1) {
    const state = await require_party_fight({
      client,
      fight_id,
      stage: 'active turn',
      predicate: (fight) =>
        is_terminal_fight_status(fight.status) || (fight.status === 1 && fight.active_character != null),
    })
    if (is_terminal_fight_status(state.status)) return
    const actor = by_character.get(state.active_character)
    if (!actor) throw new Error(`coop full-kit fight ${fight_id} has unknown active seat ${state.active_character}`)
    if (actor === senshi) await drive_senshi_turn({ senshi, state, client, fight_id })
    else await pass_turn({ actor, state, client, fight_id })
  }
}
async function settle_victory_after_terminal_poll({ client, fight_id, senshi }) {
  const terminal = await poll_fight({
    client,
    fight_id,
    character_id: senshi.fighter.character_id,
    predicate: (fight) => is_terminal_fight_status(fight.status),
  })
  if (!terminal.matched) throw new CoopFightTerminalTimeoutError(fight_id, terminal.fight)
  if (terminal.fight.status !== 2)
    throw new Error(`coop full-kit leveling fight ${fight_id} ended in defeat (status ${terminal.fight.status})`)
  return require_driven(
    'settle observed terminal fight',
    await drive_builder(senshi, 'settle_fight', settle_fight_ptb, { fight_id })
  )
}

function verify_xp_split({ outcomes, actors, facts }) {
  const expected_characters = new Set(actors.map((actor) => actor.fighter.character_id))
  if (
    outcomes.length !== actors.length ||
    outcomes.some((outcome) => !expected_characters.delete(String(outcome.character))) ||
    expected_characters.size !== 0
  )
    throw new Error(
      `coop full-kit settlement minted [${outcomes.map((outcome) => outcome.character).join(', ')}], ` +
        `expected exactly [${actors.map((actor) => actor.fighter.character_id).join(', ')}]`
    )
  const verdict = split_verdict(
    outcomes.map((outcome) => ({
      character: String(outcome.character),
      outcome: Number(outcome.outcome),
      xp_share: String(outcome.xp_share),
      loot_len: 0,
    })),
    {
      total_xp: facts.group_xp * BigInt(facts.mobs.length),
      aged_bp: facts.aged_bp,
      xp_mult: facts.xp_mult,
      wisdom_by_character: Object.fromEntries(
        facts.participants.map((participant) => [participant.character, participant.wisdom])
      ),
    }
  )
  if (!verdict.ok) throw new Error(`coop full-kit XP split failed: ${verdict.reason}`)
}

async function open_all_outcomes({ actors, outcomes }) {
  const outcome_by_character = new Map(outcomes.map((outcome) => [String(outcome.character), outcome]))
  for (const actor of actors) {
    const outcome = outcome_by_character.get(actor.fighter.character_id)
    const opened = require_driven(
      `${actor.fighter.class} open fight outcome`,
      await drive_builder(actor, 'open_fight_outcome', open_result_ptb, {
        outcome_id: outcome.result,
        kiosk_id: actor.fighter.kiosk_id,
        personal_kiosk_cap_id: actor.fighter.personal_kiosk_cap_id,
      })
    )
    const event = opened.res.event('::results::ResultOpened')
    if (
      String(event?.character) !== actor.fighter.character_id ||
      BigInt(event?.xp_share ?? 0) !== BigInt(outcome.xp_share ?? 0)
    )
      throw new Error(`coop full-kit ${actor.fighter.class} opened the wrong XP outcome`)
  }
}

async function run_leveling_fight({ actors, senshi, client, ids, world, fixture }) {
  for (const actor of actors) {
    if (actor === senshi) continue
    require_driven(
      `${actor.fighter.class} enter_world`,
      await actor.driver.enter_world({ world_id: world.id, ...actor.character })
    )
  }
  const fight_id = await create_public_fight({ senshi, client, ids, world, fixture })
  await join_all({ actors, senshi, client, fight_id })
  const facts = await place_and_ready_all({ actors, senshi, client, fight_id })
  await drive_to_terminal({ actors, senshi, client, fight_id })
  const settled = await settle_victory_after_terminal_poll({ client, fight_id, senshi })
  const outcomes = (settled.res.events ?? [])
    .filter(
      (event) =>
        String(event?.type ?? '').endsWith('::fight_events::ResultMinted') &&
        String(event?.parsedJson?.fight) === fight_id
    )
    .map((event) => event.parsedJson)
  verify_xp_split({ outcomes, actors, facts })
  await open_all_outcomes({ actors, outcomes })
}

async function read_progressions(client, actors) {
  return new Map(
    await Promise.all(
      actors.map(async ({ fighter }) => [
        fighter.character_id,
        (await read_character_progression(client, fighter.character_id)) ?? {
          level: Number(fighter.level ?? 1),
          xp: 0n,
        },
      ])
    )
  )
}

async function require_progression_advance(client, actors, pending, before) {
  const expires_at = Date.now() + FIGHT_EFFECT_TIMEOUT_MS
  let current = await read_progressions(client, actors)
  while (
    pending.some((actor) => current.get(actor.fighter.character_id).xp <= before.get(actor.fighter.character_id).xp) &&
    Date.now() < expires_at
  ) {
    await sleep(POLL_INTERVAL_MS)
    current = await read_progressions(client, actors)
  }
  if (pending.every((actor) => current.get(actor.fighter.character_id).xp > before.get(actor.fighter.character_id).xp))
    return current
  const error = new Error('coop full-kit progression writes did not become visible after opening every outcome')
  error.name = 'CoopProgressionTimeoutError'
  throw error
}

/** Level the isolated full-kit actors through honest coop victories and return manifest-ready rows. */
export async function level_coop_full_kit_fighters({
  client,
  ids,
  kiosk_pkg,
  wallets,
  fighters,
  fixture,
  target_level = 100,
}) {
  if (!fixture?.world_id || !fixture?.mob_template_id)
    throw new Error('coop full-kit bootstrap requires the coop_full_kit_leveler fight fixture')
  const world_fields = await get_fields(client, fixture.world_id)
  if (!world_fields) throw new Error(`coop full-kit leveler world ${fixture.world_id} is unreadable`)
  const world = {
    id: fixture.world_id,
    offset_x: Number(world_fields.offset_x ?? 0),
    offset_z: Number(world_fields.offset_z ?? 0),
    zone_size: Number(world_fields.zone_size ?? fixture.zone_size),
  }
  const actors = []
  for (const fighter of fighters) actors.push(await actor_for({ client, ids, kiosk_pkg, wallets, fighter }))
  const senshi = actors.find((actor) => actor.fighter.class === 'senshi')
  if (!senshi) throw new Error('coop full-kit bootstrap requires a senshi damage carrier')

  let progressions = await read_progressions(client, actors)
  const max_fights = Math.max(8, actors.length * 4)
  for (let fight = 0; fight < max_fights; fight += 1) {
    const pending = actors.filter((actor) => progressions.get(actor.fighter.character_id)?.level < target_level)
    if (pending.length === 0)
      return actors.map((actor) => ({
        ...actor.fighter,
        level: progressions.get(actor.fighter.character_id).level,
      }))
    const seats = pending.includes(senshi) ? pending : [senshi, ...pending]
    const before = progressions
    await run_leveling_fight({ actors: seats, senshi, client, ids, world, fixture })
    progressions = await require_progression_advance(client, actors, pending, before)
  }
  throw new Error(
    `coop full-kit fighters did not reach L${target_level} after ${max_fights} coop fights: ` +
      actors
        .map((actor) => {
          const progression = progressions.get(actor.fighter.character_id)
          return `${actor.fighter.class}=L${progression?.level ?? 0}/xp${progression?.xp ?? 0}`
        })
        .join(', ')
  )
}
