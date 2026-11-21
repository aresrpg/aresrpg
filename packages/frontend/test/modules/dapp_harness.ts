// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared fixtures of the dapp module tests: one bot, one owner, and the store harness.
import { test } from 'bun:test'
import type { BotFetch, BotGrant } from '@aresrpg/protocol/hosted-bot-client'

import type { AuthSession } from '../../src/auth.ts'
import { observe_dapp, type DappEffects } from '../../src/modules/dapp.ts'
import { type DappStorage } from '../../src/dapp/oauth.ts'
import { initial_app_state, reduce_app_state, type AppContext, type AppInput, type AppState } from '../../src/store.ts'

export const issuer = 'https://bot.example.test'
export const owner = `0x${'d'.repeat(64)}`
export const wallet = { address: owner, identity: 'zklogin', wallet_name: 'Fixture' } as unknown as AuthSession
export const scope = 'bot:observe bot:play bot:pause'
export const identity = {
  owner,
  bot_id: 'bot',
  address: '0xagent',
  descriptor: 'descriptor',
  generation: 1,
  grant_id: 'grant',
  expires_at: 99_999_999,
  network: 'mainnet' as const,
}
export const grant: BotGrant = {
  issuer,
  client_id: 'c',
  access_token: 'g.a',
  refresh_token: 'g.r',
  scope,
  expires_at: 10_000_000,
  identity,
}
export const tokens = (access_token: string, refresh_token: string) =>
  Response.json({ access_token, refresh_token, token_type: 'Bearer', expires_in: 900, scope })

export const memory = (): DappStorage => {
  const rows = new Map<string, string>()
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => void rows.set(key, value),
    removeItem: (key) => void rows.delete(key),
  }
}

/** The store's queued dispatch and STATE_UPDATED delivery, without arming any other module. */
export const harness = (effects: DappEffects) => {
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
    // eslint-disable-next-line fp-law/no-mutating-methods -- a test harness records calls in its own lists
    events: { on: ((name: string, listener: never) => name === 'STATE_UPDATED' && listeners.push(listener)) as never },
    signal: controller.signal,
    get_state: () => state,
    dispatch,
  }
  observe_dapp(context, effects)
  return { dispatch, state: () => state, stop: () => controller.abort() }
}

export const tool_reply = (content: unknown) =>
  Response.json({ jsonrpc: '2.0', id: 1, result: { structuredContent: content } })
export const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

/** `replaced` holds every address the page set; `scrolled` holds one entry per return to the top of the page. */
export const effects_for = (
  fetcher: BotFetch,
  search = ''
): DappEffects & { replaced: string[]; scrolled: number[] } => {
  const replaced: string[] = []
  const scrolled: number[] = []
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
    // eslint-disable-next-line fp-law/no-mutating-methods -- a test harness records calls in its own lists
    replace_url: (path) => void replaced.push(path),
    navigate: () => undefined,
    // eslint-disable-next-line fp-law/no-mutating-methods -- a test harness records calls in its own lists
    scroll_top: () => void scrolled.push(clock.now),
    replaced,
    scrolled,
  }
}

export const PAIRING = {
  address: identity.address,
  multisig_public_key: identity.descriptor,
  signer_mode: 'host-persistent' as const,
}
