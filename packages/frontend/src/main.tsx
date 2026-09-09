// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { inject } from '@vercel/analytics'
import { injectSpeedInsights as inject_speed_insights } from '@vercel/speed-insights'

import { init_reporting, report_error } from './reporting.ts'

import './tailwind.css'

const boot = async (): Promise<void> => {
  // Enoki's opener reads this popup's OAuth result. App routing would erase it.
  if (globalThis.location.pathname.replace(/\/+$/, '') === '/enoki') return
  init_reporting()
  if (import.meta.env.MODE === 'production') {
    // Claim fragments carry bearer keys; telemetry only needs the page path.
    const before_send = <T extends { readonly url: string }>(event: T): T => ({
      ...event,
      url: event.url.split(/[?#]/, 1)[0]!,
    })
    inject({ mode: 'production', beforeSend: before_send })
    inject_speed_insights({ beforeSend: before_send })
  }
  const { boot_game } = await import('./game_entry.tsx')
  boot_game()
}

void boot().catch((error: unknown) => report_error(error, { area: 'entry' }))
