import { expect, test } from 'bun:test'

import { create_forwarder } from '../src/forward.ts'
import { load_copy } from '../src/copy.ts'

import { examples } from './fixtures.ts'

test('only eligible received events are rendered and forwarded', async () => {
  const sent: string[] = []
  let rendered = 0
  const forward = create_forwarder({
    copy: await load_copy('en'),
    scope: 'test',
    network: 'mainnet',
    resolve_name: async () => 'sceat.sui',
    render: async () => {
      rendered++
      return new Uint8Array([137, 80, 78, 71])
    },
    send: async (card) => {
      sent.push(card.content)
      return '42'
    },
  })
  for (const event of examples) expect(await forward(JSON.stringify(event))).toBe('42')
  expect(sent).toHaveLength(4)
  expect(rendered).toBe(4)
  const loot = examples[3]!
  if (loot.kind !== 'loot') throw new Error('invalid fixture')
  expect(await forward(JSON.stringify({ ...loot, stats: { vitality: 20, intelligence: 1, critical: 1 } }))).toBeNull()
  expect(sent).toHaveLength(4)
  expect(rendered).toBe(4)
  await expect(forward('bad json')).rejects.toThrow()
})
