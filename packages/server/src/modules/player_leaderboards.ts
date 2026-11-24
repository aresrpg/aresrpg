// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type {
  LeaderboardEntry,
  LeaderboardMetric,
  LeaderboardObservation,
  LeaderboardSnapshot,
} from '@aresrpg/protocol'

import { create_watcher, type Pubsub } from '../pubsub_bus.ts'
import { enrich_entries } from '../reads/enrich_leaderboard.ts'
import { sampled_read } from '../sampled_read.ts'
import type { Graph } from '../graph.ts'
import type { ResolveName } from '../suins.ts'
import logger from '../logger.ts'
import { channels } from '../protocol.ts'
import type { PublicModule, PlayerState } from '../player.ts'

const log = logger(import.meta)
const CHANNEL = channels.leaderboards
const REFRESH_MS = 5_000

/** The enriched leaderboard as one viewer sees it, from two process-wide samples taken at most once per
 *  refresh: the window, one per metric for every socket, and the viewer's own row, one per metric and
 *  address. A part that did not change keeps its identity. Optional enrichment has a short shared
 *  deadline; failed names cannot stall scores. */
export const create_leaderboards = ({
  graph,
  pubsub,
  resolve_name = async () => null,
}: Readonly<{ graph: Graph; pubsub: Pick<Pubsub, 'graph'>; resolve_name?: ResolveName }>) => {
  const window = sampled_read(async (metric) => {
    const snapshot = await pubsub.graph.leaderboard({ metric: metric as LeaderboardMetric, id: 0 })
    return {
      ...snapshot,
      entries: await enrich_entries(graph, resolve_name, snapshot.observation.metric, snapshot.entries),
    }
  }, REFRESH_MS)
  const own = sampled_read(async (key) => {
    const [metric, address] = JSON.parse(key) as [LeaderboardMetric, string]
    const entry = await pubsub.graph.leaderboard_rank(metric, address)
    return entry ? (await enrich_entries(graph, resolve_name, metric, [entry]))[0]! : null
  }, REFRESH_MS)
  return async (
    metric: LeaderboardMetric,
    viewer: string | null
  ): Promise<Readonly<{ window: LeaderboardSnapshot; self: LeaderboardEntry | null }>> => {
    const [snapshot, self] = await Promise.all([
      window(metric),
      viewer === null ? null : own(JSON.stringify([metric, viewer])),
    ])
    return { window: snapshot, self }
  }
}
export type Leaderboards = ReturnType<typeof create_leaderboards>

export default {
  name: 'player_leaderboards',
  reduce: (state, action) => {
    if (action.type === 'packet/leaderboard_observe') return { ...state, leaderboard_observation: action.observation }
    if (action.type === 'close') return { ...state, leaderboard_observation: null }
    return state
  },
  observe: ({ pubsub, events, send, leaderboards, viewer, get_state, signal }) => {
    let revision = 0
    let timer: ReturnType<typeof setInterval> | null = null
    // What this socket last sent: an unchanged window and own row for the same observation are not re-sent.
    let sent: Readonly<{ observation: LeaderboardObservation; window: LeaderboardSnapshot; self: unknown }> | null =
      null
    const running = new Set<LeaderboardObservation>()
    const unchanged = (observation: LeaderboardObservation, { window, self }: Awaited<ReturnType<Leaderboards>>) =>
      sent?.observation === observation && sent.window === window && sent.self === self
    const refresh = (): void => {
      const observation = get_state().leaderboard_observation
      if (!observation || signal.aborted || running.has(observation)) return
      const current = ++revision
      const valid = (): boolean =>
        !signal.aborted && current === revision && get_state().leaderboard_observation === observation
      running.add(observation)
      void (async () => {
        // The window and the viewer's own row (none for an open socket), stamped with this request.
        const read = await leaderboards(observation.metric, viewer)
        if (!valid() || unchanged(observation, read)) return
        sent = { observation, ...read }
        send({ type: 'packet/leaderboard', snapshot: { ...read.window, observation, self: read.self } })
      })()
        .catch((error: Error) => {
          log.warn({ error: error.message }, 'leaderboard refresh failed')
          if (valid()) send({ type: 'packet/leaderboard_error', observation, reason: 'unavailable' })
        })
        .finally(() => running.delete(observation))
    }
    const { watch, unwatch } = create_watcher(pubsub, signal)
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
        void watch(CHANNEL, refresh).catch((error: Error) =>
          log.warn({ error: error.message }, 'leaderboard subscribe failed')
        )
        // Also repairs missed pub/sub and refreshes names after their cache expires.
        timer = setInterval(refresh, REFRESH_MS)
      }
      refresh()
    })
    signal.addEventListener('abort', stop, { once: true })
  },
} satisfies PublicModule
