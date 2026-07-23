// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Regression pin (owner 2026-07-23, "remove it immediately"): a raw, unstyled fights-nearby count card
// (FightsCount.jsx) rendered over the world view — a floating duplicate of the [V] prompt chip's own
// signal, wearing none of the house design tokens. Deleted; world_fights_discovery.js now folds the
// in-range count straight into the [V] chip's own label (fights_prompt_label) — ONE surface, always inside
// the styled InteractionChip wrapper. Three pins, each catching a different shape of the regression
// returning:
//
//   (a) SOURCE-SHAPE (unconditional, no import) — the deleted file stays deleted, nothing still mounts or
//       styles it, and the discovery module really does wire fights_prompt_label into the prompt it
//       registers (not just define the helper and leave it uncalled).
//   (b) DOM-LEVEL (unconditional) — a prompt shaped exactly like world_fights_discovery.js's registration
//       renders through the REAL InteractionChip (the shared renderer every PromptStack pill funnels
//       through), and the fold text appears ONLY inside the styled .gw-npc-prompt__label span — never a
//       bare/sibling text node. Renders InteractionChip directly rather than the PromptStack wrapper: the
//       wrapper reads its prompt list through zustand's REACT hook, which under true SSR
//       (renderToStaticMarkup) serves the store's frozen getInitialState snapshot and never observes a
//       pre-render `.setState()` — a real zustand/React-18-SSR quirk, not a defect in the store or the
//       component. The label string below is composed inline (not imported) because importing
//       world_fights_discovery.js pulls in engine3/player's character_controller.js → the private-repo
//       senshi_male.glb (#117, MISSING-ARTIFACT) — see (c).
//   (c) BEHAVIORAL (GLB-guarded like its sibling world_spawns.test.js) — fights_prompt_label itself, real
//       import, real i18n, pinning the exact composed + pluralized copy.
import { existsSync, readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import en from '../i18n/locales/en.json'
import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

// ── (a) SOURCE-SHAPE ────────────────────────────────────────────────────────────────────────────────
const discovery_source = readFileSync(new URL('./world_fights_discovery.js', import.meta.url), 'utf8')
const hud_source = readFileSync(new URL('./screens/hud/world/GameWorldHud.jsx', import.meta.url), 'utf8')
const hud_css = readFileSync(new URL('./screens/hud/hud.css', import.meta.url), 'utf8')

test('the raw count-card component file is gone', () => {
  expect(existsSync(new URL('./screens/hud/FightsCount.jsx', import.meta.url))).toBe(false)
})

test('the world HUD no longer imports or mounts a FightsCount card', () => {
  expect(hud_source).not.toContain('FightsCount')
})

test('the old count-card CSS is gone', () => {
  expect(hud_css).not.toContain('.hud-fights-count')
})

test('the [V] prompt registration is wired to fold the count into its own label', () => {
  const arm_at = discovery_source.indexOf('const arm_prompt = ')
  const register_at = discovery_source.indexOf('register_prompt({', arm_at)
  const label_at = discovery_source.indexOf('label: fights_prompt_label(count)', register_at)
  expect(arm_at).toBeGreaterThan(-1)
  expect(register_at).toBeGreaterThan(arm_at)
  expect(label_at).toBeGreaterThan(register_at)
})

// ── (b) DOM-LEVEL — the real InteractionChip, a fights-shaped prompt, no raw text outside the chip ────
const { InteractionChip } = await import('./touch/InteractionChip.jsx')

// Composed inline, NOT imported from world_fights_discovery.js — see header (b): importing it here would
// pull in the GLB-gated engine chain. This is the exact fold formula fights_prompt_label uses; (c) below
// pins that formula itself against the real i18n keys.
const fold_label = (/** @type {number} */ count) =>
  `${en.fights.see_nearby} · ${count} ${count === 1 ? 'fight' : 'fights'} nearby`

test('a fights-shaped [V] prompt renders through the real chip with no raw sibling text node', () => {
  const prompt = { id: 'fights', key: 'V', label: fold_label(2), priority: 70 }
  const html = renderToStaticMarkup(
    createElement(InteractionChip, {
      prompt,
      on_trigger: () => {},
      class_name: 'gw-npc-prompt gw-npc-prompt--stacked gw-panel',
    })
  )
  // the fold text is present exactly once, and ONLY inside the styled label span
  const label_match = html.match(/gw-npc-prompt__label[^>]*>([^<]*)</)
  expect(label_match?.[1]).toBe(fold_label(2))
  // the key cap renders too — the styled hint-card idiom (a bound key + a label), never bare text
  expect(html).toContain('gw-npc-prompt__key')
  // the deleted raw card's class never appears anywhere in this render
  expect(html).not.toContain('hud-fights-count')
  // the fold text never appears OUTSIDE the label span (e.g. as a bare top-level text sibling)
  const outside = html.replace(/<span class="gw-npc-prompt__label">[^<]*<\/span>/, '')
  expect(outside).not.toContain(String(2))
})

// ── (c) BEHAVIORAL — fights_prompt_label itself, real import, GLB-guarded (#117) ──────────────────────
test.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('fights_prompt_label folds the pluralized count, real i18n', async () => {
  const { fights_prompt_label } = await import('./world_fights_discovery.js')
  expect(fights_prompt_label(1)).toBe('See fights in the area · 1 fight nearby')
  expect(fights_prompt_label(2)).toBe('See fights in the area · 2 fights nearby')
})
