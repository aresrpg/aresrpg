// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { ClientPacket } from '@aresrpg/protocol'

import { create_actor_runtime } from '../src/actor_runtime.ts'
import { create_control_service, lane_key_for, type Command, type Lane } from '../src/control.ts'
import { fake_client, pins } from '../../sdk/test/helpers/transport.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { character } from './helpers/profession_fixture.ts'

for (const interruption of ['pause', 'revocation', 'lease_loss', 'freeze', 'stop']) {
  test(`runtime publishes feet before SDK execution and ${interruption} prevents submission`, async () => {
    const f = await runtime_fixture()
    const chain = fake_client({ simulate_ok: true })
    const first_position = Promise.withResolvers<ClientPacket>()
    const runtime = create_actor_runtime({
      ...f.options,
      report_failure: (error) => {
        f.options.report_failure(error)
        first_position.reject(error)
      },
      sdk_options: { client: chain, pins },
      transport: {
        open: (url, handlers) => {
          const socket = f.options.transport.open(url, handlers)
          return {
            ...socket,
            send: (raw) => {
              socket.send(raw)
              const packet = JSON.parse(raw) as ClientPacket
              if (packet.type === 'packet/position') first_position.resolve(packet)
            },
          }
        },
      },
    })
    const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
    const key = lane_key_for(f.bot)
    try {
      await runtime.observe(f.grant, {})
      await f.admit()
      await f.send({
        type: 'packet/characters',
        characters: [{ ...character, x: 1000, z: 1000, world: 'nauvis', checkpoint_world: 'nauvis' }],
      })
      await f.send({
        type: 'packet/tracked_zones',
        character_id: character.id,
        world: 'nauvis',
        zones: [{ zx: 1, zz: 1 }],
      })
      await f.send({
        type: 'packet/server_info',
        online: 1,
        online_characters: 1,
        indexing_lag: 0,
        current_epoch: '1',
        chain_timestamp_ms: 100000,
        chain_sample_age_ms: 0,
      })
      await runtime.settle()
      const lane = (await f.store.read<Lane>(key))!
      const command = await control.accept(f.grant, {
        idempotency_key: 'walk',
        kind: 'world_search',
        payload: { character_id: character.id, world: 'nauvis', x: 1010, z: 1000 },
        decision_revision: lane.decision_revision,
        observation_revision: lane.observation_revision,
      })
      await runtime.wake(`command:${command.id}`)
      const packet = await first_position.promise
      expect(packet).toMatchObject({ type: 'packet/position', character_id: character.id, x: 1000, z: 1000 })
      expect(chain.calls.executions).toBe(0)
      switch (interruption) {
        case 'pause':
          await control.pause(f.grant)
          break
        case 'revocation':
          await f.store.transaction(['grant:grant'], async (tx) => {
            await tx.put('grant:grant', { ...f.grant, revoked: true })
          })
          break
        case 'lease_loss':
          await f.store.transaction([key], async (tx) => {
            const current = (await tx.get<Lane>(key))!
            await tx.put(key, { ...current, actor_id: 'replacement', fence: current.fence + 1 })
          })
          break
        case 'freeze':
          await f.send({ type: 'packet/game_state', frozen: true })
          break
        case 'stop':
          await runtime.stop()
          break
      }
      await runtime.settle()
      expect(chain.calls.executions).toBe(0)
      expect((await f.store.read<Lane>(key))?.pending).toBeNull()
      if (interruption === 'freeze')
        expect(await f.store.read<Command>(`command:${command.id}`)).toMatchObject({
          status: 'accepted',
          waiting_for_resume: true,
        })
    } finally {
      await runtime.stop()
    }
  })
}
