// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEPS SHIM — the zero-wiring bridge to @mysten/* for bots that live under test/ (outside any workspace).
//
// WHY THIS EXISTS: bun's isolated install hoists @mysten/* into each workspace's own node_modules (+ the
// .bun store); a bare `import '@mysten/sui/jsonRpc'` from a file under test/ does NOT resolve (proven — no
// node_modules with @mysten on the path up from test/). But `createRequire` ANCHORED at the SDK's own
// package.json resolves every @mysten subpath to its physical file, which we then dynamically import. This
// needs NO change to the root package.json / workspaces (track 1 owns those) and works today.
//
// The house headless convention (packages/move/scripts/client.js, ceremony_lib.mjs, qa/_qa.mjs) is
// `SuiJsonRpcClient` from `@mysten/sui/jsonRpc` — NOT the base `@mysten/sui/client` (which dropped the
// JSON-RPC client in v2.20.x). We mirror it exactly: same class, same `{ digest, effects, objectChanges,
// events }` result shape every seed/ceremony script parses.
//
// INTEGRATION NOTE (the ONE clean alternative for track 1): add `test/localnet/bots` (or `test/*`) to the
// root `workspaces` array + `bun install`, then this file can be deleted in favour of bare specifiers. Until
// then this keeps the bot suite runnable with zero root edits.

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// Anchor at @aresrpg/sdk's package.json — it declares @mysten/sui + @mysten/kiosk as peer deps, so its
// resolver sees the installed physical copies. Path is relative to THIS file (no hardcoded absolute path).
const SDK_PKG = fileURLToPath(new URL('../../../../packages/sdk/package.json', import.meta.url))
const require_from_sdk = createRequire(SDK_PKG)

/** Resolve a bare @mysten specifier to its physical file and import it. */
async function mysten(specifier) {
  return import(require_from_sdk.resolve(specifier))
}

const jsonRpc = await mysten('@mysten/sui/jsonRpc')
const transactions = await mysten('@mysten/sui/transactions')
const ed25519 = await mysten('@mysten/sui/keypairs/ed25519')
const cryptography = await mysten('@mysten/sui/cryptography')
const utils = await mysten('@mysten/sui/utils')
const bcs_mod = await mysten('@mysten/sui/bcs')
const kiosk = await mysten('@mysten/kiosk')

export const { SuiJsonRpcClient } = jsonRpc
export const { getJsonRpcFullnodeUrl } = jsonRpc
export const { Transaction } = transactions
export const { Ed25519Keypair } = ed25519
export const { decodeSuiPrivateKey } = cryptography
export const { fromBase64 } = utils
// deriveDynamicFieldID + bcs power the live zone-DF read (framework/world_flow.js): a discovered zone is ONE
// dynamic field on the World UID keyed by `zones::ZoneKey{zx,zy}` — deriving its object id reads the whole
// zone's raw state (seed + consumed-bitmaps) in a single getObject, mirroring the SDK's own get_zone_state.
export const { deriveDynamicFieldID } = utils
export const { bcs } = bcs_mod
export const { KioskClient } = kiosk
export const { KioskTransaction } = kiosk
