// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { LeaderboardObservation } from '@aresrpg/protocol'

import { create_watcher } from '../pubsub_bus.ts'
import { enrich_leaderboard } from '../reads/enrich_leaderboard.ts'
import logger from '../logger.ts'
import { channels } from '../protocol.ts'
import type { PlayerModule, PlayerState } from '../player.ts'

const log = logger(import.meta)
const CHANNEL = channels.leaderboards
const REFRESH_MS = 5_000

export default {
  name: 'player_leaderboards',
  reduce: (state, action) => {
    if (action.type === 'packet/leaderboard_observe') return { ...state, leaderboard_observation: action.observation }
    if (action.type === 'close') return { ...state, leaderboard_observation: null }
    return state
  },
  observe: ({ pubsub, graph, events, send, address, get_state, signal, resolve_name }) => {
    let revision = 0
    let last_started = 0
    let timer: ReturnType<typeof setInterval> | null = null
    const running = new Set<LeaderboardObservation>()
    const refresh = (): void => {
      const observation = get_state().leaderboard_observation
      if (!observation || signal.aborted || running.has(observation)) return
      const current = ++revision
      const valid = (): boolean =>
        !signal.aborted && current === revision && get_state().leaderboard_observation === observation
      last_started = Date.now()
      running.add(observation)
      void (async () => {
        if (!pubsub.graph.leaderboard) throw new Error('leaderboard reader unavailable')
        const snapshot = await pubsub.graph.leaderboard(observation, address)
        if (!valid()) return
        // Optional enrichment has a short shared deadline; failed names cannot stall scores
        // or be invalidated forever by the next refresh. Publish one coherent window.
        const enriched = await enrich_leaderboard(graph, resolve_name ?? (async () => null), snapshot)
        if (valid()) send({ type: 'packet/leaderboard', snapshot: enriched })
      })()
        .catch((error: Error) => {
          log.warn({ error: error.message }, 'leaderboard refresh failed')
          if (valid()) send({ type: 'packet/leaderboard_error', observation, reason: 'unavailable' })
        })
        .finally(() => running.delete(observation))
    }
    const { watch, unwatch } = create_watcher(pubsub, signal)
    const invalidate = (): void => {
      if (Date.now() - last_started >= REFRESH_MS) refresh()
    }
    const stop = (): void => {
      revision++
      if (!timer) return
      clearInterval(timer)
      timer = null
      unwatch(CHANNEL)
    }
    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      if (state.leaderboard_observation === previous.leaderboard_observation) return
      if (!state.leaderboard_observation) return stop()
      if (!timer) {
        void watch(CHANNEL, invalidate).catch((error: Error) =>
          log.warn({ error: error.message }, 'leaderboard subscribe failed')
        )
        // Also repairs missed pub/sub and refreshes names after their cache expires.
        timer = setInterval(refresh, REFRESH_MS)
      }
      refresh()
    })
    signal.addEventListener('abort', stop, { once: true })
  },
} satisfies PlayerModule
