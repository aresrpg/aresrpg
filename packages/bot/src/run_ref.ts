// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
type References = Readonly<{
  /** The hero run a command belongs to. */
  run_id?: string
  /** The hero runs a lane hosts: character ID to run ID. */
  runs?: Readonly<Record<string, string>>
  /** Run key to the last command that run admitted; it stays readable until that run's next one. */
  run_commands?: Readonly<Record<string, string>>
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
export const cleared_run = { runs: {}, run_commands: {} } as const
const without = (record: Readonly<Record<string, string>> | undefined, drop: (key: string, value: string) => boolean) =>
  Object.fromEntries(Object.entries(record ?? {}).filter(([key, value]) => !drop(key, value)))
/** Release one hero's run and leave its neighbours hosted. */
export const released_run = (lane: References, id: string) => ({
  runs: without(lane.runs, (_, hosted) => hosted === id),
  run_commands: without(lane.run_commands, (key) => key === run_key(id)),
})
