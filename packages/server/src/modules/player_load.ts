// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE LOAD SNAPSHOT (push model): once, at connection, the player receives everything that is
// HIS — characters (with equipment), the flat inventory, friends, pending claims, giftcards,
// and active listings. After this, a receipt updates him with exactly what it CONTAINS;
// the server never re-sends what a receipt told him, and streams only what it could not —
// e.g. a created character's chain-initialized row (player_events). (The party and any live
// fight are per-CHARACTER — they push at embody, through their modules.)

import type { CharacterRow } from '@aresrpg/protocol'

import { get_characters } from '../reads/get_characters.ts'
import { get_items } from '../reads/get_items.ts'
import { get_claims, get_giftcards, get_kiosks, get_my_listings } from '../reads/get_user_economy.ts'
import { get_fight_resolutions } from '../reads/get_fight_resolutions.ts'
import { get_closable_fights } from '../reads/get_closable_fights.ts'
import { get_mastery } from '../reads/get_mastery.ts'
import logger from '../logger.ts'
import type { PlayerAction, PlayerModule } from '../player.ts'
import { latest_reader } from '../latest_read.ts'
import { create_watcher } from '../pubsub_bus.ts'

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

export type AccountDomain =
  | 'kiosks'
  | 'characters'
  | 'inventory'
  | 'claims'
  | 'giftcards'
  | 'listings'
  | 'resolutions'
  | 'closable_fights'
  | 'mastery'

export default {
  name: 'player_load',
  observe: ({ graph, address, send, dispatch, events, signal, drop, pubsub, channels }) => {
    const completed = new Set<AccountDomain>()
    const counts = new Map<AccountDomain, number>()
    let characters: CharacterRow[] | null = null
    let ready = false
    const finish = (): void => {
      if (ready || completed.size !== Object.keys(readers).length || !characters) return
      ready = true
      const total_rows = [...counts.values()].reduce((total, count) => total + count, 0)
      const warning = account_snapshot_warning(counts.get('kiosks') ?? 0, total_rows)
      if (warning)
        log.warn(
          { address, reason: warning, total_rows },
          'account snapshot exceeds the supported single-kiosk profile'
        )
      send({ type: 'packet/characters', characters })
    }
    const domain = <T>(key: AccountDomain, read: () => Promise<T>, deliver: (value: T) => void) => {
      const latest = latest_reader(read, (value) => {
        if (signal.aborted) return
        completed.add(key)
        if (Array.isArray(value)) counts.set(key, value.length)
        deliver(value)
        finish()
      })
      return (): void => {
        if (signal.aborted) return
        if (!ready) completed.delete(key)
        void latest().catch((error: Error) => {
          if (signal.aborted) return
          log.error({ address, domain: key, error: error.message }, 'account snapshot read failed')
          // An incomplete baseline cannot become usable. Reconnection owns recovery.
          if (!ready) drop('SNAPSHOT_FAILED')
        })
      }
    }
    const readers: Record<AccountDomain, () => void> = {
      kiosks: domain(
        'kiosks',
        () => get_kiosks(graph, { address }),
        () => {}
      ),
      characters: domain(
        'characters',
        () => get_characters(graph, { address }),
        (value) => {
          characters = value
          dispatch({ type: 'action/character_roster', characters: value })
          if (ready) send({ type: 'packet/characters', characters: value })
        }
      ),
      inventory: domain(
        'inventory',
        () => get_items(graph, { address }),
        (items) => send({ type: 'packet/inventory', items })
      ),
      claims: domain(
        'claims',
        () => get_claims(graph, { address }),
        (claims) => send({ type: 'packet/claims', claims })
      ),
      giftcards: domain(
        'giftcards',
        () => get_giftcards(graph, { address }),
        (giftcards) => send({ type: 'packet/giftcards', giftcards })
      ),
      listings: domain(
        'listings',
        () => get_my_listings(graph, { address }),
        (snapshot) => send({ type: 'packet/listings', ...snapshot })
      ),
      resolutions: domain(
        'resolutions',
        () => get_fight_resolutions(graph, { address }),
        (resolutions) => send({ type: 'packet/fight_resolutions', resolutions })
      ),
      closable_fights: domain(
        'closable_fights',
        () => get_closable_fights(graph, { address }),
        (fights) => send({ type: 'packet/closable_fights', fights })
      ),
      mastery: domain(
        'mastery',
        () => get_mastery(graph, { address }),
        (mastery) => send({ type: 'packet/mastery', ...mastery })
      ),
    }
    events.on('action/refresh_account', ({ domain: key }: Extract<PlayerAction, { type: 'action/refresh_account' }>) =>
      readers[key]()
    )
    const { watch } = create_watcher(pubsub, signal)
    void Promise.all([watch(channels.social(address), () => {}), watch(channels.economy, () => {})])
      .then(() => {
        if (!signal.aborted) Object.values(readers).forEach((read) => read())
      })
      .catch((error: Error) => {
        log.error({ address, error: error.message }, 'account subscription failed')
        if (!signal.aborted) drop('SNAPSHOT_FAILED')
      })
  },
} satisfies PlayerModule
