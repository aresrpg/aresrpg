// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CHAIN READ-CLIENT HERMETICITY RATCHET (D770c) — the mechanical fence that keeps src/chain/ (minus
// write/) a HEADLESS-DRIVABLE read client: pure request/response transforms over exactly two effect
// edges (sdk.ts chain-direct gRPC + ../rpc/client's /v1 fetch), forever importable in plain node/bun.
//
// TWO ASSERTS, ONE LAW (M0 census module law — "no module imports rendering/browser/anything effectful"):
//   1. STATIC CLOSURE — the transitive RELATIVE import graph of every non-test chain/ module must reach
//      ZERO denylisted packages (react/three/zustand/sentry/i18n/UI icons). Dynamic `import()` edges are
//      deliberately NOT followed: a lazy failure-path import (sdk.ts → core/report.js) is the sanctioned
//      pattern for optional reporting precisely BECAUSE it keeps the static closure clean.
//   2. IMPORT SMOKE — every chain/ module actually imports under bun with no DOM present, so a
//      module-scope `window`/`document`/react reference can never sneak in behind a passing lexical scan.
//
// chain/write/ is EXEMPT and OUTSIDE this fence by design: those three modules COMPOSE + SIGN user
// transactions (auth/i18n/toast edges are their job). Moving a file from write/ into chain/ root makes
// it subject to this ratchet automatically — the fence is the directory.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'bun:test'

const CHAIN_DIR = path.dirname(new URL(import.meta.url).pathname)
const SRC_DIR = path.resolve(CHAIN_DIR, '..')

// The ratchet: packages that must NEVER appear in the read client's static closure. Names match the
// BARE package id (scoped packages compare on `@scope/name`).
const DENYLIST = new Set([
  'react',
  'react-dom',
  'react-i18next',
  'i18next',
  'three',
  'zustand',
  'lucide-react',
  '@sentry/react',
  '@sentry/browser',
  '@aresrpg/engine3',
  '@react-three/fiber',
  '@react-three/drei',
])

const RESOLVE_SUFFIXES = ['', '.js', '.ts', '.tsx', '.jsx', '/index.js', '/index.ts', '/index.tsx']

function resolve_relative(from_dir, spec) {
  const base = path.resolve(from_dir, spec)
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${base}${suffix}`
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null // a JSON/asset or an unresolvable — nothing to walk
}

function bare_package(spec) {
  const [scope, name] = spec.split('/')
  return spec.startsWith('@') ? `${scope}/${name}` : scope
}

/** STATIC import/export-from specifiers of one source file (dynamic `import()` deliberately excluded). */
function static_specifiers(file) {
  const source = readFileSync(file, 'utf8')
  return [
    ...source.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s+['"]([^'"]+)['"]/g),
    ...source.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g),
  ].map((match) => match[1])
}

/** BFS the relative closure from `entry`; returns { packages: Map<pkg, via_file>, parents: Map<file, file> }. */
function walk_closure(entry) {
  const packages = new Map()
  const parents = new Map()
  const seen = new Set([entry])
  const queue = [entry]
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i]
    for (const spec of static_specifiers(file)) {
      if (spec.startsWith('.')) {
        const resolved = resolve_relative(path.dirname(file), spec)
        if (resolved && !seen.has(resolved) && resolved.startsWith(SRC_DIR) && !/\.(json|css)$/.test(resolved)) {
          seen.add(resolved)
          parents.set(resolved, file)
          queue.push(resolved)
        }
      } else if (!packages.has(bare_package(spec))) {
        packages.set(bare_package(spec), file)
      }
    }
  }
  return { packages, parents }
}

function trail(parents, file) {
  const chain = [file]
  for (let hop = parents.get(file); hop; hop = parents.get(hop)) chain.push(hop)
  return chain
    .reverse()
    .map((p) => path.relative(SRC_DIR, p))
    .join(' → ')
}

const chain_modules = readdirSync(CHAIN_DIR)
  .filter((name) => /\.(js|ts)$/.test(name) && !/\.test\./.test(name))
  .sort()

describe('chain/ read-client hermeticity (the D770c ratchet)', () => {
  it('covers the read client (a moved/renamed module joins the fence automatically)', () => {
    expect(chain_modules.length).toBeGreaterThanOrEqual(20)
    expect(chain_modules).toContain('sdk.ts') // the ONE chain-direct effect edge
    expect(chain_modules).toContain('deployment.ts') // the network pin
  })

  for (const module_name of chain_modules) {
    it(`${module_name} — static closure reaches no UI/render package`, () => {
      const { packages, parents } = walk_closure(path.join(CHAIN_DIR, module_name))
      const violations = [...packages.entries()]
        .filter(([pkg]) => DENYLIST.has(pkg))
        .map(([pkg, via]) => `${pkg} via ${trail(parents, via)} (imported by ${path.relative(SRC_DIR, via)})`)
      expect(violations).toEqual([])
    })
  }

  it('every chain/ module imports headless (no DOM, plain bun) — module-scope drivability', async () => {
    for (const module_name of chain_modules) {
      // a module-scope window/document/react reference throws right here, naming the module
      const loaded = await import(`./${module_name}`)
      expect(loaded, module_name).toBeDefined()
    }
  })
})
