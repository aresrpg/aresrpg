// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { FightStateRow } from '@aresrpg/protocol'

import { create_fixture } from '../../fight/test/helpers.ts'
import { create_combat_control } from '../src/combat_control.ts'
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
  return { ...f, control, character, live, lane_key }
}

test('a profile is validated against the hero and never stored: the tree is its only owner', async () => {
  const f = await fixture()
  try {
    expect(await f.control.validate_combat_profile(f.grant, f.character.id, profile)).toMatchObject({
      valid: true,
      unavailable_spells: [],
      observation_revision: 1,
    })
    await expect(f.control.validate_combat_profile(f.grant, 'nobody', profile)).rejects.toThrow('invalid_argument')
    await expect(f.control.validate_combat_profile(f.grant, f.character.id, { version: '2' })).rejects.toThrow()
    await put(f.store, 'grant:grant', { ...f.grant, scopes: ['bot:pause'] })
    await expect(f.control.validate_combat_profile(f.grant, f.character.id, profile)).rejects.toThrow(
      'insufficient_scope'
    )
    expect(await f.store.scan_keys('combat_profile:', 10)).toEqual([])
    expect(await f.store.scan_keys('command:', 10)).toEqual([])
  } finally {
    await f.runtime.stop()
  }
})

test('the one combat tool validates a complete schema before control', async () => {
  const f = await fixture()
  try {
    const calls = new Map(combat_calls(f.control))
    expect([...calls.keys()]).toEqual(['bot_validate_combat_profile'])
    expect(COMBAT_TOOLS.map(({ name }) => name)).toEqual(['bot_validate_combat_profile'])
    const validate = calls.get('bot_validate_combat_profile')!
    await expect(validate(f.grant, { character_id: f.character.id, profile, arbitrary: true })).rejects.toThrow(
      'invalid_gameplay_payload'
    )
    expect(await validate(f.grant, { character_id: f.character.id, profile })).toMatchObject({ valid: true })
  } finally {
    await f.runtime.stop()
  }
})
