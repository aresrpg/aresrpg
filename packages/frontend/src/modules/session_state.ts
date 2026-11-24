// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ServerPacket } from '@aresrpg/protocol'
import { fold_inventory, fold_item_packet, is_item_packet } from '@aresrpg/protocol/inventory'

import { initial_owner_connection } from '../agents/owner_state.ts'
import { initial_agent_inventory } from '../agents/inventory_state.ts'
import { initial_agent_view } from '../agents/observation.ts'
import { read_selected_character } from '../auth_storage.ts'
import type { AppInput } from '../store.ts'

import { with_character_roster } from './character_roster.ts'
import type { SessionState } from './session.ts'

export const initial_session_state = (serial = 0): SessionState =>
  Object.freeze({
    agent_connection: initial_owner_connection(),
    agent_view: { ...initial_agent_view(), serial },
    agent_inventory: initial_agent_inventory(serial),
    agent_pairing_candidate: null,
    inventory_pairing: null,
    character_creation: null,
    sign_in: Object.freeze({ status: 'idle', error: null }),
    link_status: 'idle',
    link_error: null,
    link_violation: null,
    latency_ms: null,
    indexing_lag: null,
    current_epoch: null,
    game_frozen: null,
    roster_loaded: false,
    craft_result: null,
    consumption_result: null,
    characters: [],
    deleted_character_ids: [],
    inventory: [],
    removed_item_versions: {},
    claims: [],
    redeemed_claims: [],
    giftcards: [],
    redeemed_giftcards: [],
    selected_character_id: read_selected_character(),
    online: null,
    online_characters: null,
    online_agents: null,
    after_sign_out: undefined,
    wallets: null,
    wallet: null,
    sui_balance_mist: null,
    kares_balance: null,
    gas_spent_mist: 0n,
  })
/** What the account's own receipts change in its bag and its giftcards. */
export const fold_inventory_input = (session: SessionState, input: AppInput): SessionState => {
  if (input.type === 'inventory/amounts_changed')
    return input.changes.reduce((session, change) => {
      if (change.amount === 0)
        return {
          ...session,
          ...fold_item_packet(session, { type: 'packet/item_removed', item: change.id, version: change.version }),
        }
      const item = session.inventory.find(({ id }) => id === change.id)
      return item
        ? {
            ...session,
            ...fold_item_packet(session, {
              type: 'packet/item_updated',
              item: { ...item, amount: change.amount, version: change.version },
            }),
          }
        : session
    }, session)
  if (input.type === 'giftcard/received')
    return session.redeemed_giftcards.includes(input.giftcard.id) ||
      session.giftcards.some(({ id }) => id === input.giftcard.id)
      ? session
      : Object.freeze({ ...session, giftcards: Object.freeze([...session.giftcards, input.giftcard]) })
  if (input.type === 'giftcard/redeemed')
    return Object.freeze({
      ...session,
      redeemed_giftcards: [...session.redeemed_giftcards, input.giftcard],
      giftcards: session.giftcards.filter(({ id }) => id !== input.giftcard),
    })
  return session
}
/** What the server says of the account: its roster, its bag, its claims and the server's own state. */
export const fold_session_packet = (session: SessionState, packet: Readonly<ServerPacket>): SessionState => {
  if (packet.type === 'packet/characters') {
    return Object.freeze({
      ...with_character_roster(session, packet.characters),
      roster_loaded: true,
      link_status: 'ready',
      link_error: null,
    })
  }
  if (packet.type === 'packet/server_info')
    return Object.freeze({
      ...session,
      online: packet.online,
      online_characters: packet.online_characters,
      online_agents: packet.online_agents,
      indexing_lag: packet.indexing_lag,
      current_epoch: packet.current_epoch,
    })
  if (packet.type === 'packet/game_state') return Object.freeze({ ...session, game_frozen: packet.frozen })
  if (packet.type === 'packet/inventory')
    return Object.freeze({ ...session, inventory: fold_inventory(session, packet.items) })
  if (is_item_packet(packet)) return Object.freeze({ ...session, ...fold_item_packet(session, packet) })
  if (packet.type === 'packet/claims')
    return Object.freeze({
      ...session,
      claims: packet.claims.filter(({ id }) => !session.redeemed_claims.includes(id)),
    })
  if (packet.type === 'packet/giftcards')
    return Object.freeze({
      ...session,
      giftcards: packet.giftcards.filter(({ id }) => !session.redeemed_giftcards.includes(id)),
    })
  if (packet.type === 'packet/error')
    return packet.id === undefined ? Object.freeze({ ...session, link_error: packet.reason }) : session
  return session
}
