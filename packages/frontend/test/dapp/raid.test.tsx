// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Raid tab: what it shows for a given reducer state, what each button sends, and what it never sends.
import { expect, mock, spyOn, test } from 'bun:test'
import type { CharacterRow, FightResolutionRow } from '@aresrpg/protocol'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as zustand from 'zustand'

import dungeons from '../../../../seed/content/dungeons.json'
import worlds from '../../../../seed/content/worlds.json'
import { content_catalog } from '../../src/content/catalog.ts'
import { DappRaid, RaidInsideView, RaidTab, raid_inside, raid_route } from '../../src/dapp/DappRaid.tsx'
import { RaidFollowView } from '../../src/dapp/DappRaidRun.tsx'
import { RaidSetupView, type SetupDraft } from '../../src/dapp/DappRaidSetup.tsx'
import type { DappAccount } from '../../src/dapp/account.ts'
import { item_name } from '../../src/dapp/copy.ts'
import {
  dungeon_boss,
  enter_step,
  RAID_DROPS_SHOWN,
  raid_parties,
  raid_verdict,
  seat_taken,
} from '../../src/dapp/raid.ts'
import { dungeon_rooms } from '../../src/dapp/places.ts'
import { reduce_dapp, type DappInput, type DappState, type RaidPick } from '../../src/dapp/state.ts'
import { EMPTY_PLAN, RAID_TEAM } from '../../src/dapp/strategies.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'
import * as store from '../../src/store.ts'

import { account_fixture, character_fixture, hero_id, item_fixture, observation_fixture } from './fixtures.ts'

const copy = en as AppCopy
const text = copy.dapp_page as Readonly<Record<string, string>>

const [thebes, ruins] = worlds.find(({ world }) => world === 'nauvis')!.cities
const [lorito, tangled] = dungeons
const gilded = content_catalog.dungeon(lorito!.dungeon)!
const ROOMS = lorito!.rooms.length
const NAMES = ['Mira', 'Okami', 'Bran', 'Lys', 'Tova', 'Reth', 'Sena']
/** Heroes of rising level, all standing in Thebes, at the gates of the Gilded Lorito. */
const hero = (index: number, row: Partial<CharacterRow> = {}): CharacterRow =>
  character_fixture({ id: hero_id(String(index + 1)), name: NAMES[index]!, level: index + 1, ...row })
const crowd = NAMES.map((_, index) => hero(index))
const [mira, okami, bran] = crowd as [CharacterRow, CharacterRow, CharacterRow]
const keys = (count: number, key = lorito!.key) => item_fixture(key, count)
const pick = (choice: Partial<RaidPick>) => ({ type: 'dapp/raid_pick' as const, pick: choice })
const direct = (row: CharacterRow, action: string, payload: object) => ({
  type: 'dapp/hero_direct',
  hero_id: row.id,
  action,
  payload: { character_id: row.id, ...payload },
})

type AppState = store.AppState
type Inputs = readonly store.AppInput[]
const base = store.initial_app_state({} as AppState['settings'])
/** A page linked to a bot that answered: what the bot said (`dapp`) over what the game server pushed. */
const page = (account: DappAccount, dapp: Partial<DappState> = {}): AppState => ({
  ...base,
  copy,
  session: { ...base.session, agent_inventory: account },
  dapp: { ...base.dapp, link: { phase: 'connected' }, observation: observation_fixture(), ...dapp },
})
const team_page = (heroes: readonly CharacterRow[], held: number): AppState =>
  page(account_fixture({ characters: heroes, items: held ? [keys(held)] : [] }))
/** The same page after inputs went through the dapp's one reducer. */
const after = (state: AppState, ...inputs: Inputs): AppState => {
  const fold = (dapp: DappState, input: store.AppInput) =>
    reduce_dapp(dapp, input as DappInput, state.session.agent_inventory)
  return { ...state, dapp: inputs.reduce(fold, state.dapp) }
}
const seated = (state: AppState, ...heroes: readonly CharacterRow[]): AppState =>
  after(state, pick({ hero_ids: heroes.map(({ id }) => id) }))
/** The game server pushed a new account: the reducer folds it with its next input. */
const pushed = (state: AppState, account: Partial<DappAccount>): AppState => {
  const agent_inventory = { ...state.session.agent_inventory, ...account }
  return after({ ...state, session: { ...state.session, agent_inventory } }, { type: 'dapp/tab', tab: 'raid' })
}

/** Runs a read of the views over one given reducer state. */
const seeing = <T,>(state: AppState, see: () => T): T => {
  const read = ((_store: unknown, selector?: (state: AppState) => unknown) =>
    selector ? selector(state) : state) as typeof zustand.useStore
  const spy = spyOn(zustand, 'useStore').mockImplementation(read)
  try {
    return see()
  } finally {
    spy.mockRestore()
  }
}
const render = (node: ReactNode, state: AppState): string => seeing(state, () => renderToStaticMarkup(node))
/** What a player reads: the markup without its tags and attributes. */
const words = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .replaceAll('&#x27;', "'")
const buttons = (html: string): readonly string[] => html.match(/<button[^>]*>.*?<\/button>/gs) ?? []
const button = (html: string, label: string): string | undefined =>
  buttons(html).find((markup) => words(markup).includes(label))

type Element = ReactElement<Record<string, unknown>>
/**
 * Every element a view renders, with each component that keeps no React state unfolded. A component
 * with state cannot run outside a render: it stays as it is, and its children are read instead.
 */
const elements = (node: unknown): readonly Element[] => {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement(node)) return []
  const element = node as Element
  const inner = () => [element, ...elements(element.props.children)]
  if (typeof element.type !== 'function') return inner()
  try {
    return elements((element.type as (props: unknown) => unknown)(element.props))
  } catch {
    return inner()
  }
}
const label_of = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(label_of).join('')
  if (isValidElement(node)) return label_of((node as Element).props.children)
  return typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}
/** A control is found by its whole label, or by attributes it carries. */
type Match = string | Readonly<Record<string, unknown>>
const matches = (element: Element, match: Match): boolean =>
  typeof match === 'string'
    ? label_of(element.props.children) === match
    : Object.entries(match).every(([name, value]) => element.props[name] === value)
/** The one control of a view that carries a label, or the given attributes, over one given state. */
const control = (node: ReactNode, state: AppState, kind: string, match: Match): Element => {
  // React reports each component with state it could not run outside a render: that is expected here.
  const quiet = spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const found = seeing(state, () => elements(node)).filter((one) => one.type === kind && matches(one, match))
    expect(found).toHaveLength(1)
    return found[0]!
  } finally {
    quiet.mockRestore()
  }
}
/** Acts on a view as a player does, and returns every input it sent to the store. */
const acting = (act: () => void): Inputs => {
  const sent: store.AppInput[] = []
  const dispatch = spyOn(store, 'dispatch_app').mockImplementation((input) => void sent.push(input))
  try {
    act()
    return sent
  } finally {
    dispatch.mockRestore()
  }
}
const press = (node: ReactNode, state: AppState, match: Match): Inputs => {
  const pressed = control(node, state, 'button', match)
  expect(pressed.props.disabled).toBeFalsy()
  return acting(() => (pressed.props.onClick as () => void)())
}

const open = mock((_sheet: SetupDraft['sheet']) => undefined)
const set_fee = mock((_typed: string) => undefined)
const entered = mock(() => undefined)
const DRAFT: SetupDraft = { sheet: null, open, fee: '', set_fee }
const setup = (draft: Partial<SetupDraft> = {}) => (
  <RaidSetupView copy={copy} locale="en" entered={entered} back={null} draft={{ ...DRAFT, ...draft }} />
)
const follow_view = (plan: () => void = () => undefined) => (
  <RaidFollowView copy={copy} locale="en" plan={plan} inspected={null} inspect={() => undefined} />
)
const follow = follow_view()
/** A sentence with a count is read from the shipped copy: its wording is the locale files' to choose. */
const counted = (key: string, count: number) => text[key]!.replace('{count}', String(count))
const enter_label = (count: number) => counted('raid_enter', count)
/** Every key a view read had copy: a missing key would print itself. */
const no_raw_key = (html: string) =>
  expect(words(html)).not.toMatch(/\b(raid|fee|quest|travel|drops|run|position|blocker|status|nav)_[a-z_]+/)

test('an account with no hero has no setup, and the tab follows a raid only while there is one', () => {
  const empty = team_page([], 0)
  expect(raid_route(empty.dapp, 0, false)).toBe('empty')
  const html = render(<DappRaid copy={copy} locale="en" />, empty)
  expect(html).toContain('data-raid-route="empty"')
  expect(words(html)).toContain(text.raid_empty_title)
  expect(html).not.toContain('data-raid-setup')
  const plan = mock((_planning: boolean) => undefined)
  const tab = (planning: boolean) => <RaidTab copy={copy} locale="en" planning={planning} plan={plan} />
  expect(press(tab(false), empty, 'Home')).toEqual([{ type: 'dapp/tab', tab: 'home' }])
  no_raw_key(html)

  const idle = seated(team_page([mira], 1), mira)
  expect(raid_route(idle.dapp, 1, false)).toBe('setup')
  // A start the bot has not answered is followed already; a refused one is not.
  const asked = after(idle, ...press(setup(), idle, enter_label(1)))
  expect(raid_route(asked.dapp, 1, false)).toBe('follow')
  expect(render(tab(false), asked)).toContain(`aria-busy="true">${text.blocker_command_pending}`)
  // Beside a followed raid the player can plan another team, and come back.
  const planning = follow_view(() => plan(true))
  expect(press(planning, asked, text.raid_plan!)).toEqual([])
  expect(plan.mock.calls).toEqual([[true]])
  expect(raid_route(asked.dapp, 1, true)).toBe('setup')
  expect(button(render(tab(true), asked), text.raid_back!)).toBeDefined()
  const answer = { hero_id: mira.id, id: asked.dapp.commands[mira.id]!.id, now: 5 }
  const refusal = { type: 'dapp/command_settled', ...answer, outcome: { kind: 'refused', error: 'unavailable' } }
  expect(raid_route(after(asked, refusal as DappInput).dapp, 1, false)).toBe('setup')
})

test('the proposed dungeon is the first whose key is held, and an unread bag claims no key count', () => {
  expect(render(setup(), team_page([mira], 0))).toContain(`data-raid-setup="${lorito!.dungeon}"`)
  const keyed = page(account_fixture({ characters: [mira], items: [keys(2, tangled!.key)] }))
  const html = render(setup(), keyed)
  expect(html).toContain(`data-raid-setup="${tangled!.dungeon}"`)
  expect(button(html, 'Tangled Aftermath')).toContain('aria-pressed="true"')
  expect(button(html, 'Gilded Lorito')).toContain('aria-pressed="false"')
  expect(words(html)).toContain('Hunt Araknomath')
  expect(words(html)).toContain(`${tangled!.rooms.length} rooms · ${tangled!.rooms.flat().length} monsters · boss`)
  expect(words(html)).toContain(counted('raid_keys_held', 2))
  // The player's own choice wins over the proposal.
  expect(press(setup(), keyed, 'Gilded Lorito')).toEqual([pick({ dungeon: lorito!.dungeon })])
  // No seat is filled by the page: the plan asks for a hero, and nothing can be entered.
  expect(html).toContain('data-raid-plan="empty"')
  expect(words(html)).toContain(text.raid_no_seat)
  expect(button(html, 'Enter')).toBeUndefined()
  no_raw_key(html)
  const unread = render(setup(), page(account_fixture({ characters: [mira], items: [keys(2)], phase: 'loading' })))
  expect(words(unread)).toContain(text.bag_loading)
  expect(unread).not.toContain('data-raid-keys=')
})

test('Best team fills the seats with the strongest free heroes the key rule lets in', () => {
  const short = team_page(crowd, 2)
  const sent = press(setup(), short, text.raid_best_team!)
  // Two keys: the two strongest, strongest first.
  expect(sent).toEqual([pick({ hero_ids: [crowd[6]!.id, crowd[5]!.id] })])
  const html = render(setup(), after(short, ...sent))
  expect(html.match(/data-seat="\d" data-hero="/g)).toHaveLength(2)
  expect(html.indexOf('Sena')).toBeLessThan(html.indexOf('Reth'))
  expect(words(html)).toContain(`2 of ${RAID_TEAM}`)
  // Nobody can enter without a key: there is nothing to propose.
  expect(control(setup(), team_page(crowd, 0), 'button', text.raid_best_team!).props.disabled).toBe(true)
})

test('a seventh hero cannot be seated', () => {
  const six = crowd.slice(0, RAID_TEAM)
  const full = seated(team_page(crowd, 7), ...six)
  const html = render(setup(), full)
  expect(html.match(/data-seat="\d" data-hero="/g)).toHaveLength(RAID_TEAM)
  expect(button(html, text.raid_seat_add!)).toBeUndefined()
  expect(words(html)).toContain(`${RAID_TEAM} of ${RAID_TEAM}`)
  // The last seat opens its sheet: the seventh hero can only take the place of the one sitting there.
  open.mockClear()
  expect(press(setup(), full, { 'data-seat': RAID_TEAM })).toEqual([])
  expect(open).toHaveBeenCalledWith({ kind: 'seat', seat: RAID_TEAM - 1 })
  const sheet = setup({ sheet: { kind: 'seat', seat: RAID_TEAM - 1 } })
  expect(words(render(sheet, full))).toContain(`Seat ${RAID_TEAM}`)
  const ids = [...six.slice(0, -1), crowd[6]!].map(({ id }) => id)
  const swap = press(sheet, full, { 'data-hero': crowd[6]!.id })
  expect(swap).toEqual([pick({ hero_ids: ids })])
  expect(after(full, ...swap).dapp.raid.hero_ids).toEqual(ids)
  // Whatever asks for more, the reducer seats one fight side at most.
  expect(seat_taken(ids, RAID_TEAM, six.at(-1)!.id)).toHaveLength(RAID_TEAM + 1)
  expect(seated(full, ...crowd).dapp.raid.hero_ids).toEqual(six.map(({ id }) => id))
  // Remove empties the seat; with every hero seated the sheet says so.
  expect(press(sheet, full, text.raid_seat_remove!)).toEqual([pick({ hero_ids: ids.slice(0, -1) })])
  const everyone = seated(team_page(six, 6), ...six)
  expect(words(render(setup({ sheet: { kind: 'seat', seat: 0 } }), everyone))).toContain(text.raid_seat_none)
})

test('each seated hero shows whether its own kiosk holds a key', () => {
  const key_seats = (state: AppState) =>
    buttons(render(setup(), state)).filter((markup) => markup.includes('data-seat-key'))
  const [first, second] = key_seats(seated(team_page([mira, okami], 1), mira, okami))
  expect(words(first!)).toContain('Mira')
  expect(first).toContain(`data-seat-key="held">${text.raid_seat_key}`)
  expect(second).toContain(`data-seat-key="none">${text.raid_seat_no_key}`)
  // A key in another kiosk is not this hero's: only the hero of that kiosk holds it.
  const far = hero(1, { kiosk: '0xother' })
  const split = page(account_fixture({ characters: [mira, far], items: [{ ...keys(1), kiosk: '0xother' }] }))
  const [left, right] = key_seats(seated(split, mira, far))
  expect(left).toContain('data-seat-key="none"')
  expect(right).toContain('data-seat-key="held"')
  // A bag still being read says nothing about keys.
  const unread = page(account_fixture({ characters: [mira], items: [keys(1)], phase: 'loading' }))
  expect(key_seats(seated(unread, mira))).toEqual([])
})

test('a team short of keys opens the notice that names who enters and sends nothing before the choice', () => {
  const short = seated(team_page([mira, okami, bran], 2), okami, mira, bran)
  expect(enter_step(EMPTY_PLAN)).toBe('blocked')
  const html = render(setup(), short)
  expect(words(html)).toContain(`1 more ${item_name(lorito!.key)} for this team`)
  expect(html).toContain('data-raid-short="1"')
  open.mockClear()
  entered.mockClear()
  // Enter asks first: nothing reaches the store.
  expect(press(setup(), short, enter_label(2))).toEqual([])
  expect(open).toHaveBeenCalledWith({ kind: 'short' })
  expect(entered).not.toHaveBeenCalled()
  const notice = setup({ sheet: { kind: 'short' } })
  expect(words(render(notice, short))).toContain('so only Okami, Mira will enter the dungeon')
  expect(press(notice, short, text.cancel!)).toEqual([])
  expect(open).toHaveBeenLastCalledWith(null)
  // The choice sends one start: the heroes with a key enter, in the picked order.
  const sent = press(notice, short, 'Start raid with 2')
  expect(sent).toHaveLength(1)
  expect(entered).toHaveBeenCalledTimes(1)
  expect(Object.keys(after(short, ...sent).dapp.commands)).toEqual([okami.id, mira.id])
  // A team with no key at all has no Enter: only the ways to a key.
  const keyless = render(setup(), seated(team_page([mira], 0), mira))
  expect(button(keyless, 'Enter')).toBeUndefined()
  expect(button(keyless, text.raid_quest_for_keys!)).toBeDefined()
})

test('Enter dispatches one dapp/start with the seats in order', () => {
  const hero_ids = [bran.id, mira.id, okami.id]
  const caps = { runs: 3, fee_cap_mist: '500000000' }
  const picked = after(seated(team_page([mira, okami, bran], 3), bran, mira, okami), pick(caps))
  entered.mockClear()
  const sent = press(setup({ fee: '0.5' }), picked, enter_label(3))
  const spec = { activity: 'raid', dungeon: lorito!.dungeon, hero_ids, ...caps }
  expect(sent).toMatchObject([{ type: 'dapp/start', title: 'Hunt Golden Lorito', spec }])
  expect(entered).toHaveBeenCalledTimes(1)
  const started = after(picked, ...sent)
  expect(Object.keys(started.dapp.commands)).toEqual(hero_ids)
  expect(raid_route(started.dapp, 3, false)).toBe('follow')
  // Before the bot answers at all, Enter waits and says so.
  const waiting = render(setup(), { ...picked, dapp: { ...picked.dapp, observation: null } })
  expect(button(waiting, 'Enter')).toContain('disabled=""')
  expect(waiting).toContain(`aria-busy="true">${text.blocker_command_pending}`)
  // A bot that cannot be reached is not awaited: the plan says so, and Enter stays closed.
  const lost = render(setup(), { ...picked, dapp: { ...picked.dapp, observation: null, observe_error: 'unavailable' } })
  expect(button(lost, 'Enter')).toContain('disabled=""')
  expect(lost).toContain(`aria-busy="false">${text.observe_failed}`)
  expect(lost).not.toContain(text.blocker_command_pending)
})

test('an entry that is no amount never becomes "no limit"; the runs are one, three or while keys last', () => {
  const state = seated(team_page([mira], 1), mira)
  const type = (typed: string) => {
    const field = control(setup(), state, 'input', {})
    return acting(() => (field.props.onChange as (event: unknown) => void)({ target: { value: typed } }))
  }
  set_fee.mockClear()
  expect(type('0.25')).toEqual([pick({ fee_cap_mist: '250000000' })])
  // What cannot be read is kept on screen and sends nothing: the limit in the store stays as it was.
  expect(type('0.2x')).toEqual([])
  expect(set_fee).toHaveBeenLastCalledWith('0.2x')
  expect(type('')).toEqual([pick({ fee_cap_mist: null })])
  const capped = after(state, pick({ fee_cap_mist: '250000000' }))
  const wrong = render(setup({ fee: '0.2x' }), capped)
  expect(wrong).toContain(`role="alert">${text.fee_cap_invalid}`)
  expect(button(wrong, 'Enter')).toContain('disabled=""')
  expect(words(wrong)).not.toContain('in network fees')
  const right = render(setup({ fee: '0.25' }), capped)
  expect(right).not.toContain('role="alert"')
  expect(button(right, 'Enter')).not.toContain('disabled')
  expect(words(right)).toContain('has paid 0.25 SUI in network fees')
  // The reducer itself ignores a malformed cap whole.
  expect(after(capped, pick({ fee_cap_mist: '0.2' })).dapp.raid).toBe(capped.dapp.raid)

  expect(button(right, text.raid_runs_all!)).toContain('aria-pressed="true"')
  expect(words(right)).toContain(text.raid_repeats)
  expect(press(setup(), state, '3')).toEqual([pick({ runs: 3 })])
  const three = after(state, pick({ runs: 3 }))
  expect(words(render(setup(), three))).toContain(counted('raid_runs_count', 3))
  expect(render(setup(), three)).toContain('data-raid-runs="3"')
  expect(press(setup(), three, text.raid_runs_all!)).toEqual([pick({ runs: null })])
})

test('a hero outside the city of the dungeon walks there, and its potion is optional', () => {
  const away = hero(1, { x: ruins!.x, z: ruins!.z })
  const potion = { ...item_fixture('potion_of_thebes', 1, 'p1'), category: 'consumable' }
  const state = seated(page(account_fixture({ characters: [mira, away], items: [keys(2), potion] })), mira, away)
  const html = render(setup(), state)
  expect(words(html)).toContain('Okami: walks there first. Each zone on the way costs a network fee.')
  expect(words(html)).toMatch(/Okami: at least \d+ minutes on foot to the gates/)
  expect(html.match(/data-walker=/g)).toHaveLength(1)
  // Walking blocks nothing: both heroes enter.
  expect(button(html, enter_label(2))).not.toContain('disabled')
  const drunk = direct(away, 'use_consumable', { item_id: 'p1', amount: 1 })
  expect(press(setup(), state, text.travel_potion_use!)).toMatchObject([drunk])
  // A hero of another world cannot be sent: the page says why.
  const far = hero(2, { world: 'yakutia', checkpoint_world: 'yakutia' })
  const other = seated(page(account_fixture({ characters: [mira, far], items: [keys(2)] })), mira, far)
  expect(words(render(setup(), other))).toContain('Bran: in another world.')
  expect(thebes!.dungeon).toBe(lorito!.dungeon)
})

const [drop] = dungeon_rooms(gilded)[0]!.drops
/** One room fight of a hero as the game server lists it once it ended. */
const fight = (id: string, character: string, room: number, won: boolean, loot = false) => {
  const drops = loot ? [{ item_type: drop!.item_type, qty: 2 }] : []
  const row = { fight: id, character, dungeon: lorito!.dungeon, dungeon_room: room, team: 0, drops }
  return { ...row, winner: won ? 0 : 1 } as unknown as FightResolutionRow
}
/** The bot did what every open start and stop asked. */
const settled = (state: AppState, now: number): AppState => {
  const outcome = { kind: 'done' as const }
  const answers = Object.values(state.dapp.commands).map(({ id, hero_id: of }) => ({ id, hero_id: of, outcome, now }))
  return after(state, ...answers.map((answer) => ({ type: 'dapp/command_settled' as const, ...answer })))
}
/** Mira and Okami sent into the Gilded Lorito by this page, with the bot's answer. */
const raiding = (): AppState => {
  const ready = seated(team_page([mira, okami], 2), mira, okami)
  return settled(after(ready, ...press(setup(), ready, enter_label(2))), 1_000)
}
const stopped_raid = (state: AppState): AppState =>
  settled(after(state, { type: 'dapp/stop', id: 'stop', hero_ids: [mira.id, okami.id] }), 9_000)
const inside = (room: number, ...heroes: readonly CharacterRow[]) =>
  heroes.map((row) => ({ ...row, dungeon_run: { dungeon: lorito!.dungeon, room } }))

test('a hero inside the chosen dungeon can take a seat; one inside another dungeon cannot', () => {
  const [here] = inside(2, okami)
  const there = { ...bran, dungeon_run: { dungeon: tangled!.dungeon, room: 1 } }
  const state = seated(page(account_fixture({ characters: [mira, here!, there], items: [keys(1)] })), mira)
  const sheet = setup({ sheet: { kind: 'seat', seat: 1 } })
  const choice = (id: string) => buttons(render(sheet, state)).find((markup) => markup.includes(`data-hero="${id}"`))
  expect(choice(there.id)).toContain('disabled=""')
  expect(choice(okami.id)).not.toContain('disabled')
  // Its raid goes on with the run it stands in: the planner starts it, and it burns no key.
  const picked = press(sheet, state, { 'data-hero': okami.id })
  expect(picked).toEqual([pick({ hero_ids: [mira.id, okami.id] })])
  expect(words(render(setup(), after(state, ...picked)))).toContain(enter_label(1))
})

test('the run view shows the room of each hero from its chain row and no round, turn or percentage', () => {
  const started = raiding()
  // On the way: nobody stands in a room, and the first room is ahead.
  const walking = render(follow, started)
  expect(walking).toContain('data-raid-follow="run"')
  expect(words(walking)).toContain(text.raid_walking)
  expect(walking).not.toContain('data-room-state')
  expect(words(walking)).toContain(text.raid_loot_empty)

  const fought = pushed(started, {
    characters: [...inside(3, mira), ...inside(2, okami)],
    resolutions: [fight('f1', mira.id, 1, true, true), fight('f1', okami.id, 1, true, true)],
  })
  const html = render(follow, fought)
  const row = (id: string) => words(html.slice(html.indexOf(`data-raid-hero="${id}"`)).split('</li>')[0]!)
  expect(row(mira.id)).toContain(`Room 3 of ${ROOMS}`)
  expect(row(okami.id)).toContain(`Room 2 of ${ROOMS}`)
  expect(html.match(/data-room-state="done"/g)).toHaveLength(2)
  expect(html.match(/data-room-state="now"/g)).toHaveLength(1)
  // Both heroes won the same fight: its loot is each hero's own, summed by item.
  expect(words(html)).toContain(`${item_name(drop!.item_type)} ×4`)
  expect(words(html)).toContain(text.raid_next_drops)
  expect(html.match(/data-run="/g)).toHaveLength(2)
  // No fight feed and no estimate: the only percentages are the seed's drop rates.
  expect(words(html).replace(/~[\d.,]+% per kill/g, '')).not.toMatch(/%|≈|\b(round|turn)\b/i)
  no_raw_key(html)
  const last = render(follow, pushed(started, { characters: inside(ROOMS, mira, okami) }))
  expect(words(last)).toContain(`Boss room · ${dungeon_boss(gilded)!.name}`)
  expect(last).not.toContain(text.raid_next_drops)
})

test('Stop keeps a hero inside its run; Leave asks once, then sends dungeon_leave for a hero the bot left', () => {
  const live = pushed(raiding(), { characters: inside(2, mira, okami) })
  const ask = mock((_hero: string | null) => undefined)
  const inside_view = (leaving: string | null) => <RaidInsideView copy={copy} leaving={leaving} ask={ask} />
  const names = ({ dapp, session }: AppState) =>
    raid_inside(dapp, session.agent_inventory.characters).map(({ name }) => name)
  // While the bot plays them, the heroes can be stopped, not pulled out: their raid would enter again.
  expect(names(live)).toEqual([])
  expect(render(inside_view(null), live)).toBe('')
  expect(words(render(follow, live))).toContain(text.raid_stop_note)
  const stops = press(follow, live, text.raid_stop_team!)
  expect(stops).toMatchObject([{ type: 'dapp/stop', hero_ids: [mira.id, okami.id] }])
  // Stopped, each hero still stands in its room: now it can leave.
  const stopped = settled(after(live, ...stops), 2_000)
  expect(names(stopped)).toEqual(['Mira', 'Okami'])
  const listed = render(inside_view(null), stopped)
  expect(words(listed)).toContain(text.raid_inside_title)
  expect(words(listed)).toContain(`Room 2 of ${ROOMS}`)
  expect(buttons(listed).filter((markup) => words(markup).includes(text.raid_leave!))).toHaveLength(2)
  expect(press(inside_view(null), stopped, { 'data-raid-leave': mira.id })).toEqual([])
  expect(ask).toHaveBeenCalledWith(mira.id)
  // The question says what leaving costs; its answer sends one request.
  expect(words(render(inside_view(mira.id), stopped))).toContain(text.raid_leave_body)
  expect(press(inside_view(mira.id), stopped, text.cancel!)).toEqual([])
  const sent = press(inside_view(mira.id), stopped, { className: 'aui-button aui-button--danger ' })
  expect(sent).toMatchObject([direct(mira, 'dungeon_leave', { dungeon: lorito!.dungeon })])
  // While that request is open, no second one can be made.
  const leaving = after(stopped, ...sent)
  expect(leaving.dapp.direct).toMatchObject({ action: 'dungeon_leave', status: 'pending' })
  expect(control(inside_view(null), leaving, 'button', { 'data-raid-leave': okami.id }).props.disabled).toBe(true)
})

test('the result shows won or lost from the folded results and the keys left', () => {
  const ended = (...resolutions: readonly FightResolutionRow[]): AppState =>
    stopped_raid(pushed(raiding(), { resolutions }))
  const won = ended(fight('f1', mira.id, 1, true, true), fight('f8', mira.id, ROOMS, true))
  const [party] = raid_parties(won.dapp.positions, won.session.agent_inventory.characters)
  expect(party).toMatchObject({ live: false, dungeon: { dungeon: lorito!.dungeon } })
  expect(raid_verdict(party!)).toBe('won')
  const html = render(follow, won)
  expect(html).toContain('data-raid-follow="result"')
  expect(html).toContain('data-verdict="won"')
  expect(words(html)).toContain(text.raid_result_won)
  expect(words(html)).toContain('Won 2 · lost 0')
  expect(words(html)).toContain(text.raid_result_bag)
  expect(words(html)).toContain(`${item_name(drop!.item_type)} ×2`)
  expect(html).toContain('data-raid-keys="2"')
  expect(words(html)).toContain('Keys left: 2')
  expect(words(html)).not.toMatch(/≈|SUI/)
  no_raw_key(html)
  // The same team again is one start with what the position kept.
  const sent = press(follow, won, text.raid_again!)
  expect(sent).toMatchObject([{ type: 'dapp/start', spec: party!.sent, title: 'Hunt Golden Lorito' }])
  expect(Object.keys(after(won, ...sent).dapp.commands)).toEqual([mira.id, okami.id])
  // Another team: the seats come back as they were sent, and the setup opens.
  const plan = mock(() => undefined)
  const team = { dungeon: lorito!.dungeon, hero_ids: [mira.id, okami.id], runs: null, fee_cap_mist: null }
  expect(press(follow_view(plan), won, text.raid_change_team!)).toEqual([pick(team)])
  expect(plan).toHaveBeenCalledTimes(1)

  // A lost room without a boss room won is a defeat; a raid that ended before either says only "finished".
  const lost = render(follow, ended(fight('f1', mira.id, 1, true), fight('f2', mira.id, 2, false)))
  expect(lost).toContain('data-verdict="lost"')
  expect(words(lost)).toContain(text.raid_result_lost)
  expect(words(lost)).toContain('Won 1 · lost 1')
  const undecided = render(follow, ended())
  expect(undecided).toContain('data-verdict="ended"')
  expect(words(undecided)).not.toMatch(/Victory|Defeat/)
  // The keys are gone: the same team cannot go again, and the page says how to get keys.
  const broke = render(follow, pushed(ended(fight('f8', mira.id, ROOMS, true)), { inventory: [] }))
  expect(broke).toContain('data-raid-keys="0"')
  expect(button(broke, text.raid_again!)).toBeUndefined()
  expect(broke).toContain('data-raid-short="2"')
  expect(button(broke, text.raid_change_team!)).toBeDefined()
})

test('the setup lists what a run can drop, one screen of it, and each room beside the team', () => {
  const rooms = dungeon_rooms(gilded)
  const html = render(setup(), seated(team_page([mira], 1), mira))
  expect(html.match(/data-item-row=/g)).toHaveLength(RAID_DROPS_SHOWN + 1)
  expect(words(html)).toMatch(/~[\d.]+% per kill/)
  expect(words(html)).toContain('Mira goes alone.')
  expect(html.match(/<div data-room="\d+">/g)).toHaveLength(rooms.length)
  no_raw_key(html)
})
