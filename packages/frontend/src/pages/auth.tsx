// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { use_auth, type AuthState } from '../auth'
import { use_spectate_gate } from '../stores/spectate_gate'
import { GoogleButton, WalletConnectSection } from '../auth/components'
import { is_wallet_connect_enabled } from '../auth/wallet_connect_gate'
import { Logo } from '../components/logo'
// The world chat is a READ-ONLY overlay on the spectate view; the
// lines flow over the #19 silent p2p join the spectate backdrop already holds.
import { WorldChat } from '../game/screens/hud/world/WorldChat.jsx'

// The SPECTATE landing (root `/`, logged-out). The LIVE 3D world is rendered behind by the persistent
// GameWorldHost (instant, never a dark/blank page). This layer floats a glass login popup over a
// blurred view of that world, plus a SPECTATE option to watch the live world without signing in (no
// login-wall). Post-login it becomes a glass "entering the world" status until the companion session
// connects and the routed app takes over. Boot-routing law: instant live world, blurred glass login,
// status until the world is ready, never a full-page wall, never a dark page. Companion tokens, no
// gold-gothic.

// The host wrapper (app.tsx) is pointer-events:none so logged-out visitors can still interact with the
// live world behind; every interactive piece below re-enables pointer events for itself.

function CenteredGlass({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4">
      <div
        className="glass-panel flex flex-col items-center gap-7 px-9 py-10 w-full max-w-sm"
        // Dark glass override: .glass-panel's white-tint glass is tuned for the app's near-black pages — over
        // the BRIGHT live world its blur reads milky/washed. Force the house dark base under the blur.
        style={{ pointerEvents: 'auto', borderRadius: 5, background: 'rgba(10,10,15,0.78)' }}
      >
        {children}
      </div>
    </div>
  )
}

// A blurred, dimmed pane over the live world that the glass card floats on (the "select sits BLURRED
// behind a glass Login popup"). Inert: it only absorbs clicks so they never reach the world while the
// popup is up — clicking the backdrop does nothing (boot-routing law).
function BlurBackdrop() {
  return (
    <div
      className="fixed inset-0"
      style={{
        pointerEvents: 'auto',
        backdropFilter: 'blur(7px)',
        WebkitBackdropFilter: 'blur(7px)',
        background: 'rgba(10, 10, 15, 0.5)',
      }}
    />
  )
}

function Wordmark({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <Logo size={56} />
      <div className="flex flex-col items-center gap-1.5">
        <h1 className="text-text font-semibold tracking-[0.35em] text-sm uppercase">AresRPG</h1>
        <div className="text-muted text-[10px] tracking-[0.3em] uppercase">{subtitle}</div>
      </div>
    </div>
  )
}

function PulseDots() {
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-cyan"
          style={{ animation: 'glow-pulse 1.2s ease-in-out infinite', animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </div>
  )
}

// A hairline rule with a centered uppercase label — the login popup's section separator.
function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-0.5">
      <div className="flex-1 h-px bg-white/10" />
      <span className="text-muted text-[9px] tracking-[0.25em] uppercase">{label}</span>
      <div className="flex-1 h-px bg-white/10" />
    </div>
  )
}

// The glass login popup over the blurred world + the SPECTATE option. Exported for its own component
// test (pages/auth.test.tsx) — the #dappkit-modal CONNECT WALLET trigger must honor the #73 build-time
// gate, mirrored at this composition level since the gate branch lives here, not inside the trigger.
export function LoginPopup({
  on_login,
  on_connect_wallet,
  on_spectate,
  loading,
}: {
  on_login: () => void
  on_connect_wallet: (wallet_name: string) => void
  on_spectate: () => void
  loading: boolean
}) {
  const { t } = useTranslation()
  return (
    <>
      <BlurBackdrop />
      <CenteredGlass>
        <Wordmark subtitle={t('auth.sign_in_to_play')} />
        <div className="flex flex-col items-stretch gap-3 w-full">
          <GoogleButton onClick={on_login} loading={loading} />
          {/* #73 — zkLogin can't complete on Vercel preview URLs (dynamic OAuth redirect), so preview/dev
              builds offer a direct wallet-standard connect. Build-time gate: a production release never
              renders this branch (asserted in auth/wallet_connect_gate.test.ts, not hidden by CSS).
              #dappkit-modal — the trigger's own label already reads "Connect wallet" (house tokens), so
              this divider reuses the plain "or" separator instead of stuttering the same words twice. */}
          {is_wallet_connect_enabled() && (
            <>
              <Divider label={t('auth.or')} />
              <WalletConnectSection on_connect={on_connect_wallet} loading={loading} />
            </>
          )}
          <Divider label={t('auth.or')} />
          <button
            type="button"
            onClick={on_spectate}
            className="w-full h-11 border border-cyan/30 text-cyan text-[11px] tracking-[0.18em] uppercase font-semibold cursor-pointer transition-all hover:border-cyan/60 hover:bg-cyan/8"
            style={{ borderRadius: 5 }}
          >
            {t('auth.spectate')}
          </button>
        </div>
      </CenteredGlass>
    </>
  )
}

// Spectating: the world plays clear behind (interactive). A top tag tells the visitor they are
// watching the live world, and a bottom button brings the login popup back.
function SpectateOverlay({ on_sign_in }: { on_sign_in: () => void }) {
  const { t } = useTranslation()
  return (
    <>
      <div className="fixed inset-x-0 top-5 flex justify-center">
        <div
          className="glass-panel flex items-center gap-2 px-4 py-2 text-cyan text-[10px] tracking-[0.22em] uppercase"
          style={{ pointerEvents: 'auto', borderRadius: 5, background: 'rgba(10,10,15,0.78)' }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full bg-cyan"
            style={{ animation: 'glow-pulse 2s ease-in-out infinite' }}
          />
          {t('auth.spectating')}
        </div>
      </div>
      {/* D207 — the world chat, read-only (lines flow over the #19 silent p2p join; no input, no card fight) */}
      <div className="fixed bottom-6 left-6 w-[460px] max-w-[46vw] spectate-chat" style={{ pointerEvents: 'auto' }}>
        <WorldChat readonly />
      </div>
      <div className="fixed inset-x-0 bottom-6 flex justify-center">
        <button
          type="button"
          onClick={on_sign_in}
          className="glass-panel text-cyan text-[11px] tracking-[0.18em] uppercase font-semibold px-6 py-3 cursor-pointer transition-all hover:bg-cyan/8"
          style={{ pointerEvents: 'auto', borderRadius: 5, background: 'rgba(10,10,15,0.78)' }}
        >
          {t('auth.sign_in_to_play')}
        </button>
      </div>
    </>
  )
}

// Post-login: connecting the companion session (address set, not yet connected). The world is blurred
// behind a glass status card so the visitor always knows what is happening and never sees a dark page.
function ConnectingOverlay() {
  const { t } = useTranslation()
  return (
    <>
      <BlurBackdrop />
      <CenteredGlass>
        <Logo size={48} />
        <div className="flex flex-col items-center gap-3">
          <div className="text-text text-[11px] tracking-[0.25em] uppercase">{t('auth.entering_world')}</div>
          <PulseDots />
        </div>
      </CenteredGlass>
    </>
  )
}

// Initial auto-reconnect: a subtle status pill over the clear live world (no login card flash while we
// resolve whether a saved session reconnects).
function BootPill() {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-x-0 bottom-6 flex justify-center">
      <div
        className="glass-panel flex items-center gap-2.5 px-5 py-2.5 text-muted text-[10px] tracking-[0.22em] uppercase"
        style={{ pointerEvents: 'auto', borderRadius: 5 }}
      >
        <PulseDots />
        {t('auth.connecting')}
      </div>
    </div>
  )
}

export function SpectateLanding() {
  const address = use_auth((s: AuthState) => s.address)
  const is_loading = use_auth((s: AuthState) => s.is_loading)
  const login = use_auth((s: AuthState) => s.login)
  // Spectate choice = the interaction gate's ONE home (use_spectate_gate) — the spectate camera + GameWorldHost
  // read the same fact, so choosing "watch the live world" flips both the overlay AND canvas interactivity
  // without remounting the engine.
  const spectating = use_spectate_gate((s) => s.chosen)
  const set_spectating = use_spectate_gate((s) => s.set_chosen)
  const [signing_in, set_signing_in] = useState(false)

  // Authenticated but the companion session is still connecting -> glass status over the blurred world.
  if (address) return <ConnectingOverlay />

  // Watching the live world without signing in.
  if (spectating) return <SpectateOverlay on_sign_in={() => set_spectating(false)} />

  // Initial boot auto-reconnect (a saved session may sign in) -> a status pill, no login card flash.
  if (is_loading && !signing_in) return <BootPill />

  // Logged out -> the glass login popup over the blurred world + the SPECTATE option.
  // D207 (qa: chat must show on plain '/' too — spectate IS the login backdrop): the read-only world
  // chat rides BOTH logged-out states, not just the dedicated spectate view.
  return (
    <>
      <div className="fixed bottom-6 left-6 w-[460px] max-w-[46vw] spectate-chat" style={{ pointerEvents: 'auto' }}>
        <WorldChat readonly />
      </div>
      <LoginPopup
        loading={is_loading}
        on_spectate={() => set_spectating(true)}
        on_login={() => {
          set_signing_in(true)
          void login('Sign in with Google').finally(() => set_signing_in(false))
        }}
        on_connect_wallet={(wallet_name) => {
          // The SAME login(name) path zkLogin uses — the connected wallet address lands in the same auth
          // store shape, so downstream reads stay identity-agnostic. Sponsorship is zkLogin-only: a wallet
          // session self-pays every transaction.
          set_signing_in(true)
          void login(wallet_name).finally(() => set_signing_in(false))
        }}
      />
    </>
  )
}
