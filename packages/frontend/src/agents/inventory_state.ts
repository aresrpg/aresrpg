// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type {
  AgentPairingIdentity,
  CharacterRow,
  InventoryPacket,
  ClientPacket,
  FightStateRow,
  FightResolutionRow,
} from '@aresrpg/protocol'
import {
  fold_inventory,
  fold_item_packet,
  fold_catalogue,
  type InventoryProjection,
  type CatalogueProjection,
} from '@aresrpg/protocol/inventory'

import type { AuthSession } from '../auth.ts'
import type { SessionState } from '../modules/session.ts'
import type { AppInput, AppModule } from '../store.ts'

export type AgentInventoryView = InventoryProjection &
  Readonly<{
    serial: number
    phase: 'idle' | 'loading' | 'ready' | 'failed'
    characters: readonly CharacterRow[]
    fights: Readonly<Record<string, FightStateRow>>
    resolutions: readonly FightResolutionRow[]
    catalogue: CatalogueProjection
    sui_balance_mist: bigint | null
    kares_balance: bigint | null
  }>
export type AgentInventoryViewInput = Readonly<
  | { type: 'agent/inventory_refresh' }
  | {
      type: 'agent/inventory_balances'
      wallet: AuthSession
      pairing: AgentPairingIdentity
      sui_balance_mist: bigint
      kares_balance: bigint | null
    }
>
export const initial_agent_inventory = (serial = 0): AgentInventoryView => ({
  serial,
  phase: 'idle',
  inventory: [],
  removed_item_versions: {},
  characters: [],
  fights: {},
  resolutions: [],
  catalogue: { listings: [], own_listings: [], catalogues: {}, departures: {} },
  sui_balance_mist: null,
  kares_balance: null,
})
const inventory_identity = (pairing: AgentPairingIdentity | null) =>
  pairing && [pairing.address, pairing.multisig_public_key, pairing.signer_mode]
export const same_inventory_pairing = (left: AgentPairingIdentity | null, right: AgentPairingIdentity | null) =>
  JSON.stringify(inventory_identity(left)) === JSON.stringify(inventory_identity(right))

const fold_observed_packet = (
  view: AgentInventoryView,
  packet: Readonly<InventoryPacket> | null,
  address: string
): AgentInventoryView => {
  if (!packet) return { ...view, phase: 'failed' }
  switch (packet.type) {
    case 'packet/inventory':
      return { ...view, inventory: fold_inventory(view, packet.items), phase: 'ready' }
    case 'packet/characters':
      return { ...view, phase: 'loading', characters: packet.characters }
    case 'packet/fight_state':
      return { ...view, fights: { ...view.fights, [packet.fight]: packet.state } }
    case 'packet/fight_resolutions':
      return { ...view, resolutions: packet.resolutions }
    case 'packet/listings':
      return { ...view, catalogue: fold_catalogue(view.catalogue, packet, true, address) }
    case 'packet/item_updated':
    case 'packet/item_removed':
      return { ...view, ...fold_item_packet(view, packet) }
  }
}
const fold_inventory_input = (
  view: AgentInventoryView,
  session: SessionState,
  pairing: AgentPairingIdentity,
  input: AppInput
): AgentInventoryView => {
  switch (input.type) {
    case 'agent/inventory_refresh':
      return { ...view, serial: view.serial + 1, phase: 'loading' }
    case 'agent/inventory_balances':
      if (![input.wallet === session.wallet, same_inventory_pairing(input.pairing, pairing)].every(Boolean)) return view
      return { ...view, sui_balance_mist: input.sui_balance_mist, kares_balance: input.kares_balance }
    case 'server/packet':
      if (input.packet.type !== 'packet/inventory_observed') return view
      return input.packet.id === view.serial ? fold_observed_packet(view, input.packet.packet, pairing.address) : view
    default:
      return view
  }
}

/** Reuse the player's inventory and catalogue folds inside one selected read-only account scope. */
export const fold_agent_inventory = (session: SessionState, previous: SessionState, input: AppInput): SessionState => {
  const { inventory_pairing: pairing } = session
  const changed = session.wallet !== previous.wallet || !same_inventory_pairing(pairing, previous.inventory_pairing)
  const initial = changed
    ? {
        ...initial_agent_inventory(session.agent_inventory.serial + 1),
        phase: pairing ? ('loading' as const) : ('idle' as const),
      }
    : session.agent_inventory
  const view = pairing ? fold_inventory_input(initial, session, pairing, input) : initial
  return view === session.agent_inventory ? session : { ...session, agent_inventory: view }
}

export const inventory_subscription = (session: SessionState, previous: SessionState) => {
  if (session.link_status !== 'ready') return null
  if (session.agent_inventory.serial === previous.agent_inventory.serial && previous.link_status === 'ready')
    return null
  return { id: session.agent_inventory.serial, pairing: session.inventory_pairing }
}

const read_inventory_observation = (wallet: AuthSession | null, pairing: AgentPairingIdentity | null) => {
  if (!pairing) return null
  const request = wallet?.read_agent_pairing_request?.(crypto.randomUUID())
  if (!request) throw new Error('Agent inventory identity is unavailable.')
  return { pairing, public_identifier: request.zklogin_public_identifier, character_id: null }
}

/** The session's existing transport and balance lifetime carry this read-only account subscription. */
export const observe_inventory_subscription = ({
  events,
  dispatch,
  send,
  refresh_balances,
}: Readonly<
  Pick<Parameters<NonNullable<AppModule['observe']>>[0], 'events' | 'dispatch'> & {
    send: (packet: Readonly<ClientPacket>) => void
    refresh_balances: () => void
  }
>) => {
  events.on('STATE_UPDATED', (next, previous) => {
    if (next.session.agent_inventory.serial !== previous.session.agent_inventory.serial) refresh_balances()
    const request = inventory_subscription(next.session, previous.session)
    if (!request) return
    const { id, pairing } = request
    try {
      send({
        type: 'packet/inventory_observe',
        id,
        observation: read_inventory_observation(next.session.wallet, pairing),
      })
    } catch (error) {
      console.warn('Agent inventory subscription failed.', error)
      dispatch({ type: 'server/packet', packet: { type: 'packet/inventory_observed', id, packet: null } })
    }
  })
}
