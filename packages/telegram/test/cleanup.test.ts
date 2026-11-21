// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import type { BotGrant } from '@aresrpg/protocol/hosted-bot-client'

import { cleanup_sender } from '../src/cleanup.ts'
import { user_id } from '../src/link.ts'

import { fixture, identity } from './helpers/connected_fixture.ts'

const env = {
  TELEGRAM_STORAGE_KEY: 'ab'.repeat(32),
  TELEGRAM_CONNECTED_CONFIG: JSON.stringify({
    issuer: 'https://bot.example',
    callback_url: 'https://companion.example/oauth/callback',
    limits: { request_ms: 1000, link_ttl_ms: 10000 },
  }),
}

test('explicit offline cleanup revokes only named sender and needs only its scoped cleanup credentials', async () => {
  const f = fixture()
  await f.link()
  const other = { ...(await f.user())!, refresh_token: 'other-refresh' }
  await f.records.change([user_id(43)], () => ({ [user_id(43)]: { value: other } }))
  const tokens: string[] = []
  await cleanup_sender(['--sender', '42'], env, f.backend, async (url, init) => {
    expect(url).toBe('https://bot.example/oauth/revoke')
    tokens.push(JSON.parse(String(init.body)).token)
    return Response.json({})
  })
  expect(tokens).toEqual(['refresh'])
  expect(await f.user()).toBeNull()
  expect(await f.records.read<BotGrant>(user_id(43))).toEqual(other)
  await expect(cleanup_sender(['--sender', '42', '--all'], env, f.backend)).rejects.toThrow(
    'cleanup_requires_exact_sender'
  )
})

test('failed cleanup preserves credentials; unknown pending exchange cannot report success', async () => {
  const f = fixture()
  await f.link()
  await expect(
    cleanup_sender(['--sender', '42'], env, f.backend, async () => {
      throw new Error('offline')
    })
  ).rejects.toThrow('unavailable')
  expect((await f.user())?.refresh_token).toBe('refresh')
  const pending = fixture()
  const { browser, query } = await pending.start()
  pending.overrides.handler = async () => {
    throw new Error('unknown exchange')
  }
  await expect(pending.links.callback(query, browser.cookie)).rejects.toThrow()
  await expect(
    cleanup_sender(['--sender', '42'], env, pending.backend, async () => {
      throw new Error('must not call')
    })
  ).rejects.toThrow('pending_exchange_outcome_unknown')
  expect((await pending.attempts())[0]?.cancelled).toBe(true)
})

test('offline cleanup retains a known pending grant on failure and deletes it only after revoke succeeds', async () => {
  const f = fixture()
  await f.exchanged()
  await expect(
    cleanup_sender(['--sender', '42'], env, f.backend, async () => {
      throw new Error('offline')
    })
  ).rejects.toThrow('unavailable')
  expect((await f.attempts())[0]?.tokens?.refresh_token).toBe('refresh')
  await cleanup_sender(['--sender', '42'], env, f.backend, async () => Response.json({}))
  expect(await f.attempts()).toEqual([])
  expect(await f.records.ids('attempts:')).toEqual([])
})

// An operator knows the owner address it admitted, never the chat id: that exists only in the encrypted index.
test('cleanup by owner address revokes that owner’s linked chat; an owner without a link is refused', async () => {
  const f = fixture()
  await f.link()
  const refuse = async () => {
    throw new Error('must not call')
  }
  await expect(cleanup_sender(['--owner', `0x${'9'.repeat(64)}`], env, f.backend, refuse)).rejects.toThrow(
    'cleanup_owner_not_linked'
  )
  await expect(cleanup_sender(['--owner', '42'], env, f.backend, refuse)).rejects.toThrow(
    'cleanup_requires_exact_sender'
  )
  expect((await f.user())?.refresh_token).toBe('refresh')
  const tokens: string[] = []
  await cleanup_sender(['--owner', identity.owner], env, f.backend, async (_url, init) => {
    tokens.push(JSON.parse(String(init.body)).token)
    return Response.json({})
  })
  expect(tokens).toEqual(['refresh'])
  expect(await f.user()).toBeNull()
})
