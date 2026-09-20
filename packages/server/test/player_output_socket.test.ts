// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { connect } from 'node:net'

import { expect, test } from 'bun:test'

import { create_player_output, MAX_BUFFERED_BYTES } from '../src/player_output.ts'

test.skipIf(process.env.REAL_SOCKET_TEST !== '1')(
  'a real paused reader reaches the reliable ceiling and is disconnected',
  async () => {
    const controller = new AbortController()
    let refusal: string | undefined
    let peak = 0
    let writes = 0
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request, server) => (server.upgrade(request) ? undefined : new Response('upgrade required')),
      websocket: {
        backpressureLimit: MAX_BUFFERED_BYTES,
        closeOnBackpressureLimit: true,
        open(ws) {
          const output = create_player_output(
            {
              send: (raw) => {
                writes++
                return ws.send(raw)
              },
              getBufferedAmount: () => {
                const size = ws.getBufferedAmount()
                peak = Math.max(peak, size)
                return size
              },
              close: (code, reason) => {
                refusal = reason
                ws.close(code, reason)
              },
            },
            controller.signal
          )
          // Let the client receive the handshake, then stop consuming TCP bytes.
          const timer = setInterval(() => {
            for (let index = 0; index < 20; index++)
              output.send({ type: 'packet/error', reason: 'x'.repeat(256 * 1024) })
          }, 20)
          controller.signal.addEventListener('abort', () => clearInterval(timer), { once: true })
        },
        message() {},
      },
    })
    const socket = connect({ host: '127.0.0.1', port: server.port! })
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('error', reject)
        socket.once('connect', () =>
          socket.write(
            'GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'
          )
        )
        socket.once('data', (data) => {
          expect(data.toString()).toContain('101')
          socket.pause()
          resolve()
        })
      })
      const deadline = performance.now() + 3000
      while (!refusal && performance.now() < deadline) await Bun.sleep(20)
      expect(refusal).toBe('SLOW_CONSUMER')
      expect(peak).toBeLessThanOrEqual(MAX_BUFFERED_BYTES)
      const stopped_at = writes
      await Bun.sleep(50)
      expect(writes).toBe(stopped_at)
    } finally {
      controller.abort()
      socket.destroy()
      server.stop(true)
    }
  },
  5000
)
