// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_actor_runtime } from '../src/actor_runtime.ts'
import { create_control_service, lane_key_for, type Lane } from '../src/control.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { character } from './helpers/profession_fixture.ts'

for (const interruption of ['pause', 'revocation', 'lease_loss', 'freeze', 'disconnect', 'stop', 'work']) {
  test(`idle keeps player presence without commands and yields to ${interruption}`, async () => {
    const f = await runtime_fixture()
    const first_position = Promise.withResolvers<void>()
    const runtime = create_actor_runtime({
      ...f.options,
      transport: {
        open: (url, handlers) => {
          const socket = f.options.transport.open(url, handlers)
          return {
            ...socket,
            send: (raw) => {
              socket.send(raw)
              if (JSON.parse(raw).type === 'packet/position') first_position.resolve()
            },
          }
        },
      },
    })
    const key = lane_key_for(f.bot)
    const positions = () =>
      f.sockets.flatMap((socket) => socket.sent).filter((raw) => JSON.parse(raw).type === 'packet/position')
    try {
      await runtime.observe(f.grant, {})
      await f.admit()
      await f.send({
        type: 'packet/characters',
        characters: [{ ...character, x: 1000, z: 1000, world: 'nauvis', checkpoint_world: 'nauvis' }],
      })
      await runtime.settle()
      await runtime.tick()
      await first_position.promise
      expect(await f.store.scan_keys('command:', 100)).toEqual([])
      expect(f.sockets[0]!.closed).toBe(false)
      switch (interruption) {
        case 'pause':
          await create_control_service(f.store, f.options.config, 60000, () => f.clock.now).pause(f.grant)
          break
        case 'revocation':
          await f.store.transaction(['grant:grant'], async (tx) => {
            await tx.put('grant:grant', { ...f.grant, revoked: true })
          })
          break
        case 'lease_loss':
          await f.store.transaction([key], async (tx) => {
            const lane = (await tx.get<Lane>(key))!
            await tx.put(key, { ...lane, fence: lane.fence + 1 })
          })
          break
        case 'freeze':
          await f.send({ type: 'packet/game_state', frozen: true })
          break
        case 'disconnect':
          f.sockets[0]!.handlers.on_close(1006, 'network_lost')
          break
        case 'stop':
          await runtime.stop()
          break
        case 'work':
          await f.store.transaction([key], async (tx) => {
            const lane = (await tx.get<Lane>(key))!
            await tx.put(key, { ...lane, active_command: 'new-command' })
          })
          break
      }
      await runtime.settle()
      const count = positions().length
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(positions()).toHaveLength(count)
    } finally {
      await runtime.stop()
    }
  })
}

test('an observation-only connector retains presence without authorizing idle movement', async () => {
  const f = await runtime_fixture()
  try {
    await f.store.transaction(['grant:grant'], async (tx) => {
      await tx.put('grant:grant', { ...f.grant, scopes: ['bot:observe'] })
    })
    await f.observe()
    await f.admit()
    await f.send({
      type: 'packet/characters',
      characters: [{ ...character, world: 'nauvis', checkpoint_world: 'nauvis' }],
    })
    await f.runtime.settle()
    await f.runtime.tick()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(f.sockets[0]!.sent.some((raw) => JSON.parse(raw).type === 'packet/position')).toBe(false)
    expect(f.sockets[0]!.closed).toBe(false)
    expect(f.errors).toEqual([])
  } finally {
    await f.runtime.stop()
  }
})
