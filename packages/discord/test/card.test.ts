import { expect, test } from 'bun:test'

import { load_copy } from '../src/copy.ts'
import { notification_card, notification_marker, format_sui } from '../src/card.ts'
import { parse_notification } from '../src/notification.ts'
import { announcement } from '../src/model.ts'

const row = {
  id: '11:0:1:sale',
  seller: `0x${'a'.repeat(64)}`,
  digest: '1'.repeat(44),
  kind: 'sale',
  asset_kind: 'item',
  name: 'Gnawed branch',
  item_type: 'gnawed_branch',
  amount: 10,
  price_mist: '2500000000',
  ts_ms: 1000,
}

test('exact MIST formatting never rounds through a floating point number', () => {
  expect(format_sui('2500000000')).toBe('2.5')
  expect(format_sui('1')).toBe('0.000000001')
  expect(format_sui('9007199254740993')).toBe('9007199.254740993')
})
test('the card posts as a bare attachment, carries its marker, and untrusted names cannot create mentions', async () => {
  const model = announcement(await load_copy('en'), { [row.seller]: '**@everyone**' }, parse_notification(row))!
  const card = notification_card(model.content, 'marker', row.digest, 'mainnet')
  expect(card.content).toContain('10× Gnawed branch')
  expect(card.content).toContain('2.5 SUI')
  expect(card.content).not.toContain('@everyone')
  expect(card).not.toHaveProperty('embeds')
  expect(card.nonce).toBe('marker')
  expect(card.allowed_mentions.parse).toEqual([])
  expect(model.visual.currency).toBe(true)
  expect(notification_marker('channel-a', row.id)).not.toBe(notification_marker('channel-b', row.id))
})
test('received event validation rejects unsafe filenames and invalid quantities', () => {
  expect(() => parse_notification({ ...row, item_type: '../../token' })).toThrow()
  expect(() => parse_notification({ ...row, amount: 1.1 })).toThrow()
  expect(() => parse_notification({ ...row, price_mist: '0' })).toThrow()
})
test('every supported locale renders the same sale fields without missing placeholders', async () => {
  const glob = new Bun.Glob('*.yaml')
  const directory = new URL('../../frontend/src/i18n/locales/', import.meta.url).pathname
  for await (const file of glob.scan(directory)) {
    const copy = await load_copy(file.replace('.yaml', ''))
    const model = announcement(copy, { [row.seller]: 'sceat.sui' }, parse_notification(row))!
    expect(model.content).toContain('sceat.sui')
    expect(model.content).toContain('2.5 SUI')
    expect(model.content).not.toMatch(/\{\w+\}/)
  }
})
