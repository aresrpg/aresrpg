// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AllocationRequest, AllocationResult, ServerPacket } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import { connect_server } from '../server_link.ts'

const LINK_FAILURES = new Set(['link/connecting', 'link/failed', 'link/replaced', 'link/rejected'])
const response = (packet: Readonly<ServerPacket>) => {
  if (packet.type === 'packet/allocation_response') return packet
  if (packet.type === 'packet/error')
    return { id: packet.id, result: { action: 'error' as const, error: 'rate_limited' } }
  return null
}

/** Campaign traffic uses the ordinary wallet-authenticated game connection. */
export const create_allocation_client = (session: AuthSession, connect = connect_server) => {
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
  let waiting: (() => void) | null = null
  const fail = (): void => {
    accepted = false
    waiting?.()
    waiting = null
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error('unavailable'))
    }
    pending.clear()
  }
  const link = connect({
    session,
    dispatch: (input) => {
      if (LINK_FAILURES.has(input.type)) fail()
      if (input.type !== 'server/packet') return
      const { packet } = input
      if (packet.type === 'packet/connection_accepted') {
        accepted = true
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
  return {
    request: async (request: AllocationRequest): Promise<AllocationResult> => {
      if (!accepted)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            waiting = null
            resolve()
          }, 20000)
          waiting = () => {
            clearTimeout(timer)
            resolve()
          }
        })
      if (!accepted) throw new Error('unavailable')
      const id = ++next_id
      const result = await new Promise<AllocationResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error('unavailable'))
        }, 25000)
        pending.set(id, { resolve, reject, timer })
        if (!link.send({ type: 'packet/allocation_request', id, request })) fail()
      })
      if (result.action === 'error') throw new Error(result.error)
      return result
    },
    dispose: (): void => {
      link.dispose()
      fail()
    },
  }
}
