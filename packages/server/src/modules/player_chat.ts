// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CHAT — pure off-chain ephemera, published on the mesh and never stored. Three doors:
//   world   — heard by everyone standing in the same world (owner 2026-08-12),
//   party   — network-wide on the party's chat channel (the party module owns the inbound watch),
//   whisper — network-wide on the target address's chat door (watched here, standing).
// The flood gate is one shared clock across all three doors; the parse door already bounded
// length and emptiness. A refusal answers honestly — no silent drops.

import { CHAT_MIN_INTERVAL_MS } from '@aresrpg/protocol'

import { mesh, type ChatFact } from '../protocol.ts'
import type { PlayerModule, PlayerAction, PlayerState } from '../player.ts'
import { create_watcher } from '../pubsub_bus.ts'

export default {
  name: 'player_chat',
  observe: ({ pubsub, events, send, address, get_state, signal }) => {
    /** the flood clock — validation bookkeeping, one law for all three doors */
    const clock = { last_ms: 0 }
    const { watch, unwatch, watched } = create_watcher(pubsub)

    const flood_gated = (): boolean => {
      const now = Date.now()
      if (now - clock.last_ms < CHAT_MIN_INTERVAL_MS) {
        send({ type: 'packet/error', reason: 'chat too fast' })
        return true
      }
      clock.last_ms = now
      return false
    }

    events.on('packet/chat', ({ character_id, text }: Extract<PlayerAction, { type: 'packet/chat' }>) => {
      const character = get_state().characters[character_id]?.presence
      if (!character) return
      if (flood_gated()) return
      void pubsub.mesh.publish(mesh.chat_world(character.world), { address, character: character.name, text })
    })

    events.on('packet/chat_party', ({ character_id, text }: Extract<PlayerAction, { type: 'packet/chat_party' }>) => {
      const tracked = get_state().characters[character_id]
      if (!tracked) return
      const { presence: character, party } = tracked
      if (!party) {
        send({ type: 'packet/error', reason: 'no party' })
        return
      }
      if (flood_gated()) return
      void pubsub.mesh.publish(mesh.chat_party(party), { address, character: character.name, text })
    })

    events.on(
      'packet/chat_whisper',
      ({ character_id, to, text }: Extract<PlayerAction, { type: 'packet/chat_whisper' }>) => {
        const character = get_state().characters[character_id]?.presence
        if (!character) return
        if (flood_gated()) return
        void pubsub.mesh.publish(mesh.chat_user(to), { address, character: character.name, text })
      }
    )

    const forward_world_chat = (fact: ChatFact) => {
      if (fact.address === address) return // never echo the speaker to himself
      send({
        type: 'packet/chat_message',
        channel: 'world',
        scope: null,
        from: fact.address,
        character: fact.character,
        text: fact.text,
      })
    }

    // One connection hears every world occupied by one of its characters.
    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      const before = new Set(Object.values(previous.characters).map(({ presence }) => presence.world))
      const current = new Set(Object.values(state.characters).map(({ presence }) => presence.world))
      before.forEach((world) => {
        if (!current.has(world)) unwatch(mesh.chat_world(world))
      })
      current.forEach((world) => {
        if (!before.has(world)) watch(mesh.chat_world(world), forward_world_chat as (payload: never) => void)
      })
    })

    // the standing whisper door — the one chat channel that exists before any embody
    const forward_whisper = (fact: ChatFact) => {
      send({
        type: 'packet/chat_message',
        channel: 'whisper',
        scope: null,
        from: fact.address,
        character: fact.character,
        text: fact.text,
      })
    }
    watch(mesh.chat_user(address), forward_whisper as (payload: never) => void)

    signal.addEventListener('abort', () => {
      for (const channel of watched()) unwatch(channel)
    })
  },
} satisfies PlayerModule
