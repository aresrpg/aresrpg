// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Isolated process: the real server entry (`src/index.ts`) on a test port, with its edge singletons
// (graph, the two Redis buses, the fullnode and the signature verifier) faked. Every proof verifies;
// the graph is empty. The door, the seat map, the bans and the budgets are real.

import { EventEmitter } from 'node:events'

import { mock } from 'bun:test'

const bus = () => {
  const emitter = new EventEmitter()
  emitter.setMaxListeners(0)
  return {
    emitter,
    subscribe: async () => {},
    unsubscribe: async () => {},
    publish: async (channel: string, payload: unknown) => {
      emitter.emit(channel, payload)
    },
    close: () => {},
  }
}

void mock.module('../src/graph.ts', () => ({ graph: { read: async () => [], close: async () => {} } }))
void mock.module('../src/pubsub.ts', () => ({
  pubsub: {
    graph: {
      ...bus(),
      indexed_checkpoint: async () => 1,
      indexed_state: async () => null,
      sales_history: async () => [],
      market_changes: async () => ({}),
      market_volume: async () => null,
    },
    mesh: {
      ...bus(),
      heartbeat: async () => {},
      cluster_online: async () => ({ online: 0, online_characters: 0 }),
      record_online: async () => {},
    },
  },
}))
void mock.module('../src/sui.ts', () => ({
  sui_client: {},
  latest_checkpoint: async () => ({ sequence_number: 1, timestamp_ms: Date.now() }),
}))
void mock.module('../src/auth.ts', () => ({
  verify_login: async () => true,
  verify_wallet_message: async () => true,
}))

await import('../src/index.ts')
