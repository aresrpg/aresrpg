/// <reference types="vite/client" />
import './boot_shim' // D146: MUST stay the first import — see boot_shim.ts (hoisting-safe process global)
import './stale_deploy_recovery'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app'
import { load_asset_manifest, subscribe } from './asset_manifest'
import { load_mob_catalog } from './game/data/mob_catalog.js'
import { register_service_worker } from './sw'
import './i18n'
import './index.css'
// Scoped drawer tokens for the companion meta-tabs (P3) — scoped to `.gw-tab`, never :root.
import './game-tab.css'
import './mobile_app_shell.css'
import { init_reporting, report_error, set_report_user } from './core/report.js'
import { use_auth } from './auth'

// Full Walrus asset manifest (ALL classes — item/spell/vanilla/mob/cosmetic/music) as the legacy asset host sunsets.
// scripts/walrus/census.mjs projects the upload registry → asset_manifest.json, served at the web root
// (VITE_WALRUS_MANIFEST_URL overrides). Each class resolves Walrus-FIRST with the CDN/local copy as the
// FALLBACK (walrus_asset_url returns null for an unpublished class). ALWAYS ON — Walrus IS the asset
// store, unconditionally (the VITE_ASSETS_WALRUS gate died here, incl. its Vercel env var). Resolver config is module
// state, so this critical manifest settles before React mounts. The load is retry-with-backoff (the ONE
// home, src/asset_manifest.ts): a transient boot failure is NO LONGER cached as an empty manifest —
// it stays retryable and self-heals in the background, invalidating blank tiles via the re-render below —
// fixing the prior symptom of blank tiles persisting until a full page refresh. A still-unreachable
// manifest mounts the app anyway on its honest local fallbacks.
await load_asset_manifest()

// The mob look-up catalog (mob_catalog.json) rides the same manifest → Walrus seam every asset uses; load it
// off the just-seeded manifest. Non-blocking: the world mounts while it resolves, mobs pop from debug-cube to
// model on arrival (progressive migration; the manifest carries `mob_catalog` only after the seed leg publishes).
void load_mob_catalog()

// ERRORS-ONLY error reporting (core/report.js) — inits ONLY when VITE_SENTRY_DSN is present (a hard no-op
// otherwise, so a bare dev/local boot never phones home). No tracing, no session replay. It also wires the
// global window.onerror / unhandledrejection surfaces through the one report_error choke.
init_reporting()
// Seed the pseudonymous Sentry user with any wallet already reconnected at boot; auth's own subscription
// (auth/index.ts) keeps it in sync across wallet switches. On-chain address only — never email/Google.
set_report_user(use_auth.getState().address)

const root = createRoot(document.getElementById('root')!, {
  // React 19 render-error hooks route through the ONE choke so component-tree crashes get the same
  // breadcrumbs + fingerprinting as everything else. onUncaughtError = no error boundary caught it.
  onUncaughtError: (error, info) =>
    report_error(error, { area: 'react', uncaught: true, component_stack: info?.componentStack }),
  onCaughtError: (error, info) =>
    report_error(error, { area: 'react-boundary', component_stack: info?.componentStack }),
  onRecoverableError: (error, info) =>
    report_error(error, { area: 'react-recoverable', component_stack: info?.componentStack }),
})

const render_tree = () =>
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  )

render_tree()

// A manifest that recovered only AFTER mount (pre-mount retries exhausted, the background retry landed it)
// leaves every already-resolved icon on its blank fallback. Re-render from the root once so those resolvers
// re-run and the glyphs become art — no page refresh needed, unlike the old manual-reload workaround.
subscribe(render_tree)

register_service_worker()
