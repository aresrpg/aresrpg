// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { Check, Globe, Wifi, WifiOff } from 'lucide-react'
import { useState } from 'react'

import type { AppCopy } from '../i18n/copy.ts'
import { LOCALES, type Locale } from '../i18n/locale.ts'
import type { LinkStatus } from '../modules/session.ts'

export const LanguageCard = ({
  locale,
  change_locale,
}: Readonly<{ locale: Locale; change_locale: (locale: Locale) => void }>) => {
  const [open, set_open] = useState(false)
  const current = LOCALES.find(({ code }) => code === locale)?.native ?? 'English'

  return (
    <div
      className="relative flex w-[200px] flex-col items-center border border-[#4a9eff]/15 bg-[linear-gradient(135deg,rgba(74,158,255,0.04)_0%,rgba(18,18,26,0.95)_50%,rgba(200,150,60,0.03)_100%)] p-3"
      data-language-card=""
    >
      <button
        className="flex w-full cursor-pointer items-center justify-center gap-1.5 text-[9px] tracking-[0.15em] text-[#6b7280] uppercase transition-colors hover:text-[#4a9eff]"
        onClick={() => set_open(!open)}
        type="button"
      >
        <Globe aria-hidden="true" className="opacity-40" size={10} />
        {current}
      </button>
      {open && (
        <div className="absolute right-0 bottom-full left-0 z-10 mb-1 flex flex-col border border-[#1e1e2e] bg-[#12121a]">
          {LOCALES.map(({ code, native }) => (
            <button
              className={`cursor-pointer px-3 py-1.5 text-left text-[9px] tracking-[0.15em] uppercase transition-colors ${
                locale === code
                  ? 'bg-[#4a9eff]/5 text-[#4a9eff]'
                  : 'text-[#6b7280] hover:bg-white/2 hover:text-[#e8e4dc]'
              }`}
              key={code}
              onClick={() => {
                change_locale(code)
                set_open(false)
              }}
              type="button"
            >
              {native}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export const DiscordCard = ({ copy }: Readonly<{ copy: AppCopy }>) => (
  <a
    className="group relative flex w-[200px] items-center justify-center gap-2 overflow-hidden border border-[#5865f2]/30 bg-[linear-gradient(135deg,rgba(88,101,242,0.18)_0%,rgba(114,137,218,0.12)_45%,rgba(18,18,26,0.95)_100%)] p-3 text-white shadow-[0_0_20px_rgba(88,101,242,0.08)] transition-all hover:border-[#5865f2]/70"
    href="https://discord.gg/aresrpg"
    data-discord-card=""
    rel="noopener noreferrer"
    target="_blank"
  >
    <svg
      aria-hidden="true"
      className="shrink-0 fill-[#5865f2] drop-shadow-[0_0_6px_rgba(88,101,242,0.6)] transition-all group-hover:drop-shadow-[0_0_10px_rgba(88,101,242,0.9)]"
      height="14"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.6986.7719 1.3634 1.225 1.9935a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419-.0189 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1569 2.419 0 1.3332-.946 2.4189-2.1569 2.4189Z" />
    </svg>
    <span className="text-[10px] font-semibold tracking-[0.2em]">{copy.join_discord}</span>
  </a>
)

export type IndexingHealthTone = 'unknown' | 'healthy' | 'catching_up' | 'lagging'

export const indexing_health_tone = (lag: number | null): IndexingHealthTone =>
  lag === null ? 'unknown' : lag < 10 ? 'healthy' : lag <= 50 ? 'catching_up' : 'lagging'

export const ConnectionCard = ({
  copy,
  error,
  indexing_lag,
  latency_ms,
  online,
  status,
  violation = null,
}: Readonly<{
  copy: AppCopy
  error: string | null
  indexing_lag: number | null
  latency_ms: number | null
  online: number | null
  status: LinkStatus
  violation?: string | null
}>) => {
  const label = violation
    ? copy.server_violation
    : status === 'ready'
      ? copy.server_connected
      : status === 'connected'
        ? copy.server_syncing
        : status === 'connecting'
          ? error
            ? copy.server_reconnecting
            : copy.server_connecting
          : copy.server_disconnected
  const connected = status === 'ready' && !violation
  const disconnected = status === 'idle' || violation !== null
  const Icon = disconnected ? WifiOff : Wifi
  const indexing_tone = indexing_health_tone(indexing_lag)

  return (
    <div
      aria-label={`${copy.sui_universe}: ${label}`}
      className={`w-[200px] border p-3 ${
        connected
          ? 'border-[#5ee38d]/25 bg-[#5ee38d]/6 text-[#77d99a]'
          : disconnected
            ? 'border-[#ff5a8b]/25 bg-[#ff5a8b]/6 text-[#ff7d9f]'
            : 'border-[#4a9eff]/25 bg-[#4a9eff]/6 text-[#67adff]'
      }`}
      data-connection-card=""
      data-connection-violation={violation ?? undefined}
      role="status"
      title={error ?? undefined}
    >
      <div className="flex items-center gap-2.5">
        <Icon aria-hidden="true" className="shrink-0 opacity-70" size={13} />
        <span className="min-w-0 flex-1">
          <span className="block text-[7px] tracking-[0.2em] text-[#6b7280] uppercase">{copy.sui_universe}</span>
          <span className="mt-0.5 block truncate text-[9px] font-semibold tracking-[0.13em] uppercase">{label}</span>
        </span>
        <span className="shrink-0 text-[8px] tracking-[0.08em] tabular-nums">
          {latency_ms ?? '—'} {copy.latency_unit}
        </span>
        <span
          aria-hidden="true"
          className={`size-1.5 shrink-0 rounded-full ${
            connected
              ? 'bg-[#5ee38d] shadow-[0_0_8px_rgba(94,227,141,0.8)]'
              : disconnected
                ? 'bg-[#ff5a8b]'
                : 'animate-pulse bg-[#4a9eff] shadow-[0_0_8px_rgba(74,158,255,0.7)]'
          }`}
        />
      </div>
      <div className="mt-2 border-t border-white/6 pt-2" data-indexing-health={indexing_tone}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[7px] tracking-[0.16em] text-[#6b7280] uppercase">{copy.indexing_health}</span>
          {indexing_tone === 'healthy' ? (
            <Check aria-hidden="true" className="text-[#5ee38d]" size={11} strokeWidth={2.5} />
          ) : (
            <span
              className={`text-[9px] font-semibold tabular-nums ${
                indexing_tone === 'catching_up'
                  ? 'text-[#d89b3c]'
                  : indexing_tone === 'lagging'
                    ? 'text-[#ff5a8b]'
                    : 'text-[#6b7280]'
              }`}
            >
              {indexing_lag ?? '—'}
            </span>
          )}
        </div>
        {indexing_tone === 'lagging' && (
          <span className="mt-1 block text-[7px] leading-relaxed text-[#ff7d9f]/75">{copy.indexing_lag_warning}</span>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[7px] tracking-[0.16em] text-[#6b7280] uppercase">{copy.online_players}</span>
          <span className="text-[9px] font-semibold tabular-nums">{online ?? '—'}</span>
        </div>
      </div>
    </div>
  )
}
