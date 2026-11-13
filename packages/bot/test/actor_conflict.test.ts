// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_control_service, type Command, type Lane } from '../src/control.ts'
import { create_redis_store, type ControlStore } from '../src/store.ts'
import { captured, conflict_digest } from '../../sdk/test/helpers/transaction_conflict.ts'

import { signed_fixture } from './helpers/signed_runtime_fixture.ts'
import { memory_store, put } from './helpers/control_fixture.ts'
import { fixture_redis } from './helpers/redis_fixture.ts'

const url = process.env.TEST_BOT_REDIS_URL
for (const backend of ['memory', 'redis'] as const)
  for (const lose_ack of [false, true]) {
    test.skipIf(backend === 'redis' && !url)(
      `conflict recovery permits only a fresh explicit intent after reconciliation (${backend}, lost acknowledgment: ${lose_ack})`,
      async () => {
        const redis = backend === 'redis' ? fixture_redis(url!) : null
        if (redis) await redis.connect()
        const namespace = `bot:conflict-fixture:${crypto.randomUUID()}`
        const base = redis ? create_redis_store(redis, namespace) : memory_store()
        let lost = false
        const store: ControlStore = {
          ...base,
          transaction: async (keys, operation) => {
            const result = await base.transaction(keys, operation)
            const command = await base.read<Command>('command:signed')
            if ([lose_ack, !lost, command?.error === 'transaction_input_consumed'].every(Boolean)) {
              lost = true
              throw new Error('reply lost after durable conflict commit')
            }
            return result
          },
        }
        const f = await signed_fixture(store)
        const proof = structuredClone(captured)
        Object.assign(proof.Transaction.effects.changedObjects[0]!, {
          objectId: `0x${'1'.repeat(64)}`,
          inputVersion: '1',
          inputDigest: '11111111111111111111111111111111',
          inputOwner: { AddressOwner: f.bot.address },
          outputVersion: '2',
        })
        const read_objects = f.client.core.getObjects
        Object.assign(f.client.core, {
          waitForTransaction: async () => {
            throw new Error('original receipt unavailable')
          },
          getObjects: async (input: Parameters<typeof read_objects>[0]) => {
            const result = await read_objects(input)
            return { objects: result.objects.map((row) => ({ ...row, previousTransaction: conflict_digest })) }
          },
          getTransaction: async () => proof,
        })
        const lane = (await store.read<Lane>(f.lane_key))!
        await put(store, f.lane_key, { ...lane, pending: { ...lane.pending!, phase: 'submitting' } })
        try {
          await f.runtime.tick()
          await f.runtime.settle()
          expect((await store.read<Command>('command:signed'))?.status).toBe('failed')
          expect((await store.read<Lane>(f.lane_key))?.pending).toBeNull()
          expect(f.submissions).toHaveLength(0)
          expect(lost).toBe(lose_ack)
          await f.runtime.observe(f.grant, {})
          await f.admit()
          await f.runtime.settle()
          const fresh = (await store.read<Lane>(f.lane_key))!
          const control = create_control_service(store, f.options.config, 60000, () => f.clock.now)
          const command = await control.accept(f.grant, {
            idempotency_key: 'explicit-new-intent',
            kind: 'fight_turn',
            payload: f.command.payload,
            decision_revision: fresh.decision_revision,
            observation_revision: fresh.observation_revision,
          })
          await f.runtime.tick()
          await f.runtime.settle()
          expect(await store.read<Command>(`command:${command.id}`)).toMatchObject({ status: 'completed' })
          expect(f.submissions).toHaveLength(1)
          expect(f.submissions[0]).not.toEqual(f.bytes)
        } finally {
          await f.runtime.stop()
          if (redis) {
            const keys = await base.scan_keys('', 100)
            await redis.send('DEL', [
              namespace,
              `${namespace}:pending`,
              ...keys.map((key) => `${namespace}:record:${key}`),
            ])
            redis.close()
          }
        }
      }
    )
  }
