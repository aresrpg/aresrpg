// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DECK SPELL-BAR ICON regression ("no icon for senshi spell ? they reapeared only
// after a refresh"). SpellSocket (DeckCluster.jsx) carried its OWN bare useState(false)+onError latch — the
// exact pin-forever bug already fixed for SpellArt (SpellDetail.jsx) / ItemIcon via the shared retry ladder
// (image_retry.js, design ruling 2026-07-17: pictures must not go missing until refresh) but never ported to the fight bar. A
// class switch mounts a BURST of fresh sockets at once (new spell name_keys → new React keys), and a cold
// Walrus quilt-patch miss under that burst 404'd once and pinned the element-tinted-initial fallback for
// the socket's whole mount life — only a full page refresh (fresh mount, warm edge) cleared it. Same
// hook_runner/find_img idiom as image_retry.test.jsx (no DOM harness needed — SpellSocket's only hook is
// use_image_retry → useState).

import { expect, test } from 'bun:test'
import React, { Children, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { configure_walrus_assets } from '@aresrpg/sdk/jobs'

import { SpellSocket } from './deck-spell-socket.jsx'
import { IMAGE_RETRY_DELAYS_MS } from './image_retry.js'

const AGGREGATOR = 'https://hud-retry.example'
const SPELL_QUILT = 'hud-retry-spell-icons'
const url_for = (icon) => `${AGGREGATOR}/v1/blobs/by-quilt-id/${SPELL_QUILT}/${icon}.png`

const configure = () =>
  configure_walrus_assets({ aggregator: AGGREGATOR, classes: { spell: { quilt: SPELL_QUILT } } })

// class-A's starter (whatever class was active first) vs a senshi level-1 spell (Warcleave — one of the
// THREE level-1 senshi starters that match the "slots 1-3" report; name_key = 'warcleave').
const class_a_card = { name: 'Fire Strike', icon: 'fire_strike', cost: 4 }
const senshi_card = { name: 'Warcleave', icon: 'warcleave', cost: 3 }

const socket_props = (card, spell_id) => ({
  keyCap: '1',
  card,
  color: '#f2a900',
  spell_id,
  armed: false,
  enabled: true,
  glow: false,
  cd_left: 0,
  exhausted: false,
  onPick: () => {},
})

/** Minimal hook dispatcher (same idiom as image_retry.test.jsx / mob_image.test.tsx) — useState survives
 * re-renders so a component's own event handlers can be driven without a DOM harness. */
function hook_runner() {
  const slots = []
  let cursor = 0
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE
  const dispatcher = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      const set_value = (next) => {
        slots[index] = typeof next === 'function' ? next(slots[index]) : next
      }
      return [slots[index], set_value]
    },
  }
  return {
    render(element) {
      if (typeof element.type !== 'function') throw new Error('expected a function component')
      cursor = 0
      const previous = internals.H
      internals.H = dispatcher
      try {
        return element.type(element.props)
      } finally {
        internals.H = previous
      }
    },
  }
}

function find_img(root) {
  if (!isValidElement(root)) return null
  if (root.type === 'img') return root
  for (const child of Children.toArray(root.props.children)) {
    const found = find_img(child)
    if (found) return found
  }
  return null
}

test('SpellSocket: a freshly-switched senshi spell resolves its art on the very first render', () => {
  configure()
  // class A's socket mounts and resolves fine (sanity — never the broken leg).
  const class_a_runner = hook_runner()
  const class_a_img = find_img(class_a_runner.render(<SpellSocket {...socket_props(class_a_card, 'fire_strike')} />))
  expect(class_a_img?.props.src).toBe(url_for('fire_strike'))

  // Switching to senshi mounts a BRAND NEW SpellSocket (key = the new spell_id) — a fresh instance, exactly
  // like DeckCluster's real render loop (key={spell_id}).
  const senshi_runner = hook_runner()
  const senshi_img = find_img(senshi_runner.render(<SpellSocket {...socket_props(senshi_card, 'warcleave')} />))
  expect(senshi_img?.props.src).toBe(url_for('warcleave'))
})

test('SpellSocket: a transient miss during the switch burst self-heals instead of pinning the fallback until a refresh', async () => {
  configure()
  const runner = hook_runner()
  const element = <SpellSocket {...socket_props(senshi_card, 'warcleave')} />

  const first_img = find_img(runner.render(element))
  if (!first_img) throw new Error('expected the first render to attempt the resolved senshi spell icon')
  expect(first_img.props.src).toBe(url_for('warcleave'))

  // The concurrent-burst cold-edge window (image_retry.js header): the FIRST request errors — a class
  // switch fires several of these sockets at once, exactly the trigger the shared ladder was built for.
  first_img.props.onError()

  // Degrading to the tinted-initial fallback immediately is fine — but once the first retry deadline has
  // elapsed a FRESH <img> attempt must exist. THE NEVER-LATCH ASSERTION: a late-arriving/self-healed quilt
  // patch must fill the previously-missed icon on its own; the pin-forever regression only ever healed on
  // a full page refresh (a fresh mount with a warm edge).
  await Bun.sleep(IMAGE_RETRY_DELAYS_MS[0] + 600)
  const retry_img = find_img(runner.render(element))
  expect(retry_img?.props.src).toBe(url_for('warcleave'))
})

// #368 RED-FIRST: cooldown reads as a BIG centered number (promoted from the FIX-4 07-14 small corner badge)
// — the icon's grey/desaturate treatment rides the pre-existing `.disabled` class (enabled=false) unchanged.
test('SpellSocket: cd_left > 0 renders the big centered cooldown overlay, never the old corner badge', () => {
  configure()
  const html = renderToStaticMarkup(
    React.createElement(SpellSocket, { ...socket_props(senshi_card, 'warcleave'), enabled: false, cd_left: 2 })
  )

  expect(html).toContain('hud-socket__cd-overlay')
  expect(html).not.toContain('class="hud-socket__cd ') // the superseded small corner badge must never reappear
  expect(html).toContain('>2<')
  expect(html).toContain(' disabled') // the desaturate+dim treatment still rides the shared .disabled class
})

test('SpellSocket: cd_left === 0 renders no cooldown overlay at all', () => {
  configure()
  const html = renderToStaticMarkup(React.createElement(SpellSocket, socket_props(senshi_card, 'warcleave')))

  expect(html).not.toContain('hud-socket__cd-overlay')
})
