// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE PARTY STREAM. state.party arms it: set by the embody read, then kept true by the
// membership mirror on the self stream (action/party). The delta mounts the party's two
// channels — evt:party (other members' chain facts) and chat:party (the mesh) — and pushes
// the full party row on arm; PartyLeft for the OWN character disarms via the mirror.

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
    if (action.type === 'action/party') return { ...state, party: action.party }
    if (action.type === 'close') return state.party ? { ...state, party: null } : state
    return state
  },

  observe: ({ pubsub, graph, events, send, address, signal }) => {
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

    const push_party = (party: string) =>
      get_party(graph, { party_id: party })
        .then(([row]) => {
          if (!row) return
          const { id, members } = row as unknown as {
            id: string
            members: { order: number; id: string; name: string }[]
          }
          send({
            type: 'packet/party',
            party: {
              id,
              members: members.map((member) => ({ character_id: member.id, name: member.name, order: member.order })),
            } satisfies PartyRow,
          })
        })
        .catch((error: Error) => log.warn({ party, error: error.message }, 'party read failed'))

    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      if (state.party === previous.party) return
      if (previous.party) {
        unwatch(channels.party(previous.party))
        unwatch(mesh.chat_party(previous.party))
      }
      if (!state.party) {
        send({ type: 'packet/party', party: null })
        return
      }
      watch(channels.party(state.party), forward_party_event as (payload: never) => void)
      watch(mesh.chat_party(state.party), forward_party_chat as (payload: never) => void)
      void push_party(state.party)
    })

    signal.addEventListener('abort', () => {
      for (const channel of watched()) unwatch(channel)
    })
  },
} satisfies PlayerModule
