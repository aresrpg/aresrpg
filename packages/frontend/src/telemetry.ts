// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Error reporting and usage analytics, started once per document.
import { inject } from '@vercel/analytics'
import { injectSpeedInsights as inject_speed_insights } from '@vercel/speed-insights'

import { init_analytics } from './analytics.ts'
import { init_reporting, report_error } from './reporting.ts'

export const start_telemetry = (): void => {
  init_reporting()
  try {
    init_analytics()
  } catch (error) {
    report_error(error, { area: 'analytics' })
  }
  if (import.meta.env.MODE !== 'production') return
  // Claim fragments carry bearer keys; telemetry only needs the page path.
  const before_send = <T extends { readonly url: string }>(event: T): T => ({
    ...event,
    url: event.url.split(/[?#]/, 1)[0]!,
  })
  inject({ mode: 'production', beforeSend: before_send })
  inject_speed_insights({ beforeSend: before_send })
}
