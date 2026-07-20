# Error Convention — CLEAR to the player, LOUD to us

One law, app-wide (`packages/frontend`): **every catch block does exactly one of these three things.**

1. **Rethrow** — a caller up-stack owns the surface. Nothing else needed.
2. **`report_error(err, context)` + one honest toast** — the terminal handler:
   - the toast copy comes from the ONE humanizing decoder (`game/core/abort_copy.js` — `humanize_tx_error`
     / `tx_error`): mapped abort copy or the honest generic line, never raw chain text, never `[object Object]`;
   - `report_error` (`src/core/report.js`) ships the RAW machine error to Sentry with context
     `{ area, action, digest?, character_id?, world? }` — the last ~50 `game_log` events ride along as breadcrumbs;
   - NEVER auto-retry an EXECUTED tx (a digest exists = gas burned = a retry burns again).
3. **`// benign:` comment** — the swallow is deliberate and the comment says why (e.g. a poll superseded,
   storage unavailable, a cosmetic loader with a working fallback).

**Raw `console.error` / `console.warn` / `console.info` in app code is a convention violation.** The outlets:

- `game_log(namespace, ...args)` (`src/core/log.js`) — diagnostics. Ring-buffered (last 50) + forwarded as a
  Sentry breadcrumb always; printed to the console only with debug on (`?debug=1`, `localStorage.ares_debug`,
  or a dev build). Players never see the switchboard; every reported error carries it.
- `report_error(err, context)` — the error itself. No-op without `VITE_SENTRY_DSN` (dev default). Dedupes per
  error object, so a rethrow crossing two reporting chokes sends once.

Already-covered chokes (do NOT re-report at call sites — the rethrown error is stamped):

- every gameplay tx: `world-shell/tx.js run()` reports with `{ action: klass, digest?, kind: executed-failure
| preflight-refusal }`;
- every `use_toast.promise(...)` flow (create character, sponsored joins) reports in its catch;
- global `window.onerror` / `unhandledrejection` / React render errors (main.tsx) report as uncaught;
- engine fatals: `boot_error`, failed device restore, DOM-watchdog breaches (embed_voxel.js).

Sentry scope is **errors-only**: no tracing, no session replay. `beforeSend` drops user-rejected wallet
signatures, benign `AbortError`s and extension noise; MoveAborts group by `package::module::abort_code`.
