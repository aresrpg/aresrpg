// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { cleanup_sender } from './cleanup.ts'
import { setting } from './config.ts'
import { open_redis } from './store.ts'

const redis = await open_redis(setting(process.env, 'TELEGRAM_REDIS_URL'))
try {
  await cleanup_sender(process.argv.slice(2), process.env, redis.backend)
  console.info('Named Telegram grant cleanup confirmed')
} catch (error) {
  console.error(
    'Telegram cleanup incomplete; retained credentials and pending exchange state require review:',
    error instanceof Error ? error.message : 'unknown'
  )
  process.exitCode = 1
} finally {
  redis.close()
}
