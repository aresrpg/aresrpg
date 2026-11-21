// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The Quest tab: what it shows for a given reducer state, what it proposes without sending, and the
// exact inputs its buttons dispatch. Refusals and invalid entries come first.
import { expect, spyOn, test } from 'bun:test'
import { job_xp_for_level } from '@aresrpg/immutable'
import type { CharacterRow } from '@aresrpg/protocol'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as zustand from 'zustand'

import { content_catalog } from '../../src/content/catalog.ts'
import { DappQuest, QuestSendView, quest_runs, start_input } from '../../src/dapp/DappQuest.tsx'
import { goal_ready } from '../../src/dapp/DappQuestWork.tsx'
import { potion_input } from '../../src/dapp/DappStartParts.tsx'
import type { DappAccount } from '../../src/dapp/account.ts'
import { dapp_text, item_name } from '../../src/dapp/copy.ts'
import { key_drops, place_levels, quest_places } from '../../src/dapp/places.ts'
import { finish_position, open_position, type DappPosition } from '../../src/dapp/positions.ts'
import {
  fight_spec,
  reduce_dapp,
  work_spec,
  work_worker,
  type DappState,
  type QuestPick,
} from '../../src/dapp/state.ts'
import type { StartSpec, WorkPick } from '../../src/dapp/strategies.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'
import { initial_app_state, subscribe_app, type AppState } from '../../src/store.ts'

import { HERO, account_fixture, character_fixture, hero_id, item_fixture, observation_fixture } from './fixtures.ts'

const copy = en as AppCopy
const text = copy.dapp_page as Readonly<Record<string, string>>

const SECOND = hero_id('2')
/** Both heroes stand in Thebes, the fixture's checkpoint. Okami is the stronger one. */
const mira = character_fixture()
const okami = character_fixture({ id: SECOND, name: 'Okami', classe: 'senshi', level: 7, kiosk: '0xother' })
const RUINS = { world: 'nauvis', city: 'the_ruins' }
const THEBES = { world: 'nauvis', city: 'thebes' }
const base = initial_app_state({} as AppState['settings'])
type Account = Parameters<typeof account_fixture>[0]
/** A page whose bot answered: the pick (`quest`), the rest of the reducer state, and the pushed account. */
const tab = (quest: Partial<QuestPick> = {}, account: Account = {}, dapp: Partial<DappState> = {}): AppState => ({
  ...base,
  copy,
  session: { ...base.session, agent_inventory: account_fixture({ characters: [mira, okami], ...account }) },
  dapp: {
    ...base.dapp,
    link: { phase: 'connected' },
    observation: observation_fixture(),
    ...dapp,
    quest: { ...base.dapp.quest, ...quest },
  },
})
const account_of = (state: AppState): DappAccount => state.session.agent_inventory
/** Static markup over one given state. Rendering sends nothing: effects do not run. */
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
const quest = (state: AppState): string => render(<DappQuest copy={copy} locale="en" />, state)
const words = (html: string): string => html.replace(/<[^>]*>/g, ' ').replaceAll('&#x27;', "'")
const buttons = (html: string): readonly string[] => html.match(/<button[^>]*>.*?<\/button>/gs) ?? []
const button = (html: string, label: string): string | undefined =>
  buttons(html).find((markup) => words(markup).includes(label))
const tagged = (html: string, attribute: string): readonly string[] =>
  buttons(html).filter((markup) => markup.includes(attribute))
const pressed = (html: string): readonly string[] =>
  buttons(html)
    .filter((markup) => markup.includes('aria-pressed="true"'))
    .map((markup) => words(markup).replace(/\s+/g, ' ').trim())
const work = (pick: WorkPick, account: Account = {}): AppState =>
  tab({ kind: 'work', hero_ids: [HERO], work: pick }, account)
const worker = (jobs: Readonly<Record<string, number>>, row: Partial<CharacterRow> = {}): CharacterRow =>
  character_fixture({
    jobs: Object.fromEntries(Object.entries(jobs).map(([job, level]) => [job, String(job_xp_for_level(level) ?? 0)])),
    ...row,
  })
const UNTIL = { kind: 'until_stopped' } as const

test('a fee limit that is not an amount never becomes "no limit", and no Start is offered with it', () => {
  // The reducer refuses a malformed limit whole, so the pick it holds is always a valid one.
  const state = tab({ fee_cap_mist: '50000000' })
  const refused = reduce_dapp(
    state.dapp,
    { type: 'dapp/quest_pick', pick: { fee_cap_mist: '0.05' } },
    account_of(state)
  )
  expect(refused.quest.fee_cap_mist).toBe('50000000')

  const spec = fight_spec(state.dapp, account_of(state))
  const send = (entry: string | null): string =>
    render(<QuestSendView copy={copy} spec={spec} title="Title" entry={entry} enter={() => undefined} />, state)
  // The stored limit shows in SUI, with what it means, and Start is offered.
  const valid = send(null)
  expect(valid).toContain('data-fee-cap="valid"')
  expect(valid).toContain('value="0.05"')
  expect(words(valid)).toContain('has paid 0.05 SUI in network fees')
  expect(tagged(valid, 'data-start')).toHaveLength(1)
  // An entry that is no amount says so, and there is nothing to press.
  const invalid = send('abc')
  expect(invalid).toContain('data-fee-cap="invalid"')
  expect(invalid).toContain('aria-invalid="true"')
  expect(invalid).toContain(`role="alert">${text.fee_cap_invalid}`)
  expect(tagged(invalid, 'data-start')).toHaveLength(0)
  // An emptied field is no limit, said by its placeholder.
  expect(send('')).toContain(`placeholder="${text.fee_cap_none}"`)
  expect(tagged(send(''), 'data-start')).toHaveLength(1)
})

test('a difficulty the chosen city cannot offer says so and offers no Start', () => {
  // Thebes stands near the centre of the world: its groups are the easy ones only.
  const unfit = quest(tab({ place: THEBES, difficulty: 'hard' }))
  expect(unfit).toContain('data-unfit=""')
  expect(words(unfit)).toContain('Thebes is not at that distance. Pick another place or another difficulty.')
  expect(tagged(unfit, 'data-start')).toHaveLength(0)

  const fit = quest(tab({ place: THEBES, difficulty: 'easy' }))
  expect(fit).not.toContain('data-unfit')
  expect(words(fit)).toContain('Groups of 1 to 2 monsters.')
  expect(tagged(fit, 'data-start')).toHaveLength(1)
  // The hard level has one group size, and it reads as one.
  expect(words(quest(tab({ place: RUINS, difficulty: 'hard' })))).toContain('Groups of 6 monsters.')
  expect(pressed(fit)).toContain('Easy')
})

test('a locked resource or recipe cannot be picked, and the planner refuses one picked anyway', () => {
  const wheat = quest(work({ mode: 'gather', item_type: 'wheat', goal: UNTIL }))
  expect(button(wheat, item_name('wheat'))).toContain('aria-pressed="true"')
  const barley = button(wheat, item_name('wheat_barley'))
  expect(barley).toContain('disabled=""')
  expect(words(barley!)).toContain('Opens at Farmer level 10')
  // A farmer of level 10 may pick it.
  const farmer = worker({ FARMER: 10 })
  const open = quest(work({ mode: 'gather', item_type: 'wheat', goal: UNTIL }, { characters: [farmer] }))
  expect(button(open, item_name('wheat_barley'))).not.toContain('disabled')

  const lacquer = quest(work({ mode: 'craft', item_type: 'mushroom_lacquer', goal: UNTIL }))
  expect(button(lacquer, item_name('mushroom_lacquer'))).toContain('aria-pressed="true"')
  expect(button(lacquer, item_name('recall_potion'))).toContain('disabled=""')
  expect(words(button(lacquer, item_name('recall_potion'))!)).toContain('Opens at Alchemist level 10')

  // A pick that reached the state another way is still refused, in words, and starts nothing.
  const forced = work({ mode: 'gather', item_type: 'wheat_barley', goal: UNTIL })
  const html = quest(forced)
  expect(html).toContain(`data-line="job_level_required">Mira: profession level too low for this.`)
  expect(tagged(html, 'data-start')[0]).toContain('disabled=""')
  const spec = work_spec(forced.dapp, account_of(forced))
  expect(reduce_dapp(forced.dapp, start_input('s', spec, 'Title'), account_of(forced)).commands).toEqual({})
})

test('the planner blockers of work have their sentences, and a missing tool shows its way to the market', () => {
  const toolless = quest(work({ mode: 'gather', item_type: 'wheat', goal: UNTIL }))
  expect(toolless).toContain('data-line="tool_required">Mira: has no tool for this profession.')
  expect(toolless).toContain('data-tool-missing="FARMER"')
  expect(words(toolless)).toContain('Needs a Farming tool. Handymen craft them.')
  expect(button(toolless, `Find ${item_name('old_hoe')} on the market`)).toBeDefined()
  expect(tagged(toolless, 'data-start')[0]).toContain('disabled=""')

  const unknown = quest(work({ mode: 'gather', item_type: 'not_a_resource', goal: UNTIL }))
  expect(unknown).toContain('data-line="work_unknown">Mira: cannot do this work in the world it stands in.')
  // A goal typed wrong is no goal to send: the amount and the level each have their rule.
  const amount: WorkPick = { mode: 'gather', item_type: 'wheat', goal: { kind: 'amount', amount: 5 } }
  const level: WorkPick = { mode: 'gather', item_type: 'wheat', goal: { kind: 'job_level', level: 12 } }
  expect([null, '7', ' 7 '].map((entry) => goal_ready(amount, entry, 10))).toEqual([true, true, true])
  expect(['', '0', '1.5', 'x'].map((entry) => goal_ready(amount, entry, 10))).toEqual([false, false, false, false])
  expect([null, '11', '100'].map((entry) => goal_ready(level, entry, 10))).toEqual([true, true, true])
  expect(['10', '101', ''].map((entry) => goal_ready(level, entry, 10))).toEqual([false, false, false])
  expect(goal_ready({ mode: 'auto', job: null }, 'x', 1)).toBe(true)
  // A level goal the hero already passed is invalid as it stands.
  expect(goal_ready(level, null, 12)).toBe(false)
})

test('with no pick the strongest free hero and its own city are proposed, and nothing is sent', () => {
  const state = tab()
  const sent: unknown[] = []
  const stop = subscribe_app((next) => sent.push(next))
  const html = quest(state)
  stop()
  expect(sent).toEqual([])
  // Okami is proposed; the pick itself stays empty.
  expect(state.dapp.quest.hero_ids).toEqual([])
  expect(fight_spec(state.dapp, account_of(state))).toEqual({
    activity: 'train',
    hero_ids: [SECOND],
    place: null,
    difficulty: null,
    fee_cap_mist: null,
  })
  const picker = html.slice(html.indexOf('role="group" aria-label="Who"'), html.indexOf('dapp-quest-split'))
  expect(pressed(picker).map((label) => label.split(' ')[0])).toEqual(['Okami'])
  // Where each hero stands: Okami stands in Thebes, so the plan reads Thebes.
  expect(html).toContain('data-place="here" data-selected="true"')
  expect(words(html)).toContain('Okami · Thebes')
  expect(html).toContain('data-facts="city:thebes"')
  expect(button(html, 'Send Okami')).not.toContain('disabled')
  expect(pressed(html)).toContain('Fight for loot Gear, keys and experience from every fight')
  // Outside every city a hero fights across its world: the page names the world and describes no place.
  const roaming = quest(tab({}, { characters: [character_fixture({ x: 50_000, z: 60_000 })] }))
  expect(words(roaming)).toContain('Mira · Nauvis')
  expect(roaming).not.toContain('data-facts=')
  expect(button(roaming, 'Send Mira')).not.toContain('disabled')
  // A hero in a fight is never proposed.
  const busy = tab({}, { characters: [mira, { ...okami, active_fight: { id: 'f', seat: 0 } } as CharacterRow] })
  expect(fight_spec(busy.dapp, account_of(busy)).hero_ids).toEqual([HERO])
  // Before the bot answered nothing can start, and the page says what it waits for.
  const early = quest(tab({}, {}, { observation: null }))
  expect(tagged(early, 'data-start')[0]).toContain('disabled=""')
  expect(early).toContain(`data-line="waiting">${text.blocker_command_pending}`)
  // A bot that cannot be reached is not awaited: the line says so, and nothing can start.
  const lost = quest(tab({}, {}, { observation: null, observe_error: 'unavailable' }))
  expect(tagged(lost, 'data-start')[0]).toContain('disabled=""')
  expect(lost).toContain(`data-line="unreachable">${text.observe_failed}`)
  expect(lost).not.toContain(text.blocker_command_pending)
})

test('the plan and its Start come before the places, and the heroes that are out come before the setup', () => {
  const html = quest(tab())
  const at = (markup: string, mark: string): number => markup.indexOf(mark)
  // One column reads top to bottom: who, the plan with its Start, then every place.
  expect(at(html, 'aria-label="Who"')).toBeLessThan(at(html, 'data-plan="fight"'))
  expect(at(html, 'data-plan="fight"')).toBeLessThan(at(html, 'data-start'))
  expect(at(html, 'data-start')).toBeLessThan(at(html, 'data-place="here"'))
  expect(html).not.toContain('data-quest-runs')
  // A hero that is out heads the tab: its card is above the mode cards and the setup of the next Start.
  const out = open_position(HERO, 1_000, [mira, okami], { activity: 'train', sent: null })
  const ended = finish_position({ ...out, id: 'ended', hero_id: SECOND }, 2_000)
  const busy = quest(tab({}, {}, { positions: [out, ended] }))
  expect(at(busy, 'data-quest-runs="out"')).toBeLessThan(at(busy, 'data-mode="fight"'))
  expect(at(busy, 'data-mode="fight"')).toBeLessThan(at(busy, 'data-plan="fight"'))
  // What ended is history: it stays under the setup.
  expect(at(busy, 'data-place="here"')).toBeLessThan(at(busy, 'data-quest-runs="finished"'))
})

test('several heroes can be picked, in the order picked', () => {
  const state = tab({ hero_ids: [HERO, SECOND] })
  const html = quest(state)
  expect(fight_spec(state.dapp, account_of(state)).hero_ids).toEqual([HERO, SECOND])
  expect(button(html, 'Send Mira, Okami')).not.toContain('disabled')
  expect(words(html)).toContain('Mira · Thebes, Okami · Thebes')
  // A hero that is out leaves the pick it was in.
  const out = open_position(HERO, 1_000, [mira], { activity: 'train', sent: null })
  const one = tab({ hero_ids: [HERO, SECOND] }, {}, { positions: [out] })
  expect(fight_spec(one.dapp, account_of(one)).hero_ids).toEqual([SECOND])
})

test('a city the hero is not in shows the walk, and one potion button when its kiosk holds the potion', () => {
  const potion = item_fixture('potion_of_the_ruins', 2, 'potion-1')
  const state = tab({ hero_ids: [HERO, SECOND], place: RUINS }, { items: [potion] })
  const html = quest(state)
  expect(html).toContain('data-arrival=""')
  expect(words(html)).toContain('Mira, Okami: walks there first. Each zone on the way costs a network fee.')
  expect(words(html)).toContain('Mira is not in The Ruins.')
  expect(words(html)).toMatch(/At least [\d,]+ minutes on foot\./)
  // The potion is in Mira's kiosk only: she alone may drink it. Walking never blocks the Start.
  expect(words(html)).toContain(`You hold 2 × ${item_name('potion_of_the_ruins')}. It takes the hero there at once.`)
  expect(tagged(html, 'data-potion')).toHaveLength(1)
  expect(tagged(html, 'data-potion')[0]).toContain(`data-potion="${HERO}"`)
  expect(button(html, 'Send Mira, Okami')).not.toContain('disabled')
  const drink = potion_input('p', mira, potion)
  expect(drink).toEqual({
    type: 'dapp/hero_direct',
    id: 'p',
    hero_id: HERO,
    action: 'use_consumable',
    payload: { character_id: HERO, item_id: 'potion-1', amount: 1 },
  })
  const asked = reduce_dapp(state.dapp, drink, account_of(state))
  expect(asked.direct).toMatchObject({ action: 'use_consumable', hero_id: HERO, item_type: 'potion_of_the_ruins' })
  // While that request is open, no second potion can be asked.
  expect(tagged(quest({ ...state, dapp: asked }), 'data-potion')[0]).toContain('disabled=""')

  // No potion held: the way to the market, and nothing to drink.
  const none = quest(tab({ hero_ids: [HERO], place: RUINS }))
  expect(tagged(none, 'data-potion')).toHaveLength(0)
  expect(words(none)).toContain(`A ${item_name('potion_of_the_ruins')} takes a hero there at once.`)
  expect(button(none, `Find ${item_name('potion_of_the_ruins')} on the market`)).toBeDefined()
  // A hero already in the chosen city walks nowhere.
  expect(quest(tab({ hero_ids: [HERO], place: THEBES }))).not.toContain('data-arrival')
})

test('a place card shows the level band and the key drop at its seed rate, and no price', () => {
  const html = quest(tab({ place: RUINS }))
  const ruins = quest_places('nauvis').find(({ key }) => key === 'city:the_ruins')!
  const band = place_levels(ruins.mob_types)!
  const [key] = key_drops(ruins.mob_types)
  const card = html.slice(html.indexOf('data-place="city:the_ruins"')).split('</article>')[0]!
  expect(card).toContain('data-selected="true"')
  expect(words(card)).toContain(`City · Monsters level ${band.min}–${band.max}`)
  expect(words(card)).toContain(
    `${item_name(key!.item_type)}: ~${key!.chance_bp / 100}% per kill from ${content_catalog.mob(key!.mob_type)!.mob.name}`
  )
  // One button per distinct monster opens its drops.
  expect(buttons(card)).toHaveLength(1 + new Set(ruins.mob_types).size)
  // Every city and biome with monsters has its card, after "where each hero stands".
  expect(html.match(/data-place="/g)).toHaveLength(1 + quest_places('nauvis').length)
  expect(html).toContain('data-place="biome:')
  expect(words(html)).toContain('Rarest drop: ')
  expect(button(html, text.place_all_drops!)).toBeDefined()
  expect(words(html)).not.toMatch(/≈|SUI \/ hour/)
  // The only SUI on the tab is the unit of the fee limit.
  expect(words(html).match(/SUI/g)).toHaveLength(1)

  // The band is above a level 1 hero: the plan says so, by name. Okami at level 7 reads no warning.
  const novice = character_fixture({ level: 1 })
  const low = quest(tab({ hero_ids: [HERO, SECOND], place: RUINS }, { characters: [novice, okami] }))
  expect(low.match(/data-level-warning=/g)).toHaveLength(1)
  expect(low).toContain(`data-level-warning="${HERO}"`)
  expect(words(low)).toContain(`Monsters here are level ${band.min}–${band.max}. Mira is level 1.`)
  expect(html).not.toContain('data-level-warning')
})

test('"What you need" lists what a recipe takes from the bag, with a market link and no purchase', () => {
  const flour: WorkPick = { mode: 'craft', item_type: 'wheat_flour', goal: { kind: 'amount', amount: 2 } }
  const farmer = worker({ FARMER: 1 })
  const state = work(flour, { characters: [farmer], items: [item_fixture('wheat', 3)] })
  const html = quest(state)
  // Level 1 succeeds on half of its tries: two flours take four tries on average.
  expect(words(html)).toContain(
    dapp_text(copy, 'work_tries', { tries: '4', amount: '2', item: item_name('wheat_flour') })
  )
  expect(words(html)).toContain('Mira succeeds on 50% of tries')
  expect(html).toContain('data-material="wheat" data-missing="5"')
  expect(words(html)).toContain(`${item_name('wheat')}: need 8, in your bag 3, missing 5`)
  expect(words(html)).toContain(`${item_name('water')}: need 4, in your bag 0, missing 4`)
  expect(button(html, `Find ${item_name('wheat')} on the market`)).toBeDefined()
  expect(words(html)).toContain(text.work_never_buys!)
  // Nothing here buys, and missing materials never block the start: the run waits for them.
  expect(words(html)).not.toMatch(/\bBuy now\b|≈/)
  expect(html).not.toContain('data-line="')
  expect(button(html, 'Start')).not.toContain('disabled')
  expect(work_spec(state.dapp, account_of(state))).toEqual({
    activity: 'gather',
    hero_ids: [HERO],
    work: flour,
    fee_cap_mist: null,
  })

  // A covered recipe says "ready" in its own words, and shows no market link.
  const stocked = quest(
    work(
      { ...flour, goal: UNTIL },
      { characters: [farmer], items: [item_fixture('wheat', 2), item_fixture('water', 1)] }
    )
  )
  expect(words(stocked)).toContain(`${item_name('wheat')}: need 2, in your bag 2`)
  expect(stocked).not.toContain('data-market-link')
  expect(words(stocked)).not.toContain(text.work_never_buys!)
  // A worn tool, and a held one the hero will equip.
  const hoe = { ...item_fixture('old_hoe', 1, 'hoe'), category: 'tool_farmer' }
  const held = quest(work({ mode: 'gather', item_type: 'wheat', goal: UNTIL }, { characters: [farmer], items: [hoe] }))
  expect(words(held)).toContain(`${item_name('old_hoe')} is in your bag. Mira equips it when work starts.`)
  expect(words(held)).toMatch(/Mira harvests \d+–\d+ every [\d.]+ s and earns \d+ profession experience each\./)
  expect(button(held, 'Start')).not.toContain('disabled')
})

test('work offers the pick of the bot, proposes the best worker, and reads the goal it will send', () => {
  // Nothing picked: the bot picks, with the strongest free hero.
  const auto = tab({ kind: 'work' })
  expect(work_worker(auto.dapp, account_of(auto))?.id).toBe(SECOND)
  const html = quest(auto)
  expect(pressed(html)).toContain('Let your bot pick')
  expect(words(html)).toContain(text.work_auto_body!)
  expect(words(html)).toContain(text.quest_until_stop!)
  expect(button(html, 'Start')).not.toContain('disabled')
  // One profession narrows the pick, and the best free hero of it is proposed.
  const miner = worker({ MINER: 30 })
  const narrowed = tab({ kind: 'work', work: { mode: 'auto', job: 'MINER' } }, { characters: [miner, okami] })
  expect(work_worker(narrowed.dapp, account_of(narrowed))?.id).toBe(HERO)
  expect(words(quest(narrowed))).toContain('Miner level 30')
  expect(quest(narrowed)).toContain('data-best-worker="">Mira · Miner level 30')
  expect(work_spec(narrowed.dapp, account_of(narrowed))).toEqual({
    activity: 'gather',
    hero_ids: [HERO],
    work: { mode: 'auto', job: 'MINER' },
    fee_cap_mist: null,
  })
  // A hero new to a profession reads so.
  expect(words(quest(work({ mode: 'gather', item_type: 'wheat', goal: UNTIL })))).toContain('New to Farmer')
  // An amount reads how many harvests it takes; a level goal shows its field.
  const hoe = { ...item_fixture('old_hoe', 1, 'hoe'), category: 'tool_farmer' }
  const ten = quest(
    work({ mode: 'gather', item_type: 'wheat', goal: { kind: 'amount', amount: 10 } }, { items: [hoe] })
  )
  expect(ten).toContain('data-objective="amount"')
  // The sentence is the shipped copy's; the number of harvests is the planner's average.
  const harvests = dapp_text(copy, 'work_harvests', { tries: '\\d+', amount: '10', item: item_name('wheat') })
  expect(words(ten)).toMatch(new RegExp(harvests))
  expect(ten).toContain('value="10"')
  const level = quest(
    work({ mode: 'gather', item_type: 'wheat', goal: { kind: 'job_level', level: 5 } }, { items: [hoe] })
  )
  expect(level).toContain('data-objective="job_level"')
  expect(pressed(level)).toContain('Reach a level')
  expect(button(level, 'Start')).not.toContain('disabled')
})

test('Start sends one start with the exact spec, one command per hero', () => {
  const state = tab({ hero_ids: [SECOND, HERO], place: RUINS, difficulty: 'hard', fee_cap_mist: '50000000' })
  const spec: StartSpec = {
    activity: 'train',
    hero_ids: [SECOND, HERO],
    place: RUINS,
    difficulty: 'hard',
    fee_cap_mist: '50000000',
  }
  expect(fight_spec(state.dapp, account_of(state))).toEqual(spec)
  const html = quest(state)
  expect(tagged(html, 'data-start')).toHaveLength(1)
  expect(button(html, 'Send Mira, Okami')).not.toContain('disabled')
  expect(html).toContain('value="0.05"')
  const input = start_input('s', spec, 'Fight in The Ruins')
  expect(input).toEqual({ type: 'dapp/start', id: 's', spec, title: 'Fight in The Ruins' })
  const started = reduce_dapp(state.dapp, input, account_of(state))
  expect(Object.values(started.commands).map(({ id, kind, status }) => [id, kind, status])).toEqual([
    [`s:${SECOND}`, 'start', 'pending'],
    [`s:${HERO}`, 'start', 'pending'],
  ])
  for (const command of Object.values(started.commands)) expect(command).toMatchObject({ spec })
  // Both heroes are now asked about: the tab proposes nobody else and offers nothing to send.
  const after = quest({ ...state, dapp: started })
  expect(button(after, 'Pick a hero')).toContain('disabled=""')
  expect(after).toContain(`data-line="idle">${text.blocker_no_free_hero}`)
})

test('"Out now" lists one run card per hero that is out on anything but a raid', () => {
  const position = (hero: string, activity: DappPosition['activity']): DappPosition => ({
    ...open_position(hero, 1_000, [mira, okami], { activity: activity ?? undefined, sent: null }),
    id: `p-${hero.slice(-1)}-${activity}`,
    activity,
  })
  const positions = [
    position(HERO, 'train'),
    position(SECOND, 'gather'),
    position(hero_id('3'), null),
    position(hero_id('4'), 'raid'),
    finish_position(position(hero_id('5'), 'train'), 2_000),
  ]
  expect(quest_runs(positions, true).map(({ activity }) => activity)).toEqual(['train', 'gather', null])
  expect(quest_runs(positions, false).map(({ hero_id: id }) => id)).toEqual([hero_id('5')])
  const html = quest(tab({}, {}, { positions }))
  const [out, finished] = html.slice(html.indexOf('data-quest-runs="out"')).split('data-quest-runs="finished"')
  expect(out).toContain(`<h2>${text.out_now_title}</h2>`)
  expect(out!.match(/data-run="/g)).toHaveLength(3)
  // A run that ended keeps its card, with its own way out: dismiss it. A raid shows on its own tab.
  expect(finished).toContain(`<h2>${text.position_finished}</h2>`)
  expect(finished!.match(/data-run="/g)).toHaveLength(1)
  expect(button(finished!, text.position_dismiss!)).toBeDefined()
  expect(html).not.toContain(`data-run="${hero_id('4')}"`)
  // Nobody out and nothing ended: no section.
  expect(quest(tab())).not.toContain('data-quest-runs')
})

test('an account with no hero is sent to Home, and a locked world says when it opens', () => {
  const empty = quest(tab({}, { characters: [] }))
  expect(empty).toContain('data-quest-empty=""')
  expect(words(empty)).toContain(text.quest_empty!)
  expect(button(empty, 'Go to Home')).toBeDefined()
  expect(empty).not.toContain('data-mode=')
  // Every world with monsters is open to a hero of its entry level: none is locked here.
  expect(quest(tab())).not.toContain('data-world-locked')
  expect(pressed(quest(tab()))).toContain('Nauvis')
})
