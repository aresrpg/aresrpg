import { readdir } from 'node:fs/promises'

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
  expect(models[3]?.content).toBe('**sceat.sui** found a **97.5% roll** on **Golden Lorito**.')
  expect(models[3]?.visual.stats.map(({ value }) => value)).toEqual([49, 48, 2])
  expect(announcement(copy, {}, examples[1]!)?.content).toContain('0xaaaa…aaaa')
})
test('a self-subname is announced by its short handle in the message and on the card', () => {
  const victory = announcement(copy, { [address]: 'sceat.sceat.sui' }, examples[2]!)!
  expect(victory.visual.party).toEqual(['@sceat'])
  expect(victory.content).toContain('sceat')
  expect(victory.content).not.toContain('sceat.sceat.sui')
  expect(announcement(copy, { [address]: 'other.sceat.sui' }, examples[2]!)?.visual.party).toEqual(['other.sceat.sui'])
})
test('ordinary gear is filtered before rendering or delivery', () => {
  const loot = examples[3]!
  if (loot.kind !== 'loot') throw new Error('bad fixture')
  expect(announcement(copy, {}, { ...loot, stats: { vitality: 20, intelligence: 1, critical: 1 } })).toBeNull()
})

test('boss drops at or below 1% ignore category and quality, without exaggerating ambiguous sources', () => {
  const loot = examples[3]!
  if (loot.kind !== 'loot') throw new Error('bad fixture')
  for (const chance_bp of [1, 100]) {
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
  }
})

test('exceptional loot names only eligible sources, independently of encounter order', () => {
  const loot = examples[3]!
  if (loot.kind !== 'loot') throw new Error('bad fixture')
  // The indexer supplies sources from defeated mobs' snapshotted loot tables.
  for (const mob_types of [
    ['nook', 'golden_lorito'],
    ['golden_lorito', 'nook'],
  ]) {
    const model = announcement(copy, { [address]: 'sceat.sui' }, { ...loot, mob_types })!
    expect(model.content).toBe('**sceat.sui** found a **97.5% roll** on **Golden Lorito**.')
    expect(model.visual.title).toBe(loot.name)
  }
})

test('exceptional loot selects only the first eligible source, retaining unknown-name fallback', () => {
  const loot = examples[3]!
  if (loot.kind !== 'loot') throw new Error('bad fixture')
  const unknown = { mob_type: 'new_creature', chance_bp: 500 }
  for (const [sources, name] of [
    [[...loot.sources, unknown], 'Golden Lorito'],
    [[unknown, ...loot.sources], 'New Creature'],
  ] as const) {
    const model = announcement(
      copy,
      { [address]: 'sceat.sui' },
      {
        ...loot,
        mob_types: ['nook', 'golden_lorito', 'new_creature'],
        sources,
      }
    )!
    expect(model.content).toBe(`**sceat.sui** found a **97.5% roll** on **${name}**.`)
    expect(model.visual.title).toBe(loot.name)
  }
})

test('every locale keeps the item on the card and the source in the exceptional-loot caption', async () => {
  const loot = examples[3]!
  if (loot.kind !== 'loot') throw new Error('bad fixture')
  const directory = new URL('../../frontend/src/i18n/locales/', import.meta.url)
  for (const file of (await readdir(directory)).filter((file) => file.endsWith('.yaml'))) {
    const translated = await load_copy(file.slice(0, -5))
    const model = announcement(translated, {}, loot)!
    expect(model.content).toContain('Golden Lorito')
    expect(model.content).toContain('97.5')
    expect(model.content).not.toContain(loot.name)
    expect(model.content).not.toMatch(/\{\w+\}/)
    expect(model.visual.title).toBe(loot.name)
  }
})
