// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import {
  create_character_source,
  create_fight,
  player_max_hp,
  CONTRACT_CONSTANTS,
  type SpellLevel,
} from '@aresrpg/fight'
import { CHANNELS, EFFECT_KINDS } from '@aresrpg/fight/move_contract'
import { class_names } from '@aresrpg/immutable'

import { create_app, PRACTICE_APP_MODULES, PLAYER_APP_MODULES } from '../../src/store.ts'
import { practice_setup } from '../../src/modules/practice.ts'
import { advance_practice, next_practice_match, practice_bracket } from '../../src/practice/bracket.ts'
import { practice_roster } from '../../src/practice/roster.ts'
import { practice_bot_input } from '../../src/practice/policy.ts'
import { select_fight_view } from '../../src/game/fight/fight_projection.ts'
import { create_fight_session } from '../../src/modules/fight_session.ts'
import { end_turn_wait_ms } from '../../src/game/fight/FightHud.tsx'
import { catalog_spell_sources } from '../../src/content/fight_sources.ts'

const hero = () => create_character_source({ name: 'Hero', classe: 'senshi', level: 30n })
const practice = (seed = 2n) => {
  const matches = advance_practice(practice_bracket(seed), seed)
  return { seed, entrants: practice_roster(hero(), seed), matches, active: next_practice_match(matches) }
}

test('every six-entrant draw advances to one champion without replaying resolved matches', () => {
  for (let seed = 0n; seed < 50n; seed += 1n) {
    let matches = advance_practice(practice_bracket(seed), seed)
    expect(matches.slice(0, 4).filter(({ a, b }) => a === null || b === null)).toHaveLength(2)
    let played = 0
    for (let index = next_practice_match(matches); index >= 0; index = next_practice_match(matches)) {
      matches = advance_practice(
        matches.map((row, ordinal) => (ordinal === index ? { ...row, done: true, winner: 0 } : row)),
        seed
      )
      played += 1
    }
    expect(played).toBeGreaterThanOrEqual(2)
    expect(played).toBeLessThanOrEqual(3)
    expect(matches[6]?.winner).toBe(0)
    expect(advance_practice(matches, seed + 1n)).toEqual(matches)
  }
})

test('random opponents use legal classes and varied affordable spell levels', () => {
  const roster = practice_roster(hero(), 42n)
  expect(roster).toEqual(practice_roster(hero(), 42n))
  expect(roster).not.toEqual(practice_roster(hero(), 43n))
  expect(roster).toHaveLength(6)
  const levels = new Set<bigint>()
  for (const { source } of roster.slice(1)) {
    expect(class_names.some((classe) => classe === source.classe)).toBe(true)
    let spent = 0n
    for (const [name, level] of Object.entries(source.spell_levels)) {
      const spell = catalog_spell_sources()[name]!
      expect(spell.classe).toBe(source.classe)
      expect(spell.unlock_level).toBeLessThanOrEqual(source.level)
      expect(level).toBeGreaterThanOrEqual(1n)
      expect(level).toBeLessThanOrEqual(BigInt(spell.levels.length))
      spent += (level * (level - 1n)) / 2n
      levels.add(level)
    }
    expect(spent).toBeLessThanOrEqual(source.level - 1n)
  }
  expect(levels.size).toBeGreaterThan(1)
})

test('practice observers exclude authentication, networking, transactions and settlement', () => {
  expect(PRACTICE_APP_MODULES).toEqual(['practice', 'settings', 'audio', 'locale', 'fight'])
  expect(PLAYER_APP_MODULES).not.toContain('practice')
  const app = create_app()
  const stop = app.observe(['practice', 'fight'])
  const before = app.store.getState()
  app.dispatch({ type: 'practice/start', source: hero(), seed: 2n })
  app.dispatch({ type: 'practice/next' })
  let state = app.store.getState()
  expect(state.fight.mode).toBe('local')
  expect(state.fight.mounted).toBe(true)
  expect(state.fight.checkpoint?.contract.round).toBe(1n)
  expect(state.fight.error).toBeNull()
  app.dispatch({ type: 'fight/input', fight: null, origin: 'local', input: { type: 'forfeit', fighter: 0n } })
  for (let count = 0; count < 100 && app.store.getState().fight.presentations.length; count += 1)
    app.dispatch({ type: 'fight/presented', presentation: app.store.getState().fight.presentations[0]! })
  state = app.store.getState()
  expect(state.practice.active).toBeNull()
  expect(state.practice.matches[6]?.done).toBe(true)
  expect(state.practice.matches[6]?.winner).not.toBe(0)
  expect(state.session).toBe(before.session)
  expect(state.tournament).toBe(before.tournament)
  expect(state.fight_result).toEqual(before.fight_result)
  expect(state.fight.mounted).toBe(false)
  stop()
})

test('bot policy cannot control the human and produces legal commands through complete fights', () => {
  for (const seed of [1n, 5n, 23n]) {
    const setup = practice_setup(practice(seed))
    const runtime = create_fight({ mode: 'local', setup, seed })
    expect(runtime.apply({ type: 'start', observed_ms: 0n }).error).toBeNull()
    const view = select_fight_view({
      checkpoint: runtime.state(),
      mode: 'local',
      owner: 'local',
      character_id: null,
      names: {},
    })
    expect(view.timeline.filter(({ owned }) => owned).map(({ seat }) => seat)).toEqual([0n])
    let commands = 0
    while (!runtime.state().contract.ended && commands < 300) {
      const checkpoint = runtime.state()
      const active = checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)]!
      if (active === 0n) expect(practice_bot_input(checkpoint)).toBeNull()
      const input =
        active === 0n
          ? {
              type: 'end_turn' as const,
              fighter: 0n,
              observed_ms: checkpoint.contract.turn_started_ms + CONTRACT_CONSTANTS.turn_min_ms,
            }
          : practice_bot_input(checkpoint)!
      expect(input).not.toBeNull()
      const result = runtime.apply(input)
      expect(result.error).toBeNull()
      commands += 1
    }
    expect(runtime.state().contract.ended).toBe(true)
  }
}, 20000)

test('bots heal or buff themselves at most once per turn', () => {
  const setup = practice_setup(practice())
  const effect = {
    kind: EFFECT_KINDS.add,
    element: '',
    value: 10n,
    value_max: 10n,
    area_shape: 0n,
    area_size: 0n,
    target_filter: 3n,
    chance_bp: 10000n,
    turns: 0n,
    stat: CHANNELS.hp,
  }
  const level: SpellLevel = {
    ap_cost: 2n,
    range_min: 0n,
    range_max: 0n,
    modifiable_range: false,
    line_of_sight: false,
    line_launch: false,
    free_cell: false,
    casts_per_turn: 1n,
    casts_per_target: 1n,
    cooldown_turns: 0n,
    crit_1_in: 0n,
    effects: [effect],
    crit_effects: [],
  }
  const bot = setup.players[1]!
  const spells = {
    heal: { classe: bot.source.classe, unlock_level: 1n, levels: [level] },
    buff: {
      classe: bot.source.classe,
      unlock_level: 1n,
      levels: [{ ...level, effects: [{ ...effect, stat: CHANNELS.strength, turns: 2n }] }],
    },
  }
  setup.players[1] = { ...bot, source: { ...bot.source, spell_levels: { heal: 1n, buff: 1n } } }
  const runtime = create_fight({ mode: 'local', setup: { ...setup, spells }, seed: 1n })
  runtime.apply({ type: 'start', observed_ms: 0n })
  const checkpoint = structuredClone(runtime.state())
  checkpoint.contract.turn_ptr = BigInt(checkpoint.contract.queue.indexOf(1n))
  checkpoint.contract.fighters[1]!.hp = player_max_hp(bot.source) - 20n
  checkpoint.contract.fighters[1]!.ap = 6n
  checkpoint.contract.turn_casts = []
  const simulation = create_fight({ mode: 'local', state: checkpoint })
  const heal = practice_bot_input(simulation.state())!
  expect(heal.type).toBe('cast_spell')
  expect('spell' in heal && heal.spell).toBe('heal')
  expect(simulation.apply(heal).error).toBeNull()
  expect(practice_bot_input(simulation.state())?.type).not.toBe('cast_spell')
  checkpoint.contract.fighters[1]!.hp = player_max_hp(bot.source)
  const healthy = create_fight({ mode: 'local', state: checkpoint })
  const buff = practice_bot_input(healthy.state())!
  expect('spell' in buff && buff.spell).toBe('buff')
  expect(healthy.apply(buff).error).toBeNull()
  expect(practice_bot_input(healthy.state())).not.toEqual(buff)
})

test('local player turns never queue a transaction or wait for a future bot timestamp', () => {
  expect(end_turn_wait_ms(100, 100, 'local')).toBe(0)
  expect(end_turn_wait_ms(100, 100, 'remote')).toBeGreaterThan(0)
  const session = create_fight_session({ now: () => 100n, reconcile: () => {} })
  session.open({ mode: 'local', setup: practice_setup(practice()), seed: 1n })
  session.apply({ type: 'start' })
  for (let turn = 0; turn < 10; turn += 1) {
    const { contract } = session.state()!.checkpoint
    session.apply({ type: 'end_turn', fighter: contract.queue[Number(contract.turn_ptr)]! })
    expect(session.state()!.error).toBeNull()
  }
})
