// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { Grant } from './model.ts'
import type { create_combat_control } from './combat_control.ts'
import { COMBAT_PROFILE_SCHEMA } from './combat_profile.ts'
import { decode, identifier, object_schema } from './gameplay_schema.ts'

export const COMBAT_TOOLS = [
  {
    name: 'bot_validate_combat_profile',
    description:
      'Check finite tactics and learned spells against the current character without saving or signing. A hero’s tactics live only in the combat or dungeon leaf of its behavior tree: validate a profile here, then embed it in the tree you start or replace. Ask the player for goals such as "place traps then retreat" or "heal a wounded ally first", preferred spell combinations, targeting and when to stop. Explain any unavailable spell or unsupported tactic instead of inventing it. Mark a cast if_learned: true to have it skipped until the hero learns that spell; any other cast of an unlearned spell stops the hero.',
    properties: { character_id: identifier, profile: COMBAT_PROFILE_SCHEMA },
    required: ['character_id', 'profile'],
    scope: 'bot:observe',
  },
] as const

type Args = Readonly<Record<string, unknown>>
export const combat_calls = (
  control: ReturnType<typeof create_combat_control>
): readonly (readonly [string, (grant: Grant, args: Args) => Promise<unknown>])[] =>
  COMBAT_TOOLS.map(
    (entry) =>
      [
        entry.name,
        async (grant, args) => {
          const parsed = decode<Args>({ ...object_schema(entry.properties), required: entry.required }, args)
          return control.validate_combat_profile(grant, parsed.character_id as string, parsed.profile)
        },
      ] as const
  )
