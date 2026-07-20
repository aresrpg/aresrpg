// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { create } from 'zustand'

// Player-facing SETTINGS store — the one home for client-side gameplay preferences that must survive a
// reload. Shaped as a zustand store (not the plain-module idiom of quality_pref.js/hp_display_pref.js)
// because the tx choke (packages/frontend/src/tx/gas_fallback.ts) needs a SYNCHRONOUS read outside React
// — the same `use_X.getState()` idiom auth/index.ts already uses for `sui_balance_mist`. The localStorage
// mirror is manual (no `zustand/middleware` persist anywhere in this app yet): read once at module init,
// written back on every setter call, fail-open on storage errors (private mode / quota — session-only).

const SPONSORED_GAMEPLAY_KEY = 'aresrpg.sponsored_gameplay_enabled'

/** Default ON — sponsored gameplay is today's behavior; this toggle is opt-OUT, not opt-in. */
function read_sponsored_gameplay_pref(): boolean {
  try {
    const v = localStorage.getItem(SPONSORED_GAMEPLAY_KEY)
    return v === null ? true : v === '1'
  } catch {
    return true
  }
}

interface SettingsState {
  /** OFF ⇒ the tx choke must skip the sponsor fallback and always self-pay (handoff: gas_fallback.ts). */
  sponsored_gameplay_enabled: boolean
  set_sponsored_gameplay_enabled: (enabled: boolean) => void
}

export const use_settings = create<SettingsState>((set) => ({
  sponsored_gameplay_enabled: read_sponsored_gameplay_pref(),
  set_sponsored_gameplay_enabled: (enabled: boolean) => {
    try {
      localStorage.setItem(SPONSORED_GAMEPLAY_KEY, enabled ? '1' : '0')
    } catch {
      /* non-fatal — session-only toggle (private mode / quota) */
    }
    set({ sponsored_gameplay_enabled: enabled })
  },
}))
