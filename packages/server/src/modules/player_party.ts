// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE PARTY STREAM. Every tracked character carries its own membership; the connection watches
// the union of those parties and shares subscriptions when two characters belong to one.

import type { PartyRow } from '@aresrpg/protocol'

import { channels, mesh, type EventEnvelope, type ChatFact } from '../protocol.ts'
import { get_party } from '../reads/get_party.ts'
import logger from '../logger.ts'
import type { PlayerModule, PlayerState } from '../player.ts'
import { create_watcher } from '../pubsub_bus.ts'

const log = logger(import.meta)

export default {
  name: 'player_party',

  reduce: (state, action) => {
    if (action.type === 'action/party') {
      const tracked = state.characters[action.character_id]
      if (!tracked) return state
      return {
        ...state,
        characters: {
          ...state.characters,
          [action.character_id]: { ...tracked, party: action.party },
        },
      }
    }
    return state
  },

  observe: ({ pubsub, graph, events, send, address, signal, get_state }) => {
    const { watch, unwatch, watched } = create_watcher(pubsub)

    const forward_party_event = (payload: EventEnvelope) => {
      if (payload.type === 'PartyJoined' || payload.type === 'PartyLeft') {
        const { party, character } = payload.data as { party: string; character: string }
        if (payload.type === 'PartyJoined') send({ type: 'packet/party_joined', party, character })
        else send({ type: 'packet/party_left', party, character })
      }
    }

    const forward_party_chat = (fact: ChatFact) => {
      if (fact.address === address) return
      send({
        type: 'packet/chat_message',
        channel: 'party',
        from: fact.address,
        character: fact.character,
        text: fact.text,
      })
    }

    const push_party = (character_id: string, party: string) =>
      get_party(graph, { party_id: party })
        .then(([row]) => {
          if (!row) return
          const { id, members } = row as unknown as {
            id: string
            members: { order: number; id: string; name: string }[]
          }
          send({
            type: 'packet/party',
            character_id,
            party: {
              id,
              members: members.map((member) => ({ character_id: member.id, name: member.name, order: member.order })),
            } satisfies PartyRow,
          })
        })
        .catch((error: Error) => log.warn({ party, error: error.message }, 'party read failed'))

    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      const before_parties = new Set(Object.values(previous.characters).flatMap(({ party }) => (party ? [party] : [])))
      const current_parties = new Set(Object.values(state.characters).flatMap(({ party }) => (party ? [party] : [])))
      before_parties.forEach((party) => {
        if (current_parties.has(party)) return
        unwatch(channels.party(party))
        unwatch(mesh.chat_party(party))
      })
      current_parties.forEach((party) => {
        if (before_parties.has(party)) return
        void Promise.all([
          watch(channels.party(party), forward_party_event as (payload: never) => void),
          watch(mesh.chat_party(party), forward_party_chat as (payload: never) => void),
        ]).catch((error: Error) => log.warn({ party, error: error.message }, 'party watch failed'))
      })
      Object.entries(state.characters).forEach(([character_id, tracked]) => {
        if (previous.characters[character_id]?.party === tracked.party) return
        if (!tracked.party) send({ type: 'packet/party', character_id, party: null })
        else
          void Promise.all([
            watch(channels.party(tracked.party), forward_party_event as (payload: never) => void),
            watch(mesh.chat_party(tracked.party), forward_party_chat as (payload: never) => void),
          ])
            .then(() => {
              if (get_state().characters[character_id]?.party === tracked.party)
                return push_party(character_id, tracked.party!)
            })
            .catch((error: Error) => log.warn({ party: tracked.party, error: error.message }, 'party watch failed'))
      })
    })

    signal.addEventListener('abort', () => {
      for (const channel of watched()) unwatch(channel)
    })
  },
} satisfies PlayerModule
