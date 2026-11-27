// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The game as the bot observes it: a hero with a profession context, the seed world's zones, and fights
// of the shared fight twin seated for this wallet.
import { gatherable_of } from '@aresrpg/immutable'
import { ZONE_SIZE, type CharacterRow, type ItemRow, type MobGroupRow } from '@aresrpg/protocol'

import { id } from '../../sdk/test/helpers/transport.ts'
import { empty_snapshot } from '../src/actor_snapshot.ts'
import { empty_inventory } from '../src/actor_inventory.ts'
import { empty_behavior_memory } from '../src/behavior_tree.ts'
import type { ActorSnapshot } from '../src/actor_snapshot.ts'
import type { BehaviorRun, BehaviorScript } from '../src/behavior_script.ts'
import type { Grant } from '../src/model.ts'
import { run_tick } from '../src/run_runtime.ts'
import { process_lane_runs } from '../src/run_actor.ts'
import { profession_recipes } from '../src/catalog.ts'
import { create_control_service, lane_key_for, type Command, type Lane } from '../src/control.ts'
import { validate_gameplay } from '../src/gameplay.ts'
import { type GameplayContext } from '../src/gameplay_context.ts'

import { put, runtime_fixture } from './fixture.ts'

// Profession context: derived from authored content instead of pinning mutable recipe balance.
export const recipe = profession_recipes.find(
  (row) =>
    Object.keys(row.inputs).length === 2 &&
    Object.keys(row.inputs).some((item_type) => gatherable_of(item_type)?.tier === 1)
)!
export const resource = Object.keys(recipe.inputs)
  .map(gatherable_of)
  .find((row) => row?.tier === 1)!
export const other_input = Object.keys(recipe.inputs).find((item_type) => item_type !== resource.item_type)!
export const character: CharacterRow = {
  id: id(20),
  name: 'Profession fixture',
  classe: 'senshi',
  sex: 'male',
  level: 10,
  experience: '0',
  color_1: 0,
  color_2: 0,
  color_3: 0,
  vitality: 0,
  wisdom: 0,
  strength: 0,
  intelligence: 0,
  chance: 0,
  agility: 0,
  available_points: 0,
  spells: {},
  available_spell_points: 0,
  jobs: {},
  world: 'fixture',
  checkpoint_world: 'fixture',
  x: 50000,
  z: 50000,
  at_ms: 0,
  kiosk: id(12),
  kiosk_cap: id(13),
  custody: 'kiosk',
  equipment: [
    {
      id: id(15),
      slot: 'tool',
      item_type: 'fixture_tool',
      name: 'Fixture tool',
      category: `tool_${resource.job.toLowerCase()}`,
      level: 1,
      amount: 1,
    },
  ],
}
export const item = (item_type: string, amount: number, number = 30, patch: Partial<ItemRow> = {}): ItemRow => ({
  id: id(number),
  item_type,
  name: item_type,
  category: 'resource',
  level: 1,
  amount,
  kiosk: character.kiosk,
  version: '1',
  ...patch,
})
export const profession_context = (): GameplayContext => ({
  address: id(99),
  now: 63000,
  freshness_ms: 60000,
  command: {
    id: 'fixture',
    grant_id: 'grant',
    bot_id: 'bot',
    lane_key: 'lane',
    fingerprint: 'fixture',
    kind: 'observe',
    payload: {},
    observation_revision: 1,
    decision_revision: 0,
    status: 'accepted',
  },
  snapshot: {
    ...empty_snapshot(),
    characters: [character],
    ready: true,
    frozen: false,
    indexing_lag: 0,
    clock: { chain_ms: 63000, observed_at: 63000 },
    observed_at: 63000,
    observation_revision: 1,
    inventory: { ...empty_inventory(), loaded: true, listings: [], trades: [], items: [item(other_input, 100)] },
    tracked_zones: {
      [character.id]: {
        type: 'packet/tracked_zones',
        character_id: character.id,
        world: 'fixture',
        zones: [{ zx: 97, zz: 97 }],
      },
    },
    zones: {
      'fixture:97:97': {
        zone: { world: 'fixture', zx: 97, zz: 97, seed: '1', searched_at_ms: 0, mob_taken: '0', res_taken: [] },
        spawns: {
          type: 'packet/zone_spawns',
          world: 'fixture',
          zx: 97,
          zz: 97,
          mobs: [],
          resources: [{ index: 0, x: 50000, z: 50000, item_type: resource.item_type, nodes: 20 }],
        },
      },
    },
  },
})
/** The context a command reads: the profession context with that command bound to it. */
export const command_context = (kind: string, payload: object, base: GameplayContext = profession_context()) =>
  ({ ...base, command: { ...base.command, kind, payload } }) as GameplayContext

// Travel: a hero of the real seed world, placed by zone, with the three by three window the server tracks.
export const WORLD = 'nauvis'
type Zone = Readonly<{ zx: number; zz: number }>
const center = (index: number) => (index + 0.5) * ZONE_SIZE
export const hero_in = (zone: Zone, patch: Partial<CharacterRow> = {}): CharacterRow => ({
  ...character,
  world: WORLD,
  checkpoint_world: WORLD,
  x: center(zone.zx),
  z: center(zone.zz),
  at_ms: 0,
  ...patch,
})
/** The hero's world as its bot observes it: every tracked zone searched, holding the given mob groups. */
export const world_context = (hero: CharacterRow, groups: Readonly<Record<string, readonly MobGroupRow[]>> = {}) => {
  const base = profession_context()
  const here = { zx: Math.floor(hero.x! / ZONE_SIZE), zz: Math.floor(hero.z! / ZONE_SIZE) }
  const zones =
    hero.world === WORLD
      ? [-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dz) => ({ zx: here.zx + dx, zz: here.zz + dz })))
      : []
  const row = ({ zx, zz }: Zone) => ({
    zone: { world: WORLD, zx, zz, seed: '1', searched_at_ms: 0, mob_taken: '0', res_taken: [] },
    spawns: {
      type: 'packet/zone_spawns' as const,
      world: WORLD,
      zx,
      zz,
      resources: [],
      mobs: [...(groups[`${zx}:${zz}`] ?? [])],
    },
  })
  return {
    ...base,
    now: 600_000,
    snapshot: {
      ...base.snapshot,
      characters: [hero],
      clock: { chain_ms: 600_000, observed_at: 600_000 },
      observed_at: 600_000,
      tracked_zones: { [hero.id]: { type: 'packet/tracked_zones', character_id: hero.id, world: hero.world!, zones } },
      zones: Object.fromEntries(zones.map((zone) => [`${WORLD}:${zone.zx}:${zone.zz}`, row(zone)])),
    },
  } as GameplayContext
}
export const group_in = (zone: Zone, index: number, mob_type: string, size: number): MobGroupRow => ({
  index,
  x: center(zone.zx) + index,
  z: center(zone.zz),
  members: Array.from({ length: size }, () => ({ mob_type, level_scalar: 0 })),
})
export const run_of = (script: BehaviorScript, patch: Partial<BehaviorRun> = {}): BehaviorRun => ({
  id: 'run',
  bot_id: 'bot',
  grant_id: 'grant',
  lane_key: 'lane',
  character_id: character.id,
  fingerprint: 'fixture',
  script,
  revision: 1,
  memory: empty_behavior_memory(),
  pending_node: null,
  activation: null,
  consumed_command_id: null,
  status: 'active',
  actions_started: 0,
  last_command_id: null,
  created_at: 0,
  ...patch,
})

/** Two heroes of one wallet, their gather trees and one scheduler pass of the wallet's signing queue. */
export const ally = { ...character, id: id(21), name: 'Second hero' }
export const tree = (character_id: string, title = 'Gather'): BehaviorScript => ({
  version: '1',
  objective: { title },
  tree: { type: 'action', action: { type: 'gather', character_id, item_type: resource.item_type, order: 'nearest' } },
})
export const context = (observation_revision: number) => {
  const base = profession_context()
  const tracked = base.snapshot.tracked_zones[character.id]!
  return {
    ...base,
    command: { ...base.command, observation_revision },
    snapshot: {
      ...base.snapshot,
      observation_revision,
      characters: [character, ally],
      tracked_zones: { [character.id]: tracked, [ally.id]: { ...tracked, character_id: ally.id } },
    },
  }
}
export const hero_runs = async () => {
  const f = await runtime_fixture()
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const key = lane_key_for(f.bot)
  const lease = async () => {
    const lane = await control.acquire(f.bot, 'actor', 10000)
    await control.observed(key, 'actor', lane.fence, true)
    return lane.fence
  }
  const first_fence = await lease()
  const start = (character_id: string, grant: Grant = f.grant) =>
    control.start_behavior(grant, {
      idempotency_key: character_id,
      script: tree(character_id),
      decision_revision: 0,
      observation_revision: 1,
    })
  const run = async (run_id: string) => (await f.store.read<BehaviorRun>(`behavior:${run_id}`))!
  const lane = async () => (await f.store.read<Lane>(key))!
  const tick = async (run_id: string, fence = first_fence) =>
    run_tick({
      store: f.store,
      config: f.options.config,
      actor_id: 'actor',
      fence,
      run: await run(run_id),
      context: context((await lane()).observation_revision),
      now: f.clock.now,
    })
  const command_of = async (run_id: string) =>
    (await f.store.read<Command>(`command:${(await run(run_id)).last_command_id}`))!
  /** The signature settled and its effect is projected: the slot is free again. */
  const settle = async (run_id: string) => {
    const command = await command_of(run_id)
    await put(f.store, `command:${command.id}`, { ...command, status: 'completed', result: { digest: 'fixture' } })
    await put(f.store, key, { ...(await lane()), active_command: null })
    return command
  }
  const asked: Command[] = []
  /** One scheduler pass of the wallet's signing queue. `connect` stands in for applying a session's watches. */
  const pass = async (observed?: ActorSnapshot, connect = async () => {}) =>
    process_lane_runs(key, {
      store: f.store,
      config: f.options.config,
      actor_id: 'actor',
      report_failure: f.options.report_failure,
      now: () => f.clock.now,
      snapshot: () => observed,
      session: async (_bot, command) => {
        asked[asked.length] = command
        return { context: context((await lane()).observation_revision), fence: first_fence, connect, journey: () => {} }
      },
    })
  return { ...f, control, key, first_fence, lease, start, run, lane, tick, command_of, settle, pass, asked }
}

/** The validated plan of a command, named by its kind: what its record validated and where it walks. */
export const plan_of = (context: GameplayContext): Readonly<{ kind: string; input: any; travel?: any }> => ({
  kind: context.command.kind,
  ...validate_gameplay(context),
})
