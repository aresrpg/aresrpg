// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE PROD-SMOKE SIGNER'S PURE CORE — every DECISION the live-testnet wallet shim makes, with zero SDK,
// zero network and zero browser, so all of it is driven off CI (signing_ledger_test.ts).
//
// #1723 indicted prod_smoke.spec.ts as an instrument with no oracle: not one row asserted that a signature
// had ever happened, so a shim that silently never signed read exactly like a green gate. Two decisions
// were buried inside the spec and are now here, testable:
//   · the GUARD — the predicate that decides the smoke can see at all.
//   · the VERDICT — how an execute response becomes a digest or a loud refusal, plus the ledger of what
//     was really signed, which is the oracle a row can finally assert against.
//
// #1774/#1723 also claimed SuiGrpcClient cannot resolve transactions (true at @mysten/sui 1.45.2). At the
// 2.20.1 this tree pins, GrpcCoreClient implements resolveTransactionPlugin() over SimulateTransaction and
// resolves unresolved shared-object inputs with gas selection — measured against testnet before this
// change. What was missing was never the resolver; it was the oracle.

export type signing_entry = { readonly op: 'personal' | 'sign' | 'execute'; readonly digest?: string }

export type execute_response = {
  Transaction?: executed_transaction
  FailedTransaction?: executed_transaction
}

type executed_transaction = {
  digest?: string
  effects?: { status?: { success?: boolean; error?: { message?: string } } }
}

// edge-smoke.yml's step zero refuses on `-z "${VITE_DEV_KEY//[[:space:]]/}"`. The consumer used to guard
// mere emptiness, so a whitespace-only secret cleared it and died inside decodeSuiPrivateKey halfway
// through a 45-minute job, reading as an ordinary product red. A guard whose predicate differs from its
// consumer's is theater (#1835's idiom); these two now refuse on exactly the same input.
export function dev_key_or_throw(raw: string | undefined) {
  const key = (raw ?? '').trim()
  if (!key)
    throw new Error(
      'VITE_DEV_KEY is absent or blank — the real-signing prod-smoke is BLIND and must never report a ' +
        'verdict (edge-smoke.yml step zero refuses the same predicate)'
    )
  return key
}

// THE THIRD RED, kept distinguishable on purpose. A real-signing smoke has three ways to go wrong and they
// mean completely different things: the secret is missing (BLIND — the guard above), the wallet has no gas
// (UNFUNDED — this), or the signing route itself broke (the verdict below). Without this floor, an unfunded
// wallet surfaces as a gas-selection failure deep inside the suite and reads exactly like a broken product.
// One of this suite's writes costs single-digit millions of MIST; the floor sits two orders of magnitude
// above that so the alarm fires with days of slack rather than after the first red.
export const WALLET_FLOOR_MIST = 100_000_000n

export function assert_wallet_above_floor({
  address,
  balance_mist,
  floor_mist = WALLET_FLOOR_MIST,
}: {
  address: string
  balance_mist: bigint
  floor_mist?: bigint
}) {
  if (balance_mist < floor_mist)
    throw new Error(
      `smoke wallet ${address} holds ${balance_mist} MIST, under the ${floor_mist} floor — FUND IT. This is a ` +
        'FUNDING failure and never a product one: every signing row below would otherwise red for the wrong reason.'
    )
  return balance_mist
}

// A chain refusal, an empty response and a missing digest are all failures of the SIGNING ROUTE, never
// data a row may proceed on. Every one of them throws by name — no silent success, no fabricated digest.
export function executed_digest(response: execute_response) {
  const executed = response.Transaction ?? response.FailedTransaction
  if (!executed) throw new Error('testnet execute returned no transaction result — the signing route is dead')
  if (!(executed.effects?.status?.success ?? false))
    throw new Error(executed.effects?.status?.error?.message ?? `transaction ${executed.digest} failed on chain`)
  if (!executed.digest) throw new Error('testnet execute reported success with no digest — an unciteable claim')
  return executed.digest
}

// The ledger is append-only and never mutated in place: a signer replaces its own value, callers read a copy.
export const record_signature = (ledger: readonly signing_entry[], entry: signing_entry): readonly signing_entry[] => [
  ...ledger,
  entry,
]

// The oracle a live row asserts against: did this suite really sign and really execute, and can it cite it?
export function assert_signed_and_executed(ledger: readonly signing_entry[]) {
  const executed = ledger.filter((entry) => entry.op === 'execute' && !!entry.digest)
  if (!executed.length)
    throw new Error(
      `the prod-smoke row claims a signed transaction but the signer's ledger holds none (${
        ledger.map((entry) => entry.op).join(',') || 'empty'
      }) — the shim signed nothing`
    )
  return executed.map((entry) => entry.digest as string)
}
