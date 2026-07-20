// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// KOLIZEUM LEVEL HONESTY — the create/join CTA's affordance pre-check label, split out
// of kolizeum.tsx so it's importable WITHOUT pulling in the page's auth/SDK/RPC import graph (kolizeum.tsx →
// ../auth registers Enoki wallets at module load, which touches `window` unconditionally — this repo's
// DOM-less bun:test environment has none; see kolizeum.test.tsx). Pure, zero deps. The actual gating
// decision (`below_gate`) stays in kolizeum.tsx (it needs live state); this is only the label swap, shared
// by the create button and every row's join button so both doors read identically.

/** The CTA label: the honest "Requires level N" copy when the selected character is below the live
 * kolizeum gate, else the door's normal call-to-action. */
export function gate_cta_label(
  t: (key: string, opts?: Record<string, unknown>) => string,
  below_gate: boolean,
  gate: number | null,
  normal_label: string
) {
  return below_gate ? t('kolizeum.requires_level', { level: gate }) : normal_label
}
