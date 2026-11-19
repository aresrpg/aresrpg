// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { admission_command } from './admission.ts'
import { setting } from './config.ts'
import { open_redis } from './store.ts'

// `waitlist` lists who waits and who is admitted; `waitlist admit <owner>` and `waitlist remove <owner>`
// change the allowlist. The running listener reads it live, so nothing restarts.
try {
  const redis = await open_redis(setting(process.env, 'TELEGRAM_REDIS_URL'))
  try {
    const result = await admission_command(process.argv.slice(2), process.env, redis.access, redis.backend)
    console.info(JSON.stringify(result, null, 2))
  } finally {
    redis.close()
  }
} catch (error) {
  console.error('Telegram waitlist command did not complete:', error instanceof Error ? error.message : 'unknown')
  process.exitCode = 1
}
