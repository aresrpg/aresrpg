import { describe, test, expect } from 'bun:test'

import {
  items_deployment,
  items_deployment_ready,
} from '../src/deployment/items.js'
import {
  buy_ptb,
  buy_many_ptb,
  buy_gas_budget_mist,
  clamp_quantity,
  MAX_BUY_QUANTITY,
  MEASURED_BUY_GAS_MIST,
} from '../src/sui/write/items_shop.js'
import {
  create_character_free_ptb,
  create_character_paid_ptb,
} from '../src/sui/write/items_creation.js'
import {
  character_name_marker_id,
  free_character_marker_id,
} from '../src/sui/read/items.js'

import {
  EMPTY_IDS,
  deployed_context,
  id,
  targets,
  find_call,
} from './_onchain_fixtures.js'

// Two arbitrary well-formed 32-byte ids for the PURE derivation tests (the package is undeployed, so there is no
// live id to assert against — determinism + uniqueness is what the guard protects).
const CREATION =
  '0x1111111111111111111111111111111111111111111111111111111111111111'
const PACKAGE =
  '0x2222222222222222222222222222222222222222222222222222222222222222'

describe('items_deployment — the loud unset gate (shim over the ONE merged home)', () => {
  test('testnet is STAMPED (post-ceremony); mainnet stays DARK until its ceremony', () => {
    expect(items_deployment_ready('testnet')).toBe(true)
    expect(items_deployment_ready('mainnet')).toBe(false)
    expect(() => items_deployment('testnet')).not.toThrow()
    expect(() => items_deployment('mainnet')).toThrow(/not deployed/)
    expect(() => items_deployment('mainnet')).toThrow(/PACKAGE_ID/)
  })

  test('throws on an unknown network with the distinct message', () => {
    expect(() => items_deployment('devnet')).toThrow(/no aresrpg ids/)
  })
})

describe('items_shop — quantity clamp', () => {
  test('accepts the inclusive bounds', () => {
    expect(clamp_quantity(1)).toBe(1)
    expect(clamp_quantity(MAX_BUY_QUANTITY)).toBe(100)
  })

  test('rejects zero, over-max, and non-integers', () => {
    expect(() => clamp_quantity(0)).toThrow(/\[1, 100\]/)
    expect(() => clamp_quantity(101)).toThrow(/\[1, 100\]/)
    expect(() => clamp_quantity(1.5)).toThrow(/integer/)
    expect(() => clamp_quantity('x')).toThrow(/integer/)
  })
})

describe('items_shop — gas budget derivation from measured constant', () => {
  test('the measured constant is set to the real per-item gas', () => {
    expect(MEASURED_BUY_GAS_MIST).toBe(15_374_000) // lineage-6 re-measure, digest 4VUmsqSf… (2026-07-11)
  })

  test('derives budget = ceil(measured × 1.5) × quantity for single buy', () => {
    expect(buy_gas_budget_mist({ quantity: 1 })).toBe(23_061_000)
  })

  test('scales correctly for multi-buy: quantity:3 → 3× the single-buy budget', () => {
    expect(buy_gas_budget_mist({ quantity: 3 })).toBe(69_183_000)
  })

  // Refusal path is compile-frozen while MEASURED_BUY_GAS_MIST != null; tested only when stamped
  // as null (never happens in production — the constant is set at publish rehearsal).
  test('a bad quantity is rejected before any budget derivation', () => {
    expect(() => buy_gas_budget_mist({ quantity: 0 })).toThrow(/\[1, 100\]/)
  })
})

describe('items builders — refuse loudly when the package is undeployed', () => {
  const context = { network: 'testnet', kiosk_client: null, ids: EMPTY_IDS }

  test('buy_ptb refuses (lazy id resolution → throw at invoke, not construction)', () => {
    expect(() => buy_ptb(context)).not.toThrow() // construction is safe
    expect(() =>
      buy_ptb(context)({
        sale_id: '0xabc',
        template_id: '0xdef',
        price_mist: 1n,
        kiosk_id: '0x1',
        personal_kiosk_cap_id: '0x2',
      }),
    ).toThrow(/not deployed/)
  })

  test('buy_many_ptb refuses', () => {
    expect(() =>
      buy_many_ptb(context)({
        sale_id: '0xabc',
        template_id: '0xdef',
        price_mist: 1n,
        quantity: 3,
        kiosk_id: '0x1',
        personal_kiosk_cap_id: '0x2',
      }),
    ).toThrow(/not deployed/)
  })

  test('create_character_free_ptb refuses', () => {
    expect(() =>
      create_character_free_ptb(context)({
        name: 'hero',
        class: 'warrior',
        starter_template_id: '0x1',
      }),
    ).toThrow(/not deployed/)
  })

  test('create_character_paid_ptb refuses', () => {
    expect(() =>
      create_character_paid_ptb(context)({
        name: 'hero',
        class: 'warrior',
        price_mist: 10n,
      }),
    ).toThrow(/not deployed/)
  })
})

// The PAID mint SHAPE (a roster-≥1 zkLogin account self-pays the gate price). Deployed
// context (fixtures idiom): the builder must split the EXACT price off GAS (the gate refunds surplus, so
// an exact split refunds nothing) and feed it to `creation::create_character_paid` — never the free gate.
describe('create_character_paid_ptb — paid mint shape (deployed context)', () => {
  const PRICE_MIST = 10_000_000_000n // the live gate default: 10 SUI

  test('splits the EXACT price off gas and routes it to creation::create_character_paid', () => {
    const tx = create_character_paid_ptb(deployed_context)({
      name: 'hero',
      class: 'senshi',
      price_mist: PRICE_MIST,
      kiosk_id: id('a5aa'),
      personal_kiosk_cap_id: id('a5ab'),
    })

    // exactly ONE gas split, and its u64 amount is the price to the MIST
    const splits = tx.getData().commands.filter(c => c.$kind === 'SplitCoins')
    expect(splits.length).toBe(1)
    expect(splits[0].SplitCoins.coin.$kind).toBe('GasCoin')
    const [amount] = splits[0].SplitCoins.amounts
    expect(amount.$kind).toBe('Input')
    const pure = tx.getData().inputs[amount.Input]
    expect(pure.$kind).toBe('Pure')
    const bytes = Uint8Array.from(atob(pure.Pure.bytes), ch => ch.charCodeAt(0))
    expect(
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(0, true),
    ).toBe(PRICE_MIST)

    // the paid gate + the kiosk lock ride the tx; the FREE gate appears nowhere
    const call_targets = targets(tx)
    expect(call_targets).toContain('creation::create_character_paid')
    expect(call_targets).toContain('character::new_customization')
    expect(call_targets).toContain('character::lock_in_kiosk')
    expect(call_targets).not.toContain('creation::create_character_free')
    // gate, config (gifting split), raw_name, class, male, customization, payment, clock, version (ctx implicit)
    expect(find_call(tx, 'creation::create_character_paid').args).toBe(9)
  })

  test('refuses without price_mist — the live-gate-price law (never hardcoded/stale)', () => {
    expect(() =>
      create_character_paid_ptb(deployed_context)({ name: 'hero', class: 'senshi' }),
    ).toThrow(/price_mist is required/)
  })
})

describe('creation marker-id derivation (mirrors derived_object::exists)', () => {
  test('name marker is deterministic and case-insensitive', () => {
    const a = character_name_marker_id({
      creation_id: CREATION,
      raw_name: 'Hero',
    })
    const b = character_name_marker_id({
      creation_id: CREATION,
      raw_name: 'hero',
    })
    expect(a).toMatch(/^0x[0-9a-f]{64}$/)
    expect(a).toBe(b) // folds case, exactly like the on-chain to_lowercase()
  })

  test('different names derive different markers', () => {
    const a = character_name_marker_id({
      creation_id: CREATION,
      raw_name: 'hero',
    })
    const b = character_name_marker_id({
      creation_id: CREATION,
      raw_name: 'villain',
    })
    expect(a).not.toBe(b)
  })

  test('free-claim marker is deterministic and owner-specific', () => {
    const owner_a =
      '0x82e1a5c7d1431d0174f3660569421fe0acb38d40a4734f48bb7c798dd260f8ba'
    const owner_b =
      '0xb4951afe3682d3e9425671f1772e3676bc6ff361ac00896ea131cf52765cd177'
    const a1 = free_character_marker_id({
      creation_id: CREATION,
      package_id: PACKAGE,
      owner: owner_a,
    })
    const a2 = free_character_marker_id({
      creation_id: CREATION,
      package_id: PACKAGE,
      owner: owner_a,
    })
    const b = free_character_marker_id({
      creation_id: CREATION,
      package_id: PACKAGE,
      owner: owner_b,
    })
    expect(a1).toMatch(/^0x[0-9a-f]{64}$/)
    expect(a1).toBe(a2)
    expect(a1).not.toBe(b)
  })
})
