// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE SELF STREAM (push model): the SERVER decides what a connection watches — never the client.
// Two standing watches, both "facts targeting ME that my own transactions did not cause":
//   evt:social:<address>   — friend facts (trade births ride the same channel, in player_trade),
//   evt:character:<id>     — the EMBODIED character's own chain channel (mounted on the state
//                            delta): party invites, the party-membership mirror, fight seats,
//                            and own visible-slot equips folding back into presence truth.
// Envelopes forward as shaped packets or re-enter as internal actions, never raw.

import { VISIBLE_SLOTS, type VisibleSlot } from '@aresrpg/protocol'

import type { EventEnvelope } from '../protocol.ts'
import { get_characters } from '../reads/get_characters.ts'
import { get_item } from '../reads/get_item.ts'
import logger from '../logger.ts'
import type { PlayerModule, PlayerState } from '../player.ts'

const log = logger(import.meta)

const is_visible_slot = (slot: string): slot is VisibleSlot => (VISIBLE_SLOTS as readonly string[]).includes(slot)

export default {
  name: 'player_events',
  observe: (context) => {
    const { pubsub, graph, send, channels, address, events, signal, dispatch } = context
    const listeners = new Map<string, (payload: EventEnvelope) => void>()

    const watch = (channel: string, forward: (payload: EventEnvelope) => void) => {
      if (listeners.has(channel)) return
      listeners.set(channel, forward)
      pubsub.emitter.on(channel, forward)
      void pubsub.subscribe(channel)
    }
    const unwatch = (channel: string) => {
      const listener = listeners.get(channel)
      if (!listener) return
      listeners.delete(channel)
      pubsub.emitter.off(channel, listener)
      void pubsub.unsubscribe(channel)
    }

    // the player's own social channel — friend facts + exclusive offers, as REAL packets
    watch(channels.social(address), (payload) => {
      if (payload.type === 'FriendAdded' || payload.type === 'FriendRemoved') {
        const { list, who } = payload.data as { list: string; who: string }
        if (payload.type === 'FriendAdded') send({ type: 'packet/friend_added', list, who })
        else send({ type: 'packet/friend_removed', list, who })
      }
      // a created character is chain-initialized state the receipt cannot carry — the
      // server streams the fresh roster the moment the indexer projects it
      if (payload.type === 'CharacterCreated') {
        void get_characters(graph, { address })
          .then((characters) => send({ type: 'packet/characters', characters }))
          .catch((error) => log.error({ address, error: (error as Error).message }, 'roster refresh failed'))
      }
    })

    /** The embodied character's OWN chain channel — self facts re-enter as actions. */
    const forward_self = (payload: EventEnvelope) => {
      if (payload.type === 'PartyInvited') {
        const { party, character } = payload.data as { party: string; character: string }
        send({ type: 'packet/party_invited', party, character })
      }
      if (payload.type === 'PartyJoined') {
        const { party } = payload.data as { party: string }
        dispatch({ type: 'action/party', party })
      }
      if (payload.type === 'PartyLeft') dispatch({ type: 'action/party', party: null })
      if (payload.type === 'FighterJoined') {
        const { fight } = payload.data as { fight: string }
        dispatch({ type: 'action/fight', fight })
      }
      if (payload.type === 'ItemEquipped' || payload.type === 'ItemUnequipped') {
        const { slot, item } = payload.data as { slot: string; item: string }
        if (!is_visible_slot(slot)) return
        if (payload.type === 'ItemUnequipped') {
          dispatch({ type: 'action/equip', slot, item_type: null })
          return
        }
        get_item(graph, { id: item })
          .then((row) => {
            if (row) dispatch({ type: 'action/equip', slot, item_type: row.item_type })
          })
          .catch((error: Error) => log.warn({ item, error: error.message }, 'own equip enrichment failed'))
      }
    }

    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      const before = previous.character?.character_id ?? null
      const current = state.character?.character_id ?? null
      if (before === current) return
      if (before) unwatch(channels.character(before))
      if (current) watch(channels.character(current), forward_self)
    })

    signal.addEventListener('abort', () => {
      for (const channel of [...listeners.keys()]) unwatch(channel)
    })
  },
} satisfies PlayerModule
