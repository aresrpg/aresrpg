// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RPC read-API client (SPEC §14) — the SINGLE fetch home for the `/v1/*` view layer.
//
// Keyless and read-only by construction: these are GETs against packages/rpc/api, which signs nothing and
// serves a re-derivable cache of public chain truth. This module owns URL building, the request timeout, the
// in-memory LRU+TTL (the app's ONLY client-side cache — never a client-side index/IndexedDB tier),
// and the ONE error shape (RpcError). It never renders or polls (see use_view.ts for reactivity); the sole UI
// side effect is one soft, localized toast after a rate-limited request's polite retry also fails. The UI-DATA
// LAW lives one layer up: callers read through use_rpc_view, never streaming, never silently stale.
//
// No package id is hardcoded here — every id travels as a caller arg or is resolved by the api from the
// indexer, so a testnet republish never touches this file (env.ts RPC_URL is the only deployment seam).

import { RPC_URL } from '../env'

import { create_world_poll_scheduler } from './world_poll_scheduler'
import type {
  ListingSort,
  RpcCharacter,
  RpcConfig,
  RpcDungeonRun,
  RpcEncyclopedia,
  RpcFight,
  RpcFightResult,
  RpcKolizeum,
  RpcListingsPage,
  RpcNames,
  RpcOwnedItem,
  RpcPendingOutcome,
  RpcPetClaim,
  RpcPool,
  RpcAirdrop,
  RpcInbox,
  RpcRareLink,
  RpcSale,
  RpcSalesHistory,
  RpcSponsorRemaining,
  RpcStatus,
  RpcZone,
  RpcZones,
} from './views'

// The one read-error shape. `code` is a stable, humanizer-friendly token; `status` is the HTTP status
// (0 = network/timeout, never reached the server). Reads do not normally auto-toast: the short-poll hook surfaces
// staleness visibly. The only exception is the one soft notice after a 429 retry also fails (one per retry wave).
export class RpcError extends Error {
  code: string
  status: number
  retry_after_seconds?: number
  constructor(code: string, status: number, message?: string, retry_after_seconds?: number) {
    super(message ?? code)
    this.name = 'RpcError'
    this.code = code
    this.status = status
    this.retry_after_seconds = retry_after_seconds
  }
}

const DEFAULT_TIMEOUT_MS = 8000

type Params = Record<string, string | number | boolean | null | undefined>

function build_url(path: string, params?: Params): string {
  const url = new URL(`${RPC_URL}${path}`)
  if (params) for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v))
  return url.toString()
}

// The ONE client-side cache (no client-side indexing, ever): a tiny in-memory LRU+TTL over GETs,
// keyed by the full URL (path+params). It absorbs burst-duplicate reads (several components mounting the same
// view, navigation re-fetches) without masking the short-poll cadence — the TTL sits BELOW the shortest
// use_rpc_view interval (4s, kolizeum.tsx), so every poll tick still reaches the network. `in_flight` dedupes
// concurrent identical GETs into ONE fetch. Errors are never cached.
const CACHE_TTL_MS = 3000
const CACHE_MAX = 100
const cache = new Map<string, { at: number; data: unknown }>() // insertion-ordered → oldest-first eviction
const in_flight = new Map<string, Promise<unknown>>()

// Seed/catalog views change on a reseed or client schema revision, not during ordinary navigation. Keep their
// promises for this JS app lifetime under an explicit version key: every encyclopedia kind shares the API's
// all-kinds response, and unscoped rare links share one authored-catalog response. A rejected load is evicted so
// a later navigation can heal. Bump this key when either response contract or seeded generation changes.
const CONTENT_CACHE_VERSION = 'catalog-v1'
const content_cache = new Map<string, Promise<unknown>>()

function content_get<T>(resource: string, load: () => Promise<T>): Promise<T> {
  const key = `${CONTENT_CACHE_VERSION}:${resource}`
  const hit = content_cache.get(key)
  if (hit) return hit as Promise<T>

  const pending = load()
  content_cache.set(key, pending)
  void pending.catch(() => {
    if (content_cache.get(key) === pending) content_cache.delete(key)
  })
  return pending
}

type RateLimitWave = {
  retry_tail: Promise<void>
  toast_shown: boolean
}

let rate_limit_wave: RateLimitWave | null = null
let rate_limit_blocked_until = 0
const endpoint_backoff_attempts = new Map<string, number>()

// #242 read-layer census: /v1/status (RpcLagBanner), /v1/sponsor/remaining (use_sponsor_allowance), and
// /v1/config (ContractsPausedModalHost's 30s maintenance poll) used to fire on raw timers OUTSIDE this
// scheduler — meaning they kept attempting fetches even while a rate-limit wave was already active elsewhere,
// piling onto the exact congestion they should have backed off from. All three now stagger-start and pause
// with every other world-poll endpoint.
const WORLD_POLL_PATHS = new Set([
  '/v1/characters',
  '/v1/parties',
  '/v1/zones',
  '/v1/fights',
  '/v1/dungeon-runs',
  '/v1/status',
  '/v1/sponsor/remaining',
  '/v1/config',
])
const poll_scheduler = create_world_poll_scheduler({
  is_paused: () =>
    (typeof document !== 'undefined' && document.hidden) ||
    rate_limit_wave != null ||
    rate_limit_blocked_until > Date.now(),
})

/** Test isolation for module-lifetime caches; production callers never need to invalidate within one app load. */
export function _reset_rpc_client_for_test(): void {
  cache.clear()
  in_flight.clear()
  content_cache.clear()
  rate_limit_wave = null
  rate_limit_blocked_until = 0
  endpoint_backoff_attempts.clear()
  poll_scheduler.reset()
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function endpoint_class(url: string): string {
  const parts = new URL(url).pathname.split('/').filter(Boolean)
  return `/${parts.slice(0, 2).join('/')}`
}

function retry_delay_ms(url: string, retry_after_seconds?: number): number {
  if (retry_after_seconds != null) {
    const base = Math.max(0, retry_after_seconds) * 1000
    return Math.ceil(base + Math.random() * 1000)
  }
  const key = endpoint_class(url)
  const attempt = endpoint_backoff_attempts.get(key) ?? 0
  endpoint_backoff_attempts.set(key, attempt + 1)
  const base = Math.min(30_000, 1000 * 2 ** attempt)
  return Math.ceil(base + Math.random() * Math.min(base, 1000))
}

function block_rate_limited_requests(delay_ms: number): void {
  rate_limit_blocked_until = Math.max(rate_limit_blocked_until, Date.now() + Math.max(0, delay_ms))
}

function new_rate_limit_wave(): RateLimitWave {
  const wave = {
    retry_tail: Promise.resolve(),
    toast_shown: false,
  }
  rate_limit_wave = wave
  return wave
}

async function show_rate_limit_failure(wave: RateLimitWave): Promise<void> {
  if (wave.toast_shown) return
  wave.toast_shown = true
  // Keep the base RPC path independent of the toast/reporting bundle; load it only for the terminal retry
  // failure. `rpc.unavailable` already exists in all six locales and `info` makes this a soft, non-alarm toast.
  try {
    const [{ default: i18n }, { use_toast }] = await Promise.all([import('../i18n'), import('../toast')])
    use_toast.getState().add(i18n.t('rpc.unavailable'), 'info')
  } catch {
    // A failed optional UI import must never replace the original RPC error seen by the caller.
  }
}

// Core GET → parsed `data`, through the LRU. Throws RpcError on network failure, timeout, non-2xx, or
// unparseable body — one funnel so every view fetcher fails identically. A shared (deduped) fetch deliberately
// ignores callers' AbortSignals mid-flight — a shared result must not die with one caller; the signal is only
// honored at entry, and use_rpc_view already drops superseded results via its own cancelled flag.
//
// `fresh` (default false) skips the LRU READ only — a caller that already knows it wants post-tx chain truth
// (a bounded reconcile-wait right after the caller's OWN write, e.g. CompassStrip's post-search refresh) sets
// it so a poller elsewhere that warmed this exact URL <CACHE_TTL_MS ago can never hand back its pre-write
// snapshot. The response still WRITES the cache, so the next normal (non-fresh) poll inherits it for free.
export async function rpc_get<T>(path: string, params?: Params, signal?: AbortSignal, fresh = false): Promise<T> {
  if (signal?.aborted) throw new DOMException('rpc_get aborted before start', 'AbortError')
  const key = build_url(path, params)
  if (!fresh) {
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data as T
  }

  let pending = in_flight.get(key)
  const scheduled_poll = WORLD_POLL_PATHS.has(new URL(key).pathname)
  if (pending && fresh && scheduled_poll) poll_scheduler.promote(key)
  if (!pending) {
    const load = () => fetch_json(key)
    pending = (scheduled_poll ? poll_scheduler.schedule(key, load, fresh) : load())
      .then((data) => {
        cache.delete(key) // re-insert so the freshest entry sits last (LRU order)
        cache.set(key, { at: Date.now(), data })
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
        return data
      })
      .finally(() => in_flight.delete(key))
    in_flight.set(key, pending)
  }
  return pending as Promise<T>
}

async function retry_rate_limited(url: string, delay_ms: number): Promise<unknown> {
  const wave = rate_limit_wave ?? new_rate_limit_wave()
  const retry_not_before = Date.now() + delay_ms
  block_rate_limited_requests(delay_ms)
  // Every distinct URL joins one promise tail and keeps its own Retry-After deadline; a later 429 extends the
  // shared floor for every queued retry. Attempts issue sequentially; identical URLs share `in_flight`.
  const attempt = wave.retry_tail.then(async () => {
    const remaining_ms = Math.max(retry_not_before, rate_limit_blocked_until) - Date.now()
    if (remaining_ms > 0) await wait(remaining_ms)
    return fetch_json_once(url)
  })
  const queue_end = attempt.then(
    () => undefined,
    () => undefined
  )
  wave.retry_tail = queue_end
  void queue_end.finally(() => {
    if (rate_limit_wave === wave && wave.retry_tail === queue_end) rate_limit_wave = null
  })

  try {
    return await attempt
  } catch (error) {
    if (error instanceof RpcError && error.status === 429)
      block_rate_limited_requests(retry_delay_ms(url, error.retry_after_seconds))
    await show_rate_limit_failure(wave)
    throw error
  }
}

function valid_retry_after(value: unknown): number | null {
  if (value == null || value === '') return null
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

function retry_after_header_seconds(value: string | null): number | null {
  const delta_seconds = valid_retry_after(value)
  if (delta_seconds != null) return delta_seconds
  const retry_at = value == null ? Number.NaN : Date.parse(value)
  return Number.isFinite(retry_at) ? Math.max(0, (retry_at - Date.now()) / 1000) : null
}

async function rate_limit_seconds(res: Response): Promise<number | null> {
  const header_seconds = retry_after_header_seconds(res.headers.get('retry-after'))
  let body_seconds: number | null = null
  try {
    const body = (await res.json()) as { retry_after_seconds?: unknown }
    body_seconds = valid_retry_after(body?.retry_after_seconds)
  } catch {
    // A proxy may replace the JSON body; the standards-based header was captured before parsing it.
  }
  return header_seconds ?? body_seconds
}

async function wait_for_rate_limit_gate(): Promise<void> {
  while (true) {
    const wave = rate_limit_wave
    if (wave) await wave.retry_tail
    const remaining_ms = rate_limit_blocked_until - Date.now()
    if (remaining_ms > 0) await wait(remaining_ms)
    if (rate_limit_wave == null && rate_limit_blocked_until <= Date.now()) return
  }
}

async function fetch_json(url: string): Promise<unknown> {
  if (rate_limit_wave != null || rate_limit_blocked_until > Date.now()) await wait_for_rate_limit_gate()
  try {
    return await fetch_json_once(url)
  } catch (error) {
    if (!(error instanceof RpcError) || error.status !== 429) throw error
    return retry_rate_limited(url, retry_delay_ms(url, error.retry_after_seconds))
  }
}

async function fetch_json_once(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new RpcError('RPC_TIMEOUT', 0)), DEFAULT_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url, { method: 'GET', signal: controller.signal })
  } catch (e) {
    throw new RpcError('RPC_UNAVAILABLE', 0, (e as Error)?.message)
  } finally {
    clearTimeout(timeout)
  }

  if (res.status === 429)
    throw new RpcError('RPC_RATE_LIMITED', 429, undefined, (await rate_limit_seconds(res)) ?? undefined)
  if (res.status === 503) throw new RpcError('RPC_DEGRADED', 503)
  if (!res.ok) throw new RpcError('RPC_UNAVAILABLE', res.status, `HTTP ${res.status}`)

  try {
    const data = await res.json()
    endpoint_backoff_attempts.delete(endpoint_class(url))
    return data
  } catch {
    throw new RpcError('RPC_BAD_RESPONSE', res.status)
  }
}

// --- typed view fetchers -----------------------------------------------------
// Each returns the unwrapped domain slice (the array/object a surface renders), not the transport envelope.
// Signatures accept an optional AbortSignal, honored at call entry (mid-flight fetches are shared across
// callers; use_rpc_view discards superseded results itself).

export const get_status = (signal?: AbortSignal) => rpc_get<RpcStatus>('/v1/status', undefined, signal)

export async function get_characters(
  query: { ids?: string[]; id?: string; owner?: string },
  signal?: AbortSignal,
  fresh = false
): Promise<RpcCharacter[]> {
  const params: Params =
    query.owner != null ? { owner: query.owner } : { ids: (query.ids ?? (query.id ? [query.id] : [])).join(',') }
  const { characters } = await rpc_get<{ characters: RpcCharacter[] }>('/v1/characters', params, signal, fresh)
  return characters
}

// A wallet's loose (unequipped) Item bag — UNIONED across the personal kiosks it owns, served
// from the indexer's owner→kiosk→items join (the architectural home of read_staking.js's chain
// walk). Returns the bare rows array; the caller derives `stackable` from `item_category`.
export async function get_owner_items(address: string, signal?: AbortSignal): Promise<RpcOwnedItem[]> {
  const { items } = await rpc_get<{ items: RpcOwnedItem[] }>('/v1/owner-items', { address }, signal)
  return items
}

export async function get_listings(
  query: {
    category?: string
    min_level?: number
    max_level?: number
    sort?: ListingSort
    limit?: number
    cursor?: number
  } = {},
  signal?: AbortSignal
): Promise<RpcListingsPage> {
  return rpc_get<RpcListingsPage>('/v1/listings', query, signal)
}

// Seller-side realised sales + trailing-30d revenue (SPEC §14). Returns the WHOLE envelope (like
// get_listings) — the History panel needs `revenue_30d_mist` + `next_cursor` beside the rows. `seller` is
// required (the api 400s otherwise); the growing-window pager bumps `limit` (server clamps to 1..200) and
// reads `next_cursor` to know whether older sales remain beyond the window.
export async function get_sales_history(
  query: { seller: string; limit?: number; cursor?: number },
  signal?: AbortSignal
): Promise<RpcSalesHistory> {
  return rpc_get<RpcSalesHistory>('/v1/sales-history', query, signal)
}

export async function get_pools(template?: string, signal?: AbortSignal): Promise<RpcPool[]> {
  const { pools } = await rpc_get<{ pools: RpcPool[] }>('/v1/pools', { template }, signal)
  return pools
}

export type RpcTauxRow = {
  template_id: string
  coeff_milli: number
  coeff_percent: number
  recipe_less: boolean
  source: 'neutral' | 'crushed'
}

// Forgemagie taux ("taux de brisage") — the effective crush coefficient per gear TEMPLATE id (milli-percent;
// 100% = 100_000; never-crushed templates come back at the neutral default). Feeds the crush confirm modal's
// yield preview (crush_actions.crush_preview). Batch-by-ids variant; the single-template envelope read below
// (`get_taux`) predates it and keeps its name — two endpoints shapes, two homes.
export async function get_taux_rows(ids: string[], signal?: AbortSignal): Promise<RpcTauxRow[]> {
  const { taux } = await rpc_get<{ taux: RpcTauxRow[] }>('/v1/taux', { ids: ids.join(',') }, signal)
  return taux
}

export async function get_shop(active = false, signal?: AbortSignal): Promise<RpcSale[]> {
  const { sales } = await rpc_get<{ sales: RpcSale[] }>('/v1/shop', { active }, signal)
  return sales
}

export const get_zones = (world: string, signal?: AbortSignal, fresh = false) =>
  rpc_get<RpcZones>('/v1/zones', { world }, signal, fresh)

// Single-zone read WITH its raw zone STATE (seed + consumed-bitmaps — the search-cost rework's Zone DF shape)
// for the RENDER consumers (world_spawns.js/CompassStrip.jsx/embed_voxel_dev.js); gather_actions.js keeps a
// chain-direct read (tx pre-flight needs the freshest consumption state). `null` on an undiscovered zone (the
// server returns an empty `zones` array) — the same honest "unsearched" signal the chain-direct read gives via
// its missing DF. Feed the result into game/zone_rows.js (the seed-derivation home) to obtain the spawn rows.
export async function get_zone(
  world: string,
  zx: number,
  zy: number,
  signal?: AbortSignal,
  fresh = false
): Promise<RpcZone | null> {
  const { zones } = await rpc_get<RpcZones>('/v1/zones', { world, zone: `${zx}:${zy}` }, signal, fresh)
  return zones[0] ?? null
}

// §6 golden-gather odds legibility (encyclopedia). `world` omitted → every live world's links.
export async function get_rare_links(world?: string, signal?: AbortSignal): Promise<RpcRareLink[]> {
  if (signal?.aborted) throw new DOMException('get_rare_links aborted before start', 'AbortError')
  const load = () => rpc_get<{ rare_links: RpcRareLink[] }>('/v1/rare-links', { world }, signal)
  const { rare_links } = world ? await load() : await content_get('rare-links:all', load)
  return rare_links
}

export function get_encyclopedia(
  _kind?: 'items' | 'mobs' | 'worlds' | 'recipes',
  signal?: AbortSignal
): Promise<RpcEncyclopedia> {
  if (signal?.aborted) return Promise.reject(new DOMException('get_encyclopedia aborted before start', 'AbortError'))
  // Omitting `kind` is the API's supported batch form: items+mobs+worlds+recipes in one envelope.
  return content_get('encyclopedia:all', () => rpc_get<RpcEncyclopedia>('/v1/encyclopedia', undefined, signal))
}

export const get_config = (signal?: AbortSignal) => rpc_get<RpcConfig>('/v1/config', undefined, signal)

export async function get_kolizeums(
  query: { id?: string; status?: string } = {},
  signal?: AbortSignal
): Promise<RpcKolizeum[]> {
  const { kolizeums } = await rpc_get<{ kolizeums: RpcKolizeum[] }>('/v1/kolizeum', query, signal)
  return kolizeums
}

export async function get_dungeon_runs(
  query: { owner?: string; pass?: string },
  signal?: AbortSignal
): Promise<RpcDungeonRun[]> {
  const { runs } = await rpc_get<{ runs: RpcDungeonRun[] }>('/v1/dungeon-runs', query, signal)
  return runs
}

// `fresh` (#1317) — the world-fights discovery poll is the ONE read racing a fight's ~60s placement window, so
// it declares itself: no 3s-old LRU snapshot, and the head of the world-poll FIFO instead of a seat behind the
// 3×3 zone neighbourhood's nine staggered reads (9 × WORLD_POLL_STAGGER_MS is most of the measured lag).
export async function get_fights(
  query: { id?: string; character?: string; world?: string },
  signal?: AbortSignal,
  fresh = false
): Promise<RpcFight[]> {
  const { fights } = await rpc_get<{ fights: RpcFight[] }>('/v1/fights', query, signal, fresh)
  return fights
}

export async function get_fight_results(owner: string, signal?: AbortSignal): Promise<RpcFightResult[]> {
  const { results } = await rpc_get<{ results: RpcFightResult[] }>('/v1/fight-results', { owner }, signal)
  return results
}

// UNOPENED fight results (soulbound `settlement::FightOutcome`s minted by settle, not yet opened) — the
// PERMANENT post-settle surface the roster pill reads (views.ts RpcPendingOutcome). Envelope-tolerant while the
// projection lane lands the route: accepts `{ outcomes: [...] }` (house convention) or a bare array.
export async function get_pending_outcomes(owner: string, signal?: AbortSignal): Promise<RpcPendingOutcome[]> {
  const body = await rpc_get<{ outcomes?: RpcPendingOutcome[] } | RpcPendingOutcome[]>(
    '/v1/pending-outcomes',
    { owner },
    signal
  )
  return Array.isArray(body) ? body : (body?.outcomes ?? [])
}

// Unclaimed pet-box claims (interrupted opens) — docs/V1_SWEEP_PLAN.md §3 item 9, PROJECTED: the
// soulbound PetBoxClaim is object-snapshotted (create+delete) by the indexer, no kiosk join possible.
// Bare array (mirrors get_pending_outcomes' frozen contract); `[]` for a wallet with nothing pending.
export const get_pet_claims = (owner: string, signal?: AbortSignal) =>
  rpc_get<RpcPetClaim[]>('/v1/pet-claims', { owner }, signal)

// D52 — SuiNS reverse resolution (address → default @handle, display-only). Dedupes + drops empties
// so a caller can pass a raw row-mapped address list untouched; short-circuits to {} without a
// request when nothing's left (the LRU above absorbs repeat calls for the same address SET — see
// rpc/use_address_names.ts, the ONE place that calls this, for the batching contract).
export async function get_names(addresses: (string | null | undefined)[], signal?: AbortSignal): Promise<RpcNames> {
  const unique = [...new Set(addresses.filter((a): a is string => !!a))]
  if (unique.length === 0) return {}
  return rpc_get<RpcNames>('/v1/names', { addresses: unique.join(',') }, signal)
}

// Per-zkLogin daily FREE-GAMEPLAY sponsor allowance remaining (the sidebar bar + the pre-fight hint +
// the run-out modal's countdown all read this ONE view). `spent_mist` is the shared counter the sponsor
// INCRBYs per grant; `remaining_mist` = max(0, allowance − spent); `resets_at` = next UTC midnight.
export const get_sponsor_remaining = (address: string, signal?: AbortSignal) =>
  rpc_get<RpcSponsorRemaining>('/v1/sponsor/remaining', { address }, signal)

// A wallet's escrow-recoverable item gifts — INCOMING (claimable) + OUTGOING (recallable). Planned indexer
// view (docs/ITEM_SEND_PLAN.md §A5); NOT live yet, so the caller (stores/inbox.ts) catches the RpcError and
// degrades to an honest empty state until the route lands. `{ incoming, outgoing }` per RpcInbox.
export const get_inbox = (address: string, signal?: AbortSignal) => rpc_get<RpcInbox>('/v1/inbox', { address }, signal)

// Live whitelist claim-mint airdrops + per-address eligibility for the sidebar page. `addresses` is the
// connected identity set (the zkLogin address AND an optional connected external wallet); the
// view returns each drop's `eligible_for` subset. Planned indexer view (docs/ITEM_SEND_PLAN.md Part B); NOT
// live yet, so the caller degrades to "no active airdrops".
export async function get_airdrops(addresses: string[], signal?: AbortSignal): Promise<RpcAirdrop[]> {
  const { airdrops } = await rpc_get<{ airdrops: RpcAirdrop[] }>(
    '/v1/airdrops',
    { addresses: addresses.join(',') },
    signal
  )
  return airdrops
}
