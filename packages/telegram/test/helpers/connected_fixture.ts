// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  PLAY_SCOPE,
  create_bot_client,
  type BotFetch,
  type BotGrant,
  type BotIdentity,
} from '@aresrpg/protocol/hosted-bot-client'
import type { TelegramAccess } from '@aresrpg/protocol/telegram-access'

import worlds from '../../../../seed/content/worlds.json'
import { behavior_actor } from '../../../bot/src/behavior_projection.ts'
import { parse_behavior_script } from '../../../bot/src/behavior_script.ts'
import { memory_access } from '../../../protocol/test/helpers/memory_access.ts'
import { limits_of } from '../../src/config.ts'
import { create_links, user_id, type Pending } from '../../src/link.ts'
import { secure_records, type RecordBackend } from '../../src/secure_records.ts'

import { memory_backend } from './memory_backend.ts'

export const issuer = 'https://bot.example'
export const identity: BotIdentity = {
  owner: `0x${'1'.repeat(64)}`,
  bot_id: 'bot',
  address: '0xagent',
  descriptor: 'descriptor',
  generation: 1,
  grant_id: 'grant',
  network: 'mainnet',
  // Past every clock a test uses, the real one included: the Redis tests run on real time.
  expires_at: Date.UTC(2100, 0, 1),
}
export const limits = limits_of({
  proposal_ttl_ms: 10000,
  link_ttl_ms: 10000,
  request_ms: 1000,
})
export const city = { world: 'nauvis', city: 'thebes' } as const
const thebes = Object.fromEntries(
  Object.entries(
    worlds.find(({ world }) => world === city.world)!.cities.find(({ city: id }) => id === city.city)!
  ).filter(([key]) => ['x', 'z'].includes(key))
)
/** Sui object ids: the bot's script parser accepts nothing else as a character. */
export const MIRA = `0x${'a'.repeat(64)}`
export const THOR = `0x${'b'.repeat(64)}`
/** One agent hero standing in Thebes by its authoritative checkpoint. */
export const hero = (id: string, name: string): Record<string, unknown> => ({
  id,
  name,
  custody: 'kiosk',
  world: city.world,
  checkpoint_world: city.world,
  ...thebes,
})
type Run = { id: string; character_id: string; status: string; issue: string | null; revision: number; script: unknown }
/**
 * A stand-in for the hosted bot's MCP door that enforces its per-hero contract: argument names, one run
 * per hero addressed by `character_id`, and the bot's own refusal codes. Scripts go through the bot's
 * real parser. It is not the bot: it proves the calls Telegram sends, not the bot's execution.
 */
export const create_world = () => {
  const world = {
    heroes: [hero(MIRA, 'Mira'), hero(THOR, 'Thor')],
    runs: new Map<string, Run>(),
    paused: false,
    decision_revision: 3,
    observation_revision: 4,
    /** The owner's limit on runs one wallet hosts. */
    run_limit: 30,
    /** Tools whose reply is lost after the bot acted on the request. */
    lost: new Set<string>(),
    /** Every tool call the bot received, in order. */
    calls: [] as { name: string; arguments: Record<string, any> }[],
  }
  const run_of = (character_id: unknown) => {
    const run = world.runs.get(String(character_id))
    if (!run) throw new Error('behavior_run_not_found')
    return run
  }
  const live = (run: Run | undefined) => Boolean(run && ['active', 'waiting', 'awaiting_ai'].includes(run.status))
  const host = (args: Record<string, any>, prior: Run | undefined): Run => {
    const script = parse_behavior_script(args.script)
    if (world.paused) throw new Error('bot_busy_or_paused')
    if (args.decision_revision !== world.decision_revision) throw new Error('needs_resync')
    if (args.observation_revision > world.observation_revision) throw new Error('needs_resync')
    const character_id = behavior_actor(script)
    if (!prior && [...world.runs.values()].filter(live).length >= world.run_limit) throw new Error('run_limit_reached')
    const run = {
      id: `run-${character_id}`,
      character_id,
      status: 'active',
      issue: null,
      revision: (prior?.revision ?? 0) + 1,
      script,
    }
    world.runs.set(character_id, run)
    return run
  }
  const tools: Readonly<Record<string, readonly [readonly string[], (args: Record<string, any>) => unknown]>> = {
    bot_identity: [[], () => identity],
    bot_observe: [
      ['view'],
      () => ({
        ready: true,
        decision_revision: world.decision_revision,
        observation_revision: world.observation_revision,
        sampled_at: 100,
        characters: world.heroes,
        // Like the bot: the catalogue entry a tree was bound from, absent for an authored tree.
        runs: [...world.runs.values()].map(({ id, character_id, status, issue, script }) => ({
          id,
          character_id,
          status,
          issue,
          strategy: (script as { strategy?: unknown } | null)?.strategy,
        })),
        balance: {
          address: identity.address,
          unit: 'MIST',
          mist_per_sui: '1000000000',
          clock: 'monotonic_ms',
          balance_mist: '1000000000',
          sampled_at: 90,
          expires_at: 110,
        },
      }),
    ],
    bot_behavior_status: [['character_id'], ({ character_id }) => run_of(character_id)],
    bot_start_behavior: [
      ['script', 'idempotency_key', 'decision_revision', 'observation_revision'],
      (args) => {
        const prior = world.runs.get(behavior_actor(parse_behavior_script(args.script)))
        // A playing hero keeps its tree until it is stopped or explicitly replaced.
        if (live(prior)) throw new Error('bot_busy_or_paused')
        return host(args, undefined)
      },
    ],
    bot_replace_behavior: [
      ['script', 'character_id', 'expected_revision', 'decision_revision', 'observation_revision'],
      (args) => {
        const prior = run_of(args.character_id)
        if (prior.revision !== args.expected_revision) throw new Error('behavior_revision_conflict')
        return host(args, prior)
      },
    ],
    bot_stop_behavior: [
      ['character_id'],
      ({ character_id }) => {
        const run = { ...run_of(character_id), status: 'stopped', issue: 'explicit_stop' }
        world.runs.set(run.character_id, run)
        return run
      },
    ],
    bot_pause: [[], () => ({ paused: (world.paused = true) })],
    bot_resume: [['decision_revision', 'observation_revision'], () => ({ paused: (world.paused = false) })],
  }
  const call = (name: string, args: Record<string, any>) => {
    // eslint-disable-next-line fp-law/no-mutating-methods -- The stand-in bot records what it received for assertions.
    world.calls.push({ name, arguments: args })
    const tool = tools[name]
    if (!tool) throw new Error('unknown_tool')
    if (Object.keys(args).some((key) => !tool[0].includes(key))) throw new Error('invalid_argument')
    return tool[1](args)
  }
  /** The MCP answer to one `tools/call`: a result, the bot's refusal by its code, or no answer at all. */
  const answer = (name: string, args: Record<string, any>) => {
    try {
      const value = call(name, args)
      if (world.lost.has(name)) throw new Error('reply lost')
      return Response.json({ jsonrpc: '2.0', id: 1, result: { structuredContent: value, isError: false } })
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      if (!/^[a-z_]+$/.test(code)) throw error
      return Response.json({ jsonrpc: '2.0', id: 1, result: { structuredContent: { error: code }, isError: true } })
    }
  }
  return Object.assign(world, { answer, sent: (name: string) => world.calls.filter((entry) => entry.name === name) })
}

export const fixture = (options: Readonly<{ backend?: RecordBackend; access?: TelegramAccess; now?: number }> = {}) => {
  const clock = { now: options.now ?? 1000 }
  let token_scope = PLAY_SCOPE
  // What the token endpoint issues next; the real bot never issues the same secret twice.
  const issued = { access_token: 'access', refresh_token: 'refresh' }
  const backend = options.backend ?? memory_backend(() => clock.now)
  const records = secure_records(backend, 'ab'.repeat(32))
  const bot = create_world()
  const sent: { url: string; body: Record<string, any>; init: RequestInit }[] = []
  const overrides: { handler?: BotFetch } = {}
  /** The bot's own answer to one request, for a test override that changes only some of them. */
  const respond: BotFetch = async (url, init) => {
    const body = JSON.parse(String(init.body))
    if (url.endsWith('/oauth/register')) return Response.json({ client_id: 'client' })
    if (url.endsWith('/oauth/revoke')) return Response.json({})
    // Like the real bot, a grant past its own end answers 401 to its tokens and to its refresh.
    if (clock.now > identity.expires_at) return Response.json({ error: 'invalid_token' }, { status: 401 })
    if (url.endsWith('/oauth/token'))
      return Response.json({ ...issued, token_type: 'Bearer', expires_in: 900, scope: token_scope })
    return bot.answer(body.params.name, body.params.arguments)
  }
  const http: BotFetch = async (url, init) => {
    // eslint-disable-next-line fp-law/no-mutating-methods -- The fixture owns this request recorder for assertions.
    sent.push({ url, body: JSON.parse(String(init.body)), init })
    return (overrides.handler ?? respond)(url, init)
  }
  const hosted = create_bot_client({ issuer, fetch: http, now: () => clock.now, timeout_ms: 1000 })
  // The fixture owner starts admitted; a test changes that through the same calls the operator command makes.
  const access = options.access ?? memory_access(() => clock.now, [identity.owner])
  const links = create_links(
    records,
    hosted,
    'https://companion.example/oauth/callback',
    limits.link_ttl_ms,
    () => clock.now
  )
  /** The chat asks for its login page and a browser opens it: everything up to the return from the bot. */
  const start = async (sender = 42) => {
    const url = await links.begin(sender)
    const browser = await links.browser(new URL(url).pathname.slice(6))
    token_scope = new URL(browser.location).searchParams.get('scope')!
    const query = new URLSearchParams({
      iss: issuer,
      code: 'code',
      state: new URL(browser.location).searchParams.get('state')!,
    })
    return { browser, query }
  }
  /** A login whose browser returned: its grant is held, and the chat has not confirmed. Answers the one-use token. */
  const signed_in = async (sender = 42) => {
    const { browser, query } = await start(sender)
    return links.callback(query, browser.cookie)
  }
  /** The whole login: the browser returns with the token, and the chat that asked sends it back. */
  const link = async (sender = 42) => links.confirm(sender, await signed_in(sender))
  /** A login whose token exchange succeeded and whose identity read did not: its attempt holds tokens. */
  const exchanged = async (sender = 42) => {
    const { browser, query } = await start(sender)
    overrides.handler = async (url, init) => {
      if (url.endsWith('/mcp')) throw new Error('identity unavailable')
      return respond(url, init)
    }
    await links.callback(query, browser.cookie).then(
      () => {
        throw new Error('the identity read was expected to fail')
      },
      (error: unknown) => {
        if (!(error instanceof Error) || error.message !== 'unavailable') throw error
      }
    )
    overrides.handler = undefined
    return { browser, query }
  }
  const expire = () =>
    records.change([user_id(42)], (get) => ({
      [user_id(42)]: { value: { ...get<BotGrant>(user_id(42))!, expires_at: 0 } },
    }))
  // Every live link attempt, newest last by its deadline.
  const attempts = async () =>
    (await Promise.all((await records.ids('pending:')).map((id) => records.read<Pending>(id))))
      .filter((row): row is Pending => row !== null)
      .toSorted((left, right) => left.authorization.expires_at - right.authorization.expires_at)
  const user = (sender = 42) => records.read<BotGrant>(user_id(sender))
  return {
    backend,
    records,
    bot,
    respond,
    sent,
    overrides,
    issued,
    hosted,
    links,
    access,
    clock,
    start,
    exchanged,
    signed_in,
    link,
    expire,
    attempts,
    user,
  }
}
export const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
