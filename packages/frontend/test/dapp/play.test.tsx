// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// What the page shows at each step of a load: one stage and one label per real wait, and the board
// with its five tabs as soon as the game server has read the bot account. No tab starts anything
// before the bot answers, and the market opens only then.
import { afterEach, expect, spyOn, test } from 'bun:test'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as zustand from 'zustand'

import type { AuthSession } from '../../src/auth.ts'
import { DappChips, DappTabs } from '../../src/dapp/DappPage.tsx'
import { board_stage, DappStage, play_stage, shown_tab, type Stage } from '../../src/dapp/DappPlay.tsx'
import type { DappAccount } from '../../src/dapp/account.ts'
import { parse_observation } from '../../src/dapp/observation.ts'
import type { DappState, DappTab } from '../../src/dapp/state.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'
import {
  dispatch_app,
  initial_app_state,
  initialize_app_store,
  read_app_state,
  type AppState,
} from '../../src/store.ts'
import { render_english } from '../i18n/render.ts'
import { automation_fixture } from '../modules/automation_fixture.ts'

import { account_fixture, character_fixture, item_fixture, observation_fixture } from './fixtures.ts'

const BOT = 'https://bot.example.test'
/**
 * The copy the shell reads that the locale files do not hold yet. Once `en.yaml` has these keys,
 * delete this table: the test then pins the shipped English copy.
 */
const english = en as AppCopy
const copy: AppCopy = english
const text = copy.dapp_page as Readonly<Record<string, string>>
const wallet = {
  address: `0x${'d'.repeat(64)}`,
  identity: 'zklogin',
  read_agent_pairing_request: () => ({ zklogin_public_identifier: 'google' }),
} as unknown as AuthSession
const pairing = { address: '0xagent', multisig_public_key: 'descriptor', signer_mode: 'host-persistent' as const }
const PENDING = parse_observation({ status: 'pending' })!
const NO_HEROES = { characters: [], phase: 'loading' } as const

const base = initial_app_state({} as AppState['settings'])
/** A signed-in page linked to its bot, with what the game server and the bot have said so far. */
const linked = (dapp: Partial<DappState>, account: Partial<DappAccount> = {}): AppState => ({
  ...base,
  session: {
    ...base.session,
    wallet,
    auth_status: 'authenticated',
    agent_inventory: { ...account_fixture(), ...account },
  },
  dapp: { ...base.dapp, link: { phase: 'connected' }, ...dapp },
})
const stage = (state: AppState): Stage => play_stage(state, BOT)

test('each wait of a linked page is a stage of its own', () => {
  // The game server has not named the heroes: that wait is its own, whatever the bot said.
  expect(stage(linked({}, NO_HEROES))).toBe('reading')
  expect(stage(linked({ observation: observation_fixture() }, NO_HEROES))).toBe('reading')
  expect(stage(linked({ observation: PENDING }, NO_HEROES))).toBe('reading')
  // Heroes are named: what the bot has not said yet is the only wait left.
  expect(stage(linked({}))).toBe('asking_bot')
  expect(stage(linked({ observation: PENDING }))).toBe('syncing')
  expect(stage(linked({ observation: observation_fixture() }))).toBe('board')
})

test('the board never waits for the bot, and the market still does', () => {
  const waiting: readonly Stage[] = [
    stage(linked({})),
    stage(linked({ observation: PENDING })),
    stage(linked({ observe_error: 'unavailable' })),
  ]
  expect(waiting).toEqual(['asking_bot', 'syncing', 'bot_unreachable'])
  // A failed read after a ready answer keeps the board; its error shows in place.
  expect(stage(linked({ observation: observation_fixture(), observe_error: 'unavailable' }))).toBe('board')
  // The market trades as the bot: it opens on `board` alone. Before that its tab shows Home.
  for (const closed of [...waiting, 'empty'] as const) expect(shown_tab('market', closed)).toBe('home')
  expect(shown_tab('market', 'board')).toBe('market')
  for (const tab of ['home', 'quest', 'raid', 'heroes'] as const)
    expect([shown_tab(tab, 'asking_bot'), shown_tab(tab, 'board')]).toEqual([tab, tab])
})

test('an empty team and a failed account read are the game server facts, with or without the bot', () => {
  for (const dapp of [{}, { observation: observation_fixture() }, { observe_error: 'unavailable' }]) {
    expect(stage(linked(dapp, { characters: [], phase: 'ready' }))).toBe('empty')
    expect(stage(linked(dapp, { phase: 'failed' }))).toBe('heroes_failed')
  }
})

test('the gates before the link keep their order, and no stage is a bare "Loading…"', () => {
  expect(play_stage(base, '')).toBe('unavailable')
  expect(stage(base)).toBe('sign_in')
  expect(stage({ ...base, session: { ...base.session, auth_status: 'connecting' } })).toBe('signing_in')
  const unlinked = (link: DappState['link']) => stage(linked({ link }))
  expect(unlinked({ phase: 'idle' })).toBe('connecting')
  expect(unlinked({ phase: 'authorizing' })).toBe('connecting')
  expect(unlinked({ phase: 'exchanging' })).toBe('connecting')
  expect(unlinked({ phase: 'disconnected', error: null })).toBe('connect')
  const outsider = { ...wallet, identity: 'wallet' } as unknown as AuthSession
  expect(stage({ ...base, session: { ...base.session, wallet: outsider } })).toBe('google')
  // The tabs belong to the board: no gate before the bot account is read shows them.
  const gates: readonly Stage[] = [
    'unavailable',
    'signing_in',
    'sign_in',
    'google',
    'connecting',
    'connect',
    'heroes_failed',
    'reading',
  ]
  expect(gates.filter(board_stage)).toEqual([])
  const boards: readonly Stage[] = ['empty', 'asking_bot', 'syncing', 'bot_unreachable', 'board']
  expect(boards.filter(board_stage)).toHaveLength(boards.length)
})

const reset = () => initialize_app_store(automation_fixture().settings)
afterEach(reset)
/** The real inputs of a cold load, up to the game server naming the bot account's heroes. */
const load_heroes = () => {
  reset()
  dispatch_app({ type: 'auth/connecting' })
  dispatch_app({ type: 'auth/connected', session: wallet })
  dispatch_app({ type: 'dapp/link', link: { phase: 'connected' } })
  dispatch_app({ type: 'agent/inventory_target', wallet, pairing })
}
const account_packet = (packet: object) =>
  dispatch_app({
    type: 'server/packet',
    packet: { type: 'packet/inventory_observed', id: read_app_state().session.agent_inventory.serial, packet },
  } as never)
/** A load up to the bot's own answer: one hero, an empty bag, nothing running. */
const load_board = () => {
  load_heroes()
  account_packet({ type: 'packet/characters', characters: [character_fixture()] })
  account_packet({ type: 'packet/inventory', items: [] })
  dispatch_app({ type: 'dapp/observed', observation: observation_fixture(), requested_ms: 1, now: 1 })
}
const open_tab = (tab: DappTab) => dispatch_app({ type: 'dapp/tab', tab })
const view = () => {
  const now = stage(read_app_state())
  return { stage: now, html: render_english(<DappStage stage={now} copy={copy} locale="en" />) }
}
const tabs = (now: Stage = stage(read_app_state())) => render_english(<DappTabs copy={copy} stage={now} />)
/** Static markup over one given state, for a state the real inputs do not reach in one step. */
const render_at = (state: AppState, node: ReactNode): string => {
  const read = ((_store: unknown, selector?: (state: AppState) => unknown) =>
    selector ? selector(state) : state) as typeof zustand.useStore
  const spy = spyOn(zustand, 'useStore').mockImplementation(read)
  try {
    return renderToStaticMarkup(node)
  } finally {
    spy.mockRestore()
  }
}
const buttons = (html: string): readonly string[] => html.match(/<button[^>]*>.*?<\/button>/gs) ?? []
const tagged = (html: string, attribute: string) => buttons(html).filter((markup) => markup.includes(attribute))
const count = (html: string, part: string): number => html.split(part).length - 1
const WAITS = [text.signing_in, text.connect_busy, text.reading_heroes, text.asking_bot, text.syncing, text.loading]
/** The one wait a view names. */
const named_waits = (html: string) => WAITS.filter((label) => html.includes(label!))

test('each wait renders its own label', () => {
  reset()
  dispatch_app({ type: 'auth/connecting' })
  expect(named_waits(view().html)).toEqual([text.signing_in])
  dispatch_app({ type: 'auth/connected', session: wallet })
  expect(named_waits(view().html)).toEqual([text.connect_busy])
  dispatch_app({ type: 'dapp/link', link: { phase: 'connected' } })
  dispatch_app({ type: 'agent/inventory_target', wallet, pairing })
  // The bot read is in flight too, but the page waits for the heroes: it names that wait alone.
  expect(named_waits(view().html)).toEqual([text.reading_heroes])
  account_packet({ type: 'packet/characters', characters: [character_fixture()] })
  expect(named_waits(view().html)).toEqual([text.asking_bot])
  dispatch_app({ type: 'dapp/observed', observation: PENDING, requested_ms: 1, now: 1 })
  expect(named_waits(view().html)).toEqual([text.syncing])
  dispatch_app({ type: 'dapp/observed', observation: observation_fixture(), requested_ms: 2, now: 2 })
  expect(named_waits(view().html)).toEqual([])
})

test('the board shows the heroes before the bot answers, claims no status and no tab starts anything', () => {
  load_heroes()
  account_packet({ type: 'packet/characters', characters: [character_fixture()] })
  const before = view()
  expect(before.stage).toBe('asking_bot')
  expect(before.html).toContain('Mira')
  expect(before.html).toContain(text.heroes_title)
  expect(count(before.html, 'data-bot-wait')).toBe(1)
  // The bag is the game server's and names its own wait.
  expect(before.html).toContain(text.bag_loading!.replace("'", '&#x27;'))
  // No hero claims a status the bot has not given, and Home suggests and offers nothing.
  expect(before.html).not.toContain('data-status=')
  expect(before.html).not.toContain(`>${text.status_free}<`)
  expect(before.html).not.toContain('data-next=')
  expect(before.html).not.toContain(text.hero_send_quest)
  // The Quest tab shows its Start, closed, with the reason.
  open_tab('quest')
  const quest = view().html
  expect(quest).toContain('data-quest="fight"')
  const [start] = tagged(quest, 'data-start')
  expect(start).toContain('disabled=""')
  expect(quest).toContain(text.blocker_command_pending)
  // The Raid tab seats nobody by itself and has no Enter without a seat.
  open_tab('raid')
  const raid = view().html
  expect(raid).toContain('data-raid-route="setup"')
  expect(raid).toContain('data-raid-plan="empty"')
  // A start sent anyway is not admitted.
  const spec = { activity: 'train', hero_ids: [character_fixture().id], place: null, difficulty: null } as const
  dispatch_app({ type: 'dapp/start', id: 'early', spec: { ...spec, fee_cap_mist: null }, title: 'T' })
  expect(read_app_state().dapp.commands).toEqual({})

  // A bot that is still catching up changes the label only.
  dispatch_app({ type: 'dapp/observed', observation: PENDING, requested_ms: 1, now: 1 })
  open_tab('quest')
  const syncing = view()
  expect(syncing.stage).toBe('syncing')
  expect(syncing.html).toContain(text.syncing)
  expect(syncing.html).not.toContain('data-status=')
  expect(tagged(syncing.html, 'data-start')[0]).toContain('disabled=""')
})

test('after the bot answers, the statuses and the actions appear', () => {
  load_board()
  const after = view()
  expect(after.stage).toBe('board')
  expect(after.html).not.toContain('data-bot-wait')
  expect(after.html).toContain('data-status="free"')
  expect(after.html).toContain(text.status_free)
  // One free hero and no key: Home suggests a quest, and the hero can be sent.
  expect(after.html).toContain('data-next="quest"')
  expect(after.html).toContain(text.hero_send_quest)
  open_tab('quest')
  const quest = view().html
  expect(tagged(quest, 'data-start')[0]).not.toContain('disabled')
  expect(quest).not.toContain(text.blocker_command_pending)
})

test('a failed bot read keeps the board and says so in place', () => {
  load_heroes()
  account_packet({ type: 'packet/characters', characters: [character_fixture()] })
  dispatch_app({ type: 'dapp/observe_failed', error: 'unavailable' })
  const failed = view()
  expect(failed.stage).toBe('bot_unreachable')
  expect(failed.html).toContain('Mira')
  expect(failed.html).toContain(`role="alert">${text.observe_failed}`)
  // The read is over: the page does not claim to be asking still, and it shows no raw code.
  expect(failed.html).not.toContain('data-bot-wait')
  expect(failed.html).not.toContain('unavailable')
  expect(failed.html).not.toContain('data-status=')
  open_tab('quest')
  expect(tagged(view().html, 'data-start')[0]).toContain('disabled=""')
})

test('the five tabs render in order, the one on screen is the current page, and a badge counts heroes out', () => {
  load_board()
  const labels = [text.nav_home, text.nav_quest, text.nav_raid, text.nav_heroes, text.nav_market]
  const bar = tabs()
  expect(bar).toContain(`<nav class="dapp-tabs" aria-label="${text.nav_label}">`)
  expect(buttons(bar).map((markup) => markup.replace(/<[^>]*>/g, ''))).toEqual(labels)
  const current = (html: string) =>
    tagged(html, 'aria-current="page"').map((markup) => /data-tab="(\w+)"/.exec(markup)![1])
  expect(current(bar)).toEqual(['home'])
  expect(bar).not.toContain('data-badge')
  expect(bar).not.toContain('disabled')
  open_tab('heroes')
  expect(current(tabs())).toEqual(['heroes'])
  expect(view().html).toContain('dapp-heroes-tab')
  // A hero sent on a quest is counted on Quest; a raid would be counted on Raid.
  const hero = character_fixture().id
  const spec = { activity: 'train', hero_ids: [hero], place: null, difficulty: null, fee_cap_mist: null } as const
  dispatch_app({ type: 'dapp/start', id: 'c', spec, title: 'T' })
  dispatch_app({ type: 'dapp/command_settled', hero_id: hero, id: `c:${hero}`, outcome: { kind: 'done' }, now: 5 })
  const [quest, raid] = ['quest', 'raid'].map((tab) => tagged(tabs(), `data-tab="${tab}"`)[0]!)
  expect(quest).toContain('data-badge="1"')
  expect(raid).not.toContain('data-badge')
  // The run shows on the Quest tab, with its own Stop.
  open_tab('quest')
  expect(view().html).toContain(`data-run="${hero}"`)
})

test('the Market tab opens only once the bot answered: before that it cannot be pressed and shows Home', () => {
  load_heroes()
  account_packet({ type: 'packet/characters', characters: [character_fixture()] })
  open_tab('market')
  const closed = view()
  expect(closed.stage).toBe('asking_bot')
  expect(closed.html).not.toContain('dapp-market')
  expect(closed.html).toContain('dapp-home')
  expect(tagged(tabs(), 'data-tab="market"')[0]).toContain('disabled=""')
  expect(tagged(tabs(), 'aria-current="page"')[0]).toContain('data-tab="home"')
  account_packet({ type: 'packet/inventory', items: [] })
  dispatch_app({ type: 'dapp/observed', observation: observation_fixture(), requested_ms: 1, now: 1 })
  const open = view()
  expect(open.stage).toBe('board')
  expect(tagged(tabs(), 'data-tab="market"')[0]).not.toContain('disabled')
  expect(tagged(tabs(), 'aria-current="page"')[0]).toContain('data-tab="market"')
  expect(open.html).toContain('data-tab="market"')
  expect(open.html).toContain('class="dapp-market"')
  expect(open.html).not.toContain('dapp-home')
  // The market takes the full width: what entered the bag stands beside every other tab only.
  expect(open.html).not.toContain('dapp-bag-feed-panel')
  // Proceeds are collected by the bot itself: the page offers no collection it cannot know of.
  expect(open.html).not.toContain('data-market-collect')
  expect(open.html).not.toContain('dapp-market-bar')
})

test('every tab shows under the one notice block, beside what entered the bag', () => {
  load_board()
  // One direct request, made from Home: whatever tab is on screen tells what became of it.
  const payload = { name: 'Okami', classe: 'yogan', male: true, color_1: 1, color_2: 2, color_3: 3 }
  dispatch_app({ type: 'dapp/create_hero', id: 'k1', payload })
  expect(read_app_state().dapp.direct).toMatchObject({ action: 'create_character', status: 'pending' })
  for (const tab of ['home', 'quest', 'raid', 'heroes', 'market'] as const) {
    open_tab(tab)
    const { html } = view()
    expect([tab, count(html, 'data-direct="pending"')]).toEqual([tab, 1])
    expect([tab, count(html, 'class="dapp-notices"')]).toEqual([tab, 1])
    expect([tab, count(html, 'dapp-bag-feed-panel')]).toEqual([tab, tab === 'market' ? 0 : 1])
    expect(html).toContain(`<div class="dapp-layout" data-tab="${tab}">`)
  }
})

test('the header counts the keys the heroes hold and shows what the bot wallet holds, once each is known', () => {
  const chips = (state: AppState) => render_at(state, <DappChips copy={copy} locale="en" />)
  const key = item_fixture('key_of_gilded_lorito', 3)
  const holding = (account: Partial<DappAccount>) => linked({}, { inventory: [key] as never, ...account })
  // Signed out there is no bot account to read.
  expect(chips({ ...holding({}), session: { ...holding({}).session, wallet: null } })).toBe('')
  // A bag still being read claims no key count; an unknown balance shows no figure.
  const unread = chips(holding({ phase: 'loading', sui_balance_mist: null }))
  expect(unread).toBe('')
  const read = chips(holding({ sui_balance_mist: 2_000_000_000n }))
  expect(read).toContain(`aria-label="${text.keys_chip!.replace('{count}', '3')}"`)
  expect(read).toContain('data-keys="3"')
  expect(read).toContain('2.00')
  expect(read).not.toContain('data-low')
  // A bot that cannot pay fees for long says so on its balance.
  const low = chips(holding({ sui_balance_mist: 100_000_000n }))
  expect(low).toContain('data-low="true"')
  expect(low).toContain(`title="${text.bot_balance_low}"`)
})

test('an account with no hero gets the board with its first steps, and the wait of the bot is still named', () => {
  const rich = { characters: [], phase: 'ready', sui_balance_mist: 20_000_000_000n } as const
  const empty = (dapp: Partial<DappState>) => linked(dapp, rich)
  const board = (state: AppState) => render_at(state, <DappStage stage={stage(state)} copy={copy} locale="en" />)
  const asking = board(empty({}))
  expect(stage(empty({}))).toBe('empty')
  expect(asking).toContain(text.welcome_title)
  expect(asking).toContain(text.step_create_title)
  expect(count(asking, 'data-bot-wait')).toBe(1)
  expect(asking).toContain(text.asking_bot)
  // Once the bot answered there is nothing left to wait for; the first step can be taken.
  const answered = board(empty({ observation: observation_fixture() }))
  expect(answered).not.toContain('data-bot-wait')
  expect(answered).toContain('data-create="ready"')
  // Each other tab says where the first hero comes from, and none of them is a dead end.
  for (const [tab, marker] of [
    ['quest', 'data-quest-empty'],
    ['raid', 'data-raid-empty'],
    ['heroes', 'data-heroes-empty'],
    ['market', 'dapp-welcome'],
  ] as const)
    expect([tab, board(empty({ observation: observation_fixture(), tab })).includes(marker)]).toEqual([tab, true])
})
