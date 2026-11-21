// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { BotFetch } from '@aresrpg/protocol/hosted-bot-client'

import { receive_consent, strict_clock } from '../../src/modules/dapp.ts'
import { grant_store, read_pending, save_pending } from '../../src/dapp/oauth.ts'
import { load_app_copy } from '../../src/i18n/copy.ts'
import { dapp_error } from '../../src/dapp/copy.ts'
import { raw_observation } from '../dapp/fixtures.ts'

import {
  issuer,
  owner,
  wallet,
  scope,
  identity,
  grant,
  tokens,
  memory,
  harness,
  tool_reply,
  settle,
  effects_for,
  PAIRING,
} from './dapp_harness.ts'

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

// Owner ruling 2026-11-20: no connect screen. A signed-in player without a grant is connected at once.
test('signing in without a grant starts the connection by itself; a Disconnect does not restart it', async () => {
  const seen: string[] = []
  const navigated: string[] = []
  const fetcher: BotFetch = async (url) => {
    seen.push(new URL(url).pathname)
    if (url.endsWith('/oauth/register')) return Response.json({ client_id: 'c' })
    if (url.endsWith('/oauth/revoke')) return Response.json({})
    return tool_reply(raw_observation())
  }
  const effects = { ...effects_for(fetcher), navigate: (url: string) => void navigated.push(url) }
  const app = harness(effects)
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet })
  await settle()
  expect(app.state().dapp.link.phase).toBe('authorizing')
  expect(navigated).toHaveLength(1)
  expect(new URL(navigated[0]!).pathname).toBe('/authorize')
  app.stop()
  // The page that receives the bot's consent redirect is finishing that request: it starts no other.
  const consenting = {
    ...effects_for(fetcher, '?intent=connect-agent&authorization_id=a'),
    navigate: (url: string) => void navigated.push(url),
  }
  const landed = harness(consenting)
  landed.dispatch({ type: 'auth/connecting' })
  landed.dispatch({ type: 'auth/connected', session: wallet })
  await settle()
  expect(landed.state().dapp.link).toEqual({ phase: 'disconnected', error: null })
  expect(navigated).toHaveLength(1)
  landed.stop()
  // A player who disconnected on purpose stays disconnected until they ask again.
  const linked = effects_for(fetcher)
  grant_store(linked.grants, owner).save(grant)
  const chosen = harness({ ...linked, navigate: (url: string) => void navigated.push(url) })
  chosen.dispatch({ type: 'auth/connecting' })
  chosen.dispatch({ type: 'auth/connected', session: wallet })
  await settle()
  chosen.dispatch({ type: 'dapp/disconnect' })
  await settle()
  expect(chosen.state().dapp.link).toEqual({ phase: 'disconnected', error: null })
  expect(navigated).toHaveLength(1)
  chosen.stop()
})

const CONSENT_PAGE = 'https://game.example.test/world?intent=connect-agent&authorization_id=a'
const OWN_PENDING = {
  client_id: 'c',
  redirect_uri: 'https://game.example.test/dapp',
  scope,
  state: 's1',
  verifier: 'v',
  expires_at: 5_000,
}
const answer = (values: Readonly<Record<string, string>> = {}) =>
  `https://game.example.test/dapp?${new URLSearchParams({ code: 'g.code', state: 's1', iss: issuer, ...values })}`
/**
 * The consent page of this tab's own request: a signed-in dapp whose address the page can replace.
 * `navigated` holds every page load the dapp asked for, `exchanged` every code sent to the bot.
 */
const consent_page = async (pending: typeof OWN_PENDING | null = OWN_PENDING) => {
  const page = { href: CONSENT_PAGE }
  const navigated: string[] = []
  const exchanged: Record<string, string>[] = []
  const fetcher: BotFetch = async (url, init) => {
    if (url.endsWith('/oauth/token')) {
      exchanged.push(JSON.parse(String(init.body)) as Record<string, string>)
      return tokens('g.x', 'g.y')
    }
    const { params } = JSON.parse(String(init.body)) as { params: { name: string } }
    return tool_reply(params.name === 'bot_identity' ? identity : raw_observation())
  }
  const effects = {
    ...effects_for(fetcher),
    location: () => {
      const url = new URL(page.href)
      return { href: url.href, search: url.search, origin: url.origin }
    },
    replace_url: (path: string) => {
      page.href = new URL(path, page.href).href
    },
    navigate: (url: string) => void navigated.push(url),
  }
  save_pending(effects.pending, pending)
  const app = harness(effects)
  app.dispatch({ type: 'auth/connecting' })
  app.dispatch({ type: 'auth/connected', session: wallet })
  await settle()
  // The consent page starts no other request; it waits for the consent step to finish this one.
  expect(app.state().dapp.link).toEqual({ phase: 'disconnected', error: null })
  return {
    app,
    effects,
    page,
    navigated,
    exchanged,
    receive: (url: string) => receive_consent(url, app.dispatch, effects),
  }
}

// Owner complaint 2026-11-21: a first connection was three page loads. The consent step sent the
// browser to `/dapp?code=…` only for a new boot to exchange a code the page already held.
test('the consent answer of this tab’s own request links the dapp in place, with no page load', async () => {
  const f = await consent_page()
  expect(f.receive(answer())).toBe(true)
  // The address is the dapp's own at once and never keeps the code; the link is being completed.
  expect(f.page.href).toBe('https://game.example.test/dapp')
  expect(f.app.state().dapp.link).toEqual({ phase: 'exchanging' })
  await settle()
  expect(f.navigated).toEqual([])
  expect(f.app.state().dapp.link).toEqual({ phase: 'connected' })
  // One exchange, under the verifier and the redirect of the request this tab kept.
  expect(f.exchanged).toHaveLength(1)
  expect(f.exchanged[0]).toMatchObject({
    grant_type: 'authorization_code',
    code: 'g.code',
    code_verifier: 'v',
    redirect_uri: 'https://game.example.test/dapp',
    client_id: 'c',
  })
  // The grant is stored where it always was, under the signed-in owner, and the request is spent.
  expect(grant_store(f.effects.grants, owner).read()?.refresh_token).toBe('g.y')
  expect(read_pending(f.effects.pending, 0)).toBeNull()
  expect(f.app.state().session.inventory_pairing).toEqual(PAIRING)
  f.app.stop()
})

test('an answer taken in place passes the same checks as a page load: state, issuer and this tab’s request', async () => {
  const refused = async (redirect: string, pending: typeof OWN_PENDING | null = OWN_PENDING) => {
    const f = await consent_page(pending)
    expect(f.receive(redirect)).toBe(true)
    await settle()
    // Nothing is exchanged, nothing is stored, and the code does not stay in the address.
    expect(f.exchanged).toEqual([])
    expect(grant_store(f.effects.grants, owner).read()).toBeNull()
    expect(f.page.href).toBe('https://game.example.test/dapp')
    expect(f.navigated).toEqual([])
    f.app.stop()
    return f.app.state().dapp.link
  }
  const failed = { phase: 'disconnected', error: 'consent_failed' } as const
  // A state that is not the one this tab generated.
  expect(await refused(answer({ state: 'forged' }))).toEqual(failed)
  // An answer that does not come from this bot service (RFC 9207).
  expect(await refused(answer({ iss: 'https://other.example.test' }))).toEqual(failed)
  // A tab that began no request holds no verifier: it can finish nothing.
  expect(await refused(answer(), null)).toEqual(failed)
  // A request that expired in tab storage is not this tab's request any more.
  expect(await refused(answer(), { ...OWN_PENDING, expires_at: 1 })).toEqual(failed)
})

test('a redirect that is not this origin’s dapp page is never taken in place: the browser leaves for it', async () => {
  const f = await consent_page()
  for (const redirect of [
    'https://assistant.example/callback?code=g.code&state=s1',
    'https://companion.example.test/oauth/callback?code=g.code',
    'https://game.example.test/other?code=g.code&state=s1',
    'https://game.example.test.evil.example/dapp?code=g.code&state=s1',
    'https://game.example.test/dapp',
    'not a url',
  ]) {
    const before = f.navigated.length
    expect(f.receive(redirect)).toBe(false)
    expect(f.navigated.slice(before)).toEqual([redirect])
  }
  await settle()
  // The page and its link did not move, and this tab's request is still waiting to be finished.
  expect(f.page.href).toBe(CONSENT_PAGE)
  expect(f.app.state().dapp.link).toEqual({ phase: 'disconnected', error: null })
  expect(f.exchanged).toEqual([])
  expect(read_pending(f.effects.pending, 0)).not.toBeNull()
  f.app.stop()
})

test('a code is exchanged once: the same answer delivered again finds its request spent', async () => {
  const f = await consent_page()
  f.receive(answer())
  await settle()
  expect(f.exchanged).toHaveLength(1)
  expect(f.app.state().dapp.link).toEqual({ phase: 'connected' })
  // The request left tab storage when its answer was first read, so a replayed answer is refused
  // before the bot is asked, exactly as a reload of the old callback address is.
  f.receive(answer())
  await settle()
  expect(f.exchanged).toHaveLength(1)
  expect(f.page.href).toBe('https://game.example.test/dapp')
  expect(f.app.state().dapp.link).toEqual({ phase: 'disconnected', error: 'consent_failed' })
  f.app.stop()
})

test('two readings of the page clock in one millisecond still order the answer before the read that proves it', () => {
  const now = strict_clock(() => 5)
  expect([now(), now(), now()]).toEqual([5, 6, 7])
})
