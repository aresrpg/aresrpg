#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// convert_fight_traces.mjs — convert legacy trace_format-1 fight captures ({ fight_id, app_version,
// captured_at, inputs: [{ seq, at, msg }] }) into trace_format-2 envelope capsules (V2 build step 1,
// commit ③). Each `{ seq, at, msg }` input becomes an input_envelope whose payload is the SAME
// classify_input the live recorder tee uses — the historical corpus and the live capture speak one
// shape. Unrecoverable facts of a legacy capture are documented on every output as provenance flags.
//
// Usage:
//   node scripts/convert_fight_traces.mjs [--in <dir>] [--out <dir>]
// Defaults: --in = repo root (where the staged aresrpg-fight-trace-*.json live), --out =
// packages/fight/test/fixtures/capsules. Deterministic + append-only: a re-run reproduces byte-identical
// capsules; new captures add new files, existing corpus rows are never rewritten by content (rider R4).

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

import { input_envelope } from '../packages/fight/src/envelope.js'
import { classify_input } from '../packages/fight/src/classify_input.js'
import { capsule_export } from '../packages/fight/src/capsule.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(SCRIPT_DIR, '..')
const SOURCE_RE = /^aresrpg-fight-trace-.*\.json$/

// The unknowables a trace_format-1 capture cannot recover — pinned on every converted capsule per the
// decode-tests provenance law, so a reader never mistakes an approximation for a measurement.
const conversion_flags = (source_file, trace1) => ({
  converted_from: `trace_format-${trace1.trace_format ?? 1}`,
  source_file,
  source_captured_at: trace1.captured_at ?? null,
  source_app_version: trace1.app_version ?? null,
  notes: [
    'observed_at_ms is the legacy recorder dispatch wall-clock (input.at) — real, but true network-arrival order is only approximated by dispatch order',
    'executed-failure tx digests are unavailable — the legacy recorder logged busy with a null latch, so tx refusals convert without a digest',
  ],
})

/**
 * convert_trace — a PURE trace_format-1 object → its trace_format-2 envelope capsule. The file's
 * `fight_id` is the session id; each input keeps its original `seq` (input_seq) and `at` (observed_at_ms).
 * @param {{ fight_id?: string, app_version?: string, captured_at?: number, trace_format?: number,
 *           inputs?: {seq:number, at:number, msg:object}[] }} trace1
 * @param {{ source_file?: string|null }} [opts]
 */
export const convert_trace = (trace1, { source_file = null } = {}) => {
  const session_id = trace1.fight_id ?? null
  const inputs = Array.isArray(trace1.inputs) ? trace1.inputs : []
  const capsules = inputs.map((row) =>
    input_envelope({
      session_id,
      input_seq: row.seq,
      observed_at_ms: row.at,
      payload: classify_input(row.msg ?? {}),
    })
  )
  return capsule_export({
    session_id,
    app_version: trace1.app_version ?? null,
    captured_at: trace1.captured_at ?? null,
    capsules,
    flags: conversion_flags(source_file, trace1),
  })
}

/** Count payload kinds in a converted capsule — the run report + a cheap sanity read. */
export const kind_tally = (trace2) => {
  const tally = {}
  for (const env of trace2.capsules) tally[env.payload.kind] = (tally[env.payload.kind] ?? 0) + 1
  return tally
}

// aresrpg-fight-trace-<fight_id>-<ts>.json → <fight_id>-<ts>.capsule.json (fight id stays in the name).
const fixture_name = (source_file) =>
  `${basename(source_file)
    .replace(/^aresrpg-fight-trace-/, '')
    .replace(/\.json$/, '')}.capsule.json`

const parse_flag = (argv, name, fallback) => {
  const at = argv.indexOf(name)
  return at !== -1 && argv[at + 1] ? argv[at + 1] : fallback
}

const main = (argv) => {
  const in_dir = resolve(parse_flag(argv, '--in', REPO_ROOT))
  const out_dir = resolve(parse_flag(argv, '--out', join(REPO_ROOT, 'packages/fight/test/fixtures/capsules')))
  const files = readdirSync(in_dir)
    .filter((f) => SOURCE_RE.test(f))
    .sort()
  if (!files.length) {
    console.error(`no aresrpg-fight-trace-*.json found in ${in_dir}`)
    process.exitCode = 1
    return
  }
  mkdirSync(out_dir, { recursive: true })
  let total = 0
  const kinds = {}
  for (const f of files) {
    const trace1 = JSON.parse(readFileSync(join(in_dir, f), 'utf8'))
    const trace2 = convert_trace(trace1, { source_file: f })
    const out_name = fixture_name(f)
    writeFileSync(join(out_dir, out_name), `${JSON.stringify(trace2, null, 2)}\n`)
    total += trace2.capsules.length
    const tally = kind_tally(trace2)
    for (const [k, n] of Object.entries(tally)) kinds[k] = (kinds[k] ?? 0) + n
    console.log(`${f}\n  -> ${out_name}  (${trace2.capsules.length} capsules)  ${JSON.stringify(tally)}`)
  }
  console.log(`\nDONE — ${files.length} files, ${total} capsules -> ${out_dir}`)
  console.log(`corpus kind totals: ${JSON.stringify(kinds)}`)
}

// main-guard (node-portable): run only when invoked directly, never when imported by a test.
const script_path = resolve(fileURLToPath(import.meta.url))
if (process.argv[1] && resolve(process.argv[1]) === script_path) main(process.argv.slice(2))
