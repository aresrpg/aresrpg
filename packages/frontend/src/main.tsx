// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { observe_startup_recovery } from './startup_recovery.ts'
import { prepare_boot_loading, show_boot_failure } from './boot_loading.ts'

const boot = async (): Promise<void> => {
  if (location.pathname.replace(/\/+$/, '') === '/enoki') {
    // The opener owns the OAuth result. Leave this callback passive, including its static shell.
    document.getElementById('root')?.replaceChildren()
    return
  }
  try {
    observe_startup_recovery()
  } catch (error) {
    console.warn('Startup update recovery is unavailable.', error)
  }
  const game_loading = Boolean(document.querySelector('[data-boot-loading]'))
  if (game_loading) prepare_boot_loading()
  if (game_loading && !document.hidden) {
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
