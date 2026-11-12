// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Grant } from './model.ts'
import type { create_behavior_control } from './behavior_control.ts'
import { nonempty } from './gameplay_schema.ts'
import { BEHAVIOR_SCRIPT_SCHEMA } from './behavior_schema.ts'

const revision = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } as const
const revisions = { decision_revision: revision, observation_revision: revision }
const definitions = {
  bot_validate_behavior: {
    read_only: true,
    scope: 'bot:observe',
    description:
      'Validate an AI-authored behavior tree without executing it. Conditions are reactive; unknown facts wait. Sequences retain reconciled actions until failure or traversal reset; selectors choose the first non-failing child. A successful root repeats on the next existing scheduler tick; complete terminates. No default action/time cutoff.',
    properties: { script: BEHAVIOR_SCRIPT_SCHEMA },
  },
  bot_start_behavior: {
    read_only: false,
    scope: 'bot:play',
    description:
      'Persist and execute a behavior tree through the existing single wallet lane. Author priorities, resource thresholds and recipe changes explicitly. Completed transactions require observed effects before advancing; uncertain work never falls through a selector. Objective metadata is descriptive. Runs survive service restarts and pause on owner stop/disconnect.',
    properties: { script: BEHAVIOR_SCRIPT_SCHEMA, idempotency_key: nonempty, ...revisions },
  },
  bot_replace_behavior: {
    read_only: false,
    scope: 'bot:play',
    description:
      'Explicitly replace/replan a tree using its current revision and fresh lane revisions. Refuses active commands, pending envelopes or unreconciled effects. Starts a new traversal; funds remain the spending limit. Stop/pause is never automatically undone.',
    properties: { script: BEHAVIOR_SCRIPT_SCHEMA, run_id: nonempty, expected_revision: revision, ...revisions },
  },
  bot_behavior_status: {
    read_only: true,
    scope: 'bot:observe',
    description:
      'Read your exact retained tree, revision, progress, pending command ID and durable issue. awaiting_ai requires external AI replanning; this service does not invoke an inference provider.',
    properties: { run_id: nonempty },
  },
  bot_stop_behavior: {
    read_only: false,
    scope: 'bot:pause',
    description:
      'Stop this behavior tree and fence new execution. An already submitting transaction remains subject to exact receipt recovery.',
    properties: { run_id: nonempty },
  },
} as const
export const BEHAVIOR_TOOLS = Object.entries(definitions).map(([name, entry]) => ({
  name,
  ...entry,
  required: Object.keys(entry.properties),
}))
const text = (value: unknown) => {
  if (typeof value !== 'string' || !value) throw new Error('invalid_argument')
  return value
}
const integer = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('invalid_argument')
  return value
}
export const behavior_calls = (
  control: ReturnType<typeof create_behavior_control>
): readonly (readonly [string, (grant: Grant, args: Readonly<Record<string, unknown>>) => Promise<unknown>])[] => [
  ['bot_validate_behavior', (grant, args) => control.validate_behavior(grant, args.script)],
  ['bot_behavior_status', (grant, args) => control.behavior_status(grant, text(args.run_id))],
  ['bot_stop_behavior', (grant, args) => control.stop_behavior(grant, text(args.run_id))],
  [
    'bot_start_behavior',
    (grant, args) =>
      control.start_behavior(grant, {
        script: args.script,
        idempotency_key: text(args.idempotency_key),
        decision_revision: integer(args.decision_revision),
        observation_revision: integer(args.observation_revision),
      }),
  ],
  [
    'bot_replace_behavior',
    (grant, args) =>
      control.replace_behavior(grant, {
        script: args.script,
        run_id: text(args.run_id),
        expected_revision: integer(args.expected_revision),
        decision_revision: integer(args.decision_revision),
        observation_revision: integer(args.observation_revision),
      }),
  ],
]
