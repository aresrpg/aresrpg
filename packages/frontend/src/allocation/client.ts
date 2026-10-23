// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AllocationRequest, AllocationResult, ServerPacket } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import { connect_server } from '../server_link.ts'

const LINK_FAILURES = new Set(['link/connecting', 'link/failed', 'link/replaced', 'link/rejected', 'link/violation'])
const response = (packet: Readonly<ServerPacket>) => {
  if (packet.type === 'packet/allocation_response') return packet
  if (packet.type === 'packet/error')
    return { id: packet.id, result: { action: 'error' as const, error: 'rate_limited' } }
  return null
}

const measure = (name: string, started: number): void => {
  performance.clearMeasures(name)
  performance.measure(name, { start: started, end: performance.now() })
}

/** Campaign traffic uses the ordinary wallet-authenticated game connection. */
export const create_allocation_client = (
  session: AuthSession,
  connect = connect_server,
  progress: (phase: 'connecting' | 'loading') => void = () => {}
) => {
  const pending = new Map<
    number,
    Readonly<{
      resolve: (result: AllocationResult) => void
      reject: (error: Readonly<Error>) => void
      timer: ReturnType<typeof setTimeout>
    }>
  >()
  let next_id = 0
  let accepted = false
  let failure: Error | null = null
  let waiting: (() => void) | null = null
  const fail = (error = new Error('connection_failed')): void => {
    failure = error
    accepted = false
    waiting?.()
    waiting = null
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  const start = () =>
    connect({
      session,
      dispatch: (input) => {
        if (LINK_FAILURES.has(input.type))
          fail(new Error(input.type === 'link/replaced' ? 'connection_replaced' : 'connection_failed'))
        if (input.type === 'link/connecting') failure = null
        if (input.type !== 'server/packet') return
        const { packet } = input
        if (packet.type === 'packet/connection_accepted') {
          accepted = true
          failure = null
          waiting?.()
          waiting = null
        }
        const reply = response(packet)
        if (reply?.id === undefined) return
        const request = pending.get(reply.id)
        if (!request) return
        clearTimeout(request.timer)
        pending.delete(reply.id)
        request.resolve(reply.result)
      },
    })
  let link = start()
  return {
    reconnect: (): void => {
      link.dispose()
      fail()
      link = start()
    },
    request: async (request: AllocationRequest): Promise<AllocationResult> => {
      if (failure) throw failure
      if (!accepted) {
        const started = performance.now()
        progress('connecting')
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            measure('allocation:admission', started)
            waiting = null
            resolve()
          }, 20000)
          waiting = () => {
            measure('allocation:admission', started)
            clearTimeout(timer)
            resolve()
          }
        })
      }
      if (failure) throw failure
      if (!accepted) throw new Error('connection_timeout')
      progress('loading')
      const id = ++next_id
      const started = performance.now()
      const result = await new Promise<AllocationResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('connection_timeout'))
        }, 25000)
        pending.set(id, { resolve, reject, timer })
        if (!link.send({ type: 'packet/allocation_request', id, request })) fail()
      }).finally(() => measure(`allocation:request:${request.action}`, started))
      if (result.action === 'error') throw new Error(result.error)
      return result
    },
    dispose: (): void => {
      link.dispose()
      fail()
    },
  }
}
