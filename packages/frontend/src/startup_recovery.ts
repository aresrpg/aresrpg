// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { EngineIssue, EngineStatus } from '@aresrpg/engine'

export const RELOAD_CHECK = 'ares:before-update-reload'
const ASSET_MISSING = 'ares:startup-asset-missing'
const STARTUP_READY = 'ares:startup-ready'
const RELOAD_MARKER = 'ares:startup-reload'

export const finish_startup_recovery = (): void => {
  dispatchEvent(new Event(STARTUP_READY))
}

export const missing_asset_issue = (issue: EngineIssue | undefined): boolean => issue?.code === 'asset_missing'

export const recover_missing_asset = (engine: EngineStatus): void => {
  if (engine.state === 'failed' && missing_asset_issue(engine.issue)) dispatchEvent(new Event(ASSET_MISSING))
}

export const failed_asset_url = (error: unknown, origin: string): URL | null => {
  if (!(error instanceof Error)) return null
  const match = error.message.match(/https?:\/\/[^\s"'<>`]+/)
  if (!match) return null
  try {
    const url = new URL(match[0])
    return url.origin === origin && /^\/assets\/.+\.(?:js|css)$/.test(url.pathname) ? url : null
    // eslint-disable-next-line no-silent-failures/no-swallowed-failure -- An invalid URL is a negative classifier result, never a fetch target.
  } catch {
    return null
  }
}

/** Every automatic worker reload passes the application's synchronous transaction veto. */
export const reload_after_update = (release?: string): void => {
  try {
    if (release && sessionStorage.getItem(RELOAD_MARKER) === release) return
    if (!dispatchEvent(new CustomEvent(RELOAD_CHECK, { cancelable: true, detail: release ?? null }))) return
    if (release) sessionStorage.setItem(RELOAD_MARKER, release)
    location.reload()
  } catch (error) {
    console.warn('Automatic app reload skipped.', error)
  }
}

/** One startup lifetime, one update attempt, and no cache or wallet-storage deletion. */
export const observe_startup_recovery = (): void => {
  const release = import.meta.env.VITE_RELEASE || import.meta.url
  const original = navigator.serviceWorker?.controller
  const lifetime = new AbortController()
  let attempted = false
  let recovering = false
  let update_waiting = false
  let timeout = 0
  const stop = () => {
    recovering = false
    clearTimeout(timeout)
    lifetime.abort()
    if (update_waiting) reload_after_update(release)
  }
  const activated = () => {
    const controller = navigator.serviceWorker?.controller
    if (recovering && controller && controller !== original && controller.state === 'activated')
      reload_after_update(release)
  }
  const watch_controller = () => {
    navigator.serviceWorker.controller?.addEventListener('statechange', activated, { signal: lifetime.signal })
    activated()
  }
  const end_attempt = () => {
    recovering = false
    navigator.serviceWorker.removeEventListener('controllerchange', watch_controller)
  }
  const recover = async () => {
    if (attempted || lifetime.signal.aborted || !original) return
    attempted = true
    if (sessionStorage.getItem(RELOAD_MARKER) === release) return
    const registration = await navigator.serviceWorker.getRegistration()
    if (lifetime.signal.aborted || !registration || new URL(registration.scope).pathname !== '/') return
    recovering = true
    timeout = window.setTimeout(end_attempt, 10_000)
    navigator.serviceWorker.addEventListener('controllerchange', watch_controller, { signal: lifetime.signal })
    watch_controller()
    await registration.update()
    activated()
  }
  const request = () => {
    void recover().catch((error: unknown) => console.warn('Startup update check failed.', error))
  }
  const preload_failed = (event: Readonly<Event>) => {
    const url = failed_asset_url((event as Event & { payload?: unknown }).payload, location.origin)
    if (!original || !url || attempted || lifetime.signal.aborted) return
    void fetch(url, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(3_000) })
      .then((response) => {
        if (response.status === 404 || response.status === 410) request()
      })
      .catch((error: unknown) => console.warn('Startup asset check failed.', error))
  }
  // While booting, ordinary auto-update callbacks defer to this bounded recovery path.
  addEventListener(
    RELOAD_CHECK,
    (event) => {
      const requested_release = (event as CustomEvent<unknown>).detail
      if (requested_release === null) update_waiting = true
      if (requested_release !== release || !recovering) event.preventDefault()
    },
    { signal: lifetime.signal }
  )
  addEventListener('vite:preloadError', preload_failed, { signal: lifetime.signal })
  addEventListener(ASSET_MISSING, request, { signal: lifetime.signal })
  addEventListener(STARTUP_READY, stop, { once: true, signal: lifetime.signal })
}
