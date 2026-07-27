// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ceremony_preflight_compat.mjs — catch IncompatibleUpgrade BEFORE any ceremony, mechanically. Runs
// `sui client upgrade --serialize-unsigned-transaction` per package (no signing, no execution, no gas —
// pure local verification) and parses the compatibility verifier's verdict. Companion to
// ceremony_upgrade.mjs: read-only against chain + local build, never mutates anything on-chain.
//
// THE Published.toml TRAP (found running this probe live 2026-07-27, foundation/#1110): the bare
// `sui client upgrade` CLI diffs the local build against Published.toml's `published-at`, NOT the
// `--upgrade-capability`'s live on-chain `.package` — and Published.toml drifts stale the exact way
// ceremony_upgrade.mjs's header already documents (delta 3). A stale published-at silently points at a
// DEAD package and the check passes for the wrong reason: verified live — foundation read COMPATIBLE
// against its own stale published-at, INCOMPATIBLE against the real live package (17 errors: 16×E01001 +
// 1×E01002, matching #1110/#1208 exactly). So this script derives ground truth the SAME way
// ceremony_upgrade.mjs does (on-chain UpgradeCap.package first, the manifest's pkg/latest as fallback),
// TEMPORARILY patches published-at to that ground truth for the duration of the CLI call, and ALWAYS
// restores the original file byte-for-byte after (switch-back law, mirrors env_guard.mjs) — success,
// failure, or throw.
//
// Usage: node ceremony_preflight_compat.mjs [pkg...]   (default: foundation aresrpg engine dungeon)
// NETWORK env selects the target (default testnet); the CLI's ambient active-env must already match it
// (assert_env — fail-closed, never switches for you). Exits non-zero if any requested package is
// INCOMPATIBLE (or errors for a non-compatibility reason) — wire this into CI/pre-ceremony checks.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  MOVE_DIR,
  MANIFEST_PATH,
  PKG_DEPS,
  parsePublishedToml,
  getNetwork,
  getClient,
} from './ceremony_lib.mjs'
import { assert_env } from './env_guard.mjs'

const DEFAULT_PACKAGES = ['foundation', 'aresrpg', 'engine', 'dungeon']
const RELEASE_PATH = path.resolve(
  MOVE_DIR,
  '../sdk/src/deployment/release.json'
)

const HELP = `ceremony_preflight_compat — catch IncompatibleUpgrade BEFORE the ceremony, mechanically.

Usage: node ceremony_preflight_compat.mjs [pkg...]

  pkg    one or more of: ${Object.keys(PKG_DEPS).join(', ')}
         defaults to: ${DEFAULT_PACKAGES.join(' ')}

For each package, runs \`sui client upgrade --serialize-unsigned-transaction\` against its source dir
(no signing, no execution, no gas) and parses the local compatibility verifier's verdict. Prints one row
per package — "<name> COMPATIBLE" or "<name> INCOMPATIBLE  <count>x<E-code> ..." — and exits non-zero if
any requested package is incompatible (or errors for a non-compatibility reason).

Env:
  NETWORK          testnet (default) | mainnet — must match the CLI's active-env (assert_env, fail-closed)
  SUI_CONFIG_DIR   override for ~/.sui/sui_config (identity/env source)

Read-only against chain + local build. Never mutates on-chain state. Published.toml is patched to the
ground-truth on-chain package id only for the duration of the CLI call, then restored byte-for-byte.`

// Swap `[published.<net>]`'s published-at for `addr` — string surgery, not a re-parse/re-serialize, so
// the revert writes the ORIGINAL bytes back untouched (comments, formatting, everything).
function withPublishedAt(content, net, addr) {
  const re = new RegExp(
    `(\\[published\\.${net}\\][\\s\\S]*?published-at\\s*=\\s*)"[^"]*"`
  )
  if (!re.test(content))
    throw new Error(
      `Published.toml has no [published.${net}] published-at to patch`
    )
  return content.replace(re, `$1"${addr}"`)
}

// `error[Compatibility E#####]: <reason>` — Sui prints these to stdout; stderr carries only build notes.
// Both streams get concatenated before this runs so a toolchain change never silently blinds the gate.
function parseCompatErrors(output) {
  const counts = new Map()
  for (const [, code, reason] of output.matchAll(
    /error\[Compatibility (E\d{5})\]: ([^\n]+)/g
  )) {
    const key = `${code} ${reason.trim()}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

async function resolveGroundTruth(client, name, entry) {
  const manifestPkg = entry.latest ?? entry.pkg
  try {
    const { objects } = await client.core.getObjects({
      objectIds: [entry.upgradeCap],
      include: { json: true },
    })
    const cap = objects?.[0]
    if (cap instanceof Error) throw cap
    if (cap?.json?.package)
      return { target: cap.json.package, source: 'upgrade-cap' }
    console.warn(
      `${name}: UpgradeCap content not decoded by the node — falling back to manifest`
    )
  } catch (e) {
    console.warn(
      `${name}: UpgradeCap read failed (${e?.message ?? e}) — falling back to manifest`
    )
  }
  if (!manifestPkg)
    throw new Error(
      `${name}: no on-chain cap.package and no manifest pkg/latest — refusing to guess`
    )
  return { target: manifestPkg, source: 'manifest' }
}

async function checkPackage(client, release, network, name) {
  const entry = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))[name]
  if (!entry)
    return {
      name,
      status: 'error',
      detail: `no "${name}" entry in ${MANIFEST_PATH}`,
    }
  if (!entry.upgradeCap)
    return { name, status: 'error', detail: 'manifest entry has no upgradeCap' }

  const { target, source } = await resolveGroundTruth(client, name, entry)

  const releasePkg = release?.networks?.[network]?.packages?.[name]?.latest
  if (releasePkg && releasePkg !== target)
    console.warn(
      `${name}: release.json .latest (${releasePkg}) disagrees with ${source} (${target}) — using ${source}`
    )

  const pkgPath = path.join(MOVE_DIR, name)
  const pubFile = path.join(pkgPath, 'Published.toml')
  const original = fs.readFileSync(pubFile, 'utf8')
  const prior = parsePublishedToml(original, network)
  const needsPatch = prior?.publishedAt !== target

  if (needsPatch)
    fs.writeFileSync(pubFile, withPublishedAt(original, network, target))

  let output = ''
  let exitCode = 0
  try {
    output = execSync(
      `sui client upgrade --serialize-unsigned-transaction --upgrade-capability ${entry.upgradeCap} ${pkgPath}`,
      { encoding: 'utf-8' }
    )
  } catch (e) {
    exitCode = e.status ?? 1
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`
  } finally {
    if (needsPatch) fs.writeFileSync(pubFile, original)
  }

  const errors = parseCompatErrors(output)
  if (errors.size > 0)
    return { name, status: 'incompatible', errors, target, source }
  if (exitCode !== 0)
    return {
      name,
      status: 'error',
      detail: `exit ${exitCode} — ${output.trim().split('\n').slice(-5).join(' | ')}`,
    }
  return { name, status: 'compatible', target, source }
}

async function main() {
  if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    console.log(HELP)
    return
  }

  const network = getNetwork()
  assert_env(network)

  const requested = process.argv.slice(2)
  const packages = requested.length ? requested : DEFAULT_PACKAGES
  for (const name of packages)
    if (!(name in PKG_DEPS))
      throw new Error(
        `unknown package "${name}" — one of: ${Object.keys(PKG_DEPS).join(', ')}`
      )

  const release = fs.existsSync(RELEASE_PATH)
    ? JSON.parse(fs.readFileSync(RELEASE_PATH, 'utf8'))
    : null
  const client = getClient(network)

  let anyFailed = false
  for (const name of packages) {
    const result = await checkPackage(client, release, network, name)
    if (result.status === 'compatible') {
      console.log(
        `${name} COMPATIBLE  (target ${result.target}, from ${result.source})`
      )
    } else if (result.status === 'incompatible') {
      anyFailed = true
      const detail = [...result.errors].map(([k, n]) => `${n}x${k}`).join('  ')
      console.log(`${name} INCOMPATIBLE  ${detail}`)
    } else {
      anyFailed = true
      console.log(`${name} ERROR  ${result.detail}`)
    }
  }

  process.exit(anyFailed ? 1 : 0)
}

main().catch((e) => {
  console.error(`ceremony_preflight_compat: ${e?.message ?? e}`)
  process.exit(1)
})
