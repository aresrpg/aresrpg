// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { ServerPacket } from '@aresrpg/protocol'

import type { ServerLink } from '../server_link.ts'
import type { AppInput, AppState } from '../store.ts'

export type MarketFloor = Readonly<{
  item_type: string
  request_id: number | null
  status: 'loading' | 'ready' | 'unavailable'
  prices: Readonly<Record<string, string>>
}>
export type MarketFloorInput =
  | Readonly<{ type: 'market/floor_selected'; item_type: string | null }>
  | Readonly<{ type: 'market/floor_requested'; id: number }>

const fold_floor_packet = (floor: MarketFloor, packet: Readonly<ServerPacket>): MarketFloor => {
  if (!('id' in packet) || packet.id !== floor.request_id || floor.status !== 'loading') return floor
  if (packet.type === 'packet/error') return { ...floor, status: 'unavailable' }
  if (packet.type === 'packet/market_floor') return { ...floor, status: 'ready', prices: packet.prices }
  return floor
}

const LOST_LINK_INPUTS: readonly string[] = ['link/failed', 'link/replaced', 'link/violation']

export const fold_market_floor = (floor: MarketFloor | null, input: AppInput): MarketFloor | null => {
  if (input.type === 'market/floor_selected')
    return input.item_type ? { item_type: input.item_type, request_id: null, status: 'loading', prices: {} } : null
  if (!floor) return floor
  if (LOST_LINK_INPUTS.includes(input.type)) return { ...floor, status: 'unavailable' }
  switch (input.type) {
    case 'market/floor_requested':
      return { ...floor, request_id: input.id }
    case 'server/packet':
      return fold_floor_packet(floor, input.packet)
    default:
      return floor
  }
}

export const reduce_market_floor = (state: AppState, input: AppInput): AppState => {
  const floor = fold_market_floor(state.marketplace.floor, input)
  return floor === state.marketplace.floor ? state : { ...state, marketplace: { ...state.marketplace, floor } }
}

/** One read per dialog opening; quantity changes only select from its four existing paid lots. */
export const send_market_floor_request = ({
  state,
  link,
  dispatch,
  next_id,
}: Readonly<{
  state: AppState
  link: ServerLink | null
  dispatch: (input: AppInput) => void
  next_id: () => number
}>): void => {
  const { floor } = state.marketplace
  if (!floor || floor.status !== 'loading' || floor.request_id !== null) return
  const id = next_id()
  dispatch({ type: 'market/floor_requested', id })
  if (!link?.send({ type: 'packet/market_floor_request', id, item_type: floor.item_type }))
    dispatch({ type: 'server/packet', packet: { type: 'packet/error', id, reason: 'market floor unavailable' } })
}
