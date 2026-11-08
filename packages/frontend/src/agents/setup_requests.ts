// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { AgentSetupRequest, AgentSetupResult } from '@aresrpg/protocol'

import type { AuthSession } from '../auth.ts'
import type { AppContext } from '../store.ts'
import type { ServerLink } from '../server_link.ts'

export type SetupExchange = (wallet: AuthSession, request: AgentSetupRequest) => Promise<AgentSetupResult>
export type AgentSetupInput = Readonly<{
  type: 'agent_setup/request'
  wallet: AuthSession
  request: AgentSetupRequest
  resolve: (result: AgentSetupResult) => void
  reject: (error: Readonly<Error>) => void
}>
/** Reuse the authenticated game socket and its request IDs; never open another player connection. */
export const observe_agent_setup_requests = (
  { events, get_state, signal }: AppContext,
  send: ServerLink['send'],
  next_id: () => number
): void => {
  const active = new Map<string, string>()
  const pending = new Map<number, Readonly<{ input: AgentSetupInput; timer: ReturnType<typeof setTimeout> }>>()
  const fail_all = () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.input.reject(new Error('SETUP_UNAVAILABLE'))
    }
    pending.clear()
  }
  const retire = () => {
    for (const [pairing_id, token] of active) {
      if (
        !send({ type: 'packet/agent_setup_request', id: next_id(), request: { action: 'cancel', pairing_id, token } })
      )
        console.warn('Agent setup cancellation could not be sent; its server expiry still applies.')
    }
    active.clear()
    fail_all()
  }
  events.on('agent_setup/request', (input) => {
    if (input.wallet !== get_state().session.wallet) {
      input.reject(new Error('SETUP_UNAVAILABLE'))
      return
    }
    if (input.request.action === 'cancel' && active.get(input.request.pairing_id) === input.request.token)
      active.delete(input.request.pairing_id)
    const id = next_id()
    const timer = setTimeout(() => {
      pending.delete(id)
      input.reject(new Error('SETUP_TIMEOUT'))
    }, 25_000)
    pending.set(id, { input, timer })
    if (!send({ type: 'packet/agent_setup_request', id, request: input.request })) fail_all()
  })
  events.on('server/packet', ({ packet }) => {
    if (packet.type === 'packet/error' && packet.id !== undefined) {
      const failed = pending.get(packet.id)
      if (!failed) return
      clearTimeout(failed.timer)
      pending.delete(packet.id)
      failed.input.reject(new Error('SETUP_UNAVAILABLE'))
      return
    }
    if (packet.type !== 'packet/agent_setup_response') return
    const entry = pending.get(packet.id)
    if (!entry) {
      if (packet.result.action === 'begin')
        send({
          type: 'packet/agent_setup_request',
          id: next_id(),
          request: { action: 'cancel', pairing_id: packet.result.pairing_id, token: packet.result.token },
        })
      return
    }
    clearTimeout(entry.timer)
    pending.delete(packet.id)
    if (packet.result.action === 'begin') active.set(packet.result.pairing_id, packet.result.token)
    entry.input.resolve(packet.result)
  })
  events.on('STATE_UPDATED', (state, previous) => {
    if (state.session.wallet !== previous.session.wallet) retire()
  })
  signal.addEventListener('abort', retire, { once: true })
}
