// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_control_service, lane_key_for, type Command, type Lane } from '../src/control.ts'
import { create_redis_store } from '../src/store.ts'

import { runtime_fixture } from './helpers/runtime_fixture.ts'

/** Loopback stand-in for the four Redis commands the store issues; volatile records never reach it. */
const stand_in_redis = () => {
  const records = new Map<string, string>()
  const commit = (keys: readonly string[], argv: readonly string[]) => {
    const count = Number(argv[0])
    for (let index = 1; index <= count; index += 1) if ((records.get(keys[index + 1]!) ?? '') !== argv[index]) return 0
    for (let index = 1 + count; index < argv.length; index += 4)
      records.set(keys[Number(argv[index]) + 1]!, argv[index + 1]!)
    return 1
  }
  const send = async (command: string, args: readonly string[]) => {
    if (command === 'GET') return records.get(args[0]!) ?? null
    if (command === 'MGET') return args.map((key) => records.get(key) ?? null)
    if (command === 'SCAN') return ['0', [...records.keys()]]
    if (command !== 'EVAL') throw new Error(`unexpected ${command}`)
    const [script, count, ...rest] = args
    if (script!.includes('ZRANGEBYLEX')) return []
    if (!script!.includes("redis.call('MSET'")) return 1
    return commit(rest.slice(0, Number(count)), rest.slice(Number(count)))
  }
  return { send } as never
}

test('a lane releases settled commands, with the receipts they carry, once nothing it holds names them', async () => {
  const store = create_redis_store(stand_in_redis())
  const f = await runtime_fixture(store)
  const control = create_control_service(store, f.options.config, 60000, () => f.clock.now)
  const key = lane_key_for(f.bot)
  const { fence } = await control.acquire(f.bot, 'test', 10000)
  const admit = async (step: number) => {
    await control.observed(key, 'test', fence, true)
    const lane = (await store.read<Lane>(key))!
    return control.accept(f.grant, {
      idempotency_key: `step-${step}`,
      kind: 'raise_stats',
      payload: { character_id: `0x${'2'.repeat(64)}`, spending: { vitality: 1 } },
      decision_revision: lane.decision_revision,
      observation_revision: lane.observation_revision,
    })
  }
  // Settlement as the transaction lifecycle commits it, optionally naming a market proof.
  const settle = (command: Command, digest: string, kiosk?: string) =>
    store.transaction([key, `command:${command.id}`], async (tx) => {
      const lane = (await tx.get<Lane>(key))!
      await tx.put(`command:${command.id}`, {
        ...command,
        status: 'completed',
        result: { digest },
        receipt: { Transaction: { digest } },
      })
      const proof = kiosk ? { [kiosk]: { digest, version: digest, command_id: command.id } } : {}
      await tx.put(key, {
        ...lane,
        active_command: null,
        catalogue_receipts: { ...lane.catalogue_receipts, ...proof },
      })
    })
  try {
    const first = await admit(1)
    await settle(first, 'first-digest')
    // The settled command stays readable until the lane admits its next one.
    expect(await control.status(f.grant, first.id)).toMatchObject({ status: 'completed' })
    const second = await admit(2)
    expect(await store.read(`command:${first.id}`)).toBeNull()
    await expect(control.status(f.grant, first.id)).rejects.toThrow('command_not_found')
    expect(await store.scan_pending(10)).toEqual([`command:${second.id}`])

    // A market proof keeps its command and receipt named until a newer proof replaces it.
    await settle(second, 'second-digest', 'kiosk')
    const third = await admit(3)
    expect(await store.read(`command:${second.id}`)).toMatchObject({ status: 'completed' })
    await settle(third, 'third-digest', 'kiosk')
    expect(await store.read(`command:${second.id}`)).toBeNull()
    expect(await store.scan_keys('command:', 10)).toEqual([`command:${third.id}`])
  } finally {
    await f.runtime.stop()
  }
})
