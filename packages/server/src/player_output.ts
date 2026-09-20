// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { PlayerPosition, ServerPacket } from '@aresrpg/protocol'
import { POSITION_INTERVAL_MS } from '@aresrpg/protocol'

export const MAX_BUFFERED_BYTES = 8 * 1024 * 1024
const POSITION_BUFFER_BYTES = 64 * 1024
const MAX_PENDING_POSITIONS = 4096
const POSITION_BATCH_SIZE = 256
const STALLED_MS = 5_000
export type PlayerSocket = {
  send: (raw: string) => unknown
  close: (code?: number, reason?: string) => unknown
  getBufferedAmount?: () => number
}
const schedule_tick = (run: () => void): (() => void) => {
  const timer = setTimeout(run, POSITION_INTERVAL_MS)
  timer.unref?.()
  return () => clearTimeout(timer)
}

/** Reliable facts are sent in order. Only unsent positions are replaced by newer samples. */
export const create_player_output = (
  socket: PlayerSocket,
  signal: AbortSignal,
  schedule = schedule_tick,
  now = Date.now
) => {
  const positions = new Map<string, PlayerPosition>()
  let cancel: (() => void) | null = null
  let closed = false
  let stalled_at: number | null = null
  const clear = (): void => {
    cancel?.()
    cancel = null
    positions.clear()
  }
  const refuse = (): void => {
    closed = true
    clear()
    socket.close(1013, 'SLOW_CONSUMER')
  }
  const buffered = (): number => socket.getBufferedAmount?.() ?? 0
  const write = (packet: ServerPacket): void => {
    if (closed || signal.aborted) return
    const raw = JSON.stringify(packet)
    if (buffered() + Buffer.byteLength(raw) > MAX_BUFFERED_BYTES) return refuse()
    if (socket.send(raw) === 0) refuse()
  }
  const arm = (): void => {
    if (!cancel && positions.size) cancel = schedule(flush)
  }
  const flush = (): void => {
    cancel = null
    if (closed || signal.aborted) return
    if (buffered() >= POSITION_BUFFER_BYTES) {
      stalled_at ??= now()
      if (now() - stalled_at >= STALLED_MS) return refuse()
      arm()
      return
    }
    stalled_at = null
    const batch = [...positions.values()].slice(0, POSITION_BATCH_SIZE)
    batch.forEach(({ character_id }) => positions.delete(character_id))
    if (batch.length) write({ type: 'packet/players_moved', positions: batch })
    arm()
  }
  signal.addEventListener('abort', clear, { once: true })
  return Object.freeze({
    send: (packet: ServerPacket): void => {
      if (packet.type === 'packet/player_appeared') positions.delete(packet.player.character_id)
      if (packet.type === 'packet/player_left') positions.delete(packet.character_id)
      write(packet)
    },
    position: (position: PlayerPosition): void => {
      if (closed || signal.aborted) return
      positions.set(position.character_id, position)
      if (positions.size > MAX_PENDING_POSITIONS) return refuse()
      arm()
    },
  })
}
