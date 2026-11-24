import { expect, test } from 'bun:test'

import { create_discord_api } from '../src/api.ts'
import { format_sui, notification_card, notification_marker } from '../src/card.ts'
import { load_copy } from '../src/copy.ts'
import { create_forwarder } from '../src/forward.ts'
import { announcement } from '../src/model.ts'
import { parse_notification, type Notification } from '../src/notification.ts'
import { create_renderer } from '../src/render.ts'

const address = `0x${'a'.repeat(64)}`
const base = { id: '1:0:0:event', digest: '1'.repeat(44), ts_ms: 1000 }
const sale = {
  ...base,
  kind: 'sale',
  asset_kind: 'item',
  seller: address,
  name: 'Gnawed Branch',
  item_type: 'gnawed_branch',
  amount: 10,
  price_mist: '2500000000',
} as const
const loot = {
  ...base,
  kind: 'loot',
  amount: 1,
  sources: [{ mob_type: 'golden_lorito', chance_bp: 500 }],
  address,
  object: address,
  item_type: 'lorito_hat__golden',
  name: 'Golden Lorito Hood',
  category: 'hat',
  level: 16,
  stats: { vitality: 49, intelligence: 48, critical: 2 },
  mob_types: ['golden_lorito'],
} as const
const examples: readonly Notification[] = [
  sale,
  { ...base, kind: 'gather', address, item_type: 'golden_wheat', world: 'nauvis' },
  {
    ...base,
    kind: 'victory',
    fight: address,
    dungeon: 'gilded_lorito',
    winners: [address],
    mob_types: ['nook', 'golden_lorito'],
  },
  loot,
]
const ordinary = { ...loot, stats: { vitality: 20, intelligence: 1, critical: 1 } }
const copy = await load_copy('en')
const png = new Uint8Array([137, 80, 78, 71])
const mock_fetch = (handler: (url: string, options: RequestInit) => Response): typeof fetch =>
  ((url: string, options: RequestInit) => Promise.resolve(handler(url, options))) as typeof fetch

test('announcements show canonical artwork and label players by a verified name or a short address', () => {
  const models = examples.map((event) => announcement(copy, { [address]: 'sceat.sui' }, event)!)
  expect(models.map(({ visual }) => visual.image?.split('/').at(-1))).toEqual([
    'gnawed_branch.png',
    'golden_wheat.png',
    'golden_lorito.png',
    'lorito_hat__golden.png',
  ])
  expect(models[3]?.content).toBe('**@\u200bsceat** found a **97.5% roll** on **Golden Lorito**.')
  expect(models[3]?.visual.stats.map(({ value }) => value)).toEqual([49, 48, 2])
  expect(announcement(copy, {}, examples[1]!)?.content).toContain('0xaaaa…aaaa')
  for (const [name, label] of [
    ['login905.sui', '@login905'],
    ['aresrpg.sceat.sui', '@sceat'],
    ['dhuts@dhuts', '@dhuts.dhuts'],
    ['other.dhuts.sui', '@other.dhuts'],
  ])
    for (const event of examples) {
      const model = announcement(copy, { [address]: name }, event)!
      expect(model.content).toContain(label.replace('@', '@\u200b'))
      if (event.kind !== 'loot') expect([model.visual.subtitle, ...model.visual.party].join(' ')).toContain(label)
    }
})

test('loot is announced above 90% quality, or as an unambiguous boss drop at or below 1%', () => {
  expect(announcement(copy, {}, ordinary)).toBeNull()
  for (const chance_bp of [1, 100])
    for (const category of ['resource', 'pet', 'hat']) {
      const rare = { ...loot, category, stats: {}, amount: 2, sources: [{ mob_type: 'golden_lorito', chance_bp }] }
      const model = announcement(copy, {}, rare)
      expect(model?.visual.rare).toBe(true)
      expect(model?.visual.title).toBe('2× Golden Lorito Hood')
      expect(model?.content).toContain(`${chance_bp / 100}%`)
      expect(announcement(copy, {}, { ...rare, sources: [{ mob_type: 'golden_lorito', chance_bp: 101 }] })).toBeNull()
      expect(announcement(copy, {}, { ...rare, sources: [{ mob_type: 'nook', chance_bp: 100 }] })).toBeNull()
      expect(
        announcement(copy, {}, { ...rare, sources: [...rare.sources, { mob_type: 'nook', chance_bp: 5000 }] })
      ).toBeNull()
    }
})

test('exceptional loot names the first eligible source, whatever the encounter order', () => {
  const unknown = { mob_type: 'new_creature', chance_bp: 500 }
  for (const [mob_types, sources, name] of [
    [['nook', 'golden_lorito'], loot.sources, 'Golden Lorito'],
    [['golden_lorito', 'nook'], loot.sources, 'Golden Lorito'],
    [['nook', 'golden_lorito', 'new_creature'], [...loot.sources, unknown], 'Golden Lorito'],
    [['nook', 'golden_lorito', 'new_creature'], [unknown, ...loot.sources], 'New Creature'],
  ] as const) {
    const model = announcement(copy, { [address]: 'sceat.sui' }, { ...loot, mob_types, sources })!
    expect(model.content).toBe(`**@\u200bsceat** found a **97.5% roll** on **${name}**.`)
    expect(model.visual.title).toBe(loot.name)
  }
})

test('received events with unsafe filenames, quantities or chances are refused', () => {
  expect(parse_notification(sale)).toEqual(sale)
  expect(() => parse_notification({ ...sale, item_type: '../../token' })).toThrow()
  expect(() => parse_notification({ ...sale, amount: 1.1 })).toThrow()
  expect(() => parse_notification({ ...sale, price_mist: '0' })).toThrow()
  for (const chance_bp of [-1, 10001, 0.1])
    expect(() => parse_notification({ ...loot, sources: [{ mob_type: 'golden_lorito', chance_bp }] })).toThrow()
})

test('the card is a bare attachment with exact SUI amounts that cannot mention anyone', () => {
  expect(format_sui('2500000000')).toBe('2.5')
  expect(format_sui('1')).toBe('0.000000001')
  expect(format_sui('9007199254740993')).toBe('9007199.254740993')
  const model = announcement(copy, { [address]: '**@everyone**' }, sale)!
  const card = notification_card(model.content, 'marker')
  expect(card.content).toContain('10× Gnawed Branch')
  expect(card.content).toContain('2.5 SUI')
  expect(card.content).not.toContain('@everyone')
  expect(card).not.toHaveProperty('embeds')
  expect(card.nonce).toBe('marker')
  expect(card.allowed_mentions.parse).toEqual([])
  expect(model.visual.currency).toBe(true)
  expect(notification_marker('channel-a', sale.id)).not.toBe(notification_marker('channel-b', sale.id))
})

test('delivery authenticates, honours explicit rate limits, never replays a failure and checks credentials', async () => {
  const card = notification_card('Sold an item', 'abc')
  const calls: string[] = []
  const limited = create_discord_api(
    'test-token',
    '123',
    mock_fetch((url, options) => {
      expect(url).toBe('https://discord.com/api/v10/channels/123/messages')
      expect(new Headers(options.headers).get('Authorization')).toBe('Bot test-token')
      const body = options.body as FormData
      expect(JSON.parse(String(body.get('payload_json'))).content).toBe('Sold an item')
      expect((body.get('files[0]') as File).name).toBe('ares-abc.png')
      calls.push(url)
      return calls.length === 1 ? Response.json({ retry_after: 0.001 }, { status: 429 }) : Response.json({ id: '42' })
    })
  )
  expect(await limited.send(card, png, 'abc')).toBe('42')
  expect(calls).toHaveLength(2)
  const failing = create_discord_api(
    'test-token',
    '123',
    mock_fetch(() => {
      calls.push('failed')
      return new Response('', { status: 503 })
    })
  )
  await expect(failing.send(card, png, 'abc')).rejects.toThrow('503')
  expect(calls).toHaveLength(3)
  const refused = create_discord_api(
    'test-token',
    '123',
    mock_fetch(() => new Response('', { status: 401 }))
  )
  await expect(refused.identity()).rejects.toThrow('401')
})

test('the forwarder renders and posts eligible events only, as PNG cards', async () => {
  const sent: string[] = []
  const forward = create_forwarder({
    copy,
    scope: 'test',
    resolve_name: async () => 'x'.repeat(200),
    render: await create_renderer(),
    send: async (card, image) => {
      expect([...image.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
      sent.push(card.content)
      return '42'
    },
  })
  const rare = { ...loot, stats: {}, sources: [{ mob_type: 'golden_lorito', chance_bp: 100 }] }
  const long_sale = { ...sale, name: 'M'.repeat(512), price_mist: '18446744073709551615' }
  for (const event of [...examples, rare, long_sale]) expect(await forward(JSON.stringify(event))).toBe('42')
  expect(sent).toHaveLength(6)
  expect(await forward(JSON.stringify(ordinary))).toBeNull()
  expect(sent).toHaveLength(6)
  await expect(forward('bad json')).rejects.toThrow()
})
