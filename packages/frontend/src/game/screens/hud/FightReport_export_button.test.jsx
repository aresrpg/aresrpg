// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Owner ruling 2026-07-24 (verbatim): "If I don't see any change visually and can't export then what's the
// point, also remove the R card trigger, the fight result replay should export through a button on the end
// fight result card." Replaces FightReport_trace_keybind.test.jsx (issue #256's wiring fact died with the
// hook it pinned) with the two facts that now matter: the R chord is GONE, and the export door is a real,
// always-visible button — never a hidden affordance a player has to already know exists.
//
// R-REMOVAL PROOF: this repo's HUD component tests are SSR-only (renderToStaticMarkup, no jsdom/happy-dom —
// see PetFeedModal.test.jsx), and a keydown listener only ever attached via a `useEffect`, which never runs
// under SSR — so there is no DOM-executed way to prove "pressing R does nothing" post-deletion. The mechanical
// pin (same technique LevelUp.test.jsx uses for its own dead-code contract) is the honest one: the hook file
// no longer exists, and neither mount site's source spells its name. RED before the fix (source contained
// `use_fight_trace_keybind`, file existed) → GREEN after (both gone) — inherently post-hoc, per the brief.
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import en from '../../../i18n/locales/en.json'
import { FightExportReplayButton } from './FightReport.jsx'

describe('the R export-replay keybind is gone (owner ruling 2026-07-24 — replaced by a button, never a hidden hotkey)', () => {
  test('the hook file itself no longer exists', () => {
    expect(existsSync(new URL('./use_fight_trace_keybind.js', import.meta.url))).toBe(false)
  })

  test('neither former mount site (FightControls, FightReport) wires the hook anymore', () => {
    const controls_source = readFileSync(new URL('./FightControls.jsx', import.meta.url), 'utf8')
    const report_source = readFileSync(new URL('./FightReport.jsx', import.meta.url), 'utf8')
    expect(controls_source).not.toContain('use_fight_trace_keybind')
    expect(report_source).not.toContain('use_fight_trace_keybind')
  })

  test('the export hint no longer advertises the dead "press R" shortcut (en locale — house i18n parity covers the rest; world_spawns.js\'s UNRELATED "press R to attack" onboarding string is untouched, so this pins the export_replay_hint KEY specifically, never a blanket text scan)', () => {
    expect(en.fight_end.export_replay_hint).not.toMatch(/\bR\b/)
    expect(en.fight_end.export_replay_hint).toBe("Download this fight's trace to attach to a bug report")
  })
})

// THE EXPORT BUTTON (owner ruling 2026-07-24) — the click fixture, mirroring FightControls.jsx's own
// FightEndTurnButton pattern exactly: FightExportReplayButton is a hook-free function component, so calling
// it directly returns the React element and `.props.onClick`/`.props.disabled` are readable without a DOM
// (this repo's SSR-only test convention — see file header). Always rendered by FightReport (never absent);
// `trace_available` gates ENABLED, never existence.
describe('FightExportReplayButton — the click fixture (no DOM needed)', () => {
  test('enabled when a trace is available — clicking fires the export handler exactly once', () => {
    let calls = 0
    const btn = FightExportReplayButton({
      trace_available: true,
      on_export: () => {
        calls += 1
      },
      label: 'Export replay',
      hint: 'Download this fight\'s trace to attach to a bug report',
    })
    expect(btn.props.disabled).toBe(false)
    expect(btn.props.className).toContain('btn--secondary')
    btn.props.onClick()
    expect(calls).toBe(1)
  })

  test('disabled when no trace is available — the button still renders (never absent), just inert', () => {
    let calls = 0
    const btn = FightExportReplayButton({
      trace_available: false,
      on_export: () => {
        calls += 1
      },
      label: 'Export replay',
      hint: 'Download this fight\'s trace to attach to a bug report',
    })
    expect(btn.props.disabled).toBe(true)
    expect(btn.props.className).toContain('btn--secondary')
  })
})
