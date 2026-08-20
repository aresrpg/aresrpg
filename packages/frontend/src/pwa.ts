// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { registerSW } from 'virtual:pwa-register'

/** Browsers only look for a new service worker on navigation (or daily) — an always-open game
 *  tab would ride a stale bundle forever. This polls the worker, and autoUpdate + skipWaiting
 *  then swap and reload the app on their own. */
const UPDATE_CHECK_MS = 60_000

export function register_service_worker(): void {
  registerSW({
    immediate: true,
    onRegisteredSW: (_url, registration) => {
      if (registration) setInterval(() => void registration.update(), UPDATE_CHECK_MS)
    },
    onRegisterError: console.error,
  })
}
