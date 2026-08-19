// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The pub/sub edge — module-level singletons: importing IS connecting (the harness receives
// them injected, so tests never import this file; the factories live in pubsub_bus.ts).
// The graph connections are TERMINAL (no retry): this pod is bound to ONE indexer set for its
// whole life, and when that set dies the pod dies with it — k8s replaces the pod, and the fresh
// one connects to any caught-up set. The mesh redis reconnects on its own; a blip there only
// delays heartbeats.

import { Redis } from 'ioredis'

import { GRAPH_URL, MESH_REDIS_URL } from './env.ts'
import { create_graph_bus, create_mesh_bus, type Pubsub } from './pubsub_bus.ts'
import logger from './logger.ts'

const log = logger(import.meta)

const terminal_redis = (url: string): Redis => new Redis(url, { retryStrategy: () => null, maxRetriesPerRequest: 0 })

export const pubsub: Pubsub = {
  graph: create_graph_bus({
    subscriber: terminal_redis(GRAPH_URL),
    publisher: terminal_redis(GRAPH_URL),
    on_lost: (reason) => {
      log.fatal({ reason }, 'the bound indexer set is gone — this pod dies with it')
      process.exit(1)
    },
  }),
  mesh: create_mesh_bus({ subscriber: new Redis(MESH_REDIS_URL), publisher: new Redis(MESH_REDIS_URL) }),
}
