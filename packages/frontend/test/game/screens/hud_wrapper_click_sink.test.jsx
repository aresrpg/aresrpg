// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #871 CLASS GUARD — no full-frame click sink inside the HUD wrapper.
//
// GameWorldHost mounts every in-world layer as a sibling inside ONE `zIndex: 12` wrapper whose entire
// discipline is `pointerEvents: 'none'`: the layer roots stay click-through and each interactive panel opts
// back in on its own (`.gw-hud > *`). Nothing enforced that discipline, so `.world-character-create`'s
// full-frame `pointer-events: auto` — inherited by the roster-ERROR variant, which is a small notice card,
// not a veil — turned the whole world frame into a click sink: driven `elementsFromPoint` at every HUD
// control returned `DIV.world-character-create.world-character-create--error` with the control one layer
// beneath, and a real click at the chat input left `document.activeElement` on BODY.
//
// This guard is the shape's regression net, in two passes:
//   (A) the MOUNTED siblings — the real class signatures the wrapper renders (from the real components and
//       the real class-name producers), resolved through the real CSS cascade: a full-frame sibling that
//       hit-tests must be an allowlisted, intentional veil.
//   (B) the CSS SURFACE — any rule anywhere in the HUD/create stylesheets that declares the shape
//       (full-frame box + `pointer-events: auto`) must be allowlisted too, so a NEW sink is caught the
//       moment it is written, whoever mounts it.
//
// Cascade model (stated, since it is a model): top-level rules only (an `@media` rule is conditional and
// cannot be resolved without a viewport), compound CLASS selectors only (`.a`, `.a.b` — combinator and
// element rules are skipped, they cannot make a root full-frame on their own), later source order wins
// (every selector here is one class deep, so specificity ties and order IS the cascade). Pass (B) reads the
// conditional rules too — it judges the shape, not the resolved value.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorldCharacterCreateSurface } from '../../../src/game/screens/hud/world/WorldCharacterCreate.jsx'
import { fight_layer_class, world_hud_class } from '../../../src/game/screens/hud/mobile_layout.js'

// The stylesheets that can style a wrapper sibling's ROOT, in load order.
const CSS_FILES = [
  '../../../src/game/screens/hud/hud.css',
  '../../../src/game/screens/hud/world/game-world-hud.css',
  '../../../src/game/screens/hud/mobile-hud.css',
  '../../../src/game/screens/hud/mobile-fight-hud.css',
  '../../../src/game/screens/character-create.css',
]

// Intentional veils: a full-frame layer that DOES hit-test on purpose, because it owns the surface it covers
// and paints an opaque backdrop over it — there is nothing behind it a player could want to reach.
const ALLOWED_VEILS = {
  // the confirmed-empty onboarding creator: it replaces the world slot outright and paints `.cc__veil`.
  '.world-character-create': 'first-character creator — owns the whole world slot, paints its own veil',
  // the mobile drawer's modal backdrop: a real modal scrim whose whole job is to swallow the tap that
  // dismisses it (mobile-hud.css, z-index 180).
  '.mobile-hud-drawer-backdrop': 'mobile drawer scrim — a modal backdrop, tap-to-dismiss is its purpose',
}

const read = (relative_path) => readFileSync(new URL(relative_path, import.meta.url), 'utf8')

/** @returns {{ selector: string, decls: Record<string, string>, conditional: boolean }[]} */
function parse_rules(css, conditional = false) {
  const rules = []
  let buffer = ''
  let index = 0
  while (index < css.length) {
    const char = css[index]
    if (char === '}') {
      buffer = ''
      index += 1
      continue
    }
    if (char !== '{') {
      buffer += char
      index += 1
      continue
    }
    const selector = buffer.trim()
    buffer = ''
    let depth = 1
    let end = index + 1
    while (end < css.length && depth > 0) {
      if (css[end] === '{') depth += 1
      else if (css[end] === '}') depth -= 1
      end += 1
    }
    const body = css.slice(index + 1, end - 1)
    if (selector.startsWith('@')) rules.push(...parse_rules(body, true))
    else rules.push({ selector, decls: parse_declarations(body), conditional })
    index = end
  }
  return rules
}

function parse_declarations(body) {
  return Object.fromEntries(
    body
      .split(';')
      .map((declaration) => declaration.split(':'))
      .filter((parts) => parts.length >= 2)
      .map(([property, ...value]) => [property.trim(), value.join(':').trim()])
      .filter(([property]) => /^[a-z-]+$/.test(property))
  )
}

const ALL_RULES = CSS_FILES.flatMap((file) => parse_rules(read(file).replace(/\/\*[\s\S]*?\*\//g, '')))

const CLASS_SELECTOR = /^(\.[A-Za-z0-9_-]+)+$/
const selector_matches = (selector, tokens) =>
  selector
    .split(',')
    .map((part) => part.trim())
    .some(
      (part) =>
        CLASS_SELECTOR.test(part) &&
        part
          .split('.')
          .filter(Boolean)
          .every((token) => tokens.includes(token))
    )

/** The declarations that survive the cascade for an element carrying exactly `tokens`. */
const resolve = (tokens) =>
  ALL_RULES.filter((rule) => !rule.conditional && selector_matches(rule.selector, tokens)).reduce(
    (style, rule) => ({ ...style, ...rule.decls }),
    {}
  )

const is_zero = (value) => value === '0' || value === '0px'
const is_full_frame = (style) =>
  ['absolute', 'fixed'].includes(style.position) &&
  (is_zero(style.inset) ||
    [style.top, style.right, style.bottom, style.left].every(is_zero) ||
    (style.width === '100%' && style.height === '100%'))

/** Every class signature the z:12 wrapper mounts as a direct child, from the real producers. */
const mounted_signatures = () => {
  const rendered = ['create', 'error'].flatMap(
    (mode) =>
      renderToStaticMarkup(<WorldCharacterCreateSurface mode={mode} />).match(/^<div class="([^"]+)"/)?.[1] ?? []
  )
  const hud = [true, false].flatMap((mobile) =>
    [true, false].map((bottom_chrome) => world_hud_class(mobile, bottom_chrome))
  )
  const fight = [true, false].map((mobile) => fight_layer_class(mobile))
  return [...new Set([...rendered, ...hud, ...fight])].map((signature) => signature.trim().split(/\s+/))
}

describe('#871 — the HUD wrapper hit-test discipline', () => {
  test('the wrapper itself is click-through, and mounts only the two known layer owners', () => {
    const host = read('../../../src/GameWorldHost.tsx')
    const wrapper = host.match(/style=\{\{ \.\.\.frame, zIndex: 12, pointerEvents: 'none' \}\}([\s\S]*?)\n {10}<\/div>/)
    expect(wrapper, "the z:12 HUD wrapper still declares pointerEvents: 'none' — every child inherits it").not.toBe(
      null
    )
    expect([...new Set(wrapper[1].match(/<[A-Z][A-Za-z]*/g))].sort()).toEqual([
      '<GameWorldHud',
      '<Profiler',
      '<WorldCharacterCreate',
    ])
  })

  test('no mounted wrapper sibling is a full-frame click sink', () => {
    const sinks = mounted_signatures()
      .map((tokens) => ({ tokens, style: resolve(tokens) }))
      // a child with no `pointer-events` of its own INHERITS the wrapper's `none` — only an explicit
      // `auto` on a full-frame box turns a layer root into a sink.
      .filter(({ style }) => is_full_frame(style) && style['pointer-events'] === 'auto')
      .map(({ tokens }) => `.${tokens.join('.')}`)
      .filter((signature) => !(signature in ALLOWED_VEILS))
    expect(sinks, 'a full-frame pointer-events:auto sibling swallows every HUD control beneath it').toEqual([])
  })

  test('the CSS surface declares the veil shape nowhere but the allowlist', () => {
    const shapes = [
      ...new Set(
        ALL_RULES.filter((rule) => is_full_frame(rule.decls) && rule.decls['pointer-events'] === 'auto').map(
          (rule) => rule.selector
        )
      ),
    ]
    expect(shapes.filter((selector) => !(selector in ALLOWED_VEILS))).toEqual([])
  })

  test('the roster-error notice hit-tests as its card, never as the frame', () => {
    const frame = resolve(['world-character-create', 'world-character-create--error'])
    expect(frame['pointer-events']).toBe('none')
    // the card opts back in through the frame's child rule — the one thing here that is both visible and
    // clickable (the frame no longer paints a full-frame backdrop either, so the HUD behind stays honest).
    expect(read('../../../src/game/screens/character-create.css')).toMatch(
      /\.world-character-create--error > \*\s*\{[^}]*pointer-events:\s*auto/
    )
    expect(frame.background).toBeUndefined()
  })
})
