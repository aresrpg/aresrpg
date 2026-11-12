// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_redis_store } from '../src/store.ts'
import { create_control_service, type Lane } from '../src/control.ts'
import type { CombatProfileRecord } from '../src/combat_control.ts'

import { stored_combat } from './helpers/legacy_run_fixture.ts'
import { fixture_redis } from './helpers/redis_fixture.ts'
import { combat_fixture, character_id, fight_id, profile } from './helpers/combat_runtime_fixture.ts'

const url = process.env.TEST_BOT_REDIS_URL
const integration = url ? test : test.skip

integration(
  'Redis preserves saved tactics, pinned fight authority and pending membership across reconnects',
  async () => {
    const f = await combat_fixture()
    const first = fixture_redis(url!)
    const replacement = fixture_redis(url!)
    const namespace = `bot:combat-fixture:${crypto.randomUUID()}`
    await first.connect()
    const original = create_redis_store(first, namespace)
    const restored = create_redis_store(replacement, namespace)
    const observe = async () => ({ ...f.context.snapshot, sampled_at: f.now, decision_revision: 0 })
    const make_control = (store: typeof original) =>
      create_control_service(store, f.config, f.config.observation_freshness_ms, () => f.now, observe)
    const control = make_control(original)
    try {
      await original.transaction([`bot:${f.bot.id}`, `grant:${f.grant.id}`], async (tx) => {
        await tx.put(`bot:${f.bot.id}`, f.bot)
        await tx.put(`grant:${f.grant.id}`, f.grant)
      })
      const lease = await control.acquire(f.bot, 'actor', 10_000)
      await control.observed(f.key, 'actor', lease.fence, true)
      const saved = await control.save_combat_profile(f.grant, { character_id, expected_revision: 0, profile })
      const run = await stored_combat(
        original,
        f.grant,
        fight_id,
        [{ character_id, revision: saved.revision, profile: saved.profile }],
        f.now
      )
      expect(await original.scan_pending(10)).toEqual([`combat:${run.id}`])
      first.close()
      await replacement.connect()
      const restarted = make_control(restored)
      expect(await restarted.combat_profile(f.grant, character_id)).toEqual(saved)
      expect(await restarted.combat_status(f.grant, run.id)).toEqual(run)
      expect((await restored.read<Lane>(f.key))?.combat_run_id).toBe(run.id)
      expect(await restored.scan_pending(10)).toEqual([`combat:${run.id}`])
      const concurrent = make_control(create_redis_store(replacement, namespace))
      const revise = {
        character_id,
        expected_revision: 1,
        profile: { ...profile, intent: 'Retain this revised instruction for later fights.' },
      }
      const writes = await Promise.allSettled([
        restarted.save_combat_profile(f.grant, revise),
        concurrent.save_combat_profile(f.grant, revise),
      ])
      expect(writes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
      expect(writes.filter(({ status }) => status === 'rejected')).toHaveLength(1)
      const current = await restarted.combat_profile(f.grant, character_id)
      expect(current?.revision).toBe(2)
      expect((await restarted.combat_status(f.grant, run.id)).profiles).toEqual(run.profiles)
      const physical_profile = `${namespace}:record:combat_profile:${f.bot.id}:${character_id}`
      expect(await replacement.send('PTTL', [physical_profile])).toBe(-1)
      await restarted.stop_combat(f.grant, run.id)
      expect(await restored.scan_pending(10)).toEqual([])
      expect((await restarted.combat_status(f.grant, run.id)).status).toBe('stopped')
      expect((await restored.read<CombatProfileRecord>(`combat_profile:${f.bot.id}:${character_id}`))?.revision).toBe(2)
    } finally {
      const cleanup = replacement.connected ? replacement : first
      const store = cleanup === replacement ? restored : original
      const keys = await store.scan_keys('', 100)
      await cleanup.send('DEL', [namespace, `${namespace}:pending`, ...keys.map((key) => `${namespace}:record:${key}`)])
      first.close()
      replacement.close()
    }
  }
)
