// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BUILD-TIME visibility gate for the non-production wallet-standard connect path (#73).
//
// zkLogin (Google/Enoki) needs pre-registered OAuth redirect URLs, so it cannot complete on Vercel
// preview deployments (their URLs are dynamic) — preview builds would otherwise be unloggable. The
// wallet-standard connect path fills that gap, but ONLY in Vite dev mode: every production bundle must
// hide it, independent of which provider builds or deploys that bundle. `import.meta.env.PROD` is Vite's
// built-in static build flag, so the bundler folds the decision; it is never a runtime toggle or CSS hide.

/**
 * PURE gate over Vite's production-build fact.
 * @returns whether the wallet-connect option may render.
 */
export function wallet_connect_enabled(production_build: boolean): boolean {
  return !production_build
}

/** Resolve the gate against Vite's build-time mode. */
export function is_wallet_connect_enabled(): boolean {
  return wallet_connect_enabled(import.meta.env.PROD)
}
