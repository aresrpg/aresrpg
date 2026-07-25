// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert, RefreshCw } from 'lucide-react'

import { use_auth, type AuthState } from '../auth'
import { get_config } from '../rpc/client'
import { use_rpc_view } from '../rpc/use_view'
import { DISCORD_URL } from '../constants/links'

import { ModalFrame } from './modal_frame'
import { use_contracts_paused, type TriBool } from './contracts_paused_store'

// S-84 — CONTRACTS PAUSED modal. The Move packages ship a Version/GameConfig `enabled` flag (the ceremony
// publishes DARK, `--enable` flips live; maintenance can re-pause). Two independent DETECTION layers feed ONE
// store (contracts_paused_store.ts), mirroring sponsor_runout_modal.tsx's file shape (store + always-mounted
// host + the modal itself):
//
//   PROACTIVE (boot + interval + window focus): GameConfig's global master switch, via the existing
//     `/v1/config` view (`enabled` — the reads law: prefer /v1, since it already projects this one).
//   REACTIVE (the net): abort_copy.js's `on_maintenance_abort` hook (wired in contracts_paused_store.ts) fires
//     the instant ANY tx aborts `version::assert_enabled` (module "version", code 102, ANY package) — catches
//     a mid-session pause instantly, without waiting for the next poll.
//
// SCOPE NOTE — a per-package `version::Version.enabled` chain-direct proactive read (mirroring
// publish_actions.ts's admin `read_version()`) was built and dropped: it trips `scripts/v1_reads_gate.py`,
// which went ABSOLUTE 2026-07-12 (shrink-only baseline; "a genuinely-new sanctioned read needs an EXPLICIT
// OWNER edit... never an agent addition"). It doesn't fit any exempt class (PREFLIGHT/ADMIN/ARCH/VERIFY/
// FALLBACK/PETBOX) — it's a genuine new player-facing game-state read, exactly what the gate exists to catch.
// The indexer ALREADY projects it (`("version","EnabledSet")` → redis `rpc:package:<addr>.enabled`,
// project.rs) — it just isn't served by any /v1 view yet. Until an approved `/v1/config` extension (or
// an allowlist line) lands, BOOT-time detection of a per-package-only pause (no GameConfig flip, no tx
// attempted yet) is NOT covered — the reactive net still catches it the instant a player attempts any tx.
//
// An explicit `false` from the poll is a CONFIRMED pause; an unreadable/never-toggled signal (`null`) is
// UNKNOWN and must never be treated as "paused" (a network hiccup must never blank the whole game) nor as
// "live" (never silently clears a real pause) — see contracts_paused_store.ts's `report`.

const POLL_MS = 30_000 // maintenance state changes rarely; the reactive net covers the instant mid-session case

async function fetch_maintenance_signal(signal: AbortSignal): Promise<TriBool> {
  const config = await get_config(signal)
  return config?.enabled ?? null
}

// Always-mounted host: polls the GameConfig chain-liveness signal (boot + interval + window focus) and reacts
// to the tx-abort net (contracts_paused_store.ts's module-scope wire). Renders nothing until an address is
// connected, a pause is confirmed, AND the player hasn't dismissed this occurrence — never blocks the
// logged-out spectate landing / the standalone /mint page (app.tsx never mounts this on those surfaces).
// Mount ONCE (app.tsx), beside <SponsorRunoutModalHost/>.
export function ContractsPausedModalHost() {
  const address = use_auth((s: AuthState) => s.address)
  const paused = use_contracts_paused((s) => s.paused)
  const dismissed = use_contracts_paused((s) => s.dismissed)
  const report = use_contracts_paused((s) => s.report)
  const dismiss = use_contracts_paused((s) => s.dismiss)

  const { data, refetch } = use_rpc_view(fetch_maintenance_signal, {
    enabled: !!address,
    interval_ms: POLL_MS,
    deps: [address],
  })

  useEffect(() => {
    report(data)
  }, [data, report])

  // "on window focus" (brief-literal), on top of use_rpc_view's own visibilitychange catch-up-on-re-show.
  useEffect(() => {
    const on_focus = () => refetch()
    window.addEventListener('focus', on_focus)
    return () => window.removeEventListener('focus', on_focus)
  }, [refetch])

  if (!paused || dismissed || !address) return null
  return <ContractsPausedModal on_retry={refetch} on_dismiss={dismiss} />
}

function ContractsPausedModal({ on_retry, on_dismiss }: { on_retry: () => void; on_dismiss: () => void }) {
  const { t } = useTranslation()

  // Dismissible (owner ruling 2026-07-24, "I should be able to close it") — ESC / backdrop click / the corner
  // X all close it, mirroring sponsor_runout_modal's idiom (this file's own header comment already documents
  // that mirror). The underlying `paused` truth is untouched by dismissal — the chain really is paused, only
  // the wall hides — so the player can browse whatever doesn't need a tx. Re-arm semantics live in
  // contracts_paused_store.ts's `dismissed` latch: a live version/102 abort or a fresh pause onset reopens it,
  // a routine reconfirming poll does not.
  return (
    <ModalFrame on_close={on_dismiss} label={t('maintenance.title')}>
      <div className="flex flex-col items-center px-8 py-8 gap-5">
        <ShieldAlert size={34} style={{ color: '#c8963c', filter: 'drop-shadow(0 0 12px rgba(200,150,60,0.5))' }} />
        <div className="text-gradient text-[13px] font-semibold tracking-[0.28em] uppercase text-center">
          {t('maintenance.title')}
        </div>

        <div className="w-full h-px bg-border" />

        <div className="text-text/70 text-[10px] tracking-wide text-center leading-relaxed">
          {t('maintenance.body')}
        </div>

        <div className="flex gap-3 w-full mt-2">
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-gold flex-1 py-2.5 px-4 text-[10px] tracking-[0.15em] cursor-pointer text-center"
          >
            {t('maintenance.discord_cta')}
          </a>
          <button
            type="button"
            className="btn-outline flex-1 py-2.5 px-4 text-[10px] tracking-[0.2em] cursor-pointer flex items-center justify-center gap-1.5"
            onClick={on_retry}
          >
            <RefreshCw size={11} />
            {t('maintenance.retry')}
          </button>
        </div>
      </div>
    </ModalFrame>
  )
}
