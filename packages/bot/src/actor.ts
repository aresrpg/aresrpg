// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  create_agent_connection,
  type AgentConnectionOptions,
  type AgentTransport,
  type AgentConnectionState,
} from '@aresrpg/sdk/agent-connection'
import type { ClientPacket } from '@aresrpg/protocol'

type ObservationPacket = Extract<ClientPacket, { type: 'packet/market_observe' | 'packet/market_prices_observe' }>
type Watch = Readonly<{ owner: string; packet: ObservationPacket }>
type Slots = Readonly<{ market: Watch | null; prices: Watch | null }>
type SlotAction = Readonly<{ slot: keyof Slots; owner: string; packet: ObservationPacket }> | Readonly<{ reset: true }>
const reduce_slots = (state: Slots, action: SlotAction): Slots => {
  if ('reset' in action) return { market: null, prices: null }
  const existing = state[action.slot]
  if (existing !== null && existing.owner !== action.owner) throw new Error('OBSERVATION_SLOT_BUSY')
  if (JSON.stringify(existing?.packet) === JSON.stringify(action.packet)) return state
  return {
    ...state,
    [action.slot]: action.packet.observation === null ? null : { owner: action.owner, packet: action.packet },
  }
}
export type ActorOptions = Readonly<{
  connection: Omit<AgentConnectionOptions, 'authorize'>
  // Owner must check current durable lane fence, lease expiry, restore epoch and grant here.
  authorize: (stage: 'connect' | 'sign' | 'send' | 'heartbeat') => Promise<void>
  authorize_observation?: (owner: string) => Promise<void>
  needs_resync: () => Promise<void>
  observe: (state: AgentConnectionState) => Promise<void>
  report_failure: (error: unknown) => void
}>

/** Exactly one ordinary wallet-auth root connection per leased bot, shared by every connector
 * and character. No reconnect timer and no executor: bounded writes use the SDK execution seam.
 * The supervisor must await check_lease on its renewal cadence and never recreate a stopped actor. */
export const create_bot_actor = (options: ActorOptions) => {
  let slots: Slots = { market: null, prices: null }
  let pending: Promise<void> = Promise.resolve()
  let starting: Promise<void> | null = null
  let observing: Promise<unknown> = Promise.resolve()
  let was_ready = false
  const authorize = async (stage: 'connect' | 'sign' | 'send' | 'heartbeat') => {
    try {
      await options.authorize(stage)
    } catch (error) {
      connection.stop()
      throw error
    }
  }
  const connection = create_agent_connection({ ...options.connection, authorize })
  const unsubscribe = connection.subscribe((state) => {
    const restore = state.status === 'ready' && !was_ready
    was_ready = state.status === 'ready'
    if (state.status === 'stopped') slots = reduce_slots(slots, { reset: true })
    pending = pending
      .then(async () => {
        if (state.status !== 'ready') {
          await options.needs_resync()
        }
        await options.observe(state)
        if (restore) await restore_watches()
      })
      .catch((error: unknown) => {
        // Do not recursively stop an already stopped connection from its observer error.
        if (connection.state().status !== 'stopped') connection.stop()
        options.report_failure(error)
      })
  })
  const connect = async () => {
    if (connection.state().status === 'stopped') throw new Error('ACTOR_TERMINAL')
    if (starting) return starting
    if (!['disconnected', 'failed'].includes(connection.state().status)) return
    starting = (async () => {
      await options.needs_resync()
      await connection.connect()
    })()
    try {
      await starting
    } finally {
      starting = null
    }
  }
  const restore_watches = async () => {
    await observing
    for (const slot of ['market', 'prices'] as const) {
      const watch = slots[slot]
      if (!watch) continue
      try {
        await options.authorize_observation?.(watch.owner)
        if (!(await connection.send(watch.packet))) throw new Error('OBSERVATION_CONNECTION_NOT_READY')
      } catch (error) {
        slots = { ...slots, [slot]: null }
        options.report_failure(error)
      }
    }
  }
  const observe = (owner: string, packet: ObservationPacket): Promise<boolean> => {
    const result = observing.then(async () => {
      const slot = packet.type === 'packet/market_observe' ? 'market' : 'prices'
      if (packet.observation !== null) await options.authorize_observation?.(owner)
      const next = reduce_slots(slots, { slot, owner, packet })
      if (next === slots) return true
      if (packet.observation === null) {
        slots = next
        if (connection.state().status !== 'ready') return true
      }
      const sent = await connection.send(packet)
      if (!sent) throw new Error('OBSERVATION_CONNECTION_NOT_READY')
      slots = next
      return true
    })
    observing = result.catch((error: unknown) => ({ error })) // Caller receives rejection; queue remains usable.
    return result
  }
  const check_lease = async () => {
    await authorize('heartbeat')
    for (const slot of ['market', 'prices'] as const) {
      const watch = slots[slot]
      if (!watch) continue
      try {
        await options.authorize_observation?.(watch.owner)
      } catch (error) {
        slots = { ...slots, [slot]: null }
        await connection.send({ ...watch.packet, observation: null })
        options.report_failure(error)
      }
    }
  }
  return Object.freeze({
    connect,
    disconnect: connection.disconnect,
    check_lease,
    state: connection.state,
    observe,
    send: async (packet: ClientPacket) => {
      if (packet.type === 'packet/market_observe' || packet.type === 'packet/market_prices_observe')
        throw new Error('USE_ARBITRATED_OBSERVATION')
      return connection.send(packet)
    },
    settle_observations: async () => {
      await pending
    },
    stop: async () => {
      connection.stop()
      await pending
      unsubscribe()
    },
  })
}

export const bun_transport: AgentTransport = {
  open: (url, handlers) => {
    // Bun supports request headers; DOM's ambient constructor omits this runtime overload.
    const Socket = WebSocket as unknown as {
      new (url: string, options: { headers: Record<string, string> }): WebSocket
    }
    const socket = new Socket(url, { headers: { Origin: handlers.origin } })
    socket.addEventListener('message', (event) => {
      void handlers.on_message(String(event.data)).catch((error: unknown) => {
        console.error('Actor message processing failed', error)
        socket.close(1011, 'MESSAGE_FAILED')
      })
    })
    socket.addEventListener('close', (event) => handlers.on_close(event.code, event.reason))
    socket.addEventListener('error', () => socket.close(1011, 'TRANSPORT_FAILED'))
    return { send: (raw) => socket.send(raw), close: (code, reason) => socket.close(code, reason) }
  },
}
