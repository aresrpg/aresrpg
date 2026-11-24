// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow } from '@aresrpg/protocol'

import type { BotConfig, Grant } from './model.ts'
import type { Observe } from './control.ts'
import type { ActorSnapshot } from './actor_snapshot.ts'
import { gameplay_observation_ready } from './gameplay_context.ts'
import { parse_combat_profile, validate_profile_character } from './combat_profile.ts'

type Live = ActorSnapshot & { decision_revision: number; sampled_at: number; status?: string }
const observed_character = (live: Live, character_id: string): CharacterRow => {
  const character = live.characters.find(({ id }) => id === character_id)
  if (!character) throw new Error('character_authority_mismatch')
  return character
}
/** A hero's tactics live in its tree and nowhere else. This only checks a profile an author is about
 * to embed against the hero's observed spells; it saves nothing and starts nothing. */
export const create_combat_control = (config: BotConfig, observe: Observe) => {
  const validate_combat_profile = async (grant: Grant, character_id: string, value: unknown) => {
    const profile = parse_combat_profile(value)
    const live = (await observe(grant, {})) as Live
    const ready = gameplay_observation_ready({
      snapshot: live,
      now: live.sampled_at,
      freshness_ms: config.observation_freshness_ms,
    })
    if (live.status === 'pending' || !ready) throw new Error('needs_resync')
    const unavailable_spells = validate_profile_character(profile, observed_character(live, character_id))
    return {
      valid: unavailable_spells.length === 0,
      unavailable_spells,
      profile,
      observation_revision: live.observation_revision,
    }
  }
  return { validate_combat_profile }
}
