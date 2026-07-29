// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// <reference types="vite/client" />
import './boot_shim' // D146: MUST stay the first import — see boot_shim.ts (hoisting-safe process global)
import './core/stale_deploy_recovery'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './app'
import { load_asset_manifest, subscribe } from './asset_manifest'
import { load_mob_catalog } from './game/data/mob_catalog.js'
import { load_pet_catalog } from './game/data/pet_catalog.js'
import { load_corpus_version } from './game/data/corpus_asset.js'
import { load_spell_corpus } from './game/data/spell_corpus.js'
import { load_world_corpus } from './pages/encyclopedia/world_corpus'
import { register_service_worker } from './sw'
import './i18n'
import './index.css'
// Scoped drawer tokens for the companion meta-tabs (P3) — scoped to `.gw-tab`, never :root.
import './game-tab.css'
import './mobile_app_shell.css'
import { init_reporting, report_error, set_report_user } from './core/report.js'
import { use_auth } from './auth'
import { install_wallet_session_reset } from './auth/session_reset_subscription'

// Full asset manifest (ALL classes — item/spell/vanilla/mob/cosmetic/music) served at the web root
// (VITE_ASSETS_MANIFEST_URL overrides). Each class resolves the MinIO asset host first. Flat art/audio may
// have an explicit local presentation fallback; geometry never does: an unpublished model class stays in its
// caller's error/placeholder state instead of asking the SPA for a relative GLB (the rewrite answers one with
// index.html at status 200). ALWAYS ON — the asset host is THE asset store, unconditionally. Resolver config is
// module state, so this critical manifest settles before React mounts. The load is retry-with-backoff (the
// ONE home, src/asset_manifest.ts): a transient boot failure is NO LONGER cached as an empty manifest —
// it stays retryable and self-heals in the background, invalidating blank tiles via the re-render below —
// fixing the prior symptom of blank tiles persisting until a full page refresh. A still-unreachable
// manifest mounts the app anyway on its honest local fallbacks.
await load_asset_manifest()

// The mob look-up catalog (mob_catalog.json) rides the same manifest-backed asset seam; load it
// off the just-seeded manifest. Non-blocking: the world mounts while it resolves, mobs pop from debug-cube to
// model on arrival (progressive migration; the manifest carries `mob_catalog` only after the seed leg publishes).
void load_mob_catalog()

// Equipped pets resolve their world-companion model through the published pet catalog first, falling back to
// the mob catalog above for the pre-Hytale-33 pet generation (#526) — never the old cosmetic-quilt guess.
// Non-blocking, same contract as load_mob_catalog: an equipped pet stays honestly unspawned until this lands.
void load_pet_catalog()

// The authored spell corpus rides the shared version pointer below. Non-blocking: the scene mounts while it
// resolves, the spell surfaces fill in on arrival. An absent
// blob (open-source / pre-publish tree) degrades loudly to inert spell surfaces, never a crash (issue #106).
const corpus_version = load_corpus_version()
void load_spell_corpus(corpus_version)

// The authored world corpus shares that exact pointer version and is the only client-side
// home of world rosters, gatherable placements and the mob combat block. It had no caller at all until now:
// the encyclopedia's worlds/bestiary/jobs surfaces and the fight simulator's mob picker all read an inert
// corpus, so the picker opened on `0/0`. Non-blocking; its cache is a store, so those surfaces fill in on arrival.
void load_world_corpus(corpus_version)

// ERRORS-ONLY error reporting (core/report.js) — inits ONLY when VITE_SENTRY_DSN is present (a hard no-op
// otherwise, so a bare dev/local boot never phones home). No tracing, no session replay. It also wires the
// global window.onerror / unhandledrejection surfaces through the one report_error choke.
init_reporting()
// Seed the pseudonymous Sentry user with any wallet already reconnected at boot; auth's own subscription
// (auth/index.ts) keeps it in sync across wallet switches. On-chain address only — never email/Google.
set_report_user(use_auth.getState().address)

// WALLET-SWITCH SESSION RESET (P0/D286) — install the route-independent account-change trigger here at the
// composition root (above the router), so a switch tears the prior wallet's session down on EVERY route. It
// lives outside auth's module body to keep the eager login bundle off the lazy game chunk it dynamic-imports
// (see auth/session_reset_subscription.ts). Boot-once; the app root never unmounts, so the handle is dropped.
install_wallet_session_reset()

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
