// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Home tab: what it says and offers for a given reducer state, and what each of its buttons asks.
import { expect, spyOn, test } from 'bun:test'
import { class_names } from '@aresrpg/immutable'
import { CHARACTER_PRICE_MIST } from '@aresrpg/sdk/character-price'
import { GAS_BUDGET_MIST } from '@aresrpg/sdk/gas-budget'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as zustand from 'zustand'

import { content_catalog } from '../../src/content/catalog.ts'
import { DappCreateHero, DappCreateSheet, create_blocker } from '../../src/dapp/DappCreateHero.tsx'
import { DappDisconnect, DappHome, quest_inputs, seat_inputs, team_inputs } from '../../src/dapp/DappHome.tsx'
import type { DappAccount } from '../../src/dapp/account.ts'
import { item_name } from '../../src/dapp/copy.ts'
import type { DirectRequest } from '../../src/dapp/direct.ts'
import { proposed_team } from '../../src/dapp/next_step.ts'
import { open_position, sync_positions, type DappPosition } from '../../src/dapp/positions.ts'
import { reduce_dapp, type DappCommand, type DappInput, type DappState } from '../../src/dapp/state.ts'
import { RAID_TEAM, type StartSpec } from '../../src/dapp/strategies.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'
import { initial_app_state, type AppState } from '../../src/store.ts'

import {
  HERO,
  account_fixture,
  character_fixture,
  hero_id,
  item_fixture,
  observation_fixture,
  run_fixture,
} from './fixtures.ts'

const copy = en as AppCopy
const text = copy.dapp_page as Readonly<Record<string, string>>

const SECOND = hero_id('2')
const [lorito] = content_catalog.dungeons
const mira = character_fixture()
const okami = character_fixture({ id: SECOND, name: 'Okami', classe: 'senshi', level: 7 })
const KEYS = [item_fixture(lorito!.key, 3)]
const base = initial_app_state({} as AppState['settings'])
/** A page linked to its bot: what the bot said (`dapp`) and what the game server pushed (`account`). */
const linked = (dapp: Partial<DappState> = {}, account: DappAccount = account_fixture({ characters: [mira] })) => ({
  ...base,
  copy,
  session: { ...base.session, agent_inventory: account },
  dapp: { ...base.dapp, link: { phase: 'connected' as const }, ...dapp },
})
const answered = (dapp: Partial<DappState> = {}, account?: DappAccount): AppState =>
  linked({ observation: observation_fixture(), ...dapp }, account)
/** Static markup of a view over one given reducer state. */
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
const home = (state: AppState): string => render(<DappHome copy={copy} locale="en" />, state)
/** What a player reads: the markup without its tags and attributes. */
const words = (html: string): string => html.replace(/<[^>]*>/g, ' ')
const escaped = (value: string): string => value.replaceAll("'", '&#x27;')
const buttons = (html: string): readonly string[] => html.match(/<button[^>]*>.*?<\/button>/gs) ?? []
const button = (html: string, label: string): string | undefined =>
  buttons(html).find((markup) => words(markup).includes(label))
/** The markup of one block, from its opening attribute to the end of its element. */
const block = (html: string, attribute: string, tag: string): string => {
  const from = html.indexOf(attribute)
  return from < 0 ? '' : html.slice(html.lastIndexOf('<', from), html.indexOf(`</${tag}>`, from))
}
const next_panel = (html: string): string => block(html, 'data-next=', 'section')
const hero_card = (html: string, id: string): string => block(html, `data-hero="${id}"`, 'section')
/** A key of this page's copy printed as itself means the key has no sentence. */
const RAW_KEY = /\b(next|hero|step|add_hero|create|welcome|fees|status|position|blocker)_[a-z_]+/

const SPEC: StartSpec = { activity: 'train', hero_ids: [HERO], place: null, difficulty: null, fee_cap_mist: null }
const running = (overrides: Partial<DappPosition> = {}): DappPosition => ({
  ...open_position(HERO, 1_000, [mira], { activity: 'train', sent: SPEC }),
  ...overrides,
})
const request = (overrides: Partial<DirectRequest>): DirectRequest => ({
  id: 'd1',
  action: 'create_character',
  hero_id: null,
  payload: { name: 'Hana' },
  item_type: null,
  amount: 0,
  after: null,
  proof: { kind: 'hero', name: 'hana' },
  status: 'pending',
  error: null,
  ...overrides,
})
const NEEDED = CHARACTER_PRICE_MIST + GAS_BUDGET_MIST
const holding = (balance_mist: bigint | null, characters = [mira]): DappAccount =>
  account_fixture({ characters, balance_mist })

test('a hero is created only when the bot can take the request and pay for it', () => {
  const { dapp } = answered()
  // One MIST short of the price and the fee: the bot would refuse, so the page does not ask.
  expect(create_blocker(dapp, holding(NEEDED - 1n))).toBe('funds')
  expect(create_blocker(dapp, holding(NEEDED))).toBeNull()
  // A balance not read yet blocks nothing: the bot is the one that refuses.
  expect(create_blocker(dapp, holding(null))).toBeNull()
  // Before the bot answered, and while it holds another request, nothing can be asked.
  expect(create_blocker(linked().dapp, holding(NEEDED))).toBe('waiting')
  const buying = answered({ direct: request({ action: 'market_buy', status: 'accepted' }) }).dapp
  expect(create_blocker(buying, holding(NEEDED))).toBe('waiting')
  // A creation on its way says so, before anything else, and a settled one frees the button.
  const creating = answered({ direct: request({ status: 'accepted' }) }).dapp
  expect(create_blocker(creating, holding(0n))).toBe('creating')
  expect(create_blocker(answered({ direct: request({ status: 'done' }) }).dapp, holding(NEEDED))).toBeNull()
  expect(create_blocker(answered({ direct: request({ status: 'refused' }) }).dapp, holding(NEEDED))).toBeNull()
})

test('the way to a new hero states the price and who pays, and says why it is closed', () => {
  const control = (state: AppState): string => render(<DappCreateHero copy={copy} locale="en" />, state)
  const short = control(answered({}, holding(NEEDED - 1n)))
  expect(short).toContain('data-create="funds"')
  expect(button(short, text.add_hero_action!)).toContain('disabled=""')
  expect(short).toContain('data-tone="alert" role="status"')
  expect(words(short)).toContain('Your bot needs 10 SUI for the hero and 0.05 SUI for network fees.')

  const early = control(linked({}, holding(NEEDED)))
  expect(button(early, text.add_hero_action!)).toContain('disabled=""')
  expect(words(early)).toContain(text.blocker_command_pending)
  // A bot that cannot be reached is not awaited: the sentence says so, as a reason to act on.
  const lost = control(linked({ observe_error: 'unavailable' }, holding(NEEDED)))
  expect(lost).toContain('data-create="unreachable"')
  expect(button(lost, text.add_hero_action!)).toContain('disabled=""')
  expect(lost).toContain('data-tone="alert" role="status"')
  expect(words(lost)).toContain(text.observe_failed)
  expect(words(lost)).not.toContain(text.blocker_command_pending)

  const creating = control(answered({ direct: request({ status: 'accepted' }) }, holding(NEEDED)))
  expect(button(creating, text.add_hero_action!)).toContain('aria-busy="true"')
  expect(words(creating)).toContain('Your bot is creating Hana.')

  const ready = control(answered({}, holding(NEEDED)))
  expect(ready).toContain('data-create="ready"')
  expect(button(ready, text.add_hero_action!)).not.toContain('disabled')
  expect(ready).not.toContain('role="status"')
  // The price is the game's and the bot wallet pays it; the count is the game's class list.
  expect(words(ready)).toContain(`${class_names.length} classes · 10 SUI, paid by your bot`)
  for (const html of [short, early, lost, creating, ready]) expect(words(html)).not.toMatch(RAW_KEY)
})

test('the creation form shows a 2D portrait in the chosen colours and mounts no canvas', async () => {
  const sheet = <DappCreateSheet copy={copy} locale="en" close={() => undefined} />
  // The form loads when it is opened: until then the sheet says it is loading.
  const loading = render(sheet, answered())
  expect(loading).toContain('aria-busy="true"')
  expect(words(loading)).toContain(text.loading)
  await import('../../src/components/CharacterCreateModal.tsx')
  await new Promise((resolve) => setTimeout(resolve, 0))

  const form = render(sheet, answered())
  expect(form).toContain('<img class="dapp-portrait dapp-create-portrait"')
  // The default hero of the form: a male senshi in its three default colours.
  expect(form).toContain('classe=senshi&amp;sex=male&amp;color_1=16777215')
  expect(form).not.toContain('<canvas')
  expect(form).not.toContain('data-character-preview')
  // The first line of the form states the price and who pays it, in this page's own words: it is read
  // before any choice, without scrolling to the price row at the foot of the form.
  const lead = `${class_names.length} classes · 10 SUI, paid by your bot`
  expect(words(form).indexOf(lead)).toBeGreaterThan(-1)
  expect(words(form).indexOf(lead)).toBeLessThan(words(form).indexOf(copy.class_label))
  expect(form).not.toContain(copy.create_lead)
  expect(form).toMatch(new RegExp(`<button[^>]*type="submit"[^>]*>${text.add_hero_action}</button>`))
  expect(form).not.toContain(copy.create_and_play)
})

test('Home suggests nothing before the bot answered, and shows no status and no send action', () => {
  const html = home(linked({}, account_fixture({ characters: [mira], items: KEYS })))
  expect(html).not.toContain('data-next=')
  expect(hero_card(html, HERO)).toContain('Mira')
  expect(buttons(hero_card(html, HERO))).toHaveLength(0)
  expect(words(html)).not.toContain(text.status_free)
})

test('a bot out of SUI comes first: the step says what to do and has no button of its own', () => {
  const broke = sync_positions(
    [],
    observation_fixture({ runs: [run_fixture(HERO, 'waiting', 'funding_required')] }),
    [mira],
    1_000
  )
  const html = home(answered({ positions: broke }, account_fixture({ characters: [mira, okami], items: KEYS })))
  const panel = next_panel(html)
  expect(panel).toContain('data-next="funds"')
  expect(words(panel)).toContain(text.next_funds_title)
  expect(words(panel)).toContain(text.next_funds_body)
  // Paying into the bot wallet belongs to the wallet menu of the page, never to a tab.
  expect(buttons(panel)).toHaveLength(0)
  expect(words(panel)).not.toContain('funding_required')
})

test('each other next step renders its one action', () => {
  const keyed = account_fixture({ characters: [mira, okami], items: KEYS })
  const raid = next_panel(home(answered({}, keyed)))
  expect(raid).toContain('data-next="raid"')
  expect(words(raid)).toContain(text.next_title)
  expect(words(raid)).toContain('Gilded Lorito is waiting')
  expect(words(raid)).toContain('Keys you hold for it: 3.')
  expect(buttons(raid)).toHaveLength(1)
  expect(button(raid, text.next_raid_action!)).toContain('aui-button--primary')

  const empty = account_fixture({ characters: [mira, okami] })
  const quest = next_panel(home(answered({}, empty)))
  expect(quest).toContain('data-next="quest"')
  // The strongest free hero is the one named.
  expect(words(quest)).toContain('Okami is free')
  expect(quest).toContain('<img class="dapp-portrait"')
  expect(buttons(quest)).toHaveLength(1)
  expect(button(quest, text.next_quest_action!)).toBeDefined()

  const everyone = [running(), running({ id: 'second', hero_id: SECOND })]
  const out = next_panel(home(answered({ positions: everyone }, keyed)))
  expect(out).toContain('data-next="out"')
  expect(words(out)).toContain(text.next_out_title)
  expect(buttons(out)).toHaveLength(1)
  expect(button(out, text.next_out_action!)).toBeDefined()
  // No estimate, no price and no key of the copy printed as itself.
  for (const panel of [raid, quest, out]) {
    expect(words(panel)).not.toMatch(/≈|SUI/)
    expect(words(panel)).not.toMatch(RAW_KEY)
  }
})

test('an empty account shows three steps and only the current one has a button', () => {
  const html = home(answered({}, account_fixture({ characters: [] })))
  expect(html).not.toContain('data-next=')
  expect(html).not.toContain('data-hero=')
  expect(words(html)).toContain(text.welcome_title)
  const steps = html.match(/<li class="aui-panel dapp-step".*?<\/li>/gs) ?? []
  expect(steps).toHaveLength(3)
  const [create, quest, raid] = steps
  expect(create).toContain('aria-current="step"')
  expect(words(create!)).toContain(text.step_create_title)
  expect(buttons(create!)).toHaveLength(1)
  expect(button(create!, text.add_hero_action!)).toContain('aui-button--primary')
  expect(words(create!)).toContain('10 SUI, paid by your bot')
  // What comes next is said from the seed: the city whose monsters drop the key of the first dungeon.
  expect(quest).not.toContain('aria-current')
  expect(words(quest!)).toContain(`Monsters of Thebes drop the ${item_name(lorito!.key)}.`)
  expect(buttons(quest!)).toHaveLength(0)
  expect(words(raid!)).toContain('Raid Gilded Lorito')
  expect(buttons(raid!)).toHaveLength(0)
  expect(words(html)).not.toMatch(RAW_KEY)

  // Until the game server has read the account, nobody is told they have no hero.
  const reading = home(answered({}, account_fixture({ characters: [], phase: 'loading' })))
  expect(reading).not.toContain('dapp-step')
  expect(words(reading)).not.toContain(text.welcome_title)
})

test('a hosted hero shows Stop and no send action', () => {
  const html = home(answered({ positions: [running()] }, account_fixture({ characters: [mira, okami], items: KEYS })))
  const out = hero_card(html, HERO)
  expect(out).toContain('data-status="activity"')
  expect(buttons(out)).toHaveLength(1)
  expect(button(out, text.position_stop!)).not.toContain('disabled')
  expect(button(out, text.hero_send_quest)).toBeUndefined()
  expect(button(out, text.hero_raid)).toBeUndefined()
  // The other hero is free: it is the one that can be sent.
  expect(button(hero_card(html, SECOND), text.hero_send_quest)).toBeDefined()

  // While a command of that hero is open, nothing is asked twice.
  const stop: DappCommand = { kind: 'stop', id: 'c1', hero_id: HERO, status: 'pending', error: null }
  const stopping = hero_card(home(answered({ positions: [running()], commands: { [HERO]: stop } })), HERO)
  expect(button(stopping, text.position_stop!)).toContain('disabled=""')
  expect(button(stopping, text.position_stop!)).toContain('aria-busy="true"')
  // A start still on its way has no run to stop yet.
  const start = { kind: 'start', id: 'c0', hero_id: HERO, status: 'pending', error: null, spec: SPEC } as DappCommand
  const starting = hero_card(home(answered({ commands: { [HERO]: start } })), HERO)
  expect(buttons(starting)).toHaveLength(1)
  expect(button(starting, text.position_stop!)).toContain('disabled=""')

  // A raid is watched on its own tab, and still has its Stop.
  const raiding = hero_card(home(answered({ positions: [running({ activity: 'raid' })] })), HERO)
  expect(button(raiding, text.hero_watch_raid)).toBeDefined()
  expect(button(raiding, text.position_stop!)).toBeDefined()
  expect(buttons(raiding)).toHaveLength(2)

  // A hero in a fight the bot does not play can be neither stopped nor sent from here.
  const fighting = character_fixture({ active_fight: { id: '0xfight', seat: 0 } as never })
  const busy = hero_card(home(answered({}, account_fixture({ characters: [fighting] }))), HERO)
  expect(busy).toContain('data-status="fight"')
  expect(buttons(busy)).toHaveLength(0)
})

test('a free hero leads with the raid only when it could enter a dungeon now', () => {
  const keyless = hero_card(home(answered()), HERO)
  expect(buttons(keyless)).toHaveLength(2)
  expect(button(keyless, text.hero_send_quest)).toContain('aui-button--primary')
  expect(button(keyless, text.hero_raid)).toContain('aui-button--neutral')

  const keyed = hero_card(home(answered({}, account_fixture({ characters: [mira], items: KEYS }))), HERO)
  expect(button(keyed, text.hero_raid)).toContain('aui-button--primary')
  expect(button(keyed, text.hero_send_quest)).toContain('aui-button--neutral')

  // A key in a kiosk this hero does not hold opens nothing for it.
  const elsewhere = [{ ...item_fixture(lorito!.key, 1), kiosk: '0xother' }]
  const locked = hero_card(home(answered({}, account_fixture({ characters: [mira], items: elsewhere }))), HERO)
  expect(button(locked, text.hero_send_quest)).toContain('aui-button--primary')
})

test('a button of Home fills a pick and opens its tab; it starts nothing', () => {
  const crowd = Array.from({ length: 8 }, (_, index) =>
    character_fixture({ id: hero_id(String(index + 1)), level: index + 1 })
  )
  const account = account_fixture({ characters: crowd, items: [item_fixture(lorito!.key, 8)] })
  const { dapp } = answered({}, account)
  const fold = (state: DappState, inputs: readonly DappInput[]): DappState =>
    inputs.reduce((next, input) => reduce_dapp(next, input, account), state)

  const quest = fold(dapp, quest_inputs(crowd[2]!.id))
  expect(quest.tab).toBe('quest')
  expect(quest.quest.hero_ids).toEqual([crowd[2]!.id])

  // "Raid dungeon" seats the hero beside those already picked, once, and leaves the dungeon to the Raid tab.
  const one = fold(dapp, seat_inputs(dapp, crowd[0]!.id))
  expect(one.tab).toBe('raid')
  expect(one.raid).toMatchObject({ dungeon: null, hero_ids: [crowd[0]!.id] })
  const two = fold(one, seat_inputs(one, crowd[1]!.id))
  expect(two.raid.hero_ids).toEqual([crowd[0]!.id, crowd[1]!.id])
  expect(fold(two, seat_inputs(two, crowd[0]!.id)).raid.hero_ids).toEqual([crowd[1]!.id, crowd[0]!.id])
  // A full side keeps its latest picks: the hero asked for is always seated.
  const full = { ...dapp, raid: { ...dapp.raid, hero_ids: crowd.slice(0, RAID_TEAM).map(({ id }) => id) } }
  const seated = fold(full, seat_inputs(full, crowd[7]!.id)).raid.hero_ids
  expect(seated).toHaveLength(RAID_TEAM)
  expect(seated.at(-1)).toBe(crowd[7]!.id)
  expect(seated).not.toContain(crowd[0]!.id)

  // "Plan a raid" seats the team the page proposes for that dungeon.
  const planned = fold(dapp, team_inputs(dapp, account, lorito!.dungeon))
  expect(planned.tab).toBe('raid')
  expect(planned.raid.dungeon).toBe(lorito!.dungeon)
  expect(planned.raid.hero_ids).toEqual(proposed_team(dapp, account, lorito!.dungeon).map(({ id }) => id))
  expect(planned.raid.hero_ids).toHaveLength(RAID_TEAM)
  // Nothing was sent to the bot: a pick is not a start.
  for (const state of [quest, two, planned]) expect(state.commands).toEqual({})
})

test('Home holds the heroes with their count, the tile of a new hero, the bag and the fees the bot paid', () => {
  const account = account_fixture({ characters: [mira, okami], items: KEYS })
  const html = home(answered({ observation: observation_fixture({ fees_mist: '12345678' }) }, account))
  expect(html).toContain(`<h2>${text.heroes_title}</h2><span class="dapp-note">2</span>`)
  expect(html.match(/data-hero=/g)).toHaveLength(2)
  // The roster cap of a bot account is not a verified fact: the count stands alone.
  expect(words(html)).not.toMatch(/2 of \d/)
  expect(words(block(html, 'dapp-create-tile', 'section'))).toContain(text.add_hero_title)
  expect(html).toContain(`aria-label="${text.bag_title}"`)
  expect(html).toContain('data-wallet-fees="">Fees your bot paid in all: 0.012 SUI</p>')
  expect(html).not.toContain('<canvas')

  // A bot that reports no fee says nothing about fees.
  expect(home(answered({}, account))).not.toContain('data-wallet-fees')
})

test('Disconnect waits for every request the bot has not answered', () => {
  const view = (dapp: Partial<DappState>): string => render(<DappDisconnect copy={copy} />, answered(dapp))
  const stop: DappCommand = { kind: 'stop', id: 'c1', hero_id: HERO, status: 'uncertain', error: null }
  expect(button(view({ commands: { [HERO]: stop } }), text.disconnect_action!)).toContain('disabled=""')
  expect(button(view({ direct: request({ status: 'accepted' }) }), text.disconnect_action!)).toContain('disabled=""')
  const free = view({ commands: { [HERO]: { ...stop, status: 'refused', error: 'unavailable' } } })
  expect(button(free, text.disconnect_action!)).not.toContain('disabled')
  expect(free).toContain(escaped(text.disconnect_body!))
  // Home ends with it.
  expect(button(home(answered()), text.disconnect_action!)).toBeDefined()
})
