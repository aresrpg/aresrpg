// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { lane_key_for } from '../src/control.ts'

import { process_pair, start_process, until } from './helpers/router_process_fixture.ts'
import { put } from './helpers/control_fixture.ts'
import { plan } from './helpers/profession_fixture.ts'
import { fixture_redis } from './helpers/redis_fixture.ts'

const url = process.env.TEST_BOT_REDIS_URL
const integration = url ? test : test.skip

type Status = {
  pid: number
  subscriber_id: number
  ready: boolean
  sockets: number
  closed: boolean
  health: number
  read_entered: boolean
  local_reads: number
  stop_entered: boolean
  runtime_drained: boolean
}
integration(
  'two OS processes route observations and validate_plan to sticky Redis ownership, then fence crash failover',
  async () => {
    const f = await process_pair(url!)
    try {
      expect(new Set([process.pid, f.first.pid, f.second.pid]).size).toBe(3)
      expect(await f.lane()).toBeNull()
      // Both contenders may race acquisition. The losing read rereads the winner and routes there.
      await Promise.all([f.first.call('observe'), f.second.call('observe')])
      const initial = (await f.lane())!
      const first_status = await f.first.call<Status>('status')
      const owner = first_status.sockets ? f.first : f.second
      const peer = owner === f.first ? f.second : f.first
      await owner.call('admit')
      expect(await peer.call('observe')).toMatchObject({ ready: true, event_fence: initial.fence })
      expect(await peer.call('validate', { plan })).toEqual(await owner.call('validate', { plan }))
      expect((await peer.call<Status>('status')).sockets).toBe(0)
      await peer.call('tick')
      expect((await f.lane())?.actor_id).toBe(initial.actor_id)
      const lease = (await f.lane())!
      await owner.call('pause_work')
      await put(f.store, 'command:foreign-pending', {
        id: 'foreign-pending',
        bot_id: f.bot.id,
        grant_id: f.grant.id,
        lane_key: lane_key_for(f.bot),
        kind: 'equip_tool',
        payload: {},
        fingerprint: 'fixture',
        status: 'accepted',
        decision_revision: lease.decision_revision,
        observation_revision: lease.observation_revision,
      })
      await peer.call('tick')
      expect(await f.store.read('command:foreign-pending')).toMatchObject({ status: 'accepted' })
      expect((await peer.call<Status>('status')).sockets).toBe(0)
      await owner.kill()
      await Bun.sleep(Math.max(0, lease.lease_until - Date.now()) + 30)
      expect(await peer.call('observe')).toEqual({ status: 'pending' })
      await peer.call('admit')
      expect((await f.lane())!.fence).toBeGreaterThan(initial.fence)
      expect(await peer.call('observe')).toMatchObject({ ready: true })
    } finally {
      await f.close()
    }
  },
  15000
)

integration(
  'two OS processes reject replies after grant revocation and preserve validation errors',
  async () => {
    const f = await process_pair(url!)
    try {
      await f.first.call('observe')
      await f.first.call('admit')
      await f.first.call('mode', { read: 'error' })
      await expect(f.second.call('observe')).rejects.toThrow('invalid_gameplay_payload')
      await f.first.call('mode', { read: 'hold' })
      const pending = f.second.call('observe').then(
        () => 'unexpected',
        (error: Error) => error.message
      )
      await until(async () => (await f.first.call<Status>('status')).read_entered)
      await put(f.store, 'grant:grant', { ...f.grant, revoked: true })
      // Force the legitimate revoked-heartbeat interleaving before releasing the read.
      await f.first.call('tick')
      expect((await f.first.call<Status>('status')).closed).toBe(true)
      await f.first.call('release')
      expect(await pending).toBe('invalid_token')
    } finally {
      await f.close()
    }
  },
  15000
)

integration(
  'two OS processes reject replies after changed-owner fencing',
  async () => {
    // Revocation can stop the previous actor; fencing needs an independently admitted session.
    const f = await process_pair(url!)
    try {
      await f.first.call('observe')
      await f.first.call('admit')
      await f.first.call('mode', { read: 'hold_result' })
      const fenced = f.second.call('observe')
      await until(async () => (await f.first.call<Status>('status')).read_entered)
      const lane = (await f.lane())!
      await put(f.store, lane_key_for(f.bot), { ...lane, fence: lane.fence + 1, actor_id: 'fixture:replacement' })
      await f.first.call('release')
      expect(await fenced).toEqual({ status: 'pending' })
      await expect(f.first.call('observe')).rejects.toThrow('observation_unavailable')
      expect((await f.first.call<Status>('status')).sockets).toBe(1)
    } finally {
      await f.close()
    }
  },
  15000
)

integration(
  'two OS processes bound stalled/failed publish and remote timeout, drain replies on shutdown, and fail readiness on subscriber loss',
  async () => {
    const f = await process_pair(url!)
    try {
      await f.first.call('observe')
      await f.first.call('admit')
      await f.second.call('mode', { publish: 'reject' })
      await expect(f.second.call('observe')).rejects.toThrow('fixture_publish_failure')
      await f.second.call('mode', { publish: 'stall' })
      const start = Date.now()
      await expect(f.second.call('observe')).rejects.toThrow('observation_timeout')
      expect(Date.now() - start).toBeLessThan(1000)
      await f.second.call('mode')
      await f.first.call('mode', { read: 'hold' })
      await expect(f.second.call('observe')).rejects.toThrow('observation_timeout')
      const pending = f.second.call('observe').then(
        () => 'unexpected',
        (error: Error) => error.message
      )
      await Bun.sleep(20)
      await f.second.call('stop')
      expect(await pending).toBe('observation_unavailable')
      expect((await f.second.call<Status>('status')).health).toBe(503)
      const status = await f.first.call<Status>('status')
      expect(await f.redis.send('CLIENT', ['KILL', 'ID', String(status.subscriber_id)])).toBe(1)
      await until(async () => (await f.first.call<Status>('status')).runtime_drained)
      expect(await f.first.call('status')).toMatchObject({ ready: false, closed: true, health: 503 })
      await expect(f.first.call('observe')).rejects.toThrow('observation_unavailable')
      await f.first.call('release')
    } finally {
      await f.close()
    }
  },
  15000
)

integration(
  'two OS processes retain terminal human takeover across owner shutdown and lease expiry',
  async () => {
    const f = await process_pair(url!)
    try {
      await f.first.call('observe')
      await f.first.call('admit')
      await f.first.call('mode', { read: 'hold_result' })
      const in_flight = f.second.call('observe').then(
        () => 'unexpected_snapshot',
        (error: Error) => error.message
      )
      await until(async () => (await f.first.call<Status>('status')).read_entered)
      await f.first.call('takeover')
      await f.first.call('release')
      expect(await in_flight).toBe('ACTOR_TERMINAL')
      await f.first.call('mode')
      await expect(f.second.call('observe')).rejects.toThrow('ACTOR_TERMINAL')
      const terminal = (await f.lane())!
      expect(terminal).toMatchObject({ paused: true, transport_stopped: true, needs_resync: true })
      await f.first.call('stop')
      await Bun.sleep(Math.max(0, terminal.lease_until - Date.now()) + 30)
      await expect(f.second.call('observe')).rejects.toThrow('ACTOR_TERMINAL')
      expect((await f.second.call<Status>('status')).sockets).toBe(0)
      expect((await f.lane())?.transport_stopped).toBe(true)
    } finally {
      await f.close()
    }
  },
  15000
)

integration(
  'same actor with a newer fence rejects an already computed response in two processes',
  async () => {
    const f = await process_pair(url!)
    try {
      await f.first.call('observe')
      await f.first.call('admit')
      await f.first.call('mode', { read: 'hold_result' })
      const pending = f.second.call('observe')
      await until(async () => (await f.first.call<Status>('status')).read_entered)
      const lane = (await f.lane())!
      await put(f.store, lane_key_for(f.bot), { ...lane, fence: lane.fence + 1 })
      expect((await f.lane())!.actor_id).toBe(lane.actor_id)
      await f.first.call('release')
      expect(await pending).toEqual({ status: 'pending' })
    } finally {
      await f.close()
    }
  },
  15000
)

integration(
  'real Redis receiver rejects a stale fence before invoking its local runtime',
  async () => {
    const f = await process_pair(url!)
    const subscriber = fixture_redis(url!)
    try {
      await f.first.call('observe')
      await f.first.call('admit')
      const lane = (await f.lane())!
      const before = await f.first.call<Status>('status')
      const sender = `fixture:stale:${crypto.randomUUID()}`
      const replies: unknown[] = []
      await subscriber.connect()
      await subscriber.subscribe(`bot:observations:${sender}`, (raw) => {
        replies.push(JSON.parse(raw))
      })
      await f.redis.publish(
        `bot:observations:${lane.actor_id}`,
        JSON.stringify({
          type: 'request',
          id: 'stale',
          sender,
          actor_id: lane.actor_id,
          grant_id: f.grant.id,
          fence: lane.fence - 1,
          deadline: Date.now() + 600,
          payload: {},
        })
      )
      await until(async () => replies.length === 1)
      expect(replies[0]).toMatchObject({
        type: 'reply',
        fence: lane.fence - 1,
        outcome: { ok: true, value: { status: 'pending' } },
      })
      expect((await f.first.call<Status>('status')).local_reads).toBe(before.local_reads)
    } finally {
      subscriber.close()
      await f.close()
    }
  },
  15000
)

for (const fault of ['none', 'unsubscribe', 'subscriber_loss']) {
  integration(
    `SIGTERM naturally exits after pending reply and runtime drains: ${fault}`,
    async () => {
      const f = await process_pair(url!)
      try {
        await f.first.call('observe')
        await f.first.call('admit')
        await f.first.call('mode', { read: 'hold_result' })
        await f.second.call('shutdown_fault', { unsubscribe: fault === 'unsubscribe', hold: true })
        const pending = f.second.call('observe').then(
          () => 'unexpected_snapshot',
          (error: Error) => error.message
        )
        await until(async () => (await f.first.call<Status>('status')).read_entered)
        if (fault === 'subscriber_loss') {
          const status = await f.second.call<Status>('status')
          expect(await f.redis.send('CLIENT', ['KILL', 'ID', String(status.subscriber_id)])).toBe(1)
          await until(async () => !(await f.second.call<Status>('status')).ready)
        }
        f.second.signal()
        expect(await pending).toBe('observation_unavailable')
        await until(async () => (await f.second.call<Status>('status')).stop_entered)
        expect(f.second.exit_code()).toBeNull()
        expect((await f.second.call<Status>('status')).runtime_drained).toBe(false)
        await f.second.call('release')
        await until(async () => f.second.exit_code() !== null)
        expect(await f.second.exited).toBe(0)
        const outcome = (await f.second.shutdown) as { failures: string[] }
        expect(outcome).toMatchObject({
          runtime_drained: true,
          closed: true,
          subscriber_connected: false,
          redis_connected: false,
        })
        if (fault === 'unsubscribe')
          expect(outcome.failures.some((error) => error.includes('fixture_unsubscribe_failure'))).toBe(true)
        if (fault === 'subscriber_loss') expect(outcome.failures.length).toBeGreaterThan(0)
        await f.first.call('release')
        // The actor owner also exits naturally and closes its actual fixture game socket.
        await f.first.terminate()
        expect(await f.first.shutdown).toMatchObject({ runtime_drained: true, closed: true, redis_connected: false })
        console.log(`SIGTERM_PROOF fault=${fault} first=${f.first.pid} second=${f.second.pid} exit=0`)
      } finally {
        await f.close()
      }
    },
    15000
  )
}

integration(
  'partial pair startup failure closes the started child and Redis connections',
  async () => {
    const redis = fixture_redis(url!)
    let child: Awaited<ReturnType<typeof start_process>> | undefined
    let namespace = ''
    try {
      await redis.connect()
      const clients = async () =>
        String(await redis.send('CLIENT', ['LIST']))
          .trim()
          .split('\n').length
      const before = await clients()
      await expect(
        process_pair(url!, async (target, prefix, actor_id) => {
          if (child) throw new Error('fixture_second_start_failure')
          namespace = prefix
          child = await start_process(target, prefix, actor_id)
          return child
        })
      ).rejects.toThrow('fixture_second_start_failure')
      expect(child).toBeDefined()
      expect(await child!.exited).toBe(0)
      expect(await child!.shutdown).toMatchObject({ redis_connected: false, subscriber_connected: false })
      expect(await redis.send('KEYS', [`${namespace}*`])).toEqual([])
      await until(async () => (await clients()) === before)
    } finally {
      await child?.terminate()
      redis.close()
    }
  },
  15000
)
