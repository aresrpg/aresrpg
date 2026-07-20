#!/usr/bin/env bun
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Generate a FRESH, dedicated ed25519 sponsor keypair for the local gas pool.
//
// The gas pool signs the SPONSOR half of player transactions, so its key must be
// its OWN funded testnet key — NEVER SUI_MASTER_KEY or any named production
// wallet (prod-key fence law). This prints a new address to fund and the base64
// keypair to paste into your .env as GAS_POOL_KEYPAIR. Nothing is written to a
// committed file; the temporary key material is removed before exit.
//
// Usage: bun generate-keypair.mjs

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'ares-gas-key-'))
try {
  // `sui keytool generate` writes <address>.key (holding the base64 flag||secret
  // keypair — exactly the shape the pool's signer-config wants) and prints the
  // address as JSON.
  const out = execFileSync('sui', ['keytool', 'generate', 'ed25519', '--json'], {
    cwd: dir,
    encoding: 'utf8',
  })
  const { suiAddress } = JSON.parse(out)
  const keyfile = readdirSync(dir).find((f) => f.endsWith('.key'))
  if (!keyfile) throw new Error('sui keytool did not write a .key file')
  const keypair_b64 = readFileSync(join(dir, keyfile), 'utf8').trim()
  // generate-config.mjs accepts either shape; print the bech32 form as the recommended one — it's
  // what a prod wallet export looks like (2026-07-13), base64 stays a fallback.
  const { bech32WithFlag } = JSON.parse(
    execFileSync('sui', ['keytool', 'convert', keypair_b64, '--json'], { encoding: 'utf8' })
  )

  console.log('Fresh gas-pool sponsor key (DEV ONLY — fund it, keep it out of git):\n')
  console.log(`  address:          ${suiAddress}`)
  console.log(`  GAS_POOL_KEYPAIR=${bech32WithFlag}`)
  console.log(`  (legacy base64 form also accepted: ${keypair_b64})\n`)
  console.log('Next steps:')
  console.log(`  1. Fund it on testnet:  sui client faucet --address ${suiAddress}`)
  console.log('  2. Add the GAS_POOL_KEYPAIR line to your .env (gitignored).')
  console.log('  3. docker compose --profile gas up   (or run natively — see README.md).')
} finally {
  // Never leave key material on disk — the operator persists it in .env.
  rmSync(dir, { recursive: true, force: true })
}
