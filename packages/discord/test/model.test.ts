import { expect, test } from 'bun:test'

import { announcement } from '../src/model.ts'
import { load_copy } from '../src/copy.ts'

import { examples, address } from './fixtures.ts'

const copy = await load_copy('en')

test('all four types select canonical artwork and use verified names or addresses', () => {
  const models = examples.map((event) => announcement(copy, { [address]: 'sceat.sui' }, event)!)
  expect(models.map(({ visual }) => visual.image?.split('/').at(-1))).toEqual([
    'gnawed_branch.png',
    'golden_wheat.png',
    'golden_lorito.png',
    'lorito_hat__golden.png',
  ])
  expect(models[2]?.visual.party).toEqual(['sceat.sui'])
  expect(models[3]?.visual.summary).toBe('97.5%')
  expect(models[3]?.visual.stats.map(({ value }) => value)).toEqual([49, 48, 2])
  expect(announcement(copy, {}, examples[1]!)?.content).toContain('0xaaaa…aaaa')
})
test('ordinary gear is filtered before rendering or delivery', () => {
  const loot = examples[3]!
  if (loot.kind !== 'loot') throw new Error('bad fixture')
  expect(announcement(copy, {}, { ...loot, stats: { vitality: 20, intelligence: 1, critical: 1 } })).toBeNull()
})
