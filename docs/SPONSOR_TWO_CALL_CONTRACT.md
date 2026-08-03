<!-- SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available -->

# Sponsor two-call contract

> This document is derived from the landed code, not an independent authority. Code is truth; re-generate this
> page whenever the contract changes. The anchors below identify the implementations each side may rely on.

## Authority and scope

The browser talks only to the `@server` sponsor. The sponsor fronts the internal gas station, which owns the gas
key, co-signs, submits, and waits for finality; the browser never submits a sponsored transaction
(`packages/frontend/src/tx/index.ts:437`, `packages/frontend/src/tx/index.ts:770`). The public two-call doors are
`POST <sponsor_url>/reserve` and `POST <sponsor_url>/execute` (`api/sponsor.mjs:822`).

## Call 1: reserve

- Request: `{ txKindBytes, sender, challenge, signature }`. `txKindBytes` is the base64 kind-only PTB; the
  challenge is sender-bound and the signature is its zkLogin personal-message signature
  (`packages/frontend/src/tx/index.ts:699`, `packages/frontend/src/tx/index.ts:743`).
- The server authenticates and prices that exact transaction kind before reserving station gas. A refusal from
  this call is pre-execution: no sponsored transaction was submitted (`api/sponsor.mjs:617`,
  `api/sponsor.mjs:668`).
- Success: `{ reservationId, sponsorAddress, gasCoins, gasBudget }` (`api/sponsor.mjs:748`,
  `api/sponsor.mjs:763`).

## Between the calls

The client applies its sender plus the returned gas owner, gas payment, and gas budget to the same `Transaction` object,
then asks the wallet to sign that gas-pinned transaction and uses the returned bytes and sender signature
(`packages/frontend/src/tx/index.ts:758`, `packages/frontend/src/tx/index.ts:770`). The server consumes the
reservation once and verifies sender, gas owner, budget, payment coin set, and rebuilt kind against the reserved
values (`api/sponsor.mjs:588`, `api/sponsor.mjs:771`). Neither side may rebuild or alter the PTB kind between calls.

## Call 2: execute

- Request: `{ reservationId, txBytes, userSig }` (`packages/frontend/src/tx/index.ts:780`,
  `api/sponsor.mjs:771`).
- The sponsor sends the station `{ reservation_id, tx_bytes, user_sig, options }`, where `options` is exactly
  `{ showEffects: true, showObjectChanges: true, showEvents: true }` (`api/sponsor.mjs:550`,
  `api/sponsor.mjs:558`).
- The station execute is called exactly once. An answer carrying effects proves execution and is never retried;
  absence of effects is treated as a pre-execution rejection (`api/sponsor.mjs:792`, `api/sponsor.mjs:800`).
- Once `/execute` may have submitted, transport failure, HTTP 5xx, or an unreadable success body has unknown
  outcome and must not fall through to any re-signing path (`packages/frontend/src/tx/index.ts:625`,
  `packages/frontend/src/tx/index.ts:633`). A decoded 4xx remains a proven pre-execution refusal.

## Certified execute response

An options-aware station nests the full response at `tx_block_response`. The sponsor reads effects as
`tx_block_response.effects ?? body.effects ?? null`: nested effects are canonical, while the flat field remains a
compatibility proof that gas burned (`api/sponsor.mjs:550`, `api/sponsor.mjs:572`).

`objectChanges` and `events` are accepted only as arrays nested under `tx_block_response`. Missing, non-array, or
options-blind values become `null`; top-level copies are not adopted (`api/sponsor.mjs:576`). The public success
body is `{ effects, digest, objectChanges?, events? }`. `digest` comes from `effects.transactionDigest`; each
adoption field is omitted when its nested array was unavailable and is never replaced with a fake empty array
(`api/sponsor.mjs:811`). A genuinely returned empty array remains present.

## Client receipt projection

The execute body crosses one adapter, `sponsored_execute_result`, before the existing `normalize_receipt` door
(`packages/frontend/src/tx/index.ts:800`, `packages/frontend/src/chain/receipt.ts:64`). The adapter returns `null`
unless **both** `objectChanges` and `events` are arrays. Thus incomplete proof means “keep the honest
`waitForTransaction` path”, not “the transaction changed/emitted nothing”; two present empty arrays are complete
and valid (`packages/frontend/src/chain/receipt.ts:73`, `packages/frontend/src/tx/receipts.ts:13`).

For a complete proof, the adapter:

1. keeps only `created` and `mutated` changes and projects them to Core `changedObjects` plus `objectTypes`;
2. projects JSON-RPC events to Core `{ eventType, json }` and carries station `gasUsed` through;
3. chooses `{ Transaction: tx }` only for status `success`, otherwise `{ FailedTransaction: tx }`.

These are the two union arms `normalize_receipt` already consumes. The arm determines normalized success/failure;
the normalizer projects created/mutated objects, events, error, and decimal-string gas totals
(`packages/frontend/src/chain/receipt.ts:35`, `packages/frontend/src/chain/receipt.ts:76`). The caller exposes that
union as optional `effects_result`; absence preserves its fullnode wait (`packages/frontend/src/tx/index.ts:807`).

## Error decoder keys

Server errors are `{ error, reason?, chain_error? }`; `reason` and `chain_error` are structural fields, not text to
recover from the diagnostic (`api/sponsor.mjs:146`, `packages/frontend/src/tx/index.ts:609`). The client decoder at
`packages/frontend/src/tx/index.ts:526` applies these keys in order:

| Wire key                                                           | Client result                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| reason `would-abort` (+ `chain_error`)                             | preflight chain-error decoder; marker `would-abort`                      |
| reason `simulation-unreadable` or `simulation-infrastructure`      | `errors.sponsor_unpriceable`; same marker                                |
| reason `outdated-package`, HTTP 410, or `sponsor-two-call-upgrade` | `errors.sponsor_stale_client`; marker `outdated-package`                 |
| reason `self-pay-required`                                         | `errors.sponsor_self_pay`; marker permitting the intended self-pay route |
| reason `daily-cap`                                                 | `errors.sponsor_daily_limit`; blocking marker, never automatic self-pay  |
| prefix `sponsor-unavailable`                                       | `errors.sponsor_unreachable`                                             |
| HTTP 429 or rate-limit text                                        | `errors.sponsor_rate_limited`                                            |
| `zklogin-` / `sponsor-scope` / `sponsor-unpriceable`               | `errors.sponsor_zklogin` / `.sponsor_scope` / `.sponsor_unpriceable`     |
| `sponsor-over-ceiling` / `sponsor-reserve-failed`                  | `errors.sponsor_over_ceiling` / `.sponsor_reserve_failed`                |
| reservation unknown, tx mismatch/invalid, or execute rejected      | `errors.sponsor_retry`                                                   |
| station down/error/misconfig                                       | `errors.sponsor_unreachable`                                             |
| no gas coins/insufficient gas / `sponsor-busy`                     | `errors.sponsor_empty` / `errors.tx_lock_race_retry`                     |

Legacy self-pay and daily-cap text is consulted only when `reason` is absent (`packages/frontend/src/tx/index.ts:503`).
Unknown mappings retain HTTP status and the raw diagnostic. `outcome-unknown` is minted only by the client after an
ambiguous `/execute` result; it is not a server refusal reason (`packages/frontend/src/tx/sponsor_refusal.ts:36`).
