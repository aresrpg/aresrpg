// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Machine-readable sponsor refusal markers shared by the sponsor door and every routing edge. This leaf stays
// free of auth/UI imports so a fallback can preserve a refusal without closing a cycle through tx/index.ts.

export const SPONSOR_REFUSAL_OUTDATED_PACKAGE = 'outdated-package'

export function is_sponsor_outdated_package_refusal(error: unknown): boolean {
  return (
    (error as { sponsor_refusal?: string } | null | undefined)?.sponsor_refusal === SPONSOR_REFUSAL_OUTDATED_PACKAGE
  )
}

// #1385 — the sponsor's dry-run says this PTB WOULD ABORT, so it refused before reserving any gas (zero spend).
// BLOCKING, never a silent self-pay re-route: a would-fail tx fails self-paid too, and re-routing it would swap the
// honest decoded cause for a misleading balance error on exactly the zero-SUI wallet the sponsor exists to serve.
export const SPONSOR_REFUSAL_WOULD_ABORT = 'would-abort'

export function is_sponsor_would_abort_refusal(error: unknown): boolean {
  return (error as { sponsor_refusal?: string } | null | undefined)?.sponsor_refusal === SPONSOR_REFUSAL_WOULD_ABORT
}

// #796 — the @server could not PRICE this PTB, which is not the same fact as the chain saying it would fail.
// `simulation-unreadable` is a simulation result carrying no success verdict; `simulation-infrastructure` is an
// RPC that threw or never answered. Both are the @server's own trouble, not the player's action being invalid,
// and both are machine markers precisely so the client stops inferring that from the diagnostic TEXT — the
// prior `/unpriceable/` regex over `detail` read a server-authored string that no test pinned.
export const SPONSOR_REFUSAL_SIMULATION_UNREADABLE = 'simulation-unreadable'
export const SPONSOR_REFUSAL_SIMULATION_INFRASTRUCTURE = 'simulation-infrastructure'

export function is_sponsor_unpriceable_refusal(error: unknown): boolean {
  const marker = (error as { sponsor_refusal?: string } | null | undefined)?.sponsor_refusal
  return marker === SPONSOR_REFUSAL_SIMULATION_UNREADABLE || marker === SPONSOR_REFUSAL_SIMULATION_INFRASTRUCTURE
}
