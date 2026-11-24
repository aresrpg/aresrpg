// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The game document's entry. The document already shows the loading postcard; this small step lets it paint,
// then loads the game.
import { prepare_boot_loading, show_boot_failure } from '../boot_loading.ts'
import { observe_startup_recovery } from '../startup_recovery.ts'

const boot = async (): Promise<void> => {
  try {
    observe_startup_recovery()
  } catch (error) {
    console.warn('Startup update recovery is unavailable.', error)
  }
  prepare_boot_loading()
  if (!document.hidden) {
    await new Promise(requestAnimationFrame)
    await new Promise(requestAnimationFrame)
  }
  const { start_game } = await import('./start.tsx')
  await start_game()
}
void boot().catch((error: unknown) => {
  console.error('Game startup failed.', error)
  show_boot_failure()
})
