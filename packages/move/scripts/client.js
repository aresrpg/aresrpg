// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

const { PRIVATE_KEY, NETWORK = 'testnet', SUI_GRPC_URL } = process.env

// Signer resolution — keyless by default (never export the raw key). A
// `suiprivkey` in PRIVATE_KEY stays an explicit override; when it is absent we load the ACTIVE
// address's Ed25519 key straight from the Sui CLI keystore. The secret is never printed, logged,
// written, or `sui keytool export`ed — we only derive public addresses to find the right entry.
function load_signer() {
  if (PRIVATE_KEY) {
    return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(PRIVATE_KEY).secretKey)
  }

  const config_dir = process.env.SUI_CONFIG_DIR || `${homedir()}/.sui/sui_config`

  const active_address = readFileSync(`${config_dir}/client.yaml`, 'utf8')
    .match(/^active_address:\s*"?(0x[0-9a-fA-F]+)"?/m)?.[1]
    ?.toLowerCase()
  if (!active_address) {
    throw new Error(`No active_address in ${config_dir}/client.yaml — run \`sui client\` or set PRIVATE_KEY`)
  }

  // sui.keystore = JSON array of base64 blobs; each is [flag byte][32-byte secret]. flag 0x00 = Ed25519.
  const keystore = JSON.parse(readFileSync(`${config_dir}/sui.keystore`, 'utf8'))
  for (const entry of keystore) {
    const blob = Buffer.from(entry, 'base64')
    if (blob.length !== 33 || blob[0] !== 0x00) continue // Ed25519 only
    const candidate = Ed25519Keypair.fromSecretKey(Uint8Array.from(blob.subarray(1)))
    if (candidate.getPublicKey().toSuiAddress() === active_address) return candidate
  }

  throw new Error(
    `No Ed25519 key in ${config_dir}/sui.keystore matches active address ${active_address}. ` +
      `Only Ed25519 (flag 0x00) is supported — if this address uses secp256k1/r1, ` +
      `\`sui client switch\` to an Ed25519 address or set PRIVATE_KEY.`
  )
}

const keypair = load_signer()

// Mysten killed official JSON-RPC on testnet (fullnode.testnet.sui.io JSON-RPC = 404, retested 07-13); the
// gRPC Core API is the SSOT for every seed/ceremony read + tx (mirrors packages/sdk/src/sui.js's client). The
// consensus address-balance gas the ops wallet uses is resolved NATIVELY by the gRPC core tx resolver (no
// discrete Coin objects needed — the old raw suix_getCoins fallback is retired). SUI_GRPC_URL overrides the
// official fullnode gRPC endpoint per-env without a code change — ONLY mysten official endpoints
// (publicnode is FORBIDDEN and does not speak gRPC anyway).
const grpc_url =
  SUI_GRPC_URL ||
  (NETWORK === 'mainnet'
    ? 'https://fullnode.mainnet.sui.io:443'
    : NETWORK === 'localnet'
      ? 'http://127.0.0.1:9000'
      : 'https://fullnode.testnet.sui.io:443')

const sui_client = new SuiGrpcClient({ network: NETWORK, baseUrl: grpc_url })

export { NETWORK, keypair, sui_client }
