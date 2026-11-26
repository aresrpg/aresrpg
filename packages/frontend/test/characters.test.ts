// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// A hero and its bag through the game's real store: the roster the server sends, and the receipts of the account's
// own transactions, which are the client's truth until the next snapshot. Each fold is the twin of a Move rule.
import { afterEach, expect, jest, test } from 'bun:test'
import { item_stat_center as SHIFT } from '@aresrpg/immutable'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'
import { character_max_hp, fold_equipment_stats, projected_hp } from '@aresrpg/protocol/character-stats'

import type { AuthSession } from '../src/auth.ts'
import { character_deletion_blockers } from '../src/characters/character_deletion.ts'
import {
  equip_refusal,
  equipment_change_set,
  equipment_map_of,
  natural_slot_for,
  stage_equip,
  stage_unequip,
} from '../src/characters/equipment_stage.ts'
import { GAME_MODULES } from '../src/game/game_modules.ts'
import { copy_text, load_app_copy } from '../src/i18n/copy.ts'
import { LOCALES } from '../src/i18n/locale.ts'
import {
  available_inventory_items,
  craft_stack_plan,
  encumbered_asset_ids,
  stack_merge_target,
  trade_stack_targets,
} from '../src/inventory_stacks.ts'

import { character_row, fake_wallet, sign_in, start_surface, type Started } from './harness.ts'

const running: Started[] = []
afterEach(() => running.splice(0).forEach(({ stop }) => stop()))
const start_game = async (characters: readonly CharacterRow[], inventory: readonly ItemRow[]): Promise<Started> => {
  const game = await start_surface(GAME_MODULES, {
    seat: true,
    account: { wallet: fake_wallet(), remembered: 'Sign in with Google' },
  })
  running.push(game)
  await sign_in(game, { characters, inventory })
  return game
}
const hero = (overrides: Partial<CharacterRow> = {}): CharacterRow =>
  character_row('0xchar', {
    level: 10,
    vitality: 10,
    strength: 5,
    available_points: 12,
    available_spell_points: 9,
    kiosk: '0xkiosk',
    ...overrides,
  })
const item = (id: string, overrides: Partial<ItemRow> = {}): ItemRow => ({
  id,
  name: 'Veteran Title',
  item_type: 'title_veteran',
  category: 'title',
  level: 5,
  amount: 1,
  kiosk: '0xkiosk',
  ...overrides,
})
const amounts = (game: Started, ...rows: readonly (readonly [string, number])[]) =>
  game.dispatch({
    type: 'inventory/amounts_changed',
    changes: rows.map(([id, amount]) => ({ id, amount, version: '1' })),
  })
const row = (game: Started, id = '0xchar') => game.state().session.characters.find((character) => character.id === id)!
const bag = (game: Started) => game.state().session.inventory

test('a hero spends its points and gear by receipt, as progression.move and equipment.move fold them', async () => {
  const title = item('0xtitle', { stats: { vitality: SHIFT + 20 } })
  const better = item('0xbetter', { stats: { vitality: SHIFT + 29 } })
  const game = await start_game(
    [hero({ intelligence: 19, spells: { fracture: 3 } }), hero({ id: '0xikari', classe: 'ikari', vitality: 0 })],
    [title, better]
  )

  game.dispatch({
    type: 'character/equip_folded',
    character_id: '0xchar',
    equipped: [{ slot: 'title', item_id: title.id }],
    unequipped: [],
  })
  expect(row(game).equipment.map(({ id, slot }) => ({ id, slot }))).toEqual([{ id: title.id, slot: 'title' }])
  expect(row(game).folded_stats?.vitality).toBe(SHIFT + 20)
  expect(bag(game).map(({ id }) => id)).toEqual([better.id])
  // A replace unequips and equips the same slot in one receipt; a repeated roster snapshot keeps the selection.
  game.dispatch({ type: 'character/select', character_id: '0xikari' })
  game.dispatch({
    type: 'character/equip_folded',
    character_id: '0xchar',
    equipped: [{ slot: 'title', item_id: better.id }],
    unequipped: [{ slot: 'title', item_id: title.id }],
  })
  expect(row(game).folded_stats?.vitality).toBe(SHIFT + 29)
  game.receive({ type: 'packet/characters', characters: [...game.state().session.characters] })
  expect(game.state().session.selected_character_id).toBe('0xikari')
  expect(bag(game).map(({ id, kiosk }) => ({ id, kiosk }))).toEqual([{ id: title.id, kiosk: '0xkiosk' }])

  // Intelligence past 20 costs two points each; an Ikari gains two vitality per point.
  const before = { vitality: 10, wisdom: 0, strength: 5, intelligence: 19, chance: 0, agility: 0 }
  game.dispatch({ type: 'character/stats_raised', character_id: '0xchar', spending: { intelligence: 3 }, before })
  expect(row(game)).toMatchObject({ intelligence: 21, available_points: 9 })
  // The roster stream carried the change first: the receipt, priced from the old row, is not folded twice.
  game.dispatch({ type: 'character/stats_raised', character_id: '0xchar', spending: { intelligence: 3 }, before })
  expect(row(game)).toMatchObject({ intelligence: 21, available_points: 9 })
  const ikari = { ...before, vitality: 0, strength: 5, intelligence: 0 }
  game.dispatch({ type: 'character/stats_raised', character_id: '0xikari', spending: { vitality: 3 }, before: ikari })
  expect(row(game, '0xikari')).toMatchObject({ vitality: 6, available_points: 9 })
  // A spell from level n costs n points; an unlearned spell starts at level one.
  game.dispatch({ type: 'character/spell_raised', character_id: '0xchar', spell: 'fracture', before: 3 })
  game.dispatch({ type: 'character/spell_raised', character_id: '0xchar', spell: 'fracture', before: 3 })
  game.dispatch({ type: 'character/spell_raised', character_id: '0xchar', spell: 'ember', before: 1 })
  expect(row(game)).toMatchObject({ spells: { fracture: 4, ember: 2 }, available_spell_points: 5 })
  // Resets give back exactly what the chain gives back.
  game.dispatch({
    type: 'character/consumed',
    digest: '0xspells',
    character_id: '0xchar',
    item_id: '0xreset',
    effect: 'reset_spells',
    heal: 0,
    before: {},
  })
  expect(row(game)).toMatchObject({ spells: {}, available_spell_points: 9 })
  game.dispatch({
    type: 'character/consumed',
    digest: '0xstats',
    character_id: '0xchar',
    item_id: '0xreset',
    effect: 'reset_stats',
    heal: 0,
    before: {},
  })
  expect(row(game)).toMatchObject({ vitality: 0, available_points: 45 })
  // A star gate re-points the world and the checkpoint; an unknown hero changes nothing.
  game.dispatch({
    type: 'character/world_joined',
    character_id: '0xchar',
    joined: { world: 'yakutia', x: 50_000, z: 50_000, first_join: false },
  })
  expect(row(game)).toMatchObject({ world: 'yakutia', checkpoint_world: 'yakutia', x: 50_000, z: 50_000 })
  const unchanged = game.state()
  game.dispatch({
    type: 'character/world_joined',
    character_id: '0xghost',
    joined: { world: 'yakutia', x: 0, z: 0, first_join: true },
  })
  expect(game.state()).toBe(unchanged)

  // The stat twins of item_stats.move and progression.move.
  const folded = fold_equipment_stats([
    { slot: 'title', ...item('a', { stats: { vitality: SHIFT + 30, agility: SHIFT - 10 } }) } as never,
    { slot: 'boots', ...item('b', { stats: { vitality: SHIFT + 12 } }) } as never,
  ])
  expect(folded).toMatchObject({ vitality: SHIFT + 42, agility: SHIFT - 10, strength: SHIFT })
  expect(
    fold_equipment_stats([
      { slot: 'title', ...item('c', { stats: { vitality: SHIFT - 20_000 } }) } as never,
      { slot: 'boots', ...item('d', { stats: { vitality: SHIFT - 20_000 } }) } as never,
    ]).vitality
  ).toBe(0)
  expect(
    fold_equipment_stats([
      { slot: 'pet', ...item('p', { category: 'pet', stats: { vitality: SHIFT + 60 }, pet_power: 30 }) } as never,
    ]).vitality
  ).toBe(SHIFT + 30)
  expect(character_max_hp(hero({ folded_stats: { vitality: SHIFT + 20 } }))).toBe(50 + 50 + 10 + 20)
  const now = Date.now()
  expect(projected_hp(hero({ hp: '40', hp_ms: now - 10_000 }), now)).toBe(50)
  expect(projected_hp(hero({ hp: '1', hp_ms: now }), now + 999)).toBe(1)
  expect(projected_hp(hero(), now)).toBe(110)
  expect(character_max_hp(hero({ level: 1, vitality: 0, folded_stats: { vitality: SHIFT - 60_000 } }))).toBe(1)
})

test('the bag folds its receipts: crafts, consumables, boxes, crushes, pet meals, scribes and removals', async () => {
  const wool = item('0xwool', { category: 'resource', item_type: 'wool', amount: 5 })
  const dust = item('0xdust', { category: 'resource', item_type: 'wool', amount: 3 })
  const potion = item('0xpotion', { category: 'consumable', item_type: 'small_potion', amount: 2 })
  const box = item('0xbox', { category: 'consumable', item_type: 'mystery_box', amount: 2 })
  const pet = item('0xpet', { category: 'pet', item_type: 'tofu', pet_power: 4 })
  const food = item('0xfood', { category: 'resource', item_type: 'wheat', amount: 2 })
  const gear = item('0xgear', { stats: { vitality: SHIFT + 10, chance: SHIFT + 5 }, puits: '4' })
  const rune = item('0xrune', { category: 'rune', item_type: 'rune_vitality_ba', amount: 2 })
  const old_gear = item('0xold', { category: 'hat', item_type: 'hat' })
  const game = await start_game(
    [hero({ jobs: { TAILOR: '0' }, hp: '10', hp_ms: Date.now() })],
    [wool, dust, potion, box, pet, food, gear, rune, old_gear]
  )

  // One quantity receipt folds the merged source away and the crafted balance.
  amounts(game, [wool.id, 2], [dust.id, 0])
  game.dispatch({
    type: 'character/crafted',
    digest: '0xcraft',
    attempts: 1,
    output_type: 'hat',
    successes: 1,
    character_id: '0xchar',
    job: 'TAILOR',
    xp: 20,
    before: '0',
  })
  expect(bag(game).find(({ id }) => id === wool.id)?.amount).toBe(2)
  expect(bag(game).some(({ id }) => id === dust.id)).toBe(false)
  expect(row(game).jobs.TAILOR).toBe('20')
  // A heal counts the projected regeneration and spends one unit.
  amounts(game, [potion.id, 1])
  const wounded = row(game)
  game.dispatch({
    type: 'character/consumed',
    digest: '0xheal',
    character_id: '0xchar',
    item_id: potion.id,
    effect: 'heal',
    heal: 25,
    before: { hp: wounded.hp, hp_ms: wounded.hp_ms },
  })
  expect(Number(row(game).hp)).toBeGreaterThanOrEqual(35)
  expect(Number(row(game).hp)).toBeLessThanOrEqual(character_max_hp(row(game)))
  // A box spends one unit into a pending claim; a crush removes the gear into a crush claim; a settled claim leaves.
  amounts(game, [box.id, 1])
  game.dispatch({ type: 'inventory/boxes_opened', claims: [{ id: '0xclaim', kind: 'box' }] })
  game.dispatch({ type: 'inventory/gear_crushed', gear_ids: [old_gear.id], claim_id: '0xcrush' })
  expect(game.state().session.claims).toEqual([
    { id: '0xclaim', kind: 'box' },
    { id: '0xcrush', kind: 'crush' },
  ])
  expect(bag(game).some(({ id }) => id === old_gear.id)).toBe(false)
  game.dispatch({ type: 'inventory/claims_settled', claim_ids: ['0xclaim'] })
  expect(game.state().session.claims.map(({ id }) => id)).toEqual(['0xcrush'])
  // A pet meal burns one food and raises power and the UTC day gate.
  amounts(game, [food.id, 1])
  game.dispatch({ type: 'inventory/pet_fed', pet_id: pet.id, before: 4 })
  game.dispatch({ type: 'inventory/pet_fed', pet_id: pet.id, before: 4 })
  expect(bag(game).find(({ id }) => id === pet.id)).toMatchObject({
    pet_power: 5,
    pet_last_day: Math.floor(Date.now() / 86_400_000),
  })
  // A certified scribe folds its exact stat, sink and rune deltas; the projection, arriving first, is not folded twice.
  const outcome = {
    digest: '0xscribe',
    stat: 0,
    outcome: 1,
    applied_value: 3,
    lost_amounts: Array.from({ length: 15 }, (_, index) => (index === 4 ? 2 : 0)),
    new_puits: '7',
  }
  amounts(game, [rune.id, 1])
  game.dispatch({ type: 'runeforge/scribed', gear_before: gear, rune_before: rune, outcome })
  const scribed = bag(game).find(({ id }) => id === gear.id)!
  expect(scribed).toMatchObject({ stats: { vitality: SHIFT + 13, chance: SHIFT + 3 }, puits: '7' })
  game.receive({ type: 'packet/item_updated', item: scribed })
  game.dispatch({ type: 'runeforge/scribed', gear_before: gear, rune_before: { ...rune, amount: 2 }, outcome })
  expect(bag(game).find(({ id }) => id === gear.id)?.stats).toEqual(scribed.stats)
  // The server's removal and a destroy to zero both drop the row; a fresh mint arrives by the item stream.
  game.receive({ type: 'packet/item_removed', item: pet.id, version: '9' })
  amounts(game, [food.id, 0])
  game.receive({
    type: 'packet/item_updated',
    item: item('0xaloe', { category: 'resource', item_type: 'aloe', amount: 8 }),
  })
  expect(
    bag(game)
      .map(({ id }) => id)
      .toSorted()
  ).toEqual(['0xaloe', box.id, gear.id, potion.id, rune.id, wool.id].toSorted())
})

test('the roster shows six heroes, deletes one for good, and an old wallet cannot delete from the new roster', async () => {
  const rows = Array.from({ length: 100 }, (_, index) => hero({ id: `0x${String(index).padStart(3, '0')}` }))
  const game = await start_game(rows, [])
  expect(game.state().session.characters.map(({ id }) => id)).toEqual(rows.slice(0, 6).map(({ id }) => id))
  const wallet = game.state().session.wallet as AuthSession
  game.dispatch({ type: 'character/select', character_id: rows[1]!.id })
  game.dispatch({ type: 'character/deleted', character_id: rows[1]!.id, wallet })
  expect(game.state().session.selected_character_id).not.toBe(rows[1]!.id)
  // A stale snapshot cannot resurrect it; the next hero takes the free place.
  game.receive({ type: 'packet/characters', characters: rows })
  expect(game.state().session.characters.map(({ id }) => id)).toEqual(
    [rows[0]!, ...rows.slice(2, 7)].map(({ id }) => id)
  )
  const roster = game.state().session
  game.dispatch({ type: 'character/deleted', character_id: rows[0]!.id, wallet: { ...wallet } })
  expect(game.state().session).toBe(roster)
  // Deletion is refused while the hero is bound to anything, or the account cannot confirm it.
  const bound = hero({
    equipment: [{ slot: 'cosmetic_hat' } as never],
    custody: 'fight',
    dungeon_run: { dungeon: 'temple', room: 0 },
    ambush: {} as never,
  })
  const ready = {
    ...game.state(),
    session: { ...game.state().session, characters: [bound], game_frozen: false, indexing_lag: 0 },
  }
  const blocked = {
    ...ready,
    party: { ...ready.party, party_by_character: { [bound.id]: 'party' } },
    marketplace: { ...ready.marketplace, own_listings: [{ id: bound.id } as never] },
  }
  expect(character_deletion_blockers(blocked, bound.id)).toEqual([
    'delete_equipment',
    'delete_fight',
    'delete_party',
    'delete_dungeon',
    'delete_ambush',
    'delete_listing',
  ])
  for (const patch of [{ game_frozen: true }, { indexing_lag: 301 }, { wallet: null }])
    expect(
      character_deletion_blockers({ ...ready, session: { ...ready.session, characters: [hero()], ...patch } }, '0xchar')
    ).toContain('delete_unavailable')
  // Every locale tells the player the deletion is permanent and the creation fee is not refunded.
  for (const { code } of LOCALES) {
    const { characters_page: copy } = await load_app_copy(code)
    expect(copy.delete_warning).toBeString()
    expect(copy_text(copy)('delete_no_refund', { amount: '1' })).toContain('1 SUI')
    for (const key of [
      'delete_equipment',
      'delete_fight',
      'delete_party',
      'delete_dungeon',
      'delete_ambush',
      'delete_listing',
      'delete_unavailable',
    ])
      expect(copy[key]).toBeTruthy()
  }
  // Signing out forgets the tombstones of the account.
  game.dispatch({ type: 'auth/disconnected' })
  expect(game.state().session.deleted_character_ids).toEqual([])
})

test('equipment and stacks predict the chain: slots, guards, change sets and merges that never overflow', () => {
  const ring = item('0xring', { category: 'ring', item_type: 'gold_ring' })
  expect(natural_slot_for(ring, {})).toBe('left_ring')
  expect(natural_slot_for(ring, stage_equip({}, item('0xother', { category: 'ring' }), 'left_ring'))).toBe('right_ring')
  const guard = (input: ItemRow, slot: Parameters<typeof equip_refusal>[0]['slot'], listed: string[] = []) =>
    equip_refusal({ item: input, slot, character_level: 10, equipment: {}, listed_ids: new Set(listed) })
  expect(guard(item('0xt', { level: 50 }), 'title')).toBe('level_too_low')
  expect(guard(item('0xt'), 'boots')).toBe('wrong_slot')
  expect(guard(item('0xt'), 'title', ['0xt'])).toBe('item_listed')
  expect(guard(item('0xt'), 'title')).toBeNull()
  const relic = stage_equip({}, item('0xrelic1', { category: 'relic', item_type: 'skull_relic' }), 'relic_1')
  expect(
    equip_refusal({
      item: item('0xrelic2', { category: 'relic', item_type: 'skull_relic' }),
      slot: 'relic_2',
      character_level: 10,
      equipment: relic,
      listed_ids: new Set(),
    })
  ).toBe('relic_duplicate')
  const real = equipment_map_of(hero({ equipment: [{ slot: 'title', ...item('0xold'), kiosk: undefined } as never] }))
  expect(equipment_change_set(stage_equip(real, item('0xnew'), 'title'), real)).toEqual({
    to_equip: [{ slot: 'title', item_id: '0xnew' }],
    to_unequip: [{ slot: 'title', item_id: '0xold' }],
  })
  expect(equipment_change_set(stage_unequip(real, 'title'), real)).toEqual({
    to_equip: [],
    to_unequip: [{ slot: 'title', item_id: '0xold' }],
  })
  // Yields merge into the largest unlisted stack of the kiosk, with room for the worst-case batch; gear never stacks.
  const wool = (id: string, amount: number, kiosk = '0xk', category = 'resource') =>
    item(id, { category, item_type: 'wool', amount, kiosk })
  expect(
    stack_merge_target([wool('small', 3), wool('listed', 100), wool('large', 20)], new Set(['listed']), 'wool')
  ).toBe('large')
  expect(
    stack_merge_target([wool('other', 100, '0xother'), wool('mine', 2, '0xmine')], new Set(), 'wool', '0xmine')
  ).toBe('mine')
  expect(
    stack_merge_target([wool('full', 4_294_967_000), wool('room', 4_294_966_000)], new Set(), 'wool', '0xk', 1_000)
  ).toBe('room')
  expect(stack_merge_target([wool('gear', 1, '0xk', 'sword')], new Set(), 'wool')).toBeNull()
  expect(craft_stack_plan({ wool: 4 }, 2, [wool('small', 3), wool('large', 6)], new Set(), '0xk')).toEqual([
    { item_type: 'wool', target_id: 'large', source_ids: ['small'], amount: 8, total_amount: 9, kiosk: '0xk' },
  ])
  expect(craft_stack_plan({ wool: 5 }, 2, [wool('short', 9)], new Set(), '0xk')).toBeNull()
  // A craft merges only the piles it needs: hundreds of small piles must not all enter one transaction.
  const piles = [wool('a', 6), wool('b', 5), ...Array.from({ length: 300 }, (_, index) => wool(`dust${index}`, 1))]
  expect(craft_stack_plan({ wool: 5 }, 1, piles, new Set(), '0xk')![0]).toMatchObject({
    source_ids: [],
    total_amount: 6,
  })
  expect(craft_stack_plan({ wool: 5 }, 2, piles, new Set(), '0xk')![0]).toMatchObject({
    target_id: 'a',
    source_ids: ['b'],
    total_amount: 11,
  })
  expect(craft_stack_plan({ wool: 400 }, 1, piles, new Set(), '0xk')).toBeNull()
  // A trade settles only the incoming stacks that fit: an overflow would abort the whole exchange.
  const first = { ...wool('first', 6), object: 'first' }
  const second = { ...wool('second', 6), object: 'second' }
  expect(trade_stack_targets([wool('target', 4_294_967_285)], new Set(), [first, second] as never)).toEqual({
    first: { id: 'target', kiosk: '0xk', amount: 4_294_967_285 },
  })
  // Listings and every trade offer share one encumbrance rule.
  const encumbered = encumbered_asset_ids(
    [{ id: 'listed' } as never],
    [{ caps_a: [{ object: 'offered' }], caps_b: [{ object: 'claimed' }] } as never]
  )
  expect([...encumbered].toSorted()).toEqual(['claimed', 'listed', 'offered'])
  expect(
    available_inventory_items(
      [wool('free', 1), wool('listed', 1), wool('offered', 1), wool('away', 1, '0xother')],
      encumbered,
      '0xk'
    ).map(({ id }) => id)
  ).toEqual(['free'])
})

test('a receipt that arrives after the roster already shows it changes nothing', async () => {
  const title = item('0xtitle')
  const better = item('0xbetter')
  const shown = hero({ jobs: { TAILOR: '20' }, hp: '35', hp_ms: 1, equipment: [{ slot: 'title', ...better }] as never })
  const game = await start_game([shown], [])
  // The server streams the changed hero before the wallet answers: the receipt, priced from the old row, folds nothing.
  game.dispatch({
    type: 'character/crafted',
    digest: '0xc',
    attempts: 1,
    output_type: 'hat',
    successes: 1,
    character_id: '0xchar',
    job: 'TAILOR',
    xp: 20,
    before: '0',
  })
  expect(row(game).jobs.TAILOR).toBe('20')
  game.dispatch({
    type: 'character/consumed',
    digest: '0xh',
    character_id: '0xchar',
    item_id: '0xp',
    effect: 'heal',
    heal: 25,
    before: { hp: '10', hp_ms: 0 },
  })
  expect(row(game).hp).toBe('35')
  game.dispatch({
    type: 'character/equip_folded',
    character_id: '0xchar',
    equipped: [{ slot: 'title', item_id: better.id }],
    unequipped: [{ slot: 'title', item_id: title.id }],
  })
  expect(row(game).equipment.map(({ id }) => id)).toEqual([better.id])
  expect(bag(game)).toEqual([])
})

test('the jobs window plays the hero the player crafts from, and an old characters address only opens the world', async () => {
  const game = await start_game([hero({ id: '0xc1' }), hero({ id: '0xc2' })], [])
  const selected = () => game.state().session.selected_character_id
  game.dispatch({ type: 'character/select', character_id: '0xc1' })
  game.dispatch({
    type: 'settings/changed',
    settings: { ...game.state().settings, always_craft_from_character_id: '0xc2' },
  })
  // The page this address used to open is gone: it lands on the world and locks nothing.
  game.dispatch({ type: 'path/open', pathname: '/characters/jobs' })
  expect(game.state().navigation.page).toBe('world')
  expect(game.state().navigation.dialog).toBeNull()
  expect(selected()).toBe('0xc1')
  // The HUD's Jobs window plays the crafting hero, and holds it while it stays open.
  game.dispatch({ type: 'dialog/open', dialog: 'character_jobs' })
  expect(selected()).toBe('0xc2')
  game.dispatch({ type: 'character/select', character_id: '0xc1' })
  expect(selected()).toBe('0xc2')
  game.dispatch({ type: 'dialog/open', dialog: null })
  game.dispatch({ type: 'character/select', character_id: '0xc1' })
  expect(selected()).toBe('0xc1')
})

test('an executed zone search keeps its zone until the zone shows, and a repeated press pays nothing twice', async () => {
  const searches: unknown[] = []
  const game = await start_surface(GAME_MODULES, {
    seat: true,
    account: {
      wallet: fake_wallet({ character: { search_zone: async (request: unknown) => void searches.push(request) } }),
      remembered: 'Sign in with Google',
    },
  })
  running.push(game)
  await sign_in(game, { characters: [hero({ world: 'nauvis', checkpoint_world: 'nauvis', x: 10, z: 10 })] })
  game.dispatch({ type: 'character/select', character_id: '0xchar' })
  game.receive({ type: 'packet/tracked_zones', character_id: '0xchar', world: 'nauvis', zones: [{ zx: 0, zz: 0 }] })
  const target = {
    key: 'nauvis:0:0',
    world: 'nauvis',
    x: 10,
    z: 10,
    kind: 'discover',
    previous_searched_at_ms: null,
  } as const
  jest.useFakeTimers()
  try {
    game.dispatch({ type: 'world/search_zone', target })
    game.dispatch({ type: 'world/search_zone', target })
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
    // The read layer is slow for more than thirty seconds: that is said, and the paid search stays locked.
    jest.advanceTimersByTime(31_000)
  } finally {
    jest.useRealTimers()
  }
  expect(searches).toHaveLength(1)
  expect(game.state().world.pending_zone_searches[target.key]).toEqual(target)
})
