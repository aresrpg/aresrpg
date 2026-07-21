// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import * as Sentry from '@sentry/react'
import { Component, Suspense, lazy, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'

import i18n from './i18n'
import { use_auth, type AuthState } from './auth'
import { use_toast, TOAST_CONTAINER_CLASS } from './toast'
import { Sidebar, LanguageCard, DiscordCard } from './components/sidebar'
import { MobileSwitcher } from './components/mobile_switcher'
import { MobileOrientationGate } from './game/screens/hud/MobileOrientationGate.jsx'
import { app_mobile_classes, mobile_shell_visibility, use_mobile_mode } from './game/screens/hud/mobile_layout.js'
import { ShopPage } from './pages/shop'
import { SpectateLanding } from './pages/auth'
import { CharactersPage } from './pages/characters'
import { EncyclopediaPage } from './pages/encyclopedia'
import { MarketplacePage } from './pages/marketplace'
import { KolizeumPage } from './pages/kolizeum'
import { AirdropPage } from './pages/airdrop'
import { InboxExternalPage } from './pages/inbox'
import { SettingsPage } from './pages/settings'
import { GameWorldHost } from './GameWorldHost'
import { WalletBar } from './components/wallet_bar'
import { SponsorRunoutModalHost } from './components/sponsor_runout_modal'
import { ContractsPausedModalHost } from './components/contracts_paused_modal'
import { RpcLagBanner } from './components/RpcLagBanner'
import { VersionBadge } from './version_badge'

// Lazy-routed: the build simulator bundles the seeded items cast (~2.3 MB), so it loads in its
// own chunk on demand rather than weighing down the main bundle for every visitor.
const SimulatorPage = lazy(() => import('./pages/simulator').then((m) => ({ default: m.SimulatorPage })))

class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    Sentry.captureException(error)
    // [P0 2026-07-14 blank-page-after-login] A failed lazy-chunk import (a stale service worker
    // holding a pre-deploy page whose old-hash chunks no longer exist) is only cured by fetching the
    // fresh shell — a setState retry re-imports the same dead URL. One-shot reload, time-latched so a
    // still-broken SW degrades to the visible fallback instead of a reload loop.
    const chunk_error = /dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(
      String(error?.message ?? error)
    )
    const last_reload = Number(sessionStorage.getItem('chunk_reload_at') || 0)
    if (chunk_error && Date.now() - last_reload > 30_000) {
      sessionStorage.setItem('chunk_reload_at', String(Date.now()))
      // UNREGISTER the service worker BEFORE reloading — a bare reload re-fetches the shell THROUGH
      // the stale SW's navigateFallback (the OLD precached index.html whose chunk hashes died with the
      // last deploy), reproducing the exact failure forever (proven 2026-07-14: deterministic boundary
      // trip on every post-deploy login). Purging the SW makes the reload hit the network fresh.
      const purge =
        navigator.serviceWorker?.getRegistrations?.().then((rs) => Promise.allSettled(rs.map((r) => r.unregister()))) ??
        Promise.resolve()
      purge.finally(() => location.reload())
    }
  }
  render() {
    if (this.state.error)
      return (
        this.props.fallback ?? (
          <div className="flex flex-col items-center justify-center h-full p-12 gap-4">
            <div className="text-red-400 text-[11px] tracking-[0.2em] uppercase">
              {i18n.t('error_boundary.something_went_wrong')}
            </div>
            {/* SHOW THE ERROR — a fallback that hides WHAT broke is a dead
                end for the player AND for us — React 19 routes the message to onUncaughtError only, so
                a swallowed error is invisible in prod (no console line, and an ad-blocker can eat the
                Sentry report). The message + top frames are printed here: the player can report them
                verbatim and we can read them off a screenshot. No secrets: this is a JS error string. */}
            <pre className="max-w-[680px] max-h-[220px] overflow-auto whitespace-pre-wrap break-words border border-border bg-black/40 p-3 text-[10px] leading-[1.5] text-muted">
              {String(this.state.error?.message ?? this.state.error)}
              {this.state.error?.stack ? `\n\n${this.state.error.stack.split('\n').slice(0, 6).join('\n')}` : ''}
            </pre>
            <button
              type="button"
              className="btn-outline px-4 py-2 text-[10px]"
              onClick={() => this.setState({ error: null })}
            >
              {i18n.t('common.retry')}
            </button>
          </div>
        )
      )
    return this.props.children
  }
}

// ---------------------------------------------------------------------------
//  Shared decorative components
// ---------------------------------------------------------------------------

function AmbientBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      <div
        className="absolute bg-gold/8 blur-[128px]"
        style={{ top: '20%', left: '-5%', width: 300, height: 300, animation: 'drift 20s ease-in-out infinite' }}
      />
      <div
        className="absolute bg-cyan/5 blur-[160px]"
        style={{
          bottom: '15%',
          right: '5%',
          width: 400,
          height: 400,
          animation: 'drift 25s ease-in-out infinite reverse',
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
//  Toasts
// ---------------------------------------------------------------------------

function Toasts() {
  const { toasts, remove } = use_toast()
  if (toasts.length === 0) return null
  // Top-right is a clean toast-only zone (the wallet moved into the sidebar).
  // Mobile clamps to the SAFE-AREA edges, not raw pixel offsets (regression: toasts overflowed the screen
  // edge — this is the one fixed HUD surface in the mobile chain that never adopted --safe-* like every
  // other one, e.g. mobile-hud.css / mobile_switcher.tsx).
  return (
    <div className={TOAST_CONTAINER_CLASS}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex flex-col gap-2 p-3 border backdrop-blur-sm animate-[slide-in_0.3s_ease-out] bg-[#0d0d14]/95 ${toast.type === 'error' ? 'border-red-400/40 text-red-400' : toast.type === 'pending' ? 'border-gold/40 text-gold-light' : toast.type === 'success' ? 'border-emerald-400/40 text-emerald-400' : 'border-cyan/40 text-cyan'}`}
        >
          <div className="flex min-w-0 items-start gap-3">
            {toast.type === 'pending' && (
              <span className="w-3.5 h-3.5 mt-0.5 shrink-0 rounded-full border-2 border-gold/30 border-t-gold animate-spin" />
            )}
            {toast.type === 'success' && <span className="mt-0.5 shrink-0 text-[13px] leading-none">✓</span>}
            <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed tracking-wide">
              {toast.message}
            </span>
            <button
              type="button"
              onClick={() => remove(toast.id)}
              className="text-[10px] opacity-40 hover:opacity-80 transition-opacity cursor-pointer shrink-0"
            >
              &#10005;
            </button>
          </div>
          {toast.action && (
            <button
              type="button"
              onClick={toast.action.onClick}
              className="btn-outline w-full whitespace-normal break-words px-3 py-2 text-[9px] leading-relaxed font-mono font-semibold tracking-[0.15em] uppercase cursor-pointer"
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
//  Game-world route
// ---------------------------------------------------------------------------

// The routed game-world page is a transparent spacer: the live 3D scene is rendered by the PERSISTENT
// GameWorldHost layer behind the router (it stays alive across tabs and render-pauses off-tab), so this
// element only needs to claim the route and let the canvas show through. The in-world HUD is design's
// pending P2-visual.
function GameWorldView() {
  return <div className="flex-1" aria-hidden />
}

// ---------------------------------------------------------------------------
//  Layout
// ---------------------------------------------------------------------------

function Layout() {
  const location = useLocation()
  const mobile = use_mobile_mode()
  const mobile_shell = mobile_shell_visibility(mobile, location.pathname)
  const classes = app_mobile_classes(mobile)

  const routes = (
    <Routes>
      <Route path="/" element={<GameWorldView />} />
      {/* S-61/SPEC §16: idle exploration is dead by decision — the world is entered via the HUD's world
          switcher (S-67) now. Old deep links land on the live world instead of a blank/missing route. */}
      <Route path="/exploration" element={<Navigate to="/" replace />} />
      <Route path="/characters" element={<CharactersPage />} />
      <Route path="/encyclopedia/*" element={<EncyclopediaPage />} />
      <Route path="/marketplace" element={<MarketplacePage />} />
      <Route path="/airdrop" element={<AirdropPage />} />
      <Route path="/kolizeum" element={<KolizeumPage />} />
      {/* S-65/S-67: friends folded into the world HUD presence panel; the scribe lives as the per-character
          RUNEFORGE detail tab inside the Characters page (moved off the page-level
          strip). That tab is local useState, not a URL param, so the redirect just lands on the roster. */}
      <Route path="/scribe" element={<Navigate to="/characters" replace />} />
      <Route path="/shop" element={<ShopPage />} />
      <Route
        path="/simulator"
        element={
          <Suspense fallback={null}>
            <SimulatorPage />
          </Suspense>
        }
      />
      <Route path="/settings" element={<SettingsPage />} />
      {/* The world is home. Its confirmed-empty state replaces only the bounded world slot with character
          creation; these unconditional meta routes stay navigable with zero characters. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )

  return mobile ? (
    // Mobile is LANDSCAPE-ONLY (portrait → the app-wide rotate gate in AppBody). Chrome FLOATS over
    // content — no bar ever splits the 390px height: the live game is full-bleed canvas,
    // meta pages render inside ONE floating glass sheet, and the page switcher is a right-edge handle.
    <div className={`${classes.shell} flex flex-col h-dvh overflow-hidden`}>
      {mobile_shell.in_game ? (
        <div data-mobile-page-shell className="flex-1 flex flex-col relative min-h-0 overflow-hidden">
          <ErrorBoundary>{routes}</ErrorBoundary>
        </div>
      ) : (
        <div data-mobile-page-shell className="mobile-glass-frame flex-1 flex flex-col relative min-h-0">
          <div className="mobile-glass-sheet">
            <ErrorBoundary>{routes}</ErrorBoundary>
          </div>
          {/* The balance/wallet stays reachable on every meta page (you buy on Shop/Marketplace), re-skinned
              as a floating glass pod instead of a height-taxing top row. Sibling of the sheet so its menu
              drop-down isn't clipped by the sheet's overflow. */}
          {mobile_shell.show_wallet && (
            <div data-mobile-wallet-bar className="app-wallet-slot mobile-wallet-pod">
              <WalletBar compact />
            </div>
          )}
        </div>
      )}
      <MobileSwitcher />
    </div>
  ) : (
    <div className={`${classes.shell} flex h-dvh p-3 gap-3 overflow-hidden`}>
      <div className="flex flex-col gap-3 overflow-y-auto min-h-0 shrink-0">
        <Sidebar />
        <LanguageCard />
        <DiscordCard />
      </div>
      <div className="flex-1 flex flex-col relative min-h-0 overflow-y-auto">
        <ErrorBoundary>{routes}</ErrorBoundary>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
//  App root
// ---------------------------------------------------------------------------

function AppBody() {
  const location = useLocation()
  const address = use_auth((s: AuthState) => s.address)
  const mobile = use_mobile_mode()

  // The external /inbox is a STANDALONE claim page for non-players: a plain Sui wallet connects
  // and claims item gifts — its own header + Connect CTA, no game shell / engine boot. Rendered outside the auth
  // gate (its own public surface), so a wallet holder who isn't a zkLogin player can still receive.
  if (location.pathname === '/inbox') {
    return (
      <>
        <Toasts />
        <InboxExternalPage />
        {import.meta.env.PROD && <Analytics />}
      </>
    )
  }

  // DEV-only VFX-LAB takes over the full screen (no auth / no engine boot) — a standalone spell-juice
  // sandbox. Statically stripped from prod (import.meta.env.DEV is false → the branch + lazy chunk drop).
  // #42: the standalone /expedition demo route is DELETED — the exploration loop now lives IN the real app
  // (GameWorldHud's ExpeditionHud over the live /game-world), so there is no separate surface anymore.

  // Fully inside the companion app: authenticated. The exploration loop runs chain-direct (no WS backend), so a
  // zkLogin address alone puts the player fully in-app (the real /game-world + Hud) — the loop IS the session.
  // Anything else (logged out) is the SPECTATE landing over the live world.
  const in_app = !!address
  return (
    <>
      <AmbientBackground />
      {/* PERSISTENT game-world canvas: always-on engine + WS, render-pauses off the game-world tab. It
          is the live-world backdrop everywhere EXCEPT an authenticated meta-tab, so the spectate landing
          renders instantly over it (never a dark/blank page). Mounted inside the router to read the route. */}
      <GameWorldHost />
      <Toasts />
      {in_app && <RpcLagBanner />}
      {/* Daily FREE-GAMEPLAY run-out modal — opens when the sponsor allowance is spent (self-gates on the
          connected address; renders nothing otherwise). App-global, same tier as Toasts. */}
      <SponsorRunoutModalHost />
      {/* CONTRACTS PAUSED — full-screen block on the game/app surfaces only (self-gates on the connected
          address, same tier as the run-out modal); never shows over the spectate landing below nor the
          standalone /inbox page (that branch returns before this point). */}
      <ContractsPausedModalHost />
      {/* PORTRAIT ROTATE GATE — app-wide: mobile is landscape-only, so the gate fires on
          EVERY route (world, meta pages, and the logged-out spectate landing), not just the game canvas.
          Self-noops out of portrait; mounted only on mobile so a narrow desktop window never sees it. */}
      {mobile && <MobileOrientationGate />}
      {in_app ? (
        <div className="relative z-10">
          <Layout />
        </div>
      ) : (
        // The spectate landing floats ABOVE the live-world canvas (the host lifts the canvas above the
        // routed game-world spacer). pointer-events:none lets a logged-out visitor interact with the
        // world behind; each overlay piece re-enables pointer events for itself.
        <div className="fixed inset-0 z-20 pointer-events-none">
          <SpectateLanding />
        </div>
      )}
      {import.meta.env.PROD && <Analytics />} {/* prod-only: dev/localhost sessions polluted the Vercel insights */}
    </>
  )
}

export function App() {
  return (
    <>
      {/* Version badge — mounted unconditionally so it
          survives every route AND a router/AppBody crash, but CSS-gated MOBILE-ONLY (the
          version over canvas is only for mobile); the desktop Layout sidebar's own bottom-center
          v{__APP_VERSION__} tag is the sole desktop home. See version_badge.tsx. */}
      <VersionBadge version={__APP_VERSION__} />
      <BrowserRouter>
        {/* [P0 2026-07-14] ROOT boundary — the app previously had NO boundary above the AppBody chrome
            (the only one wrapped {routes}), so a lazy-chunk rejection in the HUD/sidebar unmounted the
            ENTIRE tree to a silent blank page (React 19 routes it to onUncaughtError only — no console
            error, no recovery). This wrap + the chunk-reload latch in componentDidCatch close the class. */}
        <ErrorBoundary>
          <AppBody />
        </ErrorBoundary>
      </BrowserRouter>
    </>
  )
}
