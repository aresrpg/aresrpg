// GAS-STATION FALLBACK LAW — the routing matrix for the low-balance sponsored
// re-route. Pure module, every effect injected (money_route.test.js pattern): ZERO module mocks, so this
// file can never collide with the process-global bun mock.module registry.
import { afterEach, describe, expect, mock, test } from 'bun:test'

import { SELF_PAY_THRESHOLD_MIST } from '../chain/money_route'
import { use_settings } from '../stores/settings'
import { error_executed_digest } from '../world-shell/tx_digest_error.js'

import { attempt_sponsor_fallback, is_gas_selection_error } from './gas_fallback'

// A LIVE failure (2026-07-10, fight claim at 0.083 SUI) — the exact class this law exists for.
const OWNER_ERROR =
  'GraphQLResponseError: Invalid argument: Unable to perform gas selection due to insufficient SUI balance of 83000000 to satisfy required budget 85126200'

const TX = { the_same_ptb: true } // opaque — the fallback must pass the SAME object through
const receipt_ok = (digest = 'SPONSORED_OK') => ({ digest, effects: { status: { status: 'success' } } })

/** Baseline: the fallback SHOULD fire — each test overrides exactly the gate it probes. */
const args = (over = {}) => ({
  error: new Error(OWNER_ERROR),
  excluded: false,
  is_zklogin: true,
  transaction: TX,
  fetch_balance_mist: mock(async () => 100_000_000n), // fresh 0.1 SUI — under the 0.2 boundary
  run_sponsored: mock(async () => receipt_ok()),
  ...over,
})

describe('is_gas_selection_error — the pre-execution class detector', () => {
  test('matches the exact live owner error', () => {
    expect(is_gas_selection_error(new Error(OWNER_ERROR))).toBe(true)
  })

  test('matches through the humanized simulate wrapper via the cause chain (deep-dust sim throw)', () => {
    const wrapped = new Error('Couldn’t simulate the transaction — nothing was sent. Try again.', {
      cause: new Error(OWNER_ERROR),
    })
    expect(is_gas_selection_error(wrapped)).toBe(true)
  })

  test('an EXECUTED failure class never matches (digest = burned gas, never re-routed)', () => {
    expect(is_gas_selection_error(new Error('InsufficientGas'))).toBe(false)
    expect(is_gas_selection_error(new Error('MoveAbort(… , 106) in command 0'))).toBe(false)
    expect(is_gas_selection_error(new Error('User rejected the request'))).toBe(false)
    expect(is_gas_selection_error(null)).toBe(false)
  })
})

describe('attempt_sponsor_fallback — the routing matrix', () => {
  afterEach(() => use_settings.setState({ sponsored_gameplay_enabled: true })) // reset the process-shared store

  test('pref OFF (sponsored gameplay opted out) → rethrows the ORIGINAL error, never reads balance or sponsors', async () => {
    use_settings.setState({ sponsored_gameplay_enabled: false })
    const a = args()
    await expect(attempt_sponsor_fallback(a)).rejects.toBe(a.error)
    expect(a.fetch_balance_mist).toHaveBeenCalledTimes(0)
    expect(a.run_sponsored).toHaveBeenCalledTimes(0)
  })

  test('low balance + zkLogin + gas-selection error → ONE sponsored run of the SAME PTB → {digest}', async () => {
    const a = args()
    const receipt = await attempt_sponsor_fallback(a)
    expect(receipt).toEqual({ digest: 'SPONSORED_OK' })
    expect(a.run_sponsored).toHaveBeenCalledTimes(1)
    expect(a.run_sponsored.mock.calls[0][0]).toBe(TX) // the SAME transaction object — never rebuilt here
  })

  test('funded wallet (> 0.2 SUI) → rethrows the ORIGINAL error, sponsor never touched (self-pay stays self-pay)', async () => {
    const a = args({ fetch_balance_mist: mock(async () => 300_000_000n) })
    await expect(attempt_sponsor_fallback(a)).rejects.toBe(a.error)
    expect(a.run_sponsored).toHaveBeenCalledTimes(0)
  })

  test('boundary: EXACTLY 0.2 SUI is sponsored (strict `>` ⇒ self-pay — byte-parity with money_route/sponsor.mjs)', async () => {
    const a = args({ fetch_balance_mist: mock(async () => SELF_PAY_THRESHOLD_MIST) })
    await expect(attempt_sponsor_fallback(a)).resolves.toEqual({ digest: 'SPONSORED_OK' })
  })

  test('non-zkLogin session → rethrows, no balance read, no sponsor call (zkLogin-only gate)', async () => {
    const a = args({ is_zklogin: false })
    await expect(attempt_sponsor_fallback(a)).rejects.toBe(a.error)
    expect(a.fetch_balance_mist).toHaveBeenCalledTimes(0)
    expect(a.run_sponsored).toHaveBeenCalledTimes(0)
  })

  test('excluded (money-split PTB / sponsor_excluded) → rethrows, nothing runs — the gas-split drain class is pinned OUT', async () => {
    const a = args({ excluded: true })
    await expect(attempt_sponsor_fallback(a)).rejects.toBe(a.error)
    expect(a.fetch_balance_mist).toHaveBeenCalledTimes(0)
    expect(a.run_sponsored).toHaveBeenCalledTimes(0)
  })

  test('a NON-gas-selection error → rethrows untouched (its own honest cause), nothing runs', async () => {
    const a = args({ error: new Error('User rejected the request') })
    await expect(attempt_sponsor_fallback(a)).rejects.toBe(a.error)
    expect(a.fetch_balance_mist).toHaveBeenCalledTimes(0)
    expect(a.run_sponsored).toHaveBeenCalledTimes(0)
  })

  test('unknown balance (read failed → null) → rethrows — never sponsor blind', async () => {
    const a = args({ fetch_balance_mist: mock(async () => null) })
    await expect(attempt_sponsor_fallback(a)).rejects.toBe(a.error)
    expect(a.run_sponsored).toHaveBeenCalledTimes(0)
  })

  test('balance read THROWS → treated as unknown → rethrows the original', async () => {
    const a = args({
      fetch_balance_mist: mock(async () => {
        throw new Error('rpc down')
      }),
    })
    await expect(attempt_sponsor_fallback(a)).rejects.toBe(a.error)
    expect(a.run_sponsored).toHaveBeenCalledTimes(0)
  })

  test('sponsor refusal (throws, pre-flight, zero gas) → surfaces the ORIGINAL gas error (existing humanized copy)', async () => {
    const a = args({
      run_sponsored: mock(async () => {
        throw new Error('Sponsor request failed (400): self-pay-required: balance exceeds 0.2 SUI')
      }),
    })
    await expect(attempt_sponsor_fallback(a)).rejects.toBe(a.error)
    expect(a.run_sponsored).toHaveBeenCalledTimes(1) // exactly one attempt — no sponsor retry either
  })

  test('sponsored tx EXECUTED and failed (digest exists) → throws the on-chain cause, NEVER retried', async () => {
    const abort = 'MoveAbort(MoveLocation { module: Identifier("fight") }, 7) in command 0'
    const a = args({
      run_sponsored: mock(async () => ({
        digest: 'BURNED',
        effects: { status: { status: 'failure', error: abort } },
      })),
    })
    const thrown = await attempt_sponsor_fallback(a).catch((error) => error)
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toContain(abort)
    expect(Object.hasOwn(thrown, 'digest')).toBe(true)
    expect(thrown.digest).toBe('BURNED')
    expect(error_executed_digest(thrown)).toBe('BURNED')
    expect(a.run_sponsored).toHaveBeenCalledTimes(1) // a digest = the sponsor's gas is spent — one shot, ever
  })

  test('sponsored pre-flight dry-run refuse (digest "") → throws the cause with zero gas spent', async () => {
    const a = args({
      run_sponsored: mock(async () => ({
        digest: '',
        effects: { status: { status: 'failure', error: 'MoveAbort(… , 11) in command 0' } },
      })),
    })
    const thrown = await attempt_sponsor_fallback(a).catch((error) => error)
    expect(thrown).toBeInstanceOf(Error)
    expect(thrown.message).toContain('11) in command 0')
    expect(Object.hasOwn(thrown, 'digest')).toBe(false)
    expect(error_executed_digest(thrown)).toBeNull()
  })
})
