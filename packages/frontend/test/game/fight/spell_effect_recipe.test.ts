// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import {
  create_character_source,
  create_fight_state,
  project_board_cells,
  type FightEvent,
  type SpellLevel,
} from '@aresrpg/fight'
import { spell_effect_timing } from '@aresrpg/engine'
import { CHANNELS, EFFECT_KINDS } from '@aresrpg/fight/move_contract'

import catalog from '../../../../engine/src/generated/claude_spell_catalog.json'
import spells from '../../../../../seed/content/spells.json'
import { resolve_spell_effect } from '../../../src/game/fight/spell_effect_recipe.ts'

const level_of = (name: string): SpellLevel => {
  const source = spells.find((spell) => spell.name === name)!.levels[0]!
  return JSON.parse(JSON.stringify(source), (_key, value: unknown) =>
    typeof value === 'number' ? BigInt(value) : value
  ) as SpellLevel
}
const setup = (classe: string, name: string, level = level_of(name)) => {
  const state = create_fight_state({
    fight_id: 'effects',
    board_seed: 1n,
    players: [
      {
        character: 'hero',
        owner: 'owner',
        ready: true,
        hp: 100n,
        source: create_character_source({ classe, level: 200n }),
      },
    ],
    mobs: [],
    spells: { [name]: { classe, unlock_level: 1n, levels: [level] } },
  })
  const origin = state.contract.fighters[0]!.cell
  const target = project_board_cells(state.contract.board).find(
    ({ cell, kind }) => cell !== origin && kind === 'floor'
  )!.cell
  const event = {
    type: 'spell_cast',
    payload: {
      caster: 0n,
      spell: name,
      target_cell: target,
      cast_level: 1n,
      slot: 0n,
      ap_cost: level.ap_cost,
      critical: false,
      weapon: false,
    },
  } as const satisfies FightEvent
  return { state, event, origin }
}

test('all 240 exact source presets resolve; weapons retain the fallback', () => {
  expect(Object.keys(catalog)).toHaveLength(12)
  for (const [classe, rows] of Object.entries(catalog)) {
    expect(rows).toHaveLength(20)
    for (const row of rows) {
      const { state, event } = setup(classe, row.name)
      const recipe = resolve_spell_effect(state, event)!
      expect(recipe.preset.cls).toBe(classe)
      expect(recipe.preset.name).toBe(row.name)
      expect(recipe.preset.path).toBe(row.path)
      expect(recipe.preset.fx).toEqual(row.fx)
      expect(resolve_spell_effect(state, { ...event, payload: { ...event.payload, weapon: true } })).toBeNull()
    }
  }
})

test('actual AP cost changes the original cast formula without changing the authored path', () => {
  const { state, event } = setup('yogan', 'Magic Arrow')
  const recipe = resolve_spell_effect(state, { ...event, payload: { ...event.payload, ap_cost: 5n } })!
  expect(recipe.preset.cast).toBeCloseTo(0.45 + 0.04 * 5)
  const timing = spell_effect_timing(recipe, 10 / 24)
  expect(timing.release_seconds).toBe(recipe.preset.cast)
  expect(timing.animation_release_seconds).toBeCloseTo(10 / 24)
})

test('critical caster-only payload geometry uses the caster cell', () => {
  const base = level_of('Magic Arrow'),
    row = base.effects[0]!
  const level = {
    ...base,
    crit_effects: [
      { ...row, kind: EFFECT_KINDS.add, stat: CHANNELS.hp, target_filter: 4n, value: 34n },
      { ...row, kind: EFFECT_KINDS.remove, stat: CHANNELS.ap, value: 3n },
    ],
  }
  const { state, event, origin } = setup('yogan', 'Magic Arrow', level)
  const recipe = resolve_spell_effect(state, { ...event, payload: { ...event.payload, critical: true } })!
  expect(recipe.areas[0]!.cells).toEqual([Number(origin)])
  expect(recipe.areas[1]!.stat).toBe('ap')
})

test('a hydrated critical trap recovers its exact preset from the stored payload', async () => {
  const { create_spell_effect_context, resolve_zone_effect } =
    await import('../../../src/game/fight/spell_effect_context.ts')
  const base = level_of('Mass Trap'),
    marker = base.effects.find((row) => row.kind === EFFECT_KINDS.trap)!
  const critical_payload = base.effects
    .filter((row) => row.kind !== EFFECT_KINDS.trap)
    .map((row) => ({ ...row, value: 99n, value_max: 99n }))
  const level = { ...base, crit_effects: [...critical_payload, marker] }
  const { state, event } = setup('yajin', 'Mass Trap', level)
  const checkpoint = {
    ...state,
    contract: {
      ...state.contract,
      zones: [
        {
          owner_fighter: 0n,
          trap: true,
          shape: marker.area_shape,
          size: marker.area_size,
          anchor: event.payload.target_cell,
          turns_left: 0n,
          effects: critical_payload,
        },
      ],
    },
  }
  const context = create_spell_effect_context(checkpoint, ['critical-zone'])
  const cue = {
    type: 'trap_triggered',
    payload: {
      zone_id: 'critical-zone',
      owner: 0n,
      fighter: 0n,
      from: event.payload.target_cell,
      cell: event.payload.target_cell,
    },
  } as const
  expect(resolve_zone_effect(context, cue, 'earth')?.preset.name).toBe('Mass Trap')
  expect(resolve_zone_effect(context, cue, 'earth')?.triggered).toBeTrue()
  expect(
    resolve_zone_effect(context, { ...cue, payload: { ...cue.payload, cell: cue.payload.cell + 1n } }, 'earth')
      ?.zone_anchor
  ).toBe(Number(event.payload.target_cell))
})
