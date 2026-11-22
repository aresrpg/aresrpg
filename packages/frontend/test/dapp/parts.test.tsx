// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The parts every dapp tab shares: what each one says for a given reducer state, and what it never says.
import { expect, spyOn, test } from 'bun:test'
import { RUN_ENDINGS, type ItemRow } from '@aresrpg/protocol'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as zustand from 'zustand'

import { content_catalog } from '../../src/content/catalog.ts'
import { DappBagFeed } from '../../src/dapp/DappBag.tsx'
import { DappDropsSheet } from '../../src/dapp/DappDropsSheet.tsx'
import { DappHeroCard } from '../../src/dapp/DappHeroCard.tsx'
import { DappHeroPicker, toggled_heroes } from '../../src/dapp/DappHeroPicker.tsx'
import { DappItemSheet } from '../../src/dapp/DappItemSheet.tsx'
import { DappMarketLink, open_market } from '../../src/dapp/DappMarketLink.tsx'
import { DappNotices } from '../../src/dapp/DappNotices.tsx'
import { DappRunCard, RUN_DROPS_SHOWN } from '../../src/dapp/DappRunCard.tsx'
import type { DappAccount } from '../../src/dapp/account.ts'
import { dapp_text, item_name } from '../../src/dapp/copy.ts'
import type { DirectRequest } from '../../src/dapp/direct.ts'
import { finish_position, open_position, sync_positions, type DappPosition } from '../../src/dapp/positions.ts'
import type { DappCommand, DappState } from '../../src/dapp/state.ts'
import type { StartSpec } from '../../src/dapp/strategies.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'
import type { MarketFloor } from '../../src/marketplace/floor_state.ts'
import { initial_app_state, initialize_app_store, read_app_state, type AppState } from '../../src/store.ts'

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
const mira = character_fixture()
const okami = character_fixture({ id: SECOND, name: 'Okami', classe: 'senshi', level: 7 })
const base = initial_app_state({} as AppState['settings'])
/** A page linked to its bot: what the bot said (`dapp`) and what the game server pushed (`account`). */
const linked = (dapp: Partial<DappState> = {}, account: Partial<DappAccount> = {}): AppState => ({
  ...base,
  copy,
  session: { ...base.session, agent_inventory: { ...account_fixture({ characters: [mira, okami] }), ...account } },
  dapp: { ...base.dapp, link: { phase: 'connected' }, ...dapp },
})
const answered = (dapp: Partial<DappState> = {}, account: Partial<DappAccount> = {}): AppState =>
  linked({ observation: observation_fixture(), ...dapp }, account)
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
/** What a player reads: the markup without its tags and attributes. */
const words = (html: string): string => html.replace(/<[^>]*>/g, ' ')
const escaped = (value: string): string => value.replaceAll("'", '&#x27;')
const buttons = (html: string): readonly string[] => html.match(/<button[^>]*>.*?<\/button>/gs) ?? []
const button = (html: string, label: string): string | undefined =>
  buttons(html).find((markup) => words(markup).includes(label))

const [lorito] = content_catalog.dungeons
const SPEC: StartSpec = { activity: 'train', hero_ids: [HERO], place: null, difficulty: null, fee_cap_mist: null }
const running = (overrides: Partial<DappPosition> = {}): DappPosition => ({
  ...open_position(HERO, 1_000, [mira], { activity: 'train', sent: SPEC }),
  ...overrides,
})
/** The position this page opens for a run the bot reports, through the reducer's own fold. */
const observed = (status: string, issue: string): DappPosition =>
  sync_positions([], observation_fixture({ runs: [run_fixture(HERO, status, issue)] }), [mira], 1_000)[0]!
const card = (position: DappPosition, dapp: Partial<DappState> = {}): string =>
  render(<DappRunCard copy={copy} locale="en" position={position} />, answered({ positions: [position], ...dapp }))

test('a hero card claims no status until the bot answered', () => {
  const hero = <DappHeroCard copy={copy} hero={mira} actions={<button type="button">Send</button>} />
  const before = render(hero, linked())
  expect(before).toContain('Mira')
  expect(before).toContain('Level 3')
  expect(before).toContain(`Yogan · ${copy.simulator_page.class_yogan_title}`)
  // Both meters stand in one group, so their bars share one column.
  const meters = before.slice(before.indexOf('<div class="dapp-hero-meters">'), before.indexOf('</footer>'))
  expect(meters.match(/<progress/g)).toHaveLength(2)
  expect(meters).toContain(text.hero_xp)
  expect(meters).toContain(text.position_hp)
  // The slot is the caller's: the card draws it and decides nothing about it.
  expect(before).toContain('<button type="button">Send</button>')
  expect(before).not.toContain('dapp-hero-state')
  expect(before).not.toContain(text.status_free)
  // The portrait is a picture: nothing of this page mounts a canvas.
  expect(before).toContain('<img class="dapp-portrait"')
  expect(before).not.toContain('<canvas')

  const after = render(hero, answered())
  expect(words(after)).toContain(text.status_free)
  const out = render(hero, answered({ positions: [running()] }))
  expect(words(out)).toContain(text.status_activity)
  expect(out).toContain('data-tone="live"')
})

test('the compact hero card is one row: no meters', () => {
  const row = render(<DappHeroCard copy={copy} hero={mira} compact />, answered())
  expect(row).toContain('data-compact="true"')
  expect(row).not.toContain('<progress')
  expect(row).not.toContain('dapp-hero-meters')
  expect(words(row)).toContain(text.status_free)
})

test('a hero picker keeps the picked order and disables a busy hero with what it does', () => {
  expect(toggled_heroes([HERO], SECOND, true)).toEqual([HERO, SECOND])
  expect(toggled_heroes([HERO, SECOND], HERO, true)).toEqual([SECOND])
  expect(toggled_heroes([HERO], SECOND, false)).toEqual([SECOND])
  expect(toggled_heroes([HERO], HERO, false)).toEqual([HERO])

  const picker = (
    <DappHeroPicker
      copy={copy}
      label="Who goes"
      heroes={[mira, okami]}
      selected={[HERO, SECOND]}
      multiple
      on_change={() => undefined}
    />
  )
  const html = render(picker, answered({ positions: [running()] }))
  expect(html).toContain('role="group" aria-label="Who goes"')
  const [busy, free] = buttons(html)
  // Mira is out: she cannot be picked, and the row says why instead of her level.
  expect(busy).toContain('disabled=""')
  expect(busy).toContain('aria-pressed="false"')
  expect(words(busy!)).toContain(text.status_activity)
  expect(words(busy!)).toContain('Level 3')
  expect(free).not.toContain('disabled')
  expect(free).toContain('aria-pressed="true"')
  expect(words(free!)).toContain('Level 7')
})

test('a picker that only chooses whom to look at keeps a busy hero selectable, with its status', () => {
  const picker = (
    <DappHeroPicker
      copy={copy}
      label="Who to look at"
      heroes={[mira, okami]}
      selected={[HERO]}
      busy_selectable={() => true}
      on_change={() => undefined}
    />
  )
  const [busy, free] = buttons(render(picker, answered({ positions: [running()] })))
  expect(busy).not.toContain('disabled')
  expect(busy).toContain('aria-pressed="true"')
  expect(busy).toContain('data-status="activity"')
  expect(words(busy!)).toContain(text.status_activity)
  expect(words(busy!)).toContain('Level 3')
  expect(free).not.toContain('disabled')
  expect(free).toContain('aria-pressed="false"')
})

test('a run card says why a run waits and what a blocked one needs, never the code of the bot', () => {
  const walking = card(observed('waiting', 'travel_not_ready:zone_12'))
  expect(words(walking)).toContain(text.run_waiting)
  expect(walking).toContain(`role="status">${text.run_wait_travel}`)
  expect(words(walking)).not.toContain('travel_not_ready')

  const idle = card(observed('waiting', 'cooldown_not_elapsed'))
  expect(idle).toContain(`role="status">${text.run_wait_other}`)
  expect(words(idle)).not.toContain('cooldown_not_elapsed')

  const broke = card(observed('waiting', 'funding_required'))
  expect(words(broke)).toContain(text.run_needs_help)
  expect(broke).toContain(`data-tone="alert" role="status">${text.run_notice_funding}`)
  expect(words(broke)).not.toContain('funding_required')
  // The code stays where diagnostics read it.
  expect(broke).toContain('data-issue="funding_required"')

  const lost = card(observed('waiting', 'area_unreachable'))
  expect(lost).toContain(text.run_notice_place)
  expect(words(lost)).not.toContain('area_unreachable')

  // A run that plays says so and gives no reason.
  const playing = card(running())
  expect(words(playing)).toContain(text.position_running)
  expect(playing).not.toContain('role="status"')
  // Every key the card read had copy: a missing key would print itself.
  for (const html of [walking, idle, broke, lost, playing]) expect(words(html)).not.toMatch(/\b(run|position)_[a-z_]+/)
})

test('a finished card says why its run ended by itself, in one sentence under a plain Finished', () => {
  const plain = card(finish_position(running(), 61_000))
  expect(words(plain)).toContain(text.position_finished)
  expect(plain).not.toContain('role="status"')
  const sentences = RUN_ENDINGS.map((ending) => {
    const sentence = dapp_text(copy, `run_ended_${ending}`)
    const html = card(finish_position(running(), 61_000, ending))
    expect(words(html)).toContain(text.position_finished)
    // It is an ordinary end, never an alert.
    expect(html).toContain(`<p class="dapp-run-line" role="status">${escaped(sentence)}</p>`)
    return sentence
  })
  expect(new Set(sentences).size).toBe(RUN_ENDINGS.length)
  // A run that ended by itself is explained by its ending, whatever help it last asked for.
  const helped = card({ ...finish_position(running(), 61_000, 'fee_cap_reached'), notice: 'funding' })
  expect(helped).toContain(escaped(dapp_text(copy, 'run_ended_fee_cap_reached')))
  expect(helped).not.toContain(escaped(text.position_ended_issue!))
  // A blocked run the player stopped keeps the sentence of a stopped activity.
  const blocked = card({ ...finish_position(running(), 61_000), notice: 'funding' })
  expect(blocked).toContain(escaped(text.position_ended_issue!))
})

test('Stop is disabled while a command of that hero is open', () => {
  const position = running()
  const free = button(card(position), text.position_stop!)
  expect(free).toBeDefined()
  expect(free).not.toContain('disabled')

  const stop: DappCommand = { kind: 'stop', id: 'c1', hero_id: HERO, status: 'pending', error: null }
  const stopping = card(position, { commands: { [HERO]: stop } })
  expect(button(stopping, text.position_stop!)).toContain('disabled=""')
  expect(button(stopping, text.position_stop!)).toContain('aria-busy="true"')
  expect(words(stopping)).toContain(text.position_stopping)

  // An answer that is still unknown keeps it disabled: nothing is asked twice.
  const unknown = card(position, { commands: { [HERO]: { ...stop, status: 'uncertain' } } })
  expect(button(unknown, text.position_stop!)).toContain('disabled=""')
  // A start whose answer was lost, with its run already visible: no second command until it resolves.
  const start = { kind: 'start', id: 'c0', hero_id: HERO, status: 'uncertain', error: null, spec: SPEC } as DappCommand
  const starting = button(card(position, { commands: { [HERO]: start } }), text.position_stop!)
  expect(starting).toContain('disabled=""')
  expect(starting).not.toContain('aria-busy')
  // A refused command is only a message: the hero can be stopped again.
  const refused = card(position, { commands: { [HERO]: { ...stop, status: 'refused', error: 'unavailable' } } })
  expect(button(refused, text.position_stop!)).not.toContain('disabled')
})

test('Send again shows only on a finished card that kept what was sent', () => {
  const finished = finish_position(running(), 61_000)
  const kept = card(finished)
  expect(button(kept, text.position_dismiss!)).toBeDefined()
  expect(button(kept, text.run_send_again)).toBeDefined()
  expect(button(kept, text.run_send_again)).not.toContain('disabled')
  expect(button(kept, text.position_stop!)).toBeUndefined()
  expect(words(kept)).toContain(text.position_finished)
  // One minute out, in the locale's own unit.
  expect(words(kept)).toContain('1 min')

  // A run this page only found in an observation has no spec to send again.
  const found = card({ ...finished, sent: null })
  expect(button(found, text.position_dismiss!)).toBeDefined()
  expect(button(found, text.run_send_again)).toBeUndefined()
  // A running card never offers it.
  expect(button(card(running()), text.run_send_again)).toBeUndefined()

  // The hero is out again: the same start cannot be sent over its run.
  const again = render(
    <DappRunCard copy={copy} locale="en" position={finished} />,
    answered({ positions: [running({ id: 'next' }), finished] })
  )
  expect(button(again, text.run_send_again)).toContain('disabled=""')
  // Before the bot answers, nothing can be sent.
  const early = render(<DappRunCard copy={copy} locale="en" position={finished} />, linked({ positions: [finished] }))
  expect(button(early, text.run_send_again)).toContain('disabled=""')

  // A raid whose team is now short of keys is not sent from a card: the Raid tab confirms that case.
  const { dungeon, key } = lorito!
  const raid_spec: StartSpec = { activity: 'raid', dungeon, hero_ids: [HERO, SECOND], runs: null, fee_cap_mist: null }
  const raid = finish_position(running({ activity: 'raid', sent: raid_spec }), 61_000)
  const keys = (count: number) => account_fixture({ characters: [mira, okami], items: [item_fixture(key, count)] })
  const raid_card = (count: number) =>
    render(<DappRunCard copy={copy} locale="en" position={raid} />, answered({ positions: [raid] }, keys(count)))
  expect(button(raid_card(1), text.run_send_again)).toBeUndefined()
  expect(button(raid_card(1), text.position_dismiss!)).toBeDefined()
  expect(button(raid_card(2), text.run_send_again)).not.toContain('disabled')
})

test('Sell and Sell loot open the Market tab on its Sell panel; a plain visit opens it on Buy', () => {
  initialize_app_store({ quality: 'medium', music_enabled: false, render_distance: null })
  open_market('SELL')
  expect(read_app_state().dapp).toMatchObject({ tab: 'market', market_panel: 'SELL' })
  open_market()
  expect(read_app_state().dapp).toMatchObject({ tab: 'market', market_panel: 'BUY' })
})

test('a run card shows the objective, what was won, the fees and the latest drops, all measured', () => {
  const drop = (fight: number) => ({
    fight: `fight-${fight}`,
    won: true,
    room: null,
    drops: [
      { item_type: 'key_of_gilded_lorito', qty: fight },
      { item_type: `loot_${fight}`, qty: 2 },
    ],
  })
  const position = running({
    activity: 'raid',
    objective: 'Raid the Gilded Lorito',
    fees_mist: 12_345_678n,
    dungeon_runs: 2,
    totals: { xp: 1_500n, levels: 1, job_xp: 0n, fights: ['a', 'b', 'c', 'd', 'e'], won: ['a', 'b', 'c'], lost: ['d'] },
    results: [1, 2, 3, 4].map(drop),
  })
  const html = card(position)
  const read = words(html)
  expect(read).toContain('Objective: Raid the Gilded Lorito')
  expect(read).toContain('+1,500')
  expect(read).toContain(text.position_levels!.replace('{count}', '1'))
  expect(read).toContain('Won 3 · lost 1')
  expect(html).toContain(`<dt>${text.run_dungeon_runs}</dt><dd>2</dd>`)
  expect(html).toContain('data-run-fees="">Fees paid: 0.012 SUI</p>')
  // The newest fight comes first, and the card lists a bounded number of rows.
  const rows = buttons(html).filter((markup) => markup.includes('dapp-row'))
  expect(rows).toHaveLength(RUN_DROPS_SHOWN)
  expect(words(rows[0]!)).toContain(item_name('key_of_gilded_lorito'))
  expect(words(rows[0]!)).toContain('×4')
  expect(button(html, text.sell_loot)).toBeDefined()
  // No estimate and no price leaves the Market tab.
  expect(read).not.toContain('≈')

  // A bot that reports no fee and a run that saw no dungeon say nothing about either.
  const plain = card(running())
  expect(plain).not.toContain('data-run-fees')
  expect(plain).not.toContain(text.run_dungeon_runs)
  expect(words(plain)).toContain(text.run_drops_empty)
  expect(button(plain, text.sell_loot)).toBeUndefined()
  // A finished run that dropped nothing has no drops block.
  expect(card(finish_position(running(), 2_000))).not.toContain('dapp-run-drops')
})

test('the market link shows no price and falls back to "nobody sells"', () => {
  const { key } = content_catalog.dungeons[0]!
  const name = item_name(key)
  const link = (floor: MarketFloor | null): string =>
    render(<DappMarketLink copy={copy} item_type={key} />, {
      ...answered(),
      marketplace: { ...base.marketplace, floor },
    })
  // Before the floor is read, and when someone sells: the way to the listing, without its price.
  const unread = link(null)
  expect(button(unread, `Find ${name} on the market`)).toBeDefined()
  const priced = link({ item_type: key, request_id: 1, status: 'ready', prices: { '1': '5000000000' } })
  expect(button(priced, `Find ${name} on the market`)).toBeDefined()
  expect(priced).not.toContain('5000000000')
  expect(words(priced)).not.toMatch(/SUI|\d/)

  const unsold = link({ item_type: key, request_id: 1, status: 'ready', prices: {} })
  expect(buttons(unsold)).toHaveLength(0)
  expect(words(unsold)).toContain(`Nobody is selling ${name} right now.`)
  // A floor read for another item, a pending one or a failed one says nothing about this item.
  expect(buttons(link({ item_type: 'other', request_id: 1, status: 'ready', prices: {} }))).toHaveLength(1)
  expect(buttons(link({ item_type: key, request_id: 1, status: 'loading', prices: {} }))).toHaveLength(1)
  expect(buttons(link({ item_type: key, request_id: 1, status: 'unavailable', prices: {} }))).toHaveLength(1)
  // An item the market has no shelf for can only be unsold.
  const shelfless = render(<DappMarketLink copy={copy} item_type="not_an_item" />, answered())
  expect(buttons(shelfless)).toHaveLength(0)
})

const HAT: ItemRow = {
  id: 'hat-1',
  name: 'Hat',
  item_type: 'hat',
  category: 'hat',
  level: 10,
  amount: 1,
  kiosk: '0xkiosk',
  // Raw centred rolls: +11 strength and −4 wisdom.
  stats: { strength: 32779, wisdom: 32764 },
}

test('the item sheet of an owned row shows its rolled stats', () => {
  const owned = render(
    <DappItemSheet copy={copy} subject={{ kind: 'owned', item: HAT }} close={() => undefined} />,
    answered({}, { inventory: [HAT] })
  )
  expect(owned).toContain('data-item-sheet="owned"')
  expect(owned).toContain('data-owned-item-id="hat-1"')
  expect(owned).toContain('data-item-stat="strength"')
  expect(owned).toContain('data-item-stat="wisdom"')
  const strength = owned.slice(owned.indexOf('data-item-stat="strength"')).slice(0, 600)
  expect(words(strength)).toContain('11')
  // One exact value, never the range of the item type.
  expect(words(strength)).not.toContain(copy.encyclopedia_page.range_to as string)
  // The bag holds it: Sell leads to the Market tab.
  expect(button(owned, text.item_sell)).toBeDefined()

  // The same item seen elsewhere, with an empty bag, offers no sale.
  const elsewhere = render(
    <DappItemSheet copy={copy} subject={{ kind: 'owned', item: HAT }} close={() => undefined} />,
    answered()
  )
  expect(button(elsewhere, text.item_sell)).toBeUndefined()
})

test('the item sheet of an item type shows what the seed authors, and its market link', () => {
  const { key } = content_catalog.dungeons[0]!
  const html = render(
    <DappItemSheet copy={copy} subject={{ kind: 'type', item_type: key }} close={() => undefined} />,
    answered()
  )
  expect(html).toContain('data-item-sheet="type"')
  expect(html).toContain(item_name(key))
  expect(html).not.toContain('data-owned-item-id')
  expect(button(html, `Find ${item_name(key)} on the market`)).toBeDefined()
  expect(button(html, text.item_sell)).toBeUndefined()
})

test('the drops sheet reads a dungeon room by room and a place monster by monster, at the seed rate', () => {
  const dungeon = content_catalog.dungeons[0]!
  const sheet = render(
    <DappDropsSheet
      copy={copy}
      locale="en"
      subject={{ kind: 'dungeon', dungeon: dungeon.dungeon }}
      close={() => undefined}
    />,
    answered()
  )
  expect(sheet).toContain('data-drops-sheet="dungeon"')
  expect(words(sheet)).toContain('Every drop in Gilded Lorito')
  expect(sheet.match(/data-room=/g)).toHaveLength(dungeon.rooms.length)
  expect(words(sheet)).toContain('Room 1')
  expect(sheet.match(/Boss room/g)).toHaveLength(1)
  const boss = content_catalog.mob(dungeon.rooms.at(-1)![0]!.mob_type)!
  expect(words(sheet)).toContain(boss.mob.name)
  expect(words(sheet)).toMatch(/~[\d.]+% per kill/)
  expect(words(sheet)).not.toMatch(/SUI|≈/)

  const mob = content_catalog.mobs.find(({ loot }) => loot.length > 0)!
  const place = render(
    <DappDropsSheet
      copy={copy}
      locale="en"
      subject={{ kind: 'place', place: 'crimson_canopy', mob_types: [mob.mob_type, mob.mob_type, 'not_a_mob'] }}
      close={() => undefined}
    />,
    answered()
  )
  expect(words(place)).toContain('Everything that drops in Crimson Canopy')
  // A monster named twice shows once; one the seed does not know shows nothing.
  expect(place.match(/data-mob=/g)).toHaveLength(1)
  expect(place.match(/dapp-row"/g)).toHaveLength(mob.loot.length)
  expect(words(place)).toContain(item_name(mob.loot[0]!.item_type))

  // One monster is the game's own monster window.
  const monster = render(
    <DappDropsSheet
      copy={copy}
      locale="en"
      subject={{ kind: 'monster', mob_type: mob.mob_type }}
      close={() => undefined}
    />,
    answered()
  )
  expect(monster).toContain(mob.name)
  expect(monster).toContain('aui-mob-loot')
})

const request = (overrides: Partial<DirectRequest>): DirectRequest => ({
  id: 'd1',
  action: 'market_buy',
  hero_id: null,
  payload: {},
  item_type: 'key_of_gilded_lorito',
  amount: 2,
  after: null,
  proof: null,
  status: 'pending',
  error: null,
  ...overrides,
})
const notices = (dapp: Partial<DappState>): string => render(<DappNotices copy={copy} />, answered(dapp))

test('the notices follow the one direct request to its end and never show a code', () => {
  expect(notices({})).toBe('')

  const pending = notices({ direct: request({ status: 'pending' }) })
  expect(pending).toContain('data-direct="pending"')
  expect(pending).toContain(text.blocker_command_pending)
  expect(buttons(pending)).toHaveLength(0)
  const queued = notices({ direct: request({ status: 'accepted' }) })
  expect(queued).toContain(text.direct_queued)
  expect(buttons(queued)).toHaveLength(0)

  const done = notices({ direct: request({ status: 'done' }) })
  expect(done).toContain('role="status" data-direct="done"')
  expect(done).toContain(escaped(`Bought: 2 × ${item_name('key_of_gilded_lorito')}. It is in your heroes' bag.`))
  expect(button(done, text.position_dismiss!)).toBeDefined()

  const refused = notices({ direct: request({ status: 'refused', error: 'insufficient_funds' }) })
  expect(refused).toContain('role="alert" data-direct="refused"')
  expect(refused).toContain(text.error_insufficient_funds)
  expect(button(refused, text.position_dismiss!)).toBeDefined()
  // A code the page has no sentence for becomes the plain fallback.
  const strange = notices({ direct: request({ status: 'refused', error: 'kiosk_cap_mismatch' }) })
  expect(strange).toContain(text.error_unknown)
  expect(strange).not.toContain('kiosk_cap_mismatch')
})

test('refused starts name their heroes once per reason, and one notice covers every unknown answer', () => {
  const command = (hero: string, overrides: Partial<DappCommand>): DappCommand =>
    ({ kind: 'stop', id: `c:${hero}`, hero_id: hero, status: 'refused', error: null, ...overrides }) as DappCommand
  const refused = notices({
    commands: {
      [HERO]: command(HERO, { error: 'run_limit_reached' }),
      [SECOND]: command(SECOND, { error: 'run_limit_reached' }),
    },
  })
  expect(refused.match(/role="alert"/g)).toHaveLength(1)
  expect(refused).toContain(`Mira, Okami: ${text.error_run_limit_reached}`)
  expect(refused).not.toContain('run_limit_reached')

  const unknown = notices({
    commands: { [HERO]: command(HERO, { status: 'uncertain' }) },
    direct: request({ status: 'uncertain' }),
  })
  expect(unknown.split(escaped(text.command_uncertain!)).length - 1).toBe(1)
  expect(buttons(unknown)).toHaveLength(0)
})

test('the feed is one row per kind gained, newest first, each the shared item row; empty, it says so', () => {
  const feed = (gains: DappState['bag_feed']['gains']): string =>
    render(<DappBagFeed copy={copy} />, answered({ bag_feed: { seen: {}, gains, rows: null } }))
  const empty = feed([])
  expect(empty).toContain(`<aside class="dapp-bag-feed-panel" aria-label="${text.bag_feed_title}">`)
  expect(words(empty)).toContain(text.bag_feed_empty)
  expect(empty).not.toContain('<ul')

  const rows = feed([
    { item_type: lorito!.key, amount: 1 },
    { item_type: 'wheat', amount: 12 },
  ]).match(/<li data-gain=.*?<\/li>/gs)
  expect(rows?.map((row) => words(row).replace(/\s+/g, ' ').trim())).toEqual([
    `${item_name(lorito!.key)} +1`,
    `${item_name('wheat')} +12`,
  ])
  expect(rows?.[0]).toContain(`<button data-item-row="${lorito!.key}"`)
  expect(words(rows!.join(''))).not.toContain(text.bag_feed_empty)
})
