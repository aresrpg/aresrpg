// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { FightStateRow } from '@aresrpg/protocol'

import { create_fixture } from '../../fight/test/helpers.ts'
import { create_combat_control, type CombatRun } from '../src/combat_control.ts'
import { COMBAT_TOOLS, combat_calls } from '../src/combat_mcp.ts'
import { empty_lane, lane_key_for, type Command, type Lane } from '../src/control.ts'
import { gameplay_json } from '../src/gameplay.ts'
import { empty_snapshot } from '../src/actor_snapshot.ts'
import type { CombatProfile } from '../src/combat_profile.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { put } from './helpers/control_fixture.ts'
import { character as base_character } from './helpers/profession_fixture.ts'

const profile: CombatProfile = {
  version: '1',
  intent: 'Strength based, retreat; do not allocate stats.',
  combos: [{ name: 'retreat', steps: [{ type: 'move', direction: 'retreat' }] }],
  rules: [{ when: { type: 'always' }, combo: 'retreat' }],
  fallback: 'end_turn',
}
const fixture = async () => {
  const f = await runtime_fixture()
  const fight = `0x${'f'.repeat(64)}`
  const character = { ...base_character, custody: 'fight' as const, active_fight: { id: fight, seat: 0 } }
  const { checkpoint } = structuredClone(create_fixture())
  const player = checkpoint.contract.fighters[0]!
  if (player.kind.type !== 'player') throw new Error('fixture')
  player.kind.owner = f.bot.address
  player.kind.character = character.id
  checkpoint.contract.id = fight
  checkpoint.sources.players = { [character.id]: checkpoint.sources.players['0xc1']! }
  const row: FightStateRow = JSON.parse(
    gameplay_json({ contract: checkpoint.contract, players: checkpoint.sources.players, kolizeum: null })
  )
  const live = {
    ...empty_snapshot(),
    ready: true,
    frozen: false,
    indexing_lag: 0,
    characters: [character],
    fights: { [fight]: row },
    observation_revision: 1,
    observed_at: 100,
    clock: { chain_ms: 1000, observed_at: 100 },
    sampled_at: 100,
    decision_revision: 0,
  }
  const lane_key = lane_key_for(f.bot)
  await put(f.store, lane_key, {
    ...empty_lane(f.bot),
    actor_id: 'test',
    fence: 1,
    lease_until: 10000,
    observation_revision: 1,
    observed_at: 1000,
    needs_resync: false,
  })
  const control = create_combat_control(
    f.store,
    f.options.config,
    () => f.clock.now,
    async () => live
  )
  const save = () => control.save_combat_profile(f.grant, { character_id: character.id, expected_revision: 0, profile })
  const input = {
    idempotency_key: 'fight',
    fight,
    profiles: [{ character_id: character.id, revision: 1 }],
    decision_revision: 0,
    observation_revision: 1,
  }
  return { ...f, control, character, live, lane_key, save, input }
}

test('profiles persist without commands or stat writes, validate availability and use revision CAS', async () => {
  const f = await fixture()
  try {
    const before = await f.store.read<Lane>(f.lane_key)
    expect(await f.control.validate_combat_profile(f.grant, f.character.id, profile)).toMatchObject({ valid: true })
    expect(await f.control.combat_profile(f.grant, f.character.id)).toBeNull()
    await f.save()
    expect(await f.control.combat_profile(f.grant, f.character.id)).toMatchObject({ revision: 1, profile })
    expect(await f.store.read<Lane>(f.lane_key)).toEqual(before)
    expect(await f.store.scan_keys('command:', 100)).toEqual([])
    await expect(f.save()).rejects.toThrow('combat_profile_conflict')
    await expect(
      f.control.save_combat_profile(f.grant, {
        character_id: f.character.id,
        expected_revision: 1,
        profile: {
          ...profile,
          combos: [{ name: 'retreat', steps: [{ type: 'cast', spell: 'Tricky Trap', target: 'trap_near_enemy' }] }],
        },
      })
    ).rejects.toThrow('combat_spells_unavailable')
    await expect(
      f.control.save_combat_profile(f.grant, { character_id: `0x${'0'.repeat(64)}`, expected_revision: 0, profile })
    ).rejects.toThrow('character_authority_mismatch')
    await put(f.store, `grant:${f.grant.id}`, { ...f.grant, revoked: true })
    await expect(f.control.combat_profile(f.grant, f.character.id)).rejects.toThrow('invalid_token')
  } finally {
    await f.runtime.stop()
  }
})

test('one exact fight pins profiles; retries deduplicate and conflicting or incomplete authority fails', async () => {
  const f = await fixture()
  try {
    await f.save()
    await expect(f.control.start_combat(f.grant, { ...f.input, profiles: [] })).rejects.toThrow(
      'combat_profiles_mismatch'
    )
    await expect(
      f.control.start_combat(f.grant, { ...f.input, profiles: [...f.input.profiles, ...f.input.profiles] })
    ).rejects.toThrow('combat_profiles_mismatch')
    await expect(f.control.start_combat(f.grant, { ...f.input, observation_revision: 0 })).rejects.toThrow(
      'needs_resync'
    )
    const started = await f.control.start_combat(f.grant, f.input)
    expect(started).toMatchObject({
      status: 'active',
      fight: f.input.fight,
      profiles: [{ character_id: f.character.id, revision: 1, profile }],
    })
    expect(await f.control.start_combat(f.grant, f.input)).toEqual(started)
    await expect(f.control.start_combat(f.grant, { ...f.input, decision_revision: 1 })).rejects.toThrow(
      'idempotency_conflict'
    )
    await f.control.save_combat_profile(f.grant, {
      character_id: f.character.id,
      expected_revision: 1,
      profile: { ...profile, intent: 'Revised for next fight.' },
    })
    expect((await f.control.combat_status(f.grant, started.id)).profiles[0]!.profile.intent).toEqual(profile.intent)
    expect((await f.store.read<Lane>(f.lane_key))?.combat_run_id).toBe(started.id)
    await expect(
      f.control.start_combat(f.grant, {
        ...f.input,
        idempotency_key: 'other',
        decision_revision: 1,
        profiles: [{ character_id: f.character.id, revision: 2 }],
      })
    ).rejects.toThrow('bot_busy_or_paused')
  } finally {
    await f.runtime.stop()
  }
})

test('unsupported modes and profession occupancy cannot be admitted', async () => {
  const f = await fixture()
  try {
    await f.save()
    const original = f.live.fights[f.input.fight]!
    f.live.fights[f.input.fight] = { ...original, contract: { ...(original.contract as object), managed: true } }
    await expect(f.control.start_combat(f.grant, f.input)).rejects.toThrow('unsupported_fight_mode')
    f.live.fights[f.input.fight] = original
    await put(f.store, f.lane_key, { ...(await f.store.read<Lane>(f.lane_key))!, profession_run_id: 'busy' })
    await expect(f.control.start_combat(f.grant, f.input)).rejects.toThrow('bot_busy_or_paused')
  } finally {
    await f.runtime.stop()
  }
})

test('stop fences new work while preserving uncertain envelopes, cannot resume stopped work', async () => {
  const f = await fixture()
  try {
    await f.save()
    const run = await f.control.start_combat(f.grant, f.input)
    const lane = (await f.store.read<Lane>(f.lane_key))!
    const pending = {
      command_id: 'pending',
      grant_id: f.grant.id,
      phase: 'submitting' as const,
      digest: 'uncertain',
      encrypted: 'retained',
      gas_budget_mist: '1000',
    }
    await put(f.store, f.lane_key, { ...lane, pending, active_command: 'pending' })
    expect((await f.control.stop_combat(f.grant, run.id)).status).toBe('stopped')
    expect(await f.store.read<Lane>(f.lane_key)).toMatchObject({
      pending,
      active_command: 'pending',
      combat_run_id: null,
      decision_revision: lane.decision_revision + 1,
    })
    await f.control.stop_combat(f.grant, run.id)
    expect((await f.store.read<Lane>(f.lane_key))?.decision_revision).toBe(lane.decision_revision + 1)
    await expect(f.control.resume_combat(f.grant, run.id, lane.decision_revision + 1, 1)).rejects.toThrow(
      'combat_not_resumable'
    )
  } finally {
    await f.runtime.stop()
  }
})

test('resume requires a fresh idle lane and never replaces failed child work', async () => {
  const f = await fixture()
  try {
    await f.save()
    const run = await f.control.start_combat(f.grant, f.input)
    const lane = (await f.store.read<Lane>(f.lane_key))!
    await put(f.store, `combat:${run.id}`, { ...run, status: 'paused' })
    await put(f.store, f.lane_key, { ...lane, combat_run_id: null })
    await expect(f.control.resume_combat(f.grant, run.id, 0, 1)).rejects.toThrow('needs_resync')
    expect((await f.control.resume_combat(f.grant, run.id, 1, 1)).status).toBe('active')
    await put(f.store, `combat:${run.id}`, { ...run, status: 'awaiting_ai', last_command_id: 'failed' })
    await put(f.store, f.lane_key, { ...lane, combat_run_id: null })
    await put(f.store, 'command:failed', { status: 'uncertain' } as Command)
    await expect(f.control.resume_combat(f.grant, run.id, 1, 1)).rejects.toThrow('combat_not_resumable')
  } finally {
    await f.runtime.stop()
  }
})

test('profile preferences are bot-shared but active run control is grant-scoped', async () => {
  const f = await fixture()
  try {
    await f.save()
    const run = await f.control.start_combat(f.grant, f.input)
    const other = { ...f.grant, id: 'other' }
    await put(f.store, 'grant:other', other)
    expect((await f.control.combat_profile(other, f.character.id))?.revision).toBe(1)
    await expect(f.control.combat_status(other, run.id)).rejects.toThrow('combat_run_not_found')
    await expect(f.control.stop_combat(other, run.id)).rejects.toThrow('combat_run_not_found')
    await put(f.store, 'grant:other', { ...other, scopes: ['bot:observe'] })
    await expect(
      f.control.save_combat_profile(other, { character_id: f.character.id, expected_revision: 1, profile })
    ).rejects.toThrow('insufficient_scope')
    expect((await f.store.read<CombatRun>(`combat:${run.id}`))?.status).toBe('active')
  } finally {
    await f.runtime.stop()
  }
})

test('combat tools validate complete schemas before control and explain strategy revision', async () => {
  const f = await fixture()
  try {
    const calls = new Map(combat_calls(f.control))
    await expect(
      calls.get('bot_save_combat_profile')!(f.grant, {
        character_id: f.character.id,
        expected_revision: 0,
        profile,
        arbitrary: true,
      })
    ).rejects.toThrow('invalid_gameplay_payload')
    await calls.get('bot_save_combat_profile')!(f.grant, {
      character_id: f.character.id,
      expected_revision: 0,
      profile,
    })
    expect(COMBAT_TOOLS.find(({ name }) => name === 'bot_save_combat_profile')?.description).toContain(
      'spends no stat points'
    )
    expect(await calls.get('bot_start_combat')!(f.grant, f.input)).toMatchObject({ status: 'active' })
  } finally {
    await f.runtime.stop()
  }
})

test('concurrent profile writes have one winner and revoked observation cannot save a profile', async () => {
  const f = await fixture()
  try {
    const results = await Promise.allSettled([f.save(), f.save()])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect((await f.control.combat_profile(f.grant, f.character.id))?.revision).toBe(1)
    const race = create_combat_control(
      f.store,
      f.options.config,
      () => f.clock.now,
      async () => {
        await put(f.store, `grant:${f.grant.id}`, { ...f.grant, revoked: true })
        return f.live
      }
    )
    await expect(
      race.save_combat_profile(f.grant, { character_id: f.character.id, expected_revision: 1, profile })
    ).rejects.toThrow('invalid_token')
    expect((await f.store.read<{ revision: number }>(`combat_profile:${f.bot.id}:${f.character.id}`))?.revision).toBe(1)
  } finally {
    await f.runtime.stop()
  }
})

test('a changed observation between profile validation and commit fails closed', async () => {
  const f = await fixture()
  try {
    const race = create_combat_control(
      f.store,
      f.options.config,
      () => f.clock.now,
      async () => {
        await put(f.store, f.lane_key, { ...(await f.store.read<Lane>(f.lane_key))!, observation_revision: 2 })
        return f.live
      }
    )
    await expect(
      race.save_combat_profile(f.grant, { character_id: f.character.id, expected_revision: 0, profile })
    ).rejects.toThrow('needs_resync')
    expect(await f.control.combat_profile(f.grant, f.character.id)).toBeNull()
    await expect(f.control.start_combat(f.grant, f.input)).rejects.toThrow('needs_resync')
  } finally {
    await f.runtime.stop()
  }
})
