import { describe, expect, test } from 'bun:test'

import {
  CHUNK_RELOAD_GUARD_KEY,
  install_stale_deploy_recovery,
  request_service_worker_update,
} from './stale_deploy_recovery'

function make_storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

function make_preload_error() {
  return Object.assign(new Event('vite:preloadError', { cancelable: true }), {
    payload: new Error('preload failed'),
  })
}

const settle_recovery = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('stale deploy recovery', () => {
  test('preloadError reloads once, then the same build shows world_load_failed', async () => {
    const storage = make_storage()
    const first_target = new EventTarget()
    const first_calls: string[] = []

    install_stale_deploy_recovery({
      target: first_target,
      storage,
      build_id: 'build-a',
      update_service_worker: async () => {
        first_calls.push('update')
      },
      reload: () => first_calls.push('reload'),
      show_world_load_failed: () => first_calls.push('toast'),
    })

    const first_error = make_preload_error()
    first_target.dispatchEvent(first_error)
    await settle_recovery()

    expect(first_error.defaultPrevented).toBe(true)
    expect(first_calls).toEqual(['update', 'reload'])
    expect(storage.getItem(CHUNK_RELOAD_GUARD_KEY)).toBe('build-a')
    expect(Number(storage.getItem(CHUNK_RELOAD_GUARD_KEY))).toBeNaN()

    // A fresh listener represents the module booting again after location.reload().
    const second_target = new EventTarget()
    const second_calls: string[] = []
    install_stale_deploy_recovery({
      target: second_target,
      storage,
      build_id: 'build-a',
      update_service_worker: async () => {
        second_calls.push('update')
      },
      reload: () => second_calls.push('reload'),
      show_world_load_failed: () => second_calls.push('toast'),
    })

    second_target.dispatchEvent(make_preload_error())
    await settle_recovery()

    expect(second_calls).toEqual(['toast'])
  })

  test('a later build gets its own single recovery', async () => {
    const storage = make_storage()
    storage.setItem(CHUNK_RELOAD_GUARD_KEY, 'build-a')
    const target = new EventTarget()
    const calls: string[] = []

    install_stale_deploy_recovery({
      target,
      storage,
      build_id: 'build-b',
      update_service_worker: async () => {
        calls.push('update')
      },
      reload: () => calls.push('reload'),
      show_world_load_failed: () => calls.push('toast'),
    })

    target.dispatchEvent(make_preload_error())
    await settle_recovery()

    expect(calls).toEqual(['update', 'reload'])
    expect(storage.getItem(CHUNK_RELOAD_GUARD_KEY)).toBe('build-b')
  })

  test('window error and unhandledrejection fallbacks only catch chunk failures', async () => {
    const storage = make_storage()
    const target = new EventTarget()
    let reloads = 0

    install_stale_deploy_recovery({
      target,
      storage,
      build_id: 'error-build',
      update_service_worker: async () => {},
      reload: () => reloads++,
      show_world_load_failed: () => {},
    })

    target.dispatchEvent(Object.assign(new Event('error'), { error: new Error('ordinary render failure') }))
    target.dispatchEvent(
      Object.assign(new Event('unhandledrejection'), {
        reason: new Error('Failed to fetch dynamically imported module: /assets/sdk-old.js'),
      })
    )
    await settle_recovery()

    expect(reloads).toBe(1)

    const error_target = new EventTarget()
    let error_reloads = 0
    install_stale_deploy_recovery({
      target: error_target,
      storage: make_storage(),
      build_id: 'window-error-build',
      update_service_worker: async () => {},
      reload: () => error_reloads++,
      show_world_load_failed: () => {},
    })
    error_target.dispatchEvent(
      Object.assign(new Event('error'), {
        message: 'Importing a module script failed',
      })
    )
    await settle_recovery()

    expect(error_reloads).toBe(1)
  })

  test('the service-worker request updates and sends SKIP_WAITING', async () => {
    const service_worker = new EventTarget() as EventTarget & {
      getRegistration: () => Promise<ServiceWorkerRegistration>
    }
    const messages: unknown[] = []
    let updates = 0
    const registration = {
      installing: null,
      waiting: { postMessage: (message: unknown) => messages.push(message) },
      update: async () => {
        updates++
        service_worker.dispatchEvent(new Event('controllerchange'))
        return registration
      },
    } as unknown as ServiceWorkerRegistration
    service_worker.getRegistration = async () => registration

    await request_service_worker_update(service_worker as ServiceWorkerContainer)

    expect(updates).toBe(1)
    expect(messages).toEqual([{ type: 'SKIP_WAITING' }, { type: 'SKIP_WAITING' }])
  })
})
