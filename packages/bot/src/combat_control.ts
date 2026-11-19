// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow } from '@aresrpg/protocol'

import { assert_live_grant, type Bot, type BotConfig, type Grant } from './model.ts'
import type { ControlStore } from './store.ts'
import { lane_key_for } from './command_admission.ts'
import type { Command, Observe } from './control.ts'
import type { ActorSnapshot } from './actor_snapshot.ts'
import { identifier, matches } from './gameplay_schema.ts'
import { gameplay_observation_ready, type GameplayContext } from './gameplay_context.ts'
import { parse_combat_profile, validate_profile_character } from './combat_profile.ts'

type Live = ActorSnapshot & { decision_revision: number; sampled_at: number; status?: string }
const observed_character = (live: Live, character_id: string): CharacterRow => {
  const character = live.characters.find(({ id }) => id === character_id)
  if (!character) throw new Error('character_authority_mismatch')
  return character
}
const observed_context = (grant: Grant, live: Live, freshness_ms: number): GameplayContext => ({
  address: grant.address,
  snapshot: live,
  command: {
    id: 'combat_observation',
    bot_id: grant.bot_id,
    grant_id: grant.id,
    lane_key: lane_key_for(grant),
    fingerprint: '',
    kind: 'observe',
    payload: {},
    status: 'completed',
    decision_revision: live.decision_revision,
    observation_revision: live.observation_revision,
  } satisfies Command,
  now: live.sampled_at,
  freshness_ms,
})
/** A hero's tactics live in its tree and nowhere else. This only checks a profile an author is about
 * to embed against the hero's observed spells; it saves nothing and starts nothing. */
export const create_combat_control = (store: ControlStore, config: BotConfig, now: () => number, observe: Observe) => {
  const authorize = (grant: Grant) =>
    store.transaction([`grant:${grant.id}`, `bot:${grant.bot_id}`], async (tx) => {
      const current = await tx.get<Grant>(`grant:${grant.id}`)
      if (!current || current.bot_id !== grant.bot_id || current.address !== grant.address)
        throw new Error('invalid_token')
      assert_live_grant(config, current, await tx.get<Bot>(`bot:${grant.bot_id}`), now())
      if (!current.scopes.includes('bot:observe')) throw new Error('insufficient_scope')
    })
  const validate_combat_profile = async (grant: Grant, character_id: string, value: unknown) => {
    if (!matches(identifier, character_id)) throw new Error('invalid_argument')
    await authorize(grant)
    const profile = parse_combat_profile(value)
    const live = (await observe(grant, {})) as Live
    const ready = gameplay_observation_ready(observed_context(grant, live, config.observation_freshness_ms))
    if (live.status === 'pending' || !ready) throw new Error('needs_resync')
    const unavailable_spells = validate_profile_character(profile, observed_character(live, character_id))
    await authorize(grant)
    return {
      valid: unavailable_spells.length === 0,
      unavailable_spells,
      profile,
      observation_revision: live.observation_revision,
    }
  }
  return { validate_combat_profile }
}
