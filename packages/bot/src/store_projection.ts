// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

type RecordValue = Readonly<Record<string, unknown>>
const kind_of = (key: string) => key.split(':')[0]!
export const volatile_record = (key: string) => kind_of(key) === 'command'
const fields: Readonly<Record<string, readonly string[]>> = {
  lane: [
    'network',
    'address',
    'actor_id',
    'fence',
    'lease_until',
    'decision_revision',
    'observation_revision',
    'paused',
    'execution_busy',
    'runs',
    'ended',
    'fees_mist',
  ],
  behavior: [
    'id',
    'bot_id',
    'grant_id',
    'lane_key',
    'character_id',
    'fingerprint',
    'script',
    'revision',
    'status',
    'created_at',
    'tally',
  ],
}
export const execution_record = (key: string) => volatile_record(key) || Object.hasOwn(fields, kind_of(key))
const execution_busy = (record: RecordValue, previous: RecordValue) => {
  if (record.active_command || record.pending) return true
  const same_owner = previous.actor_id === record.actor_id && previous.fence === record.fence
  if (same_owner && (previous.active_command || previous.pending)) return false
  return record.execution_busy ?? false
}
/** Allowlist persistence: additions to execution records are volatile unless explicitly declared here. */
export const persistent_value = (key: string, value: unknown, previous?: unknown): unknown => {
  const names = fields[kind_of(key)]
  if (!names) return value
  const record = value as RecordValue
  const projected = Object.fromEntries(
    names.filter((name) => Object.hasOwn(record, name)).map((name) => [name, record[name]])
  )
  if (kind_of(key) === 'lane')
    return { ...projected, execution_busy: execution_busy(record, (previous ?? {}) as RecordValue) }
  return projected.status === 'waiting' ? { ...projected, status: 'active' } : projected
}
const lane_defaults = {
  active_command: null,
  latest_command: null,
  pending: null,
  reconciliation_command: null,
  run_commands: {},
  direct: null,
  fight_replays: {},
  catalogue_receipts: {},
  observed_at: 0,
  needs_resync: true,
}
const behavior_defaults = {
  actions_started: 0,
  last_command_id: null,
  memory: { completed: [], selected: {} },
  pending_node: null,
  activation: null,
  consumed_command_id: null,
}
const hydrate_lane = (record: RecordValue, cached: RecordValue) => {
  const matching = cached.actor_id === record.actor_id && cached.fence === record.fence
  return { ...lane_defaults, ...(matching ? cached : {}), ...record }
}
const hydrate_run = (record: RecordValue, cached: RecordValue) => {
  const matching = cached.revision === record.revision && cached.fingerprint === record.fingerprint
  return {
    ...behavior_defaults,
    ...(matching ? cached : {}),
    ...record,
    status: matching && record.status === 'active' && cached.status === 'waiting' ? 'waiting' : record.status,
  }
}
type LaneNames = Readonly<{
  active_command?: string | null
  latest_command?: string | null
  reconciliation_command?: string | null
  direct?: string | null
  pending?: Readonly<{ command_id: string }> | null
  run_commands?: Readonly<Record<string, string>>
  catalogue_receipts?: Readonly<Record<string, Readonly<{ command_id: string }>>>
}>
const named_commands = (lane: unknown): ReadonlySet<string> => {
  const names = (lane ?? {}) as LaneNames
  const proofs = Object.values(names.catalogue_receipts ?? {}).map(({ command_id }) => command_id)
  const { active_command, latest_command, reconciliation_command, direct, pending } = names
  const ids = [active_command, latest_command, reconciliation_command, direct, pending?.command_id]
  const runs = Object.values(names.run_commands ?? {})
  return new Set([...ids, ...runs, ...proofs].filter((id): id is string => Boolean(id)))
}
/** A lane is the only reference to its commands, and a command carries its own receipt. Commands the
 * next lane value stops naming are unreferenced and released in the same commit; no history remains.
 * Each hosted run keeps its last command named until it admits its next one. */
export const released_records = (key: string, previous: unknown, next: unknown): readonly string[] => {
  if (kind_of(key) !== 'lane') return []
  const kept = named_commands(next)
  return [...named_commands(previous)].filter((id) => !kept.has(id)).map((id) => `command:${id}`)
}
/** Legacy records are projected before hydration, so old journals never become execution authority. */
export const live_value = (key: string, durable: unknown, local?: unknown): unknown => {
  if (durable === null) return null
  const kind = kind_of(key)
  if (!fields[kind]) return durable
  const record = persistent_value(key, durable) as RecordValue
  const cached = (local ?? {}) as RecordValue
  return kind === 'lane' ? hydrate_lane(record, cached) : hydrate_run(record, cached)
}
/** A stored run of a retired shape that still claims work: a profession or combat run, or a tree
 * saved before runs belonged to one hero. It is never executed; the actor retires it on sight. */
export const retired_run = (key: string, record: unknown): boolean => {
  const { status, character_id } = (record ?? {}) as { status?: string; character_id?: string }
  const retired = ['profession', 'combat'].includes(kind_of(key)) || (kind_of(key) === 'behavior' && !character_id)
  return retired && ['active', 'waiting'].includes(status ?? '')
}
