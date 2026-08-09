// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Coverage for THE GAS PREFLIGHT (#2046) — the hoisted gate that refuses a ceremony whose signer holds the
// modeled budget in FRAGMENTS. The D41/D42 batch nearly stranded at leg 5 with a wallet that was, by every
// total-balance view, richly funded: gas needs ONE coin ≥ budget, and no total ever proves that. So the
// oracle here is deliberately the ADVERSARIAL one — a fragmented set whose TOTAL clears the bar must still
// be REFUSED, or the gate is measuring the wrong number.
//
// Pure/injected: no chain, no keystore. A throwaway `suiprivkey` is planted BEFORE the import because
// client.js resolves a signer at module load (absent it, it reads the ambient CLI keystore).
import { describe, test, expect } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

process.env.PRIVATE_KEY ??= new Ed25519Keypair().getSecretKey()

const {
  required_gas_coin,
  leg_gas_budget,
  batch_gas_budget,
  gas_preflight_verdict,
  gas_refusal_report,
  DEFAULT_LEG_GAS_BUDGET,
} = await import('./ceremony_upgrade.mjs')

const SUI = 1_000_000_000n
const coin = (id, sui) => ({ coinObjectId: id, balance: String(BigInt(sui) * SUI) })

describe('the modeled budget (#2046) — derived from the driver, never guessed', () => {
  test('per-leg budget is the same number the legs actually set, UPGRADE_GAS_BUDGET honoured', () => {
    expect(leg_gas_budget({})).toBe(DEFAULT_LEG_GAS_BUDGET)
    expect(leg_gas_budget({ UPGRADE_GAS_BUDGET: '250000000' })).toBe(250_000_000n)
  })

  test('a batch budgets every leg — a 9-package train is 9 SUI, not 1', () => {
    expect(batch_gas_budget(9, {})).toBe(9n * SUI)
    expect(batch_gas_budget(1, {})).toBe(1n * SUI)
  })

  test('the ×1.2 headroom is exact integer math', () => {
    expect(required_gas_coin(9n * SUI)).toBe(10_800_000_000n)
    expect(required_gas_coin(1n * SUI)).toBe(1_200_000_000n)
  })
})

describe('the verdict — one coin ≥ budget ×1.2, and a total is never evidence', () => {
  const budget = 9n * SUI // the D41/D42 shape: 9 legs × 1 SUI
  const required = 10_800_000_000n

  test('FRAGMENTED-BUT-SUFFICIENT TOTAL → REFUSED (the incident)', () => {
    const coins = Array.from({ length: 12 }, (_, i) => coin(`0xfrag${i}`, 1))
    const verdict = gas_preflight_verdict({ coins, budget })
    expect(verdict.total).toBe(12n * SUI)
    expect(verdict.total).toBeGreaterThan(required) // the wallet LOOKS funded…
    expect(verdict.ok).toBe(false) // …and the ceremony still cannot start
    expect(verdict.largest.balance).toBe(1n * SUI)
    expect(verdict.required).toBe(required)
  })

  test('SINGLE SUFFICIENT COIN → passes, fragments alongside it are irrelevant', () => {
    const coins = [coin('0xdust', 1), coin('0xbig', 11), coin('0xdust2', 1)]
    const verdict = gas_preflight_verdict({ coins, budget })
    expect(verdict.ok).toBe(true)
    expect(verdict.largest.coinObjectId).toBe('0xbig')
  })

  test('THE ×1.2 BOUNDARY IS EXACT — required passes, one MIST under refuses', () => {
    const at = gas_preflight_verdict({
      coins: [{ coinObjectId: '0xexact', balance: String(required) }],
      budget,
    })
    expect(at.ok).toBe(true)
    const under = gas_preflight_verdict({
      coins: [{ coinObjectId: '0xshort', balance: String(required - 1n) }],
      budget,
    })
    expect(under.ok).toBe(false)
    expect(under.largest.balance).toBe(required - 1n)
  })

  test('an EMPTY coin set is a refusal, never a plausible zero', () => {
    const verdict = gas_preflight_verdict({ coins: [], budget })
    expect(verdict.ok).toBe(false)
    expect(verdict.largest).toBe(null)
    expect(verdict.total).toBe(0n)
    expect(verdict.count).toBe(0)
  })
})

describe('the refusal names the state AND the reviewed act that fixes it', () => {
  const budget = 9n * SUI
  // DERIVED, never a literal: a hand-written 64-hex address is indistinguishable from a real chain id
  // (the chain-id gate says so, correctly) — a throwaway keypair gives a real-shaped one with no provenance
  // question to answer.
  const signer = new Ed25519Keypair().getPublicKey().toSuiAddress()
  const report = gas_refusal_report({
    signer,
    verdict: gas_preflight_verdict({
      coins: Array.from({ length: 12 }, (_, i) => coin(`0xfrag${i}`, 1)),
      budget,
    }),
  })

  test('it refuses to start, in those words', () => {
    expect(report).toMatch(/REFUSING TO START/)
  })

  test('it names the largest coin, the needed figure and the shortfall', () => {
    expect(report).toContain('0xfrag0')
    expect(report).toContain('10800000000')
    expect(report).toContain('1000000000')
  })

  test('it names the consolidation as its own reviewed act — never auto-runs it', () => {
    expect(report).toContain('fund_transfer.mjs')
    expect(report).toContain(`EXPECT_SIGNER=${signer}`)
    expect(report).toMatch(/reviewed act|review/i)
    expect(report).not.toMatch(/auto|automatically consolidat/i)
  })

  test('it never prints a key', () => {
    expect(report).not.toMatch(/suiprivkey/)
  })
})
