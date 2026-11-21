// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { run_ending, type RunEnding } from '@aresrpg/protocol'
import { run_live } from '@aresrpg/protocol/strategies'

type References = Readonly<{
  /** The hero run a command belongs to. */
  run_id?: string
  /** The hero runs a lane hosts: character ID to run ID. */
  runs?: Readonly<Record<string, string>>
  /** Run key to the last command that run admitted; it stays readable until that run's next one. */
  run_commands?: Readonly<Record<string, string>>
  /** The runs that ended by themselves: run ID to the reason. Such a run holds no slot. It stays named
   * until its hero starts again, as a direct command stays readable until the next one is accepted. */
  ended?: Readonly<Record<string, RunEnding>>
}>
/** The owner's limit on concurrent hero runs in one wallet. Wallet funding stays the only spending limit. */
export const MAX_WALLET_RUNS = 30
export const run_key = (id: string) => `behavior:${id}`
/** The runs a record names: a command its own, a lane every hero run it hosts. */
export const run_keys = (record: References) => [
  ...(record.run_id ? [run_key(record.run_id)] : []),
  ...Object.values(record.runs ?? {}).map(run_key),
]
export const same_run = (left: References, right: References) =>
  JSON.stringify(run_keys(left)) === JSON.stringify(run_keys(right))
/** A run's command executes only while its lane still hosts that run; a direct command belongs to no run. */
export const run_hosted = (command: References, lane: References) =>
  !command.run_id || run_keys(lane).includes(run_key(command.run_id))
export const cleared_run = { runs: {}, run_commands: {}, ended: {} } as const
const without = <Value extends string>(
  record: Readonly<Record<string, Value>> | undefined,
  drop: (key: string, value: Value) => boolean
) => Object.fromEntries(Object.entries<Value>(record ?? {}).filter(([key, value]) => !drop(key, value)))
/** Release one hero's run and leave its neighbours hosted. Its last ending is no longer named. */
export const released_run = (lane: References, id: string) => ({
  runs: without(lane.runs, (_, hosted) => hosted === id),
  run_commands: without(lane.run_commands, (key) => key === run_key(id)),
  ended: without(lane.ended, (key) => key === id),
})
type Outcome = Readonly<{ status: string; issue?: string }>
/** A tree ends by itself only at an authored end. Its reason is told when it is a listed one. A stop,
 * a pause and a dead grant are decisions of the player: they end a run and name no ending. */
const self_ending = ({ status, issue }: Outcome): RunEnding | undefined =>
  status === 'completed' ? (run_ending(issue) ?? 'completed') : undefined
/** What a lane names of a run after the tick that left it in this state. A run that still holds its
 * hero keeps its slot, so a tree awaiting its author stays discoverable. Any other gives the slot
 * back, and one that ended by itself stays named with its reason: the owner is told why after the
 * slot is free. A run never advances the wallet decision: a hero must not fence its neighbours. */
export const ended_run = (lane: References, id: string, outcome: Outcome) => {
  if (run_live(outcome)) return {}
  const released = released_run(lane, id)
  const ending = self_ending(outcome)
  return ending ? { ...released, ended: { ...released.ended, [id]: ending } } : released
}
