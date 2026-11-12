// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create_fight, type HydratedFightCheckpoint } from '@aresrpg/fight'
import type { CharacterRow, FightStateRow } from '@aresrpg/protocol'

import { create_fixture } from '../../../fight/test/helpers.ts'
import { create_control_service, lane_key_for, type Command, type Lane } from '../../src/control.ts'
import { run_tick, run_observation } from '../../src/run_runtime.ts'
import type { CombatRun } from '../../src/combat_control.ts'
import type { CombatProfile } from '../../src/combat_profile.ts'
import { gameplay_json, type GameplayContext } from '../../src/gameplay.ts'
import type { Grant } from '../../src/model.ts'
import { create_envelope_cipher } from '../../src/envelope_cipher.ts'

import { fixture_bot, fixture_config, memory_store, put } from './control_fixture.ts'

export const character_id = `0x${'2'.repeat(64)}`
export const fight_id = `0x${'3'.repeat(64)}`
export const profile: CombatProfile = {
  version: '1',
  intent: 'Strike the nearest enemy.',
  combos: [{ name: 'attack', steps: [{ type: 'strike', target: 'nearest_enemy' }] }],
  rules: [{ when: { type: 'always' }, combo: 'attack' }],
  fallback: 'end_turn',
}
export const placement = (): HydratedFightCheckpoint => {
  const checkpoint = structuredClone(create_fixture().checkpoint)
  const player = checkpoint.contract.fighters[0]!
  if (player.kind.type !== 'player') throw new Error('invalid fixture')
  player.kind.owner = fixture_bot.address
  player.kind.character = character_id
  player.ready = false
  player.cell = 0n
  const mob = checkpoint.contract.fighters[1]!
  mob.cell = 1n
  mob.hp = 1n
  checkpoint.contract.id = fight_id
  checkpoint.contract.placement_ms = 1000n
  checkpoint.sources.players = { [character_id]: checkpoint.sources.players['0xc1']! }
  return checkpoint
}
export const started = () => {
  const checkpoint = placement()
  checkpoint.contract.fighters[0]!.ready = true
  const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
  const result = fight.apply({ type: 'start', observed_ms: 60_000n })
  if (result.error) throw new Error(result.error.code)
  return fight.state()
}
export const row_of = (checkpoint: HydratedFightCheckpoint): FightStateRow =>
  JSON.parse(gameplay_json({ contract: checkpoint.contract, players: checkpoint.sources.players, kolizeum: null }))
export const character = (): CharacterRow => ({
  id: character_id,
  name: 'Fixture',
  classe: 'senshi',
  sex: 'male',
  level: 10,
  experience: '0',
  color_1: 0,
  color_2: 0,
  color_3: 0,
  vitality: 0,
  wisdom: 0,
  strength: 100,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 0,
  spells: {},
  available_spell_points: 0,
  jobs: {},
  world: 'incarnam',
  checkpoint_world: 'incarnam',
  x: 50_000,
  z: 50_000,
  at_ms: 0,
  equipment: [],
  kiosk: `0x${'4'.repeat(64)}`,
  kiosk_cap: `0x${'5'.repeat(64)}`,
  custody: 'fight',
  active_fight: { id: fight_id, seat: 0 },
})
export const combat_fixture = async (checkpoint = placement()) => {
  const store = memory_store()
  const config = fixture_config
  const bot = fixture_bot
  const now = 63_000
  const grant: Grant = {
    id: 'grant',
    authority_generation: config.authority_generation,
    owner: bot.owner,
    client_id: 'client',
    bot_id: bot.id,
    network: bot.network,
    address: bot.address,
    descriptor: bot.multisig_public_key,
    generation: bot.generation,
    resource: config.resource,
    scopes: config.scopes,
    policy_revision: bot.policy.revision,
    revoked: false,
    code: { hash: '', challenge: '', redirect_uri: '', expires_at: 0, used: true },
    family: null,
    access: null,
  }
  await put(store, `bot:${bot.id}`, bot)
  await put(store, `grant:${grant.id}`, grant)
  const control = create_control_service(store, config, config.observation_freshness_ms, () => now)
  const lease = await control.acquire(bot, 'actor', 10_000)
  const key = lane_key_for(bot)
  await control.observed(key, 'actor', lease.fence, true)
  const run: CombatRun = {
    id: 'fixture-run',
    bot_id: bot.id,
    grant_id: grant.id,
    lane_key: key,
    fingerprint: 'fixture',
    fight: fight_id,
    profiles: [{ character_id, revision: 1, profile }],
    status: 'active',
    actions_started: 0,
    last_command_id: null,
    created_at: now,
  }
  await put(store, 'combat:fixture-run', run)
  await put(store, key, { ...(await store.read<Lane>(key))!, combat_run_id: run.id })
  const context: GameplayContext = {
    address: bot.address,
    now,
    freshness_ms: config.observation_freshness_ms,
    command: { ...run_observation('combat', run), observation_revision: 1 },
    snapshot: {
      characters: [character()],
      fights: { [fight_id]: row_of(checkpoint) },
      fight_phases: {},
      zones: {},
      tracked_zones: {},
      clock: { chain_ms: now, observed_at: now },
      observed_at: now,
      observation_revision: 1,
      ready: true,
      frozen: false,
      indexing_lag: 0,
      cursor: 1,
      events: [],
    },
  }
  const get_run = async () => (await store.read<CombatRun>('combat:fixture-run'))!
  const get_command = async () => (await store.read<Command>(`command:${(await get_run()).last_command_id}`))!
  const tick = async (current = context, requested?: CombatRun) =>
    run_tick('combat', {
      store,
      config,
      run: requested ?? (await get_run()),
      actor_id: 'actor',
      fence: lease.fence,
      context: current,
      now,
    })
  return {
    store,
    config,
    bot,
    grant,
    control,
    lease,
    key,
    now,
    context,
    get_run,
    get_command,
    tick,
    cipher: create_envelope_cipher(new Uint8Array(32).fill(7), 'fixture'),
  }
}
