// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import type { BotFetch } from '@aresrpg/protocol/hosted-bot-client'

import { grant_store } from '../../src/dapp/oauth.ts'
import { type AppInput } from '../../src/store.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dapp_error } from '../../src/dapp/copy.ts'
import type { DappInput } from '../../src/dapp/state.ts'
import type { StartSpec } from '../../src/dapp/strategies.ts'
import { buyer_total } from '../../src/marketplace/price.ts'
import { toast, type Toast } from '../../src/toast.ts'
import { HERO, character_fixture, hero_id, listing_fixture, raw_observation, run_fixture } from '../dapp/fixtures.ts'

import { owner, wallet, grant, harness, memory, tool_reply, settle, effects_for } from './dapp_harness.ts'

const SECOND = hero_id('2')
const heroes = [character_fixture(), character_fixture({ id: SECOND, name: 'Bran' })]
type ToolCall = Readonly<{ name: string; arguments: Readonly<Record<string, any>> }>
/** What each activity asks with nothing chosen: where each hero stands, and the bot's own pick of work. */
const train = (hero_ids: readonly string[]): StartSpec => ({
  activity: 'train',
  hero_ids,
  place: null,
  difficulty: null,
  fee_cap_mist: null,
})
const gather = (hero_ids: readonly string[]): StartSpec => ({
  activity: 'gather',
  hero_ids,
  work: { mode: 'auto', job: null },
  fee_cap_mist: null,
})
const refusal = (error: string) =>
  Response.json({ jsonrpc: '2.0', id: 1, result: { isError: true, structuredContent: { error } } })
/** A tree acts for exactly one hero: the first one it names. */
const tree_hero = (script: unknown) => /"character_id":"(0x[0-9a-f]+)"/.exec(JSON.stringify(script))![1]!
/** A stand-in bot that hosts one run per hero and keeps the strategy its script declares, as the real one does. */
const hosted_bot = (
  answer: (call: ToolCall, runs: Map<string, string | undefined>) => Response | null = () => null
) => {
  const calls: ToolCall[] = []
  const runs = new Map<string, string | undefined>()
  const fetcher: BotFetch = async (_url, init) => {
    const { params } = JSON.parse(String(init.body)) as { params: ToolCall }
    calls.push(params)
    const answered = answer(params, runs)
    if (answered) return answered
    if (params.name === 'bot_start_behavior') {
      const hero = tree_hero(params.arguments.script)
      runs.set(hero, params.arguments.script.strategy)
      return tool_reply({ id: `run-${hero}`, character_id: hero, status: 'active' })
    }
    if (params.name === 'bot_stop_behavior') runs.delete(String(params.arguments.character_id))
    const listed = [...runs].map(([hero, strategy]) => run_fixture(hero, 'active', undefined, strategy))
    return tool_reply(params.name === 'bot_observe' ? raw_observation({ runs: listed }) : { status: 'stopped' })
  }
  return { fetcher, calls, runs, named: (name: string) => calls.filter((call) => call.name === name) }
}
/** The game server's push of the bot account to its owner, on the session's one account subscription. */
const push_account = (app: ReturnType<typeof harness>, items: readonly object[] = [], characters = heroes) => {
  const { serial: id } = app.state().session.agent_inventory
  const pushed = (packet: object) =>
    app.dispatch({ type: 'server/packet', packet: { type: 'packet/inventory_observed', id, packet } } as AppInput)
  pushed({ type: 'packet/characters', characters })
  pushed({ type: 'packet/inventory', items })
  app.dispatch({
    type: 'agent/inventory_balances',
    wallet,
    pairing: app.state().session.inventory_pairing!,
    sui_balance_mist: 2_000_000_000n,
    kares_balance: null,
  })
}
/** The bot's own status, as the game server relays it inside the account subscription. */
const push_status = (app: ReturnType<typeof harness>, overrides: Readonly<Record<string, unknown>>) =>
  app.dispatch({
    type: 'server/packet',
    packet: {
      type: 'packet/inventory_observed',
      id: app.state().session.agent_inventory.serial,
      packet: { type: 'packet/agent_status', status: { direct: null, ...raw_observation(overrides) } },
    },
  } as AppInput)
const signed_in = async (bot: ReturnType<typeof hosted_bot>, effects = effects_for(bot.fetcher)) => {
  grant_store(effects.grants, owner).save(grant)
  const app = harness(effects)
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet })
  await settle()
  push_account(app)
  return app
}
/** Running positions by hero: replies of parallel commands may land in any order. */
const running = (app: Awaited<ReturnType<typeof signed_in>>) =>
  app
    .state()
    .dapp.positions.flatMap(({ hero_id: hero, activity, finished_ms }) =>
      finished_ms === null ? [[hero, activity]] : []
    )
    .toSorted(([left], [right]) => String(left).localeCompare(String(right)))
const observe_now = async (app: Awaited<ReturnType<typeof signed_in>>, items: readonly object[] = []) => {
  // A link that connects again reads the bot at once.
  app.dispatch({ type: 'dapp/link', link: { phase: 'exchanging' } })
  app.dispatch({ type: 'dapp/link', link: { phase: 'connected' } })
  // Leaving `connected` dropped the account subscription; the new one is pushed before the bot answers.
  push_account(app, items)
  await settle()
}

test('the bot pushes what runs: the page follows it with no further read and arms no clock', async () => {
  const armed = spyOn(globalThis, 'setInterval')
  const bot = hosted_bot()
  const app = await signed_in(bot)
  const reads = bot.named('bot_observe').length
  expect(reads).toBe(1)
  push_status(app, { sampled_at: 5, runs: [run_fixture(HERO, 'active', undefined, 'gather_craft')] })
  expect(running(app)).toEqual([[HERO, 'gather']])
  push_status(app, { sampled_at: 6 })
  expect(running(app)).toEqual([])
  await settle()
  expect(bot.named('bot_observe')).toHaveLength(reads)
  expect(armed).not.toHaveBeenCalled()
  armed.mockRestore()
  app.stop()
})

test('two heroes are sent in parallel, each by its own tree; stopping one leaves the other running', async () => {
  const bot = hosted_bot()
  const app = await signed_in(bot)
  // The heroes are the game server's push, never the bot's answer.
  expect(app.state().session.agent_inventory.characters.length).toBe(2)
  app.dispatch({ type: 'dapp/start', id: 'c1', spec: train([HERO, SECOND]), title: 'Train' })
  await settle()
  const starts = bot.named('bot_start_behavior').map((call) => call.arguments)
  expect(starts.map(({ idempotency_key }) => idempotency_key).toSorted()).toEqual([`c1:${HERO}`, `c1:${SECOND}`])
  // Each tree joins the fight of its own teammate: nobody leads.
  const actions = starts.flatMap(({ script }) =>
    script.tree.child.children.map((node: { action?: object }) => node.action)
  )
  expect(actions).toContainEqual({ type: 'join', character_id: SECOND, allies: [HERO] })
  expect(actions).toContainEqual({ type: 'join', character_id: HERO, allies: [SECOND] })
  expect(
    starts.every(
      ({ decision_revision, observation_revision }) => decision_revision === 3 && observation_revision === 10
    )
  ).toBe(true)
  expect(bot.named('bot_validate_behavior')).toEqual([])
  expect(running(app)).toEqual([
    [HERO, 'train'],
    [SECOND, 'train'],
  ])
  app.dispatch({ type: 'dapp/stop', id: 's1', hero_ids: [HERO] })
  await settle()
  expect(bot.named('bot_stop_behavior').map((call) => call.arguments)).toEqual([{ character_id: HERO }])
  expect(running(app)).toEqual([[SECOND, 'train']])
  await observe_now(app)
  expect(running(app)).toEqual([[SECOND, 'train']])
  expect(bot.named('bot_start_behavior')).toHaveLength(2)
  app.stop()
})

test('a tab starts at its top, and so does the answer to a Start of this page; a run the bot pushes moves nothing', async () => {
  const bot = hosted_bot()
  const effects = effects_for(bot.fetcher)
  const app = await signed_in(bot, effects)
  expect(effects.scrolled).toEqual([])
  app.dispatch({ type: 'dapp/tab', tab: 'quest' })
  expect(effects.scrolled).toHaveLength(1)
  // The tab already on screen is no change, and a choice on it moves nothing.
  app.dispatch({ type: 'dapp/tab', tab: 'quest' })
  app.dispatch({ type: 'dapp/quest_pick', pick: { kind: 'work' } })
  expect(effects.scrolled).toHaveLength(1)
  // A Start that is sent moves nothing; its answer opens the run that heads the tab.
  app.dispatch({ type: 'dapp/start', id: 'c1', spec: train([HERO]), title: 'Train' })
  expect(effects.scrolled).toHaveLength(1)
  await settle()
  expect(running(app)).toEqual([[HERO, 'train']])
  expect(effects.scrolled).toHaveLength(2)
  // A run this page did not ask for, and the same runs told again, are not an answer to the player.
  const told = [
    run_fixture(HERO, 'active', undefined, 'fight_nearby'),
    run_fixture(SECOND, 'active', undefined, 'gather_craft'),
  ]
  push_status(app, { sampled_at: 50, runs: told })
  push_status(app, { sampled_at: 51, runs: told })
  expect(running(app)).toEqual([
    [HERO, 'train'],
    [SECOND, 'gather'],
  ])
  expect(effects.scrolled).toHaveLength(2)
  app.stop()
})

test('a lost start reply is never resent: the read that follows it shows that hero’s run', async () => {
  const bot = hosted_bot(({ name, arguments: args }, runs) => {
    if (name !== 'bot_start_behavior' || args.idempotency_key !== `c1:${HERO}`) return null
    runs.set(HERO, args.script.strategy)
    throw new TypeError('reply lost')
  })
  const app = await signed_in(bot)
  app.dispatch({ type: 'dapp/start', id: 'c1', spec: gather([HERO, SECOND]), title: 'Gather' })
  await settle()
  expect(bot.named('bot_start_behavior')).toHaveLength(2)
  // An unknown answer asks the bot once more what runs; no clock and no second start is involved.
  expect(app.state().dapp.commands).toEqual({})
  expect(running(app)).toEqual([
    [HERO, 'gather'],
    [SECOND, 'gather'],
  ])
  expect(bot.named('bot_start_behavior')).toHaveLength(2)
  app.stop()
})

test('the bot’s run limit is told as a plain sentence for that hero, and nothing is sent again', async () => {
  const bot = hosted_bot(({ name, arguments: args }) =>
    name === 'bot_start_behavior' && args.idempotency_key === `c1:${SECOND}` ? refusal('run_limit_reached') : null
  )
  const app = await signed_in(bot)
  app.dispatch({ type: 'dapp/start', id: 'c1', spec: gather([HERO, SECOND]), title: 'Gather' })
  await settle()
  expect(app.state().dapp.commands).toMatchObject({ [SECOND]: { status: 'refused', error: 'run_limit_reached' } })
  expect(running(app)).toEqual([[HERO, 'gather']])
  expect(bot.named('bot_start_behavior')).toHaveLength(2)
  const copy = await load_app_copy('en')
  expect(dapp_error(copy, 'run_limit_reached')).toMatch(/as many heroes as it can/)
  expect(dapp_error(copy, 'run_limit_reached')).not.toBe(dapp_error(copy, 'some_unknown_code'))
  app.stop()
})

test('a reload names every running hero from the observation alone: no tree is read back', async () => {
  const bot = hosted_bot()
  bot.runs.set(HERO, 'dungeon_raid')
  bot.runs.set(SECOND, 'gather_craft')
  bot.runs.set(hero_id('3'), undefined)
  const app = await signed_in(bot)
  expect(running(app)).toEqual([
    [HERO, 'raid'],
    [SECOND, 'gather'],
    // A tree another client authored names no catalogue entry: it runs, without an activity.
    [hero_id('3'), null],
  ])
  expect(bot.named('bot_behavior_status')).toEqual([])
  expect(bot.named('bot_start_behavior')).toEqual([])
  app.stop()
})

const KEY = 'key_of_gilded_lorito'
const offer = listing_fixture(KEY, '1000000000')
/** A stand-in bot account: it holds one direct command. */
const trading_bot = (buy: (bag: { direct: object | null }, call: ToolCall) => Response) => {
  const bag = { direct: null as object | null }
  return hosted_bot((call) => {
    if (call.name === 'bot_market_buy') return buy(bag, call)
    if (call.name !== 'bot_observe') return null
    return tool_reply(raw_observation({ direct: bag.direct }))
  })
}
const browse_key = async (app: Awaited<ReturnType<typeof signed_in>>) => {
  app.dispatch({ type: 'dapp/tab', tab: 'market' })
  app.dispatch({ type: 'market/group_selected', group: 'CONSUMABLE', category: 'key', item_type: KEY })
  await settle()
}
const tap_buy = (app: Awaited<ReturnType<typeof signed_in>>, id: string) =>
  app.dispatch({ type: 'dapp/buy', id, listing: offer as never })

test('a purchase is one command of the bot account with the shown total as its ceiling', async () => {
  const bot = trading_bot((bag, { arguments: args }) => {
    bag.direct = { id: 'c1', kind: 'market_buy', status: 'accepted', payload: args.action }
    return tool_reply({ command_id: 'c1', status: 'accepted' })
  })
  const app = await signed_in(bot)
  expect(bot.named('bot_observe').at(-1)!.arguments).toEqual({ view: 'full' })
  await browse_key(app)
  tap_buy(app, 'o1')
  tap_buy(app, 'o2')
  await settle()
  const [sent, ...repeated] = bot.named('bot_market_buy')
  expect(repeated).toEqual([])
  expect(sent!.arguments).toMatchObject({
    idempotency_key: 'o1',
    decision_revision: 3,
    observation_revision: 10,
    action: {
      item_id: offer.id,
      price_mist: '1000000000',
      max_total_mist: String(buyer_total(1_000_000_000n)),
      item_type: KEY,
    },
  })
  expect(app.state().dapp.direct).toMatchObject({ id: 'o1', status: 'accepted' })
  // The bot signs it and the key lands in the bag: the next observation says so, with no other call.
  bot.runs.clear()
  const names = () => new Set(bot.calls.map(({ name }) => name))
  await observe_now(app)
  expect(app.state().dapp.direct!.status).toBe('accepted')
  expect(names()).toEqual(new Set(['bot_observe', 'bot_market_buy']))
  // The bot is never asked to watch offers for the page: it reads them itself when it buys.
  for (const { arguments: args } of bot.named('bot_observe')) expect(args).toEqual({ view: 'full' })
  app.stop()
})

test('a refused purchase tells its reason and an unknown one is never sent again', async () => {
  const refusing = trading_bot(() => refusal('bot_busy_or_paused'))
  const refused = await signed_in(refusing)
  await browse_key(refused)
  tap_buy(refused, 'o1')
  await settle()
  expect(refused.state().dapp.direct).toMatchObject({ status: 'refused', error: 'bot_busy_or_paused' })
  expect(refusing.named('bot_market_buy')).toHaveLength(1)
  refused.stop()
  const losing = trading_bot((bag, { arguments: args }) => {
    bag.direct = { id: 'c1', kind: 'market_buy', status: 'completed', payload: args.action }
    throw new TypeError('reply lost')
  })
  const lost = await signed_in(losing)
  await browse_key(lost)
  tap_buy(lost, 'o1')
  await settle()
  // The read that follows an unknown answer finds the bot's own command: it was asked for exactly once.
  expect(lost.state().dapp.direct).toMatchObject({ id: 'o1', status: 'done' })
  expect(losing.named('bot_market_buy')).toHaveLength(1)
  lost.stop()
})

/** A stand-in bot wallet that takes any direct command, holds it, and lists it in its observations. */
const direct_bot = (status = 'completed') => {
  const held = { direct: null as object | null }
  return hosted_bot((call) => {
    if (call.name === 'bot_observe') return tool_reply(raw_observation({ direct: held.direct }))
    if (['bot_start_behavior', 'bot_stop_behavior'].includes(call.name)) return null
    held.direct = {
      id: `cmd-${call.name}`,
      kind: call.name.replace(/^bot_/, ''),
      status,
      payload: call.arguments.action,
    }
    return tool_reply({ command_id: `cmd-${call.name}`, status: 'accepted' })
  })
}
const SHEET = { name: 'Okami', classe: 'yogan', male: true, color_1: 1, color_2: 2, color_3: 3 }
const own_listing = listing_fixture('copper_ore', '5', { id: `0x${'a'.repeat(64)}`, seller: '0xagent' })
const hero_direct = (action: string, payload: Readonly<Record<string, unknown>>) =>
  ({ type: 'dapp/hero_direct', id: `id-${action}`, hero_id: HERO, action, payload }) as DappInput
/** One request of every kind, with the tool the bot exposes for it and the action it must receive. */
const DIRECT: readonly Readonly<{ input: DappInput; tool: string; action: object }>[] = [
  {
    input: hero_direct('raise_stats', { character_id: HERO, spending: { strength: 5 } }),
    tool: 'bot_raise_stats',
    action: { character_id: HERO, spending: { strength: 5 } },
  },
  {
    input: hero_direct('raise_spell', { character_id: HERO, spell: 'Magic Arrow' }),
    tool: 'bot_raise_spell',
    action: { character_id: HERO, spell: 'Magic Arrow' },
  },
  {
    // No item: the same kind empties the slot.
    input: hero_direct('equip_item', { character_id: HERO, slot: 'weapon' }),
    tool: 'bot_equip_item',
    action: { character_id: HERO, slot: 'weapon' },
  },
  {
    input: hero_direct('use_consumable', { character_id: HERO, item_id: 'potion', amount: 1 }),
    tool: 'bot_use_consumable',
    action: { character_id: HERO, item_id: 'potion', amount: 1 },
  },
  {
    input: hero_direct('dungeon_leave', { character_id: HERO, dungeon: 'gilded_lorito' }),
    tool: 'bot_dungeon_leave',
    action: { character_id: HERO, dungeon: 'gilded_lorito' },
  },
  { input: { type: 'dapp/create_hero', id: 'id-create', payload: SHEET }, tool: 'bot_create_character', action: SHEET },
  {
    input: { type: 'dapp/delist', id: 'id-delist', listing: own_listing as never },
    tool: 'bot_market_delist',
    action: { item_id: own_listing.id, kiosk: own_listing.kiosk },
  },
]
const push_listings = (app: ReturnType<typeof harness>) =>
  app.dispatch({
    type: 'server/packet',
    packet: {
      type: 'packet/inventory_observed',
      id: app.state().session.agent_inventory.serial,
      packet: { type: 'packet/listings', listings: [own_listing], kiosk_versions: {}, own: true },
    },
  } as AppInput)
const shown = () => {
  const toasts: Toast[] = []
  const unsubscribe = toast.subscribe((event) => {
    if (event.type === 'show') toasts.push(event.toast)
  })
  return { toasts, unsubscribe }
}

test('every direct request is one call of the bot’s own tool, under fresh revisions, and is told once', async () => {
  for (const { input, tool, action } of DIRECT) {
    const bot = direct_bot()
    const app = await signed_in(bot)
    if (tool === 'bot_market_delist') push_listings(app)
    const { toasts, unsubscribe } = shown()
    const { id } = input as Readonly<{ id: string }>
    app.dispatch(input)
    // A second tap while the first is open sends nothing.
    app.dispatch({ ...input, id: 'again' } as DappInput)
    await settle()
    const [call, ...repeated] = bot.named(tool)
    expect([tool, repeated.length]).toEqual([tool, 0])
    expect(call!.arguments).toEqual({
      idempotency_key: id,
      decision_revision: 3,
      observation_revision: 10,
      action,
    })
    // The read that follows the answer finds the bot's own command: done, with no other call.
    expect(app.state().dapp.direct).toMatchObject({ id, status: 'done' })
    expect(new Set(bot.calls.map(({ name }) => name))).toEqual(new Set(['bot_observe', tool]))
    // One toast for the request, whatever the bot pushes again.
    const told = () => toasts.filter(({ type }) => type === 'success')
    expect([tool, told()]).toEqual([tool, [expect.objectContaining({ message: `direct_done_${tool.slice(4)}` })]])
    push_status(app, {
      sampled_at: 50,
      direct: { id: `cmd-${tool}`, kind: tool.slice(4), status: 'completed', payload: action },
    })
    push_status(app, {
      sampled_at: 51,
      direct: { id: `cmd-${tool}`, kind: tool.slice(4), status: 'completed', payload: action },
    })
    expect(told()).toHaveLength(1)
    unsubscribe()
    app.stop()
  }
})

test('a refused direct request tells its reason once, and a lost answer is never sent again', async () => {
  const refusing = hosted_bot((call) => (call.name === 'bot_equip_item' ? refusal('slot_empty') : null))
  const refused = await signed_in(refusing)
  const { toasts, unsubscribe } = shown()
  refused.dispatch(hero_direct('equip_item', { character_id: HERO, slot: 'weapon' }))
  await settle()
  expect(refused.state().dapp.direct).toMatchObject({ status: 'refused', error: 'slot_empty' })
  expect(refusing.named('bot_equip_item')).toHaveLength(1)
  // The sentence is the page's own: never the bot's code.
  expect(toasts.map(({ message, type }) => [message, type])).toEqual([['error_unknown', 'info']])
  unsubscribe()
  refused.stop()
  // The reply to a creation is lost after the bot took it: the page reads the bot, finds its command, sends nothing more.
  const held = { direct: null as object | null }
  const losing = hosted_bot((call) => {
    if (call.name === 'bot_observe') return tool_reply(raw_observation({ direct: held.direct }))
    if (call.name !== 'bot_create_character') return null
    held.direct = { id: 'c1', kind: 'create_character', status: 'executing', payload: call.arguments.action }
    throw new TypeError('reply lost')
  })
  const lost = await signed_in(losing)
  lost.dispatch({ type: 'dapp/create_hero', id: 'n1', payload: SHEET })
  await settle()
  expect(lost.state().dapp.direct).toMatchObject({ id: 'n1', status: 'accepted' })
  lost.dispatch({ type: 'dapp/create_hero', id: 'n2', payload: SHEET })
  await settle()
  expect(losing.named('bot_create_character')).toHaveLength(1)
  // The bot signs it and the game server pushes the new hero: the bot's next status ends the request.
  push_account(lost, [], [...heroes, character_fixture({ id: hero_id('9'), name: 'okami' })])
  push_status(lost, { sampled_at: 60, direct: { ...held.direct, status: 'completed' } })
  expect(lost.state().dapp.direct).toMatchObject({ id: 'n1', status: 'done' })
  expect(losing.named('bot_create_character')).toHaveLength(1)
  lost.stop()
})

test('a hero that is out tells each level it gains and the help its run starts to need, once', async () => {
  const bot = hosted_bot()
  bot.runs.set(HERO, 'fight_nearby')
  const app = await signed_in(bot)
  const { toasts, unsubscribe } = shown()
  const levelled = (level: number) => [character_fixture({ level, experience: String(level * 1_000) }), heroes[1]!]
  // The first sight of the hero is the baseline, and a hero that is not out tells nothing.
  push_account(app, [], [heroes[0]!, character_fixture({ id: SECOND, name: 'Bran', level: 12 })])
  expect(toasts).toEqual([])
  push_account(app, [], levelled(4))
  push_account(app, [], levelled(4))
  expect(toasts.map(({ message, type }) => [message, type])).toEqual([['level_up_toast', 'success']])
  push_account(app, [], levelled(5))
  expect(toasts).toHaveLength(2)
  // The run starts to need the player: told once, however often the bot repeats it.
  const blocked = [run_fixture(HERO, 'waiting', 'funding_required', 'fight_nearby')]
  push_status(app, { sampled_at: 70, runs: blocked })
  push_status(app, { sampled_at: 71, runs: blocked })
  expect(toasts.slice(2).map(({ message, type }) => [message, type])).toEqual([['command_refused', 'info']])
  unsubscribe()
  app.stop()
})

test('a hero whose run ends by itself is told once, with the reason; a plain end tells nothing', async () => {
  const bot = hosted_bot()
  bot.runs.set(HERO, 'fight_nearby')
  bot.runs.set(SECOND, 'fight_nearby')
  const app = await signed_in(bot)
  const { toasts, unsubscribe } = shown()
  const live = run_fixture(SECOND, 'active', undefined, 'fight_nearby')
  const reached = { ...run_fixture(HERO, 'completed', undefined, 'fight_nearby'), ended: 'objective_reached' }
  // The bot keeps telling the ending until the hero starts again: the position finishes once.
  push_status(app, { sampled_at: 70, runs: [live, reached] })
  push_status(app, { sampled_at: 71, runs: [live, reached] })
  expect(app.state().dapp.positions.find(({ hero_id: hero }) => hero === HERO)).toMatchObject({
    ended: 'objective_reached',
  })
  expect(toasts.map(({ message, type }) => [message, type])).toEqual([['command_refused', 'info']])
  // The other hero's run is only gone: it finishes without a word.
  push_status(app, { sampled_at: 72, runs: [reached] })
  expect(app.state().dapp.positions.every(({ finished_ms }) => finished_ms !== null)).toBe(true)
  expect(toasts).toHaveLength(1)
  unsubscribe()
  app.stop()
})

test('the fees the bot pushes are kept for the wallet and for each run, and a malformed status changes nothing', async () => {
  const bot = hosted_bot()
  const app = await signed_in(bot)
  const paying = { ...run_fixture(HERO, 'active', undefined, 'dungeon_raid'), fees_mist: '4200', dungeon_runs: 2 }
  push_status(app, { sampled_at: 80, runs: [paying], fees_mist: '99000' })
  expect(app.state().dapp.observation?.fees_mist).toBe(99_000n)
  expect(app.state().dapp.positions[0]).toMatchObject({ hero_id: HERO, fees_mist: 4_200n, dungeon_runs: 2 })
  const before = app.state().dapp
  push_status(app, { sampled_at: 81, runs: [{ ...paying, fees_mist: 'lots' }], fees_mist: '99000' })
  push_status(app, { sampled_at: 82, runs: [paying], fees_mist: 12 })
  expect(app.state().dapp).toBe(before)
  app.stop()
})

test('one version: the device keeps no interface mode, and a value an older page left there is never read', async () => {
  const device = memory()
  device.setItem('aresrpg:dapp:mode', 'advanced')
  const touched: string[] = []
  const recorded = (name: 'getItem' | 'setItem' | 'removeItem') =>
    ((key: string, value: string) => {
      touched.push(key)
      return device[name](key, value)
    }) as never
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: recorded('getItem'), setItem: recorded('setItem'), removeItem: recorded('removeItem') },
  })
  const app = await signed_in(hosted_bot())
  app.dispatch({ type: 'dapp/tab', tab: 'heroes' })
  app.dispatch({ type: 'dapp/quest_pick', pick: { hero_ids: [HERO], difficulty: 'hard' } })
  app.dispatch({ type: 'dapp/select_hero', hero_id: HERO })
  await settle()
  expect('mode' in app.state().dapp).toBe(false)
  // The bag feed is the only thing this page keeps on the device; the tab, the picks and the hero are not kept.
  const own = touched.filter((key) => key.startsWith('aresrpg:dapp:'))
  expect(own.length).toBeGreaterThan(0)
  expect(own.filter((key) => !key.startsWith('aresrpg:dapp:bag_feed:'))).toEqual([])
  expect(device.getItem('aresrpg:dapp:mode')).toBe('advanced')
  app.stop()
  if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
  else Reflect.deleteProperty(globalThis, 'localStorage')
})
