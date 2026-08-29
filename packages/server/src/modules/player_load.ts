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
import { get_claims, get_giftcards, get_kiosks, get_my_listings } from '../reads/get_user_economy.ts'
import { get_fight_resolutions } from '../reads/get_fight_resolutions.ts'
import { get_closable_fights } from '../reads/get_closable_fights.ts'
import logger from '../logger.ts'
import type { PlayerModule } from '../player.ts'

const log = logger(import.meta)
// Detection only: tune from production evidence. This is not a gameplay or ownership cap.
const LARGE_ACCOUNT_SNAPSHOT_ROWS = 2_000

export const account_snapshot_warning = (
  kiosk_count: number,
  total_rows: number
): 'multiple_kiosks' | 'large_snapshot' | 'multiple_kiosks_and_large_snapshot' | null => {
  const multiple_kiosks = kiosk_count > 1
  const large_snapshot = total_rows >= LARGE_ACCOUNT_SNAPSHOT_ROWS
  if (!multiple_kiosks && !large_snapshot) return null
  if (multiple_kiosks && large_snapshot) return 'multiple_kiosks_and_large_snapshot'
  return multiple_kiosks ? 'multiple_kiosks' : 'large_snapshot'
}

export default {
  name: 'player_load',
  observe: (context) => {
    const { graph, address, send, dispatch } = context
    void (async () => {
      try {
        const [kiosks, characters, items, claims, giftcards, listings, resolutions, closable_fights] =
          await Promise.all([
            get_kiosks(graph, { address }),
            get_characters(graph, { address }),
            get_items(graph, { address }),
            get_claims(graph, { address }),
            get_giftcards(graph, { address }),
            get_my_listings(graph, { address }),
            get_fight_resolutions(graph, { address }),
            get_closable_fights(graph, { address }),
          ])
        const counts = {
          kiosk_count: kiosks.length,
          character_count: characters.length,
          item_count: items.length,
          claim_count: claims.length,
          giftcard_count: giftcards.length,
          listing_count: listings.length,
          resolution_count: resolutions.length,
          closable_fight_count: closable_fights.length,
        }
        const total_rows = Object.values(counts).reduce((total, count) => total + count, 0)
        const warning = account_snapshot_warning(counts.kiosk_count, total_rows)
        if (warning)
          log.warn(
            { address, reason: warning, ...counts, total_rows },
            'account snapshot exceeds the supported single-kiosk profile'
          )
        // `packet/characters` is the client's READY barrier. Everything an immediate action
        // can reference must arrive first on this ordered socket, especially listing locks.
        dispatch({ type: 'action/character_roster', characters })
        send({ type: 'packet/inventory', items })
        send({ type: 'packet/claims', claims })
        send({ type: 'packet/giftcards', giftcards })
        send({ type: 'packet/listings', listings })
        send({ type: 'packet/fight_resolutions', resolutions })
        send({ type: 'packet/closable_fights', fights: closable_fights })
        send({ type: 'packet/characters', characters })
      } catch (error) {
        log.error({ address, error: (error as Error).message }, 'load snapshot failed')
        send({ type: 'packet/error', reason: 'load failed — reconnect' })
      }
    })()
  },
} satisfies PlayerModule
