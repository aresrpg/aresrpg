// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { CharacterRow, HostedObjective } from '@aresrpg/protocol'

import { assert_live_grant, type Bot, type BotConfig, type Grant } from './model.ts'
import type { ControlStore, ControlTransaction } from './store.ts'
import { admit_command, lane_key_for } from './command_admission.ts'
import type { Command, Lane, Observe } from './control.ts'
import type { ActorSnapshot } from './actor_snapshot.ts'
import { identifier, matches } from './gameplay_schema.ts'
import { gameplay_observation_ready, type GameplayContext } from './gameplay_context.ts'
import { parse_combat_profile, validate_profile_character, type CombatProfile } from './combat_profile.ts'

export type CombatProfileRecord = Readonly<{
  bot_id: string
  character_id: string
  revision: number
  profile: CombatProfile
}>
export type CombatRun = Readonly<{
  objective?: HostedObjective
  id: string
  bot_id: string
  grant_id: string
  lane_key: string
  fingerprint: string
  fight: string
  profiles: readonly Pick<CombatProfileRecord, 'character_id' | 'revision' | 'profile'>[]
  status: 'active' | 'waiting' | 'awaiting_ai' | 'paused' | 'completed' | 'stopped' | 'failed'
  actions_started: number
  last_command_id: string | null
  issue?: string
  created_at: number
}>
type Live = ActorSnapshot & { decision_revision: number; sampled_at: number; status?: string }
const profile_key = (bot_id: string, character_id: string) => `combat_profile:${bot_id}:${character_id}`
const assert_identifier = (id: string) => {
  if (!matches(identifier, id)) throw new Error('invalid_argument')
}
const assert_revision = (revision: number) => {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('invalid_argument')
}
const owned_run = (run: CombatRun | null, grant: Pick<Grant, 'id' | 'bot_id'>): CombatRun => {
  if (!run || run.grant_id !== grant.id || run.bot_id !== grant.bot_id) throw new Error('combat_run_not_found')
  return run
}
const observed_character = (live: Live, character_id: string): CharacterRow => {
  const character = live.characters.find(({ id }) => id === character_id)
  if (!character) throw new Error('character_authority_mismatch')
  return character
}
const assert_profile_available = (profile: CombatProfile, character: CharacterRow) => {
  if (validate_profile_character(profile, character).length) throw new Error('combat_spells_unavailable')
}
const observation_command = (grant: Grant, live: Live): Command => ({
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
})
const observed_context = (grant: Grant, live: Live, freshness_ms: number): GameplayContext => ({
  address: grant.address,
  snapshot: live,
  command: observation_command(grant, live),
  now: live.sampled_at,
  freshness_ms,
})
const assert_observed_lane = (lane: Lane | null, live: Live, now: number, freshness_ms: number): Lane => {
  if (
    !lane ||
    lane.transport_stopped ||
    lane.observation_revision !== live.observation_revision ||
    lane.lease_until <= now ||
    lane.observed_at + freshness_ms <= now
  )
    throw new Error('needs_resync')
  return lane
}
/** Preferences are durable data; only an explicitly accepted fight run authorizes execution. */
export const create_combat_control = (store: ControlStore, config: BotConfig, now: () => number, observe: Observe) => {
  const authority_keys = (grant: Grant) => [`grant:${grant.id}`, `bot:${grant.bot_id}`]
  const authorize = async (tx: ControlTransaction, grant: Grant, scope: string) => {
    const current = await tx.get<Grant>(`grant:${grant.id}`)
    if (!current || current.bot_id !== grant.bot_id || current.address !== grant.address)
      throw new Error('invalid_token')
    assert_live_grant(config, current, await tx.get<Bot>(`bot:${grant.bot_id}`), now())
    if (!current.scopes.includes(scope)) throw new Error('insufficient_scope')
    return current
  }
  const read_authorized = (grant: Grant, scope: string) =>
    store.transaction(authority_keys(grant), (tx) => authorize(tx, grant, scope))
  const live_for = async (grant: Grant) => {
    await read_authorized(grant, 'bot:observe')
    const live = (await observe(grant, {})) as Live
    if (
      live.status === 'pending' ||
      !gameplay_observation_ready(observed_context(grant, live, config.observation_freshness_ms))
    )
      throw new Error('needs_resync')
    return live
  }
  const combat_profile = async (grant: Grant, character_id: string) => {
    assert_identifier(character_id)
    const key = profile_key(grant.bot_id, character_id)
    return store.transaction([...authority_keys(grant), key], async (tx) => {
      await authorize(tx, grant, 'bot:observe')
      return tx.get<CombatProfileRecord>(key)
    })
  }
  const validate_combat_profile = async (grant: Grant, character_id: string, value: unknown) => {
    assert_identifier(character_id)
    await read_authorized(grant, 'bot:observe')
    const profile = parse_combat_profile(value)
    const live = await live_for(grant)
    const unavailable_spells = validate_profile_character(profile, observed_character(live, character_id))
    await read_authorized(grant, 'bot:observe')
    return {
      valid: unavailable_spells.length === 0,
      unavailable_spells,
      profile,
      observation_revision: live.observation_revision,
    }
  }
  const save_combat_profile = async (
    grant: Grant,
    input: Readonly<{ character_id: string; expected_revision: number; profile: unknown }>
  ) => {
    assert_identifier(input.character_id)
    assert_revision(input.expected_revision)
    await read_authorized(grant, 'bot:play')
    const profile = parse_combat_profile(input.profile)
    const live = await live_for(grant)
    assert_profile_available(profile, observed_character(live, input.character_id))
    const key = profile_key(grant.bot_id, input.character_id)
    const lane_key = lane_key_for(grant)
    return store.transaction([...authority_keys(grant), key, lane_key], async (tx) => {
      await authorize(tx, grant, 'bot:play')
      assert_observed_lane(await tx.get<Lane>(lane_key), live, now(), config.observation_freshness_ms)
      const previous = await tx.get<CombatProfileRecord>(key)
      if ((previous?.revision ?? 0) !== input.expected_revision) throw new Error('combat_profile_conflict')
      const revision = input.expected_revision + 1
      assert_revision(revision)
      const record: CombatProfileRecord = { bot_id: grant.bot_id, character_id: input.character_id, revision, profile }
      await tx.put(key, record)
      return record
    })
  }
  const combat_status = (grant: Grant, id: string) =>
    store.transaction([...authority_keys(grant), `combat:${id}`], async (tx) => {
      await authorize(tx, grant, 'bot:observe')
      return owned_run(await tx.get<CombatRun>(`combat:${id}`), grant)
    })
  const stop_combat = async (grant: Grant, id: string) => {
    const lane_key = lane_key_for(grant)
    return store.transaction([...authority_keys(grant), `combat:${id}`, lane_key], async (tx) => {
      await authorize(tx, grant, 'bot:pause')
      const run = owned_run(await tx.get<CombatRun>(`combat:${id}`), grant)
      if (['completed', 'stopped', 'failed'].includes(run.status)) return run
      const lane = await tx.get<Lane>(lane_key)
      const stopped: CombatRun = { ...run, status: 'stopped', issue: 'explicit_stop' }
      await tx.put(`combat:${id}`, stopped)
      if (lane?.combat_run_id === id)
        await tx.put(lane_key, { ...lane, combat_run_id: null, decision_revision: lane.decision_revision + 1 })
      return stopped
    })
  }
  const resume_combat = async (grant: Grant, id: string, decision_revision: number, observation_revision: number) => {
    const previous = await combat_status(grant, id)
    const live = await live_for(grant)
    const last_key = previous.last_command_id ? `command:${previous.last_command_id}` : null
    return store.transaction(
      [...authority_keys(grant), `combat:${id}`, previous.lane_key, ...(last_key ? [last_key] : [])],
      async (tx) => {
        const current = await authorize(tx, grant, 'bot:play')
        const run = owned_run(await tx.get<CombatRun>(`combat:${id}`), current)
        if (!['paused', 'awaiting_ai'].includes(run.status) || run.last_command_id !== previous.last_command_id)
          throw new Error('combat_not_resumable')
        const last = last_key ? await tx.get<Command>(last_key) : null
        if (last && last.status !== 'completed') throw new Error('combat_not_resumable')
        const lane = assert_observed_lane(
          await tx.get<Lane>(run.lane_key),
          live,
          now(),
          config.observation_freshness_ms
        )
        admit_command(
          current,
          lane,
          { kind: 'fight_turn', decision_revision, observation_revision },
          now(),
          config.observation_freshness_ms
        )
        const resumed: CombatRun = { ...run, status: 'active', issue: undefined }
        await tx.put(`combat:${id}`, resumed)
        await tx.put(run.lane_key, { ...lane, combat_run_id: id, decision_revision: lane.decision_revision + 1 })
        return resumed
      }
    )
  }
  return {
    combat_profile,
    validate_combat_profile,
    save_combat_profile,
    combat_status,
    stop_combat,
    resume_combat,
  }
}
