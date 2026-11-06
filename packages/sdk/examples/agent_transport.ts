// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentTransport } from '../src/agent_connection.ts'

type BunSocketConstructor = new (url: string, options: Readonly<{ headers: Readonly<{ Origin: string }> }>) => WebSocket

/** Native Bun WebSocket transport; signing and lifecycle remain with the SDK caller. */
export const create_bun_agent_transport = (): AgentTransport => ({
  open: (url, handlers) => {
    // Bun supports header options; DOM typings omit this overload.
    const socket_type = WebSocket as unknown as BunSocketConstructor
    const ws = new socket_type(url, { headers: { Origin: handlers.origin } })
    const fail = (error: unknown) => {
      handlers.on_close(1006, String(error))
      ws.close()
    }
    ws.onerror = () => fail(new Error('WebSocket transport failed'))
    ws.onmessage = (event) => {
      void handlers.on_message(String(event.data)).catch(fail)
    }
    ws.onclose = (event) => handlers.on_close(event.code, event.reason)
    return { send: (raw) => ws.send(raw), close: (code, reason) => ws.close(code, reason) }
  },
})
