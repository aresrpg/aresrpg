// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { isValidSuiAddress, normalizeSuiAddress } from '@mysten/sui/utils'
import { parse_client_packet, SEAT_FLAG, type Claim, type ServerPacket } from '@aresrpg/protocol'

import type { LoginProof } from './auth.ts'
import type { Player } from './player.ts'

const SIGNATURE_TIMEOUT_MS = 15_000

/** The claim of one upgrade URL, or null when it is malformed: an invalid address, an invalid seat
 *  flag, or a seat without an address. */
export const read_claim = (query: URLSearchParams): Claim | null => {
  const address = query.get('address')
  const seat = query.get(SEAT_FLAG.param)
  if (seat !== null && seat !== SEAT_FLAG.value) return null
  if (address === null) return seat === null ? { stage: 'open' } : null
  if (!isValidSuiAddress(address)) return null
  return { stage: seat === null ? 'signed' : 'seated', address: normalizeSuiAddress(address) }
}

type ConnectionOptions = Readonly<{
  claim: Claim
  challenge?: string
  send: (packet: ServerPacket) => void
  close: (code: number, reason: string) => unknown
  verify: (proof: LoginProof) => Promise<boolean>
  release_pending?: () => void
  /** Mounts the claim; null only when the seat cap refuses a new seat. */
  promote: () => Player | null
}>

export type Connection = Readonly<{
  on_message: (raw: string | Buffer) => Promise<void>
  on_close: () => void
}>

/** A socket's admission. Proof work holds a pending slot from upgrade until it ends: a socket closed
 *  during verification is `abandoned` and keeps its slot until verification settles. */
type Door =
  Readonly<{ kind: 'proving' | 'verifying' | 'abandoned' | 'closed' }> | Readonly<{ kind: 'admitted'; player: Player }>
type DoorInput = Readonly<{ kind: 'proof' | 'settled' | 'ended' }> | Readonly<{ kind: 'admitted'; player: Player }>

const step = (door: Door, input: DoorInput): Door => {
  switch (input.kind) {
    case 'proof':
      return { kind: 'verifying' }
    case 'settled':
      return { kind: door.kind === 'abandoned' ? 'closed' : 'proving' }
    case 'ended':
      return { kind: door.kind === 'verifying' || door.kind === 'abandoned' ? 'abandoned' : 'closed' }
    case 'admitted':
      return input
  }
}
const holds_slot = ({ kind }: Door): boolean => kind === 'proving' || kind === 'verifying' || kind === 'abandoned'

/** The one door of every socket. An open claim has nothing to prove and is admitted at once; an
 *  address is quarantined until it proves ownership on this exact socket. */
export const create_connection = ({
  claim,
  challenge = crypto.randomUUID(),
  send,
  close,
  verify,
  promote,
  release_pending = () => {},
}: ConnectionOptions): Connection => {
  let door: Door = { kind: 'proving' }
  const go = (input: DoorInput): void => {
    const before = door
    door = step(door, input)
    if (holds_slot(before) && !holds_slot(door)) release_pending()
  }
  const reject = (reason: string): void => {
    if (door.kind === 'closed' || door.kind === 'abandoned') return
    clearTimeout(timer)
    go({ kind: 'ended' })
    close(1008, reason)
  }
  const timer = setTimeout(() => reject('SIGNATURE_TIMEOUT'), SIGNATURE_TIMEOUT_MS)
  timer.unref?.()

  const admit = (): void => {
    clearTimeout(timer)
    const player = promote()
    if (!player) return reject('SERVER_FULL')
    go({ kind: 'admitted', player })
    send({ type: 'packet/connection_accepted', ...claim })
  }

  const prove = async (address: string, raw: string | Buffer): Promise<void> => {
    if (door.kind === 'verifying') return reject('INVALID_PACKET')
    let packet
    try {
      packet = parse_client_packet(raw)
    } catch (error) {
      console.warn('Rejected malformed login packet.', error)
      return reject('INVALID_PACKET')
    }
    if (packet.type !== 'packet/signature_response') return reject('INVALID_PACKET')
    go({ kind: 'proof' })
    const verified = await verify({ ...packet, address, uuid: challenge }).catch((error: unknown) => {
      console.error('Login verification failed.', error)
      return false
    })
    go({ kind: 'settled' })
    if (door.kind === 'closed') return
    if (!verified) return reject('INVALID_SIGNATURE')
    admit()
  }

  if (claim.stage === 'open') admit()
  else send({ type: 'packet/signature_request', payload: challenge })

  return Object.freeze({
    on_message: async (raw): Promise<void> => {
      if (door.kind === 'admitted') return door.player.on_message(raw)
      if ((door.kind === 'proving' || door.kind === 'verifying') && claim.stage !== 'open')
        await prove(claim.address, raw)
    },
    on_close: (): void => {
      clearTimeout(timer)
      if (door.kind === 'admitted') door.player.on_close()
      go({ kind: 'ended' })
    },
  })
}
