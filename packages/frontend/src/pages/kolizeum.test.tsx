// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// kolizeum.test.tsx — KOLIZEUM LEVEL HONESTY: the create/join CTA must show WHY it's
// disabled (the level gate), not just refuse silently. KolizeumPage itself can't be mounted here at all:
// it imports ../auth, which calls registerEnokiWallets() at MODULE LOAD (not even needing a render) — that
// crashes on `window is not defined` in this repo's DOM-less bun:test environment (no RTL/jsdom harness —
// see item_detail_view.test.tsx's note; adding one would violate minimal-deps). gate_cta_label lives in the
// dependency-free pages/kolizeum_gate.ts for exactly this reason (it also collapses the create/join buttons'
// duplicated ternary in kolizeum.tsx — a real second-use DRY win, not test-only scaffolding) — proven
// directly, then rendered through the exact button shape both call sites use.
// NOTE: the testnet gate is live-dialed to 1 (QA) — re-dialing it to prove this is NOT allowed.
// Every "below gate" scenario here is a MOCKED gate value, per that constraint.
import { readFileSync } from 'node:fs'

import { describe, test, expect } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import i18next from 'i18next'

import en from '../i18n/locales/en.json'
import fr from '../i18n/locales/fr.json'

import { gate_cta_label } from './kolizeum_gate'

const read_fixture = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

const test_i18n = i18next.createInstance()
test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en }, fr: { translation: fr } },
  interpolation: { escapeValue: false },
})

describe('gate_cta_label — the affordance pre-check copy', () => {
  test('below gate: returns the REAL "requires_level" i18n string, gate number interpolated', () => {
    const t = test_i18n.getFixedT('en')
    expect(gate_cta_label(t, true, 50, 'Create lobby')).toBe('Requires level 50')
  })

  test('below gate in another locale: the interpolation mechanism is not English-only', () => {
    const t = test_i18n.getFixedT('fr')
    expect(gate_cta_label(t, true, 50, 'Créer le salon')).toBe('Niveau 50 requis')
  })

  test('at or above gate: the normal call-to-action passes through untouched', () => {
    const t = test_i18n.getFixedT('en')
    expect(gate_cta_label(t, false, 50, 'Create lobby')).toBe('Create lobby')
  })

  test('gate unknown (null — fetch in flight, or never dialed since the last publish): fails OPEN, normal CTA', () => {
    const t = test_i18n.getFixedT('en')
    // below_gate is computed by the caller as `gate != null && level != null && level < gate`; a null gate
    // makes that false BEFORE gate_cta_label is even called — this proves the label side stays inert too.
    expect(gate_cta_label(t, false, null, 'Create lobby')).toBe('Create lobby')
  })
})

// The exact button shape both the create CTA and every row's join CTA use (disabled once `below_gate`,
// label swapped to the requirement). Proven via renderToStaticMarkup — no live browser, no re-dialing the
// testnet gate (not allowed — see kolizeum.tsx's pre-check comment): the gate is MOCKED here.
function GateButton({ below_gate, gate, cta }: { below_gate: boolean; gate: number | null; cta: string }) {
  const t = test_i18n.getFixedT('en')
  return <button disabled={below_gate}>{gate_cta_label(t, below_gate, gate, cta)}</button>
}

describe('the CTA button markup — disabled-with-reason state (mocked gate, per owner proof bar)', () => {
  test('a level-50 gate against a below-level character: disabled, "Requires level 50" inline', () => {
    const html = renderToStaticMarkup(<GateButton below_gate={true} gate={50} cta="Create lobby" />)
    expect(html).toContain('disabled')
    expect(html).toContain('Requires level 50')
    expect(html).not.toContain('Create lobby')
  })

  test('the live testnet reality (gate=1): every real character is ≥1, so the button stays enabled', () => {
    const html = renderToStaticMarkup(<GateButton below_gate={false} gate={1} cta="Create lobby" />)
    expect(html).not.toContain('disabled')
    expect(html).toContain('Create lobby')
  })
})

// MOBFIX defect #3 (full-app mobile audit, /kolizeum at 390px): the OPEN-LOBBIES table header, the empty
// "NO LOBBIES" message, and the 1V1/3V3/6V6 format toggle all bled off the right edge. KolizeumPage can't
// be mounted here (it imports ../auth -> registerEnokiWallets() at module load, the same window-less
// crash kolizeum_gate.ts was carved out to dodge — see the file header above). Source-text assertions
// (mobile_layout.test.jsx's established probe pattern) are the safe oracle for the JSX/CSS wiring.
describe('kolizeum mobile layout (MOBFIX defect #3)', () => {
  test('the tabs+format-toggle row wraps the format chips onto their own line on mobile instead of scrolling off-screen', () => {
    const tsx = read_fixture('./kolizeum.tsx')
    expect(tsx).toContain('kolizeum-tabbar')
    expect(tsx).toContain('kolizeum-format-chips')
    const css = read_fixture('../mobile_app_shell.css')
    const rule = css.match(/\.app-shell--mobile \.kolizeum-tabbar\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/flex-wrap:\s*wrap\s*!important/)
  })

  test('the format chips forced onto their own line stop trying to scroll (their own auto-margin push is cancelled)', () => {
    const css = read_fixture('../mobile_app_shell.css')
    const rule = css.match(/\.app-shell--mobile \.kolizeum-tabbar \.kolizeum-format-chips\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/margin-left:\s*0\s*!important/)
  })

  test('the lobby table forces its wide scroll-width only on real header/row structure, never the empty-state message', () => {
    const tsx = read_fixture('./kolizeum.tsx')
    // header row and every mapped lobby row both carry the scoping class...
    expect(tsx.match(/className="kolizeum-row/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // ...but the centred empty/loading message div does not, so it never inherits the forced min-width.
    const empty_block = tsx.match(/rows\.length === 0 \? \(([\s\S]*?)\) : \(/)?.[1] ?? ''
    expect(empty_block).not.toContain('kolizeum-row')
    const css = read_fixture('../mobile_app_shell.css')
    expect(css).toContain('.app-shell--mobile .kolizeum-table-scroll > .kolizeum-row')
    expect(css).not.toMatch(/\.kolizeum-table-scroll > div\s*\{/)
  })

  test('the scrollable table gets the same edge-fade affordance as the bottom nav — no more silent, undiscoverable clip', () => {
    const css = read_fixture('../mobile_app_shell.css')
    const rule = css.match(/\.app-shell--mobile \.kolizeum-table-scroll\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/mask-image:\s*linear-gradient/)
  })
})
