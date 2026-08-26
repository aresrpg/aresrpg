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
    await Promise.resolve()
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
