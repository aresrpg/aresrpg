import { expect, test } from 'bun:test'

import { probe_agent_connection } from '../../examples/agent_probe.ts'

const address = `0x${'1'.repeat(64)}`
const origin = 'http://localhost:5173'

test('real loopback WebSocket receives the native admission challenge without signing', async () => {
  // Dynamic path keeps the example's SDK dependency graph independent of server tooling.
  const admission_path = new URL('../../../server/src/connection.ts', import.meta.url).href
  const { create_authenticated_connection } = await import(admission_path)
  let packets = 0
  let verified = false
  let connection: { on_close: () => void } | undefined
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      expect(request.headers.get('origin')).toBe(origin)
      expect(new URL(request.url).searchParams.get('address')).toBe(address)
      return server.upgrade(request) ? undefined : new Response('upgrade required', { status: 400 })
    },
    websocket: {
      open(socket) {
        connection = create_authenticated_connection({
          address,
          send: (packet: unknown) => socket.send(JSON.stringify(packet)),
          close: (code: number, reason: string) => socket.close(code, reason),
          verify: async () => {
            verified = true
            return false
          },
          promote: () => {
            throw new Error('Probe cannot authenticate')
          },
        })
      },
      message() {
        packets += 1
      },
      close() {
        connection?.on_close()
      },
    },
  })
  try {
    expect(await probe_agent_connection({ endpoint: `ws://127.0.0.1:${server.port}/`, origin, address })).toEqual({
      challenge_received: true,
      authenticated: false,
      packets_sent: 0,
    })
    expect(packets).toBe(0)
    expect(verified).toBe(false)
  } finally {
    connection?.on_close()
    server.stop(true)
  }
})

test('probe rejects unsafe endpoint configuration before opening a socket', () => {
  for (const endpoint of [
    'ws://example.com/',
    'wss://example.com/path',
    'wss://user@example.com/',
    'wss://example.com/?address=other',
  ])
    expect(() => probe_agent_connection({ endpoint, origin, address })).toThrow()
})
