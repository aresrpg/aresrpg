// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST regression: mob resistances are stored on-chain CENTERED @32768 (spell.move RES_SHIFT — the
// same convention item_stats.move's ItemStatistics uses; packages/move/foundation/sources/spell.move
// decenter_mob_resistances). A live testnet boar's ACTUAL wire stats — earth=32808 water=32768
// air=32748 (fire=32768, neutral) — pin the exact numbers: decode_mob_resist must turn each wire int into
// its real signed delta (+40 / 0 / -20 / 0), and MobDetailView must render those decoded values, never the
// raw centered int leaking to the DOM.
import { expect, test } from 'bun:test'
import i18next from 'i18next'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'

import en from '../../i18n/locales/en.json'
import { MobDetailView } from '../../components/mob_detail_view'
import { seed_manifest } from '../../content/seed_manifest'
import { render_group_card } from '../../game/spawn_card'
import type { RpcEncyclopediaMob } from '../../rpc/views'
import encyclopedia_fixture from '../../rpc/fixtures/encyclopedia.json'

import { BestiaryMobRow, bestiary_mobs_from_v1, decode_mob_resist } from './bestiary_tab'

const test_i18n = i18next.createInstance()
test_i18n.init({
  lng: 'en',
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false },
})

// The live boar's actual on-chain wire values (content house, verified against live testnet).
const WIRE_BOAR = { earth: 32808, water: 32768, air: 32748, fire: 32768 }

// eslint-disable-next-line functional/no-classes -- minimal injected DOM test double for spawn_card's imperative painter
class FakeElement {
  children: FakeElement[] = []
  style = { cssText: '', color: '' }
  dataset: Record<string, string> = {}
  className = ''
  own_text = ''

  get textContent() {
    return this.own_text + this.children.map((child) => child.textContent).join('')
  }

  set textContent(value: string) {
    this.own_text = value
    if (value === '') this.children = []
  }

  append(...children: FakeElement[]) {
    this.children.push(...children)
  }

  appendChild(child: FakeElement) {
    this.children.push(child)
    return child
  }
}

const has_archi_marker = (node: FakeElement): boolean =>
  node.dataset.mobTier === 'archi' || node.children.some(has_archi_marker)

test('the bestiary reads the captured /v1 mob projection shape as a populated corpus', () => {
  // Captured GET /v1/encyclopedia payload: the full fixture contains the same 374 mob rows observed by
  // the post-enable smoke. One real row is enough to pin the serializer's template_id/min_level/base_hp
  // vocabulary and the reader's non-empty decision.
  const [captured_mob] = encyclopedia_fixture.mobs as RpcEncyclopediaMob[]
  const mobs = bestiary_mobs_from_v1([captured_mob])

  expect(mobs).toHaveLength(1)
  expect(mobs[0]).toMatchObject({
    id: captured_mob.template_id,
    name: captured_mob.name,
    minLevel: captured_mob.min_level,
    maxLevel: captured_mob.max_level,
    health: captured_mob.base_hp,
    element: 'EARTH',
  })
})

test('decode_mob_resist turns the live boar wire ints into real signed deltas', () => {
  expect(decode_mob_resist(WIRE_BOAR.earth)).toBe(40)
  expect(decode_mob_resist(WIRE_BOAR.water)).toBe(0)
  expect(decode_mob_resist(WIRE_BOAR.air)).toBe(-20)
  expect(decode_mob_resist(WIRE_BOAR.fire)).toBe(0)
  // absent field (the §14 index doesn't project this today) stays an honest unknown, never a fabricated 0.
  expect(decode_mob_resist(null)).toBe(null)
  expect(decode_mob_resist(undefined)).toBe(null)
})

test('MobDetailView renders the DECODED resist signs, never the raw wire int', () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <MobDetailView
        mob={{
          name: 'Boar',
          icon_name: 'Boar',
          element: 'EARTH',
          minLevel: 1,
          maxLevel: 4,
          health: 40,
          xpReward: null,
          isBoss: false,
          stats: {},
          resistances: {
            earth: decode_mob_resist(WIRE_BOAR.earth) ?? 0,
            water: decode_mob_resist(WIRE_BOAR.water) ?? 0,
            air: decode_mob_resist(WIRE_BOAR.air) ?? 0,
            fire: decode_mob_resist(WIRE_BOAR.fire) ?? 0,
          },
          drops: [],
          found_in: [],
        }}
        show_stats={false}
      />
    </I18nextProvider>
  )
  expect(html).toContain('+40%') // earth resist, decoded
  expect(html).toContain('>-20%') // air weakness, decoded (the red #f87171 stat-card idiom)
  // The raw centered wire ints must never reach the DOM — this is the exact bug: a player seeing "32808"
  // (or a huge/overflowing bar) instead of "+40".
  expect(html).not.toContain('32808')
  expect(html).not.toContain('32748')
})

test('an archi-tier graded mob composes the world badge and encyclopedia marker', () => {
  const ruled_archi = Object.values(seed_manifest.mobs).find(({ role }) => role === 'archi')
  if (!ruled_archi) throw new Error('the ruled mob model must contain an archi-tier fixture')
  const [encyclopedia_archi] = bestiary_mobs_from_v1([
    {
      template_id: ruled_archi.id,
      name: ruled_archi.name ?? 'Archi fixture',
      min_level: 8,
      max_level: 20,
      base_hp: 90,
      element: 2,
      drops: [],
    },
  ])
  const graded_archi = {
    ...encyclopedia_archi,
    min_level: 8,
    max_level: 20,
  }
  const original_document = globalThis.document
  const nameplate = new FakeElement()
  try {
    globalThis.document = {
      createElement: () => new FakeElement(),
    } as unknown as Document
    render_group_card(nameplate as unknown as HTMLElement, {
      roster: [graded_archi],
      graded: true,
      progress: 500,
      size: 1,
      spawned_at_ms: Date.now(),
      group_seed: '7719283746501',
      archimob_bp: 0,
      team_bound: 6,
    })
  } finally {
    globalThis.document = original_document
  }
  const encyclopedia_row = renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <BestiaryMobRow mob={graded_archi} idx={0} is_selected={false} on_select={() => {}} />
    </I18nextProvider>
  )
  const encyclopedia_detail = renderToStaticMarkup(
    <I18nextProvider i18n={test_i18n}>
      <MobDetailView
        mob={{
          ...graded_archi,
          xpReward: null,
          isBoss: false,
          stats: {},
          drops: [],
          found_in: [],
        }}
        show_stats={false}
      />
    </I18nextProvider>
  )

  expect([
    has_archi_marker(nameplate),
    encyclopedia_row.includes('data-mob-tier="archi"'),
    encyclopedia_detail.includes('data-mob-tier="archi"'),
  ]).toEqual([true, true, true])
})
