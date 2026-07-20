// ─────────────────────────────────────────────────────────────────────────────
//  report.js — the SINGLE error-reporting choke (Sentry init + report_error · pre-testnet law)
// ─────────────────────────────────────────────────────────────────────────────
//  ONE home for every "loud to us" outcome. The convention (docs/ERRORS.md): a catch block either
//  rethrows, or calls report_error + shows ONE humanized toast, or is a declared `// benign:`. Raw
//  console.error/warn in app code is a convention violation — game_log (context) or report_error
//  (the actual error event) are the only outlets.
//
//  ERRORS-ONLY by construction: we NEVER add browserTracingIntegration or the Session Replay
//  integration (bundle + privacy weight we won't pay) — leaving them out IS the errors-only
//  scope; the only default we DROP is GlobalHandlers, because we wire window.onerror /
//  unhandledrejection through report_error ourselves (one choke, no double-capture).
//
//  Init is a hard NO-OP without a DSN (dev/local by default), so nothing ever phones home unasked.
//  When live: environment = VITE_NETWORK, release = the git sha, user = the short wallet address
//  (pseudonymous on-chain data — never email/Google). Every game_log entry becomes a Sentry
//  breadcrumb, so the last ~50 game events ride along with each reported error — that is the pairing.

import * as Sentry from '@sentry/react'

import { parse_move_abort } from '../game/core/abort_copy.js'
import { SENTRY_DSN, NETWORK } from '../env'

import { set_breadcrumb_sink, get_log_buffer } from './log.js'

// The git sha, injected by vite `define` (see vite.config.ts __GIT_SHA__ — git rev-parse, falling back to
// pkg.version). `typeof` guards the non-Vite (bun test / node script) context where the define is absent.
const RELEASE = typeof __GIT_SHA__ !== 'undefined' ? __GIT_SHA__ : 'dev'

let live = false
let handlers_installed = false

/** Is Sentry initialised? (report_error / set_report_user are hard no-ops until then.) */
export function is_reporting_live() {
  return live
}

// ── the beforeSend filter (PURE — exported for unit tests; never sends) ──────────────────────────
// DROP: user-rejected wallet signatures (the player chose no — not an error), benign AbortErrors
// (cancelled fetch / poll), and browser-extension noise (ResizeObserver loop, cross-origin "Script
// error.", frames served from *-extension://). FINGERPRINT: an on-chain MoveAbort groups by
// `package::module::abort_code` so Sentry buckets by CONTRACT failure, not localized message text.

/** Pull the human message off an event's first exception value (jargon tolerated — this is dev-facing). */
function event_message(/** @type {any} */ event) {
  const v = event?.exception?.values?.[0]
  return `${v?.type ?? ''}: ${v?.value ?? ''}`
}

/** Does ANY stack frame come from a browser extension? (extension noise the app can't fix.) */
function has_extension_frame(/** @type {any} */ event) {
  const values = event?.exception?.values
  if (!Array.isArray(values)) return false
  return values.some((v) =>
    (v?.stacktrace?.frames ?? []).some((f) => /(?:chrome|moz|safari(?:-web)?)-extension:\/\//i.test(f?.filename ?? ''))
  )
}

/**
 * Should this event be dropped before it ever leaves the browser? PURE over (originalException, event).
 * @param {unknown} original the raw thrown value (hint.originalException)
 * @param {any} [event] the Sentry event (for stack-frame inspection)
 */
export function should_drop(original, event) {
  const e = /** @type {any} */ (original)
  // name only off real objects — a primitive's constructor.name ('String') would pollute the message match
  const name = (e != null && typeof e === 'object' && (e.name ?? e.constructor?.name)) || ''
  if (name === 'AbortError') return true
  const msg = `${name} ${typeof e === 'string' ? e : (e?.message ?? '')} ${event ? event_message(event) : ''}`.trim()
  // wallet sign-in rejection — the user declined the popup; not our error.
  if (/user rejected|user denied|rejected the request|user cancel(?:l)?ed|USER_REJECT/i.test(msg)) return true
  // well-known benign browser noise.
  if (/ResizeObserver loop|Non-Error promise rejection captured|^:?\s*Script error\.?\s*$/i.test(msg)) return true
  if (event && has_extension_frame(event)) return true
  // S-84 maintenance dark-ship pause (`version::assert_enabled`, module "version" code 102 — the SAME shape
  // across every package): expected/actionable via the CONTRACTS PAUSED modal (contracts_paused_modal.tsx),
  // never an error we get paged for. EWrongVersion (101, a stale-client cache) is a real bug and stays reported.
  const abort = parse_move_abort(original)
  if (abort?.module === 'version' && abort?.code === 102) return true
  return false
}

/** The MoveAbort fingerprint for grouping (or null when the error isn't an on-chain abort). PURE. */
export function move_abort_fingerprint(/** @type {unknown} */ original, /** @type {any} */ event) {
  const ab = parse_move_abort(original) ?? (event ? parse_move_abort(event_message(event)) : null)
  return ab ? [`${ab.package ?? 'aresrpg'}::${ab.module}::${ab.code}`] : null
}

/** Sentry `beforeSend` — drop benign classes, fingerprint MoveAborts. Returns null to drop. PURE. */
export function before_send(/** @type {any} */ event, /** @type {any} */ hint) {
  const original = hint?.originalException
  if (should_drop(original, event)) return null
  const fp = move_abort_fingerprint(original, event)
  if (fp) event.fingerprint = fp
  return event
}

// ── init ─────────────────────────────────────────────────────────────────────
/**
 * Initialise Sentry — a hard NO-OP without a DSN. Production call site: `init_reporting()` in main.tsx.
 * Tests / the headless proof pass an explicit config (dsn + a capturing transport) so nothing hits the
 * real DSN. Returns true when it actually armed.
 * @param {{ dsn?: string, environment?: string, release?: string, transport?: any }} [config]
 */
export function init_reporting(config = {}) {
  const dsn = config.dsn ?? SENTRY_DSN
  if (!dsn) return false // no DSN ⇒ never init (dev/local default) — nothing phones home
  // DEV never phones home even with a DSN in .env (ad-blockers spam the console with blocked
  // envelopes, and local errors are noise in the project). Explicit config (tests) bypasses.
  if (!config.dsn && import.meta.env.DEV) return false
  Sentry.init({
    dsn,
    environment: config.environment ?? NETWORK,
    release: config.release ?? RELEASE,
    // ERRORS-ONLY: browserTracing + Replay are opt-in integrations we deliberately never add. We only
    // DROP GlobalHandlers (we wire window.onerror / unhandledrejection → report_error ourselves).
    integrations: (defaults) => defaults.filter((i) => i.name !== 'GlobalHandlers'),
    beforeSend: before_send,
    ...(config.transport ? { transport: config.transport } : {}),
  })
  live = true
  // every game_log entry → a Sentry breadcrumb (the pairing). Category = the bracket namespace.
  set_breadcrumb_sink((entry) =>
    Sentry.addBreadcrumb({ category: entry.ns, message: entry.message, level: 'info', timestamp: entry.t / 1000 })
  )
  install_global_handlers()
  return true
}

/** Wire the two global surfaces through the ONE choke (idempotent; browser-only). */
function install_global_handlers() {
  if (handlers_installed || typeof window === 'undefined') return
  handlers_installed = true
  window.addEventListener('error', (event) => {
    report_error(event.error ?? event.message, { area: 'window.onerror', uncaught: true })
  })
  window.addEventListener('unhandledrejection', (event) => {
    report_error(event.reason, { area: 'unhandledrejection', uncaught: true })
  })
}

// ── the choke ────────────────────────────────────────────────────────────────
/** Short pseudonymous form of a Sui address for the Sentry username: 0x1234…cdef. */
function short_addr(/** @type {string} */ address) {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

/**
 * THE single place an error becomes a Sentry event. No-op until Sentry is live. The player-facing side
 * (a humanized toast via abort_copy) is the CALLER's job — this is purely "loud to us".
 * @param {unknown} err the RAW machine error (never the humanized copy — we want the real cause here)
 * @param {{ area?: string, action?: string, world?: string, character_id?: string, digest?: string,
 *   uncaught?: boolean, [k: string]: unknown }} [context] structured tags/context; `uncaught` flags
 *   a global-handler capture (mechanism handled:false).
 */
export function report_error(err, context = {}) {
  if (!live) return
  // ONE event per error object, even when it crosses two chokes (run_tx's catch rethrows into a caller's
  // toast catch that also reports): the first report stamps the object; later calls no-op. Primitives
  // (thrown strings) can't be stamped — they rely on Sentry's own dedupe integration instead.
  if (err != null && typeof err === 'object') {
    if (/** @type {any} */ (err).__ares_reported) return
    try {
      Object.defineProperty(err, '__ares_reported', { value: true })
    } catch {
      /* frozen error object — report anyway */
    }
  }
  const { uncaught, area, action, world, character_id, digest, ...rest } = context
  Sentry.withScope((scope) => {
    scope.setContext('game', {
      ...(area ? { area } : {}),
      ...(action ? { action } : {}),
      ...(world ? { world } : {}),
      ...(character_id ? { character_id } : {}),
      ...(digest ? { digest } : {}),
      ...rest,
      log_tail: get_log_buffer().slice(-15),
    })
    if (area) scope.setTag('area', area)
    if (action) scope.setTag('action', action)
    const ab = parse_move_abort(err)
    if (ab) scope.setTag('move_abort', `${ab.module}::${ab.code}`) // fingerprint itself lands in before_send
    Sentry.captureException(err, uncaught ? { mechanism: { handled: false, type: area ?? 'auto' } } : undefined)
  })
}

/**
 * Set the pseudonymous Sentry user to the connected wallet address (on-chain data only — NEVER any email
 * or Google identity). Pass null on logout. No-op until Sentry is live. Called from auth's address
 * subscription (subsequent switches) and once at boot from main.tsx (the initial connect).
 * @param {string | null | undefined} address
 */
export function set_report_user(address) {
  if (!live) return
  Sentry.setUser(address ? { id: address, username: short_addr(address) } : null)
}
