// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { parse_client_packet, type ServerPacket } from '@aresrpg/protocol'

import type { LoginProof } from './auth.ts'
import type { Player } from './player.ts'

const SIGNATURE_TIMEOUT_MS = 15_000

type ConnectionOptions = Readonly<{
  address: string
  challenge?: string
  send: (packet: ServerPacket) => void
  close: (code: number, reason: string) => unknown
  verify: (proof: LoginProof) => Promise<boolean>
  promote: () => Player | null
}>

export type AuthenticatedConnection = Readonly<{
  on_message: (raw: string | Buffer) => Promise<void>
  on_close: () => void
}>

/** Quarantine one transport until it proves ownership of the address on this exact socket. */
export const create_authenticated_connection = ({
  address,
  challenge = crypto.randomUUID(),
  send,
  close,
  verify,
  promote,
}: ConnectionOptions): AuthenticatedConnection => {
  let player: Player | null = null
  let verifying = false
  let closed = false
  const timer = setTimeout(() => reject('SIGNATURE_TIMEOUT'), SIGNATURE_TIMEOUT_MS)
  timer.unref?.()

  function reject(reason: string): void {
    if (closed) return
    closed = true
    clearTimeout(timer)
    close(1008, reason)
  }

  send({ type: 'packet/signature_request', payload: challenge })

  return Object.freeze({
    on_message: async (raw): Promise<void> => {
      if (closed) return
      if (player) {
        player.on_message(raw)
        return
      }
      if (verifying) return reject('INVALID_PACKET')
      let packet
      try {
        packet = parse_client_packet(raw)
      } catch (error) {
        console.warn('Rejected malformed login packet.', error)
        return reject('INVALID_PACKET')
      }
      if (packet.type !== 'packet/signature_response') return reject('INVALID_PACKET')
      verifying = true
      let verified = false
      try {
        verified = await verify({ ...packet, address, uuid: challenge })
      } catch (error) {
        console.error('Login verification failed.', error)
      }
      if (closed) return
      if (!verified) return reject('INVALID_SIGNATURE')
      clearTimeout(timer)
      player = promote()
      if (!player) return reject('SERVER_FULL')
      send({ type: 'packet/connection_accepted', address })
    },
    on_close: (): void => {
      if (closed && !player) return
      closed = true
      clearTimeout(timer)
      player?.on_close()
      player = null
    },
  })
}
