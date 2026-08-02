#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE SMOKE WALLET'S FUNDING ALARM — step zero's second half (#1835's idiom, one layer deeper).
//
// edge-smoke.yml already refuses to run blind: an absent VITE_DEV_KEY fails loud and first rather than
// dying mid-suite. A key that exists but funds nothing is the same class of lie: every signing row reds,
// each one reading like a broken product, and the actual fact — nobody topped the wallet up — is nowhere
// in the failure. This alarm makes those two reds impossible to confuse, before a browser is installed
// and before a single minute of the 45-minute job is spent.
//
// The address is DERIVED from the key and printed; the key itself is never read into any output. The only
// decision here (the floor) lives in the smoke's pure core, so the suite and this alarm cannot disagree.
import process from 'node:process'

import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

import {
  WALLET_FLOOR_MIST,
  assert_wallet_above_floor,
  dev_key_or_throw,
} from '../test/gold/specs_prod_smoke/signing_ledger.ts'

const GRPC_URL = process.env.SUI_GRPC_URL ?? 'https://fullnode.testnet.sui.io:443'

// Each failure carries its OWN annotation title, because "the secret is missing", "the wallet is empty" and
// "the signing route broke" are three different jobs for three different people. A red that cannot say which
// one it is costs an investigation every time it fires.
const refuse = (title, message) => {
  console.error(`::error title=${title}::${message}`)
  process.exitCode = 1
}

try {
  const key = dev_key_or_throw(process.env.VITE_DEV_KEY)
  const address = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(key).secretKey).getPublicKey().toSuiAddress()
  const client = new SuiGrpcClient({ network: 'testnet', baseUrl: GRPC_URL })
  const { balance } = await client.core.getBalance({ owner: address })
  try {
    const held = assert_wallet_above_floor({ address, balance_mist: BigInt(balance.balance) })
    console.log(`smoke wallet ${address} holds ${held} MIST — above the ${WALLET_FLOOR_MIST} floor`)
  } catch (unfunded) {
    refuse('smoke wallet unfunded', unfunded.message)
  }
} catch (blind) {
  refuse('blind smoke', blind.message)
}
