// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST (issue #20 "World picker lost its level gates"): world_travel_state.test.js already proves the
// PURE `locked` predicate is correct, and WorldSwitcher.test.jsx already proves the /v1 gate join resolves —
// but neither ever actually OPENS the travel modal (WorldSwitcher's `travel_open` state is mocked to its
// resting `false`, and WorldTravelModal returns null before ever reaching a card), so nothing in this suite
// renders an actual world card and checks the thing a player sees: a locked world's GO button disabled, an
// unlocked one live. That gap is exactly where a real "all worlds joinable" regression could ship green.
// This file closes it at the render layer via WorldTravelModalContent (the portal-free split — see its own
// doc comment in WorldTravelModal.jsx; this repo's convention is renderToStaticMarkup with no jsdom/
// happy-dom, which cannot resolve WorldTravelModal's own createPortal target).
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { spyOn } from 'bun:test'

import { reset_auth_mock } from '../../../../test_helpers/auth_mock.js'

reset_auth_mock()
const react_i18next = await import('react-i18next')
spyOn(react_i18next, 'useTranslation').mockImplementation(() => ({
  t: (key, arg) => (arg && typeof arg === 'object' && 'level' in arg ? `LV ${arg.level}+` : key),
}))

const { WorldTravelModalContent } = await import('./WorldTravelModal.jsx')

// A realistic 64-hex object id per card (the exact shape live /v1 + T62_WORLDS ids take), not a
// hand-matched short fake — WorldTravelModalContent is a pure view, so this only proves the RENDER
// contract: derive_world_cards' `locked`/`required_level` output must reach the DOM as a disabled,
// relabeled button, independent of whether the join upstream actually matched (that's the other suites' job).
const under_leveled_card = {
  id: '0x1111111111111111111111111111111111111111111111111111111111a1',
  label: 'Emberfall Steppe',
  biome: 'ash_steppe',
  band: [10, 24],
  required_level: 10,
  here: false,
  locked: true, // character level 4 < gate 10 (mirrors world_travel_state.test.js's own fixture)
  mob_count: 3,
  boss_count: 1,
  resource_count: 2,
}

const accessible_card = {
  id: '0x2222222222222222222222222222222222222222222222222222222222b2',
  label: 'First Shore',
  biome: 'archipelago',
  band: [1, 12],
  required_level: 1,
  here: false,
  locked: false,
  mob_count: 3,
  boss_count: 0,
  resource_count: 3,
}

const render_modal = (cards) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <WorldTravelModalContent
        on_close={() => {}}
        cards={cards}
        accessible_only={false}
        on_filter={() => {}}
        can_travel
        on_travel={() => {}}
      />
    </MemoryRouter>
  )

describe('WorldTravelModalContent — the level gate at the render layer', () => {
  test('a locked card renders its GO button disabled and relabeled with the required level', () => {
    const html = render_modal([under_leveled_card])
    // A disabled attribute is only present in React SSR output when disabled is truthy — this is the exact
    // assertion "all worlds joinable at level 1" would fail: without derive_world_cards' locked flag
    // reaching this button, disabled="" never appears and "join" (not "LV 10+") would show instead.
    expect(html).toContain('disabled=""')
    expect(html).toContain('LV 10+')
    expect(html).not.toContain('>world_switcher.join<')
  })

  test('an unlocked card renders its GO button live, with the join label — never disabled', () => {
    const html = render_modal([accessible_card])
    expect(html).not.toContain('disabled=""')
    expect(html).toContain('>world_switcher.join<')
  })

  test('mixed list: locked and unlocked cards each render their OWN correct gate independently', () => {
    const html = render_modal([under_leveled_card, accessible_card])
    expect(html).toContain('disabled=""')
    expect(html).toContain('LV 10+')
    expect(html).toContain('>world_switcher.join<')
  })

  test('the live required_level always renders on the card — never silently hidden', () => {
    const html = render_modal([under_leveled_card])
    expect(html).toContain('LV 10+')
  })
})
