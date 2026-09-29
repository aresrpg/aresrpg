// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { FightStateRow } from '@aresrpg/protocol'

import type { EventEnvelope } from './protocol.ts'

/** Each indexer event owns one read, shared even when viewers drain their queues at different speeds.
 * Event identities are weak keys; initial watches only retain a read until it finishes. */
export const shared_fight_checkpoints = (read: (fight: string) => Promise<FightStateRow | null>) => {
  const events = new WeakMap<EventEnvelope, Promise<FightStateRow | null>>()
  const pending = new Map<string, Promise<FightStateRow | null>>()
  return (fight: string, event?: EventEnvelope): Promise<FightStateRow | null> => {
    if (event) {
      const existing = events.get(event)
      if (existing) return existing
      const result = read(fight)
      events.set(event, result)
      return result
    }
    const existing = pending.get(fight)
    if (existing) return existing
    const result = read(fight).finally(() => pending.delete(fight))
    pending.set(fight, result)
    return result
  }
}
