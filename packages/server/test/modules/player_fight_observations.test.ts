// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { EventEmitter } from 'node:events'

import { expect, spyOn, test } from 'bun:test'

import player_fight from '../../src/modules/player_fight.ts'
import type { PlayerAction, PlayerContext, PlayerState } from '../../src/player.ts'

const harness = () => {
  const events = new EventEmitter()
  const controller = new AbortController()
  const actions: PlayerAction[] = []
  const reads: ReturnType<typeof Promise.withResolvers<{ fight: { properties: object } }[]>>[] = []
  let state = {
    characters: { '0xowned': { fight: null, presence: { world: 'world', x: 0, z: 0 } } },
    spectating: {},
    fight_previews: {},
    roster_fights: {},
    nearby_fight: null,
  } as unknown as PlayerState
  player_fight.observe({
    events,
    signal: controller.signal,
    get_state: () => state,
    graph: {
      read: () => {
        const pending = Promise.withResolvers<{ fight: { properties: object } }[]>()
        reads.push(pending)
        return pending.promise
      },
    },
    public_world: {},
    pubsub: {},
    send: () => {},
    dispatch: (action: PlayerAction) => {
      actions.push(action)
    },
  } as unknown as PlayerContext)
  return {
    events,
    controller,
    actions,
    reads,
    watch: (fight: string | null, character_id = '0xowned') =>
      events.emit('packet/fight_preview', { fight, character_id }),
    characters: (present: boolean) => {
      const previous = state
      state = { ...state, characters: present ? previous.characters : {} }
      events.emit('STATE_UPDATED', state, previous)
    },
    observed: (fight: string) => {
      state = { ...state, fight_previews: { '0xowned': fight } }
    },
    restore: () => {
      state = {
        ...state,
        characters: { '0xowned': { fight: null, presence: { world: 'world', x: 0, z: 0 } } },
      } as unknown as PlayerState
    },
  }
}
const finish = (h: ReturnType<typeof harness>, index: number, id: string) => {
  h.reads[index]!.resolve([{ fight: { properties: { id, world: 'world', x: 0, z: 0 } } }])
}

test('unknown cancellation identities allocate no bookkeeping and emit no state changes', () => {
  const h = harness()
  const writes = spyOn(Map.prototype, 'set')
  try {
    for (let index = 0; index < 100; index++) h.watch(null, `0xunknown${index}`)
    expect(writes).not.toHaveBeenCalled()
    expect(h.actions).toEqual([])
    expect(h.reads).toEqual([])
  } finally {
    writes.mockRestore()
    h.controller.abort()
  }
})

test('cancel/reopen rejects old responses without retiring the replacement read', async () => {
  const h = harness()
  try {
    h.watch('0xold')
    h.watch(null)
    h.watch('0xnew')
    finish(h, 0, '0xold')
    await Bun.sleep(0)
    finish(h, 1, '0xnew')
    await Bun.sleep(0)
    expect(h.actions.filter((action) => action.type === 'action/fight_preview' && action.fight !== null)).toEqual([
      { type: 'action/fight_preview', character_id: '0xowned', fight: '0xnew' },
    ])
  } finally {
    h.controller.abort()
  }
})

test('character removal invalidates pending reads even when the same character returns', async () => {
  const h = harness()
  try {
    h.watch('0xold')
    h.characters(false)
    h.restore()
    finish(h, 0, '0xold')
    await Bun.sleep(0)
    expect(h.actions).toEqual([])
  } finally {
    h.controller.abort()
  }
})

test('connection closure rejects pending observation results', async () => {
  const h = harness()
  h.watch('0xold')
  h.controller.abort()
  finish(h, 0, '0xold')
  await Bun.sleep(0)
  expect(h.actions).toEqual([])
})

test('an existing observation can still be cancelled after its character leaves the roster', () => {
  const h = harness()
  try {
    h.observed('0xwatched')
    h.characters(false)
    h.watch(null)
    expect(h.actions).toEqual([{ type: 'action/fight_preview', character_id: '0xowned', fight: null }])
  } finally {
    h.controller.abort()
  }
})
