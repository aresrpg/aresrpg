// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type {
  AgentPairingIdentity,
  AgentStatus,
  CharacterRow,
  InventoryPacket,
  ClientPacket,
  FightStateRow,
  FightResolutionRow,
  TradeRow,
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
import type { AppInput, SiteContext } from '../store.ts'

export type AgentInventoryView = InventoryProjection &
  Readonly<{
    serial: number
    phase: 'idle' | 'loading' | 'ready' | 'failed'
    characters: readonly CharacterRow[]
    fights: Readonly<Record<string, FightStateRow>>
    resolutions: readonly FightResolutionRow[]
    /** Trades of this account: with its own listings, what locks items of the bag. */
    trades: readonly TradeRow[]
    catalogue: CatalogueProjection
    /** What the account's own hosted bot last said about itself; null until it speaks. */
    status: AgentStatus | null
    sui_balance_mist: bigint | null
    kares_balance: bigint | null
    /** The game account's heroes on their way to this bot: each one's card waits and offers no other action. */
    sending: readonly string[]
  }>
export type AgentInventoryViewInput = Readonly<
  | { type: 'agent/inventory_refresh' }
  | { type: 'agent/character_sending'; character_id: string; sending: boolean }
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
  trades: [],
  catalogue: { listings: [], own_listings: [], catalogues: {}, departures: {} },
  status: null,
  sui_balance_mist: null,
  kares_balance: null,
  sending: [],
})
const inventory_identity = (pairing: AgentPairingIdentity | null) =>
  pairing && [pairing.address, pairing.multisig_public_key, pairing.signer_mode]
export const same_inventory_pairing = (left: AgentPairingIdentity | null, right: AgentPairingIdentity | null) =>
  JSON.stringify(inventory_identity(left)) === JSON.stringify(inventory_identity(right))

/** Whether a transfer the owner started still speaks for the owner: the same signed-in wallet and the same bot. Leaving
 * the view that started it does not end it, so the visitor may move on while it runs; another account or bot does. */
export const transfer_current = (
  wallet: AuthSession | null,
  pairing: AgentPairingIdentity | null,
  started_wallet: AuthSession,
  started_pairing: AgentPairingIdentity
): boolean => wallet === started_wallet && same_inventory_pairing(pairing, started_pairing)

type Observed<K extends InventoryPacket['type']> = (
  view: AgentInventoryView,
  packet: Readonly<Extract<InventoryPacket, { type: K }>>,
  address: string
) => AgentInventoryView
/** One fold per packet of the observed account; the last packet of a snapshot is its inventory. */
const OBSERVED: { readonly [K in InventoryPacket['type']]: Observed<K> } = {
  'packet/inventory': (view, { items }) => ({ ...view, inventory: fold_inventory(view, items), phase: 'ready' }),
  // A pushed snapshot of an account already read keeps it readable while its packets arrive.
  'packet/characters': (view, { characters }) => ({
    ...view,
    phase: view.phase === 'ready' ? 'ready' : 'loading',
    characters,
  }),
  'packet/fight_state': (view, { fight, state }) => ({ ...view, fights: { ...view.fights, [fight]: state } }),
  'packet/fight_resolutions': (view, { resolutions }) => ({ ...view, resolutions }),
  'packet/listings': (view, packet, address) => ({
    ...view,
    catalogue: fold_catalogue(view.catalogue, packet, true, address),
  }),
  'packet/trades': (view, { trades }) => ({ ...view, trades }),
  'packet/item_updated': (view, packet) => ({ ...view, ...fold_item_packet(view, packet) }),
  'packet/item_removed': (view, packet) => ({ ...view, ...fold_item_packet(view, packet) }),
  'packet/agent_status': (view, { status }) => ({ ...view, status }),
}
const fold_observed_packet = (
  view: AgentInventoryView,
  packet: Readonly<InventoryPacket> | null,
  address: string
): AgentInventoryView =>
  packet
    ? (OBSERVED[packet.type] as Observed<InventoryPacket['type']>)(view, packet, address)
    : { ...view, phase: 'failed' }
const fold_inventory_input = (
  view: AgentInventoryView,
  session: SessionState,
  pairing: AgentPairingIdentity,
  input: AppInput
): AgentInventoryView => {
  switch (input.type) {
    case 'agent/inventory_refresh':
      return { ...view, serial: view.serial + 1, phase: 'loading' }
    case 'agent/character_sending': {
      const others = view.sending.filter((id) => id !== input.character_id)
      return { ...view, sending: input.sending ? [...others, input.character_id] : others }
    }
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
  // A bot's bag belongs to an account: a link without one (the site's public stage) observes none.
  if (session.link_status !== 'ready' || !session.wallet) return null
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
  Pick<SiteContext, 'events' | 'dispatch'> & {
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
