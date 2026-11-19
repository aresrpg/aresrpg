// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, spyOn, test } from 'bun:test'
import type { BotFetch, BotGrant } from '@aresrpg/protocol/hosted-bot-client'

import type { AuthSession } from '../../src/auth.ts'
import { observe_dapp, strict_clock, type DappEffects } from '../../src/modules/dapp.ts'
import { grant_store, save_pending, type DappStorage } from '../../src/dapp/oauth.ts'
import { initial_app_state, reduce_app_state, type AppContext, type AppInput, type AppState } from '../../src/store.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dapp_error } from '../../src/dapp/copy.ts'
import { buyer_total } from '../../src/marketplace/price.ts'
import {
  HERO,
  character_fixture,
  hero_id,
  item_fixture,
  listing_fixture,
  raw_observation,
  run_fixture,
} from '../dapp/fixtures.ts'

const issuer = 'https://bot.example.test'
const owner = `0x${'d'.repeat(64)}`
const wallet = { address: owner, identity: 'zklogin', wallet_name: 'Fixture' } as unknown as AuthSession
const scope = 'bot:observe bot:play bot:pause'
const identity = {
  owner,
  bot_id: 'bot',
  address: '0xagent',
  descriptor: 'descriptor',
  generation: 1,
  grant_id: 'grant',
  expires_at: 99_999_999,
  network: 'mainnet' as const,
}
const grant: BotGrant = {
  issuer,
  client_id: 'c',
  access_token: 'g.a',
  refresh_token: 'g.r',
  scope,
  expires_at: 10_000_000,
  identity,
}
const tokens = (access_token: string, refresh_token: string) =>
  Response.json({ access_token, refresh_token, token_type: 'Bearer', expires_in: 900, scope })

const memory = (): DappStorage => {
  const rows = new Map<string, string>()
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => void rows.set(key, value),
    removeItem: (key) => void rows.delete(key),
  }
}

/** The store's queued dispatch and STATE_UPDATED delivery, without arming any other module. */
const harness = (effects: DappEffects) => {
  let state = initial_app_state({} as AppState['settings'])
  let queue: AppInput[] = []
  let reducing = false
  const listeners: ((next: AppState, previous: AppState) => void)[] = []
  const dispatch = (input: AppInput) => {
    queue = [...queue, input]
    if (reducing) return
    reducing = true
    while (queue.length) {
      const [next_input, ...rest] = queue
      queue = rest
      const previous = state
      state = reduce_app_state(previous, next_input!)
      if (state !== previous) for (const listener of listeners) listener(state, previous)
    }
    reducing = false
  }
  const controller = new AbortController()
  const context: AppContext = {
    events: { on: ((name: string, listener: never) => name === 'STATE_UPDATED' && listeners.push(listener)) as never },
    signal: controller.signal,
    get_state: () => state,
    dispatch,
  }
  observe_dapp(context, effects)
  return { dispatch, state: () => state, stop: () => controller.abort() }
}

const tool_reply = (content: unknown) =>
  Response.json({ jsonrpc: '2.0', id: 1, result: { structuredContent: content } })
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

const effects_for = (fetcher: BotFetch, search = ''): DappEffects & { replaced: string[] } => {
  const replaced: string[] = []
  const clock = { now: 1_000 }
  return {
    issuer,
    fetcher,
    grants: memory(),
    pending: memory(),
    // Every reading is later than the last, as on a real clock.
    now: () => (clock.now += 1),
    lock: undefined,
    location: () => ({ href: `https://game.example.test/dapp${search}`, search, origin: 'https://game.example.test' }),
    replace_url: (path) => void replaced.push(path),
    navigate: () => undefined,
    replaced,
  }
}

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
const PAIRING = {
  address: identity.address,
  multisig_public_key: identity.descriptor,
  signer_mode: 'host-persistent' as const,
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

test('a consent callback exchanges once, strips the code, and refuses a grant for another owner', async () => {
  const seen: string[] = []
  const fetcher: BotFetch = async (url, init) => {
    seen.push(url)
    if (url.endsWith('/oauth/token')) return tokens('g.x', 'g.y')
    if (url.endsWith('/oauth/revoke')) return Response.json({})
    const { params } = JSON.parse(String(init.body)) as { params: { name: string } }
    return tool_reply(params.name === 'bot_identity' ? { ...identity, owner: `0x${'e'.repeat(64)}` } : {})
  }
  const effects = effects_for(fetcher, `?code=g.code&state=s1&iss=${encodeURIComponent(issuer)}`)
  save_pending(effects.pending, {
    client_id: 'c',
    redirect_uri: 'https://game.example.test/dapp',
    scope,
    state: 's1',
    verifier: 'v',
    expires_at: 5_000,
  })
  const app = harness(effects)
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet })
  await settle()
  expect(effects.replaced).toEqual(['/dapp'])
  expect(app.state().dapp.link).toEqual({ phase: 'disconnected', error: 'owner_mismatch' })
  expect(seen.filter((url) => url.endsWith('/oauth/token'))).toHaveLength(1)
  expect(seen.filter((url) => url.endsWith('/oauth/revoke'))).toHaveLength(1)
  expect(grant_store(effects.grants, owner).read()).toBeNull()
  app.stop()
})

test('a link step that cannot finish returns to Connect with its reason: nothing is thrown or left pending', async () => {
  const link_after = async (fetcher: BotFetch, search = '', connect = false) => {
    const app = harness(effects_for(fetcher, search))
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({ type: 'auth/connected', session: wallet })
    await settle()
    if (connect) app.dispatch({ type: 'dapp/connect' })
    await settle()
    app.stop()
    return app.state().dapp.link
  }
  const offline: BotFetch = async () => {
    throw new TypeError('offline')
  }
  // Starting: the bot cannot be reached, or it refuses to register this page.
  expect(await link_after(offline, '', true)).toEqual({ phase: 'disconnected', error: 'unavailable' })
  // The bot's own refusal code is kept for diagnostics; the player reads a plain sentence, never the code.
  const refusing: BotFetch = async () => Response.json({ error: 'invalid_client_metadata' }, { status: 400 })
  expect(await link_after(refusing, '', true)).toEqual({ phase: 'disconnected', error: 'invalid_client_metadata' })
  const copy = await load_app_copy('en')
  expect(dapp_error(copy, 'invalid_client_metadata')).toBe(dapp_error(copy, 'some_unknown_code'))
  // Returning: a callback this tab never asked for, then a code the bot does not answer for.
  const callback = `?code=g.code&state=s1&iss=${encodeURIComponent(issuer)}`
  expect(await link_after(offline, callback)).toEqual({ phase: 'disconnected', error: 'consent_failed' })
})

test('two tabs share one grant: the second adopts the rotated tokens instead of replaying a used refresh token', async () => {
  const refreshes: string[] = []
  const fetcher: BotFetch = async (url, init) => {
    if (url.endsWith('/oauth/token')) {
      const { refresh_token: used } = JSON.parse(String(init.body)) as { refresh_token: string }
      refreshes.push(used)
      // The bot treats a replayed refresh token as theft and revokes the grant.
      if (refreshes.filter((token) => token === used).length > 1)
        return Response.json({ error: 'invalid_grant' }, { status: 400 })
      return tokens('g.a2', 'g.r2')
    }
    return tool_reply(raw_observation())
  }
  const shared = memory()
  grant_store(shared, owner).save({ ...grant, expires_at: 1_000 })
  const tab = () => {
    const app = harness({ ...effects_for(fetcher), grants: shared })
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({ type: 'auth/connected', session: wallet })
    return app
  }
  const first = tab()
  await settle()
  const second = tab()
  await settle()
  expect(refreshes).toEqual(['g.r'])
  for (const app of [first, second]) expect(app.state().dapp.link.phase).toBe('connected')
  first.stop()
  second.stop()
})

test('a refused refresh ends the link as expired; Disconnect ends the grant at the bot, then forgets it here', async () => {
  const seen: string[] = []
  const state = { refused: true }
  const fetcher: BotFetch = async (url) => {
    seen.push(new URL(url).pathname)
    if (url.endsWith('/oauth/token')) return Response.json({ error: 'invalid_grant' }, { status: 400 })
    if (url.endsWith('/mcp') && state.refused) return Response.json({ error: 'invalid_token' }, { status: 401 })
    return url.endsWith('/mcp') ? tool_reply(raw_observation()) : Response.json({})
  }
  const effects = effects_for(fetcher)
  const grants = grant_store(effects.grants, owner)
  grants.save(grant)
  const app = harness(effects)
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet })
  await settle()
  expect(app.state().dapp.link).toEqual({ phase: 'disconnected', error: 'expired' })
  expect(grants.read()).toBeNull()
  // The bot already ended that grant, so nothing is left to revoke.
  expect(seen).toEqual(['/mcp', '/oauth/token'])
  state.refused = false
  grants.save(grant)
  app.dispatch({ type: 'auth/disconnected' })
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet })
  await settle()
  expect(app.state().dapp.link.phase).toBe('connected')
  // A connected grant names the bot wallet: the session's own account subscription follows it.
  expect(app.state().session.inventory_pairing).toEqual(PAIRING)
  app.dispatch({ type: 'dapp/disconnect' })
  await settle()
  expect(app.state().dapp.link).toEqual({ phase: 'disconnected', error: null })
  expect(app.state().session.inventory_pairing).toBeNull()
  expect(grants.read()).toBeNull()
  expect(seen.at(-1)).toBe('/oauth/revoke')
  app.stop()
})

// Regression: Disconnect forgot the grant first and only logged a failed revoke, so the page said
// "disconnected" while the grant stayed live and no credential was left to end it.
test('a revoke the bot does not confirm keeps the grant and the link, so Disconnect can be tried again', async () => {
  const state = { down: true }
  const fetcher: BotFetch = async (url) => {
    if (url.endsWith('/oauth/revoke')) return state.down ? new Response('', { status: 503 }) : Response.json({})
    return tool_reply(raw_observation())
  }
  const effects = effects_for(fetcher)
  const grants = grant_store(effects.grants, owner)
  grants.save(grant)
  const app = harness(effects)
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet })
  await settle()
  app.dispatch({ type: 'dapp/disconnect' })
  await settle()
  expect(grants.read()).toEqual(grant)
  expect(app.state().dapp.link).toEqual({ phase: 'connected' })
  state.down = false
  app.dispatch({ type: 'dapp/disconnect' })
  await settle()
  expect(grants.read()).toBeNull()
  expect(app.state().dapp.link).toEqual({ phase: 'disconnected', error: null })
  app.stop()
})

// Regression: signing out left the grant's tokens in device storage for up to 90 days, readable by the
// next person at a shared device.
test('signing out ends the grant at the bot and forgets it; a lost session or a silent bot keeps it', async () => {
  const state = { down: false }
  const seen: string[] = []
  const fetcher: BotFetch = async (url) => {
    seen.push(new URL(url).pathname)
    if (url.endsWith('/oauth/revoke')) return state.down ? new Response('', { status: 503 }) : Response.json({})
    return tool_reply(raw_observation())
  }
  const signed_in = async () => {
    const effects = effects_for(fetcher)
    const grants = grant_store(effects.grants, owner)
    grants.save(grant)
    const app = harness(effects)
    app.dispatch({ type: 'auth/connecting' })
    app.dispatch({ type: 'auth/connected', session: wallet })
    await settle()
    expect(app.state().dapp.link).toEqual({ phase: 'connected' })
    return { app, grants }
  }
  const left = await signed_in()
  left.app.dispatch({ type: 'auth/disconnected' })
  await settle()
  expect(seen.at(-1)).toBe('/oauth/revoke')
  expect(left.grants.read()).toBeNull()
  left.app.stop()
  // The session was taken away, the player did not leave: their heroes keep their grant.
  const rejected = await signed_in()
  const revokes = seen.filter((path) => path === '/oauth/revoke').length
  rejected.app.dispatch({ type: 'auth/rejected', error: 'replaced' })
  await settle()
  expect(seen.filter((path) => path === '/oauth/revoke')).toHaveLength(revokes)
  expect(rejected.grants.read()).toEqual(grant)
  rejected.app.stop()
  state.down = true
  const silent = await signed_in()
  silent.app.dispatch({ type: 'auth/disconnected' })
  await settle()
  expect(silent.grants.read()).toEqual(grant)
  silent.app.stop()
})

test('two readings of the page clock in one millisecond still order the answer before the read that proves it', () => {
  const now = strict_clock(() => 5)
  expect([now(), now(), now()]).toEqual([5, 6, 7])
})
