// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_pending_admission } from '../src/admission.ts'
import { create_authenticated_connection } from '../src/connection.ts'

const proof = JSON.stringify({ type: 'packet/signature_response', bytes: 'bytes', signature: 'signature' })

test('close during verification retains the reservation until verification settles', async () => {
  const admission = create_pending_admission(1)
  let resolve!: (valid: boolean) => void
  const verification = new Promise<boolean>((done) => {
    resolve = done
  })
  let promotions = 0
  const connection = create_authenticated_connection({
    address: 'same-live-address',
    send: () => {},
    close: () => {},
    verify: () => verification,
    release_pending: admission.reserve()!,
    promote: () => {
      promotions += 1
      return null
    },
  })
  const pending = connection.on_message(proof)
  connection.on_close()
  expect(admission.reserve()).toBeNull()
  resolve(true)
  await pending
  expect(promotions).toBe(0)
  expect(admission.size()).toBe(0)
  connection.on_close()
  expect(admission.size()).toBe(0)
})

test('actual websocket pending flood stays bounded while a proved replacement can promote', async () => {
  const admission = create_pending_admission(2)
  const handlers = new Map<unknown, ReturnType<typeof create_authenticated_connection>>()
  let promotions = 0
  let active: { close: (code: number, reason: string) => unknown } | null = null
  const server = Bun.serve<{ release: () => void }>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, listener) {
      const release = admission.reserve()
      if (!release) return new Response('full', { status: 503 })
      if (listener.upgrade(request, { data: { release } })) return
      release()
      return new Response('failed', { status: 400 })
    },
    websocket: {
      open(ws) {
        handlers.set(
          ws,
          create_authenticated_connection({
            address: 'same-live-address',
            send: (packet) => {
              ws.send(JSON.stringify(packet))
            },
            close: (code, reason) => ws.close(code, reason),
            release_pending: ws.data.release,
            verify: async () => true,
            promote: () => {
              active?.close(1000, 'REPLACED')
              active = ws
              promotions += 1
              return { dispatch: () => {}, on_message: () => {}, on_close: () => {} }
            },
          })
        )
      },
      message(ws, raw) {
        void handlers.get(ws)?.on_message(raw)
      },
      close(ws) {
        handlers.get(ws)?.on_close()
        handlers.delete(ws)
        if (active === ws) active = null
      },
    },
  })
  const endpoint = `http://127.0.0.1:${server.port}`
  const clients: WebSocket[] = []
  const connect = (): Promise<WebSocket> =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.port}`)
      clients.push(ws)
      ws.onopen = () => resolve(ws)
    })
  try {
    const prove = (ws: WebSocket): Promise<void> =>
      new Promise((resolve) => {
        ws.onmessage = (event) => {
          if (JSON.parse(String(event.data)).type === 'packet/connection_accepted') resolve()
        }
        ws.send(proof)
      })
    const first = await connect()
    await prove(first)
    expect(admission.size()).toBe(0)
    const second = await connect()
    const third = await connect()
    expect(admission.size()).toBe(2)
    const blocked = await fetch(endpoint)
    expect(blocked.status).toBe(503)
    await blocked.text()
    await prove(second)
    expect(promotions).toBe(2)
    expect(admission.size()).toBe(1)
    third.close()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(first.readyState).toBe(WebSocket.CLOSED)
    expect(admission.size()).toBe(0)
    const failed = await fetch(endpoint)
    expect(failed.status).toBe(400)
    await failed.text()
    expect(admission.size()).toBe(0)
  } finally {
    await Promise.all(
      clients.map(
        (ws) =>
          new Promise<void>((resolve) => {
            if (ws.readyState === WebSocket.CLOSED) return resolve()
            ws.onclose = () => resolve()
            ws.close()
          })
      )
    )
    expect(clients.every((ws) => ws.readyState === WebSocket.CLOSED)).toBe(true)
    // Bun 1.3.5 retains replaced sockets in its stop promise after their CLOSED events.
    // The forced listener shutdown is synchronous; prove it instead of awaiting that counter.
    void server.stop(true)
    await expect(fetch(endpoint)).rejects.toMatchObject({ code: 'ConnectionRefused' })
  }
})
