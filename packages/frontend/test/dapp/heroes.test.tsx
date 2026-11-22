// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Heroes tab: what it shows and refuses for a given reducer state, then what one gesture of the
// game's own character and jobs tabs asks the bot, through the session the tab gives them.
import { expect, spyOn, test } from 'bun:test'
import { job_xp_for_level } from '@aresrpg/immutable'
import type { CharacterRow, EquippedItem, ItemRow } from '@aresrpg/protocol'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as zustand from 'zustand'

import type { CharacterSession } from '../../src/characters/character_session.ts'
import { useEquipment } from '../../src/characters/useEquipment.ts'
import { useSpells } from '../../src/characters/useSpells.ts'
import { ItemCrafting } from '../../src/components/ItemCrafting.tsx'
import { content_catalog } from '../../src/content/catalog.ts'
import { DappHeroes, DappHeroSheet, useHeroSession, type HeroTab } from '../../src/dapp/DappHeroes.tsx'
import type { DappAccount } from '../../src/dapp/account.ts'
import type { DirectRequest } from '../../src/dapp/direct.ts'
import { reduce_dapp, selected_hero, type DappInput, type DappState } from '../../src/dapp/state.ts'
import { copy_text, type AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'
import * as store from '../../src/store.ts'
import { toast } from '../../src/toast.ts'

import {
  HERO,
  account_fixture,
  character_fixture,
  hero_id,
  item_fixture,
  listing_fixture,
  observation_fixture,
} from './fixtures.ts'

const copy = en as AppCopy
const text = copy.dapp_page as Readonly<Record<string, string>>

const KIOSK = '0xkiosk'
const seed_hat = content_catalog.items.find(({ category }) => category === 'hat')!
const row = (id: string, name: string, overrides: Partial<ItemRow> = {}): ItemRow => ({
  id,
  version: '1',
  name,
  item_type: seed_hat.item_type,
  category: 'hat',
  level: 1,
  amount: 1,
  kiosk: KIOSK,
  ...overrides,
})
const worn = (item: ItemRow, slot: EquippedItem['slot']): EquippedItem => {
  const { kiosk: _kiosk, ...rest } = item
  return { ...rest, slot }
}
const FREE_HAT = row(hero_id('a'), 'Free Hat')
const LISTED_HAT = row(hero_id('b'), 'Listed Hat')
const WORN_HAT = row(hero_id('c'), 'Worn Hat')
const OTHER_KIOSK_HAT = row(hero_id('d'), 'Far Hat', { kiosk: '0xother' })

const SECOND = hero_id('2')
const mira = character_fixture({ level: 200, available_points: 12, available_spell_points: 9 })
const okami = character_fixture({ id: SECOND, name: 'Okami', classe: 'senshi', level: 7, experience: '90' })
const base = store.initial_app_state({} as store.AppState['settings'])
/** A page linked to its bot: what the bot said (`dapp`) and what the game server pushed (`account`). */
const linked = (dapp: Partial<DappState> = {}, account: DappAccount = account_fixture()): store.AppState => ({
  ...base,
  copy,
  session: { ...base.session, agent_inventory: account },
  dapp: { ...base.dapp, link: { phase: 'connected' }, ...dapp },
})
const answered = (dapp: Partial<DappState> = {}, account?: DappAccount): store.AppState =>
  linked({ observation: observation_fixture(), ...dapp }, account)
const heroes = (...characters: CharacterRow[]): DappAccount =>
  account_fixture({
    characters,
    items: [FREE_HAT, LISTED_HAT, OTHER_KIOSK_HAT],
    listings: [listing_fixture(seed_hat.item_type, '5', { id: LISTED_HAT.id, kiosk: KIOSK })],
  })

/** Static markup of a node over one given reducer state. */
const render = (node: ReactNode, state: store.AppState): string => {
  const read = ((_store: unknown, selector?: (state: store.AppState) => unknown) =>
    selector ? selector(state) : state) as typeof zustand.useStore
  const mocked = spyOn(zustand, 'useStore').mockImplementation(read)
  try {
    return renderToStaticMarkup(node)
  } finally {
    mocked.mockRestore()
  }
}
/** The game's tabs are lazy: the first render asks for them, the next one draws them. */
const drawn = async (node: ReactNode, state: store.AppState): Promise<string> => {
  render(node, state)
  await Promise.all([
    import('../../src/characters/EquipmentTab.tsx'),
    import('../../src/characters/StatsTab.tsx'),
    import('../../src/characters/SpellsTab.tsx'),
    import('../../src/characters/JobsTab.tsx'),
  ])
  await new Promise((resolve) => setTimeout(resolve, 0))
  return render(node, state)
}
/** The Heroes tab as it opens: the window shows the hero's equipment. */
const tab = (state: store.AppState): Promise<string> => drawn(<DappHeroes copy={copy} />, state)
const TABS: readonly HeroTab[] = ['equipment', 'stats', 'spells', 'jobs']
/** The chosen hero's card and window after the player pressed one tab of the window. */
const sheet = (state: store.AppState, shown: HeroTab, on_tab: (next: HeroTab) => void = () => undefined) => {
  const hero = selected_hero(state.dapp, state.session.agent_inventory)!
  return drawn(<DappHeroSheet copy={copy} hero={hero} tab={shown} on_tab={on_tab} />, state)
}
const words = (html: string): string => html.replace(/<[^>]*>/g, ' ')
const escaped = (value: string): string => value.replaceAll("'", '&#x27;')
const windows = (html: string): readonly string[] =>
  [...html.matchAll(/data-character-panel="(\w+)"/g)].map(([, name]) => name!)
const between = (html: string, from: string, to: string): string => html.slice(html.indexOf(from), html.indexOf(to))
const count = (html: string, part: string): number => html.split(part).length - 1
/** The buttons of the window's tab bar, in order: its label and whether it is the tab on screen. */
const tab_bar = (html: string): readonly (readonly [string, string])[] =>
  [...between(html, 'class="aui-segments"', 'game-character-body').matchAll(/aria-pressed="(\w+)"[^>]*>([^<]*)</g)].map(
    ([, pressed, label]) => [label!, pressed!] as const
  )
const open_request = (status: DirectRequest['status']): DirectRequest => ({
  id: 'r1',
  action: 'raise_stats',
  hero_id: HERO,
  payload: {},
  item_type: null,
  amount: 0,
  after: null,
  proof: null,
  status,
  error: null,
})

const KIOSK_ROW = { kiosk: KIOSK }
const WHEAT = { ...item_fixture('wheat', 4), ...KIOSK_ROW }
const WATER = { ...item_fixture('water', 2), ...KIOSK_ROW }
const BARLEY = { ...item_fixture('wheat_barley', 2), ...KIOSK_ROW }
/** A hero that farms: wheat flour (wheat ×2, water ×1) is open to it, barley flour asks for level 10. */
const farmer = { ...mira, jobs: { FARMER: String(job_xp_for_level(3)) } }
const master = { ...okami, jobs: { FARMER: String(job_xp_for_level(12)) } }
const pantry = (...characters: CharacterRow[]): DappAccount => account_fixture({ characters, items: [WHEAT, WATER] })
const jobs_text = copy_text(copy.characters_page)
/**
 * The game's own recipe controls for one hero, exactly as the jobs tab mounts them: the hero, the bag
 * and the craft of the session the Heroes tab builds.
 */
const recipe = (state: store.AppState, hero: CharacterRow, item_type = 'wheat_flour'): string => {
  const Recipe = () => {
    const { session } = useHeroSession(copy, hero)
    const craft_session = { character: hero, inventory: session.inventory, craft: session.craft }
    return <ItemCrafting item_type={item_type} session={craft_session} open_ingredient={() => undefined} />
  }
  return render(<Recipe />, state)
}
const craft_button = (html: string): string | undefined =>
  html.match(/<button[^>]*class="[^"]*jobs__craft-btn[^"]*"[^>]*>/)?.[0]

type Probed = Readonly<{
  editable: boolean
  session: CharacterSession
  equipment: ReturnType<typeof useEquipment>
  spells: ReturnType<typeof useSpells>
}>
/**
 * The game's own hooks over the session the tab builds, for one state. `act` runs with every input
 * the page dispatches and every toast it shows recorded instead of applied.
 */
const probe = (state: store.AppState, hero: CharacterRow, act: (probed: Probed) => void) => {
  const inputs: DappInput[] = []
  const toasts: string[] = []
  const probed: Probed[] = []
  const Probe = () => {
    const { session, editable } = useHeroSession(copy, hero)
    const equipment = useEquipment({ character: hero, copy, session })
    const spells = useSpells({ character: hero, copy, session })
    probed.push({ editable, session, equipment, spells })
    return null
  }
  render(<Probe />, state)
  const dispatched = spyOn(store, 'dispatch_app').mockImplementation((input) => void inputs.push(input as DappInput))
  const stop = toast.subscribe((event) => void toasts.push(JSON.stringify(event)))
  try {
    act(probed[0]!)
  } finally {
    stop()
    dispatched.mockRestore()
  }
  return { inputs, toasts, bag: probed[0]!.equipment.bag.map(({ id }) => id) }
}
const direct_inputs = (inputs: readonly DappInput[]) =>
  inputs.flatMap((input) => (input.type === 'dapp/hero_direct' ? [input] : []))

test('an account without a hero shows the way to the first one and no character window', async () => {
  const html = await tab(answered({}, account_fixture({ characters: [] })))
  expect(html).toContain('data-heroes-empty')
  expect(words(html)).toContain(text.heroes_empty_title)
  expect(words(html)).toContain(text.heroes_empty_body)
  expect(html).toContain(text.heroes_empty_action)
  expect(windows(html)).toEqual([])
  expect(html).not.toContain('dapp-hero-picker')
})

test('nothing can change before the bot answered, in a fight, in a dungeon, or while a request is open', async () => {
  const fighting = { ...mira, active_fight: { id: 'fight', seat: 0 } as CharacterRow['active_fight'] }
  const raiding = { ...mira, dungeon_run: { dungeon: 'd' } as CharacterRow['dungeon_run'] }
  const locked = [
    linked({}, heroes(mira)),
    answered({}, heroes(fighting)),
    answered({}, heroes(raiding)),
    answered({ direct: open_request('pending') }, heroes(mira)),
    answered({ direct: open_request('accepted') }, heroes(mira)),
    answered({ direct: open_request('uncertain') }, heroes(mira)),
  ]
  for (const state of locked) {
    const html = await tab(state)
    expect(html).toContain('data-heroes-locked')
    // The sentence shows once, above the window's tabs.
    expect(count(words(html), text.detail_locked!)).toBe(1)
    expect(html.indexOf('data-heroes-locked')).toBeLessThan(html.indexOf('class="aui-segments"'))
    // Every tab stays on screen to read; the characteristics offer no step and no Confirm.
    expect(tab_bar(html).map(([label]) => label)).toHaveLength(4)
    const stats = await sheet(state, 'stats')
    expect(windows(stats)).toEqual(['stats'])
    expect(stats.match(/<button[^>]*>\+<\/button>/g)?.every((button) => button.includes('disabled'))).toBe(true)

    const hero = state.session.agent_inventory.characters[0]!
    const { inputs, toasts } = probe(state, hero, ({ editable, session, equipment, spells }) => {
      expect(editable).toBe(false)
      expect(spells.can_raise).toBe(false)
      spells.raise()
      equipment.activate(FREE_HAT)
      // A craft is closed with the same sentence the tab shows.
      expect(session.craft?.locked).toBe(text.detail_locked!)
    })
    // The gesture sends nothing, and says why at most once.
    expect(inputs).toEqual([])
    expect(toasts.length).toBe(1)
    // A recipe the bag pays offers no open Craft either: the control is locked with the reason.
    const closed = recipe(state, hero)
    expect(craft_button(closed)).toContain('disabled=""')
    expect(closed).toContain(`<p class="jobs__craft-locked" role="status">${text.detail_locked}</p>`)
  }
})

test('a recipe the hero cannot pay, or whose profession level is too low, offers no open Craft', () => {
  // No water: the bag holds the wheat only.
  const dry = answered({}, account_fixture({ characters: [farmer], items: [WHEAT] }))
  expect(craft_button(recipe(dry, farmer))).toContain('disabled=""')
  expect(craft_button(recipe(dry, farmer))).toContain(`title="${jobs_text('jobs.craft.not_enough')}"`)
  expect(recipe(dry, farmer)).not.toContain('jobs__craft-locked')
  // The water is listed for sale: it is not in the hero's bag any more.
  const listed = account_fixture({
    characters: [farmer],
    items: [WHEAT, WATER],
    listings: [listing_fixture('water', '5', { id: WATER.id, kiosk: KIOSK })],
  })
  expect(craft_button(recipe(answered({}, listed), farmer))).toContain('disabled=""')
  // Ingredients in another kiosk are another hero's.
  const far = account_fixture({ characters: [farmer], items: [WHEAT, { ...WATER, kiosk: '0xother' }] })
  expect(craft_button(recipe(answered({}, far), farmer))).toContain('disabled=""')
  // Until the bag is fully read nothing is known to be held.
  const reading = { ...pantry(farmer), phase: 'loading' as const }
  expect(craft_button(recipe(answered({}, reading), farmer))).toContain('disabled=""')
  // Barley flour asks for a level this farmer has not reached: the game says which, and nothing opens.
  const stocked = answered({}, account_fixture({ characters: [farmer], items: [WHEAT, WATER, BARLEY] }))
  const high = recipe(stocked, farmer, 'barley_flour')
  expect(craft_button(high)).toContain('disabled=""')
  expect(words(high)).toContain(jobs_text('jobs.craft.locked_level', { level: 10 }))
  expect(words(high)).not.toContain(jobs_text('jobs.craft.craft_button', { count: 1 }))
})

test('the game refuses a gesture on a held hero in its own words before this page is asked', () => {
  const away = { ...mira, custody: 'fight' as CharacterRow['custody'] }
  const { inputs, toasts } = probe(answered({}, heroes(away)), away, ({ equipment }) => equipment.activate(FREE_HAT))
  expect(inputs).toEqual([])
  expect(toasts).toHaveLength(1)
  expect(toasts[0]).toContain(copy_text(copy.characters_page)('refusal_unavailable'))
})

test('a listed item and an item of another kiosk are not in the hero’s bag: they cannot be worn', async () => {
  const state = answered({}, heroes(mira))
  const html = await tab(state)
  const gear = html.slice(html.indexOf('data-character-panel="equipment"'))
  expect(gear).toContain('Free Hat')
  expect(gear).not.toContain('Listed Hat')
  expect(gear).not.toContain('Far Hat')
  // The bag is the bot's own: the game's panel that moves items between a player and their bot is not drawn.
  expect(gear).not.toContain('agent-kiosk')
  expect(gear).not.toContain(copy.ui.agent_kiosk)
  const { bag, inputs } = probe(state, mira, ({ equipment }) => {
    equipment.activate(LISTED_HAT)
    equipment.equip(LISTED_HAT, 'hat')
  })
  expect(bag).toEqual([FREE_HAT.id])
  expect(inputs).toEqual([])
  // Until the bag is fully read no item is known to be free: nothing is offered.
  const reading = answered({}, { ...heroes(mira), phase: 'loading' })
  expect(probe(reading, mira, () => undefined).bag).toEqual([])
})

test('the tab shows the chosen hero, one game window with four tabs and a 2D portrait, never a canvas', async () => {
  const state = answered({ hero_id: SECOND }, heroes(mira, okami))
  const html = await tab(state)
  expect(words(html)).toContain(text.heroes_title)
  expect(words(html)).toContain(text.heroes_intro)
  expect(html).not.toContain('data-heroes-locked')
  // The picker is the shared one: the chosen hero is pressed, the other is not.
  const picker = between(html, 'dapp-hero-picker', 'dapp-hero-card')
  expect(picker).toMatch(new RegExp(`aria-pressed="true"[^>]*data-hero="${SECOND}"`))
  expect(picker).toMatch(new RegExp(`aria-pressed="false"[^>]*data-hero="${HERO}"`))
  expect(html).toMatch(/<section aria-label="Okami"[^>]*class="aui-panel dapp-hero-card"/)
  // One window: it opens on the equipment, and its tab bar names the game's four tabs in the game's words.
  expect(windows(html)).toEqual(['equipment'])
  expect(count(html, 'dapp-heroes-window')).toBe(1)
  expect(tab_bar(html)).toEqual([
    [jobs_text('tab_equipment'), 'true'],
    [jobs_text('tab_stats'), 'false'],
    [jobs_text('tab_spells'), 'false'],
    [jobs_text('tab_jobs'), 'false'],
  ])
  // A pressed tab is the only one drawn, in the game's own window frame of that tab, under its own title.
  for (const shown of TABS) {
    const pressed = await sheet(state, shown)
    expect(windows(pressed)).toEqual([shown])
    expect(pressed).toMatch(
      new RegExp(`class="aui-window gw-tab game-character-window game-character-window--${shown} `)
    )
    expect(tab_bar(pressed).filter(([, on]) => on === 'true')).toEqual([[jobs_text(`tab_${shown}`), 'true']])
    expect(pressed).toContain(`<h1>${jobs_text(`tab_${shown}`)}</h1>`)
  }
  // The doll holds the hero's picture where the game draws its 3D model.
  expect(html).toMatch(/class="inv__portrait"><img class="dapp-portrait"/)
  expect(html).not.toContain('<canvas')
  expect(html).not.toContain('data-character-preview')
})

test('with no choice the strongest hero is shown, and its characteristics can be raised', async () => {
  const state = answered({}, heroes(okami, mira))
  const html = await tab(state)
  expect(html).toMatch(/<section aria-label="Mira"[^>]*class="aui-panel dapp-hero-card"/)
  const stats = await sheet(state, 'stats')
  expect(stats.match(/<button[^>]*>\+<\/button>/g)?.some((button) => !button.includes('disabled'))).toBe(true)
  expect(escaped(words(html))).not.toContain(escaped(text.detail_locked!))
})

test('the hero’s card counts its unspent points, and each count opens the tab that spends it', async () => {
  // Mira holds 12 characteristic points and 9 spell points; Okami holds none.
  const state = answered({}, heroes(mira, okami))
  const html = await tab(state)
  const card = between(html, 'dapp-hero-card', 'class="aui-window')
  expect(words(card)).toContain(`${copy.fight_hud.level_up_stat_points} 12`)
  expect(words(card)).toContain(`${copy.fight_hud.level_up_spell_points} 9`)
  expect([...card.matchAll(/data-heroes-points="(\w+)"/g)].map(([, name]) => name)).toEqual(['stats', 'spells'])
  const spent = await tab({ ...state, dapp: { ...state.dapp, hero_id: SECOND } })
  expect(spent).not.toContain('data-heroes-points')
  // Pressing a count asks for its tab, exactly as pressing the tab does.
  const asked: HeroTab[] = []
  /** Every press of a count found in an element tree, the card's `actions` slot included. */
  const presses = (node: unknown): readonly (() => void)[] => {
    if (Array.isArray(node)) return node.flatMap(presses)
    const props = (node as { props?: Record<string, unknown> } | null)?.props
    if (!props) return []
    const own = props['data-heroes-points'] ? [props.onClick as () => void] : []
    return [...own, ...presses(props.children), ...presses(props.actions)]
  }
  const Probe = () => {
    presses(DappHeroSheet({ copy, hero: mira, tab: 'equipment', on_tab: (next) => void asked.push(next) })).forEach(
      (press) => press()
    )
    return null
  }
  render(<Probe />, state)
  expect(asked).toEqual(['stats', 'spells'])
})

test('wearing, swapping and emptying a slot are one equip_item each, with the bot’s exact payload', () => {
  const state = answered({}, heroes(mira))
  const wear = probe(state, mira, ({ equipment }) => equipment.activate(FREE_HAT))
  expect(wear.toasts).toEqual([])
  expect(direct_inputs(wear.inputs)).toHaveLength(1)
  expect(wear.inputs[0]).toMatchObject({
    type: 'dapp/hero_direct',
    hero_id: HERO,
    action: 'equip_item',
    payload: { character_id: HERO, slot: 'hat', item_id: FREE_HAT.id },
  })
  // The reducer takes it as the one direct request, named after the item, and locks the hero meanwhile.
  const asked = reduce_dapp(state.dapp, wear.inputs[0]!, state.session.agent_inventory)
  expect(asked.direct).toMatchObject({ action: 'equip_item', item_type: seed_hat.item_type, status: 'pending' })
  expect(probe({ ...state, dapp: asked }, mira, ({ editable }) => expect(editable).toBe(false)).inputs).toEqual([])

  const hatted = { ...mira, equipment: [worn(WORN_HAT, 'hat')] }
  const dressed = answered({}, heroes(hatted))
  const swap = probe(dressed, hatted, ({ equipment }) => equipment.activate(FREE_HAT))
  expect(direct_inputs(swap.inputs).map(({ payload }) => payload)).toEqual([
    { character_id: HERO, slot: 'hat', item_id: FREE_HAT.id },
  ])
  const empty = probe(dressed, hatted, ({ equipment }) => equipment.unequip('hat'))
  expect(direct_inputs(empty.inputs).map(({ action, payload }) => ({ action, payload }))).toEqual([
    { action: 'equip_item', payload: { character_id: HERO, slot: 'hat' } },
  ])
})

test('a spell rank is one raise_spell with the bot’s exact payload', () => {
  const state = answered({}, heroes(mira))
  const { inputs } = probe(state, mira, ({ spells }) => {
    expect(spells.can_raise).toBe(true)
    spells.raise()
    const asked = spells.selected!.name
    expect(typeof asked).toBe('string')
  })
  const [raise] = direct_inputs(inputs)
  expect(direct_inputs(inputs)).toHaveLength(1)
  expect(raise).toMatchObject({ hero_id: HERO, action: 'raise_spell' })
  expect(Object.keys(raise!.payload)).toEqual(['character_id', 'spell'])
  expect(raise!.payload.character_id).toBe(HERO)
  expect(content_catalog.classes.flatMap(({ spells }) => spells.map(({ name }) => name))).toContain(
    raise!.payload.spell as string
  )
})

test('the Jobs window is the game’s own: professions, recipes, its advice among the bot’s heroes', async () => {
  // The player's own characters are another account: a master crafter there is never advised here.
  const stranger = { ...master, id: hero_id('9'), name: 'Stranger' }
  const state = answered({}, pantry(farmer, master))
  const html = await sheet({ ...state, session: { ...state.session, characters: [farmer, stranger] } }, 'jobs')
  const jobs = html.slice(html.indexOf('data-character-panel="jobs"'))
  // The game's window frame and layout, with the game's own title.
  expect(html).toMatch(/class="[^"]*game-character-window--jobs aui-feature-port aui-jobs-port dapp-heroes-window/)
  expect(words(jobs)).toContain(jobs_text('tab_jobs'))
  expect(jobs).toContain('data-tutorial-target="character_jobs"')
  // Its recipes, with the one the game advises to level on.
  expect(words(jobs)).toContain('Wheat Flour')
  expect(words(jobs)).toContain(jobs_text('jobs.recipes.best_progress'))
  expect(words(jobs)).toContain(jobs_text('jobs.recipes.unlocked'))
  // The hero in view is the farmer: the game advises the master of the same bot account, by name.
  expect(html.includes('<section aria-label="Mira"')).toBe(true)
  expect(jobs).toContain(jobs_text('jobs.lv_badge', { level: 3 }))
  expect(jobs).toContain(`data-better-job-character="${SECOND}"`)
  expect(words(jobs)).toContain(jobs_text('jobs.better_character', { name: 'Okami', job: 'Farmer', level: 12 }))
  expect(jobs).not.toContain('Stranger')
  // Looking at the master, its own level shows and nobody is advised above it.
  const other = await sheet({ ...state, dapp: { ...state.dapp, hero_id: SECOND } }, 'jobs')
  expect(other.includes('<section aria-label="Okami"')).toBe(true)
  expect(other).toContain(jobs_text('jobs.lv_badge', { level: 12 }))
  expect(other).not.toContain('data-better-job-character')
})

test('a craft is one request with the bot’s exact payload, and the control is locked while it is open', () => {
  const state = answered({}, pantry(farmer, master))
  // The bag pays the recipe and the level is reached: the game's Craft is open, with no lock sentence.
  const open = recipe(state, farmer)
  expect(craft_button(open)).not.toContain('disabled=""')
  expect(words(open)).toContain(jobs_text('jobs.craft.craft_button', { count: 1 }))
  expect(open).toContain('jobs__ingredient-amt hud-num is-enough')
  expect(open).not.toContain('jobs__craft-locked')
  const craft = probe(state, farmer, ({ session }) => {
    expect(session.craft?.locked).toBeNull()
    session.craft?.run('wheat_flour', 2)
  })
  expect(craft.toasts).toEqual([])
  expect(craft.inputs).toHaveLength(1)
  expect(craft.inputs[0]).toMatchObject({
    type: 'dapp/hero_direct',
    hero_id: HERO,
    action: 'craft',
    payload: { character_id: HERO, output_type: 'wheat_flour', attempts: 2 },
  })
  expect(Object.keys(direct_inputs(craft.inputs)[0]!.payload)).toEqual(['character_id', 'output_type', 'attempts'])
  // The reducer takes it as the one direct request, named after the recipe and the tries.
  const asked = reduce_dapp(state.dapp, craft.inputs[0]!, state.session.agent_inventory)
  expect(asked.direct).toMatchObject({ action: 'craft', item_type: 'wheat_flour', amount: 2, status: 'pending' })
  // While it is open the Craft is closed with the reason, and a second gesture sends nothing.
  const waiting = { ...state, dapp: asked }
  expect(craft_button(recipe(waiting, farmer))).toContain('disabled=""')
  expect(recipe(waiting, farmer)).toContain(text.detail_locked!)
  const again = probe(waiting, farmer, ({ session }) => session.craft?.run('wheat_flour', 2))
  expect(again.inputs).toEqual([])
  expect(again.toasts).toHaveLength(1)
  // The better crafter of the account is one look away: the pick changes, nothing is asked of the bot.
  const look = probe(state, farmer, ({ session }) => session.roster?.select(SECOND))
  expect(look.inputs).toEqual([{ type: 'dapp/select_hero', hero_id: SECOND }])
})
