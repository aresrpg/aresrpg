// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { BusRedis } from '../pubsub_bus.ts'

export const get_market_volume = async (
  redis: Pick<BusRedis, 'get' | 'hvals'>,
  epoch: string
): Promise<string | null> => {
  const first_epoch = await redis.get('market:volume:first_epoch')
  if (first_epoch === null || BigInt(epoch) <= BigInt(first_epoch)) return null
  const values = await redis.hvals(`market:volume:epoch:${epoch}`)
  return values
    .reduce((total, value) => {
      if (!/^\d+$/.test(value)) throw new Error('Invalid marketplace epoch volume')
      return total + BigInt(value)
    }, 0n)
    .toString()
}
