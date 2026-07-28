// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { configure_assets } from '@aresrpg/sdk/jobs'

// ── THE ONE HOME for loading the asset manifest (regression: icons intermittently required a
// full refresh to appear, or vanished on page switch). ──────────────────────────
// The resolver config (@aresrpg/sdk/jobs assets_config.classes) is process-wide MODULE STATE seeded from
// /asset_manifest.json. A single failed/partial boot fetch used to leave that state EMPTY forever: every
// icon resolved to null → the /assets fallback 404'd → blank tiles app-wide, and ONLY a full page reload
// (a fresh boot = a fresh fetch) recovered. That is a CACHED ABSENCE — banned by the house law (empty /
// negative results are never truth). This module owns the fetch so absence is NEVER cached: it retries
// with backoff, keeps the failure RETRYABLE (never an empty manifest), and on a (late) recovery it
// re-configures the resolver and NOTIFIES subscribers so mounted consumers re-resolve without a refresh.

export type AssetManifestStatus = 'pending' | 'ready' | 'retryable'

export interface LoadAssetManifestOptions {
  url?: string
  fetch_impl?: typeof fetch
  attempts?: number
  delay_ms?: number
  sleep?: (ms: number) => Promise<void>
  schedule?: (fn: () => void | Promise<void>, ms: number) => void
  background?: boolean
}

const state: { status: AssetManifestStatus; version: number } = { status: 'pending', version: 0 }
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

/** External-store subscription for image consumers (useSyncExternalStore-compatible). */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The version bumps every time the manifest (re)configures the resolver — a late recovery included. */
export function get_asset_manifest_version(): number {
  return state.version
}

export function asset_manifest_status(): AssetManifestStatus {
  return state.status
}

function apply_manifest(manifest: unknown): void {
  configure_assets(manifest as Parameters<typeof configure_assets>[0])
  state.status = 'ready'
  state.version += 1
  notify()
}

async function try_fetch(fetch_impl: typeof fetch, url: string): Promise<boolean> {
  try {
    const response = await fetch_impl(url)
    if (!response.ok) return false
    apply_manifest(await response.json())
    return true
  } catch {
    return false
  }
}

const default_url = (): string =>
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_ASSETS_MANIFEST_URL || '/asset_manifest.json'

const default_sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const default_schedule = (fn: () => void | Promise<void>, ms: number): void => {
  setTimeout(() => {
    void fn()
  }, ms)
}

const BACKGROUND_RETRY_CEILING_MS = 30_000

// One background retry loop at a time; the failure stays RETRYABLE until a fetch finally lands (never a
// cached empty). A late success re-configures the resolver and notifies subscribers, so already-mounted
// consumers re-resolve their blank tiles into art without any page refresh.
let background_running = false

function start_background_retry(
  fetch_impl: typeof fetch,
  url: string,
  delay_ms: number,
  schedule: (fn: () => void | Promise<void>, ms: number) => void
): void {
  if (background_running) return
  background_running = true
  let attempt = 0
  const tick = async () => {
    if (state.status === 'ready' || (await try_fetch(fetch_impl, url))) {
      background_running = false
      return
    }
    attempt += 1
    schedule(tick, Math.min(delay_ms * 2 ** attempt, BACKGROUND_RETRY_CEILING_MS))
  }
  schedule(tick, Math.min(delay_ms, BACKGROUND_RETRY_CEILING_MS))
}

/**
 * Load the manifest before React mounts. Awaited by main.tsx so the resolver config settles pre-render.
 * A transient boot failure is retried with backoff (the intermittent cold-edge/offline hiccup
 * seen in the field); if the blocking attempts exhaust, the app still mounts (bootable) but the failure is kept
 * RETRYABLE and a background retry keeps trying — absence is NEVER frozen as an empty manifest.
 */
export async function load_asset_manifest(options: LoadAssetManifestOptions = {}): Promise<boolean> {
  const {
    url = default_url(),
    fetch_impl = globalThis.fetch,
    attempts = 3,
    delay_ms = 250,
    sleep = default_sleep,
    schedule = default_schedule,
    background = true,
  } = options

  for (let i = 0; i < attempts; i += 1) {
    if (await try_fetch(fetch_impl, url)) return true
    if (i < attempts - 1) await sleep(delay_ms * 2 ** i)
  }

  state.status = 'retryable'
  if (background) start_background_retry(fetch_impl, url, delay_ms, schedule)
  return false
}

/** Test isolation for this module-lifetime state; production callers never re-load within one app load. */
export function reset_asset_manifest_for_test(): void {
  state.status = 'pending'
  state.version = 0
  background_running = false
  listeners.clear()
}
