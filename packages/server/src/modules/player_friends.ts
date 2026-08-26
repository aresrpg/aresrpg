// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { latest_reader } from '../latest_read.ts'
import logger from '../logger.ts'
import type { EventEnvelope } from '../protocol.ts'
import { get_friends } from '../reads/get_friends.ts'
import type { PlayerModule } from '../player.ts'
import { create_watcher } from '../pubsub_bus.ts'

const log = logger(import.meta)

export default {
  name: 'player_friends',
  reduce: (state, action) =>
    action.type === 'action/friends' ? { ...state, friends: new Set(action.friends) } : state,
  observe: ({ pubsub, graph, address, signal, channels, send, dispatch }) => {
    const { watch, unwatch, watched } = create_watcher(pubsub)
    const refresh = latest_reader(
      () => get_friends(graph, { address }),
      (friends) => {
        dispatch({ type: 'action/friends', friends: friends.map(({ address: friend }) => String(friend)) })
        send({ type: 'packet/friends', friends })
      }
    )
    const forward = (payload: EventEnvelope): void => {
      if (payload.type === 'FriendListChanged')
        void refresh().catch((error: Error) =>
          log.error({ address, error: error.message }, 'friend list refresh failed')
        )
    }
    void watch(channels.social(address), forward as (payload: never) => void)
      .then(refresh)
      .catch((error: Error) => log.error({ address, error: error.message }, 'friend list watch failed'))
    signal.addEventListener('abort', () => {
      for (const channel of watched()) unwatch(channel)
    })
  },
} satisfies PlayerModule
