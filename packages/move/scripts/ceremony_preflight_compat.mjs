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
// Usage: node ceremony_preflight_compat.mjs [pkg...]   (default: every publishable package)
// NETWORK env selects the target (default testnet); the CLI's ambient active-env must already match it
// (assert_env — fail-closed, never switches for you). Exits non-zero if any requested package is
// INCOMPATIBLE (or errors for a non-compatibility reason) — wire this into CI/pre-ceremony checks.
//
// REPUBLISH MODE: while packages/move/REPUBLISH_WINDOW exists this gate runs SIZE-ONLY — see
// republish_window_verdict below for the mode's rules and its master-bound refusal.
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MOVE_DIR,
  MANIFEST_PATH,
  PKG_DEPS,
  parsePublishedToml,
  getNetwork,
  getClient,
} from './ceremony_lib.mjs'
import { assert_env } from './env_guard.mjs'

// EVERY publishable package, both modes (#1243): the old four-package default silently omitted
// kolizeum, forgemagie and gifting — precisely the three whose Published.toml disagrees with
// release.json. A package the gate never checks is a ceremony wedge by construction, so the default
// is the publish set itself and stays that way as packages are added.
const DEFAULT_PACKAGES = Object.keys(PKG_DEPS)
const RELEASE_PATH = path.resolve(
  MOVE_DIR,
  '../sdk/src/deployment/release.json'
)

// object_size ceiling the chain enforces on a published/upgraded Move package (protocol parameter
// `max_object_size`, protocol version 130). Publish/upgrade creates a MovePackage object; exceeding
// this aborts `MovePackageTooBig { object_size, max_object_size }` at EXECUTION — a dry-run/live cost,
// not a build-time one, which is exactly why a package can compile clean and still die on the chain
// (foundation/#1202, discovered mid-ceremony leg 2, 2026-07-27: aresrpg compiled fine, then refused
// on-chain at object_size 106584 against this 102400 ceiling).
const MAX_OBJECT_SIZE = 102_400

// ── The per-package size BUDGET (the PR-time half of this gate) ──────────────────────────────────
// The chain ceiling above is a cliff: crossing it is only discovered at EXECUTION, mid-ceremony,
// with gas already burned. `aresrpg` crossed it on edge at ff00a0b6 (#1442's set_template_effect
// door, 26 bytes over) and sat there breaching until #1581 — because the size leg only ever ran
// under a REPUBLISH_WINDOW marker, so in the steady state NOTHING measured this number on a PR.
//
// A budget is the cliff moved earlier, where it is cheap: a package over budget fails the PR that
// grew it, naming the bytes, instead of failing the ceremony that ships it. While the package-split
// decision (#1279) is open, a Move change that genuinely needs bytes bumps this line in the same
// reviewed commit — which is precisely the visibility #1442 did not have.
//
// aresrpg measures 101627 here with the honest cuts exhausted (every private name is already
// golfed, zero unused code, the shared pipelines already single-homed). The row is 101757, not
// 101627: this proxy is recomputed from a fresh `sui move build` on whatever host runs it, and a
// budget pinned to the exact byte would turn any 1-byte toolchain or host difference into a red on
// a PR that changed no Move source — and a required check that reds for nothing is a check someone
// disables. 130 bytes absorbs jitter while still failing 500 bytes BEFORE the ceiling; it is far
// inside anything a real change moves (#1442 crossed by hundreds).
//
// The remaining levers were re-measured at #1581 and are exhausted or unavailable under compat:
// doc comments cost ZERO bytecode bytes (272,692 chars stripped → byte-identical build, positive
// control: +20 trivial fns = +1016 bytes); the surviving `clamp` triple is a u64/u32/u16 TYPE
// family, not a duplicate; all 27 `*_for_testing` scaffolds are already `#[test_only]`; and 423 of
// the 641 shipped functions are `public`, which the compatibility verifier freezes. What is left is
// ~22.6 bytes of fixed overhead per package-internal function (measured) across 59 single-call-site
// ones — a ~1330-byte golf that trades 59 named seams for it, and the package-split decision
// (#1279) rather than this file's business.
//
// Budgets only SHRINK (FROZEN.md: baselines only shrink, severities only ratchet up). A package
// with no row here is held to the chain ceiling alone.
// 2026-08-01 (#1794): 101_818 → 99_239. 51 `public fun` whose only callers were Move tests became
// `#[test_only]` (Variant B), taking 1 private helper and 4 constants they orphaned with them —
// measured −2579 bytes, margin 582 → 3161. 19 AdminCap-gated operator levers that also had no
// non-test caller were deliberately KEPT public (emergency domain freeze, world teardown, config
// dials): incident response must not require a republish. Measured cost of that ruling: 2206 bytes.
// This is a REPUBLISH-only shrink: dropping public functions is an INCOMPATIBLE upgrade, so it
// lands with a fresh lineage, never over the live one.
// 2026-08-02 (freeze-bypass audit class 1): 99_239 → 99_260. +21 bytes, TWO `config.assert_enabled()` calls in
// `shop::buy`/`buy_many` (the market money door asserted only its S-46 DOMAIN bit, so the GLOBAL emergency
// freeze did not stop it selling) and ONE in `fight::y46` (the dungeon room-fight door, the only one of the
// three brand siblings missing the gate — `open_room_group_brand` and `y48` already had it). This is a gate
// RESTORED, not a feature: every byte buys back a kill-switch that measurably did not reach a money path.
// 2026-08-02 (#1836): 99_260 → 99_347. +87 bytes UNDOING part of the 07-30 shrink. Three
// `consumable_effect` discriminant accessors (`stat_reset`/`spell_reset`/`bag_open`) and the three constants
// they read were demoted to `#[test_only]` because the shrink's caller census reads Move sources and LITERAL
// JS `target:` strings — and the reseed ceremony composes this call by INTERPOLATED name
// (`::consumable_effect::${ceff.fn}`). A demoted door there is a whole-PTB abort at the next ceremony, so the
// bytes are not optional. `seed_full_corpus_doors.test.mjs` is the class gate that stops the next census
// missing the same shape.
const SIZE_BUDGETS = { aresrpg: 99_347 }

// ── The republish window ────────────────────────────────────────────────────────────────────────
// A REPUBLISH is not an upgrade: it mints a fresh package lineage, so the compatibility verifier's
// verdict is an assertion about a lineage nobody will ever upgrade. Asserting it anyway reds every
// PR that legitimately removes a module or changes a public struct — the exact work a republish
// exists to allow. The marker file packages/move/REPUBLISH_WINDOW declares that window open and
// switches this gate from compat-assert to SIZE-ONLY.
//
// What does NOT relax: the chain's 102400-byte package ceiling, which is a property of the protocol
// and not of the lineage. A republish that compiles over the cap fails at execution either way.
//
// This is a scoped mode with a visible in-diff switch, not a severity demotion: the compat teeth
// come back mechanically the moment the marker file is deleted at ceremony close, with no baseline
// to re-tighten and nothing to remember. And the window may never reach production — a master-bound
// run treats the marker's mere presence as a FAILURE (see republish_window_verdict), so the mode
// cannot survive the edge→master promotion unnoticed.
export const REPUBLISH_MARKER_PATH = path.join(MOVE_DIR, 'REPUBLISH_WINDOW')

// The CI facts the verdict is a function of — read once, at the edge, so the verdict itself is pure.
export function ci_context(env = process.env) {
  return {
    ci: Boolean(env.GITHUB_ACTIONS),
    event: env.GITHUB_EVENT_NAME || null,
    base_ref: env.GITHUB_BASE_REF || null,
    ref_name: env.GITHUB_REF_NAME || null,
  }
}

// Pure. → { mode: 'compat' | 'size-only' | 'refused', reason }
// Fail-closed on every context this does not recognise: an unrecognised CI event carrying the marker
// is refused rather than trusted, because the one thing that must never happen is the window opening
// on a master-bound run.
export function republish_window_verdict({
  marker_present,
  ci,
  event,
  base_ref,
  ref_name,
}) {
  if (!marker_present)
    return { mode: 'compat', reason: 'no REPUBLISH_WINDOW marker' }
  // A CONTRADICTORY context is refused before the local-run branch (#1305 review): "not CI" used to
  // rest on GITHUB_ACTIONS alone, so unsetting one variable while still supplying pull_request/master
  // facts downgraded a master-bound run to a permissive local one. If any GitHub context fact is
  // present, the whole context must be present and coherent.
  const partial = [event, base_ref, ref_name].some(Boolean)
  if (!ci && partial)
    return {
      mode: 'refused',
      reason: `REPUBLISH_WINDOW marker with a partial GitHub context (event="${event}", base="${base_ref}", ref="${ref_name}") — refusing a context that claims to be both CI and not`,
    }
  if (!ci)
    return {
      mode: 'size-only',
      reason: 'REPUBLISH_WINDOW marker, local run (no CI context)',
    }
  if (event === 'pull_request' && !base_ref)
    return {
      mode: 'refused',
      reason:
        'REPUBLISH_WINDOW marker on a pull_request with no base ref — refusing rather than guessing',
    }
  if (event === 'pull_request')
    return base_ref === 'edge'
      ? { mode: 'size-only', reason: 'REPUBLISH_WINDOW marker, PR into edge' }
      : {
          mode: 'refused',
          reason: `REPUBLISH_WINDOW marker on a PR into "${base_ref}" — the window lives on edge and may never be promoted`,
        }
  if (event === 'push')
    return ref_name === 'edge'
      ? { mode: 'size-only', reason: 'REPUBLISH_WINDOW marker, push on edge' }
      : {
          mode: 'refused',
          reason: `REPUBLISH_WINDOW marker on a push to "${ref_name}" — the window lives on edge and may never be promoted`,
        }
  return {
    mode: 'refused',
    reason: `REPUBLISH_WINDOW marker under an unrecognised CI event ("${event}") — refusing rather than guessing the branch context`,
  }
}

// ── Package-size preflight ──────────────────────────────────────────────────────────────────────
// Predicts the on-chain MovePackage object size from local build artifacts alone — no network round
// trip, so a TooBig refusal is known before the ceremony ever dry-runs against a live upgrade cap.
//
// HERMETIC BY CONSTRUCTION, and that is the load-bearing property. This measurement used to read the
// package's shared `build/` directory — whatever the last command happened to leave there. A
// `sui move test` run leaves TEST-MODE bytecode: `#[test_only]` code is compiled INTO each source
// module, so the same tree measured 107902 (5502 OVER the cap) minutes after a test sweep and 102286
// (114 under) from a clean build. The gate's verdict flipped on a command that was not part of the
// gate — in both directions, so it can hide a real TooBig as easily as invent one, at the ceremony
// as easily as in CI. So the size leg now builds the package ITSELF into a throwaway --install-dir
// and measures that: no prior state can reach the number.
// The real check BCS-serializes the MovePackage: module bytecode + a module_map name-key per module +
// a type_origin_table entry per struct/enum the package DEFINES + a linkage_table entry per
// transitively-linked dependency package. This mirrors that shape from the build's own artifacts.
const OBJECT_ID_BYTES = 32
// linkage_table is a VecMap<ObjectID, UpgradeInfo>; UpgradeInfo = { upgraded_id: ObjectID (32),
// upgraded_version: u64 (8) }, keyed by another ObjectID (32) — 72 bytes per linked dependency.
const LINKAGE_ENTRY_BYTES = OBJECT_ID_BYTES + OBJECT_ID_BYTES + 8

// BCS variable-length collections (String, Vec<u8>, and VecMap's entry count) carry a ULEB128 length
// prefix ahead of the payload.
function uleb128Len(n) {
  let bytes = 1
  while (n >= 128) {
    n = Math.floor(n / 128)
    bytes++
  }
  return bytes
}

// Strip `//`/`///` line comments before scanning for struct/enum declarations — a bare regex over raw
// source false-positives on prose like "hardcoded enum baked into..." (16 false hits measured live on
// aresrpg's sources before this fix).
function stripLineComments(src) {
  return src
    .split('\n')
    .map((line) => line.replace(/\/\/.*/, ''))
    .join('\n')
}

// CALIBRATION (2026-07-27, foundation/#1202): this formula measured 107054 bytes for aresrpg against
// the SAME edge sources whose real on-chain dry-run failed at object_size 106584 — 470 bytes / 0.44%
// over ground truth, inside the ~1% bar. The gap is the residual BCS envelope this proxy doesn't model
// (the package UID + version fields, a handful of ULEB128 rounding edges) — negligible next to a
// 102400-byte ceiling and it only ever OVER-estimates, so it never hides a real TooBig risk.
// Builds `pkgPath` into a fresh throwaway tree and hands the caller its build root. Throws with the
// compiler's own tail on failure — a build that does not compile has no size, and saying so beats
// returning a number nobody can trust. NON-test mode by construction (`sui move build`, never
// `sui move test`), which is the whole point.
function hermetic_build(pkgPath) {
  const out_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-pkg-size-'))
  try {
    execSync(`sui move build --path ${pkgPath} --install-dir ${out_dir}`, {
      encoding: 'utf-8',
      stdio: 'pipe',
    })
    return out_dir
  } catch (e) {
    fs.rmSync(out_dir, { recursive: true, force: true })
    const output = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim()
    throw new Error(output.split('\n').slice(-5).join(' | '))
  }
}

// Measures the package the caller just built at `buildRoot` (a hermetic_build result). Sources are
// read from pkgPath — they are the declaration list; the bytecode is read from buildRoot alone.
function measurePackageSize(pkgPath, buildRoot) {
  const srcDir = path.join(pkgPath, 'sources')
  const buildDir = path.join(buildRoot, 'build')
  if (!fs.existsSync(srcDir) || !fs.existsSync(buildDir)) return null

  // `build/<name>` is named after the package's OWN Move.toml `name` field (e.g. "aresrpg_foundation"
  // for the "foundation" manifest entry), never the manifest key — and it's the only entry under
  // build/, since dependencies nest inside bytecode_modules/dependencies/ rather than getting their
  // own top-level build/<dep> folder.
  const [buildPkgName] = fs
    .readdirSync(buildDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
  if (!buildPkgName) return null
  const bcDir = path.join(buildDir, buildPkgName, 'bytecode_modules')
  if (!fs.existsSync(bcDir)) return null

  let ownBytes = 0
  let moduleMapOverhead = 1 // module_map VecMap entry-count ULEB128 prefix
  let typeOriginBytes = 1 // type_origin_table Vec entry-count ULEB128 prefix

  for (const file of fs
    .readdirSync(srcDir)
    .filter((f) => f.endsWith('.move'))) {
    const content = stripLineComments(
      fs.readFileSync(path.join(srcDir, file), 'utf8')
    )
    const modMatch = content.match(/^module\s+[a-zA-Z0-9_]+::([a-zA-Z0-9_]+)/m)
    if (!modMatch) continue
    const [, modName] = modMatch
    const mvPath = path.join(bcDir, `${modName}.mv`)
    if (!fs.existsSync(mvPath)) continue // module didn't compile — the compat check above already reports why

    const mvBytes = fs.statSync(mvPath).size
    ownBytes += mvBytes
    moduleMapOverhead +=
      uleb128Len(modName.length) + modName.length + uleb128Len(mvBytes)

    for (const [, typeName] of content.matchAll(
      /\b(?:public\s+)?(?:struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g
    ))
      typeOriginBytes +=
        uleb128Len(modName.length) +
        modName.length +
        uleb128Len(typeName.length) +
        typeName.length +
        OBJECT_ID_BYTES
  }

  // Every transitively-linked dependency package shows up as its own subdirectory under
  // bytecode_modules/dependencies/ (framework packages included: Sui, MoveStdlib, Kiosk, …) — reading
  // that directory listing is exact, no "INCLUDING DEPENDENCY" stdout/stderr parsing needed.
  const depsDir = path.join(bcDir, 'dependencies')
  const depCount = fs.existsSync(depsDir)
    ? fs
        .readdirSync(depsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory()).length
    : 0
  const linkageBytes = 1 + depCount * LINKAGE_ENTRY_BYTES

  return ownBytes + moduleMapOverhead + typeOriginBytes + linkageBytes
}

// Pure. The size leg's whole decision, so it can be unit-tested without a toolchain or a build.
// → { ok, status: 'ok' | 'over-budget' | 'over-ceiling', ceiling_headroom, budget_headroom, line }
// The ceiling is checked FIRST and reported as its own status: a package over the chain ceiling is
// unshippable, not merely over policy, and the two must never read the same in a log.
export function size_verdict({
  name,
  size,
  budget = null,
  ceiling = MAX_OBJECT_SIZE,
}) {
  const ceiling_headroom = ceiling - size
  const budget_headroom = budget == null ? null : budget - size
  const margin = (n) => (n < 0 ? `${-n} OVER` : `${n} under`)
  const budget_part =
    budget == null
      ? '  budget none (chain ceiling only)'
      : `  budget ${budget} (${margin(budget_headroom)})`
  const line = `${name} SIZE ${size} / ${ceiling} (${margin(ceiling_headroom)})${budget_part}`
  const status =
    ceiling_headroom < 0
      ? 'over-ceiling'
      : budget_headroom != null && budget_headroom < 0
        ? 'over-budget'
        : 'ok'
  return {
    ok: status === 'ok',
    status,
    ceiling_headroom,
    budget_headroom,
    line,
  }
}

// SIZE-ONLY pass (the republish window's whole gate). Builds each package with `sui move build` —
// no chain read, no upgrade cap, no identity, nothing to serialize — and measures the predicted
// MovePackage object size against the protocol ceiling. Same measurePackageSize as the compat path,
// over the same build artifacts, so the two modes never disagree about a package's size.
function size_only_run(packages) {
  let any_failed = false
  for (const name of packages) {
    const pkg_path = path.join(MOVE_DIR, name)
    let size = null
    let build_root = null
    try {
      build_root = hermetic_build(pkg_path)
      size = measurePackageSize(pkg_path, build_root)
    } catch (e) {
      any_failed = true
      console.log(`${name} ERROR  build failed — ${e.message}`)
      continue
    } finally {
      if (build_root) fs.rmSync(build_root, { recursive: true, force: true })
    }
    if (size == null) {
      any_failed = true
      console.log(`${name} ERROR  build produced no bytecode to measure`)
      continue
    }
    const verdict = size_verdict({
      name,
      size,
      budget: SIZE_BUDGETS[name] ?? null,
    })
    console.log(verdict.line)
    if (verdict.status === 'over-ceiling') {
      any_failed = true
      console.log(
        `${name} FAIL  over the chain's max_object_size — this package cannot be published or upgraded (MovePackageTooBig at execution).`
      )
    } else if (verdict.status === 'over-budget') {
      any_failed = true
      console.log(
        `${name} FAIL  over its committed size budget with ${verdict.ceiling_headroom} bytes of ceiling left. Shrink the package, or raise SIZE_BUDGETS.${name} in packages/move/scripts/ceremony_preflight_compat.mjs in this same commit and say why.`
      )
    }
  }
  return any_failed
}

const HELP = `ceremony_preflight_compat — catch IncompatibleUpgrade BEFORE the ceremony, mechanically.

Usage: node ceremony_preflight_compat.mjs [pkg...] [--mode-check] [--size-only]

  pkg           one or more of: ${Object.keys(PKG_DEPS).join(', ')}
                defaults to: ${DEFAULT_PACKAGES.join(' ')}
  --mode-check  print which mode the gate would run in and exit — no build, no chain, no CLI.
                Non-zero only when a REPUBLISH_WINDOW marker is refused by its branch context.
  --size-only   run ONLY the size leg: a local build and nothing else — no fullnode, no identity,
                no upgrade cap. This is the half CI runs on every pull request (checks.yml), which
                is why a package over the ceiling now fails at PR time instead of at the ceremony.

For each package, runs \`sui client upgrade --serialize-unsigned-transaction\` against its source dir
(no signing, no execution, no gas) and parses the local compatibility verifier's verdict. Prints one row
per package — "<name> COMPATIBLE" or "<name> INCOMPATIBLE  <count>x<E-code> ..." — and exits non-zero if
any requested package is incompatible (or errors for a non-compatibility reason). Also prints a SIZE row
per package — "<name> SIZE <bytes> / 102400 (<margin>)  budget <b> (<margin>)" — a local proxy for the
on-chain MovePackage object size (see measurePackageSize), and exits non-zero if any package exceeds
the chain's max_object_size (MovePackageTooBig at execution, caught here before the ceremony ever
dry-runs) OR its committed SIZE_BUDGETS row, which fails earlier so a PR learns before the cliff.

Env:
  NETWORK          testnet (default) | mainnet — must match the CLI's active-env (assert_env, fail-closed)
  SUI_CONFIG_DIR   override for ~/.sui/sui_config (identity/env source)

Read-only against chain + local build. Never mutates on-chain state. Published.toml is patched to the
ground-truth on-chain package id only for the duration of the CLI call, then restored byte-for-byte.

REPUBLISH MODE: while packages/move/REPUBLISH_WINDOW exists, the compat leg is suspended and this runs
SIZE-ONLY — the 102400-byte ceiling still fails the gate. The marker is refused (hard failure) on any
master-bound run, so the window can never be promoted to production.`

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

  // The size row costs its own compile ON PURPOSE, rather than reading whatever the CLI call left in
  // build/: the compat verdict is the CLI's, the size verdict is this gate's, and a shared build
  // directory is exactly how a `sui move test` run silently rewrote the number (see hermetic_build).
  let size = null
  let size_build_root = null
  try {
    size_build_root = hermetic_build(pkgPath)
    size = measurePackageSize(pkgPath, size_build_root)
  } catch {
    size = null // the compat leg below already reports why this package does not compile
  } finally {
    if (size_build_root)
      fs.rmSync(size_build_root, { recursive: true, force: true })
  }

  const errors = parseCompatErrors(output)
  if (errors.size > 0)
    return { name, status: 'incompatible', errors, target, source, size }
  if (exitCode !== 0)
    return {
      name,
      status: 'error',
      detail: `exit ${exitCode} — ${output.trim().split('\n').slice(-5).join(' | ')}`,
      size,
    }
  return { name, status: 'compatible', target, source, size }
}

function assert_known_packages(packages) {
  for (const name of packages)
    if (!(name in PKG_DEPS))
      throw new Error(
        `unknown package "${name}" — one of: ${Object.keys(PKG_DEPS).join(', ')}`
      )
}

async function main() {
  const args = process.argv.slice(2)
  if (args.some((a) => a === '--help' || a === '-h')) {
    console.log(HELP)
    return 0
  }

  const marker_present = fs.existsSync(REPUBLISH_MARKER_PATH)
  const verdict = republish_window_verdict({
    marker_present,
    ...ci_context(),
  })

  if (verdict.mode === 'refused') {
    console.error('════════════════════════════════════════════════════════')
    console.error('  REPUBLISH WINDOW REFUSED — this run is master-bound.')
    console.error(`  ${verdict.reason}`)
    console.error(
      '  Delete packages/move/REPUBLISH_WINDOW to close the window; the compat teeth return with it.'
    )
    console.error('════════════════════════════════════════════════════════')
    return 1
  }

  if (args.includes('--mode-check')) {
    console.log(
      `preflight mode: ${verdict.mode.toUpperCase()} — ${verdict.reason}`
    )
    return 0
  }

  const requested = args.filter((a) => !a.startsWith('--'))

  // `--size-only` is the PR-TIME entry point: the size leg needs a local build and nothing else —
  // no fullnode, no identity, no upgrade cap — so CI can run it on every pull request, which the
  // compat leg can never do. It only ever ADDS the size mode to a run that would have been compat;
  // a REFUSED verdict is returned above, so the flag can never talk a master-bound marker open.
  const size_only = verdict.mode === 'size-only' || args.includes('--size-only')

  if (size_only) {
    const packages = requested.length ? requested : DEFAULT_PACKAGES
    assert_known_packages(packages)
    console.log('════════════════════════════════════════════════════════')
    if (marker_present) {
      console.log(
        '  REPUBLISH MODE — compat assertions SUSPENDED, size assertions BINDING.'
      )
      console.log(`  marker: ${REPUBLISH_MARKER_PATH}`)
      for (const line of fs
        .readFileSync(REPUBLISH_MARKER_PATH, 'utf8')
        .trim()
        .split('\n'))
        console.log(`  > ${line}`)
      console.log(
        `  every package still fails over ${MAX_OBJECT_SIZE} bytes; delete the marker to restore the compat leg.`
      )
    } else {
      console.log(
        '  SIZE-ONLY PREFLIGHT — the PR-time half of the ceremony gate.'
      )
      console.log(
        `  chain ceiling ${MAX_OBJECT_SIZE} bytes (max_object_size); per-package budgets fail EARLIER, on purpose.`
      )
    }
    console.log('════════════════════════════════════════════════════════')
    return size_only_run(packages) ? 1 : 0
  }

  const network = getNetwork()
  assert_env(network)

  const packages = requested.length ? requested : DEFAULT_PACKAGES
  assert_known_packages(packages)

  const release = fs.existsSync(RELEASE_PATH)
    ? JSON.parse(fs.readFileSync(RELEASE_PATH, 'utf8'))
    : null
  const client = getClient(network)

  let any_failed = false
  for (const name of packages) {
    const result = await checkPackage(client, release, network, name)
    if (result.status === 'compatible') {
      console.log(
        `${name} COMPATIBLE  (target ${result.target}, from ${result.source})`
      )
    } else if (result.status === 'incompatible') {
      any_failed = true
      const detail = [...result.errors].map(([k, n]) => `${n}x${k}`).join('  ')
      console.log(`${name} INCOMPATIBLE  ${detail}`)
    } else {
      any_failed = true
      console.log(`${name} ERROR  ${result.detail}`)
    }

    if (result.size != null) {
      const size = size_verdict({
        name,
        size: result.size,
        budget: SIZE_BUDGETS[name] ?? null,
      })
      if (!size.ok) any_failed = true
      console.log(size.line)
    }
  }

  return any_failed ? 1 : 0
}

// Guarded so the pure republish-window verdict can be imported and unit-tested without the CLI half
// (which needs a fullnode, an identity and a live upgrade cap) ever running.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  try {
    process.exitCode = await main()
  } catch (e) {
    console.error(`ceremony_preflight_compat: ${e?.message ?? e}`)
    process.exitCode = 1
  }
