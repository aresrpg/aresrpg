// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE LOAD SNAPSHOT (push model): once, at connection, the player receives everything that is
// HIS — characters (with equipment), the flat inventory, friends, pending claims, giftcards,
// and active listings. After this, a receipt updates him with exactly what it CONTAINS;
// the server never re-sends what a receipt told him, and streams only what it could not —
// e.g. a created character's chain-initialized row (player_events). (The party and any live
// fight are per-CHARACTER — they push at embody, through their modules.)

import { get_characters } from '../reads/get_characters.ts'
import { get_items } from '../reads/get_items.ts'
import { get_friends } from '../reads/get_friends.ts'
import { get_claims, get_giftcards, get_my_listings } from '../reads/get_user_economy.ts'
import logger from '../logger.ts'
import type { PlayerModule } from '../player.ts'

const log = logger(import.meta)

export default {
  name: 'player_load',
  observe: (context) => {
    const { graph, address, send } = context
    void (async () => {
      try {
        const [characters, items, friends, claims, giftcards, listings] = await Promise.all([
          get_characters(graph, { address }),
          get_items(graph, { address }),
          get_friends(graph, { address }),
          get_claims(graph, { address }),
          get_giftcards(graph, { address }),
          get_my_listings(graph, { address }),
        ])
        send({ type: 'packet/characters', characters })
        send({ type: 'packet/inventory', items })
        send({ type: 'packet/friends', friends: friends.map((friend) => friend.address as string) })
        send({ type: 'packet/claims', claims })
        send({ type: 'packet/giftcards', giftcards })
        send({ type: 'packet/listings', listings })
      } catch (error) {
        log.error({ address, error: (error as Error).message }, 'load snapshot failed')
        send({ type: 'packet/error', reason: 'load failed — reconnect' })
      }
    })()
  },
} satisfies PlayerModule
