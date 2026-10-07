// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

/** Check visible games frequently and check again when the player returns or reconnects.
 * The existing autoUpdate worker installs the new assets before reloading the app. */
const UPDATE_CHECK_MS = 15_000

export const observe_service_worker_updates = (registration: Readonly<{ update: () => Promise<unknown> }>): void => {
  let checking = false
  const check = (): void => {
    if (checking || document.visibilityState !== 'visible' || !navigator.onLine) return
    checking = true
    void registration
      .update()
      .catch((error: unknown) => console.warn('Game update check failed.', error))
      .finally(() => {
        checking = false
      })
  }
  setInterval(check, UPDATE_CHECK_MS)
  document.addEventListener('visibilitychange', check)
  globalThis.addEventListener('focus', check)
  globalThis.addEventListener('online', check)
}

export async function register_service_worker(): Promise<void> {
  // A production worker previously registered on localhost can keep serving an old protocol
  // bundle over Vite. Development is live source: remove every inherited worker before boot.
  if (import.meta.env.DEV) {
    const registrations = await globalThis.navigator?.serviceWorker?.getRegistrations()
    await Promise.all((registrations ?? []).map((registration) => registration.unregister()))
    return
  }
  const { registerSW } = await import('virtual:pwa-register')
  registerSW({
    immediate: true,
    onRegisteredSW: (_url, registration) => {
      if (!registration) return
      observe_service_worker_updates(registration)
    },
    onRegisterError: console.error,
  })
}
