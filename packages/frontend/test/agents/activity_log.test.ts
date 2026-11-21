// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { CharacterRow } from '@aresrpg/protocol'

import {
  fold_hero_logs,
  HERO_LOG_LINES,
  observed_heroes,
  type HeroEvent,
  type HeroLogs,
  type ObservedHeroes,
} from '../../src/agents/activity.ts'

import { account, bran, direct, mira, pushed, result, run, type Account } from './log_fixture.ts'

const NONE: HeroLogs = {}
/** The account seen as a sequence of store states: each pair is folded once, a second apart. */
const follow = (states: readonly Account[], logs: HeroLogs = NONE): HeroLogs =>
  states.map(observed_heroes).reduce<Readonly<{ logs: HeroLogs; seen: ObservedHeroes | null }>>(
    ({ logs: kept, seen }, next, index) => ({
      logs: seen ? fold_hero_logs(kept, seen, next, index * 1_000) : kept,
      seen: next,
    }),
    { logs, seen: null }
  ).logs
const events = (logs: HeroLogs, hero = 'mira'): readonly HeroEvent[] => (logs[hero] ?? []).map(({ event }) => event)
/** One observed change, then the same state delivered again. */
const once = (before: Account, after: Account): readonly HeroEvent[] => events(follow([before, after, after, after]))

test('each fact of a hero row that moves is one line, and the same row seen again is none', () => {
  const start = account()
  const row = (changes: Partial<CharacterRow>) => account({ characters: [mira(changes)] })
  expect(once(start, row({ level: 14 }))).toEqual([{ kind: 'level', level: 14 }])
  expect(once(start, row({ experience: '1250' }))).toEqual([{ kind: 'experience', gained: '1250' }])
  expect(once(start, row({ jobs: { miner: '40' } }))).toEqual([{ kind: 'profession' }])
  expect(once(start, row({ x: 50_010, at_ms: 2 }))).toEqual([{ kind: 'travel' }])
  expect(once(start, row({ active_fight: { id: 'fight', seat: 0 } }))).toEqual([{ kind: 'fight_entered' }])
  expect(once(row({ active_fight: { id: 'fight', seat: 0 } }), start)).toEqual([{ kind: 'fight_left' }])
  const first_room = row({ dungeon_run: { dungeon: 'gilded_lorito', room: 0 } })
  expect(once(start, first_room)).toEqual([{ kind: 'dungeon', dungeon: 'gilded_lorito', room: 0 }])
  expect(once(first_room, row({ dungeon_run: { dungeon: 'gilded_lorito', room: 1 } }))).toEqual([
    { kind: 'dungeon', dungeon: 'gilded_lorito', room: 1 },
  ])
  expect(once(first_room, start)).toEqual([{ kind: 'dungeon_left' }])
  // Experience that did not grow, and a level that did not rise, are not lines.
  expect(once(row({ experience: '10', level: 3 }), row({ experience: '10', level: 3 }))).toEqual([])
})

test('a fight result and its loot are told once each, by fight, from the hero’s own resolution row', () => {
  const start = account()
  const won = account({ resolutions: [result({ winner: 0 })] })
  expect(once(start, won)).toEqual([{ kind: 'fight_won' }])
  expect(once(start, account({ resolutions: [result({ winner: 1 })] }))).toEqual([{ kind: 'fight_lost' }])
  // A fight that ended is not decided again when its loot is rolled; the loot is its own line.
  const drops = [{ item_type: 'aloe_vera', qty: 2 }]
  const rolled = account({ resolutions: [result({ winner: 0, settled: true, drops })] })
  expect(once(won, rolled)).toEqual([{ kind: 'loot', drops }])
  expect(once(start, rolled)).toEqual([{ kind: 'fight_won' }, { kind: 'loot', drops }])
  // An undecided fight says nothing, and another hero's result is never this hero's line.
  expect(once(start, account({ resolutions: [result()] }))).toEqual([])
  const heroes = [mira(), bran()]
  const other = follow([
    account({ characters: heroes }),
    account({ characters: heroes, resolutions: [result({ character: 'bran', winner: 0 })] }),
  ])
  expect(events(other)).toEqual([])
  expect(events(other, 'bran')).toEqual([{ kind: 'fight_won' }])
})

test('a run is told when it starts, when its blocker moves and when it ends; a wait is not a line', () => {
  const idle = account()
  const playing = account({ status: pushed({ state: 'active', runs: [run({ strategy: 'gather_craft' })] }) })
  const line = { kind: 'run', title: 'Herbalist level 30' } as const
  expect(once(idle, playing)).toEqual([{ ...line, phase: 'working' }])
  // An ordinary wait changes the run's status and its issue, and neither is a line.
  const waiting = account({
    status: pushed({
      state: 'waiting',
      runs: [run({ strategy: 'gather_craft', status: 'waiting', issue: 'travel_not_ready' })],
    }),
  })
  expect(once(playing, waiting)).toEqual([])
  const unfunded = account({
    status: pushed({
      state: 'waiting',
      runs: [run({ strategy: 'gather_craft', status: 'waiting', issue: 'funding_required' })],
    }),
  })
  expect(once(playing, unfunded)).toEqual([{ ...line, phase: 'funding' }])
  expect(once(unfunded, playing)).toEqual([{ ...line, phase: 'working' }])
  expect(once(playing, idle)).toEqual([{ ...line, phase: 'ended' }])
  // The bot lists an ended run until its next pass: a run that is no longer played has ended.
  const completed = account({ status: pushed({ runs: [run({ strategy: 'gather_craft', status: 'completed' })] }) })
  expect(once(playing, completed)).toEqual([{ ...line, phase: 'ended' }])
  // A run that ended by itself says why, when the bot names a reason this page lists.
  const ended = (reason: string) =>
    account({ status: pushed({ runs: [run({ strategy: 'gather_craft', status: 'completed', ended: reason })] }) })
  expect(once(playing, ended('objective_reached'))).toEqual([{ ...line, phase: 'ended', ending: 'objective_reached' }])
  expect(once(playing, ended('a_code_added_tomorrow'))).toEqual([{ ...line, phase: 'ended' }])
  // The bot keeps telling an ending until the hero starts again: one already there at first sight is no line.
  expect(once(idle, ended('objective_reached'))).toEqual([])
  expect(once(ended('objective_reached'), playing)).toEqual([{ ...line, phase: 'working' }])
  // Another run for the same hero ends the first and starts the second.
  const replaced = account({
    status: pushed({ state: 'active', runs: [run({ id: 'next', objective: { title: 'Raid' } })] }),
  })
  expect(once(playing, replaced)).toEqual([
    { ...line, phase: 'ended' },
    { kind: 'run', title: 'Raid', phase: 'working' },
  ])
  // A run of another hero is never this hero's line.
  const others = account({ status: pushed({ state: 'active', runs: [run({ character_id: 'bran' })] }) })
  expect(once(idle, others)).toEqual([])
})

test('a direct command is one line when it settles, with its outcome and never while it is in flight', () => {
  const idle = account()
  const told = (status: string, error?: string) => account({ status: pushed({ direct: direct(status, error) }) })
  expect(once(idle, told('accepted'))).toEqual([])
  expect(once(told('accepted'), told('executing'))).toEqual([])
  expect(once(told('executing'), told('completed'))).toEqual([{ kind: 'command', error: null }])
  expect(once(idle, told('completed'))).toEqual([{ kind: 'command', error: null }])
  expect(once(told('executing'), told('failed', 'listing_changed_or_ineligible'))).toEqual([
    { kind: 'command', error: 'listing_changed_or_ineligible' },
  ])
  // An uncertain command is still being reconciled: it has no outcome to tell yet.
  expect(once(told('executing'), told('uncertain'))).toEqual([])
  expect(once(told('uncertain'), told('completed'))).toEqual([{ kind: 'command', error: null }])
  // A command for another hero, or for the wallet, is not this hero's line.
  const wallet = { ...direct('completed'), payload: {} }
  expect(once(idle, account({ status: pushed({ direct: wallet }) }))).toEqual([])
})

test('a first read, a new hero and an unknown bot are baselines: nothing they hold becomes a line', () => {
  const full = account({
    characters: [mira({ level: 20, active_fight: { id: 'fight', seat: 0 } })],
    resolutions: [result({ winner: 0, drops: [{ item_type: 'aloe_vera', qty: 1 }] })],
    status: pushed({ state: 'active', runs: [run()], direct: direct('completed') }),
  })
  // The snapshot arrives packet by packet while the account loads, then is complete.
  expect(events(follow([account({ phase: 'loading', characters: [] }), { ...full, phase: 'loading' }, full]))).toEqual(
    []
  )
  // A hero the account receives later starts from what it is.
  expect(
    events(follow([account({ characters: [bran()] }), { ...full, characters: [bran(), ...full.characters] }]))
  ).toEqual([])
  // A bot that has not spoken, or is not ready, ends no run and starts none when it speaks again.
  const silent = { ...full, status: null }
  const unready = { ...full, status: pushed({ ready: false }) }
  expect(events(follow([full, silent, full, unready, full]))).toEqual([])
  // A new subscription reads the account again: the first complete read after it is a baseline.
  expect(events(follow([full, { ...full, phase: 'loading' }, account()]))).toEqual([])
  // Nothing moved: the fold returns the very logs it was given.
  const logs = follow([account(), account({ characters: [mira({ level: 2 })] })])
  expect(fold_hero_logs(logs, observed_heroes(full), observed_heroes(full), 9)).toBe(logs)
})

test('each line keeps the time it was observed and its own number', () => {
  const logs = follow([
    account(),
    account({ characters: [mira({ level: 2 })] }),
    account({ characters: [mira({ level: 3 })] }),
  ])
  expect(logs.mira).toEqual([
    { id: 1, at: 1_000, event: { kind: 'level', level: 2 } },
    { id: 2, at: 2_000, event: { kind: 'level', level: 3 } },
  ])
})

test(`a hero's log keeps its ${HERO_LOG_LINES} newest lines and drops the oldest first`, () => {
  const levels = Array.from({ length: HERO_LOG_LINES + 6 }, (_, level) =>
    account({ characters: [mira({ level: level + 1 })] })
  )
  const kept = follow(levels).mira!
  expect(kept).toHaveLength(HERO_LOG_LINES)
  // 205 changes were observed: levels 2 to 206. The five oldest lines are gone, the numbering goes on.
  expect(kept[0]).toEqual({ id: 6, at: 6_000, event: { kind: 'level', level: 7 } })
  expect(kept.at(-1)).toEqual({ id: 205, at: 205_000, event: { kind: 'level', level: 206 } })
})
