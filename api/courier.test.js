// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Courier POST endpoints over a REAL throwaway Redis. run_tests.sh supplies REDIS_URL and runs this file in
// its own Bun process because courier.mjs resolves its production Redis client once at module load.
//
//   REDIS_URL=redis://127.0.0.1:6399 bun test api/courier.test.js

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { RedisClient } from 'bun'

const redis_url = process.env.REDIS_URL
const redis_socket = process.env.COURIER_TEST_REDIS_SOCKET
const memory_protocol = process.env.COURIER_TEST_MEMORY_PROTOCOL === '1'
if (!redis_url && !redis_socket && !memory_protocol)
  throw new Error(
    'courier.test.js needs the throwaway Redis from api/run_tests.sh\n' +
      '  REDIS_URL=redis://127.0.0.1:6399 bun test api/courier.test.js'
  )

process.env.COURIER_POSITION_TTL_MS = '60'
const { CHAT_MAX_LENGTH, create_courier_service, create_redis_courier_registry, route_courier_post } =
  await import('./courier.mjs')

const ADDRESS = `0x${'a1'.repeat(32)}`
const WORLD = `0x${'b2'.repeat(32)}`
const CHARACTER = `0x${'c3'.repeat(32)}`
const auth = (sender = ADDRESS) => ({
  sender,
  challenge: `aresrpg-courier:${sender}:${Date.now()}`,
  signature: 'test-zklogin-signature',
})
const position = (sender = ADDRESS) => ({
  world: WORLD,
  character: CHARACTER,
  x: -145,
  z: 42,
  heading: 1.25,
  ...auth(sender),
})
const chat = (sender = ADDRESS, text = 'hello world') => ({
  world: WORLD,
  character: CHARACTER,
  text,
  ...auth(sender),
})

// The managed Codex sandbox blocks TCP listeners but permits Unix sockets. CI/run_tests.sh takes the normal
// native RedisClient branch; the tiny redis-cli adapter lets the exact same REAL-Redis assertions run locally.
const unix_redis = (socket) => ({
  async send(command, args) {
    const child = Bun.spawn(['redis-cli', '-s', socket, '--raw', command, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exit_code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (exit_code !== 0) throw new Error(stderr.trim() || `redis-cli ${command} failed`)
    const value = stdout.replace(/\n$/, '')
    if (command === 'ZRANGEBYSCORE' || command === 'MGET') return value ? value.split('\n') : []
    return value
  },
  close() {},
})
const memory_redis = () => {
  const strings = new Map()
  const expiries = new Map()
  const sorted = new Map()
  const live_string = (key) => {
    if ((expiries.get(key) ?? Infinity) <= Date.now()) {
      strings.delete(key)
      expiries.delete(key)
    }
    return strings.get(key) ?? null
  }
  return {
    async send(command, args) {
      if (command === 'FLUSHDB') {
        strings.clear()
        expiries.clear()
        sorted.clear()
        return 'OK'
      }
      if (command === 'EVAL' && args[0].includes("'INCR'")) {
        const [, , key] = args
        const count = Number(live_string(key) ?? 0) + 1
        strings.set(key, String(count))
        if (count === 1) expiries.set(key, Date.now() + Number(args[3]))
        return String(count)
      }
      if (command === 'EVAL') {
        const [, , key, index, , payload, ttl, expires_at, character] = args
        strings.set(key, payload)
        expiries.set(key, Date.now() + Number(ttl))
        const rows = sorted.get(index) ?? new Map()
        rows.set(character, Number(expires_at))
        sorted.set(index, rows)
        return '1'
      }
      if (command === 'ZREMRANGEBYSCORE') {
        const rows = sorted.get(args[0]) ?? new Map()
        const ceiling = Number(args[2])
        for (const [member, score] of rows) if (score <= ceiling) rows.delete(member)
        return '1'
      }
      if (command === 'ZRANGEBYSCORE') {
        const rows = sorted.get(args[0]) ?? new Map()
        const floor = Number(args[1])
        return [...rows].filter(([, score]) => score >= floor).map(([member]) => member)
      }
      if (command === 'MGET') return args.map(live_string)
      if (command === 'PUBLISH') return '1'
      throw new Error(`unsupported memory Redis command ${command}`)
    },
    close() {},
  }
}
const redis = memory_protocol ? memory_redis() : redis_socket ? unix_redis(redis_socket) : new RedisClient(redis_url)
const registry = create_redis_courier_registry(redis)
const service = create_courier_service({
  registry,
  authenticate: async ({ sender }) => sender,
})

beforeAll(async () => {
  await redis.send('FLUSHDB', [])
})

afterAll(async () => {
  await redis.send('FLUSHDB', [])
  redis.close()
})

describe('POST /v1/courier/position', () => {
  test('accepts two updates per second/address and rejects the burst beyond the hard Redis gate', async () => {
    const sender = `0x${'d4'.repeat(32)}`
    expect((await route_courier_post('/v1/courier/position', position(sender), service)).status).toBe(202)
    expect((await route_courier_post('/v1/courier/position', position(sender), service)).status).toBe(202)

    const refused = await route_courier_post('/v1/courier/position', position(sender), service)
    expect(refused.status).toBe(429)
    expect(refused.json.error).toMatch(/rate limited/i)
  })

  test('stores the latest pose in the world registry, then the Redis TTL lapses it', async () => {
    const sender = `0x${'e5'.repeat(32)}`
    await service.post_position(position(sender))

    expect(await registry.read_positions(WORLD)).toEqual([
      expect.objectContaining({
        type: 'position',
        world: WORLD,
        character: CHARACTER,
        address: sender,
        x: -145,
        z: 42,
        heading: 1.25,
      }),
    ])

    await Bun.sleep(90)
    expect(await registry.read_positions(WORLD)).toEqual([])
  })
})

describe('POST /v1/courier/chat', () => {
  test('accepts one line per two seconds/address and rejects the burst beyond the hard Redis gate', async () => {
    const sender = `0x${'f6'.repeat(32)}`
    expect((await route_courier_post('/v1/courier/chat', chat(sender), service)).status).toBe(202)

    const refused = await route_courier_post('/v1/courier/chat', chat(sender, 'too fast'), service)
    expect(refused.status).toBe(429)
    expect(refused.json.error).toMatch(/rate limited/i)
  })

  test('publishes a length-capped row to the same world presence channel', async () => {
    const sender = `0x${'17'.repeat(32)}`
    const published = []
    const observing_service = create_courier_service({
      authenticate: async ({ sender: authenticated }) => authenticated,
      registry: {
        take_rate_slot: (...args) => registry.take_rate_slot(...args),
        put_position: (...args) => registry.put_position(...args),
        read_positions: (...args) => registry.read_positions(...args),
        publish_chat: async (row) => published.push(row),
      },
    })

    await observing_service.post_chat(chat(sender, 'courier line'))
    expect(published).toEqual([
      expect.objectContaining({
        type: 'chat',
        world: WORLD,
        character: CHARACTER,
        address: sender,
        text: 'courier line',
      }),
    ])

    const oversized = chat(`0x${'28'.repeat(32)}`, '🗡'.repeat(CHAT_MAX_LENGTH + 1))
    const refused = await route_courier_post('/v1/courier/chat', oversized, observing_service)
    expect(refused.status).toBe(400)
    expect(refused.json.error).toMatch(/280/)
  })
})
