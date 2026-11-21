// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import * as zustand from 'zustand'
import { craft_required_level, item_is_stackable } from '@aresrpg/immutable'

import { CraftControls } from '../../src/characters/CraftControls.tsx'
import { encyclopedia_catalog } from '../../src/content/catalog.ts'
import { sample_character_row, sample_character } from '../../src/demo/sample.ts'
import { copy_text, type AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'
import { read_app_state, type AppState } from '../../src/store.ts'

test.each([false, true])('craft attempt controls are visible only for stackable output: %j', (stackable) => {
  const recipe = encyclopedia_catalog.recipes.find(
    ({ output_type }) => item_is_stackable(encyclopedia_catalog.item(output_type)!.item.category) === stackable
  )!
  const state = { ...read_app_state(), copy: en } as AppState
  const reader = spyOn(zustand, 'useStore').mockImplementation(((
    _store: unknown,
    selector: (state: AppState) => unknown
  ) => selector(state)) as typeof zustand.useStore)
  try {
    const html = renderToStaticMarkup(
      <CraftControls
        recipe={recipe}
        job="FARMER"
        level={100}
        t={copy_text((en as AppCopy).characters_page)}
        open_ingredient={() => undefined}
      />
    )
    const [controls = ''] = html.match(/<fieldset[^>]*>/)!
    expect(controls.includes('hidden=""')).toBe(!stackable)
    expect(html).toContain('jobs__craft-btn')
  } finally {
    reader.mockRestore()
  }
})

const recipe = encyclopedia_catalog.recipes[0]!
const required = craft_required_level(Object.keys(recipe.inputs).length)
const character = sample_character_row(sample_character())
/** A bag of the recipe's ingredients, each held `tries` times over, in the crafter's own kiosk. */
const bag = (tries: number) =>
  Object.entries(recipe.inputs).map(([item_type, amount]) => ({
    id: item_type,
    version: '1',
    item_type,
    amount: amount * tries,
    category: 'resource',
    name: item_type,
    level: 1,
    kiosk: character.kiosk,
  }))
type Controls = Partial<Parameters<typeof CraftControls>[0]>
/** The markup of the controls over a store whose live bag pays the recipe once and whose wallet is connected. */
const controls = (props: Controls): string => {
  const current = read_app_state()
  // This SSR probe reads wallet presence only; it never invokes wallet methods.
  const session = { ...current.session, inventory: bag(1), wallet: {} }
  const state = { ...current, copy: en, session } as unknown as AppState
  const reader = spyOn(zustand, 'useStore').mockImplementation(((
    _store: unknown,
    selector: (state: AppState) => unknown
  ) => selector(state)) as typeof zustand.useStore)
  try {
    return renderToStaticMarkup(
      <CraftControls
        recipe={recipe}
        character={character}
        job="FARMER"
        level={100}
        t={copy_text((en as AppCopy).characters_page)}
        open_ingredient={() => undefined}
        {...props}
      />
    )
  } finally {
    reader.mockRestore()
  }
}
const craft_button = (html: string): string | undefined =>
  html.match(/<button[^>]*class="[^"]*jobs__craft-btn[^"]*"[^>]*>/)?.[0]
const words = (html: string): string => html.replace(/<[^>]*>/g, ' ')
const t = copy_text((en as AppCopy).characters_page)
const never = () => {
  throw new Error('a render never crafts')
}

test('a bag of its own with no way to craft is only read: no craft control is drawn, even with a connected wallet', () => {
  // The player's own wallet over the live bag keeps the game's control, open.
  expect(craft_button(controls({}))).not.toContain('disabled=""')
  const read_only = controls({ inventory_override: bag(1) })
  expect(craft_button(read_only)).toBeUndefined()
  expect(read_only).not.toContain('jobs__craft-bar')
  expect(read_only).not.toContain('jobs__craft-amount')
  // What it holds is still read against the recipe.
  expect(read_only).toContain('jobs__ingredient-amt hud-num is-enough')
  expect(words(read_only)).toContain(t('jobs.craft.starting_chance'))
})

test('a session that crafts is closed by the game’s own checks: a missing ingredient or a profession level too low', () => {
  const open = { run: never, locked: null }
  const short = controls({ inventory_override: [], craft: open })
  expect(craft_button(short)).toContain('disabled=""')
  expect(craft_button(short)).toContain(`title="${t('jobs.craft.not_enough')}"`)
  expect(short).toContain('jobs__ingredient-amt hud-num is-short')
  // Ingredients held in another kiosk are not this crafter's.
  const elsewhere = bag(1).map((row) => ({ ...row, kiosk: '0xother' }))
  expect(craft_button(controls({ inventory_override: elsewhere, craft: open }))).toContain('disabled=""')
  const low = controls({ inventory_override: bag(1), craft: open, level: required - 1 })
  expect(craft_button(low)).toContain('disabled=""')
  expect(words(low)).toContain(t('jobs.craft.locked_level', { level: required }))
  expect(words(low)).not.toContain(t('jobs.craft.craft_button', { count: 1 }))
})

test('a session that crafts gets the game’s control: open over its own bag, locked with its own sentence', () => {
  const ready = controls({ inventory_override: bag(1), craft: { run: never, locked: null } })
  expect(craft_button(ready)).not.toContain('disabled=""')
  expect(words(ready)).toContain(t('jobs.craft.craft_button', { count: 1 }))
  expect(ready).not.toContain('jobs__craft-locked')
  // The wallet of the player plays no part: with none connected the session still crafts.
  const why = 'Your bot has another request open.'
  const locked = controls({ inventory_override: bag(1), craft: { run: never, locked: why } })
  expect(craft_button(locked)).toContain('disabled=""')
  expect(craft_button(locked)).toContain(`title="${why}"`)
  expect(locked).toContain(`<p class="jobs__craft-locked" role="status">${why}</p>`)
})
