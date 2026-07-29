// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE boot-smoke blocking decision, as one pure function. It lives apart from boot_smoke.mjs because that
// script spawns a preview server and a browser the moment it is imported — this module imports clean, so
// the decision is testable without driving a browser.

// ALLOWLIST — console.error substrings tolerated at boot. Each entry names its cause. The PRIMARY signal is
// pageerror === 0 (the uncaught migration-stub throw class); console.error catches loud degrades + regressions.
export const CONSOLE_ERROR_ALLOWLIST = [
  // #106 — the spell corpus is a runtime blob (spell_corpus.json) the seed ceremony publishes, NEVER a repo
  // artifact. Until it publishes, load_spell_corpus degrades loudly to inert spell surfaces. THIS PR's line.
  '[spell-corpus] no spell_corpus runtime asset',
  // #94 (merged) — the deployment-pin manifest is absent in the open-source tree; resolve_seed_manifest
  // degrades loudly. Allowlisted per the ruling's known-content-degrade clause.
  '[seed_manifest] no seed manifest at',
  // #106 eager-cascade degrades (inventory rows) — content consumers that used to THROW at module load,
  // crashing boot before the spell fix mattered; now they degrade loudly + inert. Full runtime-loader
  // conversion is boarded follow-up; degrade-only is the crash-killer.
  '[deployment] seed manifest carries no worlds', // deployment.ts — worlds enumeration
  '[world_corpus] world knowledge inert', // world_corpus.ts — runtime blob unpublished/unreachable in CI (#196)
  '[living_corpus] seed manifest carries', // living_corpus.ts — living-content fence
  // Environmental — unpublished assets 404 in the headless CI preview. Keep the status in the match:
  // a broad "Failed to load resource" entry also swallows a real 500 from the boot-serving path.
  'Failed to load resource: the server responded with a status of 404',
]

export const is_blocking_console_error = (text) => !CONSOLE_ERROR_ALLOWLIST.some((fragment) => text.includes(fragment))
