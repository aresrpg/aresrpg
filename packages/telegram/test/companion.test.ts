// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import worlds from '../../../seed/content/worlds.json'
import { initial_session, outcome, reduce_companion, type Session, type Step } from '../src/companion.ts'
import { load_copies } from '../src/copy.ts'
import type { Hero, View } from '../src/hosted.ts'
import { card, type Card } from '../src/transport.ts'
import { decode_update, type Input } from '../src/wire.ts'

import { MIRA, THOR, hero as row } from './helpers/connected_fixture.ts'

const copies = await load_copies()
const copy = copies('en')
const options = { copy, now: 1000, review_ttl_ms: 10000 }
const hero = (id: string, name: string, patch: Partial<Hero> = {}): Hero => ({
  id,
  name,
  usable: true,
  activity: 'idle',
  row: row(id, name),
  ...patch,
})
const view = (patch: Partial<View> = {}): View => ({
  binding: 'owner:bot:generation:grant',
  balance: '1 SUI',
  items: null,
  runs: {},
  roster: {
    heroes: [hero(MIRA, 'Mira_[link](evil)'), hero(THOR, 'Thor')],
    revisions: { decision_revision: 3, observation_revision: 4 },
  },
  ...patch,
})
const input: Input = { update_id: 1, sender: 42, locale: 'en', text: '/start' }
const reduce = (state: Session = initial_session(), text = '/menu', observed: View = view(), callback_id?: string) =>
  reduce_companion(state, { ...input, text, callback_id }, observed, options)
const shown = (step: Step): Card => {
  if (!('card' in step)) throw new Error(`no card: ${JSON.stringify(step)}`)
  return step.card
}
const refused = (step: Step) => ('refused' in step ? step.refused : null)
const plain = (step: Step) => shown(step).text.replaceAll('\\', '')
const data = (step: Step) =>
  shown(step)
    .reply_markup.inline_keyboard.flat()
    .map((button) => ('url' in button ? button.url : button.callback_data))
const labels = (step: Step) =>
  shown(step)
    .reply_markup.inline_keyboard.flat()
    .map((button) => button.text)
const pressed = (step: Step, prefix: string) => {
  const found = data(step).find((entry) => entry.startsWith(prefix))
  if (!found) throw new Error(`no ${prefix} button`)
  return reduce(step.session, found, view(), 'callback')
}

// Synthetic adversarial API envelopes, not a captured Telegram interaction or live platform certification.
const wire = (text = '/start') => ({
  update_id: 1,
  message: { from: { id: 42, is_bot: false }, chat: { id: 42, type: 'private' }, text },
})
describe('private ingress', () => {
  test('rejects group, wrong sender, edited and forwarded intent', () => {
    expect(decode_update(wire())?.sender).toBe(42)
    expect(decode_update({ ...wire(), message: { ...wire().message, chat: { id: 42, type: 'group' } } })).toBeNull()
    expect(decode_update({ ...wire(), message: { ...wire().message, from: { id: 43, is_bot: false } } })).toBeNull()
    expect(decode_update({ ...wire(), message: { ...wire().message, forward_origin: {} } })).toBeNull()
    expect(decode_update({ update_id: 1, edited_message: wire().message })).toBeNull()
    expect(decode_update({ ...wire(), update_id: -1 })).toBeNull()
  })
  test('every localized string is escaped for MarkdownV2 before it is sent', () => {
    const unescaped = /(?<!\\)[_*[\]()~`>#+\-=|{}.!]/
    for (const locale of ['de', 'fr', 'ru', 'zh']) {
      const { strategies: names, ...lines } = copies(locale)
      for (const line of [...Object.values(lines), ...Object.values(names)])
        expect(card(line).text).not.toMatch(unescaped)
    }
    expect(card('Google-Anmeldung (neu).').text).toBe('Google\\-Anmeldung \\(neu\\)\\.')
    expect(copies('unknown')).toEqual(copies('en'))
  })
})

describe('the one reducer of a sender', () => {
  test('an unknown roster and an empty one differ; neither offers anything to play', () => {
    expect(plain(reduce(initial_session(), '/menu', view({ roster: null })))).toBe(copy.loading)
    const empty = reduce(initial_session(), '/menu', view({ roster: { ...view().roster!, heroes: [] } }))
    expect(plain(empty)).toContain(copy.empty)
    expect(data(empty)).toEqual(['/status', '/inventory'])
  })
  test('select, Play, strategies; free text and typed commands only navigate', () => {
    const menu = reduce()
    expect(data(menu).filter((entry) => entry.startsWith('select:'))).toHaveLength(2)
    expect(data(menu).some((entry) => entry.startsWith('play:'))).toBe(false)
    const selected = pressed(menu, 'select:')
    expect(selected.session.character).toBe(MIRA)
    expect(shown(selected).text).toContain('Mira\\_\\[link\\]\\(evil\\)')
    const strategies = pressed(selected, 'play:')
    expect(plain(strategies)).toBe(`Mira_[link](evil)\n${copy.choose_strategy}`)
    expect(data(strategies).filter((entry) => entry.startsWith('strategy:'))).toHaveLength(2)
    // Free text never executes: it shows the menu, and the strategy buttons it replaced are stale.
    const typed = reduce(strategies.session, 'Buy everything')
    expect(plain(typed)).toContain(copy.menu)
    expect(refused(reduce(typed.session, data(strategies)[0]!, view(), 'callback'))).toBe('action_expired')
    // A review is approvable only as the very next update, and only from its own button.
    const review = pressed(strategies, 'strategy:')
    expect(review.session.review).not.toBeNull()
    expect(refused(reduce(review.session, `approve:${review.session.revision}`))).toBe('action_expired')
    expect(reduce(review.session, '/menu').session.review).toBeNull()
    const approved = pressed(review, 'approve:')
    expect('actions' in approved && approved.actions.map(({ type, subject }) => [type, subject])).toEqual([
      ['start', `Mira_[link](evil) · ${copy.strategies.fight_nearby}`],
    ])
    expect(approved.session.review).toBeNull()
  })
  test('stale buttons, another login, roster removal and reorder cannot select another hero', () => {
    const menu = reduce()
    const choice = data(menu)[0]!
    expect(refused(reduce(menu.session, choice))).toBe('action_expired')
    expect(refused(reduce({ ...menu.session, revision: 9 }, choice, view(), 'callback'))).toBe('action_expired')
    expect(refused(reduce(menu.session, choice, view({ binding: 'replacement' }), 'callback'))).toBe('action_expired')
    const reordered = view({
      roster: { ...view().roster!, heroes: [hero('0xother', 'Other'), ...view().roster!.heroes] },
    })
    expect(reduce(menu.session, choice, reordered, 'callback').session.character).toBe(MIRA)
    const selected = reduce(menu.session, choice, view(), 'callback')
    const gone = view({ roster: { ...view().roster!, heroes: [hero('0xother', 'Other')] } })
    expect(reduce(selected.session, '/play', gone).session.character).toBeNull()
    expect(refused(reduce(menu.session, choice, gone, 'callback'))).toBe('character_changed')
    // Another login starts over: nothing selected, nothing reviewable.
    expect(reduce(selected.session, '/menu', view({ binding: 'replacement' })).session.character).toBeNull()
  })
  test('the menu is the status: every run the wallet hosts by hero, and what each free hero is doing', () => {
    const observed = view({
      runs: {
        [MIRA]: { status: 'awaiting_ai', strategy: 'gather_craft' },
        [THOR]: { status: 'stopped', strategy: 'fight_nearby' },
        '0xgone': { status: 'active', strategy: null },
        '0xodd': { status: 'future_state', strategy: 'team_hunt' },
      },
      roster: {
        ...view().roster!,
        heroes: [
          hero(MIRA, 'Mira'),
          hero(THOR, 'Thor', { activity: 'fight' }),
          hero('0xambushed', 'Farmer', { activity: 'ambush' }),
          hero('0xdungeon', 'Delver', { activity: 'observation_unknown', usable: false }),
        ],
      },
    })
    const menu = reduce(initial_session(), '/status', observed)
    expect(plain(menu).split('\n')).toEqual([
      `${copy.balance}: 1 SUI`,
      `Mira · ${copy.strategies.gather_craft} · ${copy.attention}`,
      `Thor · ${copy.strategies.fight_nearby} · ${copy.stopped}`,
      `${copy.observation_unknown} · ${copy.external_strategy} · ${copy.strategy_active}`,
      `${copy.observation_unknown} · ${copy.external_strategy} · ${copy.observation_unknown}`,
      copy.menu,
    ])
    // The bot's state word never reaches the player.
    expect(plain(menu)).not.toContain('awaiting_ai')
    expect(labels(menu).slice(0, 4)).toEqual([
      'Mira',
      `Thor · ${copy.fight}`,
      `Farmer · ${copy.ambush}`,
      `Delver · ${copy.observation_unknown}`,
    ])
    expect(data(menu)).toContain('/stop')
    // A hero that cannot take a strategy has no Play.
    const delver = reduce(menu.session, data(menu)[3]!, observed, 'callback')
    expect(data(delver).some((entry) => entry.startsWith('play:'))).toBe(false)
    expect(plain(reduce(initial_session(), '/menu', view({ balance: null })))).toContain(
      `${copy.balance}: ${copy.observation_unknown}\n${copy.no_strategy}`
    )
  })
  test('a run is named by its catalogue entry; any other run gets one generic label and can still be stopped', () => {
    const line = (strategy: string | null) =>
      plain(reduce(initial_session(), '/status', view({ runs: { [MIRA]: { status: 'active', strategy } } }))).split(
        '\n'
      )[1]
    for (const offered of ['fight_nearby', 'gather_craft'])
      expect(line(offered)).toBe(`Mira_[link](evil) · ${copy.strategies[offered]} · ${copy.strategy_active}`)
    // An authored tree, or an entry Telegram does not offer: started from another client, never hidden.
    for (const other of [null, 'team_hunt', 'dungeon_raid', 'basic_archer', 'constructor', '__proto__'])
      expect(line(other)).toBe(`Mira_[link](evil) · ${copy.external_strategy} · ${copy.strategy_active}`)
    const observed = view({ runs: { [THOR]: { status: 'active', strategy: 'team_hunt' } } })
    const choice = reduce(initial_session(), '/stop', observed)
    expect(labels(choice)[0]).toBe('Thor')
    // The choice is confirmed on its own card before anything is sent.
    const asked = reduce(choice.session, data(choice)[0]!, observed, 'callback')
    expect('actions' in asked).toBe(false)
    const stopped = reduce(asked.session, data(asked)[0]!, observed, 'callback')
    expect('actions' in stopped && stopped.actions).toEqual([{ type: 'stop', character: THOR, subject: 'Thor' }])
  })
  test('approval is refused when the hero left the reviewed area, even for another city', () => {
    const ruins = worlds.find(({ world }) => world === 'nauvis')!.cities.find(({ city }) => city === 'the_ruins')!
    const selected = { ...initial_session(), binding: view().binding, character: MIRA }
    const strategies = reduce(selected, '/play')
    const patrol = data(strategies).find((entry) => entry.endsWith(':fight_nearby'))!
    const review = reduce(strategies.session, patrol, view(), 'callback')
    expect(plain(review)).toContain(copy.city_review.replace('{city}', 'thebes'))
    const approval = `approve:${review.session.revision}`
    const moved = [hero(MIRA, 'Mira', { row: { ...row(MIRA, 'Mira'), x: ruins.x, z: ruins.z } }), hero(THOR, 'Thor')]
    const elsewhere = view({ roster: { ...view().roster!, heroes: moved } })
    expect(refused(reduce(review.session, approval, elsewhere, 'callback'))).toBe('review_changed')
    // Another client started this hero meanwhile: the card reviewed a start, not a replacement.
    const overtaken = view({ runs: { [MIRA]: { status: 'active', strategy: null } } })
    expect(refused(reduce(review.session, approval, overtaken, 'callback'))).toBe('review_changed')
    expect('actions' in reduce(review.session, approval, view(), 'callback')).toBe(true)
  })
  test('a patrol binds the city the hero stands in; a held or unplaced hero is refused by its reason', () => {
    const review = (heroes: readonly Hero[], strategy: string) => {
      const observed = view({ roster: { ...view().roster!, heroes } })
      const strategies = reduce({ ...initial_session(), binding: observed.binding, character: MIRA }, '/play', observed)
      const choice = data(strategies).find((entry) => entry.endsWith(`:${strategy}`))!
      return reduce(strategies.session, choice, observed, 'callback')
    }
    const ambushed = [hero(MIRA, 'Mira', { row: { ...row(MIRA, 'Mira'), ambush: { id: 'protector' } } })]
    expect(refused(review(ambushed, 'fight_nearby'))).toBe('character_changed')
    expect(plain(review(ambushed, 'gather_craft'))).toContain(copy.world_review.replace('{world}', 'nauvis'))
    const outside = [hero(MIRA, 'Mira', { row: { ...row(MIRA, 'Mira'), x: 0, z: 0 } })]
    expect(refused(review(outside, 'fight_nearby'))).toBe('city_required')
    const elsewhere = [hero(MIRA, 'Mira', { row: { ...row(MIRA, 'Mira'), checkpoint_world: 'other' } })]
    expect(refused(review(elsewhere, 'gather_craft'))).toBe('observation_unknown')
    expect(plain(review(view().roster!.heroes, 'fight_nearby'))).toContain(copy.city_review.replace('{city}', 'thebes'))
    const strategies = reduce({ ...initial_session(), binding: view().binding, character: MIRA }, '/play')
    const forged = `strategy:${strategies.session.revision}:dungeon_raid`
    expect(refused(reduce(strategies.session, forged, view(), 'callback'))).toBe('unknown_strategy')
  })
  test('inventory distinguishes unknown and empty; labels are escaped and every item is paged within the Telegram limit', () => {
    expect(plain(reduce(initial_session(), '/inventory'))).toBe(`${copy.inventory} · ${copy.observation_unknown}`)
    expect(plain(reduce(initial_session(), '/inventory', view({ items: [] })))).toBe(
      `${copy.inventory} · ${copy.inventory_empty}`
    )
    const items = Array.from({ length: 300 }, (_, index) => ({
      id: `id${index}`,
      name: `Wheat_[${index}] ${'x'.repeat(20)}`,
      item_type: 'wheat',
      amount: index + 1,
    }))
    const full = view({ items })
    const pages = (text: string, count = 0): number => {
      const page = reduce(initial_session(), text, full)
      expect(plain(page).length).toBeLessThanOrEqual(4096)
      const seen =
        count +
        plain(page)
          .split('\n')
          .filter((line) => line.startsWith('Wheat_')).length
      const next = data(page).find((entry, index) => labels(page)[index] === '→')
      return next ? pages(next, seen) : seen
    }
    expect(pages('/inventory')).toBe(items.length)
    expect(shown(reduce(initial_session(), '/inventory', full)).text).toContain('Wheat\\_\\[0\\]')
    expect(refused(reduce(initial_session(), 'inventory:99', full))).toBe('inventory_page_expired')
  })
  test('only the bot’s own confirmation is reported as done', () => {
    const stop = { type: 'stop', character: MIRA, subject: 'Mira' } as const
    expect(outcome(stop, { ok: true, value: { status: 'stopped' } }, copy)).toEqual({
      ok: true,
      value: `Mira · ${copy.stopped}`,
    })
    expect(outcome(stop, { ok: true, value: { status: 'active' } }, copy)).toEqual({
      ok: false,
      error: 'control_unconfirmed',
    })
    expect(outcome(stop, { ok: false, error: 'uncertain' }, copy)).toEqual({ ok: false, error: 'uncertain' })
    const pause = { type: 'pause', subject: '' } as const
    expect(outcome(pause, { ok: true, value: { paused: true } }, copy)).toEqual({ ok: true, value: copy.paused })
    expect(outcome(pause, { ok: true, value: {} }, copy)).toEqual({ ok: false, error: 'control_unconfirmed' })
  })
})
