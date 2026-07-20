// Issue-1 (funded-wallet join regression + money-UX review) — proves the SPONSOR-REFUSAL →
// SELF-PAY detection seam and its HARD split: ONLY the > 0.2-SUI balance rule is tagged for a SILENT self-pay
// re-route (a funded wallet was always meant to pay its own gas). Every free-tier CAP/LIMIT (daily, global,
// rate-limit) and the drained pool are NOT tagged — nothing may auto-spend a free-tier player's
// SUI past the "free" promise, so those surface honestly. execute_sponsored_tx is driven for real against a
// mocked global fetch (no live network).
import { describe, expect, mock, test } from 'bun:test'

import i18n from '../i18n'

import { execute_sponsored_tx, is_sponsor_self_pay_refusal, SPONSOR_REFUSAL_SELF_PAY } from './index'

// Minimal doors execute_sponsored_tx touches BEFORE the 400 throw: an offline kind-only build + the zkLogin
// personal-message challenge sign. get_sdk is NOT reached on the refusal path (build resolves offline), so it
// needs no mock — keeping this file free of the shared '../chain/sdk' module mock (process-global hazard).
const make_tx = () => ({ setSenderIfNotSet() {}, build: async () => new Uint8Array([1, 2, 3]) })
const make_wallet = () => ({
  features: { 'sui:signPersonalMessage': { signPersonalMessage: async () => ({ signature: 'zklogin-sig' }) } },
})
const mock_sponsor_400 = (detail) => {
  globalThis.fetch = mock(async () => ({ ok: false, status: 400, text: async () => detail }))
}
const drive_refusal = async (detail) => {
  mock_sponsor_400(detail)
  return execute_sponsored_tx({
    wallet: make_wallet(),
    address: '0xabc',
    transaction: make_tx(),
    chain: 'sui:testnet',
    sponsor_url: 'http://sponsor.test/api/sponsor',
  }).then(
    () => null,
    (e) => e
  )
}

// The retired single-call route answers a stale client with 410 `sponsor-two-call-upgrade`. It never fires against
// the two-call pod (this client only POSTs /reserve + /execute), but the reserve fetch maps it honestly anyway:
// the app is out of date → refresh — NEVER a silent self-pay.
describe('execute_sponsored_tx — a 410 sponsor-two-call-upgrade maps to the stale-client copy', () => {
  test('410 on /reserve → honest refresh copy, not tagged for self-pay', async () => {
    globalThis.fetch = mock(async () => ({ ok: false, status: 410, text: async () => 'sponsor-two-call-upgrade' }))
    const error = await execute_sponsored_tx({
      wallet: make_wallet(),
      address: '0xabc',
      transaction: make_tx(),
      chain: 'sui:testnet',
      sponsor_url: 'http://sponsor.test/api/sponsor',
    }).then(
      () => null,
      (e) => e
    )
    expect(error).not.toBeNull()
    expect(error.message).toBe(i18n.t('errors.sponsor_stale_client'))
    expect(is_sponsor_self_pay_refusal(error)).toBe(false)
  })
})

describe('is_sponsor_self_pay_refusal — the pure predicate', () => {
  test('true only for the tagged marker; false for plain/absent errors', () => {
    expect(
      is_sponsor_self_pay_refusal(Object.assign(new Error('x'), { sponsor_refusal: SPONSOR_REFUSAL_SELF_PAY }))
    ).toBe(true)
    expect(is_sponsor_self_pay_refusal(new Error('some other failure'))).toBe(false)
    expect(is_sponsor_self_pay_refusal(null)).toBe(false)
    expect(is_sponsor_self_pay_refusal(undefined)).toBe(false)
    expect(is_sponsor_self_pay_refusal('a string')).toBe(false)
  })
})

// P0 second-account create bug (07-14): a fresh / second zkLogin account signs for the FIRST time at the
// sponsor challenge (Enoki generates the zkLogin proof lazily on the first sign). If that proof fails, the raw
// Enoki error used to leak into the generic decoder and read "failed on-chain — nothing was changed" — a LIE,
// since the sponsor POST never fired (proven live: sponsored=1, all refusal counters 0 for the failing account).
describe('execute_sponsored_tx — a fresh-zkLogin sign failure throws BEFORE the sponsor POST', () => {
  test('signPersonalMessage rejection → honest copy, and the sponsor is NEVER hit (pre-POST, zero gas)', async () => {
    const fetch_spy = mock(async () => ({ ok: true, json: async () => ({ txBytes: '', sponsorSig: '' }) }))
    globalThis.fetch = fetch_spy
    const wallet_sign_fails = {
      features: {
        'sui:signPersonalMessage': {
          signPersonalMessage: async () => {
            throw new Error('Enoki: zkLogin proof not ready')
          },
        },
      },
    }
    const error = await execute_sponsored_tx({
      wallet: wallet_sign_fails,
      address: '0xabc',
      transaction: make_tx(),
      chain: 'sui:testnet',
      sponsor_url: 'http://sponsor.test/api/sponsor',
    }).then(
      () => null,
      (e) => e
    )
    expect(error).not.toBeNull()
    // Raw Enoki jargon must NEVER reach the surface (no-jargon law).
    expect(String(error.message)).not.toMatch(/Enoki|proof not ready/i)
    // THE proof of the fix: the sponsor POST was never fired — a pre-send sign failure can no longer be
    // mislabelled as an on-chain failure, and the second-account sponsor counters stay honest.
    expect(fetch_spy).not.toHaveBeenCalled()
  })
})

describe('execute_sponsored_tx — ONLY the balance rule tags for silent self-pay', () => {
  test('BALANCE-RULE 400 → detected as self-pay-required (auto_join_world silently self-pays a funded wallet)', async () => {
    const error = await drive_refusal('self-pay-required: balance exceeds 0.2 SUI — sign with your own gas')
    expect(error).not.toBeNull()
    expect(is_sponsor_self_pay_refusal(error)).toBe(true)
  })

  // A free-tier wallet hitting a cap/limit must NEVER silently spend its own SUI — all surface honestly.
  const HONEST_400S = {
    daily_free_cap: 'daily free gameplay limit reached — transactions now require your own gas until tomorrow',
    global_daily_cap: 'sponsor daily cap reached — retry later or self-pay',
    address_rate_limit: 'rate-limited: too many sponsorships for this address, retry later',
    drained_pool: '@server has no SUI coins for gas',
  }
  for (const [name, detail] of Object.entries(HONEST_400S)) {
    test(`${name} 400 → NOT tagged (no silent self-pay; surfaces honestly)`, async () => {
      const error = await drive_refusal(detail)
      expect(error).not.toBeNull()
      expect(is_sponsor_self_pay_refusal(error)).toBe(false)
    })
  }
})
