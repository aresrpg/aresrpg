// THE ASSERT-ENV GATE + SWITCH-BACK LAW (seat tripwire, DECISIONS 2026-07-19 13:35/13:40).
//
// The CLI's ambient active-env is GROUND TRUTH for any op that shells out to `sui client` / `sui move
// build` — those resolve gas + the dependency chain-ids from it. A ceremony/upgrade/publish run that
// trusts the ambient env can execute a MAINNET write while the operator believes they are on testnet
// (the mainnet-residue class: a prior script switched to mainnet and never switched back). These two
// primitives make every env-scoping script fail-closed:
//   assert_env(expected)   — REFUSE (throw → non-zero exit) on mismatch; NEVER silently switches.
//   with_env(expected, fn) — record the found env, switch OPENLY, run, ALWAYS restore on exit (finally).
//
// Env I/O is injectable (`read`/`switch_to`) so the primitives are testable with zero subprocess/CLI.

import fs from 'node:fs'
import { execSync } from 'node:child_process'
import { homedir } from 'node:os'

const config_dir = () =>
  process.env.SUI_CONFIG_DIR || `${homedir()}/.sui/sui_config`

// The active env is `sui client active-env`, persisted as `active_env:` in client.yaml — read the file
// directly (mirrors ceremony_lib.mjs:155 getSigner), so SUI_CONFIG_DIR is honored with no subprocess.
export function read_active_env() {
  const yaml_path = `${config_dir()}/client.yaml`
  const active = fs
    .readFileSync(yaml_path, 'utf8')
    .match(/^active_env:\s*"?([\w-]+)"?/m)?.[1]
  if (!active)
    throw new Error(
      `no active_env in ${yaml_path} — run \`sui client\` to initialise the CLI`
    )
  return active
}

function switch_env(net) {
  execSync(`sui client switch --env ${net}`, { stdio: 'inherit' })
}

// REFUSE-on-mismatch. The thrown message IS the OPEN remediation instruction, so an uncaught refusal
// prints it and exits non-zero. NEVER switches — flipping the operator's env is the operator's call.
export function assert_env(expected, { read = read_active_env } = {}) {
  const active = read()
  if (active !== expected)
    throw new Error(
      `ENV GUARD REFUSED: active-env is "${active}" but this operation requires "${expected}". ` +
        `Run \`sui client switch --env ${expected}\` yourself, or invoke with NETWORK=${expected}.`
    )
  return active
}

// THE SWITCH-BACK LAW (standing, every env-scoping script): scope the active-env to `expected` for the
// duration of fn, then ALWAYS restore the found env — on success AND on throw (finally). No switch when
// already on `expected` (nothing was moved → nothing to restore).
export async function with_env(
  expected,
  fn,
  { read = read_active_env, switch_to = switch_env } = {}
) {
  const found = read()
  if (found === expected) return await fn()
  console.log(
    `[env_guard] active-env ${found} → ${expected} (will restore ${found} on exit)`
  )
  switch_to(expected)
  try {
    return await fn()
  } finally {
    console.log(`[env_guard] restoring active-env → ${found}`)
    switch_to(found)
  }
}
