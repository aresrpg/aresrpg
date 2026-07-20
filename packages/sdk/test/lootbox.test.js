// Pet loot-box two-phase door builders (loot_box::open_box + loot_box::claim_pet). OFFLINE: the deployment override
// seam (context.ids.aresrpg) builds each tx without a live publish; asserts the targets + arg shapes (10 / 6), the
// terminal-vs-composable split (open_box carries &Random ⇒ terminal single call; claim_pet is deterministic), the
// money-safety gas REFUSAL (null measured constant ⇒ building open_box without a gas override throws), and the loud
// arg refusals. Mirrors consume.test.js's builder-shape pattern.
//
// RECONCILED against the published loot_box.move (module `aresrpg::loot_box`) — targets + arg order/set below
// match the Move signatures exactly (arity gate D58c + keep-set gate both assert this statically).

import { describe, test, expect } from 'bun:test'

import {
  open_box_ptb,
  claim_pet_ptb,
  MEASURED_OPEN_BOX_GAS_MIST,
} from '../src/sui/write/lootbox.js'

import {
  deployed_context,
  undeployed_context,
  id,
  find_call,
  targets,
  IDS,
} from './_onchain_fixtures.js'

// open_box carries an explicit gas override so the null MEASURED constant doesn't refuse (that refusal has its own
// test). claim_pet is deterministic ⇒ no gas arg (the caller's run_tx dry-runs it).
const OPEN = {
  kiosk_id: id('kiosk'),
  personal_kiosk_cap_id: id('pkcap'),
  box_id: id('box'),
  box_template_id: id('boxtmpl'),
  gas_budget_mist: 30_000_000,
}

const CLAIM = {
  kiosk_id: id('kiosk'),
  personal_kiosk_cap_id: id('pkcap'),
  claim_id: id('claim'),
  rolled_template_id: id('pettmpl'),
}

describe('open_box_ptb — loot_box::open_box builder (terminal &Random)', () => {
  test('undeployed → refuses loudly', () => {
    expect(() => open_box_ptb(undeployed_context)(OPEN)).toThrow(/not deployed/)
  })

  test('deployed → loot_box::open_box, 10 args, merged package, terminal &Random call', () => {
    const tx = open_box_ptb(deployed_context)(OPEN)
    const call = find_call(tx, 'loot_box::open_box')
    expect(call.package).toBe(IDS.aresrpg.GIFTING_PACKAGE_ID)
    expect(call.args).toBe(10)
    // TERMINAL: the &Random moveCall is the LAST command (no coin/prep precedes it here).
    expect(targets(tx).at(-1)).toBe('loot_box::open_box')
    expect(typeof tx.serialize()).toBe('string')
  })

  test('MEASURED_OPEN_BOX_GAS_MIST is a generous fixed CEILING (a Sui budget is a ceiling, charged = actual; only a LOW value burns)', () => {
    expect(MEASURED_OPEN_BOX_GAS_MIST).toBe(50_000_000)
    // ×1.5 headroom must stay under the 0.1 SUI hard cap (GAS_CEILING law)
    expect(Math.ceil(MEASURED_OPEN_BOX_GAS_MIST * 1.5)).toBeLessThanOrEqual(100_000_000)
  })

  test('WITHOUT a gas override → builds with the ceiling budget (ceil(ceiling × 1.5))', () => {
    const { gas_budget_mist, ...no_gas } = OPEN
    void gas_budget_mist
    const tx = open_box_ptb(deployed_context)(no_gas)
    expect(tx.getData().gasData.budget).toBe(String(75_000_000))
  })

  test('refuses a missing box_id (no loot-box Item to consume)', () => {
    expect(() =>
      open_box_ptb(deployed_context)({ ...OPEN, box_id: undefined }),
    ).toThrow(/box_id is required/)
  })

  test('refuses a missing box_template_id (no roll pool)', () => {
    expect(() =>
      open_box_ptb(deployed_context)({ ...OPEN, box_template_id: undefined }),
    ).toThrow(/box_template_id is required/)
  })

  test('refuses a missing kiosk_id / personal_kiosk_cap_id', () => {
    expect(() =>
      open_box_ptb(deployed_context)({ ...OPEN, kiosk_id: undefined }),
    ).toThrow(/kiosk_id and personal_kiosk_cap_id/)
  })
})

describe('claim_pet_ptb — loot_box::claim_pet builder (deterministic)', () => {
  test('undeployed → refuses loudly', () => {
    expect(() => claim_pet_ptb(undeployed_context)(CLAIM)).toThrow(
      /not deployed/,
    )
  })

  test('deployed → loot_box::claim_pet, 7 args, gifting package, single deterministic call', () => {
    const tx = claim_pet_ptb(deployed_context)(CLAIM)
    const call = find_call(tx, 'loot_box::claim_pet')
    expect(call.package).toBe(IDS.aresrpg.GIFTING_PACKAGE_ID)
    expect(call.args).toBe(7) // claim, template, config (gifting split), version, kiosk, pkcap, policy
    expect(targets(tx)).toEqual(['loot_box::claim_pet']) // one call, no &Random ⇒ freely composable
    expect(typeof tx.serialize()).toBe('string')
  })

  test('refuses a missing claim_id (no PetBoxClaim to consume)', () => {
    expect(() =>
      claim_pet_ptb(deployed_context)({ ...CLAIM, claim_id: undefined }),
    ).toThrow(/claim_id is required/)
  })

  test('refuses a missing rolled_template_id (no pet ItemTemplate to mint)', () => {
    expect(() =>
      claim_pet_ptb(deployed_context)({
        ...CLAIM,
        rolled_template_id: undefined,
      }),
    ).toThrow(/rolled_template_id is required/)
  })

  test('refuses a missing kiosk_id / personal_kiosk_cap_id', () => {
    expect(() =>
      claim_pet_ptb(deployed_context)({ ...CLAIM, kiosk_id: undefined }),
    ).toThrow(/kiosk_id and personal_kiosk_cap_id/)
  })
})
