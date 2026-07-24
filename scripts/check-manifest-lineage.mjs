#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// check-manifest-lineage.mjs — the seed-manifest staleness gate (issue #698, 2nd recurrence).
//
// packages/move/scripts/out/seed_manifest.json is a bundled, checked-in CLI run receipt: the FULL
// authored-corpus seed every localnet/gate/CI boot folds in for world/item/mob parity (DECISIONS
// 07-11). packages/sdk/src/deployment/release.json is the live chain pins the SDK/frontend actually
// read for every transaction. The two are independent files that both encode the SAME package
// lineage — nothing stops them drifting apart once release.json moves (a republish) without a
// matching seeder re-run. #698: a stale bundled manifest broke world-join, the encyclopedia, and CI
// in the same night, silently — no gate caught a manifest whose ids no longer belonged to the
// packages release.json actually pins.
//
// THE INVARIANT: seed_full_corpus.mjs already stamps every manifest it writes with a LINEAGE_STAMP —
// the ORIGINAL (never-changes-on-upgrade) package id of the five lineages the corpus mints every
// item/mob/world/recipe against, in this exact order: foundation, items, spells, game, fight (its own
// resume-guard already refuses to fold a stale-stamped manifest back in — a stamp mismatch archives it
// instead of resuming into a dead lineage). `items` and `game` both alias the aresrpg package; `fight`
// aliases engine (verified against ceremony_manifest.json: items.pkg === game.pkg === the aresrpg
// origin, fight.pkg === the engine origin). release.json's own `origin` field is that exact same
// original-package-id concept for the LIVE chain pins. So the bundled manifest is stale relative to
// the release pins the instant its OWN recorded stamp stops matching the same five-origin sequence
// freshly recomputed from release.json[manifest._network] — every id the manifest carries (item, mob,
// world, recipe) was minted through these five packages, so a stamp match is a full-manifest,
// zero-sampling-error lineage proof, not a spot check. No new write-time stamping needed — this reuses
// a fingerprint the seeder was already recording; adding a second field would just be the same fact
// twice (one home per fact).
//
// Wired into scripts/check-constraints.sh. Standalone: `node scripts/check-manifest-lineage.mjs`.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

const script_path = file_url_to_path(import.meta.url)
const default_root = path.resolve(path.dirname(script_path), '..')
const MANIFEST_PATH = 'packages/move/scripts/out/seed_manifest.json'
const RELEASE_PATH = 'packages/sdk/src/deployment/release.json'
// Same five lineages, same order, as seed_full_corpus.mjs's own LINEAGE_STAMP.
const STAMP_PACKAGES = ['foundation', 'aresrpg', 'spells', 'aresrpg', 'engine']

function read_json(root, relative_path) {
  const absolute_path = path.join(root, relative_path)
  if (!fs.existsSync(absolute_path)) return { error: `missing file: ${relative_path}` }
  try {
    return { value: JSON.parse(fs.readFileSync(absolute_path, 'utf8')) }
  } catch (error) {
    return { error: `unparseable JSON in ${relative_path}: ${error.message}` }
  }
}

export function run_manifest_lineage_gate({ root = default_root } = {}) {
  console.log('== AresRPG seed-manifest lineage gate (bundled manifest vs release.json pins, #698) ==')

  const manifest_read = read_json(root, MANIFEST_PATH)
  if (manifest_read.error) {
    console.log(`MANIFEST LINEAGE GATE FAILED. ${manifest_read.error}`)
    return 1
  }
  const release_read = read_json(root, RELEASE_PATH)
  if (release_read.error) {
    console.log(`MANIFEST LINEAGE GATE FAILED. ${release_read.error}`)
    return 1
  }

  const manifest = manifest_read.value
  const release = release_read.value
  const network = manifest._network
  const manifest_stamp = manifest._stamp

  if (typeof manifest_stamp !== 'string' || !manifest_stamp) {
    console.log(`MANIFEST LINEAGE GATE FAILED. ${MANIFEST_PATH} carries no _stamp — cannot verify lineage.`)
    return 1
  }
  if (typeof network !== 'string' || !network) {
    console.log(`MANIFEST LINEAGE GATE FAILED. ${MANIFEST_PATH} carries no _network — cannot pick a release pin set.`)
    return 1
  }

  const packages = release?.networks?.[network]?.packages
  if (!packages) {
    console.log(
      `MANIFEST LINEAGE GATE FAILED. ${RELEASE_PATH} has no networks.${network}.packages — cannot verify lineage.`
    )
    return 1
  }
  const missing_origins = STAMP_PACKAGES.filter((name) => !packages[name]?.origin)
  if (missing_origins.length) {
    console.log(
      `MANIFEST LINEAGE GATE FAILED. ${RELEASE_PATH} networks.${network}.packages is missing an origin for: ${missing_origins.join(', ')}.`
    )
    return 1
  }

  const release_stamp = STAMP_PACKAGES.map((name) => packages[name].origin).join(',')
  if (manifest_stamp !== release_stamp) {
    console.log(
      'MANIFEST LINEAGE GATE FAILED. The bundled seed manifest was seeded against a different package lineage than release.json currently pins — every id it carries is stale (#698 class).'
    )
    console.log(`  manifest._stamp                 (${MANIFEST_PATH}): ${manifest_stamp}`)
    console.log(`  release-derived stamp (networks.${network} in ${RELEASE_PATH}): ${release_stamp}`)
    console.log(
      '  Fix: re-run packages/move/scripts/seed_full_corpus.mjs against the CURRENT ceremony/release lineage so the bundled manifest is regenerated with a matching stamp.'
    )
    return 1
  }

  console.log(`MANIFEST LINEAGE GATE PASSED. ${MANIFEST_PATH} lineage matches release.json networks.${network} pins.`)
  return 0
}

function parse_args(args) {
  let root = default_root
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--root' && args[index + 1]) root = path.resolve(args[(index += 1)])
    else throw new Error(`unknown argument ${arg}`)
  }
  return { root }
}

if (process.argv[1] && path.resolve(process.argv[1]) === script_path) {
  try {
    process.exitCode = run_manifest_lineage_gate(parse_args(process.argv.slice(2)))
  } catch (error) {
    console.error(`manifest-lineage gate: ${error.message}`)
    console.error('usage: node scripts/check-manifest-lineage.mjs [--root PATH]')
    process.exitCode = 2
  }
}
