// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { Globe } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { NAV_ITEMS } from '../constants/navigation'
import { DISCORD_URL } from '../constants/links'
import { LANGUAGES } from '../i18n'
import { use_navigate_page, use_active_page } from '../hooks/use_navigate_page'
import { resolve_build_cinematic_active } from '../game/cinematic_mode_gate.js'

import { WalletBar } from './wallet_bar'
import { SponsorAllowanceBar } from './sponsor_allowance_bar'
import { CharacterSwitcher } from './CharacterSwitcher'

export function LanguageCard() {
  const { i18n } = useTranslation()
  const [open, set_open] = useState(false)

  return (
    <div
      className="w-[200px] border border-cyan/15 p-3 flex flex-col items-center relative"
      style={{
        background:
          'linear-gradient(135deg, rgba(74,158,255,0.04) 0%, rgba(18,18,26,0.95) 50%, rgba(200,150,60,0.03) 100%)',
      }}
    >
      <button
        type="button"
        onClick={() => set_open(!open)}
        className="flex items-center gap-1.5 w-full justify-center text-muted hover:text-cyan transition-colors text-[9px] tracking-[0.15em] uppercase cursor-pointer"
      >
        <Globe size={10} className="opacity-40" />
        {LANGUAGES.find((l) => l.code === i18n.language)?.native || 'English'}
      </button>
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 border border-border bg-surface flex flex-col z-10">
          {LANGUAGES.map(({ code, native }) => (
            <button
              key={code}
              type="button"
              onClick={() => {
                i18n.changeLanguage(code)
                set_open(false)
              }}
              className={`text-left px-3 py-1.5 text-[9px] tracking-[0.15em] uppercase cursor-pointer transition-colors ${
                i18n.language === code ? 'text-cyan bg-cyan/5' : 'text-muted hover:text-text hover:bg-white/[0.02]'
              }`}
            >
              {native}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function DiscordCard() {
  const { t } = useTranslation()
  return (
    <a
      href={DISCORD_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="w-[200px] border border-[#5865F2]/30 p-3 flex items-center justify-center gap-2 text-white hover:border-[#5865F2]/70 transition-all group relative overflow-hidden"
      style={{
        background:
          'linear-gradient(135deg, rgba(88,101,242,0.18) 0%, rgba(114,137,218,0.12) 45%, rgba(18,18,26,0.95) 100%)',
        boxShadow: '0 0 20px rgba(88,101,242,0.08)',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill="#5865F2"
        className="shrink-0 drop-shadow-[0_0_6px_rgba(88,101,242,0.6)] group-hover:drop-shadow-[0_0_10px_rgba(88,101,242,0.9)] transition-all"
        aria-hidden="true"
      >
        <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.6986.7719 1.3634 1.225 1.9935a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.0189 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
      </svg>
      <span className="text-[10px] tracking-[0.2em] font-semibold">{t('sidebar.join_discord')}</span>
    </a>
  )
}

export function Sidebar() {
  const { t } = useTranslation()
  const active_page = use_active_page()
  const navigate = use_navigate_page()
  return (
    // data-app-sidebar: the global fixed VersionBadge (version_badge.tsx) hides itself via :has() whenever
    // this sidebar is in the DOM — the sidebar's own bottom-center tag below is the desktop version render.
    <div data-app-sidebar="" className="w-[200px] bg-surface/80 border border-border flex flex-col">
      <div className="flex items-center justify-center py-5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <img
            src="/logo.png"
            alt="AresRPG"
            width={28}
            height={28}
            className="drop-shadow-[0_0_12px_rgba(200,150,60,0.3)]"
          />
          <span className="text-gradient font-bold tracking-[0.3em] text-[11px] uppercase">AresRPG</span>
        </div>
      </div>
      <nav className="flex flex-col py-3 flex-1">
        <div className="text-muted text-[9px] tracking-[0.2em] uppercase px-4 pb-2">{t('nav.navigation')}</div>
        {NAV_ITEMS.map((item) => {
          // T55: coming-soon meta-tabs stay visible but inert — greyed out, non-clickable, no navigation.
          if (item.disabled)
            return (
              <div
                key={item.id}
                data-nav={item.id}
                aria-disabled="true"
                title={t('nav.coming_soon')}
                className="nav-item flex items-center gap-3 px-4 py-2.5 text-left w-full opacity-40 cursor-not-allowed select-none text-muted"
              >
                <item.Icon size={14} className="opacity-60" />
                <span className="text-[11px] tracking-[0.15em] uppercase flex-1">{t(item.label)}</span>
                <span className="text-[8px] tracking-[0.12em] uppercase text-gold/60 border border-gold/20 px-1 py-0.5">
                  {t('nav.coming_soon')}
                </span>
              </div>
            )
          const is_active = active_page === item.id
          return (
            <button
              type="button"
              key={item.id}
              // stable hook for the first-session tutorial coachmarks to spotlight a specific meta-tab
              data-nav={item.id}
              onClick={() => navigate(item.id)}
              className={`nav-item flex items-center gap-3 px-4 py-2.5 text-left w-full cursor-pointer ${is_active ? 'active' : 'text-muted hover:text-text'}`}
            >
              <item.Icon size={14} className="opacity-60" />
              <span className="text-[11px] tracking-[0.15em] uppercase flex-1">{t(item.label)}</span>
            </button>
          )
        })}
        {/* Wallet — docked in the sidebar, above the online list. */}
        <div className="px-3 pt-3">
          <WalletBar />
        </div>
        {/* Daily FREE-GAMEPLAY sponsor allowance gauge (both self-gate on the connected address). */}
        <div className="px-3 pt-2">
          <SponsorAllowanceBar />
        </div>
        {/* #29: the sidebar character switcher docks in the freed #game-online-slot region (Option B
            dropped OnlinePlayers here) — World tab only, so it doesn't clutter the other meta-tabs. */}
        {active_page === 'game-world' && (
          <div id="game-online-slot">
            <CharacterSwitcher />
          </div>
        )}
        {/* Bottom-of-navbar group, pinned via mt-auto so the hints + version tag stick to the base. */}
        <div className="mt-auto">
          {/* World-camera controls, tiny uppercase muted (house idiom). World tab only — the
              cursor-lock + cinematic keys act on the 3D scene, so they'd read as noise on the meta pages. */}
          {active_page === 'game-world' && (
            <div className="px-4 pt-3 flex flex-col gap-1 text-[8px] tracking-[0.2em] text-muted/60 uppercase select-none">
              <span>{t('sidebar.hint_lock_cursor')}</span>
              {resolve_build_cinematic_active(true) && <span>{t('sidebar.hint_cinematic')}</span>}
            </div>
          )}
          {/* D260 + resolved 2026-07-17 (desktop: version sits bottom-center of the sidebar): build/version
              tag, pinned bottom-CENTER. While this renders, the global fixed badge is suppressed (see
              data-app-sidebar on the root + version_badge.tsx's :has() rule). Gold accent (not muted) to
              mirror version_badge.tsx's own "muted gold" treatment — the two are siblings of the same tag. */}
          <div className="px-4 pt-3 text-center text-[8px] tracking-[0.25em] text-gold/40 uppercase select-none">
            v{__APP_VERSION__}
          </div>
        </div>
      </nav>
    </div>
  )
}
