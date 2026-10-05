// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ClientPacket, EquippedItem, PlayerProfile, ServerPacket } from '@aresrpg/protocol'

export type InspectionState = Readonly<{
  id: number
  target: Readonly<{ address: string; name: string | null }> | null
  cursors: readonly (string | null)[]
  profile: PlayerProfile | null
  selected: string | null
  equipment: readonly EquippedItem[] | null
  status: 'loading' | 'ready' | 'error' | 'missing'
}>
export type InspectionInput =
  | Readonly<{ type: 'leaderboards/inspect'; address: string; name: string | null }>
  | Readonly<{ type: 'leaderboards/inspect_close' }>
  | Readonly<{ type: 'leaderboards/inspect_character'; character_id: string }>
  | Readonly<{ type: 'leaderboards/inspect_page'; direction: 'next' | 'previous' }>

export const initial_inspection = (id = 0): InspectionState => ({
  id,
  target: null,
  cursors: [null],
  profile: null,
  selected: null,
  equipment: null,
  status: 'loading',
})

export const inspection_request = (
  state: InspectionState
): Extract<ClientPacket, { type: 'packet/inspection_request' }> => ({
  type: 'packet/inspection_request',
  id: state.id,
  query: state.target
    ? state.selected
      ? { kind: 'equipment', address: state.target.address, character_id: state.selected }
      : { kind: 'profile', address: state.target.address, after: state.cursors.at(-1) ?? null }
    : null,
})

const change_page = (state: InspectionState, direction: 'next' | 'previous'): InspectionState => {
  if (direction === 'next' && !state.profile?.next) return state
  if (direction === 'previous' && state.cursors.length < 2) return state
  const cursors = direction === 'next' ? [...state.cursors, state.profile!.next] : state.cursors.slice(0, -1)
  return { ...state, id: state.id + 1, cursors, selected: null, profile: null, equipment: null, status: 'loading' }
}

export const reduce_inspection = (state: InspectionState, input: InspectionInput): InspectionState => {
  switch (input.type) {
    case 'leaderboards/inspect':
      return { ...initial_inspection(state.id + 1), target: { address: input.address, name: input.name } }
    case 'leaderboards/inspect_close':
      return initial_inspection(state.id + 1)
    case 'leaderboards/inspect_character':
      if (
        !state.profile?.characters.some(({ id }) => id === input.character_id) ||
        state.selected === input.character_id
      )
        return state
      return { ...state, id: state.id + 1, selected: input.character_id, equipment: null, status: 'loading' }
    case 'leaderboards/inspect_page':
      return change_page(state, input.direction)
  }
}

export const fold_inspection = (state: InspectionState, packet: Readonly<ServerPacket>): InspectionState => {
  if (!state.target || !('id' in packet) || packet.id !== state.id) return state
  switch (packet.type) {
    case 'packet/inspection_error':
      return { ...state, status: 'error' }
    case 'packet/inspection_result': {
      const { result } = packet
      return result.kind === 'profile'
        ? { ...state, profile: result.profile, status: 'ready' }
        : { ...state, equipment: result.equipment, status: result.equipment === null ? 'missing' : 'ready' }
    }
    default:
      return state
  }
}
