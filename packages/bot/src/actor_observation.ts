// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ClientPacket, RunEnding } from '@aresrpg/protocol'

import type { create_bot_actor } from './actor.ts'
import type { Command, Lane } from './control.ts'
import type { ControlStore } from './store.ts'
import type { BehaviorRun } from './behavior_script.ts'
import { run_key, run_keys } from './run_ref.ts'
import { run_tally } from './behavior_tally.ts'
import { public_command_error } from './planning_failure.ts'
import {
  current_zones,
  inventory_counts,
  inventory_view,
  stacks_view,
  without_nulls,
  zones_view,
} from './actor_observation_views.ts'
import { fight_planning } from './fight_planning.ts'
import { character_observability } from './character_observability.ts'
import { gameplay_knowledge } from './catalog.ts'
import { fight_checkpoint_id, zone_checkpoint_id, gameplay_json, type GameplayContext } from './gameplay_context.ts'

/** What the status reads from the actor: what the wallet holds and does, in a few kilobytes. A bag,
 * the stacks of one item and the zones around a hero are detail views, asked for by name. */
const status_view = (context: GameplayContext) => {
  const {
    snapshot,
    command: { payload },
  } = context
  const { inventory, zones, ...live } = snapshot
  const { health, equipment_bonuses, balance } = character_observability(context)
  return {
    ...live,
    health,
    equipment_bonuses,
    balance,
    inventory: {
      ...inventory_counts(inventory),
      ...(inventory?.market ? { market: inventory.market } : {}),
      ...(inventory?.market_prices ? { market_prices: inventory.market_prices } : {}),
    },
    current_zones: current_zones(snapshot.characters),
    ...(payload.fight_plan === undefined
      ? {}
      : { fight_plan: JSON.parse(gameplay_json(fight_planning(context, payload.fight_plan))) }),
    checkpoint_ids: Object.fromEntries(
      Object.entries(snapshot.fights).map(([id, row]) => [id, fight_checkpoint_id(row)])
    ),
    zone_checkpoints: Object.fromEntries(
      Object.entries(zones)
        .filter(([, row]) => row.spawns !== null)
        .map(([id, row]) => [id, zone_checkpoint_id(row)])
    ),
    planning_context: gameplay_knowledge(
      context,
      payload.recipes as readonly string[] | undefined,
      payload.spells as readonly string[] | undefined
    ),
  }
}
/** The detail views. Each one reads the same snapshot the status reads. */
const DETAIL_VIEWS = {
  inventory: ({ snapshot, command }: GameplayContext) => inventory_view(snapshot, command.payload),
  stacks: ({ snapshot, command }: GameplayContext) => stacks_view(snapshot, command.payload),
  zones: ({ snapshot, command }: GameplayContext) => zones_view(snapshot, command.payload),
}
type DetailView = keyof typeof DETAIL_VIEWS
const detail_view = (payload: Command['payload']): DetailView | null =>
  typeof payload.view === 'string' && Object.hasOwn(DETAIL_VIEWS, payload.view) ? (payload.view as DetailView) : null
/** One read of the actor: the status, or the one detail view the command names. Nothing absent is
 * written as `null`. */
export const actor_observation = (context: GameplayContext) => {
  const view = detail_view(context.command.payload)
  return without_nulls(view ? { view, ...DETAIL_VIEWS[view](context) } : status_view(context)) as Readonly<
    Record<string, unknown>
  >
}

/**
 * What one read answers. A detail view answers its one question, with the revision it was read at.
 * The status adds what the wallet lane knows: its runs, its direct command and its revisions.
 */
export const observation_reply = async (
  context: GameplayContext,
  lane_facts: () => Promise<Readonly<Record<string, unknown>>>
) => {
  const observed = actor_observation(context)
  if (detail_view(context.command.payload))
    return { ...observed, observation_revision: context.snapshot.observation_revision }
  return without_nulls({ ...(await lane_facts()), ...observed }) as Readonly<Record<string, unknown>>
}

export const apply_actor_watches = async (
  actor: Pick<ReturnType<typeof create_bot_actor>, 'observe'>,
  command: Pick<Command, 'grant_id' | 'payload'>
) => {
  for (const [name, type] of [
    ['market', 'packet/market_observe'],
    ['prices', 'packet/market_prices_observe'],
  ] as const) {
    if (Object.hasOwn(command.payload, name))
      await actor.observe(command.grant_id, { type, observation: command.payload[name] } as Extract<
        ClientPacket,
        { type: typeof type }
      >)
  }
}

/** A stored run of a retired shape holds no script: it is still listed, without an objective. */
const script_of = (run: BehaviorRun) => run.script as BehaviorRun['script'] | undefined
/** The wire shape of a run in `bot_observe`. */
const observed_run = ({ id, character_id, status, issue }: BehaviorRun) => ({ id, character_id, status, issue })
/** A run as its owner is told it: the observed row, the objective its tree was authored with, and
 * what it paid in fees and how many dungeon runs it saw end since that tree was accepted. */
export const told_run = (run: BehaviorRun) => {
  const { fees_mist, dungeon_runs } = run_tally(run)
  return { ...observed_run(run), objective: script_of(run)?.objective, fees_mist, dungeon_runs }
}

type Owner = Pick<Command, 'bot_id'>
type Rower<Row> = (run: BehaviorRun) => Row
const owned = (run: BehaviorRun | null, { bot_id }: Owner): run is BehaviorRun => run?.bot_id === bot_id
const hosted_runs = async <Row>(store: ControlStore, lane: Lane | null, owner: Owner, row: Rower<Row>) => {
  const records = await Promise.all((lane ? run_keys(lane) : []).map((key) => store.read<BehaviorRun>(key)))
  return records.flatMap((run) => (owned(run, owner) ? [row(run)] : []))
}
/** The runs that ended by themselves and whose hero did not start again, each with its reason. A stop
 * written since on such a run is the last word on it: only a run still completed is explained. */
const ended_runs = async <Row>(store: ControlStore, lane: Lane | null, owner: Owner, row: Rower<Row>) => {
  const endings = Object.entries(lane?.ended ?? {})
  const records = await Promise.all(endings.map(([id]) => store.read<BehaviorRun>(run_key(id))))
  return endings.flatMap(([, ended], index) => {
    const run = records[index] ?? null
    return owned(run, owner) && run.status === 'completed' ? [{ ...row(run), ended }] : []
  })
}
/** Every run the wallet hosts, one per hero, then every run that ended by itself, with `ended`. Any
 * live grant of this bot reads the same list: one verified owner holds one wallet. `state` says whether any
 * hosted run still plays without the AI. `direct` is the wallet's one direct command with its outcome,
 * so a client follows its request from observations. */
export const run_observation = async <Row extends Readonly<{ status: string }>>(
  store: ControlStore,
  lane: Lane | null,
  command: Owner,
  row: Rower<Row>
) => {
  const hosted = await hosted_runs(store, lane, command, row)
  const runs: readonly (Row & Readonly<{ ended?: RunEnding }>)[] = [
    ...hosted,
    ...(await ended_runs(store, lane, command, row)),
  ]
  const held = lane?.direct ? await store.read<Command>(`command:${lane.direct}`) : null
  const direct = held?.bot_id === command.bot_id ? held : null
  return {
    runs,
    state: hosted.some(({ status }) => status !== 'awaiting_ai') ? 'running' : 'awaiting_ai',
    direct: direct && {
      id: direct.id,
      kind: direct.kind,
      status: direct.status,
      error: public_command_error(direct.status, direct.error),
      payload: direct.payload,
    },
  }
}
export const owned_run_observation = (store: ControlStore, lane: Lane | null, command: Pick<Command, 'bot_id'>) =>
  run_observation(store, lane, command, observed_run)
