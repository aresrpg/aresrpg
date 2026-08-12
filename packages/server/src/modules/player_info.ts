// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The cluster heartbeat, player-facing half (legacy server_info): every 5s, whoever is
// connected hears the network-wide online count — a flat cadence, deliberately decorrelated
// from user activity (owner 2026-08-12). The pod-side half (the `server:<id>` key and the
// player_connect eviction beacon) lives in index.ts — it is per-POD, not per-connection.

import logger from '../logger.ts'
import type { PlayerModule } from '../player.ts'

const log = logger(import.meta)

const INFO_INTERVAL_MS = 5_000

export default {
  name: 'player_info',
  observe: ({ pubsub, send, signal }) => {
    const push = () =>
      pubsub
        .cluster_online()
        .then((online) => send({ type: 'packet/server_info', online }))
        .catch((error: Error) => log.warn({ error: error.message }, 'cluster count failed'))
    const timer = setInterval(() => void push(), INFO_INTERVAL_MS)
    void push()
    signal.addEventListener('abort', () => clearInterval(timer))
  },
} satisfies PlayerModule
