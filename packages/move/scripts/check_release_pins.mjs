#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// check_release_pins.mjs — the CHAIN-TRUTH pin gate (issue #770).
//
// release.json's `latest` is the CALL TARGET every SDK moveCall resolves through
// (packages/sdk/src/deployment/aresrpg.js: LATEST_PACKAGE_ID). It only ever moves when an upgrade
// ceremony records the fresh id (ceremony_upgrade.mjs writes `<pkg>.latest` into the ceremony
// manifest, then auto-stamps). #770: two aresrpg upgrades executed on testnet and NEITHER
// recording landed — the pins kept the origin as `latest`, so every live call ran v1 bytecode
// while the chain had moved twice. Nothing caught it: the in-tree gates are hermetic, and a
// hermetic gate cannot see chain drift.
//
// The chain answers "what is latest" itself: each package's `0x2::package::UpgradeCap.package`
// IS the newest published version of that lineage. This reads those caps (READ-ONLY, no signer,
// no keystore) and fails on any package whose pinned `latest` is not the cap's package.
//
// NOT wired into `bun run lint`/CI — it needs a fullnode. Run it after every ceremony and in the
// ops loop: `node packages/move/scripts/check_release_pins.mjs [--network testnet]`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

const script_path = file_url_to_path(import.meta.url)
const repo = path.resolve(path.dirname(script_path), '../../..')
const RELEASE_PATH = 'packages/sdk/src/deployment/release.json'

/**
 * Pure comparison: pinned package rows vs the chain's own answer (cap id → the package that cap
 * governs). A package whose cap was not read (absent key / read failure) is reported UNKNOWN, never
 * silently passed — an unreadable cap proves nothing about the pin.
 * @param {Record<string, { latest?: string, upgrade_cap?: string }>} packages
 * @param {Record<string, string | null>} cap_packages upgrade_cap id → the package it points at
 * @returns {{ name: string, pinned: string, chain: string | null, status: 'ok' | 'drift' | 'unknown' }[]}
 */
export function compare_release_pins(packages, cap_packages) {
  return Object.entries(packages ?? {}).map(([name, row]) => {
    const pinned = row?.latest ?? ''
    const chain = cap_packages?.[row?.upgrade_cap ?? ''] ?? null
    if (!chain) return { name, pinned, chain: null, status: 'unknown' }
    return { name, pinned, chain, status: chain === pinned ? 'ok' : 'drift' }
  })
}

/** Render one report line per package — the same shape in every caller. */
export function format_pin_rows(rows) {
  return rows.map(
    ({ name, pinned, chain, status }) =>
      `${name.padEnd(11)} pinned.latest=${pinned || '(unset)'} chain.latest=${chain ?? '(unreadable)'} ${status.toUpperCase()}`,
  )
}

async function read_cap_packages(client, cap_ids) {
  const { objects } = await client.core.getObjects({
    objectIds: cap_ids,
    include: { json: true },
  })
  return Object.fromEntries(
    cap_ids.map((cap_id, index) => {
      const object = objects?.[index]
      return [cap_id, object instanceof Error ? null : (object?.json?.package ?? null)]
    }),
  )
}

async function main(network = 'testnet') {
  const { SuiGrpcClient } = await import('@mysten/sui/grpc')
  const release = JSON.parse(fs.readFileSync(path.join(repo, RELEASE_PATH), 'utf8'))
  const packages = release?.networks?.[network]?.packages
  if (!packages) throw new Error(`${RELEASE_PATH} has no networks.${network}.packages`)

  const client = new SuiGrpcClient({
    network,
    baseUrl: process.env.SUI_GRPC_URL || `https://fullnode.${network}.sui.io:443`,
  })
  const cap_ids = [...new Set(Object.values(packages).map(row => row.upgrade_cap).filter(Boolean))]
  const rows = compare_release_pins(packages, await read_cap_packages(client, cap_ids))

  console.log(`== AresRPG release-pin chain gate (${network}: UpgradeCap.package vs ${RELEASE_PATH} latest, #770) ==`)
  for (const line of format_pin_rows(rows)) console.log(`  ${line}`)

  const broken = rows.filter(row => row.status !== 'ok')
  if (!broken.length) {
    console.log(`RELEASE PIN GATE PASSED. every ${network} package pins the chain's newest version.`)
    return 0
  }
  console.log(
    'RELEASE PIN GATE FAILED. A pinned `latest` is not the chain\'s newest package version — every SDK moveCall through LATEST_PACKAGE_ID targets retired bytecode (#770 class).',
  )
  console.log(
    '  Fix: record the fresh id in packages/move/scripts/out/ceremony_manifest.json (`<pkg>.latest`) and re-run `node packages/move/scripts/stamp_all.mjs` — never hand-edit release.json.',
  )
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === script_path) {
  const index = process.argv.indexOf('--network')
  try {
    process.exitCode = await main(index === -1 ? 'testnet' : process.argv[index + 1])
  } catch (error) {
    console.error(`release-pin gate: ${error.message}`)
    process.exitCode = 2
  }
}
