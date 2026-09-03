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
import { get_fight_resolutions } from '../reads/get_fight_resolutions.ts'
import { latest_keyed_reader } from '../latest_read.ts'
import logger from '../logger.ts'
import type { PlayerModule, PlayerState } from '../player.ts'
import { create_watcher } from '../pubsub_bus.ts'

const log = logger(import.meta)

const is_visible_slot = (slot: string): slot is VisibleSlot => (VISIBLE_SLOTS as readonly string[]).includes(slot)
const refreshes_roster = (type: string): boolean =>
  ['DungeonEntered', 'DungeonRoomCleared', 'DungeonEnded', 'CharacterTeleported'].includes(type)

export default {
  name: 'player_events',
  observe: (context) => {
    const { pubsub, graph, send, channels, address, events, signal, dispatch } = context
    const { watch, unwatch, watched } = create_watcher(pubsub)
    const read_latest_roster = latest_keyed_reader(
      (owner) => get_characters(graph, { address: owner }),
      (_owner, characters) => {
        dispatch({ type: 'action/character_roster', characters })
        send({ type: 'packet/characters', characters })
      }
    )
    const read_latest_resolutions = latest_keyed_reader(
      (owner) => get_fight_resolutions(graph, { address: owner }),
      (_owner, resolutions) => send({ type: 'packet/fight_resolutions', resolutions })
    )
    const refresh_roster = (): void => {
      void read_latest_roster(address).catch((error) =>
        log.error({ address, error: (error as Error).message }, 'roster refresh failed')
      )
    }
    const refresh_resolutions = (): void => {
      void read_latest_resolutions(address).catch((error) =>
        log.error({ address, error: (error as Error).message }, 'fight resolution refresh failed')
      )
    }

    // the player's own social channel — friend facts + exclusive offers, as REAL packets
    void watch(channels.social(address), (payload: EventEnvelope) => {
      // a created character is chain-initialized state the receipt cannot carry — the
      // server streams the fresh roster the moment the indexer projects it
      if (payload.type === 'CharacterCreated' || payload.type === 'CharacterHeld') {
        refresh_roster()
      }
    }).catch((error: Error) => log.error({ address, error: error.message }, 'social watch failed'))

    /** Every owned character's chain channel stays armed; selection is client presentation. */
    const forward_self = (tracked_character_id: string) => (payload: EventEnvelope) => {
      if (payload.type === 'PartyInvitesChanged')
        dispatch({ type: 'action/party_invites_changed', character_id: tracked_character_id })
      if (payload.type === 'PartyJoined') {
        const { party, character } = payload.data as { party: string; character: string }
        dispatch({ type: 'action/party', character_id: character, party })
      }
      if (payload.type === 'PartyLeft') {
        const { character } = payload.data as { character: string }
        dispatch({ type: 'action/party', character_id: character, party: null })
      }
      // a SEAT is custody, not a join: the indexer publishes it from the projection, so the
      // challenger who took seat 0 at the fight's birth arms the same door as a joiner.
      if (payload.type === 'CharacterSeated') {
        const { fight, character, seat } = payload.data as { fight: string; character: string; seat: number }
        dispatch({ type: 'action/fight', character_id: character, fight, seat })
        // Seating changes custody, and resolve_ambush clears the verdict in the same checkpoint.
        // The roster is the client's one character row for BOTH facts; re-send it from the
        // completed projection instead of leaving a stale kiosk/ambush behind the mounted board.
        refresh_roster()
      }
      // ...and its RETURN: a forfeit or a settle re-locks the character into its kiosk. The
      // roster carries the seat, so a client left holding the old row refuses every custody
      // action it is offered next ("already in a fight", 2026-08-22) — the projection that
      // freed the character is what corrects it.
      if (payload.type === 'CharacterHeld') {
        const { character } = payload.data as { character: string }
        dispatch({ type: 'action/fight', character_id: character, fight: null })
        refresh_roster()
      }
      if (refreshes_roster(payload.type)) refresh_roster()
      if (payload.type === 'FightResolutionChanged' || payload.type === 'CharacterHeld') refresh_resolutions()
      if (payload.type === 'ItemEquipped' || payload.type === 'ItemUnequipped') {
        const { slot, item } = payload.data as { slot: string; item: string }
        if (!is_visible_slot(slot)) return
        if (payload.type === 'ItemUnequipped') {
          dispatch({ type: 'action/equip', character_id: tracked_character_id, slot, item_type: null })
          return
        }
        get_item(graph, { id: item })
          .then((row) => {
            if (row)
              dispatch({ type: 'action/equip', character_id: tracked_character_id, slot, item_type: row.item_type })
          })
          .catch((error: Error) => log.warn({ item, error: error.message }, 'own equip enrichment failed'))
      }
    }

    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      const before = new Set(Object.keys(previous.characters))
      const current = new Set(Object.keys(state.characters))
      before.forEach((character_id) => {
        if (!current.has(character_id)) unwatch(channels.character(character_id))
      })
      current.forEach((character_id) => {
        if (!before.has(character_id))
          void watch(channels.character(character_id), forward_self(character_id) as (payload: never) => void)
            .then(() => {
              refresh_roster()
              refresh_resolutions()
              dispatch({ type: 'action/character_watch_ready', character_id })
            })
            .catch((error: Error) => log.error({ character_id, error: error.message }, 'character watch failed'))
      })
    })

    signal.addEventListener('abort', () => {
      for (const channel of watched()) unwatch(channel)
    })
  },
} satisfies PlayerModule
