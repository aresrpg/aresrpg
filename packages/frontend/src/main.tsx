// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { inject } from '@vercel/analytics'
import { injectSpeedInsights as inject_speed_insights } from '@vercel/speed-insights'

import { capture_demo_boot_failure, init_analytics } from './analytics.ts'
import { init_reporting, report_error } from './reporting.ts'
import { is_gift_entry, saved_gift_route } from './airdrop/gift_intent.ts'

import './tailwind.css'

const boot = async (): Promise<void> => {
  // Enoki's opener reads this popup's OAuth result. App routing would erase it.
  if (globalThis.location.pathname.replace(/\/+$/, '') === '/enoki') return
  init_reporting()
  try {
    init_analytics()
  } catch (error) {
    report_error(error, { area: 'analytics' })
  }
  if (import.meta.env.MODE === 'production') {
    // Claim fragments carry bearer keys; telemetry only needs the page path.
    const before_send = <T extends { readonly url: string }>(event: T): T => ({
      ...event,
      url: event.url.split(/[?#]/, 1)[0]!,
    })
    inject({ mode: 'production', beforeSend: before_send })
    inject_speed_insights({ beforeSend: before_send })
  }
  if (is_gift_entry(location.pathname, location.hash, saved_gift_route())) {
    const { boot_gift } = await import('./airdrop/gift_entry.tsx')
    await boot_gift()
  } else {
    const { boot_game } = await import('./game_entry.tsx')
    boot_game()
  }
}

void boot().catch((error: unknown) => {
  capture_demo_boot_failure('entry')
  report_error(error, { area: 'entry' })
})
