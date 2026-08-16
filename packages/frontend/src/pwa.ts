// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { registerSW } from 'virtual:pwa-register'

export function register_service_worker(): void {
  registerSW({
    immediate: true,
    onRegisterError: console.error,
  })
}
