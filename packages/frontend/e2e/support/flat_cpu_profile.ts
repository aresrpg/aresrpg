// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Page, TestInfo } from '@playwright/test'

/** Optional diagnostic rerun: sample JS only during the populated steady flat stage. */
export const capture_flat_cpu_profile = async (page: Page, info: TestInfo, enabled: boolean) => {
  if (!enabled) return async () => undefined
  const session = await page.context().newCDPSession(page)
  await session.send('Profiler.enable')
  let started: Promise<unknown> | undefined
  let stopped: Promise<void> | undefined
  page.on('console', (message) => {
    if (message.text().startsWith('[workload] flatten-transition ')) started = session.send('Profiler.start')
    if (message.text().startsWith('[workload] flat ') && started)
      stopped = started.then(async () => {
        const { profile } = await session.send('Profiler.stop')
        await info.attach('flat-cpu-profile', { body: JSON.stringify(profile), contentType: 'application/json' })
      })
  })
  return async () => {
    await stopped
    await session.detach()
  }
}
