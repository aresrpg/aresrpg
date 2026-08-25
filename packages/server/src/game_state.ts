// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The process-wide projection of the shared Version object. Subscribe first,
// then load the graph snapshot: no connection waits for a future transition.

import type { Graph } from './graph.ts'
import type { GraphBus } from './pubsub_bus.ts'
import { channels, type EventEnvelope } from './protocol.ts'

export type GameState = {
  get: () => boolean | null
  listen: (listener: (frozen: boolean | null) => void) => () => void
  start: () => Promise<void>
}

type State = Readonly<{ frozen: boolean | null }>

export const reduce_game_state = (state: State, frozen: boolean): State =>
  state.frozen === frozen ? state : Object.freeze({ frozen })

export const create_game_state = ({ graph, pubsub }: Readonly<{ graph: Graph; pubsub: GraphBus }>): GameState => {
  let state: State = Object.freeze({ frozen: null })
  let indexed_changes = 0
  const listeners = new Set<(frozen: boolean | null) => void>()
  const apply = (frozen: boolean): void => {
    const next = reduce_game_state(state, frozen)
    if (next === state) return
    state = next
    for (const listener of listeners) listener(state.frozen)
  }
  const on_indexed_change = (payload: EventEnvelope): void => {
    if (payload.type !== 'GameStateChanged' || typeof payload.data.frozen !== 'boolean') return
    indexed_changes += 1
    apply(payload.data.frozen)
  }
  return Object.freeze({
    get: () => state.frozen,
    listen: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start: async () => {
      pubsub.emitter.on(channels.game, on_indexed_change)
      await pubsub.subscribe(channels.game)
      const changes_before_read = indexed_changes
      const [row] = await graph.read("MATCH (m:Meta {id: 'meta'}) RETURN m.version AS version")
      if (indexed_changes !== changes_before_read || row?.version === null || row?.version === undefined) return
      apply(Number(row.version) === 0)
    },
  })
}
