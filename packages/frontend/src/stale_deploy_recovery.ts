// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import i18n from './i18n'
import { use_toast } from './toast'

export const CHUNK_RELOAD_GUARD_KEY = 'chunk_reload_at'

const CHUNK_LOAD_FAILURE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i
const SKIP_WAITING_MESSAGE = { type: 'SKIP_WAITING' } as const
const CONTROL_CHANGE_TIMEOUT_MS = 5_000

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem'>
type RecoveryTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

interface RecoveryOptions {
  target: RecoveryTarget
  storage: RecoveryStorage
  build_id: string
  update_service_worker: () => Promise<void>
  reload: () => void
  show_world_load_failed: () => void
}

interface ChunkErrorEvent extends Event {
  error?: unknown
  message?: string
  payload?: unknown
  reason?: unknown
}

function chunk_error_message(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'message' in value) {
    return String((value as { message?: unknown }).message ?? '')
  }
  return String(value ?? '')
}

export function is_chunk_load_failure(value: unknown): boolean {
  return CHUNK_LOAD_FAILURE.test(chunk_error_message(value))
}

function send_skip_waiting(registration: ServiceWorkerRegistration) {
  const worker = registration.waiting ?? registration.installing
  worker?.postMessage(SKIP_WAITING_MESSAGE)
  return worker
}

export async function request_service_worker_update(
  service_worker: ServiceWorkerContainer,
  control_change_timeout_ms = CONTROL_CHANGE_TIMEOUT_MS
) {
  let registration: ServiceWorkerRegistration | undefined
  try {
    registration = await service_worker.getRegistration()
  } catch {
    return
  }
  if (!registration) return

  let controller_changed = false
  let resolve_controller_change = () => {}
  const controller_change = new Promise<void>((resolve) => {
    resolve_controller_change = resolve
  })
  const on_controller_change = () => {
    controller_changed = true
    resolve_controller_change()
  }
  service_worker.addEventListener('controllerchange', on_controller_change)

  let timeout_id: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolve) => {
    timeout_id = setTimeout(resolve, control_change_timeout_ms)
  })

  try {
    // Wake an update that was already waiting, then force a no-cache update check for the latest deploy.
    send_skip_waiting(registration)
    const update_and_activate = (async () => {
      try {
        await registration.update()
      } catch {
        // The guarded reload remains the final recovery attempt when an update check itself fails.
      }
      const update_worker = send_skip_waiting(registration)
      if (update_worker && !controller_changed) await controller_change
    })()
    await Promise.race([update_and_activate, timeout])
  } finally {
    if (timeout_id !== undefined) clearTimeout(timeout_id)
    service_worker.removeEventListener('controllerchange', on_controller_change)
  }
}

export function install_stale_deploy_recovery({
  target,
  storage,
  build_id,
  update_service_worker,
  reload,
  show_world_load_failed,
}: RecoveryOptions) {
  let recovery_started = false

  const recover = () => {
    if (recovery_started) return
    recovery_started = true

    try {
      if (storage.getItem(CHUNK_RELOAD_GUARD_KEY) === build_id) {
        show_world_load_failed()
        return
      }
      // A non-numeric build marker also disables the legacy app boundary's timestamp reload path.
      storage.setItem(CHUNK_RELOAD_GUARD_KEY, build_id)
    } catch {
      // If persistence is unavailable, fail closed: a reload without a durable guard could loop forever.
      show_world_load_failed()
      return
    }

    void Promise.resolve()
      .then(update_service_worker)
      .catch(() => {})
      .then(reload)
  }

  const on_preload_error: EventListener = (event) => {
    // Vite rethrows the failed import unless this cancelable hook is prevented synchronously.
    event.preventDefault()
    recover()
  }
  const on_error: EventListener = (event) => {
    const chunk_event = event as ChunkErrorEvent
    if (is_chunk_load_failure(chunk_event.error ?? chunk_event.message)) recover()
  }
  const on_unhandled_rejection: EventListener = (event) => {
    const chunk_event = event as ChunkErrorEvent
    if (is_chunk_load_failure(chunk_event.reason)) recover()
  }

  target.addEventListener('vite:preloadError', on_preload_error)
  target.addEventListener('error', on_error)
  target.addEventListener('unhandledrejection', on_unhandled_rejection)

  return () => {
    target.removeEventListener('vite:preloadError', on_preload_error)
    target.removeEventListener('error', on_error)
    target.removeEventListener('unhandledrejection', on_unhandled_rejection)
  }
}

if (typeof window !== 'undefined') {
  install_stale_deploy_recovery({
    target: window,
    storage: {
      getItem: (key) => window.sessionStorage.getItem(key),
      setItem: (key, value) => window.sessionStorage.setItem(key, value),
    },
    build_id: import.meta.url,
    update_service_worker: () =>
      'serviceWorker' in navigator ? request_service_worker_update(navigator.serviceWorker) : Promise.resolve(),
    reload: () => window.location.reload(),
    show_world_load_failed: () => use_toast.getState().add(i18n.t('errors.world_load_failed'), 'error'),
  })
}
