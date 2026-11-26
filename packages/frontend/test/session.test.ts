// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The account and its link, through the real store and the real server link: who signs in, which socket opens
// for which surface, what the server's answers change, and how a link ends.
import { afterEach, expect, jest, test } from 'bun:test'

import { GAME_MODULES } from '../src/game/game_modules.ts'
import {
  is_account_view,
  kares_trade_href,
  SITE_PAGES,
  STAKING_SECTIONS,
  staking_section_href,
} from '../src/site/routes.ts'
import { SITE_MODULES } from '../src/site_modules.ts'

import { character_row, fake_wallet, settle, start_surface, type Started } from './harness.ts'

const running: Started[] = []
const start = async (...options: Parameters<typeof start_surface>): Promise<Started> => {
  const started = await start_surface(...options)
  running.push(started)
  return started
}
afterEach(() => running.splice(0).forEach(({ stop }) => stop()))

const REMEMBERED = 'Sign in with Google'
const heartbeat = Object.freeze({
  type: 'packet/server_info',
  online: 4,
  online_characters: 3,
  indexing_lag: 2,
  current_epoch: '900',
  chain_timestamp_ms: 1_700_000_000_000,
  chain_sample_age_ms: 5,
  market_volume: { day_mist: '1', month_mist: '2', history_days: 30 },
})

test('a visitor reads the open stage, signs in, proves the address, loads the roster and signs out', async () => {
  const signed: Uint8Array[] = []
  const disconnected: string[] = []
  const wallet = fake_wallet({
    sign_personal_message: async (message: Uint8Array) => {
      signed.push(message)
      return { bytes: Buffer.from(message).toString('base64'), signature: 'proof' }
    },
    disconnect: async () => void disconnected.push('wallet'),
  })
  const site = await start(SITE_MODULES, { seat: false, account: { wallet } })
  expect(site.state().session).toMatchObject({ sign_in: { status: 'idle', error: null }, wallets: [], wallet: null })
  // Signed out, the site reads the public stage at once: no address, no seat.
  const open = site.socket()
  expect(open.url.searchParams.get('address')).toBeNull()
  expect(site.state().session.link_status).toBe('connecting')
  // Nothing leaves before the server accepts the link; the market's observation waits for the acceptance.
  site.dispatch({ type: 'market/observed', query: { kind: 'types' } })
  site.dispatch({ type: 'server/send', packet: { type: 'packet/ping', id: 99 } })
  expect(open.sent).toEqual([])
  site.receive({ type: 'packet/connection_accepted', stage: 'open' })
  expect(site.state().session.link_status).toBe('ready')
  expect(site.sent('packet/market_observe')).toEqual([
    { type: 'packet/market_observe', observation: { kind: 'types', request: 1 } },
  ])
  site.receive(heartbeat, { type: 'packet/error', reason: 'SERVER_BUSY' }, { type: 'packet/error', id: 7, reason: 'X' })
  expect(site.state().session).toMatchObject({ online: 4, online_characters: 3, link_error: 'SERVER_BUSY' })
  expect(site.state().marketplace.volume).toEqual(heartbeat.market_volume)
  expect(site.state().chain_clock).not.toBeNull()

  site.dispatch({ type: 'auth/login_google' })
  const attempt = site.state().session.sign_in
  expect(attempt).toEqual({ status: 'connecting', request: 'google' })
  // A second sign-in while one runs is refused by the reducer: one sign-in, one effect.
  site.dispatch({ type: 'auth/login_google' })
  expect(site.state().session.sign_in).toBe(attempt)
  await settle()
  expect(site.state().session).toMatchObject({
    sign_in: { status: 'idle', error: null },
    wallet,
    sui_balance_mist: 50_000_000_000n,
  })
  expect(site.state().session.kares_balance).toBe(7n)
  expect(site.storage.getItem('last_wallet')).toBe(REMEMBERED)
  expect(open.closed).toEqual({ code: 1000, reason: 'CLIENT_CLOSED' })
  const account_link = site.socket()
  expect(account_link.url.searchParams.get('address')).toBe(wallet.address)
  expect(account_link.url.searchParams.get('seat')).toBeNull()

  // The server challenges the account's link; the proof answers on the socket that asked.
  site.receive({ type: 'packet/signature_request', payload: 'challenge-1' })
  await settle()
  expect(signed).toHaveLength(1)
  expect(account_link.sent.map(({ type }) => type)).toEqual(['packet/signature_response'])
  site.receive({ type: 'packet/connection_accepted', stage: 'signed', address: wallet.address })
  expect(site.state().session.link_status).toBe('connected')
  // The market view still on screen is asked again on the new link, under the request of the new viewer.
  expect(site.sent('packet/market_observe')).toHaveLength(1)
  // The roster is the account link's ready barrier.
  site.receive({ type: 'packet/characters', characters: [character_row('0xc1'), character_row('0xc2')] })
  expect(site.state().session).toMatchObject({ link_status: 'ready', roster_loaded: true })
  expect(site.state().session.characters.map(({ id }) => id)).toEqual(['0xc1', '0xc2'])
  site.dispatch({ type: 'character/select', character_id: '0xc2' })
  site.dispatch({ type: 'character/select', character_id: '0xunknown' })
  expect(site.state().session.selected_character_id).toBe('0xc2')
  expect(site.storage.getItem('aresrpg.selected_character')).toBe('0xc2')
  // The link measures its latency once accepted.
  const [ping] = site.sent('packet/ping')
  expect(ping).toBeDefined()
  site.receive({ type: 'packet/pong', id: (ping as { id: number }).id })
  expect(site.state().session.latency_ms).toBeNumber()

  // A sign-out forgets the wallet before releasing it, ends the account link and returns to the open stage.
  site.dispatch({ type: 'auth/disconnected', then: 'home' })
  await settle()
  expect(site.state().session).toMatchObject({
    wallet: null,
    sign_in: { status: 'idle' },
    characters: [],
    latency_ms: null,
  })
  expect(site.storage.getItem('last_wallet')).toBeNull()
  expect(disconnected).toEqual(['wallet'])
  expect(account_link.closed).toEqual({ code: 1000, reason: 'CLIENT_CLOSED' })
  expect(site.socket().url.searchParams.get('address')).toBeNull()
  expect(globalThis.location.pathname).toBe('/')
  // Signed out, a view about the account holds the one sign-in in its page; every other address keeps it in the bar.
  const holds_sign_in = (href: string): boolean => {
    site.dispatch({ type: 'location/open', href })
    return is_account_view(site.state().location)
  }
  expect(
    [...SITE_PAGES.map(({ path }) => path), ...STAKING_SECTIONS.map(staking_section_href)].filter(holds_sign_in)
  ).toEqual(['/agent', '/portfolio', '/staking#mastery', '/staking#airdrop'])
  // The buy link names KARES by its full type; a name alone would also match the dead sale coin.
  expect(kares_trade_href('0x079e59bdc768130c8c5f0f4e1f4ce33380960af0699b1281ffbf52aedbcf20e2::kares::KARES')).toBe(
    'https://aftermath.finance/trade?from=SUI&to=0x079e59bdc768130c8c5f0f4e1f4ce33380960af0699b1281ffbf52aedbcf20e2%3A%3Akares%3A%3AKARES'
  )
  expect([kares_trade_href(undefined), kares_trade_href('')]).toEqual([
    'https://aftermath.finance/trade',
    'https://aftermath.finance/trade',
  ])
})

test('the site opens one open link at start, and a sign-in replaces that one link', async () => {
  const site = await start(SITE_MODULES, { seat: false, account: { wallet: fake_wallet() } })
  expect(site.sockets()).toHaveLength(1)
  site.dispatch({ type: 'auth/login_google' })
  await settle()
  expect(site.sockets().filter(({ closed }) => closed === null)).toHaveLength(1)
})

test('the game restores a remembered wallet before its first render and takes the seat; a refused proof ends it', async () => {
  const wallet = fake_wallet()
  const game = await start(GAME_MODULES, { seat: true, account: { wallet, remembered: REMEMBERED } })
  // The restore started from the first state: the player never passes through the sign-in card.
  expect(game.state().session.wallet).toBe(wallet)
  const seat = game.socket()
  expect(game.sockets()).toHaveLength(1)
  expect(seat.url.searchParams.get('address')).toBe(wallet.address)
  expect(seat.url.searchParams.get('seat')).toBe('1')
  game.receive({ type: 'packet/connection_accepted', stage: 'seated', address: wallet.address })
  game.receive({ type: 'packet/characters', characters: [] })
  expect(game.state().session).toMatchObject({ link_status: 'ready', roster_loaded: true, characters: [] })
  // The server refuses the address proof: the session ends with a persistent notice and the game opens no link.
  seat.drop(1008, 'INVALID_SIGNATURE')
  await settle()
  expect(game.state().session).toMatchObject({
    wallet: null,
    sign_in: { status: 'idle', error: 'INVALID_SIGNATURE' },
    link_status: 'idle',
  })
  expect(game.toasts().some(({ type, persistent }) => type === 'error' && persistent)).toBe(true)
  expect(game.sockets()).toHaveLength(1)
  expect(game.storage.getItem('last_wallet')).toBeNull()
})

test('a takeover parks the link for good, a violation retries slowly, a plain loss backs off and reconnects', async () => {
  const wallet = fake_wallet()
  const game = await start(GAME_MODULES, { seat: true, account: { wallet, remembered: REMEMBERED } })
  game.receive({ type: 'packet/connection_accepted', stage: 'seated', address: wallet.address })
  jest.useFakeTimers()
  try {
    game.socket().drop(1008, 'SPEED')
    expect(game.state().session).toMatchObject({ link_status: 'idle', link_violation: 'SPEED', link_error: 'SPEED' })
    jest.advanceTimersByTime(59_000)
    expect(game.sockets()).toHaveLength(1)
    jest.advanceTimersByTime(1_000)
    expect(game.sockets()).toHaveLength(2)
    game.receive({ type: 'packet/connection_accepted', stage: 'seated', address: wallet.address })
    expect(game.state().session).toMatchObject({ link_status: 'connected', link_violation: null })

    game.socket().drop(1006, '')
    expect(game.state().session).toMatchObject({ link_status: 'connecting', link_error: 'Connection lost' })
    jest.advanceTimersByTime(1_000)
    expect(game.sockets()).toHaveLength(3)

    game.socket().drop(1000, 'REPLACED')
    expect(game.state().session.link_status).toBe('replaced')
    jest.advanceTimersByTime(120_000)
    expect(game.sockets()).toHaveLength(3)
  } finally {
    jest.useRealTimers()
  }
})

test('a remembered wallet that no longer restores is forgotten, said once, and the site keeps reading', async () => {
  const site = await start(SITE_MODULES, {
    seat: false,
    account: { wallet: null, remembered: REMEMBERED, restore_error: new Error('zkLogin session expired') },
  })
  await settle()
  expect(site.state().session).toMatchObject({
    wallet: null,
    sign_in: { status: 'idle', error: 'zkLogin session expired' },
  })
  expect(site.storage.getItem('last_wallet')).toBeNull()
  expect(site.toasts().filter(({ type }) => type === 'error')).toHaveLength(1)
  expect(site.socket().closed).toBeNull()
  expect(site.socket().url.searchParams.get('address')).toBeNull()
  // A sign-in that the player cancels is an error too, and leaves the account signed out.
  site.dispatch({ type: 'auth/login_google' })
  await settle()
  expect(site.state().session).toMatchObject({ wallet: null, sign_in: { status: 'idle', error: 'Sign-in cancelled' } })
  expect(site.toasts().filter(({ type }) => type === 'error')).toHaveLength(2)
  // Each attempt is its own object: an answer to an earlier attempt cannot complete a later one.
  site.dispatch({ type: 'auth/login_google' })
  const first = site.state().session.sign_in
  site.dispatch({ type: 'auth/failed', error: 'closed' })
  site.dispatch({ type: 'auth/login_google' })
  expect(site.state().session.sign_in).toMatchObject({ status: 'connecting', request: 'google' })
  expect(site.state().session.sign_in).not.toBe(first)
})
