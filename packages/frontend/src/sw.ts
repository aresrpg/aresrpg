// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { registerSW } from 'virtual:pwa-register'

export function register_service_worker() {
  // #1598 — drop the orphaned pre-v2 asset cache: its opaque entries broke every cors consumer (see the
  // cdn-assets-v2 note in vite.config.ts). A new cacheName alone leaves the poisoned one on disk until it
  // expires, so delete it by name. Fire-and-forget — boot never waits on, nor fails from, cache cleanup.
  if (typeof caches !== 'undefined') caches.delete('cdn-assets').catch(() => {})

  registerSW({
    onRegisteredSW(_sw_url, registration) {
      if (!registration) return
      // Poll for updates every 60s — autoUpdate handles the rest
      setInterval(() => {
        registration.update().catch(() => {})
      }, 60_000)
    },
    onRegisterError(_error) {},
  })
}
