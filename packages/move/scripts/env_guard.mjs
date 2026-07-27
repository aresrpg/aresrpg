// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
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
import { execFileSync, execSync } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

// ── THE TRUNK-ANCESTRY GATE (#1298) ─────────────────────────────────────────────────────────────
// The chain is the one artifact no revert reaches. Ceremony #3 published from an UNMERGED draft
// branch, so live bytecode ran code `edge` had never carried and no review had ever seen — the tree
// that was published existed only on the operator's disk. `assert_env` closes the wrong-network
// door; this closes the wrong-tree one, and the two are the same class: a precondition the operator
// believed rather than checked.
//
// The rule: the publishing tree's HEAD must be an ANCESTOR of GitHub's `edge`. Ancestor, not "equal"
// — publishing from a commit edge has since moved past is fine, because that code did land on trunk;
// publishing from anything edge never absorbed is not, whatever the branch is called.
//
// THERE IS NO ESCAPE HATCH, and adding one (an env var, a flag, a "just this once") re-opens exactly
// the door this closes: an override is used precisely in the moment that produced #1298 — a hurry.
// If a publish genuinely must ship code that is not on edge, land it on edge first; that is a
// two-minute fast-forward, not a reason to weaken the gate.
//
// Ground truth is GitHub, read directly: `edge` is fetched from the remote per call, never from a
// local ref a stale fetch (or a lane's local `origin`) could have left pointing anywhere.
export const EDGE_REMOTE = 'https://github.com/aresrpg/aresrpg.git'

// Pure. → { ok } | { ok: false, reason }
export function trunk_ancestry_verdict({ head, edge, is_ancestor }) {
  if (!head) return { ok: false, reason: 'could not read HEAD' }
  if (!edge)
    return {
      ok: false,
      reason: `could not read ${EDGE_REMOTE} refs/heads/edge`,
    }
  if (head === edge) return { ok: true, reason: 'HEAD is edge' }
  if (is_ancestor)
    return {
      ok: true,
      reason: `HEAD is an ancestor of edge (${edge.slice(0, 8)})`,
    }
  return {
    ok: false,
    reason: `HEAD ${head.slice(0, 8)} is NOT an ancestor of edge ${edge.slice(0, 8)} — this tree carries code trunk never absorbed`,
  }
}

// ── Sanitized git ───────────────────────────────────────────────────────────────────────────────
// The guard's own repository, derived from THIS FILE's location — never the ambient cwd, which a
// caller chooses. Every git invocation below is pinned to it.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..'
)

// Environment a hostile or merely careless caller could use to point git at a DIFFERENT repository
// (or a rewritten history) while the publish scripts compile the bytes in front of them. Stripped,
// not trusted: an ancestry proof about someone else's clean checkout is worse than no proof.
const GIT_ENV_STRIPPED = [
  'GIT_DIR',
  'GIT_WORK_TREE',
  'GIT_INDEX_FILE',
  'GIT_COMMON_DIR',
  'GIT_NAMESPACE',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_CEILING_DIRECTORIES',
  'GIT_REPLACE_REF_BASE',
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_COUNT',
]

function git_env() {
  const env = { ...process.env }
  for (const key of Object.keys(env))
    if (
      GIT_ENV_STRIPPED.includes(key) ||
      /^GIT_CONFIG_(KEY|VALUE|PARAMETERS)/.test(key)
    )
      delete env[key]
  // Config files are ALSO instructions (url.*.insteadOf rewrites the remote out from under us).
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_CONFIG_GLOBAL = '/dev/null'
  env.GIT_TERMINAL_PROMPT = '0'
  return env
}

// Argument ARRAY, fixed cwd, replacement history disabled — no shell to quote through, no ambient
// state to inherit.
const git = (args) =>
  execFileSync('git', ['--no-replace-objects', '-C', REPO_ROOT, ...args], {
    encoding: 'utf8',
    env: git_env(),
  }).trim()

// Effectful shell around the verdict; I/O injectable so the rule is testable with zero subprocess.
export function assert_trunk_ancestry({
  read_head = () => git(['rev-parse', 'HEAD']),
  read_edge = () =>
    git(['ls-remote', EDGE_REMOTE, 'refs/heads/edge']).split(/\s+/)[0],
  is_ancestor = (head, edge) => {
    git(['fetch', '--quiet', EDGE_REMOTE, 'edge'])
    try {
      git(['merge-base', '--is-ancestor', head, edge])
      return true
    } catch {
      return false
    }
  },
} = {}) {
  const head = read_head()
  const edge = read_edge()
  const verdict = trunk_ancestry_verdict({
    head,
    edge,
    is_ancestor: head && edge ? is_ancestor(head, edge) : false,
  })
  if (verdict.ok) {
    console.log(`[env_guard] trunk ancestry OK — ${verdict.reason}`)
    return verdict
  }
  throw new Error(
    `TRUNK ANCESTRY REFUSED (#1298): ${verdict.reason}. The chain is the one artifact no revert reaches — land this tree on edge and publish from there. There is no override.`
  )
}

// ── THE TREE-INTEGRITY GATE (#1305 review, CRITICAL) ────────────────────────────────────────────
// Ancestry proves a COMMIT is on trunk. It says nothing about the BYTES the compiler is about to
// read: an edited-but-uncommitted module, or an untracked one, publishes happily from an ancestor
// HEAD. And `ceremony_upgrade` compiles whatever PKG_PATH it is handed — a directory that need not
// belong to the verified repository at all. Both holes have the same shape as the one ancestry
// closed (a precondition believed rather than checked), so they close the same way.
//
// Two assertions, and the chain doors below run them together:
//   · every path about to be compiled resolves INSIDE the guard's own repository, under packages/move;
//   · `git status --porcelain` over packages/move is EMPTY — no modified, no staged, no untracked
//     files. What is published is then exactly what the verified commit contains.
const MOVE_SCOPE = 'packages/move'

// Pure. → { ok } | { ok: false, reason }
export function clean_tree_verdict(status_lines) {
  const dirty = status_lines.map((l) => l.trim()).filter(Boolean)
  if (!dirty.length) return { ok: true, reason: `${MOVE_SCOPE} matches HEAD` }
  return {
    ok: false,
    reason: `${dirty.length} uncommitted change(s) under ${MOVE_SCOPE}: ${dirty.slice(0, 5).join(' · ')}${dirty.length > 5 ? ' …' : ''}`,
  }
}

// Pure. → { ok } | { ok: false, reason }. `resolved` is the realpath; `root` the guard's repo root.
export function path_inside_repo_verdict(resolved, root = REPO_ROOT) {
  const move_root = path.join(root, MOVE_SCOPE)
  if (resolved === move_root || resolved.startsWith(move_root + path.sep))
    return { ok: true, reason: `inside ${MOVE_SCOPE}` }
  return {
    ok: false,
    reason: `${resolved} is outside ${move_root} — the verified tree cannot vouch for it`,
  }
}

// Effectful. Every chain-writing door calls this ONE function: trunk ancestry (the commit), a clean
// Move tree (the bytes), and every compiled path inside the verified repository. Injectable I/O so
// the rules are testable without a subprocess. No override exists, deliberately — see above.
export function assert_publishable_tree({
  paths = [],
  root = REPO_ROOT,
  ancestry = assert_trunk_ancestry,
  read_status = () =>
    git(['status', '--porcelain', '--untracked-files=all', '--', MOVE_SCOPE]),
  resolve_path = (p) => fs.realpathSync(path.resolve(p)),
} = {}) {
  ancestry()

  const tree = clean_tree_verdict(read_status().split('\n'))
  if (!tree.ok)
    throw new Error(
      `PUBLISH TREE REFUSED (#1305): ${tree.reason}. Ancestry proves a commit; this proves the BYTES. Commit or remove them, then publish from a tree that matches trunk.`
    )
  console.log(`[env_guard] publish tree clean — ${tree.reason}`)

  for (const candidate of paths) {
    const verdict = path_inside_repo_verdict(resolve_path(candidate), root)
    if (!verdict.ok)
      throw new Error(`PUBLISH PATH REFUSED (#1305): ${verdict.reason}`)
  }
  if (paths.length)
    console.log(
      `[env_guard] ${paths.length} publish path(s) inside the verified tree`
    )
}
