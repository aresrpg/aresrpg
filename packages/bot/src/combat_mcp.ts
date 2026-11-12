// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Grant } from './model.ts'
import type { create_combat_control } from './combat_control.ts'
import { COMBAT_PROFILE_SCHEMA } from './combat_profile.ts'
import { decode, identifier, nonempty, object_schema, type Schema } from './gameplay_schema.ts'

const revision: Schema = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }
const revisions = { decision_revision: revision, observation_revision: revision }
const run = { run_id: nonempty }
export const COMBAT_TOOLS = [
  {
    name: 'bot_combat_profile',
    description:
      'Read the saved tactics and revision for one character. Profiles are shared by authorized connectors for this bot and survive fights; reading never starts gameplay.',
    properties: { character_id: identifier },
    required: ['character_id'],
    scope: 'bot:observe',
    read_only: true,
  },
  {
    name: 'bot_validate_combat_profile',
    description:
      'Check finite tactics and learned spells against the current character without saving or signing. Ask the player for goals such as "place traps then retreat", preferred spell combinations, targeting and when to stop. Explain any unavailable spell or unsupported tactic instead of inventing it.',
    properties: { character_id: identifier, profile: COMBAT_PROFILE_SCHEMA },
    required: ['character_id', 'profile'],
    scope: 'bot:observe',
    read_only: true,
  },
  {
    name: 'bot_save_combat_profile',
    description:
      'Remember validated per-character tactics using the last read revision (0 for new). Summarize the chosen combos, movement and fallback in ordinary language. Saving starts no fight and spends no stat points. Strength-based intent needs separately authorized stat/equipment actions. To revise an active fight, stop it, save the profile, observe again and start a new run.',
    properties: { character_id: identifier, expected_revision: revision, profile: COMBAT_PROFILE_SCHEMA },
    required: ['character_id', 'expected_revision', 'profile'],
    scope: 'bot:play',
    read_only: false,
  },
  {
    name: 'bot_start_combat',
    description:
      'Authorize automatic play through settlement of exactly one existing supported PvE fight, using the saved revision for every owned unsettled participant. The bot plans finite combos each turn, sends normal movement/cast packets and uses the existing serialized SDK. It never starts another fight. Profile edits do not change this run. Wallet funds remain the spending limit.',
    properties: {
      idempotency_key: nonempty,
      fight: identifier,
      profiles: { type: 'array', minItems: 1, items: object_schema({ character_id: identifier, revision }) } as Schema,
      ...revisions,
    },
    required: ['idempotency_key', 'fight', 'profiles', 'decision_revision', 'observation_revision'],
    scope: 'bot:play',
    read_only: false,
  },
  {
    name: 'bot_combat_status',
    description:
      'Read the exact combat run, pinned tactics, last command ID and blocker. Inspect bot_status for its transaction outcome. Routine turns need no AI calls; intervene for awaiting_ai, failures, unavailable tactics or requested revisions.',
    properties: run,
    required: ['run_id'],
    scope: 'bot:observe',
    read_only: true,
  },
  {
    name: 'bot_stop_combat',
    description:
      'Stop further actions for this combat run while retaining its saved tactics. Already admitted transactions may settle. Stop does not forfeit the fight or return assets; owner Disconnect/Recall owns that operation.',
    properties: run,
    required: ['run_id'],
    scope: 'bot:pause',
    read_only: false,
  },
  {
    name: 'bot_resume_combat',
    description:
      'Explicitly resume a paused or awaiting-AI combat run after a fresh observation, using its original pinned tactics. Resolve pending transactions first. Failed, uncertain or stopped work is never automatically replaced; use a newly authorized run after review if needed.',
    properties: { ...run, ...revisions },
    required: ['run_id', 'decision_revision', 'observation_revision'],
    scope: 'bot:play',
    read_only: false,
  },
] as const

type Control = ReturnType<typeof create_combat_control>
type Args = Readonly<Record<string, unknown>>
export const combat_calls = (
  control: Control
): readonly (readonly [string, (grant: Grant, args: Args) => Promise<unknown>])[] => {
  const handlers: Readonly<Record<string, (grant: Grant, args: Args) => Promise<unknown>>> = {
    bot_combat_profile: (grant, args) => control.combat_profile(grant, args.character_id as string),
    bot_validate_combat_profile: (grant, args) =>
      control.validate_combat_profile(grant, args.character_id as string, args.profile),
    bot_save_combat_profile: (grant, args) =>
      control.save_combat_profile(grant, args as Parameters<Control['save_combat_profile']>[1]),
    bot_start_combat: (grant, args) => control.start_combat(grant, args as Parameters<Control['start_combat']>[1]),
    bot_combat_status: (grant, args) => control.combat_status(grant, args.run_id as string),
    bot_stop_combat: (grant, args) => control.stop_combat(grant, args.run_id as string),
    bot_resume_combat: (grant, args) =>
      control.resume_combat(
        grant,
        args.run_id as string,
        args.decision_revision as number,
        args.observation_revision as number
      ),
  }
  return COMBAT_TOOLS.map(
    (entry) =>
      [
        entry.name,
        async (grant, args) => {
          const parsed = decode<Args>(object_schema(entry.properties), args)
          return handlers[entry.name]!(grant, parsed)
        },
      ] as const
  )
}
