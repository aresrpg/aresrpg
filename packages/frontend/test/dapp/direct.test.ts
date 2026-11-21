// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { ListingRow } from '@aresrpg/protocol'

import type { DappAccount } from '../../src/dapp/account.ts'
import { direct_text } from '../../src/dapp/copy.ts'
import { direct_open, type DirectRequest } from '../../src/dapp/direct.ts'
import type { AppCopy } from '../../src/i18n/copy.ts'
import en from '../../src/i18n/locales/en.yaml'
import {
  commands_unresolved,
  direct_free,
  initial_dapp_state,
  reduce_dapp,
  type CommandOutcome,
  type DappInput,
  type DappState,
} from '../../src/dapp/state.ts'

import {
  HERO,
  account_fixture,
  character_fixture,
  hero_id,
  item_fixture,
  listing_fixture,
  observation_fixture,
} from './fixtures.ts'

const SECOND = hero_id('2')
const team = [character_fixture(), character_fixture({ id: SECOND, name: 'Bran', level: 7 })]
const potion = { ...item_fixture('potion_of_thebes', 2, `0x${'c'.repeat(64)}`), category: 'consumable' }
const sword = { ...item_fixture('rusty_sword', 1, `0x${'d'.repeat(64)}`), category: 'sword' }
const own = listing_fixture('copper_ore', '5', { id: `0x${'a'.repeat(64)}` })
const ACCOUNT = account_fixture({ characters: team, items: [potion, sword], listings: [own] })
const fold_under =
  (account: DappAccount) =>
  (state: DappState, ...inputs: readonly DappInput[]) =>
    inputs.reduce((next, input) => reduce_dapp(next, input, account), state)
const fold = fold_under(ACCOUNT)
const observed = (overrides: Readonly<Record<string, unknown>>, requested_ms: number): DappInput => ({
  type: 'dapp/observed',
  observation: observation_fixture(overrides),
  requested_ms,
  now: requested_ms,
})
const connected = fold(initial_dapp_state(), { type: 'dapp/link', link: { phase: 'connected' } }, observed({}, 100))
const sent = (id: string, outcome: CommandOutcome, now: number): DappInput => ({
  type: 'dapp/direct_sent',
  id,
  outcome,
  now,
})
const done: CommandOutcome = { kind: 'done' }
/** The bot's own command for a request, as its observation lists it. */
const command = ({ action, payload }: DirectRequest, status: string, error?: string) => ({
  id: 'bot-command',
  kind: action,
  status,
  error,
  payload,
})
const HERO_SHEET = { name: 'Okami', classe: 'yogan', male: true, color_1: 1, color_2: 2, color_3: 3 }
const create = (id = 'n1', payload = HERO_SHEET): DappInput => ({ type: 'dapp/create_hero', id, payload })
/** Every kind of request the page makes, each with the bot's own payload. */
const REQUESTS: Readonly<Record<string, DappInput>> = {
  raise_stats: {
    type: 'dapp/hero_direct',
    id: 'r',
    hero_id: HERO,
    action: 'raise_stats',
    payload: { character_id: HERO, spending: { strength: 5 } },
  },
  raise_spell: {
    type: 'dapp/hero_direct',
    id: 'r',
    hero_id: HERO,
    action: 'raise_spell',
    payload: { character_id: HERO, spell: 'Magic Arrow' },
  },
  equip_item: {
    type: 'dapp/hero_direct',
    id: 'r',
    hero_id: HERO,
    action: 'equip_item',
    payload: { character_id: HERO, slot: 'weapon', item_id: sword.id },
  },
  // No item: the slot is emptied, by the same kind.
  empty_slot: {
    type: 'dapp/hero_direct',
    id: 'r',
    hero_id: HERO,
    action: 'equip_item',
    payload: { character_id: HERO, slot: 'weapon' },
  },
  use_consumable: {
    type: 'dapp/hero_direct',
    id: 'r',
    hero_id: HERO,
    action: 'use_consumable',
    payload: { character_id: HERO, item_id: potion.id, amount: 1 },
  },
  dungeon_leave: {
    type: 'dapp/hero_direct',
    id: 'r',
    hero_id: HERO,
    action: 'dungeon_leave',
    payload: { character_id: HERO, dungeon: 'gilded_lorito' },
  },
  craft: {
    type: 'dapp/hero_direct',
    id: 'r',
    hero_id: HERO,
    action: 'craft',
    payload: { character_id: HERO, output_type: 'wheat_flour', attempts: 3 },
  },
  create_character: create('r'),
  market_buy: { type: 'dapp/buy', id: 'r', listing: listing_fixture('wheat', '1000') as unknown as ListingRow },
  market_sell: {
    type: 'dapp/sell',
    id: 'r',
    listing: { id: sword.id, item_type: 'rusty_sword', amount: 1, price_mist: '2000' },
  },
  market_delist: { type: 'dapp/delist', id: 'r', listing: own },
}
const kinds = Object.keys(REQUESTS)
/** The same request under another id: what a second tap would send. */
const again = (kind: string, id: string) => ({ ...REQUESTS[kind]!, id }) as DappInput

test('every direct request shares the wallet’s one slot: while one is open, no other changes anything', () => {
  for (const kind of kinds) {
    const asking = fold(connected, REQUESTS[kind]!)
    expect([kind, asking.direct?.status]).toEqual([kind, 'pending'])
    expect(direct_free(asking)).toBe(false)
    // Unresolved: the page neither disconnects nor asks anything else of the wallet.
    expect(commands_unresolved(asking)).toBe(true)
    expect(fold(asking, { type: 'dapp/disconnect' })).toBe(asking)
    expect(fold(asking, { type: 'dapp/direct_dismissed' })).toBe(asking)
    for (const other of kinds) expect(fold(asking, again(other, 'second'))).toBe(asking)
    // The bot took it and still holds it: the slot stays taken until the bot says it is over.
    const accepted = fold(asking, sent('r', done, 300))
    expect(accepted.direct!.status).toBe('accepted')
    for (const other of kinds) expect(fold(accepted, again(other, 'second'))).toBe(accepted)
  }
  // The bot signs a direct request in turn with its heroes: another hero starts without waiting for it.
  const editing = fold(connected, REQUESTS.raise_stats!)
  const starting = fold(editing, {
    type: 'dapp/start',
    id: 'c1',
    spec: { activity: 'gather', hero_ids: [SECOND], work: { mode: 'auto', job: null }, fee_cap_mist: null },
    title: 'Work',
  })
  expect(Object.keys(starting.commands)).toEqual([SECOND])
})

test('a request carries the bot’s exact payload, names its hero and its item, and is told for what it was', () => {
  const made = (kind: string) => fold(connected, REQUESTS[kind]!).direct!
  expect(made('raise_stats')).toMatchObject({
    id: 'r',
    action: 'raise_stats',
    hero_id: HERO,
    payload: { character_id: HERO, spending: { strength: 5 } },
    item_type: null,
    after: null,
    proof: null,
  })
  expect(made('equip_item')).toMatchObject({ action: 'equip_item', item_type: 'rusty_sword' })
  expect(made('empty_slot')).toMatchObject({
    action: 'equip_item',
    payload: { character_id: HERO, slot: 'weapon' },
    item_type: null,
  })
  expect(made('use_consumable')).toMatchObject({
    payload: { character_id: HERO, item_id: potion.id, amount: 1 },
    item_type: 'potion_of_thebes',
  })
  expect(made('dungeon_leave').payload).toEqual({ character_id: HERO, dungeon: 'gilded_lorito' })
  // A craft is told by its recipe and its tries: no bag row is named.
  expect(made('craft')).toMatchObject({
    action: 'craft',
    hero_id: HERO,
    payload: { character_id: HERO, output_type: 'wheat_flour', attempts: 3 },
    item_type: 'wheat_flour',
    amount: 3,
  })
  expect(made('use_consumable').amount).toBe(0)
  // The wallet's own requests name no hero.
  for (const kind of ['create_character', 'market_buy', 'market_sell', 'market_delist'])
    expect([kind, made(kind).hero_id]).toEqual([kind, null])
  // A request for a hero the account does not hold is no request.
  expect(fold(connected, { ...REQUESTS.raise_spell!, hero_id: 'ghost' } as DappInput)).toBe(connected)
  // Before the bot answered there is nothing to ask it.
  expect(reduce_dapp(initial_dapp_state(), REQUESTS.raise_spell!, ACCOUNT).direct).toBeNull()
  // With no copy the sentence is its key: one per kind, and never the bot's code.
  const told = (kind: string) => direct_text(null, { ...made(kind), status: 'done' }, ACCOUNT.characters)
  expect(kinds.filter((kind) => kind !== 'empty_slot').map(told)).toEqual([
    'direct_done_raise_stats',
    'direct_done_raise_spell',
    'direct_done_equip_item',
    'direct_done_use_consumable',
    'direct_done_dungeon_leave',
    'direct_done_craft',
    'direct_done_create_character',
    'direct_done_market_buy',
    'direct_done_market_sell',
    'direct_done_market_delist',
  ])
  expect(direct_text(null, { ...made('raise_spell'), status: 'refused', error: 'spell_rank_capped' }, [])).toBe(
    'error_unknown'
  )
})

test('each request is followed to done or refused in the bot’s own command, and only by a view a read has proven', () => {
  for (const kind of kinds) {
    const accepted = fold(connected, REQUESTS[kind]!, sent('r', done, 300))
    const request = accepted.direct!
    // An observation requested before the answer proves nothing about it.
    expect(fold(accepted, observed({ observation_revision: 11 }, 250)).direct).toBe(request)
    const at = (status: string, error?: string) =>
      fold(accepted, observed({ observation_revision: 11, direct: command(request, status, error) }, 400)).direct!
    expect([kind, at('accepted').status, at('executing').status]).toEqual([kind, 'accepted', 'accepted'])
    expect([kind, at('uncertain').status]).toEqual([kind, 'uncertain'])
    const finished = at('completed')
    expect(finished).toMatchObject({ status: 'done', error: null })
    expect(direct_open(finished)).toBe(false)
    expect(at('failed', 'Error: character_not_available')).toMatchObject({
      status: 'refused',
      error: 'character_not_available',
    })
    // A code with a detail keeps its code; anything that is not a code never reaches the player raw.
    expect(at('failed', 'illegal_fight_action:not_your_turn').error).toBe('illegal_fight_action')
    expect(at('failed', 'Error: MoveAbort(0x2::kiosk, 5) in command 3').error).toBe('direct_failed')
    expect(at('cancelled').error).toBe('direct_failed')
  }
  // A resolved request is only a message: it is dismissed, or the next request replaces it.
  const over = fold(
    connected,
    REQUESTS.raise_spell!,
    sent('r', done, 300),
    observed(
      { observation_revision: 11, direct: command(fold(connected, REQUESTS.raise_spell!).direct!, 'completed') },
      400
    )
  )
  expect(over.direct!.status).toBe('done')
  expect(fold(over, { type: 'dapp/direct_dismissed' }).direct).toBeNull()
  expect(fold(over, again('equip_item', 'next')).direct).toMatchObject({ id: 'next', status: 'pending' })
  // A refusal changed nothing at the bot: it proves nothing new and asks for no read.
  const refused = fold(connected, REQUESTS.equip_item!, sent('r', { kind: 'refused', error: 'slot_empty' }, 300))
  expect(refused.direct).toMatchObject({ status: 'refused', error: 'slot_empty' })
  expect(refused.settled_ms).toBe(connected.settled_ms)
  // The answer to another request, or a second answer, changes nothing.
  expect(fold(refused, sent('r', done, 310))).toBe(refused)
  expect(fold(connected, REQUESTS.equip_item!, sent('other', done, 300)).direct!.status).toBe('pending')
})

test('an unknown answer is never sent again: every kind resolves from the next observation of the bot', () => {
  for (const kind of kinds) {
    const unknown = fold(connected, REQUESTS[kind]!, sent('r', { kind: 'uncertain' }, 300))
    const request = unknown.direct!
    expect([kind, request.status]).toEqual([kind, 'uncertain'])
    // The slot stays taken: nothing else, and no copy of this request, goes out.
    for (const other of kinds) expect(fold(unknown, again(other, 'again'))).toBe(unknown)
    // The request reached the bot: its own command is followed.
    const reached = fold(unknown, observed({ observation_revision: 11, direct: command(request, 'executing') }, 400))
    expect(reached.direct!.status).toBe('accepted')
    // An unread account proves nothing either way.
    const unread = account_fixture({ characters: team, phase: 'loading' })
    expect(fold_under(unread)(unknown, observed({ observation_revision: 11 }, 400)).direct!.status).toBe('uncertain')
    // It did not reach the bot, or the bot lost it: the page says so and sends nothing by itself.
    const lost = fold(unknown, observed({ observation_revision: 11 }, 400))
    expect(lost.direct).toMatchObject({ status: 'refused', error: 'direct_unconfirmed' })
    // A command the bot held before this request is never taken for it.
    const earlier = { ...command(request, 'completed'), id: 'earlier' }
    const repeat = fold(
      connected,
      observed({ observation_revision: 11, direct: earlier }, 200),
      REQUESTS[kind]!,
      sent('r', { kind: 'uncertain' }, 300),
      observed({ observation_revision: 12, direct: earlier }, 400)
    )
    expect([kind, repeat.direct!.after, repeat.direct!.error]).toEqual([kind, 'earlier', 'direct_unconfirmed'])
  }
})

test('the bot holds one direct command, its own included: the page waits for it and asks again after', () => {
  // The bot collects sale proceeds by itself: its command takes the slot like any other.
  const auto = { id: 'auto', kind: 'market_collect', status: 'executing', payload: { kiosks: ['0xk'] } }
  const held = fold(connected, observed({ observation_revision: 11, direct: auto }, 200))
  expect(direct_free(held)).toBe(false)
  for (const kind of kinds) expect(fold(held, REQUESTS[kind]!)).toBe(held)
  const over = fold(held, observed({ observation_revision: 12, direct: { ...auto, status: 'completed' } }, 300))
  expect(direct_free(over)).toBe(true)
  expect(fold(over, REQUESTS.raise_stats!).direct).toMatchObject({ status: 'pending', after: 'auto' })
  // The bot's refusal of a request sent meanwhile is told, and nothing is sent again.
  const busy = fold(connected, REQUESTS.raise_stats!, sent('r', { kind: 'refused', error: 'bot_busy_or_paused' }, 250))
  expect(busy.direct).toMatchObject({ status: 'refused', error: 'bot_busy_or_paused' })
})

test('a hero is created once: a name the game or the account refuses is refused before anything is sent', () => {
  const asked = fold(connected, create())
  // The bot's own payload; the hero that proves it is found by the name the chain stores.
  expect(asked.direct).toMatchObject({
    action: 'create_character',
    status: 'pending',
    payload: HERO_SHEET,
    proof: { kind: 'hero', name: 'okami' },
  })
  expect(fold(connected, create('n1', { ...HERO_SHEET, name: '  OKAMI ' })).direct!.proof).toEqual({
    kind: 'hero',
    name: 'okami',
  })
  for (const name of ['abc', 'with space', 'x'.repeat(20), 'éclair'])
    expect(fold(connected, create('n1', { ...HERO_SHEET, name })).direct).toMatchObject({
      status: 'refused',
      error: 'invalid_character_name',
    })
  // The account already holds that name: the hero that would prove the creation could not be told apart.
  expect(fold(connected, create('n1', { ...HERO_SHEET, name: 'MIRA' })).direct).toMatchObject({
    status: 'refused',
    error: 'character_name_taken',
  })
  // A second tap while the first is open, and one while its answer is unknown, change nothing.
  expect(fold(asked, create('n2'))).toBe(asked)
  const unknown = fold(asked, sent('n1', { kind: 'uncertain' }, 300))
  expect(fold(unknown, create('n2'))).toBe(unknown)
  // The bot's own refusals reach the player as their codes.
  const accepted = fold(asked, sent('n1', done, 300))
  for (const error of ['funding_required', 'character_name_taken', 'command_failed'])
    expect(
      fold(accepted, observed({ observation_revision: 11, direct: command(accepted.direct!, 'failed', error) }, 400))
        .direct
    ).toMatchObject({ status: 'refused', error })
})

test('a creation is proven by the new hero in the pushed account, never by a second request', () => {
  const okami = character_fixture({ id: hero_id('9'), name: 'okami' })
  const with_okami = account_fixture({ characters: [...team, okami] })
  const unknown = fold(connected, create(), sent('n1', { kind: 'uncertain' }, 300))
  // The bot shows no command of this page and the account shows the hero: it was created.
  const proven = fold_under(with_okami)(unknown, observed({ observation_revision: 11 }, 400))
  expect(proven.direct).toMatchObject({ status: 'done', error: null })
  expect(direct_text(null, proven.direct!, with_okami.characters)).toBe('direct_done_create_character')
  // The bot shows no command and the account no hero yet: unconfirmed, and nothing is sent again.
  const waiting = fold(unknown, observed({ observation_revision: 11 }, 400))
  expect(waiting.direct).toMatchObject({ status: 'refused', error: 'direct_unconfirmed' })
  expect(waiting.settled_ms).toBe(unknown.settled_ms)
  // The game server pushes the account by itself: the hero that arrives later proves it then.
  const arrived = fold_under(with_okami)(waiting, { type: 'dapp/tab', tab: 'home' })
  expect(arrived.direct).toMatchObject({ status: 'done', error: null })
  // The same account seen again is the same state; another hero of another name proves nothing.
  expect(fold_under(with_okami)(arrived, { type: 'dapp/tab', tab: 'home' })).toBe(arrived)
  const stranger = account_fixture({ characters: [...team, character_fixture({ id: hero_id('9'), name: 'ookami' })] })
  expect(fold_under(stranger)(waiting, { type: 'dapp/tab', tab: 'home' }).direct).toBe(waiting.direct)
  // Only an unconfirmed request is proven this way: a refusal the bot gave stays a refusal.
  const refused = fold(connected, create(), sent('n1', { kind: 'refused', error: 'funding_required' }, 300))
  expect(fold_under(with_okami)(refused, { type: 'dapp/tab', tab: 'home' }).direct).toBe(refused.direct)
  // The bot's own word is enough too: it marks a creation done only once it saw the hero.
  const accepted = fold(connected, create(), sent('n1', done, 300))
  expect(
    fold(accepted, observed({ observation_revision: 11, direct: command(accepted.direct!, 'completed') }, 400)).direct
  ).toMatchObject({ status: 'done' })
})

// Every code the bot's own `craft` validation refuses with (packages/bot/src/profession_actions.ts and
// gameplay_context.ts, read 2026-11-21), and the ones this page gives a sentence of their own.
const CRAFT_REFUSALS = [
  'character_not_available',
  'recipe_unavailable',
  'craft_batch_limit',
  'crafting_level_required',
  'inventory_unavailable',
  'ingredients_required',
  'needs_resync',
  'needs_custody_resync',
  'character_authority_mismatch',
  'invalid_gameplay_payload',
] as const
test('a craft the bot refuses is told in one sentence, never by its code, and nothing is sent again', () => {
  const copy = en as AppCopy
  const accepted = fold(connected, REQUESTS.craft!, sent('r', done, 300))
  const sentences = CRAFT_REFUSALS.map((code) => {
    const refused = fold(
      accepted,
      observed({ observation_revision: 11, direct: command(accepted.direct!, 'failed', `Error: ${code}`) }, 400)
    )
    expect(refused.direct).toMatchObject({ action: 'craft', status: 'refused', error: code })
    expect(direct_open(refused.direct)).toBe(false)
    // Refused untouched: the slot is free again and the page sent nothing by itself.
    expect(direct_free(refused)).toBe(true)
    return direct_text(copy, refused.direct!, ACCOUNT.characters)
  })
  for (const sentence of sentences) {
    expect(sentence).toMatch(/^[A-Z].*[.!]$/)
    expect(sentence).not.toMatch(/[a-z]_[a-z]/)
  }
  // A code with no sentence of its own falls back to the page's plain one, never to the code.
  expect(direct_text(copy, { ...accepted.direct!, status: 'refused', error: 'no_such_code' }, [])).toBe(
    copy.dapp_page.error_unknown!
  )
  // The bot's refusal of the call itself, before it took the command, is told the same way.
  const at_once = fold(connected, REQUESTS.craft!, sent('r', { kind: 'refused', error: 'ingredients_required' }, 300))
  expect(at_once.direct).toMatchObject({ status: 'refused', error: 'ingredients_required' })
  expect(direct_text(copy, at_once.direct!, ACCOUNT.characters)).not.toContain('ingredients_required')
})
