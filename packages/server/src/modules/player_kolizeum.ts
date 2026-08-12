// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE KOLIZEUM STREAM — the matchmaking board's two beacons, forwarded to everyone connected:
// a lobby opening (the board changed) and a payout (someone's crank paid a winner).

import { channels, type EventEnvelope } from '../protocol.ts'
import type { PlayerModule } from '../player.ts'

export default {
  name: 'player_kolizeum',
  observe: ({ pubsub, send, signal }) => {
    const forward = (payload: EventEnvelope) => {
      if (payload.type === 'KolizeumCreated') {
        const { kolizeum, fight, pledge, format } = payload.data as {
          kolizeum: string
          fight: string
          pledge: string
          format: string
        }
        send({ type: 'packet/kolizeum_created', kolizeum, fight, pledge, format })
      }
      if (payload.type === 'KolizeumPaid') {
        const { kolizeum, winner, amount } = payload.data as { kolizeum: string; winner: string; amount: string }
        send({ type: 'packet/kolizeum_paid', kolizeum, winner, amount })
      }
    }
    pubsub.emitter.on(channels.kolizeum, forward as (payload: unknown) => void)
    void pubsub.subscribe(channels.kolizeum)
    signal.addEventListener('abort', () => {
      pubsub.emitter.off(channels.kolizeum, forward as (payload: unknown) => void)
      void pubsub.unsubscribe(channels.kolizeum)
    })
  },
} satisfies PlayerModule
