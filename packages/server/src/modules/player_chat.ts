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

export default {
  name: 'player_chat',
  observe: ({ pubsub, events, send, address, get_state, signal }) => {
    /** the flood clock — validation bookkeeping, one law for all three doors */
    const clock = { last_ms: 0 }
    const watched = new Map<string, (payload: never) => void>()

    const watch = (channel: string, forward: (payload: never) => void) => {
      if (watched.has(channel)) return
      watched.set(channel, forward)
      pubsub.emitter.on(channel, forward as (payload: unknown) => void)
      void pubsub.subscribe(channel)
    }
    const unwatch = (channel: string) => {
      const forward = watched.get(channel)
      if (!forward) return
      watched.delete(channel)
      pubsub.emitter.off(channel, forward as (payload: unknown) => void)
      void pubsub.unsubscribe(channel)
    }

    const flood_gated = (): boolean => {
      const now = Date.now()
      if (now - clock.last_ms < CHAT_MIN_INTERVAL_MS) {
        send({ type: 'packet/error', reason: 'chat too fast' })
        return true
      }
      clock.last_ms = now
      return false
    }

    events.on('packet/chat', ({ text }: Extract<PlayerAction, { type: 'packet/chat' }>) => {
      const { character } = get_state()
      if (!character) return // chat before embody is noise
      if (flood_gated()) return
      void pubsub.publish(mesh.chat_world(character.world), { address, character: character.name, text })
    })

    events.on('packet/chat_party', ({ text }: Extract<PlayerAction, { type: 'packet/chat_party' }>) => {
      const { character, party } = get_state()
      if (!character) return
      if (!party) {
        send({ type: 'packet/error', reason: 'no party' })
        return
      }
      if (flood_gated()) return
      void pubsub.publish(mesh.chat_party(party), { address, character: character.name, text })
    })

    events.on('packet/chat_whisper', ({ to, text }: Extract<PlayerAction, { type: 'packet/chat_whisper' }>) => {
      const { character } = get_state()
      if (!character) return
      if (flood_gated()) return
      void pubsub.publish(mesh.chat_user(to), { address, character: character.name, text })
    })

    const forward_world_chat = (fact: ChatFact) => {
      if (fact.address === address) return // never echo the speaker to himself
      send({
        type: 'packet/chat_message',
        channel: 'world',
        from: fact.address,
        character: fact.character,
        text: fact.text,
      })
    }

    // the world's chat room follows the embodied world — armed off the state delta
    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      const before = previous.character?.world ?? null
      const current = state.character?.world ?? null
      if (before === current) return
      if (before) unwatch(mesh.chat_world(before))
      if (current) watch(mesh.chat_world(current), forward_world_chat as (payload: never) => void)
    })

    // the standing whisper door — the one chat channel that exists before any embody
    const forward_whisper = (fact: ChatFact) => {
      send({
        type: 'packet/chat_message',
        channel: 'whisper',
        from: fact.address,
        character: fact.character,
        text: fact.text,
      })
    }
    watch(mesh.chat_user(address), forward_whisper as (payload: never) => void)

    signal.addEventListener('abort', () => {
      for (const channel of [...watched.keys()]) unwatch(channel)
    })
  },
} satisfies PlayerModule
