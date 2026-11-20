// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { create_character_source, create_fight } from '@aresrpg/fight'
import { characteristic_spending_quote, type CharacteristicName } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'
import { basic_build } from '@aresrpg/protocol/strategies'

import spells from '../../../seed/content/spells.json'
import { create_fixture } from '../../fight/test/helpers.ts'
import { select_spending, type SpendAction } from '../src/behavior_growth.ts'
import { parse_combat_profile, validate_profile_character } from '../src/combat_profile.ts'
import { plan_combat_turn } from '../src/combat_tactics.ts'
import { validate_gameplay, type GameplayContext } from '../src/gameplay.ts'

import { character, profession_context } from './helpers/profession_fixture.ts'

const build = basic_build('yogan')
const [arrow, range, critical, power] = build.spells!
const spend = (hero: CharacterRow): SpendAction => ({
  type: 'spend_points',
  character_id: hero.id,
  stats: build.stats as readonly CharacteristicName[],
  spells: build.spells!,
})
const context_of = (hero: CharacterRow): GameplayContext => {
  const base = profession_context()
  return { ...base, snapshot: { ...base.snapshot, characters: [hero] } }
}
type Payload = Readonly<{ spending?: Readonly<Record<string, number>>; spell?: string }>
/** What the chain does with one spending command: the class ladder for stats, one rank for a spell. */
const applied = (hero: CharacterRow, { spending, spell }: Payload): CharacterRow => {
  if (spending) {
    const quote = characteristic_spending_quote('yogan', hero, spending)!
    const intelligence = hero.intelligence + quote.gains.intelligence
    return { ...hero, intelligence, available_points: hero.available_points - quote.cost }
  }
  const rank = hero.spells[spell!] ?? 1
  return {
    ...hero,
    spells: { ...hero.spells, [spell!]: rank + 1 },
    available_spell_points: hero.available_spell_points - rank,
  }
}
/** Spend until the leaf has nothing left to do, recording what it chose. */
const spent = (hero: CharacterRow, log: Payload[]): CharacterRow => {
  const context = context_of(hero)
  const selection = select_spending(spend(hero), context)
  if (selection.status !== 'action') return hero
  // Every choice is one the bot's own validator accepts as a command.
  validate_gameplay({ ...context, command: { ...context.command, ...selection.action } })
  const payload = selection.action.payload as Payload
  log.push(payload)
  return spent(applied(hero, payload), log)
}
/** Each level grants five stat points and, from level two, one spell point. */
const level_up = (hero: CharacterRow): CharacterRow => ({
  ...hero,
  level: hero.level + 1,
  available_points: hero.available_points + 5,
  available_spell_points: hero.available_spell_points + 1,
})

test('the archer build puts every stat point in intelligence and maxes Magic Arrow before any buff', () => {
  const log: Payload[] = []
  const start: CharacterRow = { ...character, classe: 'yogan', level: 1 }
  const hero = Array.from({ length: 49 }).reduce<CharacterRow>((current) => spent(level_up(current), log), start)
  expect(hero.level).toBe(50)
  // Stats: only intelligence, and never a point left that pays for another step.
  expect(log.flatMap(({ spending }) => (spending ? Object.keys(spending) : []))).toContain('intelligence')
  expect(new Set(log.flatMap(({ spending }) => (spending ? Object.keys(spending) : [])))).toEqual(
    new Set(['intelligence'])
  )
  expect(hero.intelligence).toBe(50 + (49 * 5 - 50 - hero.available_points) / 2)
  expect(hero.available_points).toBeLessThan(2)
  // Spells: strict priority. A buff learned at level 9 waits until Magic Arrow has its last rank.
  const ranks = (spell: string | undefined, count: number) => Array<string>(count).fill(spell!)
  expect(log.flatMap(({ spell }) => (spell ? [spell] : []))).toEqual([
    ...ranks(arrow, 5),
    ...ranks(range, 5),
    ...ranks(critical, 5),
    ...ranks(power, 2),
  ])
  expect(hero.spells).toEqual({ [arrow!]: 6, [range!]: 6, [critical!]: 6, [power!]: 3 })
})

test('points wait for the first listed spell instead of leaking to a cheaper one behind it', () => {
  // Magic Arrow's next rank costs three: two points do not buy a first rank of a learned buff.
  const saving: CharacterRow = {
    ...character,
    classe: 'yogan',
    level: 20,
    spells: { [arrow!]: 3 },
    available_spell_points: 2,
  }
  expect(select_spending(spend(saving), context_of(saving))).toEqual({ status: 'failure', code: 'nothing_to_spend' })
  const paid = { ...saving, available_spell_points: 3 }
  expect(select_spending(spend(paid), context_of(paid))).toMatchObject({
    action: { kind: 'raise_spell', payload: { spell: arrow } },
  })
  // A maxed spell and a spell not learned yet are passed over: the next raisable one takes the points.
  const maxed = { ...saving, level: 20, spells: { [arrow!]: 6, [range!]: 6 }, available_spell_points: 1 }
  expect(select_spending(spend(maxed), context_of(maxed))).toEqual({ status: 'failure', code: 'nothing_to_spend' })
  const learned = { ...maxed, level: 21 }
  expect(select_spending(spend(learned), context_of(learned))).toMatchObject({
    action: { kind: 'raise_spell', payload: { spell: critical } },
  })
})

test('a hero of another class is bound no build, so its growth leaf spends nothing', () => {
  const other = basic_build(character.classe)
  expect(other).toEqual({})
  const hero = { ...character, available_points: 30, available_spell_points: 9 }
  const idle: SpendAction = { type: 'spend_points', character_id: hero.id, stats: [], spells: [] }
  expect(select_spending(idle, context_of(hero))).toEqual({ status: 'failure', code: 'nothing_to_spend' })
})

/** A real fight of the twin: an archer of the given level three cells from one mob. */
const archer_turn = (level: bigint, ap = 6n) => {
  const state = structuredClone(create_fixture().checkpoint)
  state.sources.players['0xc1'] = create_character_source({ classe: 'yogan', level, intelligence: 100n })
  state.sources.spells = Object.fromEntries(spells.map(({ name, ...spell }) => [name, spell])) as never
  state.contract.closed = state.contract.closed.map(() => 0n)
  Object.assign(state.contract, { round: 1n, queue: [0n, 1n], turn_ptr: 0n, turn_started_ms: 1_000n })
  Object.assign(state.contract.fighters[0]!, { cell: 105n, ap, mp: 3n })
  state.contract.fighters[1]!.cell = 108n
  const profile = parse_combat_profile(build.profile)
  return plan_combat_turn(profile, create_fight({ state, mode: 'remote' }).state(), 0n, 4_000n)
}

test('the archer profile shoots Magic Arrow at every level and casts a buff only once it is learned', () => {
  const profile = parse_combat_profile(build.profile)
  // Only Magic Arrow is required: a level-one archer plays this profile without any buff.
  expect(validate_profile_character(profile, { classe: 'yogan', level: 1, spells: {} })).toEqual([])
  expect(validate_profile_character(profile, { classe: 'senshi', level: 200, spells: {} })).toEqual([arrow!])
  const casts = (level: bigint, ap?: bigint) =>
    archer_turn(level, ap).actions.flatMap((action) => (action.type === 'cast' ? [action.spell] : []))
  expect(casts(1n)).toEqual([arrow!])
  // Six action points: the arrow costs four, so one two-point buff follows it.
  expect(casts(9n)).toEqual([arrow!, range!])
  expect(casts(40n)).toEqual([arrow!, range!])
  // With points to spare every learned buff is a legal cast on the archer itself, in the authored order.
  expect(casts(40n, 20n)).toEqual([arrow!, range!, critical!, power!])
  expect(casts(21n, 20n)).toEqual([arrow!, range!, critical!])
  expect(archer_turn(1n).skipped).toEqual(['range:cast', 'critical:cast', 'power:cast'])
  // Six full turn plans, each simulated on the real fight twin: about one second each on a CI runner
  // under coverage, so the default five seconds is too short.
}, 30_000)
