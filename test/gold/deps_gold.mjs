// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEPS SHIM (gold) — resolve @mysten/* from OUTSIDE any workspace by anchoring a createRequire at the
// SDK's own package.json (the proven test/localnet/bots/framework/deps.js pattern, vendored because that
// file is owned by the live gate lane). House convention: SuiJsonRpcClient from '@mysten/sui/jsonRpc'.
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const SDK_PKG = fileURLToPath(new URL('../../packages/sdk/package.json', import.meta.url))
const require_from_sdk = createRequire(SDK_PKG)
const load = (spec) => import(require_from_sdk.resolve(spec))

export async function load_deps() {
  const [json_rpc, ed25519, crypto, tx, kiosk] = await Promise.all([
    load('@mysten/sui/jsonRpc'),
    load('@mysten/sui/keypairs/ed25519'),
    load('@mysten/sui/cryptography'),
    load('@mysten/sui/transactions'),
    load('@mysten/kiosk'),
  ])
  return {
    SuiJsonRpcClient: json_rpc.SuiJsonRpcClient,
    Ed25519Keypair: ed25519.Ed25519Keypair,
    decodeSuiPrivateKey: crypto.decodeSuiPrivateKey,
    Transaction: tx.Transaction,
    KioskClient: kiosk.KioskClient,
  }
}
