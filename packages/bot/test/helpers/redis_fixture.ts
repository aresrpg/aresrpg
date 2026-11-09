// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { RedisClient } from 'bun'

export const fixture_redis = (url: string) => {
  const target = new URL(url)
  if (target.protocol !== 'redis:' || target.hostname !== '127.0.0.1' || target.pathname !== '/15')
    throw new Error('disposable loopback Redis database 15 only')
  return new RedisClient(url, { autoReconnect: false, enableOfflineQueue: false })
}
