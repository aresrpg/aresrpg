// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { BotGrant } from '@aresrpg/protocol/hosted-bot-client'

import {
  authorization_request,
  dapp_consent_requested,
  grant_store,
  is_callback,
  own_callback,
  read_pending,
  save_pending,
  without_callback,
  type DappStorage,
} from '../../src/dapp/oauth.ts'

const memory = (): DappStorage => {
  const rows = new Map<string, string>()
  return {
    getItem: (key) => rows.get(key) ?? null,
    setItem: (key, value) => void rows.set(key, value),
    removeItem: (key) => void rows.delete(key),
  }
}
const pending = {
  client_id: 'c',
  redirect_uri: 'https://g/dapp',
  scope: 'bot:observe',
  state: 's',
  verifier: 'v',
  expires_at: 2_000,
}
const grant: BotGrant = {
  issuer: 'https://bot.example.test',
  client_id: 'c',
  access_token: 'g.a',
  refresh_token: 'g.r',
  scope: 'bot:observe bot:play bot:pause',
  expires_at: 901_000,
  identity: {
    owner: '0xowner',
    bot_id: 'bot',
    address: '0xagent',
    descriptor: 'descriptor',
    generation: 1,
    grant_id: 'grant',
    expires_at: 99_999_999,
    network: 'mainnet',
  },
}

test('the dapp asks for play consent that returns to its own page', () => {
  expect(authorization_request('https://game.example.test')).toEqual({
    client_name: 'AresRPG web dapp',
    redirect_uri: 'https://game.example.test/dapp',
    scope: 'bot:observe bot:play bot:pause',
    ttl_ms: 600_000,
  })
})

test('only the tab holding a live pending request claims the bot consent redirect', () => {
  const storage = memory()
  const consent = { pathname: '/world', search: '?intent=connect-agent&authorization_id=abc' }
  expect(dapp_consent_requested(consent, read_pending(storage, 1_000))).toBe(false)
  expect(save_pending(storage, pending)).toBe(true)
  expect(read_pending(storage, 1_000)).toEqual(pending)
  expect(dapp_consent_requested(consent, read_pending(storage, 1_000))).toBe(true)
  expect(dapp_consent_requested(consent, read_pending(storage, 3_000))).toBe(false)
  expect(dapp_consent_requested({ pathname: '/world', search: '?intent=connect-agent' }, pending)).toBe(false)
  expect(dapp_consent_requested({ pathname: '/world', search: '' }, pending)).toBe(false)
  save_pending(storage, null)
  expect(read_pending(storage, 1_000)).toBeNull()
  expect(save_pending(null, pending)).toBe(false)
})

test('a callback carries a code or an error, and its parameters leave the address bar', () => {
  expect(is_callback('?x=1')).toBe(false)
  expect(is_callback('?code=a.b&state=s')).toBe(true)
  expect(is_callback('?error=access_denied&state=s')).toBe(true)
  expect(without_callback('https://g/dapp?code=a&state=b&iss=c&keep=1#f')).toBe('/dapp?keep=1#f')
})

test('only a redirect to this origin’s dapp page that carries an answer is taken without a page load', () => {
  const here = 'https://game.example.test'
  expect(own_callback(`${here}/dapp?code=a.b&state=s&iss=i`, here)).toBe('/dapp?code=a.b&state=s&iss=i')
  expect(own_callback(`${here}/dapp?error=access_denied&state=s`, here)).toBe('/dapp?error=access_denied&state=s')
  for (const redirect of [
    'https://assistant.example/callback?code=a&state=s',
    'https://game.example.test.evil.example/dapp?code=a&state=s',
    'http://game.example.test/dapp?code=a&state=s',
    `${here}/dapp/extra?code=a&state=s`,
    `${here}/world?code=a&state=s`,
    `${here}/dapp`,
    `${here}/dapp?next=1`,
    'not a url',
    '',
  ])
    expect(own_callback(redirect, here)).toBeNull()
})

test('a grant persists per owner; another owner, a changed grant or a broken record is never one', () => {
  const storage = memory()
  const grants = grant_store(storage, '0xowner')
  expect(grants.read()).toBeNull()
  expect(grants.save(grant)).toBe(true)
  expect(grants.read()).toEqual(grant)
  expect(grant_store(storage, '0xother').read()).toBeNull()
  const rotated = { ...grant, access_token: 'g.a2', refresh_token: 'g.r2' }
  expect(grants.replace(grant, rotated)).toBe(true)
  // A holder that still presents the replaced grant changes nothing.
  expect(grants.replace(grant, null)).toBe(false)
  expect(grants.read()).toEqual(rotated)
  expect(grants.replace(rotated, null)).toBe(true)
  expect(grants.read()).toBeNull()
  storage.setItem('aresrpg:dapp:grant:0xowner', '{nope')
  expect(grants.read()).toBeNull()
  storage.setItem('aresrpg:dapp:grant:0xother', JSON.stringify(grant))
  expect(grant_store(storage, '0xother').read()).toBeNull()
  expect(grant_store(null, '0xowner').save(grant)).toBe(false)
})
