// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What every Start shares on the Quest and Raid tabs: the fee limit, the walking time and the potion.
// An entry that cannot be read comes first: it never becomes "no limit".
import { expect, spyOn, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as zustand from 'zustand'

import {
  DappFeeCap,
  DappPotionButton,
  fee_entry,
  fee_text,
  fee_valid,
  potion_input,
  walk_time,
} from '../../src/dapp/DappStartParts.tsx'
import { reduce_dapp, type DappState } from '../../src/dapp/state.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'
import { initial_app_state, type AppState } from '../../src/store.ts'

import { account_fixture, character_fixture, item_fixture, observation_fixture } from './fixtures.ts'

const copy = en as AppCopy
const text = copy.dapp_page as Readonly<Record<string, string>>
const mira = character_fixture()
const base = initial_app_state({} as AppState['settings'])
const page = (dapp: Partial<DappState> = {}): AppState => ({
  ...base,
  copy,
  session: { ...base.session, agent_inventory: account_fixture({ items: [item_fixture('thebes_potion', 2, 'p1')] }) },
  dapp: { ...base.dapp, link: { phase: 'connected' }, observation: observation_fixture(), ...dapp },
})
/** Static markup of a part over one given reducer state. */
const render = (node: ReactNode, state: AppState): string => {
  const read = ((_store: unknown, selector?: (state: AppState) => unknown) =>
    selector ? selector(state) : state) as typeof zustand.useStore
  const store = spyOn(zustand, 'useStore').mockImplementation(read)
  try {
    return renderToStaticMarkup(node)
  } finally {
    store.mockRestore()
  }
}
const words = (html: string): string => html.replace(/<[^>]*>/g, ' ')

test('a fee limit that is not an amount above zero is no answer, and never "no limit"', () => {
  for (const typed of ['abc', '0', '-1', '1,5', '1e3', '0.0000000001', '0.2x'])
    expect([typed, fee_entry(typed)]).toEqual([typed, { valid: false }])
  // Nothing typed is no limit; an amount is that many MIST, exactly.
  expect([' ', ''].map(fee_entry)).toEqual([
    { valid: true, cap: null },
    { valid: true, cap: null },
  ])
  expect(fee_entry('0.05')).toEqual({ valid: true, cap: '50000000' })
  expect(fee_entry('0.5')).toEqual({ valid: true, cap: '500000000' })
  expect([null, '50000000', '500000000', '12000000000'].map(fee_text)).toEqual(['', '0.05', '0.5', '12'])
  // What is on screen decides whether a Start is offered: the entry, or the stored limit before any.
  expect(fee_valid('abc', '50000000')).toBe(false)
  expect(fee_valid(null, '50000000')).toBe(true)
  expect(fee_valid('', null)).toBe(true)
})

test('the fee field shows the stored limit, says what it means, and reports only a limit it can read', () => {
  const field = (typed: string | null, cap: string | null = '50000000') =>
    render(<DappFeeCap copy={copy} cap={cap} typed={typed} type={() => undefined} pick={() => undefined} />, page())
  const wrong = field('0.2x')
  expect(wrong).toContain('data-fee-cap="invalid"')
  expect(wrong).toContain('aria-invalid="true"')
  expect(wrong).toContain(`role="alert">${text.fee_cap_invalid}`)
  expect(words(wrong)).not.toContain('in network fees')
  const stored = field(null)
  expect(stored).toContain('data-fee-cap="valid"')
  expect(stored).toContain('value="0.05"')
  expect(words(stored)).toContain('has paid 0.05 SUI in network fees')
  const none = field(null, null)
  expect(none).toContain(`placeholder="${text.fee_cap_none}"`)
  expect(words(none)).not.toContain('in network fees')
  // A limit the reducer would refuse never reaches it: only a readable one is picked.
  const refused = reduce_dapp(
    page().dapp,
    { type: 'dapp/quest_pick', pick: { fee_cap_mist: '0.05' } },
    account_fixture()
  )
  expect(refused.quest.fee_cap_mist).toBeNull()
})

test('a walking time is a floor: it rounds down, in the locale of the page', () => {
  expect(walk_time('en', 59)).toBe('59 seconds')
  expect(walk_time('en', 60)).toBe('1 minute')
  expect(walk_time('en', 179)).toBe('2 minutes')
  expect(walk_time('fr', 120)).toBe('2 minutes')
})

test('one potion is one direct request of one hero, and it waits while another request is open', () => {
  const potion = { id: 'p1' }
  const input = potion_input('r1', mira, potion)
  expect(input).toEqual({
    type: 'dapp/hero_direct',
    id: 'r1',
    hero_id: mira.id,
    action: 'use_consumable',
    payload: { character_id: mira.id, item_id: 'p1', amount: 1 },
  })
  const button = <DappPotionButton copy={copy} hero={mira} potion={potion} />
  const free = render(button, page())
  expect(words(free)).toContain(text.travel_potion_use)
  expect(free).not.toContain('disabled')
  // Before the bot answered, and while a request is open, there is nothing to press.
  expect(render(button, page({ observation: null }))).toContain('disabled=""')
  const state = page()
  const asked = reduce_dapp(state.dapp, input, state.session.agent_inventory)
  expect(asked.direct).toMatchObject({ action: 'use_consumable', status: 'pending', hero_id: mira.id })
  expect(render(button, { ...state, dapp: asked })).toContain('disabled=""')
})
