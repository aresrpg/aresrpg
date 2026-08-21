// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DUEL HANDSHAKE — pure off-chain relay, chat-shaped: the chain's challenge door has no target
// concept, so invite/accept/decline ride the target address's own mesh door. Identity is
// socket-derived (never client-claimed); the standing watch mirrors the whisper door. The relay
// carries INTENT ONLY — the fight itself reaches the acceptor as the indexer's own zone fact
// (2026-08-21), never as an object id a peer claimed.

import { CHAT_MIN_INTERVAL_MS } from '@aresrpg/protocol'

import { mesh, type DuelFact } from '../protocol.ts'
import type { PlayerModule, PlayerAction } from '../player.ts'
import { create_watcher } from '../pubsub_bus.ts'

export default {
  name: 'player_duel',
  observe: ({ pubsub, events, send, address, get_state, signal }) => {
    const clock = { last_ms: 0 }
    const { watch, unwatch, watched } = create_watcher(pubsub)

    const flood_gated = (): boolean => {
      const now = Date.now()
      if (now - clock.last_ms < CHAT_MIN_INTERVAL_MS) {
        send({ type: 'packet/error', reason: 'duel signals too fast' })
        return true
      }
      clock.last_ms = now
      return false
    }

    events.on('packet/duel', ({ to, kind }: Extract<PlayerAction, { type: 'packet/duel' }>) => {
      const { character } = get_state()
      if (!character) return // dueling before embody is noise
      if (flood_gated()) return
      const fact: DuelFact = { address, character: character.name, kind }
      void pubsub.mesh.publish(mesh.duel(to), fact)
    })

    // the standing duel door — like the whisper door, it exists before any embody
    const forward_duel = (fact: DuelFact) => {
      if (fact.address === address) return // never echo the sender to himself
      send({ type: 'packet/duel', from: fact.address, character: fact.character, kind: fact.kind })
    }
    watch(mesh.duel(address), forward_duel as (payload: never) => void)

    signal.addEventListener('abort', () => {
      for (const channel of watched()) unwatch(channel)
    })
  },
} satisfies PlayerModule
