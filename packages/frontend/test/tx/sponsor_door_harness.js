// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// The DRIVEN sponsor-door harness: one place that wires execute_tx's sponsored-first route to the REAL
// sponsored door (execute_sponsored_tx) over a scripted wire, so a money test asserts on the transport →
// decode → routing chain instead of a hand-tagged error object. Doubles only — no network, no SDK, no wallet.
// Consumed by the sponsor door's driven suites in this directory.

import { mock } from 'bun:test'

export const CHAIN = 'sui:testnet'
export const ADDR = '0xabc'
export const SPONSOR_URL = 'http://s.test/api/sponsor'
/** 0.1 SUI — under the self-pay boundary, so the route is sponsored-FIRST. */
export const LOW = 100_000_000n
export const RESERVATION = {
  reservationId: 42,
  sponsorAddress: '0xspon',
  gasCoins: [{ objectId: '0xg', version: '7', digest: 'gd' }],
  gasBudget: 3_000_000,
}

/** A clean grpc simulate result — what the self-pay guard needs to reach the wallet's sign door. */
export const ok_sim = () => ({
  $kind: 'Transaction',
  Transaction: {
    effects: { status: { success: true }, gasUsed: { computationCost: '1000000', storageCost: '2000000' } },
  },
})

/** A PTB double covering BOTH legs: the sponsored build/gas-application and the self-pay guard. */
export const make_tx = () => ({
  setSenderIfNotSet() {},
  build: async () => new Uint8Array([1, 2, 3]),
  setSender() {},
  setGasOwner() {},
  setGasPayment() {},
  setGasBudget() {},
})

/** A zkLogin wallet whose SELF-PAY door is the injected spy — every "was it re-signed?" assertion reads it. */
export const make_wallet = (sae) => ({
  features: {
    'sui:signPersonalMessage': { signPersonalMessage: mock(async () => ({ signature: 'zk-sig' })) },
    'sui:signTransaction': { signTransaction: mock(async () => ({ signature: 'sender-sig', bytes: 'TXBYTES' })) },
    'sui:signAndExecuteTransaction': { signAndExecuteTransaction: sae },
    'enoki:getSession': { getSession: async () => ({}) }, // the zkLogin marker the sponsor door requires
  },
})

/** Script the sponsor wire. Each leg is a function returning a Response double (or throwing a transport fault). */
export const route_sponsor = ({ reserve = () => ({ ok: true, json: async () => RESERVATION }), execute }) => {
  const spy = mock(async (url) => {
    if (String(url).endsWith('/reserve')) return reserve()
    if (String(url).endsWith('/execute')) return execute()
    throw new Error(`unexpected sponsor url ${url}`)
  })
  globalThis.fetch = spy
  return spy
}
export const calls_to = (spy, leg) => spy.mock.calls.filter(([url]) => String(url).endsWith(leg))

/** A refusal body as the @server writes it: the human diagnostic plus (once rolled) its machine reason. */
export const refusal_body = (error, reason = null) => JSON.stringify(reason == null ? { error } : { error, reason })

/** Drive the REAL sponsored door through execute_tx's sponsored-first route on a low zkLogin wallet. */
export const run_sponsored_first = ({ execute_tx, execute_sponsored_tx, wallet }) =>
  execute_tx({
    wallet,
    address: ADDR,
    transaction: make_tx(),
    chain: CHAIN,
    cached_balance_mist: LOW,
    cached_balance_read_at_ms: Date.now(),
    sponsor_fallback: {
      fetch_balance_mist: mock(async () => LOW),
      run_sponsored: (transaction) =>
        execute_sponsored_tx({ wallet, address: ADDR, transaction, chain: CHAIN, sponsor_url: SPONSOR_URL }),
    },
  })
