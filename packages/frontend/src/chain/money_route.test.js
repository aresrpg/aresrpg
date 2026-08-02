// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Proves the character-mint MONEY ROUTING (the live-400 fix): a wallet holding > 0.2 SUI
// self-pays the SAME free-mint PTB, ≤ 0.2 SUI stays sponsored, and a FRESH balance-read failure surfaces an
// honest error and NEVER silently falls through to the sponsor (the funded-wallet 400 this fixes). All effects
// are injected — zero module mocks, so this cannot collide with the process-global mock registry.
import { describe, expect, mock, test } from 'bun:test'

import { SELF_PAY_THRESHOLD_MIST, route_create_payment, execute_create_routed } from './money_route'

describe('route_create_payment — the pure money verdict (mirrors api/sponsor.mjs SELF_PAY_MIST)', () => {
  test('threshold is 0.2 SUI in MIST', () => {
    expect(SELF_PAY_THRESHOLD_MIST).toBe(200_000_000n)
  })
  test('≤ 0.2 SUI → sponsored (0, mid, and EXACTLY the boundary)', () => {
    expect(route_create_payment(0n)).toBe('sponsored')
    expect(route_create_payment(80_000_000n)).toBe('sponsored') // a stale 0.08 display
    expect(route_create_payment(200_000_000n)).toBe('sponsored') // boundary is inclusive (sponsor uses strict >)
  })
  test('> 0.2 SUI → self_pay (one MIST over the boundary, and a real 0.82 SUI balance)', () => {
    expect(route_create_payment(200_000_001n)).toBe('self_pay')
    expect(route_create_payment(820_000_000n)).toBe('self_pay') // a real balance that 400'd
  })
})

const make_tx = () => ({ __ptb: 'create_character_free' }) // opaque PTB sentinel — the SAME object both doors get
const ok_sponsored = async () => ({ digest: 'SPONSORED_OK', effects: { status: { status: 'success' } } })
const mint_error = (e) => new Error(e ?? 'Character mint failed')

describe('execute_create_routed — fresh-balance decision + door dispatch', () => {
  test('≤ 0.2 SUI → SPONSORED door only (self-pay never touched)', async () => {
    const run_self_pay = mock(async () => ({ digest: 'X' }))
    const run_sponsored = mock(ok_sponsored)
    const out = await execute_create_routed({
      fetch_balance_mist: async () => 80_000_000n,
      tx: make_tx(),
      run_self_pay,
      run_sponsored,
      on_mint_error: mint_error,
    })
    expect(out).toEqual({ route: 'sponsored', digest: 'SPONSORED_OK' })
    expect(run_sponsored).toHaveBeenCalledTimes(1)
    expect(run_self_pay).toHaveBeenCalledTimes(0)
  })

  test('> 0.2 SUI → SELF-PAY door only, and it signs the SAME free-mint PTB (sponsor never touched)', async () => {
    const tx = make_tx()
    const run_self_pay = mock(async () => ({ digest: 'SELF_PAY_OK' }))
    const run_sponsored = mock(ok_sponsored)
    const out = await execute_create_routed({
      fetch_balance_mist: async () => 820_000_000n,
      tx,
      run_self_pay,
      run_sponsored,
      on_mint_error: mint_error,
    })
    expect(out).toEqual({ route: 'self_pay', digest: 'SELF_PAY_OK' })
    expect(run_self_pay).toHaveBeenCalledTimes(1)
    expect(run_self_pay.mock.calls[0][0]).toBe(tx) // dry-run/shape proof: the EXACT free PTB is self-paid, no paid split
    expect(run_sponsored).toHaveBeenCalledTimes(0)
  })

  test('FRESH balance read FAILS → throws honest error, NEVER falls through to the sponsor (the 400 fix)', async () => {
    const run_self_pay = mock(async () => ({ digest: 'X' }))
    const run_sponsored = mock(ok_sponsored)
    await expect(
      execute_create_routed({
        fetch_balance_mist: async () => {
          throw new Error('rpc getBalance down')
        },
        tx: make_tx(),
        run_self_pay,
        run_sponsored,
        on_mint_error: mint_error,
      })
    ).rejects.toThrow('rpc getBalance down')
    expect(run_sponsored).toHaveBeenCalledTimes(0) // the crux: no silent sponsor fallback
    expect(run_self_pay).toHaveBeenCalledTimes(0)
  })

  test('sponsored door returns a FAILURE status → humanized via on_mint_error (empty digest never waited on)', async () => {
    const run_sponsored = mock(async () => ({
      digest: '', // the S-54 sponsored dry-run refused a would-fail tx with zero gas
      effects: { status: { status: 'failure', error: 'that name is taken' } },
    }))
    await expect(
      execute_create_routed({
        fetch_balance_mist: async () => 0n,
        tx: make_tx(),
        run_self_pay: mock(async () => ({ digest: 'X' })),
        run_sponsored,
        on_mint_error: mint_error,
      })
    ).rejects.toThrow('that name is taken')
  })

  // #1862 — the mint's CERTIFIED RECEIPT must survive the routing hop. The caller (roster/store.ts) adopts the
  // created Character/Kiosk off `effects_result` and only waits on the read layer when there is none, so a door
  // that dropped it here would silently buy back the ~570ms wait + read-layer catch-up this ticket removes.
  const certified = { Transaction: { digest: 'D', effects: { changedObjects: [] }, objectTypes: {} } }

  test('a certified receipt from the SPONSORED door rides through to the caller', async () => {
    const out = await execute_create_routed({
      fetch_balance_mist: async () => 80_000_000n,
      tx: make_tx(),
      run_self_pay: mock(async () => ({ digest: 'X' })),
      run_sponsored: mock(async () => ({
        digest: 'SPONSORED_OK',
        effects: { status: { status: 'success' } },
        effects_result: certified,
      })),
      on_mint_error: mint_error,
    })
    expect(out.effects_result).toBe(certified)
  })

  test('a door WITHOUT a certified receipt reports none — the caller keeps its honest wait', async () => {
    const out = await execute_create_routed({
      fetch_balance_mist: async () => 80_000_000n,
      tx: make_tx(),
      run_self_pay: mock(async () => ({ digest: 'X' })),
      run_sponsored: mock(ok_sponsored),
      on_mint_error: mint_error,
    })
    expect(out.effects_result).toBeUndefined()
  })

  test('a certified receipt from the SELF-PAY door rides through too (same seam, both routes)', async () => {
    const out = await execute_create_routed({
      fetch_balance_mist: async () => 820_000_000n,
      tx: make_tx(),
      run_self_pay: mock(async () => ({ digest: 'SELF_PAY_OK', effects_result: certified })),
      run_sponsored: mock(ok_sponsored),
      on_mint_error: mint_error,
    })
    expect(out.effects_result).toBe(certified)
  })
})
