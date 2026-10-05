// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { EquippedItem } from './packets.ts'

export const PROFILE_PAGE_SIZE = 20
export type ProfileCharacter = Readonly<{ id: string; name: string; classe: string; level: number }>
export type PlayerProfile = Readonly<{
  character_count: number
  characters: readonly ProfileCharacter[]
  next: string | null
  jobs: readonly Readonly<{ job: string; level: number }>[]
}>
export type InspectionQuery =
  | Readonly<{ kind: 'profile'; address: string; after: string | null }>
  | Readonly<{ kind: 'equipment'; address: string; character_id: string }>
export type InspectionResult =
  | Readonly<{ kind: 'profile'; profile: PlayerProfile }>
  | Readonly<{ kind: 'equipment'; equipment: readonly EquippedItem[] | null }>

const parse_address = (value: unknown): string => {
  if (typeof value !== 'string' || !/^0x[0-9a-f]{64}$/.test(value)) throw new Error('invalid inspection identity')
  return value
}

export const parse_inspection_request = (packet: Readonly<Record<string, unknown>>) => {
  if (!Number.isSafeInteger(packet.id) || (packet.id as number) < 0) throw new Error('invalid inspection id')
  const id = packet.id as number
  if (packet.query === null) return { type: 'packet/inspection_request' as const, id, query: null }
  if (typeof packet.query !== 'object') throw new Error('invalid inspection query')
  const query = packet.query as Record<string, unknown>
  const address = parse_address(query.address)
  switch (query.kind) {
    case 'profile':
      return {
        type: 'packet/inspection_request' as const,
        id,
        query: { kind: 'profile' as const, address, after: query.after === null ? null : parse_address(query.after) },
      }
    case 'equipment':
      return {
        type: 'packet/inspection_request' as const,
        id,
        query: { kind: 'equipment' as const, address, character_id: parse_address(query.character_id) },
      }
    default:
      throw new Error('invalid inspection selection')
  }
}
