// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, Wallet, Plus, LogOut, Globe, Send, ChevronDown } from 'lucide-react'

import { use_auth, type AuthState } from '../auth'
import { LANGUAGES } from '../i18n'
import { format_mist_to_sui } from '../utils/sui_mist'
import { truncate_address } from '../utils/address'

import { AddFundsModal } from './add_funds_modal'
import { SendSuiModal } from './send_sui_modal'

// The wallet lives in the left SIDEBAR (above the online-player list) on desktop and at the top of
// the content column on mobile. It is a self-contained card, NOT fixed chrome, so the
// top-right zone stays clean for toasts only.
//
// `compact` = the MOBILE bar: the full card hogged ~150px at the top of every tab, so on
// phones it collapses to a single ~40px row (icon + balance + address) with Send / Add funds / Language /
// Disconnect tucked behind a chevron menu. Desktop keeps the full card.
export function WalletBar({ compact = false }: { compact?: boolean }) {
  const { t, i18n } = useTranslation()
  const address = use_auth((s: AuthState) => s.address)
  const logout = use_auth((s: AuthState) => s.logout)
  const balance_mist = use_auth((s: AuthState) => s.sui_balance_mist)
  const refresh_sui_balance = use_auth((s: AuthState) => s.refresh_sui_balance)
  const [copied, set_copied] = useState(false)
  const [show_modal, set_show_modal] = useState(false)
  const [show_send, set_show_send] = useState(false)
  const [show_lang, set_show_lang] = useState(false)
  const [show_menu, set_show_menu] = useState(false)

  // Balance invalidation ("wasn't refreshed fast enough" — NO polling loops). The always-mounted
  // wallet bar refetches FRESH through the single store home on: mount / sign-in change, and every app FOCUS or
  // visibility regain (returning to the tab after funding). Post-tx invalidation lives in the auth tx doors, and
  // the other balance surfaces refresh on their own mount — this event-driven set replaces the old 15s poll.
  useEffect(() => {
    void refresh_sui_balance()
    if (!address) return undefined

    const on_focus = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') void refresh_sui_balance()
    }
    document.addEventListener('visibilitychange', on_focus)
    window.addEventListener('focus', on_focus)
    return () => {
      document.removeEventListener('visibilitychange', on_focus)
      window.removeEventListener('focus', on_focus)
    }
  }, [address, refresh_sui_balance])

  const copy_address = useCallback(() => {
    if (!address) return
    navigator.clipboard.writeText(address)
    set_copied(true)
    setTimeout(() => set_copied(false), 2000)
  }, [address])

  if (!address) return null

  // ── MOBILE compact bar: one ~40px row + a chevron menu for the secondary actions ──
  if (compact) {
    const current_lang = LANGUAGES.find((l) => l.code === i18n.language)?.native || 'English'
    return (
      <>
        <div className="relative">
          <div className="flex items-center gap-2 border border-border bg-surface/40 px-2.5 py-1.5">
            <Wallet size={12} className="text-gold opacity-60 shrink-0" />
            <span className="text-text text-[12px] font-mono leading-none">
              {balance_mist === null ? '---.----' : format_mist_to_sui(balance_mist, 2)}
            </span>
            <span className="text-muted text-[8px] tracking-wide uppercase">{t('wallet.sui')}</span>
            <button
              type="button"
              onClick={copy_address}
              className="ml-auto flex items-center gap-1 cursor-pointer min-w-0"
              aria-label="Copy address"
            >
              <span className="text-gold text-[10px] font-mono truncate">{truncate_address(address)}</span>
              {copied ? (
                <Check size={12} className="text-emerald-400 opacity-80 shrink-0" />
              ) : (
                <Copy size={12} className="opacity-40 shrink-0" />
              )}
            </button>
            <button
              type="button"
              onClick={() => set_show_menu(!show_menu)}
              className="shrink-0 text-muted hover:text-gold transition-colors cursor-pointer p-0.5"
              aria-label="Wallet menu"
              aria-expanded={show_menu}
            >
              <ChevronDown size={14} className={`transition-transform ${show_menu ? 'rotate-180' : ''}`} />
            </button>
          </div>
          {show_menu && (
            <div className="absolute top-full left-0 right-0 mt-1 border border-border bg-surface z-50 flex flex-col">
              <button
                type="button"
                onClick={() => {
                  set_show_send(true)
                  set_show_menu(false)
                }}
                className="flex items-center gap-2 px-3 py-2.5 text-[10px] tracking-[0.12em] uppercase text-muted hover:text-gold hover:bg-white/[0.02] transition-colors cursor-pointer"
              >
                <Send size={12} className="opacity-60" />
                {t('wallet.send.button')}
              </button>
              <button
                type="button"
                onClick={() => {
                  set_show_modal(true)
                  set_show_menu(false)
                }}
                className="flex items-center gap-2 px-3 py-2.5 text-[10px] tracking-[0.12em] uppercase text-muted hover:text-gold hover:bg-white/[0.02] transition-colors cursor-pointer border-t border-border"
              >
                <Plus size={12} className="opacity-60" />
                {t('wallet.add_funds')}
              </button>
              <button
                type="button"
                onClick={() => set_show_lang(!show_lang)}
                className="flex items-center gap-2 px-3 py-2.5 text-[10px] tracking-[0.12em] uppercase text-muted hover:text-cyan hover:bg-white/[0.02] transition-colors cursor-pointer border-t border-border"
              >
                <Globe size={12} className="opacity-60" />
                {current_lang}
                <ChevronDown size={11} className={`ml-auto transition-transform ${show_lang ? 'rotate-180' : ''}`} />
              </button>
              {show_lang && (
                <div className="flex flex-col border-t border-border bg-surface/60">
                  {LANGUAGES.map(({ code, native }) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => {
                        i18n.changeLanguage(code)
                        set_show_lang(false)
                      }}
                      className={`text-left px-7 py-2 text-[10px] tracking-[0.12em] uppercase cursor-pointer transition-colors ${
                        i18n.language === code
                          ? 'text-cyan bg-cyan/5'
                          : 'text-muted hover:text-text hover:bg-white/[0.02]'
                      }`}
                    >
                      {native}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={() => {
                  set_show_menu(false)
                  logout()
                }}
                className="flex items-center gap-2 px-3 py-2.5 text-[10px] tracking-[0.16em] uppercase text-muted hover:text-red-400 hover:bg-white/[0.02] transition-colors cursor-pointer border-t border-border"
              >
                <LogOut size={12} className="opacity-60" />
                {t('sidebar.disconnect')}
              </button>
            </div>
          )}
        </div>

        {show_modal && <AddFundsModal address={address} on_close={() => set_show_modal(false)} />}
        {show_send && <SendSuiModal on_close={() => set_show_send(false)} />}
      </>
    )
  }

  return (
    <div className="border border-border bg-surface/40 p-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Wallet size={12} className="text-gold opacity-60 shrink-0" />
        <span className="text-gold text-[10px] tracking-wide font-mono select-all truncate flex-1">
          {truncate_address(address)}
        </span>
        <button
          type="button"
          onClick={copy_address}
          className="cursor-pointer transition-opacity shrink-0"
          aria-label="Copy address"
        >
          {copied ? (
            <Check size={13} className="text-emerald-400 opacity-80" />
          ) : (
            <Copy size={13} className="opacity-40 hover:opacity-80" />
          )}
        </button>
      </div>

      <div className="flex items-baseline gap-1.5">
        {balance_mist === null ? (
          <span className="text-muted text-[13px] font-mono">---.----</span>
        ) : (
          <span className="text-text text-[13px] font-mono">{format_mist_to_sui(balance_mist, 2)}</span>
        )}
        <span className="text-muted text-[9px] tracking-wide uppercase">{t('wallet.sui')}</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => set_show_send(true)}
          className="flex-1 px-2 py-1.5 text-[9px] tracking-[0.1em] uppercase cursor-pointer text-muted hover:text-gold transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
          style={{ border: '1px solid rgba(200,150,60,0.25)' }}
        >
          <Send size={10} className="opacity-60" />
          {t('wallet.send.button')}
        </button>
        <button
          type="button"
          onClick={() => set_show_modal(true)}
          className="flex-1 px-2 py-1.5 text-[9px] tracking-[0.1em] uppercase cursor-pointer text-muted hover:text-gold transition-colors flex items-center justify-center gap-1 whitespace-nowrap"
          style={{ border: '1px solid rgba(200,150,60,0.25)' }}
        >
          <Plus size={10} className="opacity-60" />
          {t('wallet.add_funds')}
        </button>
      </div>

      <button
        type="button"
        onClick={logout}
        className="w-full px-2 py-1.5 text-[9px] tracking-[0.2em] uppercase cursor-pointer text-muted hover:text-red-400 transition-colors flex items-center justify-center gap-1.5 border border-border"
      >
        <LogOut size={10} className="opacity-60" />
        {t('sidebar.disconnect')}
      </button>

      {/* Language picker on mobile only; on desktop the sidebar LanguageCard handles this. */}
      <div className="relative lg:hidden">
        <button
          type="button"
          onClick={() => set_show_lang(!show_lang)}
          className="text-muted hover:text-cyan transition-colors cursor-pointer flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase"
        >
          <Globe size={12} className="opacity-60" />
          {LANGUAGES.find((l) => l.code === i18n.language)?.native || 'English'}
        </button>
        {show_lang && (
          <div className="absolute bottom-full left-0 mb-1 border border-border bg-surface z-50 min-w-[120px]">
            {LANGUAGES.map(({ code, native }) => (
              <button
                key={code}
                type="button"
                onClick={() => {
                  i18n.changeLanguage(code)
                  set_show_lang(false)
                }}
                className={`block w-full text-left px-3 py-1.5 text-[9px] tracking-[0.15em] uppercase cursor-pointer transition-colors ${
                  i18n.language === code ? 'text-cyan bg-cyan/5' : 'text-muted hover:text-text hover:bg-white/[0.02]'
                }`}
              >
                {native}
              </button>
            ))}
          </div>
        )}
      </div>

      {show_modal && <AddFundsModal address={address} on_close={() => set_show_modal(false)} />}
      {show_send && <SendSuiModal on_close={() => set_show_send(false)} />}
    </div>
  )
}
