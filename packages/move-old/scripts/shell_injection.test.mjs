// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2149 / CodeQL js/shell-command-injection-from-environment (alerts #693-#697) — THE CEREMONY TOOLING
// NEVER BUILDS A SHELL STRING FROM A VARIABLE.
//
// The ceremony scripts drove `sui move build`/`grep` through `execSync(`…${path}…`)`, which is
// `/bin/sh -c` with the variable pasted in as SOURCE TEXT: a path (or a TMPDIR) carrying `;` runs the
// tail as a second command. The inputs are operator-env-only — no player reaches them — but this is the
// money path's own tooling and env poisoning is a measured incident class here, so the cure is
// mechanical: `execFileSync(cmd, [args…])`, where the same value is ONE argv token no shell ever parses.
//
// Every probe below plants a HARMLESS `echo pwned > <probe>` payload and asserts the probe file was never
// written. Pre-fix each of these reds by CREATING that file (the metacharacters reached `/bin/sh`);
// post-fix the payload arrives as a literal argument and the tool fails on a path that does not exist.
// The last block is the CLASS gate: no interpolated shell string may return to this fence at all.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import { buildPackage, build_package_at } from './ceremony_lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo_root = path.resolve(here, '..', '..', '..')

/** `; echo pwned > <probe>; :` — the trailing `:` swallows whatever the caller appends after the payload. */
const payload = (probe) => `inj; echo pwned > ${probe}; :`

const disposable = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `ares-shellinj-${label}-`))

/** A `sui` that answers instantly — the probes measure ARGUMENT HANDLING, never a real 60-second build. */
const stub_sui_bin = (dir) => {
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'sui'), '#!/bin/sh\nexit 0\n')
  fs.chmodSync(path.join(bin, 'sui'), 0o755)
  return bin
}

describe('ceremony_lib.buildPackage — the package name is an argv token, never shell source', () => {
  test('a package name carrying `;` does not execute a second command', () => {
    const tmp = disposable('lib')
    const probe = path.join(tmp, 'probe_lib')
    try {
      buildPackage(payload(probe))
    } catch {
      /* a package path that does not exist MUST fail — the verdict below is the probe, not the throw */
    }
    expect(fs.existsSync(probe)).toBe(false)
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  test('the build call hands `sui` one argument per token, the path unsplit and unparsed', () => {
    const evil = '/tmp/a b; echo pwned; :'
    let seen = null
    build_package_at(evil, (cmd, args) => {
      seen = { cmd, args }
      return '{"modules":[],"dependencies":[],"digest":[]}\n'
    })
    expect(seen.cmd).toBe('sui')
    expect(seen.args).toEqual(['move', 'build', '--dump-bytecode-as-base64', '--path', evil])
  })
})

describe('ceremony_preflight_compat.hermetic_build — a poisoned TMPDIR is an install-dir, not a script', () => {
  test('TMPDIR carrying `;` does not execute a second command through the size leg', () => {
    const tmp = disposable('preflight')
    // mkdtempSync needs the parent to exist: the poisoned value IS a real directory here, which is
    // exactly the operator-box shape (a TMPDIR someone set) rather than an impossible one.
    const poisoned_tmpdir = path.join(tmp, payload('probe_preflight'))
    fs.mkdirSync(poisoned_tmpdir, { recursive: true })
    const run = spawnSync(
      process.execPath,
      [path.join(here, 'ceremony_preflight_compat.mjs'), 'foundation', '--size-only'],
      {
        cwd: tmp, // the payload redirects RELATIVE — the probe lands here or nowhere
        encoding: 'utf8',
        timeout: 120_000,
        env: {
          ...process.env,
          TMPDIR: poisoned_tmpdir,
          PATH: `${stub_sui_bin(tmp)}:${process.env.PATH}`,
        },
      }
    )
    expect(run.error ?? null).toBe(null)
    expect(fs.existsSync(path.join(tmp, 'probe_preflight'))).toBe(false)
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})

describe('check_keepset.grep — the scanned directory is an argv token, never shell source', () => {
  test('a script directory whose name carries `;` does not execute a second command', () => {
    const tmp = disposable('keepset')
    // The script greps its OWN directory (`__dir`). Run a copy from a directory whose NAME is the
    // payload: that is the uncontrolled-absolute-path shape CodeQL flagged, made reachable.
    const poisoned_dir = path.join(tmp, payload('probe_keepset'))
    fs.mkdirSync(poisoned_dir, { recursive: true })
    fs.copyFileSync(path.join(here, 'check_keepset.mjs'), path.join(poisoned_dir, 'check_keepset.mjs'))
    const run = spawnSync(process.execPath, [path.join(poisoned_dir, 'check_keepset.mjs')], {
      cwd: tmp,
      encoding: 'utf8',
      timeout: 120_000,
    })
    expect(run.error ?? null).toBe(null) // it exits non-zero (no sources beside the copy); that is not the verdict
    expect(fs.existsSync(path.join(tmp, 'probe_keepset'))).toBe(false)
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})

// ── THE CLASS GATE ────────────────────────────────────────────────────────────────────────────────
// Fixing five call sites without closing the class is how the sixth gets written next month. Every
// shell-string driver in the ceremony/gold fence must be a CONSTANT: the moment one interpolates, this
// reds. `execFileSync` argv arrays are unaffected by construction — there is no shell to inject into.
const SHELL_STRING_CALL = /\b(?:execSync|sh)\(\s*`([^`]*)`/g

const source_files = (dir, exclude_tests = true) => {
  const out = []
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name)
      if (entry.name === 'node_modules' || entry.name === 'out' || entry.name.startsWith('.')) continue
      if (entry.isDirectory()) walk(full)
      else if (/\.(mjs|js)$/.test(entry.name) && !(exclude_tests && entry.name.endsWith('.test.mjs'))) out.push(full)
    }
  }
  walk(dir)
  return out
}

const interpolated_shell_strings = (source) =>
  [...source.matchAll(SHELL_STRING_CALL)].map(([, body]) => body).filter((body) => body.includes('${'))

describe('#2149 CLASS GATE — no interpolated shell string survives in the ceremony/gold fence', () => {
  test('the scanner reads a real population and can see a specimen (positive control)', () => {
    const files = [
      ...source_files(path.join(repo_root, 'packages/move/scripts')),
      ...source_files(path.join(repo_root, 'test/gold')),
    ]
    expect(files.length).toBeGreaterThan(30)
    expect(interpolated_shell_strings('execSync(`sui move build --path ${pkgPath}`)')).toEqual([
      'sui move build --path ${pkgPath}',
    ])
    expect(interpolated_shell_strings("execSync('node stamp_all.mjs')")).toEqual([])
    expect(interpolated_shell_strings('sh(`ls -d ~/.move/*/kiosk | head -1`)')).toEqual([])
    expect(interpolated_shell_strings('execFileSync("sui", ["move", "build", "--path", pkgPath])')).toEqual([])
  })

  test('every ceremony/gold shell command is a constant — variables travel as argv', () => {
    const offenders = []
    for (const file of [
      ...source_files(path.join(repo_root, 'packages/move/scripts')),
      ...source_files(path.join(repo_root, 'test/gold')),
    ])
      for (const body of interpolated_shell_strings(fs.readFileSync(file, 'utf8')))
        offenders.push(`${path.relative(repo_root, file)}: ${body}`)
    expect(offenders).toEqual([])
  })
})

// The cure's own provenance: the fence imports execFileSync and the converted modules no longer reach
// for execSync at all. (ceremony.mjs / ceremony_upgrade.mjs keep ONE constant `execSync('node
// stamp_all.mjs')` each — pinned by stamp_all.test.mjs — which the class gate above allows on purpose.)
describe('#2149 — the converted modules dropped execSync entirely', () => {
  test('no execSync import remains in the four converted move scripts', () => {
    for (const file of ['ceremony_lib.mjs', 'ceremony_preflight_compat.mjs', 'check_keepset.mjs', 'env_guard.mjs']) {
      const source = fs.readFileSync(path.join(here, file), 'utf8')
      expect({ file, has: source.includes('execSync') }).toEqual({ file, has: false })
      expect({ file, has: source.includes('execFileSync') }).toEqual({ file, has: true })
    }
  })

  test('the ceremony bytecode build has ONE home — ceremony_upgrade no longer spells its own', () => {
    const spelled = source_files(path.join(repo_root, 'packages/move/scripts'))
      .filter((f) => fs.readFileSync(f, 'utf8').includes('--dump-bytecode-as-base64'))
      .map((f) => path.basename(f))
      .sort()
    // publish.js / upgrade.js are the legacy single-package drivers: constant command, no ceremony leg.
    expect(spelled).toEqual(['ceremony_lib.mjs', 'publish.js', 'upgrade.js'])
  })
})

// Positive control for the harness itself: the payload shape really does execute under a shell. Without
// this, a green suite could mean "the probe never worked" rather than "the injection was closed".
describe('#2149 — the payload is a REAL injection (harness positive control)', () => {
  test('the same string executes a second command when a shell parses it', () => {
    const tmp = disposable('control')
    const probe = path.join(tmp, 'probe_control')
    execFileSync('/bin/sh', ['-c', `echo ok > /dev/null ${payload(probe)}`], { encoding: 'utf8' })
    expect(fs.existsSync(probe)).toBe(true)
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})
