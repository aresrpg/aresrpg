// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// D203/T76 regression — can_consume (the full-HP pre-check): a heal consumable can only abort
// on-chain (ENoMissingHp) once the character is at max_hp, so the client refuses BEFORE any tx. The chain
// regens FIRST then checks (consumable.move:62-63), so the gate folds lazy regen via the chain-exact
// projected_hp / character_max_hp (read_character.js) — a character whose natural regen would reach full is
// blocked even though stored current_hp is below max (the avoidable 102 this fix kills). No hand-derived
// constants: the predicate tracks the on-chain formula through the shared single-home helpers forever.
import { ITEM_CATEGORY } from '@aresrpg/sdk/items'
import { describe, expect, test } from 'bun:test'

import {
  BAG_CAPACITY,
  can_consume,
  EQUIPMENT_SLOTS,
  equip_lock_of,
  equip_stage_action,
  equipped_totals,
  group_stackable,
  is_item_listed,
  is_slot_valid,
  invalid_equip_change,
  item_display_level,
  partition_bag,
  real_equipment_of,
  stage_reducer,
  wallet_equipped_ids,
} from './inventory-equip.js'

describe('equipped_totals (owned rolls only)', () => {
  const equipment = {
    weapon: {
      id: '0xsword',
      vitality: 99,
      statsJson: JSON.stringify({ vitality: [3, 8], action: [1, 2] }),
    },
    left_ring: {
      id: '0xring',
      vitality: 88,
      statsJson: JSON.stringify({ vitality: [2, 6] }),
    },
  }

  test('decodes centered owned rolls and sums their fixed values', () => {
    const rolled_stats_by_id = {
      '0xsword': { vitality: 32775, action: 32769 },
      '0xring': { vitality: 32765 },
    }

    expect(equipped_totals(equipment, rolled_stats_by_id)).toEqual([
      { key: 'vitality', label: 'vitality', value: 4 },
      { key: 'action', label: 'AP', value: 1 },
    ])
  })

  test('a null contributor suppresses partial totals instead of presenting them as complete', () => {
    expect(
      equipped_totals(equipment, {
        '0xsword': { vitality: 32775, action: 32769 },
        '0xring': null,
      })
    ).toBeNull()
  })

  test('pending contributors are unavailable and never fall back to template ranges or flat projected fields', () => {
    expect(equipped_totals(equipment)).toBeNull()
  })

  test('statless equipped items do not make the totals unavailable', () => {
    expect(equipped_totals({ hat: { id: '0xhat', statsJson: '{}' } })).toEqual([])
  })

  test('a newly staged owner row resolves its authored contribution through the template-id map', () => {
    const staged = { weapon: { id: '0xstaged', template_id: '0xtemplate' } }
    const templates = new Map([['0xtemplate', { statsJson: '{"strength":[2,6]}' }]])

    expect(equipped_totals(staged, {}, templates)).toBeNull()
  })
})

// A minimal typed character (only the fields projected_hp / character_max_hp read). No experience → level 1,
// classe senshi + vitality 0 → max_hp 70 (config default base). `hp_updated_ms` is the regen anchor; can_consume
// projects it to Date.now() through the exact on-chain kernel (~(150+level·6)/75 ≈ 2 HP/s at level 1).
const fixture = (/** @type {Record<string, any>} */ over = {}) => ({
  _type: '0x1::character::Character',
  classe: 'senshi',
  experience: 0,
  vitality: 0,
  gear_vitality: 0,
  current_hp: 70,
  hp_updated_ms: Date.now(), // fresh anchor → ~0 elapsed unless overridden
  ...over,
})

describe('can_consume (D203/T76 projected-HP pre-check)', () => {
  test('stored HP below max, freshly anchored → allowed (regen has not closed the gap)', () => {
    expect(can_consume(fixture({ current_hp: 40, hp_updated_ms: Date.now() }))).toBe(true)
  })

  test('stored HP at max → refused (the D29 pre-known abort)', () => {
    expect(can_consume(fixture({ current_hp: 70, hp_updated_ms: Date.now() }))).toBe(false)
  })

  test('stored HP below max BUT projected regen reaches full → refused (the stale-HP 102 this fix kills)', () => {
    // 60/70, anchor 10 min in the past: the ~2 HP/s kernel long since filled to 70 = full → refused.
    expect(can_consume(fixture({ current_hp: 60, hp_updated_ms: Date.now() - 600_000 }))).toBe(false)
  })

  test('stored HP below max, projected regen still short of full → allowed', () => {
    // 40/70, anchor 10s in the past: kernel adds floor(10_000·156 / 75_000) = 20 → projects to 60 < 70.
    expect(can_consume(fixture({ current_hp: 40, hp_updated_ms: Date.now() - 10_000 }))).toBe(true)
  })

  test('above max (drifted display) → refused', () => {
    expect(can_consume(fixture({ current_hp: 75, hp_updated_ms: Date.now() }))).toBe(false)
  })

  test('no character → refused (nothing to heal)', () => {
    expect(can_consume(null)).toBe(false)
  })

  test('unknown shape (no _type) → fail-open, the chain stays the judge', () => {
    expect(can_consume({ current_hp: 999999 })).toBe(true)
  })
})

describe('cosmetic item-type equipment slots', () => {
  const empty_state = () => ({ equipment: real_equipment_of(null), dirty: false })
  const cosmetic = (/** @type {string} */ item_type, /** @type {string} */ item_category = item_type) => ({
    id: `0x${item_type}`,
    item_type,
    item_category,
  })

  test.each([
    [ITEM_CATEGORY.HAT, 'hat'],
    [ITEM_CATEGORY.CLOAK, 'cloak'],
    [ITEM_CATEGORY.TITLE, 'title'],
  ])('%s equips only into the %s slot', (item_type, expected_slot) => {
    const item = cosmetic(item_type)
    const { equipment, dirty } = stage_reducer(empty_state(), { type: 'equip', item })

    expect(equipment[expected_slot]).toBe(item)
    expect(is_slot_valid(expected_slot, item)).toBe(true)
    for (const slot of EQUIPMENT_SLOTS.filter((slot) => slot !== expected_slot))
      expect(is_slot_valid(slot, item)).toBe(false)
    expect(dirty).toBe(true)
  })

  test('cloak never resolves to the chestplate slot', () => {
    const item = cosmetic(ITEM_CATEGORY.CLOAK, 'chestplate')
    const { equipment } = stage_reducer(empty_state(), { type: 'equip', item })
    const dragged = stage_reducer(empty_state(), { type: 'set_slot', slot: 'cloak', item })

    expect(equipment.cloak).toBe(item)
    expect(equipment.chestplate).toBeNull()
    expect(dragged.equipment.cloak).toBe(item)
    expect(is_slot_valid('chestplate', item)).toBe(false)
  })

  test('a listed cloak is neither slot-valid nor stageable by equip or drop', () => {
    const item = { ...cosmetic(ITEM_CATEGORY.CLOAK), listed: true }
    const initial = empty_state()

    expect(is_item_listed(item)).toBe(true)
    expect(is_slot_valid('cloak', item)).toBe(false)
    expect(stage_reducer(initial, { type: 'equip', item })).toBe(initial)
    expect(stage_reducer(initial, { type: 'set_slot', slot: 'cloak', item })).toBe(initial)
  })

  test('Accept guard uses the fresh owner row and ignores unrelated listings', () => {
    const staged = cosmetic(ITEM_CATEGORY.CLOAK)
    const equipment = { ...real_equipment_of(null), cloak: staged }
    const real = real_equipment_of(null)

    expect(invalid_equip_change(equipment, real, [{ ...staged, listed: true }])).toEqual({
      item: { ...staged, listed: true },
      reason: 'listed',
    })
    expect(
      invalid_equip_change(equipment, real, [
        { ...staged, listed: false },
        { id: '0xother', listed: true },
      ])
    ).toBeNull()
    expect(invalid_equip_change(equipment, real, [])).toEqual({ item: staged, reason: 'missing' })

    const equipped_real = { ...real, left_ring: staged }
    const moved = { ...equipped_real, left_ring: null, right_ring: staged }
    expect(invalid_equip_change(moved, equipped_real, [])).toBeNull()
  })

  test('paper doll exposes the distinct combat-head and cosmetic slots', () => {
    expect(EQUIPMENT_SLOTS).toEqual([
      'relic_1',
      'relic_2',
      'relic_3',
      'relic_4',
      'relic_5',
      'relic_6',
      'helmet',
      'amulet',
      'chestplate',
      'gauntlets',
      'pants',
      'weapon',
      'left_ring',
      'right_ring',
      'belt',
      'boots',
      'pet',
      'title',
      'hat',
      'cloak',
    ])
    expect(new Set(EQUIPMENT_SLOTS).size).toBe(20)
  })

  test('combat helmet remains distinct from the cosmetic hat slot', () => {
    const helmet = { id: '0xhelmet', item_type: 'walker_helmet', item_category: 'helmet' }

    expect(is_slot_valid('helmet', helmet)).toBe(true)
    expect(is_slot_valid('hat', helmet)).toBe(false)
  })

  test('paper doll reads nested character equipment and worn, independent of the loose bag', () => {
    const template_map = new Map([
      ['iron_cap', { id: '0xtpl-helmet', item_type: 'iron_cap', category: 'HELMET', level: 12 }],
      ['night_cloak', { id: '0xtpl-cloak', item_type: 'night_cloak', category: 'CLOAK', level: 8 }],
    ])
    const equipment = real_equipment_of(
      {
        equipment: [
          { item_id: '0xhelmet', template: '0xtpl-helmet', category: 'helmet', amount: 1 },
          { item_id: '0xweapon', template: '0xtpl-weapon', category: 'longsword', amount: 1 },
          { item_id: '0xcloak', template: '0xtpl-cloak', category: 'cloak', amount: 1 },
          { item_id: '0xtitle', template: '0xtpl-title', category: 'title', amount: 1 },
        ],
        worn: {
          cloak: { item_id: '0xcloak', template_id: '0xtpl-cloak', category: 'cloak' },
        },
      },
      template_map
    )

    expect(equipment.helmet).toMatchObject({
      id: '0xhelmet',
      item_type: 'iron_cap',
      item_category: 'helmet',
      level: 12,
    })
    expect(equipment.weapon).toMatchObject({ id: '0xweapon', item_category: ITEM_CATEGORY.SWORD })
    expect(equipment.cloak).toMatchObject({
      id: '0xcloak',
      item_type: 'night_cloak',
      item_category: 'cloak',
      level: 8,
    })
    expect(equipment.title).toMatchObject({ id: '0xtitle', item_category: 'title' })
  })

  test('a present empty projection clears stale flat slots but nested worn still paints', () => {
    const stale = { id: '0xstale', item_type: 'stale_hat', item_category: 'hat' }
    const equipment = real_equipment_of({
      equipment: [],
      worn: { cloak: { item_id: '0xcloak', template_id: 'cape_fuwa', category: 'cloak' } },
      hat: stale,
    })

    expect(equipment.hat).toBeNull()
    expect(equipment.cloak).toMatchObject({ id: '0xcloak', template_id: 'cape_fuwa', item_category: 'cloak' })
  })
})

// OWNER BUG (night batch #1): "in my inventory the cosmetic cape is lvl 0 while when equipped it's lvl 1"
// — the bag hover derived level as `item.level ?? tmpl.level` (dead fallback: /v1 coerces the unscribed
// null to 0, and ?? keeps 0) while the paper doll derived `row.level ?? template.level` (works: equipment
// rows carry no level). TWO homes, two answers. item_display_level is THE one surviving home: the
// event-sourced instance level wins only when a scribe actually set one (>0), else the template's level.
describe('item_display_level (the ONE display-level home)', () => {
  test('the cape case: /v1 bag row level 0 + template level 1 → 1 (the dead ?? fallback this kills)', () => {
    expect(item_display_level({ level: 0 }, { level: 1 })).toBe(1)
  })

  test('a scribed instance level beats the template level', () => {
    expect(item_display_level({ level: 5 }, { level: 1 })).toBe(5)
  })

  test('no template → the instance level, else 0', () => {
    expect(item_display_level({ level: 3 }, undefined)).toBe(3)
    expect(item_display_level({ level: 0 }, undefined)).toBe(0)
    expect(item_display_level(null, null)).toBe(0)
  })

  test('equip_stage_action preserves a scribed level instead of stomping it with the template', () => {
    const scribed = { id: '0xitem', item_category: 'cloak', item_type: 'cloak', template_id: '0xtpl', level: 5 }
    const templates = new Map([['0xtpl', { id: '0xtpl', level: 1 }]])
    const staged = stage_reducer(
      { equipment: real_equipment_of(null), dirty: false },
      equip_stage_action(scribed, 'cloak', {}, templates)
    )

    expect(staged.equipment.cloak.level).toBe(5)
  })

  test('the paper doll and the bag agree through the one home (equipment row + bag doc, same item)', () => {
    const templates = new Map([['0xtpl-cloak', { id: '0xtpl-cloak', item_type: 'cloak', category: 'cloak', level: 1 }]])
    const equipment = real_equipment_of(
      { equipment: [{ item_id: '0xcape', template: '0xtpl-cloak', category: 'cloak', amount: 1 }] },
      undefined,
      templates
    )

    // doll side: no row level → template level 1; bag side: the SAME derivation over the /v1 doc's 0.
    expect(equipment.cloak.level).toBe(1)
    expect(item_display_level({ level: 0 }, templates.get('0xtpl-cloak'))).toBe(equipment.cloak.level)
  })
})

// OWNER BUG (night batch #5): an equipped cosmetic painted the GENERIC category glyph on the paper doll —
// /v1 equipment/worn rows carry NO name/item_type (only { item_id, template, category }), so when the
// chain template map is cold/failed (memoized empty) the projected item had no icon identity at all.
// The wallet's /v1 item docs DO carry name+item_type for those same ids (equip keeps items kiosk-locked),
// so real_equipment_of now joins them by item id as the identity fallback.
describe('real_equipment_of — /v1 item-doc identity join', () => {
  const worn_character = {
    equipment: [{ item_id: '0xcape', template: '0xtpl-cloak', category: 'cloak', amount: 1 }],
    worn: { cloak: { item_id: '0xcape', template_id: '0xtpl-cloak', category: 'cloak' } },
  }
  const bag_docs = [
    {
      id: '0xcape',
      template_id: '0xtpl-cloak',
      name: 'Lorito Cloak (Emerald)',
      item_category: 'cloak',
      item_type: 'cloak',
      level: 0,
      amount: 1,
      listed: false,
    },
  ]

  test('a cold template map still resolves the worn cosmetic name from the wallet item doc', () => {
    const equipment = real_equipment_of(worn_character, new Map(), new Map(), bag_docs)

    expect(equipment.cloak).toMatchObject({ id: '0xcape', name: 'Lorito Cloak (Emerald)', item_category: 'cloak' })
  })

  test('row + template fields still win over the doc when present', () => {
    const templates = new Map([
      [
        '0xtpl-cloak',
        { id: '0xtpl-cloak', item_type: 'night_cloak', category: 'cloak', level: 1, name: 'Night Cloak' },
      ],
    ])
    const equipment = real_equipment_of(worn_character, undefined, templates, bag_docs)

    // the doc's generic 'cloak' item_type never shadows the template's authored slug
    expect(equipment.cloak).toMatchObject({ id: '0xcape', item_type: 'night_cloak', level: 1 })
    // the /v1 doc name (the cosmetic_icon_of key) survives when the template has its own display name too
    expect(equipment.cloak.name).toBe('Lorito Cloak (Emerald)')
  })
})

// OWNER BUG (night batch #4): "other characters are showing in their inventory even items equipped by our
// other characters (it should not)" — /v1/owner-items unions every kiosk-locked item of the wallet and
// equip does NOT extract from the kiosk (§11: locked forever), so items equipped by character A leak into
// character B's bag. wallet_equipped_ids is the pure exclusion set the bag filter subtracts.
describe('wallet_equipped_ids (cross-character bag exclusion)', () => {
  const characters = [
    { id: '0xjawad', equipment: [{ item_id: '0xcape', template: '0xt1', category: 'cloak', amount: 1 }] },
    { id: '0ximmortal', equipment: [{ item_id: '0xsword', template: '0xt2', category: 'longsword', amount: 1 }] },
    { id: '0xbare', equipment: [] },
  ]

  test("excludes OTHER characters' equipped ids, never the selected character's own", () => {
    const ids = wallet_equipped_ids(characters, '0xjawad')

    expect(ids.has('0xsword')).toBe(true) // immortal's weapon must not pollute jawad's bag
    expect(ids.has('0xcape')).toBe(false) // jawad's own equipment stays governed by the doll stage
  })

  test('no selected character → every equipped id across the wallet', () => {
    const ids = wallet_equipped_ids(characters, null)

    expect([...ids].sort()).toEqual(['0xcape', '0xsword'])
  })

  test('malformed shapes are ignored', () => {
    expect(wallet_equipped_ids(null, '0x1').size).toBe(0)
    expect(wallet_equipped_ids([{ id: '0xc' }, null], '0x1').size).toBe(0)
  })
})

// partition_bag — the bag-tab split extracted from Inventory.jsx (pure; the excluded_ids seam is the
// cross-character fix's mount point, so the split itself is pinned here too).
describe('partition_bag', () => {
  const rows = [
    { id: '0xsword', item_category: 'sword', item_type: 'iron_sword', amount: 1 },
    { id: '0xcape', item_category: 'cloak', item_type: 'cloak', amount: 1 },
    { id: '0xpotion', item_category: 'consumable', item_type: 'small_potion', amount: 3 },
    { id: '0xpotion2', item_category: 'consumable', item_type: 'small_potion', amount: 2 },
    { id: '0xore', item_category: 'resource', item_type: 'iron_ore', amount: 1 },
    { id: '0xother-cape', item_category: 'cloak', item_type: 'cloak', amount: 1 },
  ]

  test('splits tabs, folds stackables, and pads the grid to capacity', () => {
    const { counts, total_count, grid_items, empty_count } = partition_bag(rows, {
      equipped_ids: new Set(),
      category: 'consumables',
    })

    expect(counts).toEqual({ equipment: 1, cosmetics: 2, consumables: 2, resources: 1 })
    expect(total_count).toBe(6)
    expect(grid_items).toHaveLength(1) // two small_potion stacks fold into one ×5 cell
    expect(grid_items[0].amount).toBe(5)
    expect(empty_count).toBe(BAG_CAPACITY - 1)
  })

  test("excluded_ids (other characters' equipped items) vanish from every tab and from owned", () => {
    const { owned, counts } = partition_bag(rows, {
      equipped_ids: new Set(),
      excluded_ids: new Set(['0xother-cape', '0xsword']),
      category: 'equipment',
    })

    expect(owned.map((i) => i.id)).not.toContain('0xother-cape')
    expect(counts).toEqual({ equipment: 0, cosmetics: 1, consumables: 2, resources: 1 })
  })

  test("the selected character's doll ids leave equipment/cosmetics but stay owned", () => {
    const { owned, counts } = partition_bag(rows, {
      equipped_ids: new Set(['0xcape']),
      category: 'equipment',
    })

    expect(counts.cosmetics).toBe(1)
    expect(owned.map((i) => i.id)).toContain('0xcape')
  })
})

// STACK-IDENTITY FIX (07-20) — OPEN ROOT, FIXED HERE. Owner: a ×2 petbox shows only "OPEN BOX" and opening
// aborts "this item is not a lootbox". BACKLOG's own v30 QA row already diagnosed the shape: "a NEW lootbox
// stacked with the 'broken one from last time' yet opening says this item is not a lootbox — the pre-manifest-fix
// box (old template lineage) stacks with the corrected one by display but is not openable; the stack must not
// merge across template lineages". This test pins the exact mechanism: group_stackable USED TO key its merge on
// `item.item_type` ALONE (the display slug) — when two on-chain Items share a slug but carry DIFFERENT
// `template_id`s (a re-authored box lineage), the merged "×2" cell silently dropped the SECOND item's id/template_id
// and exposed only the FIRST to every downstream action (loot_box::open_box's box_template_id, forgemagie::crush's
// gear_template_id). If the first-encountered item was the stale/unregistered template, opening (or crushing) the
// WHOLE merged stack failed for the valid unit too — it was never independently addressable.
// FIXED: group_stackable now keys the merge on `template_id` (falling back to `item_type`/`id` only for rows the
// chain never emits without a template). The consumer action layer (lootbox_util.js `resolve_box_template`,
// crush_actions.js `resolve_template`) already preferred a row's exact `template_id` when present — this test
// closes the last gap: the SECOND lineage now gets its own display row, so its template_id can finally reach them.
describe('group_stackable — stackable-identity drift (petbox lane: OPEN ROOT, fixed here)', () => {
  test('two same-slug items with DIFFERENT template_id must stay independently addressable, not merge into one identity', () => {
    const old_lineage = { id: '0xold-box', item_type: 'normal_pet_lootbox', template_id: '0xtpl-old', amount: 1 }
    const new_lineage = { id: '0xnew-box', item_type: 'normal_pet_lootbox', template_id: '0xtpl-new', amount: 1 }

    const grouped = group_stackable([old_lineage, new_lineage])

    // THE (FORMER) DEFECT: pre-fix, grouped.length === 1, grouped[0].id === '0xold-box', grouped[0].template_id
    // === '0xtpl-old' — the corrected new_lineage box's own identity never reached the display row at all, so no
    // UI action could target it while the old one merged over it. Now each lineage keeps its own row + amount.
    expect(grouped).toHaveLength(2)
    expect(grouped.find((row) => row.id === '0xold-box')).toMatchObject({ template_id: '0xtpl-old', amount: 1 })
    expect(grouped.find((row) => row.id === '0xnew-box')).toMatchObject({ template_id: '0xtpl-new', amount: 1 })
  })
})

// OWNER BUG (night batch #2): the "Updating equipment…" box rendered INSIDE the equipment panel while the
// toast already announced the same pending tx (use_toast.promise). The lock reason is now DATA — the
// transient pending state is toast-owned (inline: false); persistent state locks keep the panel notice.
describe('equip_lock_of (lock reason as data — pending is toast-owned)', () => {
  test('a pending equip tx never renders the inline panel box', () => {
    expect(equip_lock_of({ pending: true })).toEqual({ key: 'inventory.tx_equip_pending', inline: false })
  })

  test('persistent locks keep the inline notice', () => {
    expect(equip_lock_of({ retry_blocked: true })).toEqual({ key: 'errors.tx_retry_blocked', inline: true })
    expect(equip_lock_of({ in_dungeon: true })).toEqual({ key: 'inventory.locked_in_dungeon', inline: true })
    expect(equip_lock_of({ exploring: true })).toEqual({ key: 'inventory.locked_exploring', inline: true })
  })

  // ISSUE #15 — a zero-gas local-read-staleness refusal (equipment::ETemplateMismatch et al.) gets its own
  // honest notice: reuses item_state_mismatch's existing copy ("This item changed state. Refresh your
  // inventory.") — never tx_retry_blocked's "it may have spent gas" line, which would lie for a tx that never signed.
  test('a stale local read locks with the honest, gas-neutral refresh notice', () => {
    expect(equip_lock_of({ state_stale: true })).toEqual({ key: 'errors.item_state_mismatch', inline: true })
  })

  test('retry_blocked (digest-proven, may have spent gas) outranks state_stale (zero gas)', () => {
    expect(equip_lock_of({ retry_blocked: true, state_stale: true })).toEqual({
      key: 'errors.tx_retry_blocked',
      inline: true,
    })
  })

  test('pending outranks every other reason; no reason → null', () => {
    expect(equip_lock_of({ pending: true, retry_blocked: true, in_dungeon: true }).inline).toBe(false)
    expect(equip_lock_of({})).toBeNull()
  })
})

describe('stage_reducer (equip action — combat category branches)', () => {
  const empty_state = () => ({ equipment: real_equipment_of(null), dirty: false })
  const item = (/** @type {string} */ item_category) => ({
    id: `0x${item_category}`,
    item_type: `gear_${item_category}`,
    item_category,
  })

  test.each(['chestplate', 'gauntlets', 'pants'])('%s category equips into its matching slot', (item_category) => {
    const { equipment } = stage_reducer(empty_state(), {
      type: 'equip',
      item: item(item_category),
    })

    expect(equipment[item_category]?.item_category).toBe(item_category)
  })

  test('combat helmet equips into helmet, never cosmetic hat', () => {
    const helmet = item('helmet')
    const { equipment } = stage_reducer(empty_state(), { type: 'equip', item: helmet })

    expect(equipment.helmet).toBe(helmet)
    expect(equipment.hat).toBeNull()
  })
})
