// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { registerSW } from 'virtual:pwa-register'

export function register_service_worker() {
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
