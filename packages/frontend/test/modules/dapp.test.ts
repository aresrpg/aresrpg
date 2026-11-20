// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import type { BotFetch } from '@aresrpg/protocol/hosted-bot-client'

import { grant_store } from '../../src/dapp/oauth.ts'
import { type AppInput } from '../../src/store.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dapp_error } from '../../src/dapp/copy.ts'
import { buyer_total } from '../../src/marketplace/price.ts'
import { HERO, character_fixture, hero_id, listing_fixture, raw_observation, run_fixture } from '../dapp/fixtures.ts'

import { owner, wallet, grant, harness, tool_reply, settle, effects_for } from './dapp_harness.ts'

const SECOND = hero_id('2')
const heroes = [character_fixture(), character_fixture({ id: SECOND, name: 'Bran' })]
type ToolCall = Readonly<{ name: string; arguments: Readonly<Record<string, any>> }>
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
const signed_in = async (bot: ReturnType<typeof hosted_bot>) => {
  const effects = effects_for(bot.fetcher)
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
  app.dispatch({ type: 'dapp/start', id: 'c1', activity: 'train', hero_ids: [HERO, SECOND], title: 'Train' })
  await settle()
  const starts = bot.named('bot_start_behavior').map((call) => call.arguments)
  expect(starts.map(({ idempotency_key }) => idempotency_key).toSorted()).toEqual([`c1:${HERO}`, `c1:${SECOND}`])
  expect(starts.map(({ script }) => script.tree.child.children[1].action)).toContainEqual({
    type: 'join',
    character_id: SECOND,
    allies: [HERO],
  })
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

test('a lost start reply is never resent: the read that follows it shows that hero’s run', async () => {
  const bot = hosted_bot(({ name, arguments: args }, runs) => {
    if (name !== 'bot_start_behavior' || args.idempotency_key !== `c1:${HERO}`) return null
    runs.set(HERO, args.script.strategy)
    throw new TypeError('reply lost')
  })
  const app = await signed_in(bot)
  app.dispatch({ type: 'dapp/start', id: 'c1', activity: 'gather', hero_ids: [HERO, SECOND], title: 'Gather' })
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
  app.dispatch({ type: 'dapp/start', id: 'c1', activity: 'gather', hero_ids: [HERO, SECOND], title: 'Gather' })
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
  app.dispatch({ type: 'dapp/view', view: 'market' })
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
  expect(app.state().dapp.order).toMatchObject({ id: 'o1', status: 'accepted' })
  // The bot signs it and the key lands in the bag: the next observation says so, with no other call.
  bot.runs.clear()
  const names = () => new Set(bot.calls.map(({ name }) => name))
  await observe_now(app)
  expect(app.state().dapp.order!.status).toBe('accepted')
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
  expect(refused.state().dapp.order).toMatchObject({ status: 'refused', error: 'bot_busy_or_paused' })
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
  expect(lost.state().dapp.order).toMatchObject({ id: 'o1', status: 'done' })
  expect(losing.named('bot_market_buy')).toHaveLength(1)
  lost.stop()
})
