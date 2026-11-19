// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ClientPacket } from '@aresrpg/protocol'

import type { create_bot_actor } from './actor.ts'
import type { Command, Lane } from './control.ts'
import type { ControlStore } from './store.ts'
import type { BehaviorRun } from './behavior_script.ts'
import { run_keys } from './run_ref.ts'
import { public_command_error } from './planning_failure.ts'
import { observation_events } from './actor_snapshot.ts'
import { fight_planning } from './fight_planning.ts'
import { character_observability, observed_balance } from './character_observability.ts'
import { gameplay_knowledge } from './gameplay_knowledge.ts'
import { fight_checkpoint_id, zone_checkpoint_id, gameplay_json, type GameplayContext } from './gameplay.ts'

/** Full snapshots remain the planning baseline; changes reuse the same fenced event ring. */
export const actor_observation = (context: GameplayContext, fence: number) => {
  const {
    snapshot,
    command: { payload },
  } = context
  if (payload.view === 'changes' && payload.after_cursor === undefined) throw new Error('needs_resync')
  const events = observation_events(snapshot, payload.after_cursor, fence, payload.after_fence)
  if (payload.view === 'changes') {
    const { ready, cursor, observation_revision, observed_at, clock, frozen, indexing_lag } = snapshot
    return {
      view: 'changes' as const,
      balance: observed_balance(context),
      ready,
      cursor,
      observation_revision,
      observed_at,
      clock,
      frozen,
      indexing_lag,
      events,
    }
  }
  return {
    ...snapshot,
    ...character_observability(context),
    events,
    ...(payload.fight_plan === undefined
      ? {}
      : { fight_plan: JSON.parse(gameplay_json(fight_planning(context, payload.fight_plan))) }),
    checkpoint_ids: Object.fromEntries(
      Object.entries(snapshot.fights).map(([id, row]) => [id, fight_checkpoint_id(row)])
    ),
    zone_checkpoints: Object.fromEntries(
      Object.entries(snapshot.zones)
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

/** A stored run of a retired shape holds no script: it is still listed, without a strategy. */
const script_of = (run: BehaviorRun) => run.script as BehaviorRun['script'] | undefined
/** The wire shape of a run in `bot_observe`. */
const observed_run = (run: BehaviorRun) => {
  const { id, character_id, status, issue } = run
  return { id, character_id, status, issue, strategy: script_of(run)?.strategy }
}
/** A run as its owner is told it: the observed row plus the objective its tree was authored with. */
export const told_run = (run: BehaviorRun) => ({ ...observed_run(run), objective: script_of(run)?.objective })

/** Every run the wallet hosts, one per hero. Any live grant of this bot reads the same list:
 * one verified owner holds one wallet. `strategy` is the catalogue entry its tree was bound from,
 * absent for an authored tree. `state` says whether any run still plays without the AI. `direct` is
 * the wallet's one direct command with its outcome, so a client follows its request from observations. */
export const run_observation = async <Row extends Readonly<{ status: string }>>(
  store: ControlStore,
  lane: Lane | null,
  command: Pick<Command, 'bot_id'>,
  row: (run: BehaviorRun) => Row
) => {
  const records = await Promise.all((lane ? run_keys(lane) : []).map((key) => store.read<BehaviorRun>(key)))
  const runs = records.flatMap((run) => (run?.bot_id === command.bot_id ? [row(run)] : []))
  const held = lane?.direct ? await store.read<Command>(`command:${lane.direct}`) : null
  const direct = held?.bot_id === command.bot_id ? held : null
  return {
    runs,
    state: runs.some(({ status }) => status !== 'awaiting_ai') ? 'running' : 'awaiting_ai',
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
