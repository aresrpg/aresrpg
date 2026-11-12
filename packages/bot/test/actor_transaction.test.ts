// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { bcs } from '@mysten/sui/bcs'
import { Inputs } from '@mysten/sui/transactions'

import { create_actor_runtime } from '../src/actor_runtime.ts'
import { create_control_service, lane_key_for, type Command, type Lane } from '../src/control.ts'
import { fake_client, pins, digest } from '../../sdk/test/helpers/transport.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'
import { character } from './helpers/profession_fixture.ts'

test('one live actor completes consecutive journaled commands without rereading a certified predecessor', async () => {
  const f = await runtime_fixture()
  const chain = fake_client({ simulate_ok: true, visibility_failures: 10 })
  const execute = chain.core.executeTransaction
  chain.core.executeTransaction = async (input) => {
    const receipt = await execute(input)
    return {
      ...receipt,
      Transaction: {
        ...receipt.Transaction!,
        effects: {
          ...receipt.Transaction!.effects!,
          gasUsed: { computationCost: '20', storageCost: '5', storageRebate: '2' },
        },
      },
    }
  }
  const cap = bcs.struct('SyntheticPersonalKioskCap', {
    id: bcs.Address,
    cap: bcs.option(bcs.struct('SyntheticKioskOwnerCap', { id: bcs.Address, for: bcs.Address })),
  })
  Object.assign(chain.core, {
    listOwnedObjects: async ({ type }: { type: string }) => ({
      objects: type.includes('PersonalKioskCap')
        ? [
            {
              objectId: character.kiosk_cap!,
              version: '1',
              digest,
              type,
              content: cap
                .serialize({ id: character.kiosk_cap!, cap: { id: character.kiosk_cap!, for: character.kiosk! } })
                .toBytes(),
            },
          ]
        : [],
      hasNextPage: false,
      cursor: null,
    }),
  })
  const resolve = chain.core.resolveTransactionPlugin()
  chain.core.resolveTransactionPlugin = () => async (data, options, next) => {
    data.inputs.forEach((input, index) => {
      if (input.UnresolvedObject)
        data.inputs[index] = Inputs.ObjectRef({ objectId: input.UnresolvedObject.objectId, version: '1', digest })
    })
    data.gasData.payment = [{ objectId: character.kiosk_cap!, version: String(chain.calls.executions + 1), digest }]
    await resolve(data, options, next)
  }
  const runtime = create_actor_runtime({ ...f.options, sdk_options: { client: chain, pins } })
  const control = create_control_service(f.store, f.options.config, 60000, () => f.clock.now)
  const key = lane_key_for(f.bot)
  const row = { ...character, classe: 'ikari', available_points: 10 }
  try {
    await runtime.observe(f.grant, {})
    await f.admit()
    await f.send({ type: 'packet/characters', characters: [row] })
    await runtime.settle()
    for (const step of [1, 2]) {
      const lane = (await f.store.read<Lane>(key))!
      const command = await control.accept(f.grant, {
        idempotency_key: `stats-${step}`,
        kind: 'raise_stats',
        payload: { character_id: character.id, spending: { vitality: 5 } },
        decision_revision: lane.decision_revision,
        observation_revision: lane.observation_revision,
      })
      await Promise.all([runtime.wake(`command:${command.id}`), runtime.wake(`command:${command.id}`), runtime.tick()])
      await runtime.settle()
      expect(await f.store.read<Command>(`command:${command.id}`)).toMatchObject({ status: 'completed' })
      expect((await f.store.read<Lane>(key))?.pending).toBeNull()
      await f.send({
        type: 'packet/characters',
        characters: [{ ...row, vitality: step * 10, available_points: 10 - step * 5 }],
      })
      await runtime.settle()
    }
    expect(chain.calls.executions).toBe(2)
    expect(chain.calls.simulations).toBeGreaterThanOrEqual(2)
    expect(chain.calls.visibility_waits).toEqual([])
    expect(f.sockets).toHaveLength(1)
    expect(f.sockets[0]!.closed).toBe(false)
    expect(f.errors).toEqual([])
  } finally {
    await runtime.stop()
    await f.runtime.stop()
  }
})
