// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2149 / CodeQL alert #697 — THE GOLD RIG NEVER BUILDS A SHELL STRING FROM A VARIABLE.
//
// The rig drove docker/sui/rsync through `execSync(`…${P.PROJECT}…`)`. `P.PROJECT` comes from
// COMPOSE_PROJECT_NAME (env), so an env value carrying `;` ran its tail as a second command under
// `/bin/sh -c`. The rig also pasted a THROWAWAY PRIVATE KEY into that same shell text (`script_env`),
// which is the shape that turns a quote in a key into arbitrary execution.
//
// The probe plants a harmless `echo pwned > probe_gold` payload in COMPOSE_PROJECT_NAME and asserts the
// file is never written: pre-fix it IS written (the metacharacters reached the shell), post-fix the whole
// value arrives as one `-p` argument docker itself rejects.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, test } from 'bun:test'

const here = path.dirname(fileURLToPath(import.meta.url))
const lib_gold = pathToFileURL(path.join(here, 'lib_gold.mjs')).href

const payload = (probe) => `inj; echo pwned > ${probe}; :`

describe('lib_gold — COMPOSE_PROJECT_NAME is a docker argument, never shell source', () => {
  test('a project name carrying `;` does not execute a second command through teardownStack', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-shellinj-gold-'))
    const driver = path.join(tmp, 'drive.mjs')
    // teardownStack is the one lifecycle leg that is a no-op against a project that does not exist —
    // it tears down NOTHING here, and it interpolates the poisoned name into every command it runs.
    fs.writeFileSync(
      driver,
      [
        `const rig = await import(${JSON.stringify(lib_gold)})`,
        'try { rig.teardownStack() } catch { /* docker refuses the name — that is the point */ }',
      ].join('\n')
    )
    const run = spawnSync(process.execPath, [driver], {
      cwd: tmp, // the payload redirects RELATIVE — the probe lands here or nowhere
      encoding: 'utf8',
      timeout: 180_000,
      env: { ...process.env, COMPOSE_PROJECT_NAME: payload('probe_gold') },
    })
    expect(run.error ?? null).toBe(null)
    expect(fs.existsSync(path.join(tmp, 'probe_gold'))).toBe(false)
    fs.rmSync(tmp, { recursive: true, force: true })
  }, 180_000) // a real `docker compose` parse, not bun's 5s default

  test('script_env is an env overlay — the throwaway key is a value, never command text', async () => {
    const rig = await import(lib_gold)
    const env = rig.script_env("k'; echo pwned; :")
    expect(env.PRIVATE_KEY).toBe("k'; echo pwned; :")
    expect(typeof env).toBe('object')
  })
})
