// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Dungeon lobby tracking replaces one character's world spiral while its DungeonRun exists.
// Lobby truth is graph state; scoped indexer events are only invalidation edges.

import { get_dungeon_lobby } from '../reads/get_dungeon_lobby.ts'
import { create_watcher } from '../pubsub_bus.ts'
import { latest_keyed_reader } from '../latest_read.ts'
import logger from '../logger.ts'
import type { EventEnvelope } from '../protocol.ts'
import type { PlayerModule, PlayerState } from '../player.ts'

const log = logger(import.meta)

const lobby_key = ({ world, x, z }: Readonly<{ world: string; x: number; z: number }>): string => `${world}:${x}:${z}`

const runs_of = (state: PlayerState) =>
  new Map(
    Object.values(state.characters).flatMap(({ dungeon_run }) =>
      dungeon_run ? [[lobby_key(dungeon_run), dungeon_run] as const] : []
    )
  )

export default {
  name: 'player_dungeon',
  observe: ({ pubsub, events, signal, graph, send, channels, get_state }) => {
    const { watch, unwatch, watched } = create_watcher(pubsub)
    const push = latest_keyed_reader(
      (key) => {
        const run = runs_of(get_state()).get(key)
        return run ? get_dungeon_lobby(graph, run) : Promise.resolve(null)
      },
      (key, lobby) => {
        if (lobby && runs_of(get_state()).has(key)) send({ type: 'packet/dungeon_lobby', lobby })
      }
    )
    const refresh = (key: string): void => {
      void push(key).catch((error: Error) => log.error({ key, error: error.message }, 'dungeon lobby read failed'))
    }
    const forward = (key: string) => (_payload: EventEnvelope) => refresh(key)

    events.on('STATE_UPDATED', (state: PlayerState, previous: PlayerState) => {
      const before = runs_of(previous)
      const current = runs_of(state)
      for (const [key, run] of before) if (!current.has(key)) unwatch(channels.dungeon(run.world, run.x, run.z))
      for (const [key, run] of current) {
        if (before.has(key)) continue
        void watch(channels.dungeon(run.world, run.x, run.z), forward(key) as (payload: never) => void)
          .then(() => {
            if (runs_of(get_state()).has(key)) refresh(key)
          })
          .catch((error: Error) => log.error({ key, error: error.message }, 'dungeon lobby watch failed'))
      }
    })

    signal.addEventListener('abort', () => {
      for (const channel of watched()) unwatch(channel)
    })
  },
} satisfies PlayerModule
