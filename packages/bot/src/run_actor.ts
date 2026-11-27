// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { parse_market_observation, type MarketObservation } from '@aresrpg/protocol'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight'

import type { Journey } from './idle.ts'
import { observation_slot_busy } from './actor.ts'
import type { Command, Lane } from './control.ts'
import type { ControlStore } from './store.ts'
import type { Bot, BotConfig } from './model.ts'
import type { ActorSnapshot } from './actor_snapshot.ts'
import { type GameplayContext, hydrate_gameplay_fight } from './gameplay_context.ts'
import { direct_tick, run_tick, run_observation } from './run_runtime.ts'
import { direct_waiting } from './command_admission.ts'
import type { BehaviorRun as Run } from './behavior_script.ts'
import { market_observation_progress } from './actor_market.ts'
import { market_prices_observed } from './market_prices.ts'
import { retired_run } from './store_projection.ts'
import { released_run, run_live, run_key } from './run_ref.ts'
import { profession_item } from './catalog.ts'

type Observed = Pick<ActorSnapshot, 'characters' | 'fights'>

/** Chain time after which another wallet seated in the fight may pass this hero's live turn.
 * Infinity outside such a turn: in a fight seated only by this wallet a late turn loses nothing,
 * so it earns no priority over heroes that are not fighting. */
export const turn_deadline = (character_id: string, snapshot: Observed, address: string): number => {
  const seat = snapshot.characters.find(({ id }) => id === character_id)?.active_fight
  const row = seat && snapshot.fights[seat.id]
  if (!row) return Infinity
  const { contract } = hydrate_gameplay_fight(row)
  const contested = [
    contract.round > 0n,
    !contract.ended,
    contract.queue[Number(contract.turn_ptr)] === BigInt(seat.seat),
    contract.fighters.some(({ kind, dead, forfeited }) =>
      [kind.type === 'player' && kind.owner !== address, !dead, !forfeited].every(Boolean)
    ),
  ].every(Boolean)
  return contested ? Number(contract.turn_started_ms + CONTRACT_CONSTANTS.turn_max_ms) : Infinity
}

/** One wallet signs one transaction at a time. The queue holds heroes, never prebuilt transactions:
 * a hero whose turn another wallet could pass is asked first, the others in a ring after the last signer,
 * and each decides against fresh state only when it takes the slot. */
export const signing_order = (
  heroes: readonly string[],
  last_signer: string | undefined,
  deadline: (character_id: string) => number
): readonly string[] => {
  const ring = heroes.toSorted()
  const next = ring.findIndex((id) => id > (last_signer ?? ''))
  const waiting = next < 0 ? ring : [...ring.slice(next), ...ring.slice(0, next)]
  const due = new Map(waiting.map((id) => [id, deadline(id)]))
  // The sort is stable, so heroes without a running turn clock keep their ring order.
  return waiting.toSorted((left, right) =>
    Math.sign(Math.min(due.get(left)!, 1e300) - Math.min(due.get(right)!, 1e300))
  )
}
/** The run keys one scheduler pass asks, in signing order. The first `contested` of them have a turn
 * another wallet could pass: the wallet's waiting direct command signs right after those. */
const signing_queue = (lane: Lane, last_signer: string | undefined, snapshot: Observed | undefined) => {
  const runs = lane.runs ?? {}
  const due = new Map(
    Object.keys(runs).map((id) => [id, snapshot ? turn_deadline(id, snapshot, lane.address) : Infinity])
  )
  const heroes = signing_order(Object.keys(runs), last_signer, (id) => due.get(id)!)
  return {
    keys: heroes.map((id) => run_key(runs[id]!)),
    contested: heroes.filter((id) => due.get(id)! < Infinity).length,
  }
}
type RunOptions = Readonly<{
  store: ControlStore
  config: BotConfig
  actor_id: string
  report_failure: (error: unknown) => void
  now: () => number
  session: (
    bot: Bot,
    command: Command
  ) => Promise<
    Readonly<{
      context: GameplayContext
      fence: number
      journey: (character_id: string, journey: Journey | null) => void
      connect: () => Promise<void>
    }>
  >
}>
/** All retained objectives borrow the same live actor and fenced command lane. */
const process_bot_run = async (run: Run | null, watches: boolean, options: RunOptions) => {
  const { store, config, actor_id } = options
  if (!run || !['active', 'waiting'].includes(run.status)) return
  const bot = await store.read<Bot>(`bot:${run.bot_id}`)
  if (!bot) throw new Error('BOT_MISSING')
  const observation = run_observation(run)
  const session = await options.session(bot, watches ? observation : { ...observation, payload: {} })
  const input = {
    store,
    config,
    actor_id,
    report_failure: options.report_failure,
    context: session.context,
    fence: session.fence,
    journey: session.journey,
    now: options.now(),
  }
  const status = await run_tick({ ...input, run })
  if (['active', 'waiting'].includes(String(status))) await session.connect()
}

/** The offers a waiting purchase must read before it signs: those of its own item, asked under the
 * order's own identity so the view of an earlier order never serves it. Null for any other command. */
const purchase_view = (command: Command | null): MarketObservation | null => {
  if (command?.kind !== 'market_buy') return null
  const item_type = String(command.payload.item_type)
  const category = profession_item(item_type)?.category
  if (!category) return null
  const request = Buffer.from(command.id, 'base64url').readUIntBE(0, 6)
  return parse_market_observation({ kind: 'offers', category, item_type, request })
}
/** Points the wallet's one market view for a purchase, or gives it back with `null`. */
const point_view = async (bot: Bot, command: Command, market: MarketObservation | null, options: RunOptions) => {
  const session = await options.session(bot, { ...command, payload: { ...command.payload, market } })
  await session.connect()
}
/** What a waiting purchase still needs of the market view. `held` says the order holds the view. */
type Readiness = Readonly<{ wait?: true; refusal?: string; held: boolean }>
/** A purchase signs only once every current offer of its item is read; until then the view is asked
 * for the next page. A view another connector holds refuses the order: it must never wait for a
 * view it cannot get. */
const purchase_ready = async (
  bot: Bot,
  command: Command,
  snapshot: ActorSnapshot | undefined,
  options: RunOptions
): Promise<Readiness> => {
  const view = purchase_view(command)
  if (!view) return { held: false }
  const progress = market_observation_progress(view, snapshot?.inventory)
  if (progress.complete) return { held: true }
  try {
    await point_view(bot, command, progress.observation, options)
    return { wait: true, held: true }
  } catch (error) {
    if (!observation_slot_busy(error)) throw error
    return { refusal: 'market_unavailable', held: false }
  }
}
/** The order gives the view back once it holds the signing slot or is refused; while it still waits
 * for the slot the view stays live, so the offers it will be checked against stay current. */
const release_view = async (bot: Bot, command: Command, taken: Command | null, options: RunOptions) => {
  const waiting = !taken && (await options.store.read<Command>(`command:${command.id}`))?.status === 'accepted'
  if (!waiting) await point_view(bot, command, null, options)
}
/** The waiting direct command takes the signing slot when it is free, and is then ready to execute.
 * A purchase first reads the current offers of its item. */
const process_direct = async (command: Command, snapshot: ActorSnapshot | undefined, options: RunOptions) => {
  const { store, config, actor_id, report_failure } = options
  const bot = await store.read<Bot>(`bot:${command.bot_id}`)
  if (!bot) throw new Error('BOT_MISSING')
  const { wait, refusal, held } = await purchase_ready(bot, command, snapshot, options)
  if (wait) return null
  const { context, fence } = await options.session(bot, command)
  const input = { store, config, actor_id, report_failure, context, fence, now: options.now(), command, refusal }
  const taken = await direct_tick(input)
  if (held) await release_view(bot, command, taken, options)
  return taken
}

type Queued = readonly (readonly [key: string, run: Run | null])[]
/** Whether the wallet's one market view already shows what this hero's tree asked for. */
const served = (run: Run, snapshot: ActorSnapshot | undefined) =>
  [
    !run.observation || market_observation_progress(run.observation, snapshot?.inventory).complete,
    !run.prices || (snapshot !== undefined && market_prices_observed(run.prices, { snapshot })),
  ].every(Boolean)
/** A wallet has one market view. A waiting purchase takes it first. Otherwise it goes to the first
 * asking hero that does not have its data yet, so asking heroes take turns as each is served; with
 * nobody asking, one hero releases it. */
const market_watcher = (queue: Queued, snapshot: ActorSnapshot | undefined, direct: Command | null) => {
  if (purchase_view(direct)) return undefined
  const sorted = queue.toSorted(([left], [right]) => left.localeCompare(right))
  const asking = sorted.filter(([, run]) => run?.observation ?? run?.prices)
  const unserved = asking.find(([, run]) => !served(run!, snapshot))
  return (unserved ?? asking[0] ?? sorted[0])?.[0]
}
/** The heroes one pass asks, in signing order, each read once as it stands, and the wallet's waiting
 * direct command with the number of heroes asked before it. */
const read_queue = async (store: ControlStore, lane: Lane, snapshot: ActorSnapshot | undefined) => {
  const last = lane.latest_command ? await store.read<Command>(`command:${lane.latest_command}`) : null
  const { keys, contested } = signing_queue(lane, last?.payload.character_id as string | undefined, snapshot)
  const direct = lane.direct ? await store.read<Command>(`command:${lane.direct}`) : null
  const runs: Queued = await Promise.all(keys.map(async (key) => [key, await store.read<Run>(key)] as const))
  return { runs, first: keys.slice(0, contested), direct: direct_waiting(lane, direct) ? direct : null }
}

/** A stopped or finished hero no longer holds its slot. Only the owner process writes the lane, so
 * a stop written elsewhere cannot race this process while it signs for a neighbour. */
const free_ended_slots = async (store: ControlStore, lane_key: string, queue: Queued): Promise<Queued> => {
  const ended = queue.filter(([, run]) => !run || !run_live(run)).map(([key]) => key)
  if (!ended.length) return queue
  await store.transaction([lane_key, ...ended], async (tx) => {
    const lane = await tx.get<Lane>(lane_key)
    if (!lane) return
    const still = await Promise.all(ended.map(async (key) => [key, await tx.get<Run>(key)] as const))
    const freed = still.filter(([, run]) => !run || !run_live(run)).map(([key]) => key.slice('behavior:'.length))
    await tx.put(
      lane_key,
      freed.reduce<Lane>((next, id) => ({ ...next, ...released_run(next, id) }), lane)
    )
  })
  return queue.filter(([key]) => !ended.includes(key))
}

/** One pass of the wallet's signing queue: ask each entry in signing order until one takes the single
 * signing slot. The entries are the hosted runs and the wallet's waiting direct command, which is asked
 * after the heroes whose turn another wallet could pass. A failing entry is reported and never blocks
 * its neighbours. Returns the direct command that took the slot, for its caller to execute. */
export const process_lane_runs = async (
  lane_key: string,
  options: RunOptions & Readonly<{ snapshot: () => ActorSnapshot | undefined }>
): Promise<Command | null> => {
  const { store } = options
  const lane = await store.read<Lane>(lane_key)
  if (!lane) return null
  const snapshot = options.snapshot()
  const { runs, first, direct } = await read_queue(store, lane, snapshot)
  const queue = await free_ended_slots(store, lane_key, runs)
  const watcher = market_watcher(queue, snapshot, direct)
  const asks = queue.map(([key, run]) => async (): Promise<Command | null> => {
    await process_bot_run(run, key === watcher, options)
    return null
  })
  const turn = queue.filter(([key]) => first.includes(key)).length
  for (const ask of direct ? asks.toSpliced(turn, 0, () => process_direct(direct, snapshot, options)) : asks) {
    try {
      const taken = await ask()
      if (taken) return taken
    } catch (error) {
      options.report_failure(error)
    }
    if ((await store.read<Lane>(lane_key))?.active_command) return null
  }
  return null
}

/** A stored run of a retired shape is never executed. Stopping it takes it out of the pending index,
 * so it is reported once and never scheduled again; nothing is deleted. */
export const retire_run = async (store: ControlStore, key: string, report: (error: unknown) => void) => {
  const retired = await store.transaction([key], async (tx) => {
    const record = await tx.get<Readonly<Record<string, unknown>>>(key)
    if (!retired_run(key, record)) return false
    await tx.put(key, { ...record, status: 'stopped', issue: 'legacy_run_retired' })
    return true
  })
  if (retired) report(new Error(`legacy_run_retired ${key}`))
}
