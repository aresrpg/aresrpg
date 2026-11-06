// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Local test entry only. No production wallet, session, Redis or RPC is used.
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { EventEmitter } from 'node:events'

import { Redis } from 'ioredis'
import { parse_client_packet, type ServerPacket } from '@aresrpg/protocol'

import { create_pairing_exchange } from '../../../server/src/agent_pairing.ts'
import { serve_agent_setup } from '../../../server/src/agent_setup_http.ts'
import player_agent_setup from '../../../server/src/modules/player_agent_setup.ts'
import type { PlayerContext } from '../../../server/src/player.ts'

const directory = await mkdtemp('/tmp/ares-agent-ui-')
const socket = `${directory}/redis.sock`
const child = spawn('redis-server', ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
})
await new Promise<void>((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', () => reject(new Error('Fixture Redis exited before readiness')))
  child.stdout!.on('data', (chunk) => {
    if (/ready to accept connections/i.test(String(chunk))) resolve()
  })
})
const redis = new Redis(socket, { lazyConnect: true, retryStrategy: () => null })
await redis.connect()
const exchange = create_pairing_exchange(redis)
const owners = new Set([
  '0xd41c7cbc0cbccb9e7ab701373f3b5f082cc0024098f2ab561ff342107b91491f',
  '0xe971cf45c36d7c57a5c9dbeedaf953045d509c795a46e6b480f487588ca788e5',
])
const session_request = async (request: Request) => {
  const { owner, request: input } = await request.json()
  if (!owners.has(owner)) return new Response(null, { status: 403 })
  const packet = parse_client_packet(JSON.stringify({ type: 'packet/agent_setup_request', id: 1, request: input }))
  const events = new EventEmitter()
  const controller = new AbortController()
  return new Promise<Response>((resolve) => {
    player_agent_setup.observe({
      address: owner,
      agent_pairing: exchange,
      events,
      signal: controller.signal,
      send: (reply: ServerPacket) => {
        if (reply.type !== 'packet/agent_setup_response') return
        controller.abort()
        resolve(Response.json(reply.result))
      },
    } as PlayerContext)
    events.emit(packet.type, packet)
  })
}
const expire = async (id: string) => {
  await redis.pexpire(`agent-pairing:${id}`, 1)
  await Bun.sleep(10)
  return Response.json({ expired: true })
}
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 5198,
  fetch: async (request) => {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS')
      return new Response(null, {
        headers: {
          'access-control-allow-origin': `http://127.0.0.1:${Number(process.env.ARES_AGENT_TEST_PORT ?? 5187)}`,
          'access-control-allow-methods': 'POST,GET,OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      })
    const response =
      url.pathname === '/fixture/session'
        ? await session_request(request)
        : url.pathname === '/fixture/expire'
          ? await expire(url.searchParams.get('id') ?? '')
          : url.pathname === '/api/agent-setup'
            ? await serve_agent_setup(request, exchange)
            : new Response('ready')
    response.headers.set(
      'access-control-allow-origin',
      `http://127.0.0.1:${Number(process.env.ARES_AGENT_TEST_PORT ?? 5187)}`
    )
    return response
  },
})
const stop = async () => {
  server.stop(true)
  redis.disconnect()
  const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  await ended
  await rm(directory, { recursive: true, force: true })
  process.exit(0)
}
process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())
