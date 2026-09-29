// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import type { Page, TestInfo } from '@playwright/test'

/** Optional diagnostic rerun: sample JS only during the populated steady crowd stage. */
export const capture_crowd_cpu_profile = async (
  page: Page,
  info: TestInfo,
  enabled: boolean,
  stage: 'crowd' | 'crowd-entry' = 'crowd'
) => {
  if (!enabled) return async () => undefined
  const session = await page.context().newCDPSession(page)
  await session.send('Profiler.enable')
  let started: Promise<unknown> | undefined
  let stopped: Promise<void> | undefined
  page.on('console', (message) => {
    if (message.text().startsWith(`[workload] ${stage === 'crowd' ? 'crowd-entry' : 'population'} `))
      started = session.send('Profiler.start')
    if (message.text().startsWith(`[workload] ${stage} `) && started)
      stopped = started.then(async () => {
        const { profile } = await session.send('Profiler.stop')
        await info.attach(`${stage}-cpu-profile`, { body: JSON.stringify(profile), contentType: 'application/json' })
      })
  })
  return async () => {
    await stopped
    await session.detach()
  }
}
