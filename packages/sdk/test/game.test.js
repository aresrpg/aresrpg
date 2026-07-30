// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  raise_spell_level_ptb,
  raise_stat_ptb,
  craft_ptb,
  feed_ptb,
  crush_ptb,
  crush_gas_budget_mist,
  MEASURED_CRUSH_GAS_MIST,
  CRUSH_TEMPLATE_SLOTS,
  scribe_rune_ptb,
  join_world_ptb,
  get_world,
  get_crush_registry,
  FORGE_STATS,
  FORGE_TIERS,
  FORGE_CATALOG,
  FORGE_STAT_ORDER,
  band_divisor,
  raw_magnitudes,
  reachable_rune_keys,
  crush_yield_preview,
} from '../src/game.js'

import { EMPTY_IDS, IDS, id, targets, find_call } from './_onchain_fixtures.js'

const ctx = { network: 'testnet', ids: IDS }
// deployed core, but the feed singleton unstamped (feed must refuse; the core builds fine).
const bare = {
  network: 'testnet',
  ids: {
    aresrpg: {
      ...IDS.aresrpg,
      PET_FEED_CONFIG: '',
    },
  },
}
const undeployed = { network: 'testnet', ids: EMPTY_IDS }

// 34 distinct filler templates + the gear template fill the 35 crush slots around the ONE registered test rune.
const FILLERS = Array.from({ length: 34 }, (_, i) => id(`fl${i}`))

const A = {
  kiosk_id: id('k0'),
  personal_kiosk_cap_id: id('pk0'),
  character_id: id('ca0'),
  spell_template_id: id('sp0'),
  stat: 2, // strength (a 0-based stat index)
  points: 3, // stat points to allocate (flat 1:1 cost)
  recipe_id: id('rc0'),
  input_item_ids: [id('in0'), id('in1')],
  output_template_id: id('ot0'),
  pet_item_id: id('pet0'),
  pet_template_id: id('pt0'),
  food_item_id: id('fd0'),
  // forgemagie: the shared CrushBoard is a CEREMONY object, passed at runtime like the xpolicy.
  crush_board_id: id('cb0'),
  gear_item_id: id('ge0'),
  gear_item_ids: [id('ge0'), id('ge1')],
  gear_template_id: id('gt0'),
  rune_item_id: id('ru0'),
  rune_template_id: id('rt0'),
  // single-tx crush: every registered rune template rides a fixed slot; distinct fillers pad the rest.
  rune_template_ids: [id('rt0')],
  filler_template_ids: FILLERS,
  // the &Random crush budget is a MEASURED constant (null until the rehearsal stamps it) — shape tests pass
  // an explicit override; the loud-refuse default has its own test below.
  gas_budget_mist: 10_000_000,
}

describe('game progression builders — refuse loudly when undeployed', () => {
  test('every builder refuses', () => {
    expect(() => raise_spell_level_ptb(undeployed)(A)).toThrow(/not deployed/)
    expect(() => raise_stat_ptb(undeployed)(A)).toThrow(/not deployed/)
    expect(() => craft_ptb(undeployed)(A)).toThrow(/not deployed/)
    expect(() => feed_ptb(undeployed)(A)).toThrow(/not deployed/)
    expect(() => crush_ptb(undeployed)(A)).toThrow(/not deployed/)
    expect(() => scribe_rune_ptb(undeployed)(A)).toThrow(/not deployed/)
  })
})

describe('game progression builders — guards for the ceremony objects', () => {
  test('craft refuses while EXTRACT_POLICY is unstamped (S-51b: the xpolicy is a deployment singleton now)', () => {
    const no_xpolicy = {
      network: 'testnet',
      ids: { aresrpg: { ...IDS.aresrpg, EXTRACT_POLICY: '' } },
    }
    expect(() => craft_ptb(no_xpolicy)(A)).toThrow(/EXTRACT_POLICY/)
  })
  test('feed refuses when PET_FEED_CONFIG is unstamped', () => {
    expect(() => feed_ptb(bare)(A)).toThrow(/PET_FEED_CONFIG/)
  })
  test('feed refuses every missing runtime identity before composing', () => {
    expect(() => feed_ptb(ctx)({ ...A, kiosk_id: undefined })).toThrow(/kiosk_id/)
    expect(() => feed_ptb(ctx)({ ...A, personal_kiosk_cap_id: undefined })).toThrow(/personal_kiosk_cap_id/)
    expect(() => feed_ptb(ctx)({ ...A, character_id: undefined })).toThrow(/character_id/)
    expect(() => feed_ptb(ctx)({ ...A, pet_item_id: undefined })).toThrow(/pet_item_id/)
    expect(() => feed_ptb(ctx)({ ...A, pet_template_id: undefined })).toThrow(/pet_template_id/)
    expect(() => feed_ptb(ctx)({ ...A, food_item_id: undefined })).toThrow(/food_item_id/)
  })
  test('crush/scribe refuse without the CrushBoard (ceremony object)', () => {
    expect(() => crush_ptb(ctx)({ ...A, crush_board_id: undefined })).toThrow(
      /crush_board_id is required/,
    )
    expect(() =>
      scribe_rune_ptb(ctx)({ ...A, crush_board_id: undefined }),
    ).toThrow(/crush_board_id is required/)
  })
  test('crush refuses an empty gear batch (one template per tx, ≥1 item)', () => {
    expect(() => crush_ptb(ctx)({ ...A, gear_item_ids: [] })).toThrow(
      /gear_item_ids/,
    )
  })
  test('crush refuses when distinct templates cannot fill the 35 slots (distinct-padding law)', () => {
    expect(() =>
      crush_ptb(ctx)({ ...A, filler_template_ids: FILLERS.slice(0, 5) }),
    ).toThrow(/DISTINCT template slots/)
  })
  test('crush gas: the measured &Random budget is stamped (per-item peak × 1.5; refusal compile-frozen while non-null)', () => {
    expect(MEASURED_CRUSH_GAS_MIST).toBe(46_369_600) // real crush, digest 9jrVSfNW… (2026-07-11, 5-stack L20 gear)
    // Budget = ceil(peak × 1.5) × items — the un-simulatable &Random crush pins from the measured constant.
    expect(crush_gas_budget_mist()).toBe(Math.ceil(46_369_600 * 1.5))
    expect(crush_gas_budget_mist({ items: 3 })).toBe(Math.ceil(46_369_600 * 1.5) * 3)
    // A crush now COMPOSES without an explicit budget (the constant supplies it); no throw.
    expect(() => crush_ptb(ctx)({ ...A, gas_budget_mist: undefined })).not.toThrow()
    // Refusal path (MEASURED_CRUSH_GAS_MIST == null → throw /unset/) is compile-frozen while stamped.
  })
})

describe('game progression builders — targets + arg shapes', () => {
  test('raise_spell_level → spell_level::raise_spell_level, 5 args (link + second version died), merged package', () => {
    const call = find_call(
      raise_spell_level_ptb(ctx)(A),
      'spell_level::raise_spell_level',
    )
    expect(call.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(call.args).toBe(5)
  })
  test('raise_stat → character_link::raise_stat, 6 args (kiosk+pkcap+id+stat+points+version — the raise_spell_level twin)', () => {
    const call = find_call(raise_stat_ptb(ctx)(A), 'character_link::raise_stat')
    expect(call.package).toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(call.args).toBe(6)
  })
  test('craft → crafting::craft, 11 args (S-52 sui/write/craft.js home; + character_id + terminal &Random)', () => {
    expect(find_call(craft_ptb(ctx)(A), 'crafting::craft').args).toBe(11)
  })
  test('feed → pet::feed_pet, 11 args (template-derived stats + UTC Clock)', () => {
    const tx = feed_ptb(ctx)(A)
    expect(find_call(tx, 'pet::feed_pet').args).toBe(11)
    const data = tx.getData()
    const command = data.commands.find((candidate) => candidate.$kind === 'MoveCall').MoveCall
    expect(command.arguments.map((argument) => argument.Input)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const object_id = (index) =>
      data.inputs[index].Object?.SharedObject?.objectId ?? data.inputs[index].UnresolvedObject?.objectId
    expect([0, 1, 2, 5, 7, 8, 9, 10].map(object_id)).toEqual([
      IDS.aresrpg.PET_FEED_CONFIG,
      A.kiosk_id,
      A.personal_kiosk_cap_id,
      A.pet_template_id,
      IDS.aresrpg.EXTRACT_POLICY,
      IDS.aresrpg.GAME_CONFIG,
      IDS.aresrpg.VERSION,
      `0x${'0'.repeat(63)}6`,
    ])
    const pure_id = (index) => `0x${Buffer.from(data.inputs[index].Pure.bytes, 'base64').toString('hex')}`
    expect([3, 4, 6].map(pure_id)).toEqual([A.character_id, A.pet_item_id, A.food_item_id])
    expect(typeof tx.serialize()).toBe('string')
  })
  test('crush → forgemagie::crush, 46 args (6 + 35 template slots + 5), terminal &Random, ONE command', () => {
    const tx = crush_ptb(ctx)(A)
    const call = find_call(tx, 'forgemagie::crush')
    // package-split 2026-07-12: the target is the sibling aresrpg_forgemagie package, NOT the core LATEST_PACKAGE_ID
    expect(call.package).toBe(IDS.aresrpg.FORGEMAGIE_PACKAGE_ID)
    expect(call.package).not.toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(call.args).toBe(6 + CRUSH_TEMPLATE_SLOTS + 5) // 46 — pinned against the Move source by the arity gate
    expect(targets(tx)).toEqual(['forgemagie::crush']) // single call — &Random LAST arg ⇒ Random-PTB compliant
    expect(typeof tx.serialize()).toBe('string')
  })
  test('crush slots dedup: a duplicate registered id never repeats an object across slots', () => {
    // rt0 passed twice + gear gt0 also passed as a rune id — the composer dedups and still fills 35 DISTINCT
    // slots off the fillers; the arg count stays exact and the tx serializes.
    const tx = crush_ptb(ctx)({
      ...A,
      rune_template_ids: [id('rt0'), id('rt0'), id('gt0')],
    })
    const call = find_call(tx, 'forgemagie::crush')
    expect(call.args).toBe(46)
    // slot inputs are all DISTINCT object ids (the distinct-padding law) — count unique object inputs.
    const inputs = tx.getData().inputs.filter(i => i.$kind === 'Object' || i.$kind === 'UnresolvedObject')
    const unique = new Set(inputs.map(i => JSON.stringify(i)))
    expect(unique.size).toBe(inputs.length)
    expect(typeof tx.serialize()).toBe('string')
  })
  test('scribe_rune → forgemagie::scribe_rune, 13 args, terminal &Random (ONE rune per tx)', () => {
    const tx = scribe_rune_ptb(ctx)(A)
    const call = find_call(tx, 'forgemagie::scribe_rune')
    // package-split 2026-07-12: the target is the sibling aresrpg_forgemagie package, NOT the core LATEST_PACKAGE_ID
    expect(call.package).toBe(IDS.aresrpg.FORGEMAGIE_PACKAGE_ID)
    expect(call.package).not.toBe(IDS.aresrpg.LATEST_PACKAGE_ID)
    expect(call.args).toBe(13)
    expect(targets(tx)).toEqual(['forgemagie::scribe_rune'])
    expect(typeof tx.serialize()).toBe('string')
  })
})

describe('forgemagie catalog codes — mirror foundation rune_catalog.move', () => {
  test('stat ids span the ItemStatistics order 0..16; tiers Ba/Pa/Ra = 1/2/3', () => {
    expect(FORGE_STATS.vitality).toBe(0)
    expect(FORGE_STATS.air_resistance).toBe(16)
    expect(Object.keys(FORGE_STATS).length).toBe(17)
    expect(FORGE_TIERS).toEqual({ BA: 1, PA: 2, RA: 3 })
  })
  test('#1603 live drift: critical and vitality match the Move catalog anchor', () => {
    expect({
      critical_weight: FORGE_CATALOG.unit_weights[FORGE_STATS.critical],
      critical_runeable: FORGE_CATALOG.runeable[FORGE_STATS.critical],
      critical_chance_runeable:
        FORGE_CATALOG.runeable[FORGE_STATS.critical_chance],
      vitality: [
        FORGE_CATALOG.ba_amount[FORGE_STATS.vitality],
        FORGE_CATALOG.pa_amount[FORGE_STATS.vitality],
        FORGE_CATALOG.ra_amount[FORGE_STATS.vitality],
      ],
    }).toEqual({
      critical_weight: 50,
      critical_runeable: 1,
      critical_chance_runeable: 0,
      vitality: [3, 10, 30],
    })
  })
  test('catalog tables are 17-wide and internally consistent (runeable ⇔ ba amount exists)', () => {
    for (const key of ['unit_weights', 'runeable', 'ba_amount', 'pa_amount', 'ra_amount'])
      expect(FORGE_CATALOG[key].length).toBe(17)
    expect(FORGE_STAT_ORDER.length).toBe(17)
    FORGE_CATALOG.runeable.forEach((r, stat) => {
      expect(FORGE_CATALOG.ba_amount[stat] > 0).toBe(r === 1) // Ba exists iff runeable
    })
    // the 35-slot law: 10 multi-tier × 3 + 5 single-tier = 35 (the CRUSH_TEMPLATE_SLOTS derivation)
    const total = FORGE_CATALOG.runeable.reduce(
      (n, r, stat) => n + (r ? 1 + (FORGE_CATALOG.pa_amount[stat] > 0 ? 1 : 0) + (FORGE_CATALOG.ra_amount[stat] > 0 ? 1 : 0) : 0),
      0,
    )
    expect(total).toBe(CRUSH_TEMPLATE_SLOTS)
  })
  test('band_divisor walks the designed curve (docs/ECONOMY_SIM.md §7)', () => {
    expect(band_divisor(1)).toBe(277)
    expect(band_divisor(20)).toBe(277)
    expect(band_divisor(21)).toBe(2044)
    expect(band_divisor(50)).toBe(2044)
    expect(band_divisor(51)).toBe(6675)
    expect(band_divisor(150)).toBe(12922)
    expect(band_divisor(151)).toBe(19822)
    expect(band_divisor(999)).toBe(19822)
  })
})

describe('crush yield preview + reachable set — pure mirrors of foundation crush_lines', () => {
  const SHIFT = FORGE_CATALOG.shift
  /** centered block: everything at centre except the given raw deltas. */
  const centered = deltas => {
    const stats = Object.fromEntries(FORGE_STAT_ORDER.map(f => [f, SHIFT]))
    for (const [field, d] of Object.entries(deltas)) stats[field] = SHIFT + d
    return stats
  }

  test('raw_magnitudes: bonus lines are deltas, malus lines are ZERO (to_raw mirror — malus yields nothing)', () => {
    const raw = raw_magnitudes(centered({ strength: 40, wisdom: -5 }))
    expect(raw[FORGE_STATS.strength]).toBe(40)
    expect(raw[FORGE_STATS.wisdom]).toBe(0)
    expect(raw[FORGE_STATS.vitality]).toBe(0)
  })

  test('reachable set: tier eligibility is value ≥ amount×3 (reference-corpus selectRuneTier floor)', () => {
    // strength +50: Ba always, Pa (3×3=9 ≤ 50), Ra (10×3=30 ≤ 50) — all three tiers reachable.
    const keys = reachable_rune_keys(centered({ strength: 50 }))
    expect(keys).toEqual([
      { stat: FORGE_STATS.strength, tier: 1 },
      { stat: FORGE_STATS.strength, tier: 2 },
      { stat: FORGE_STATS.strength, tier: 3 },
    ])
    // strength +8: below the Pa floor (9) — Ba only.
    expect(reachable_rune_keys(centered({ strength: 8 }))).toEqual([
      { stat: FORGE_STATS.strength, tier: 1 },
    ])
    // Action and live critical(9) are single-tier majors; dead critical_chance(11) is not runeable.
    expect(reachable_rune_keys(centered({ action: 1 }))).toEqual([{ stat: FORGE_STATS.action, tier: 1 }])
    expect(reachable_rune_keys(centered({ critical: 5 }))).toEqual([
      { stat: FORGE_STATS.critical, tier: 1 },
    ])
    expect(reachable_rune_keys(centered({ critical_chance: 5 }))).toEqual([])
    // malus: nothing (raw 0).
    expect(reachable_rune_keys(centered({ chance: -12 }))).toEqual([])
  })

  test('yield preview pins the Move golden: L50 × +40 Fo @100% ⇒ EV 0.978 ⇒ {0,1}', () => {
    // num = 50×40×5×100000 = 1e9 ; den = 100×1000×(1×5)×2044 = 1.022e9 → floor 0, frac ⇒ max 1.
    const rows = crush_yield_preview({ centered_stats: centered({ strength: 40 }), item_level: 50 })
    expect(rows).toEqual([{ stat: FORGE_STATS.strength, stat_key: 'strength', min: 0, max: 1 }])
  })
  test('yield preview: the maxed +50 line floors to ≥1 (the Move ≥1-owed fixture)', () => {
    // num = 50×50×5×100000 = 1.25e9 ; den = 1.022e9 → 1.223 ⇒ {1,2}.
    const rows = crush_yield_preview({ centered_stats: centered({ strength: 50 }), item_level: 50 })
    expect(rows).toEqual([{ stat: FORGE_STATS.strength, stat_key: 'strength', min: 1, max: 2 }])
  })
  test('yield preview: the recipe-less cap halves the EV before the divisor', () => {
    // coeff capped at 50% → num 5e8 / 1.022e9 = 0.489 ⇒ {0,1} (the Move recipeless golden).
    const rows = crush_yield_preview({
      centered_stats: centered({ strength: 40 }),
      item_level: 50,
      recipe_less: true,
    })
    expect(rows).toEqual([{ stat: FORGE_STATS.strength, stat_key: 'strength', min: 0, max: 1 }])
  })
  test('yield preview: an exact division shows a FIXED count (no phantom band)', () => {
    // Craft the exact case: L20 (divisor 277) — strength value v with num % den == 0.
    // num = 20×v×5×100000 = 1e7×v ; den = 100×1000×5×277 = 1.385e8 → v = 1385 ⇒ num/den = 100 exactly.
    const rows = crush_yield_preview({ centered_stats: centered({ strength: 1385 }), item_level: 20 })
    expect(rows).toEqual([{ stat: FORGE_STATS.strength, stat_key: 'strength', min: 100, max: 100 }])
  })
})

describe('crush rune registry — chain-direct cached read (get_crush_registry)', () => {
  const BOARD = id('cb0')
  const TABLE = id('cbt0')
  /** A fake gRPC core over one board + a paged runes table. Counts board reads to pin the cache. */
  const fake_grpc = pages => {
    let board_reads = 0
    const client = {
      core: {
        getObject: async ({ objectId }) => {
          if (objectId === BOARD) {
            board_reads += 1
            return { object: { json: { runes: { id: TABLE } } } }
          }
          throw new Error(`unexpected getObject ${objectId}`)
        },
        listDynamicFields: async ({ cursor }) => {
          const page = cursor == null ? 0 : Number(cursor)
          return {
            dynamicFields: pages[page].map((_, i) => ({ fieldId: `f${page}:${i}` })),
            hasNextPage: page + 1 < pages.length,
            cursor: String(page + 1),
          }
        },
        getObjects: async ({ objectIds }) =>
          ({
            objects: objectIds.map(fid => {
              const [p, i] = fid.slice(1).split(':').map(Number)
              const e = pages[p][i]
              return { json: { name: e.template_id, value: { stat: e.stat, tier: e.tier } } }
            }),
          }),
      },
    }
    return { client, board_reads: () => board_reads }
  }

  test('decodes the runes table pages into by_key/by_template; the second call is served from cache', async () => {
    const { client, board_reads } = fake_grpc([
      [
        { template_id: id('rba'), stat: 2, tier: 1 },
        { template_id: id('rpa'), stat: 2, tier: 2 },
      ],
      [{ template_id: id('rgu'), stat: 13, tier: 1 }],
    ])
    const read = get_crush_registry({ grpc_client: client, network: 'testnet', ids: { aresrpg: { CRUSH_BOARD: BOARD } } })
    const registry = await read()
    expect(registry.entries.length).toBe(3)
    expect(registry.by_key.get('2:1')).toBe(id('rba'))
    expect(registry.by_key.get('2:2')).toBe(id('rpa'))
    expect(registry.by_key.get('13:1')).toBe(id('rgu'))
    expect(registry.by_template.get(id('rgu'))).toEqual({ stat: 13, tier: 1 })
    await read() // registry is static post-seed — cached, no second board fetch
    expect(board_reads()).toBe(1)
  })

  test('refuses loudly when CRUSH_BOARD is unstamped (refuse, never guess)', async () => {
    const read = get_crush_registry({ grpc_client: {}, network: 'mainnet', ids: { aresrpg: { CRUSH_BOARD: '' } } })
    expect(read()).rejects.toThrow(/CRUSH_BOARD is unstamped/)
  })
})

describe('game re-exports — world flows + read', () => {
  test('join_world_ptb + get_world are re-exported functions', () => {
    expect(typeof join_world_ptb).toBe('function')
    expect(typeof get_world).toBe('function')
  })
})
