// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import type { FightPresentationCue } from '@aresrpg/engine'

import { create_fight_presenter } from '../../../src/game/fight/fight_presenter.ts'

const turn = (id: string): FightPresentationCue => ({
  id,
  type: 'turn',
  entity_id: 'fight_character_0',
  turn_key: `fight:turn:${id}:0`,
})

describe('fight presenter', () => {
  test('plays batches through one strict queue and observes their real completion order', async () => {
    const log: string[] = []
    const pending: Array<() => void> = []
    const presenter = create_fight_presenter({
      play: (cue) =>
        new Promise<boolean>((resolve) => {
          log.push(`play:${cue.id}`)
          pending.push(() => resolve(true))
        }),
      observe: (cue, phase) => log.push(`${phase}:${cue.id}`),
    })

    const batch = presenter.present([turn('a'), turn('b')])
    expect(batch).toBeInstanceOf(Promise)
    await Bun.sleep(0)
    expect(log).toEqual(['start:a', 'play:a'])
    pending.shift()?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(log).toEqual(['start:a', 'play:a', 'complete:a', 'start:b', 'play:b'])
    pending.shift()?.()
    await batch
    expect(log.at(-1)).toBe('complete:b')
  })

  test('gives a mob one second of anticipation and two seconds of action time before the next card', async () => {
    const log: string[] = []
    let now = 1_000
    const presenter = create_fight_presenter({
      now: () => now,
      wait: async (milliseconds) => {
        log.push(`wait:${milliseconds}`)
        now += milliseconds
      },
      play: async (cue) => {
        log.push(`play:${cue.id}`)
        return true
      },
      observe: (cue, phase) => log.push(`${phase}:${cue.id}`),
    })
    const mob = { ...turn('mob'), entity_id: 'fight_mob_1', min_ms: 3_000 } as const
    const movement = {
      id: 'move',
      type: 'movement',
      entity_id: 'fight_mob_1',
      cells: [2],
      mode: 'walk',
      source_id: 'fight_mob_1',
      mp_spent: 1,
      gait: 'walk',
    } as const

    await presenter.present([mob, movement, turn('player')])

    expect(log).toEqual([
      'start:mob',
      'play:mob',
      'complete:mob',
      'wait:1000',
      'start:move',
      'play:move',
      'complete:move',
      'wait:2000',
      'start:player',
      'play:player',
      'complete:player',
    ])
  })
})

test('cast, forced displacement and damage retain their completion barriers', async () => {
  const log: string[] = []
  const pending: Array<() => void> = []
  const presenter = create_fight_presenter({
    wait: async () => {},
    play: (cue) =>
      new Promise<boolean>((resolve) => {
        log.push(`play:${cue.type}`)
        pending.push(() => resolve(true))
      }),
    observe: (cue, phase) => log.push(`${phase}:${cue.type}`),
  })
  const cast = {
    id: 'cast',
    type: 'cast',
    caster_id: 'aragne',
    spell: 'Undertow Fang',
    cast_level: 0,
    target_cell: 1,
    element: 'water',
    style: 'pull',
    critical: false,
    amount: 30,
    target_max_hp: 100,
    affected_cells: [1],
    killed: false,
  } as const
  const pull = {
    id: 'pull',
    type: 'movement',
    entity_id: 'hero',
    source_id: 'aragne',
    cells: [2, 3],
    mode: 'pull',
    gait: 'slide',
    mp_spent: 0,
  } as const
  const damage = {
    id: 'damage',
    type: 'damage',
    source_id: 'aragne',
    target_id: 'hero',
    amount: 30,
    hp_before: 100,
    hp_after: 70,
    element: 'water',
    cause: 'spell',
    critical: false,
  } as const
  const batch = presenter.present([cast, pull, damage])
  await Bun.sleep(0)
  expect(log).toEqual(['start:cast', 'play:cast'])
  pending.shift()!()
  await Bun.sleep(0)
  expect(log).toEqual(['start:cast', 'play:cast', 'complete:cast', 'start:movement', 'play:movement'])
  pending.shift()!()
  await Bun.sleep(0)
  expect(log.at(-1)).toBe('play:damage')
  expect(log).not.toContain('complete:damage')
  pending.shift()!()
  await batch
  expect(log.at(-1)).toBe('complete:damage')
  presenter.dispose()
})

test('terminal presentation does not release its batch before the death animation finishes', async () => {
  let finish = (_shown: boolean) => {},
    released = false
  const presenter = create_fight_presenter({
    play: () =>
      new Promise<boolean>((resolve) => {
        finish = resolve
      }),
  })
  const batch = presenter
    .present([
      { id: 'death', type: 'death', entity_id: 'fight_mob_1', source_id: 'fight_character_0', cell: 2, cause: 'spell' },
    ])
    .then(() => {
      released = true
    })
  await Bun.sleep(0)
  expect(released).toBeFalse()
  finish(true)
  await batch
  expect(released).toBeTrue()
  presenter.dispose()
})
