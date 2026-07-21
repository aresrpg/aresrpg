// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// tx RECEIPT SHAPES — the leaf both the S-54 tx choke (index.ts) and its gas-selection fallback
// (gas_fallback.ts) import. Homing the shared types here lets the fallback stop reaching back into index for a
// type, which closed an import CYCLE (index → gas_fallback → index). The runtime never cycled — that back-edge
// was type-only, erased at compile — but the arch gate counts type edges under tsPreCompilationDeps.

// `effects_result` — the RAW gRPC Core result ({ Transaction | FailedTransaction }, the parseTransaction union) when
// the tx executed through the EXECUTE-CERT fast path (`want_effects`, the fight commit choke). Its presence lets the
// caller read the CERTIFIED effects directly and SKIP the separate waitForTransaction read (a ~570ms testnet
// ledger-availability lag). Absent on the wallet-execute path and on a sponsor fallback ⇒ the caller waits as before.
export type TxReceipt = { digest: string; effects?: string; bytes?: string; effects_result?: any }
export type SponsoredReceipt = {
  digest: string
  effects: { status: { status: 'success' | 'failure'; error?: string } }
}
