// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Grant } from './model.ts'
import type { create_behavior_control } from './behavior_control.ts'
import { identifier, nonempty } from './gameplay_schema.ts'
import { BEHAVIOR_SCRIPT_SCHEMA } from './behavior_schema.ts'

const revision = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } as const
const revisions = { decision_revision: revision, observation_revision: revision }
const definitions = {
  bot_validate_behavior: {
    scope: 'bot:observe',
    description:
      'Validate an AI-authored behavior tree without executing it. A tree acts for exactly one hero: every action names the same character_id, while conditions may read teammates. Conditions are reactive; unknown facts wait. Sequences retain reconciled actions until failure or traversal reset; selectors choose the first non-failing child. A successful root repeats on the next existing scheduler tick; complete terminates and reports its optional reason as the run issue. A tree may test what its own run tallied since it was started or replaced: fees_spent (MIST of network fees from its settled receipts) and dungeon_runs (dungeon runs it saw end). No default action/time cutoff.',
    properties: { script: BEHAVIOR_SCRIPT_SCHEMA },
  },
  bot_start_behavior: {
    scope: 'bot:play',
    description:
      'Set and run the behavior tree of one hero. Each hero has its own run; a wallet hosts at most 30 at once and signs one transaction at a time, serving the hero whose fight turn expires first. Heroes whose trees lead them into the same fight play it together. Author priorities, resource thresholds and recipe changes explicitly. Completed transactions require observed effects before advancing; uncertain work never falls through a selector. Objective metadata is descriptive. The tree survives service restarts and then starts again from its root after fresh observations; traversal progress does not survive. Runs pause on owner stop/disconnect.',
    properties: { script: BEHAVIOR_SCRIPT_SCHEMA, idempotency_key: nonempty, ...revisions },
  },
  bot_replace_behavior: {
    scope: 'bot:play',
    description:
      'Explicitly replace/replan one hero’s tree using its current revision. Refuses while that hero’s own command is signing, pending or unreconciled. Starts a new traversal under your authorization; funds remain the spending limit. Stop/pause is never automatically undone.',
    properties: { script: BEHAVIOR_SCRIPT_SCHEMA, character_id: identifier, expected_revision: revision, ...revisions },
  },
  bot_behavior_status: {
    scope: 'bot:observe',
    description:
      'Read one hero’s retained tree, revision, progress, pending command ID and current issue. script.strategy names the shared catalogue entry the tree was bound from, when any. Every authorized connector of this owner reads the same run. Progress and issue are process-local and reset when the service restarts. A run waits on facts and resumes by itself; awaiting_ai means an authored replan, a combat fallback or an unresolvable uncertain transaction needs external AI replanning. This service does not invoke an inference provider.',
    properties: { character_id: identifier },
  },
  bot_stop_behavior: {
    scope: 'bot:pause',
    description:
      'Stop one hero’s behavior tree and fence its new execution; other heroes keep playing. An already submitting transaction remains subject to exact receipt recovery.',
    properties: { character_id: identifier },
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
  ['bot_behavior_status', (grant, args) => control.behavior_status(grant, text(args.character_id))],
  ['bot_stop_behavior', (grant, args) => control.stop_behavior(grant, text(args.character_id))],
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
        character_id: text(args.character_id),
        expected_revision: integer(args.expected_revision),
        decision_revision: integer(args.decision_revision),
        observation_revision: integer(args.observation_revision),
      }),
  ],
]
