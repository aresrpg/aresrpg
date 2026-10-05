import { expect, test } from 'bun:test'

import { create_discord_api } from '../src/api.ts'
import { notification_card } from '../src/card.ts'

const card = notification_card('Sold an item', 'abc', '1'.repeat(44), 'mainnet')
const png = new Uint8Array([137, 80, 78, 71])
const mock_fetch = (handler: (url: string, options: RequestInit) => Response): typeof fetch =>
  ((url: string, options: RequestInit) => Promise.resolve(handler(url, options))) as typeof fetch

test('forwards the card and PNG with bot authentication and respects explicit rate limits', async () => {
  let calls = 0
  const api = create_discord_api(
    'test-token',
    '123',
    mock_fetch((url, options) => {
      expect(url).toBe('https://discord.com/api/v10/channels/123/messages')
      expect(new Headers(options.headers).get('Authorization')).toBe('Bot test-token')
      const body = options.body as FormData
      expect(JSON.parse(String(body.get('payload_json'))).content).toContain('Sold an item')
      expect((body.get('files[0]') as File).name).toBe('ares-abc.png')
      calls++
      return calls === 1 ? Response.json({ retry_after: 0.001 }, { status: 429 }) : Response.json({ id: '42' })
    })
  )
  expect(await api.send(card, png, 'abc')).toBe('42')
  expect(calls).toBe(2)
})
test('failed requests are reported without replaying the message', async () => {
  let calls = 0
  const api = create_discord_api(
    'test-token',
    '123',
    mock_fetch(() => {
      calls++
      return new Response('', { status: 503 })
    })
  )
  await expect(api.send(card, png, 'abc')).rejects.toThrow('503')
  expect(calls).toBe(1)
})
test('invalid bot credentials fail before subscribing', async () => {
  const api = create_discord_api(
    'test-token',
    '123',
    mock_fetch(() => new Response('', { status: 401 }))
  )
  await expect(api.identity()).rejects.toThrow('401')
})
