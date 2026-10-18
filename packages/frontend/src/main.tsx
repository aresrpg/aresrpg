// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { prepare_boot_loading, show_boot_failure } from './boot_loading.ts'

const boot = async (): Promise<void> => {
  if (location.pathname.replace(/\/+$/, '') === '/enoki') return
  prepare_boot_loading()
  if (!document.hidden) {
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  }
  const { boot_app } = await import('./app_boot.ts')
  await boot_app()
}
void boot().catch((error: unknown) => {
  console.error('Application startup failed.', error)
  show_boot_failure()
})
