#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2197 — THE SPONSOR-CONFIG SINGLE-HOME GATE.
//
// The sponsor money path is split across images that deploy independently: the sponsor service (api/), the
// keyless read API (packages/rpc/api/), and the gas station's config generator (packages/rpc/gas-pool/).
// Nothing in the language stops two of them declaring the same setting from their own env, and nothing at
// runtime notices when the two copies drift — which is precisely how a per-address daily cap raised on the
// enforcing side left the display side rendering the old number until someone redeployed it by hand.
//
// Three invariants, all mechanical:
//
//   1. NO SETTING HAS TWO HOMES. A sponsor-surface env name is read by at most ONE deployable. A value two
//      images need is published by its owner through the shared store and DERIVED by the other. The only
//      exceptions are seams the platform genuinely imposes — a shared secret across an auth boundary, a
//      store address — and each is named below WITH ITS REASON, reviewed like any other gate edit.
//
//   2. NO GHOST KNOBS. Every sponsor-surface setting declared in deploy config (docker-compose, .env.example)
//      is actually READ by code. A limit that exists only in a compose file is not a limit; it is a false
//      sense of one. (`SPONSOR_DAILY_CAP_MIST` declared a 50-SUI/day global ceiling no line of api/ ever
//      read — the census that filed this gate is what found it.)
//
//   3. THE SHARED-STORE CONTRACT HOLDS. Every `sponsor:` key the read API reads is a key the sponsor
//      actually writes, compared by SHAPE. The two images cannot import one module (separate build
//      contexts), so this static comparison is the only thing standing between them and a silent rename.
//
// Runs in `bun run lint`. Pure: reads the tree, writes nothing, no network.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

const repo_root = path.resolve(path.dirname(file_url_to_path(import.meta.url)), '..')

// The deployables that read sponsor-surface config. Each is an independently built image.
const DEPLOYABLES = {
  sponsor: 'api',
  'rpc-api': 'packages/rpc/api',
  'rpc-gas-pool': 'packages/rpc/gas-pool',
}

// Deploy-config files that DECLARE settings for those images.
const DECLARATION_FILES = ['packages/rpc/docker-compose.yml', 'packages/rpc/.env.example', '.env.example']

// The surface this gate governs: the sponsor's own knobs, the station's, and the shared-store address they
// all resolve. Everything else (ports, log levels, Sentry) is per-process plumbing, not a game setting.
const IN_SCOPE = (name) => /^(?:SPONSOR|GAS_STATION|GAS_POOL)_/.test(name) || name === 'REDIS_URL'

// A setting may live in two deployables only where the PLATFORM forces it, and only with a reason.
// `'NAME': { deployables: [...], reason: '...' }` — adding a row is an explicit, reviewed act.
const JUSTIFIED_SEAMS = {
  GAS_STATION_AUTH: {
    deployables: ['sponsor', 'rpc-gas-pool'],
    reason:
      'a shared bearer across an auth boundary: the station mints its config from this secret and the sponsor presents it. A secret cannot be derived from the other side by construction — that is what makes it a secret.',
  },
  REDIS_URL: {
    deployables: ['sponsor', 'rpc-api'],
    reason:
      'the address of the ONE shared store, not a setting carried in it. This is the seam every derived sponsor value rides on: both images must be pointed at the same Redis by their deployment, and no value published inside it can bootstrap its own location.',
  },
}

const source_files = (directory) => {
  const root = path.join(repo_root, directory)
  if (!fs.existsSync(root)) throw new Error(`deployable root missing: ${directory}`)
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const file = path.join(root, entry.name)
      if (entry.isDirectory())
        return entry.name === 'node_modules' ? [] : source_files(path.join(directory, entry.name))
      if (!/\.[cm]?js$/.test(entry.name)) return []
      return /\.(?:test|spec|unit\.test)\.[cm]?js$/.test(entry.name) ? [] : [file]
    })
    .sort()
}

/** Env names a source reads. Both forms in the tree: `process.env.X` and an injected `env.X` (generate-config). */
export const env_names_read = (source) =>
  new Set([
    ...[...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
    ...[...source.matchAll(/process\.env\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\]/g)].map((m) => m[1]),
    ...[...source.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]),
  ])

/** A key template compared by SHAPE: every interpolation collapses to `{}`, so renaming a variable is not drift. */
export const key_shape = (template) => template.replace(/\$\{[^}]*\}/g, '{}')

/** Every `sponsor:`-prefixed store key a source names, as shapes. */
export const sponsor_key_shapes = (source) =>
  new Set([...source.matchAll(/[`'"](sponsor:[^`'"]*)[`'"]/g)].map((m) => key_shape(m[1])))

const reads_by_deployable = () =>
  new Map(
    Object.entries(DEPLOYABLES).map(([name, directory]) => {
      const names = new Set()
      for (const file of source_files(directory))
        for (const env_name of env_names_read(fs.readFileSync(file, 'utf8')))
          if (IN_SCOPE(env_name)) names.add(env_name)
      return [name, names]
    })
  )

const declared_names = () => {
  const names = new Set()
  for (const relative of DECLARATION_FILES) {
    const file = path.join(repo_root, relative)
    if (!fs.existsSync(file)) throw new Error(`declaration file missing: ${relative}`)
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/^\s*([A-Z][A-Z0-9_]{2,})\s*[:=]/gm)) if (IN_SCOPE(match[1])) names.add(match[1])
  }
  return names
}

export const dual_home_errors = (reads, seams = JUSTIFIED_SEAMS) => {
  const homes = new Map()
  for (const [deployable, names] of reads)
    for (const name of names) homes.set(name, [...(homes.get(name) ?? []), deployable].sort())
  const errors = []
  for (const [name, deployables] of [...homes].sort()) {
    if (deployables.length < 2) continue
    const seam = seams[name]
    if (seam && `${seam.reason}`.length > 40 && [...seam.deployables].sort().join(',') === deployables.join(','))
      continue
    errors.push(
      `${name} is read by ${deployables.length} deployables (${deployables.join(', ')}) — publish it from its owner ` +
        `and derive it, or name it in JUSTIFIED_SEAMS with the platform reason it cannot be`
    )
  }
  return errors
}

export const ghost_knob_errors = (declared, reads) => {
  const read_anywhere = new Set([...reads.values()].flatMap((names) => [...names]))
  return [...declared]
    .filter((name) => !read_anywhere.has(name))
    .sort()
    .map(
      (name) =>
        `${name} is declared in deploy config but read by NO deployable — a setting nothing reads is a lie ` +
        `about what is configured (delete it, or wire the code that was supposed to honour it)`
    )
}

export const store_contract_errors = (written, read) =>
  [...read]
    .filter((shape) => !written.has(shape))
    .sort()
    .map(
      (shape) =>
        `the read API reads shared-store key "${shape}" which the sponsor never writes — the two images ship ` +
        `separately and cannot import one module, so this shape is the whole contract between them`
    )

const writer_source = () => fs.readFileSync(path.join(repo_root, 'api/sponsor_state.mjs'), 'utf8')
const reader_source = () => fs.readFileSync(path.join(repo_root, 'packages/rpc/api/views.js'), 'utf8')

function main() {
  const reads = reads_by_deployable()
  const declared = declared_names()
  const written_shapes = sponsor_key_shapes(writer_source())
  const read_shapes = sponsor_key_shapes(reader_source())

  // Positive controls: an empty scan is a throw, never a pass. Each number is a floor the tree already clears.
  const total_reads = [...reads.values()].reduce((sum, names) => sum + names.size, 0)
  if (total_reads < 10) throw new Error(`sponsor env census read only ${total_reads} settings — the scan found nothing`)
  if (declared.size < 5) throw new Error(`deploy-config census read only ${declared.size} settings — the scan is blind`)
  if (written_shapes.size < 3) throw new Error(`sponsor key census found ${written_shapes.size} shapes — scan is blind`)
  // Floor 1, not 2: "found nothing" is a blind scan, but "found only the spend counter" is the exact
  // pre-fix state this gate must be able to REPORT rather than abort on.
  if (read_shapes.size < 1) throw new Error(`read-API key census found no sponsor keys — the scan is blind`)

  const errors = [
    ...dual_home_errors(reads),
    ...ghost_knob_errors(declared, reads),
    ...store_contract_errors(written_shapes, read_shapes),
  ]

  if (errors.length) {
    console.error('SPONSOR-CONFIG SSOT GATE FAILED (#2197)')
    errors.forEach((error) => console.error(`  ${error}`))
    process.exit(1)
  }

  console.log(
    `SPONSOR-CONFIG SSOT GATE PASSED: ${total_reads} settings across ${reads.size} deployables, ` +
      `${Object.keys(JUSTIFIED_SEAMS).length} named platform seams, ${read_shapes.size} shared-store shapes pinned`
  )
}

if (import.meta.main) main()
