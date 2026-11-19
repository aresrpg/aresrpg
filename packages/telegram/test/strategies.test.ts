// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { city_at_position } from '@aresrpg/engine/data'
import { hero_place } from '@aresrpg/protocol/strategies'

import { create_fight } from '../../fight/src/index.ts'
import { bind_hero, strategies } from '../src/strategies.ts'
import { parse_behavior_script, type BehaviorRun } from '../../bot/src/behavior_script.ts'
import { empty_behavior_memory } from '../../bot/src/behavior_tree.ts'
import { next_behavior_action } from '../../bot/src/behavior_plan.ts'
import { fight_turn_inputs, type FightTurnPayload } from '../../bot/src/gameplay.ts'
import { profession_context } from '../../bot/test/helpers/profession_fixture.ts'
import {
  combat_fixture,
  started,
  character_id,
  fight_id,
  row_of,
} from '../../bot/test/helpers/combat_runtime_fixture.ts'
import { behavior_actor } from '../../bot/src/behavior_projection.ts'
import mobs from '../../../seed/content/mobs.json'

import { MIRA, hero } from './helpers/connected_fixture.ts'

const run_for = (character: string): BehaviorRun => ({
  id: 'run',
  bot_id: 'bot',
  grant_id: 'grant',
  lane_key: 'lane',
  character_id: character,
  fingerprint: 'fixture',
  script: parse_behavior_script({
    version: '1',
    objective: { title: 'Supported primitives only; not an offered preset' },
    tree: {
      type: 'loop',
      child: {
        type: 'selector',
        children: [
          {
            type: 'action',
            action: {
              type: 'combat',
              profiles: [
                {
                  character_id: character,
                  profile: {
                    version: '1',
                    intent: 'Fixture strike',
                    combos: [{ name: 'attack', steps: [{ type: 'strike', target: 'nearest_enemy' }] }],
                    rules: [{ when: { type: 'always' }, combo: 'attack' }],
                    fallback: 'end_turn',
                  },
                },
              ],
            },
          },
          {
            type: 'action',
            action: {
              type: 'engage',
              character_id: character,
              mob_types: mobs.map(({ mob_type }) => mob_type),
              order: 'nearest',
            },
          },
          { type: 'wait' },
        ],
      },
    },
  }),
  revision: 1,
  memory: empty_behavior_memory(),
  pending_node: null,
  activation: null,
  consumed_command_id: null,
  status: 'active',
  actions_started: 0,
  last_command_id: null,
  created_at: 0,
})
const nearby = () => {
  const context = profession_context()
  const zone = context.snapshot.zones['fixture:97:97']!
  const { mob_type } = mobs.find((row) => row.role !== 'protector')!
  return {
    ...context,
    snapshot: {
      ...context.snapshot,
      zones: {
        'fixture:97:97': {
          ...zone,
          spawns: {
            ...zone.spawns!,
            mobs: [
              { index: 0, x: 50002, z: 50000, members: [{ mob_type, level_scalar: 100 }] },
              { index: 1, x: 50001, z: 50000, members: [{ mob_type, level_scalar: 100 }] },
            ],
          },
        },
      },
    },
  }
}

test('exactly two offered trees bind to where the hero stands, and the hosted bot’s own parser accepts both', () => {
  expect(strategies.map(({ id }) => id)).toEqual(['fight_nearby', 'gather_craft'])
  const bound = (id: string, row = hero(MIRA, 'Mira')) => bind_hero(id, row, 'A title')
  const tree = (id: string): any => {
    const result = bound(id)
    if (!result.ok) throw new Error(result.error)
    // The contract Telegram depends on: one tree acts for exactly one hero, and the bot can read it.
    expect(behavior_actor(parse_behavior_script(result.value.script))).toBe(MIRA)
    return { ...result.value, text: JSON.stringify(result.value.script.tree) }
  }
  expect(tree('fight_nearby').area).toEqual({ world: 'nauvis', city: 'thebes' })
  expect(tree('gather_craft').area).toEqual({ world: 'nauvis' })
  // The area is the shared helper's answer for the same row, and the script names its catalogue entry.
  expect(hero_place(hero(MIRA, 'Mira'), city_at_position)).toMatchObject(tree('fight_nearby').area)
  expect(tree('gather_craft').script.strategy).toBe('gather_craft')
  // Nothing of the catalogue's templates is left unbound, and no other hero is named.
  for (const id of ['fight_nearby', 'gather_craft']) {
    expect(tree(id).text).not.toContain('"$')
    expect(
      tree(id)
        .text.match(/0x[0-9a-f]{64}/g)!
        .every((character: string) => character === MIRA)
    ).toBe(true)
  }
  expect(bound('fight_nearby', { ...hero(MIRA, 'Mira'), x: 0, z: 0 })).toEqual({ ok: false, error: 'city_required' })
  expect(bound('fight_nearby', { ...hero(MIRA, 'Mira'), ambush: {} })).toEqual({
    ok: false,
    error: 'character_changed',
  })
  expect(bound('gather_craft', { ...hero(MIRA, 'Mira'), world: 'elsewhere' })).toEqual({
    ok: false,
    error: 'observation_unknown',
  })
  // The catalogue's team trees are not offered here.
  for (const id of ['team_hunt', 'dungeon_raid', 'gather_wheat'])
    expect(bound(id)).toEqual({ ok: false, error: 'unknown_strategy' })
})

test('supported primitive evidence: combat selects nearest live canonical mob group, waits when exhausted, and does not discover distant zones', () => {
  const context = nearby()
  const run = run_for(context.snapshot.characters[0]!.id)
  const next = next_behavior_action(run, null, context)
  expect(next.action?.kind).toBe('fight_engage')
  expect(next.action?.payload.group_index).toBe('1')
  const zone = context.snapshot.zones['fixture:97:97']!
  const consumed = {
    ...context,
    snapshot: {
      ...context.snapshot,
      zones: {
        'fixture:97:97': { ...zone, zone: { ...zone.zone, mob_taken: '3' } },
      },
    },
  }
  expect(next_behavior_action(run, null, consumed)).toMatchObject({ state: 'waiting', action: undefined })
  const unseen = { ...context, snapshot: { ...context.snapshot, tracked_zones: {} } }
  expect(next_behavior_action(run, null, unseen)).toMatchObject({ state: 'waiting', action: undefined })
})

test('supported primitive evidence: restart in an existing fight chooses legal combat, then settlement and another encounter through the real planner', async () => {
  const checkpoint = started()
  const f = await combat_fixture(checkpoint)
  const run = run_for(character_id)
  const next = next_behavior_action(run, null, f.context)
  expect(next.action?.kind).toBe('fight_turn')
  const payload = next.action!.payload as FightTurnPayload
  expect(payload.actions.some(({ type }) => type === 'strike')).toBe(true)
  const twin = create_fight({ state: checkpoint, mode: 'remote' })
  for (const action of fight_turn_inputs(payload)) {
    expect(twin.apply({ ...action, observed_ms: 63000n }).error).toBeNull()
  }
  const ended = twin.state()
  expect(ended.contract.ended).toBe(true)
  const settling = next_behavior_action(next.record, null, {
    ...f.context,
    snapshot: { ...f.context.snapshot, fights: { [fight_id]: row_of(ended) } },
  })
  expect(settling.action?.kind).toBe('fight_settle')
  const ground = nearby()
  const ready = {
    ...ground,
    snapshot: {
      ...ground.snapshot,
      characters: [{ ...ground.snapshot.characters[0]!, id: character_id }],
      tracked_zones: { [character_id]: { ...Object.values(ground.snapshot.tracked_zones)[0]!, character_id } },
    },
  }
  const settled_command = {
    ...ready.command,
    id: 'settled',
    kind: 'fight_settle' as const,
    payload: { fight: fight_id },
    status: 'completed' as const,
  }
  const reset = next_behavior_action(settling.record, settled_command, ready)
  expect(reset.state).toBe('waiting')
  expect(reset.record.activation).toBeNull()
  expect(reset.record.memory.completed).toEqual([])
  expect(next_behavior_action(reset.record, settled_command, ready).action?.kind).toBe('fight_engage')
})

test('existing engagement prefers a nearer group of three over one and has no loss-streak predicate', () => {
  const context = nearby()
  const zone = context.snapshot.zones['fixture:97:97']!
  const [farther, closer] = zone.spawns.mobs
  const crowded = {
    ...context,
    snapshot: {
      ...context.snapshot,
      zones: {
        'fixture:97:97': {
          ...zone,
          spawns: {
            ...zone.spawns,
            mobs: [farther!, { ...closer!, members: Array.from({ length: 3 }, () => closer!.members[0]!) }],
          },
        },
      },
    },
  }
  const run = run_for(context.snapshot.characters[0]!.id)
  expect(next_behavior_action(run, null, crowded).action?.payload.group_index).toBe('1')
  expect(() =>
    parse_behavior_script({
      ...run.script,
      tree: {
        type: 'condition',
        condition: { fact: { type: 'consecutive_losses', character_id }, op: 'gte', value: 2 },
      },
    })
  ).toThrow('invalid_behavior_condition')
})
