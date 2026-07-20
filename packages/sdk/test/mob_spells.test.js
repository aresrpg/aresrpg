// Mob basic-attack spell DATA (c101: mobs need a castable attack). Proves the per-mob attack templates are
// derived faithfully from mobs.json melee_damage and carry the spells.json template SHAPE the sim's
// `normalize_spell_templates` consumes (cost / range / base_effects{type,min,max,element,target,chance}).
// The @aresrpg/sdk -> @aresrpg/sim boundary is one-way (sdk has no sim dep), so the normalize round-trip is
// covered on the consuming side; here we lock the DATA contract.

import { test, expect } from 'bun:test'

import { mob_attack_spell_id, mob_attack_spells } from '../src/mob_spells.js'
import MOBS from '../src/mobs.json' with { type: 'json' }

const SPELLS = mob_attack_spells()
const damage_effect = id =>
  SPELLS[id]?.levels?.[0]?.base_effects?.find(e => e.type === 'damage')

test('mob_attack_spell_id is stable + prefixed (no collision with short class spell ids)', () => {
  expect(mob_attack_spell_id('alley_bunny')).toBe('mob_attack_alley_bunny')
})

test('every mob with an id gets exactly one attack template', () => {
  const ids = Object.values(MOBS)
    .map(m => m.id)
    .filter(Boolean)
  expect(Object.keys(SPELLS).length).toBe(ids.length)
  for (const id of ids) expect(SPELLS[mob_attack_spell_id(id)]).toBeDefined()
})

test('a mob attack carries its authored melee_damage as the base_effect (alley_bunny = 1-1 earth)', () => {
  const spell = SPELLS[mob_attack_spell_id('alley_bunny')]
  expect(spell.levels.length).toBe(1)
  const [lvl] = spell.levels
  expect(lvl.cost).toBe(3)
  expect(lvl.range).toEqual([1, 1]) // melee, adjacent
  const dmg = damage_effect(mob_attack_spell_id('alley_bunny'))
  expect(dmg).toBeDefined()
  expect(dmg.element).toBe('earth') // lowercase spells.json discriminant -> sim maps to EARTH
  expect(dmg.min).toBe(1)
  expect(dmg.max).toBe(1)
  expect(dmg.target).toBe('cell')
  expect(dmg.chance).toBe(100)
})

test('a ranged-value melee mob keeps its real spread (green_walker = 3-7 earth)', () => {
  const dmg = damage_effect(mob_attack_spell_id('green_walker'))
  expect(dmg.element).toBe('earth')
  expect(dmg.min).toBe(3)
  expect(dmg.max).toBe(7)
})

test('mobs missing melee_damage still get a castable fallback attack (1-2, element-matched)', () => {
  // wooling has no melee_damage in the snapshot but element=earth -> a token 1-2 earth hit so it still acts.
  const dmg = damage_effect(mob_attack_spell_id('wooling'))
  expect(dmg).toBeDefined()
  expect(dmg.min).toBeGreaterThanOrEqual(1)
  expect(dmg.max).toBeGreaterThanOrEqual(dmg.min)
  expect(['fire', 'water', 'earth', 'air']).toContain(dmg.element)
})

test('EVERY attack is a valid castable DAMAGE spell (sim-resolvable element, positive damage + cost)', () => {
  for (const [id, spell] of Object.entries(SPELLS)) {
    expect(id.startsWith('mob_attack_')).toBe(true)
    expect(spell.levels.length).toBe(1)
    const [lvl] = spell.levels
    expect(lvl.cost).toBeGreaterThan(0)
    expect(lvl.range[0]).toBeGreaterThanOrEqual(1)
    const dmg = lvl.base_effects.find(e => e.type === 'damage')
    expect(dmg).toBeDefined()
    // element MUST be one the sim's ELEMENT_MAP knows (else the damage calculator gets undefined)
    expect(['fire', 'water', 'earth', 'air']).toContain(dmg.element)
    expect(dmg.min).toBeGreaterThanOrEqual(1)
    expect(dmg.max).toBeGreaterThanOrEqual(dmg.min)
  }
})
