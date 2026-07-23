// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GOLD SUITE harness glue — vendored, port-parametrized fork of test/localnet/harness/lib.mjs
// (that file is hardcoded to the gate lane's localnet on :9000/:9123 and actively owned by a live
// lane — vendor, never edit; the HEAVY lifting stays packages/move/scripts VERBATIM, same as the
// original). LOCALNET ONLY — throwaway runtime keys, faucet-funded, discarded on teardown.
// Topology + laws: docs/GOLD_STANDARD_SUITE.md.
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { load_deps } from './deps_gold.mjs'

const GOLD = path.dirname(fileURLToPath(import.meta.url)) // test/gold
const REPO = path.resolve(GOLD, '..', '..')
const MOVE = path.join(REPO, 'packages', 'move')
const MOVE_NM = path.join(MOVE, 'node_modules')

const gold_port_block_start = 16_000
const gold_port_block_size = 6
const gold_port_block_count = 8_192

const resolve_gold_port = (value, fallback) => {
  if (value === undefined || value === '') return fallback
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`invalid gold host port: ${value}`)
  return port
}

// Pure worktree identity: one hash owns both the compose namespace and one contiguous six-port block.
// Different slots cannot cross-collide between services; an explicit env port remains a caller-owned escape hatch.
export function derive_gold_isolation(repo_root, env = {}) {
  const absolute_repo_root = path.resolve(repo_root)
  const hash = createHash('sha256').update(absolute_repo_root).digest('hex').slice(0, 8)
  const port_slot = Number.parseInt(hash, 16) % gold_port_block_count
  const port_offset = port_slot * gold_port_block_size
  const first_port = gold_port_block_start + port_offset
  const ports = {
    rpc: resolve_gold_port(env.GOLD_RPC_PORT, first_port),
    faucet: resolve_gold_port(env.GOLD_FAUCET_PORT, first_port + 1),
    checkpoint: resolve_gold_port(env.GOLD_CHK_PORT, first_port + 2),
    redis: resolve_gold_port(env.GOLD_REDIS_PORT, first_port + 3),
    api: resolve_gold_port(env.GOLD_API_PORT, first_port + 4),
    sponsor: resolve_gold_port(env.GOLD_SPONSOR_PORT, first_port + 5),
  }
  return {
    absolute_repo_root,
    hash,
    project_name: env.COMPOSE_PROJECT_NAME || env.GOLD_PROJECT || `aresrpg-gold-${hash}`,
    port_offset,
    ports,
    endpoints: {
      rpc: env.GOLD_RPC || `http://127.0.0.1:${ports.rpc}`,
      faucet: env.GOLD_FAUCET || `http://127.0.0.1:${ports.faucet}`,
      api: env.GOLD_API || `http://127.0.0.1:${ports.api}`,
      sponsor: `http://127.0.0.1:${ports.sponsor}`,
    },
  }
}

const gold_isolation = derive_gold_isolation(REPO, process.env)
export const gold_ports = gold_isolation.ports

// ISOLATION KNOBS (env-overridable) — every worktree defaults to its own compose project and host ports.
const SUFFIX = process.env.GOLD_SUFFIX ?? '' // e.g. '-soak' → .build-soak / .gold-soak-deployment.json
export const P = {
  GOLD,
  REPO,
  MOVE,
  COMPOSE: path.join(GOLD, 'compose.gold.yml'),
  PROJECT: gold_isolation.project_name,
  BUILD: process.env.GOLD_BUILD ?? path.join(GOLD, `.build${SUFFIX}`, 'move'), // isolated move copy (never the gate lane's)
  SUICFG: process.env.GOLD_SUICFG ?? path.join(GOLD, `.build${SUFFIX}`, 'suicfg'), // isolated sui CLI config
  DEPLOY: process.env.GOLD_DEPLOY ?? path.join(GOLD, `.gold${SUFFIX}-deployment.json`), // the manifest specs + lanes consume
  SPONSOR_RELEASE: process.env.GOLD_SPONSOR_RELEASE ?? path.join(GOLD, `.gold${SUFFIX}-sponsor-release.json`),
  OUT: path.join(GOLD, 'out'),
}
export const RPC = gold_isolation.endpoints.rpc
export const FAUCET = gold_isolation.endpoints.faucet
export const API = gold_isolation.endpoints.api
export const N_WALLETS = 4
// Same framework rev the Move packages pin (aresrpg/Move.toml) — single lineage on the localnet publish.
const FRAMEWORK_REV = '8fc60f1fa966e90398c93beb67ad4f42992889c7'
export const gold_move_packages = [
  'foundation',
  'spells',
  'social',
  'engine',
  'aresrpg',
  'kolizeum',
  'forgemagie',
  'gifting',
  'dungeon',
]
export const kiosk_packages = ['social', 'aresrpg', 'kolizeum', 'forgemagie', 'gifting', 'dungeon']

export const log = (m) => console.log(`[gold] ${m}`)
const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })
const sponsor_compose_env = (sponsor_dev_key) => {
  if (typeof sponsor_dev_key !== 'string' || !sponsor_dev_key)
    throw new Error('gold compose requires a throwaway sponsor key')
  return {
    ...process.env,
    COMPOSE_PROJECT_NAME: P.PROJECT,
    GOLD_RPC_PORT: String(gold_ports.rpc),
    GOLD_FAUCET_PORT: String(gold_ports.faucet),
    GOLD_CHK_PORT: String(gold_ports.checkpoint),
    GOLD_REDIS_PORT: String(gold_ports.redis),
    GOLD_API_PORT: String(gold_ports.api),
    GOLD_SPONSOR_PORT: String(gold_ports.sponsor),
    SPONSOR_DEV_KEY: sponsor_dev_key,
  }
}
// Reused publish/seed scripts, driven against the GOLD localnet under the isolated CLI config.
// PUBLISH_GATE_SKIP=1: sanctioned bypass — this disposable publish IS what a green gate later certifies.
export const script_env = (privkey) =>
  `SUI_CONFIG_DIR='${P.SUICFG}' NETWORK=testnet SUI_RPC='${RPC}' SUI_GRPC_URL='${RPC}' PRIVATE_KEY='${privkey}' PUBLISH_GATE_SKIP=1`

// ── deps: symlink node_modules so the Playwright config/specs resolve @playwright/test (the
//    bun-isolated-install trap the bots' deps.js documents; @mysten/* resolves via deps_gold's
//    createRequire anchored at packages/sdk — independent of this link) ──────────────────────
export function ensureDeps() {
  const nm = path.join(GOLD, 'node_modules')
  if (!fs.existsSync(nm)) fs.symlinkSync(path.join(REPO, 'packages', 'frontend', 'node_modules'), nm)
  fs.mkdirSync(P.OUT, { recursive: true })
}

// ── docker stack lifecycle (own compose project — never the gate lane's or the rpc stack) ──
export function bootStack(sponsor_dev_key) {
  try {
    execSync(`docker compose -f '${P.COMPOSE}' -p ${P.PROJECT} down -v --remove-orphans`, {
      stdio: 'ignore',
      env: sponsor_compose_env(sponsor_dev_key),
    })
  } catch {
    /* first boot */
  }
  log('booting gold stack (localnet + chk + redis + indexer + api)…')
  execSync(`docker compose -f '${P.COMPOSE}' -p ${P.PROJECT} up -d --build`, {
    stdio: 'inherit',
    env: sponsor_compose_env(sponsor_dev_key),
  })
}
export function teardownStack() {
  // `--profile sponsor`: a BARE `down` only targets services in no profile, so the sponsor/gas-pool containers
  // (profiles: ['sponsor']) SURVIVE it — leaking two containers + their port bindings into the next boot. The
  // profile flag pulls them into the down set. It also forces compose to parse the sponsor services, whose
  // `GAS_POOL_KEYPAIR: ${SPONSOR_DEV_KEY:?…}` interpolation demands the var — so we feed the SAME benign inline
  // placeholder (never a runtime secret in a teardown), var-independent: teardown must run with no real key present.
  execSync(`docker compose -f '${P.COMPOSE}' -p ${P.PROJECT} --profile sponsor down -v --remove-orphans`, {
    stdio: 'inherit',
    env: sponsor_compose_env('gold-teardown-config-only-not-a-key'),
  })
  // Assert the leak is actually gone: ZERO containers (any state) survive for this compose project. A silent
  // survivor wedges the next boot on a bound port — surface it loud, here, the moment it happens.
  const survivors = sh(`docker ps -aq --filter label=com.docker.compose.project=${P.PROJECT}`).trim()
  if (survivors)
    throw new Error(
      `gold teardown left ${survivors.split('\n').length} container(s) for project ${P.PROJECT}: ${survivors.replace(/\n/g, ' ')}`
    )
}
export function boot_sponsor(sponsor_dev_key) {
  log('booting throwaway localnet gas-pool + api/sponsor.mjs…')
  // `up --build` would pull the ALREADY-RUNNING `localnet` dependency (it owns its own `build:` block) into
  // the rebuild graph and RECREATE it — `--force-regenesis` then wipes every package/character/world this
  // boot already published (BOOT-NET-2 root cause, 2026-07-16: boot #7 died on "Package object does not
  // exist" for its own fresh id, right after this step — proven by redis, which has no `build:` key, staying
  // "Running" in the same invocation while localnet got "Built"+"Recreated"). Build the named images first,
  // THEN start them WITHOUT --build so localnet's already-built, already-healthy container is left alone.
  execSync(`docker compose -f '${P.COMPOSE}' -p ${P.PROJECT} --profile sponsor build gas-pool sponsor`, {
    stdio: 'inherit',
    env: sponsor_compose_env(sponsor_dev_key),
  })
  execSync(`docker compose -f '${P.COMPOSE}' -p ${P.PROJECT} --profile sponsor up -d gas-pool sponsor`, {
    stdio: 'inherit',
    env: sponsor_compose_env(sponsor_dev_key),
  })
}

// ── health ────────────────────────────────────────────────────────────────────────────────────
async function rpcCall(method, params = []) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return (await r.json()).result
}
export async function waitHealthy(timeoutMs = 180_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const cid = await rpcCall('sui_getChainIdentifier')
      if (cid) return cid
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`gold localnet RPC ${RPC} not healthy after ${timeoutMs}ms`)
}
export async function waitApi(timeoutMs = 120_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${API}/health`)
      if (r.ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`gold read-api ${API} not healthy after ${timeoutMs}ms`)
}
export async function wait_sponsor(timeout_ms = 180_000) {
  const endpoint = gold_isolation.endpoints.sponsor
  const started = Date.now()
  while (Date.now() - started < timeout_ms) {
    try {
      if ((await fetch(endpoint)).ok) return endpoint
    } catch {
      /* station image may still be starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error(`gold sponsor ${endpoint} not healthy after ${timeout_ms}ms`)
}
/** Poll a /v1 view until `pred(json)` holds — the indexer-caught-up gate. Returns elapsed ms. */
export async function waitV1(pathname, pred, timeoutMs = 240_000, label = pathname) {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${API}${pathname}`)
      last = await r.json()
      if (pred(last)) return Date.now() - t0
    } catch {
      /* api warming */
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error(
    `waitV1(${label}) timed out after ${timeoutMs}ms — last payload: ${JSON.stringify(last)?.slice(0, 400)}`
  )
}

// ── faucet / balances / keys ──────────────────────────────────────────────────────────────────
export async function faucet(address, hits = 1) {
  for (let i = 0; i < hits; i++) {
    await fetch(`${FAUCET}/gas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ FixedAmountRequest: { recipient: address } }),
    }).catch(() => {})
    await new Promise((r) => setTimeout(r, 250))
  }
}
export async function balanceSui(address) {
  const b = await rpcCall('suix_getBalance', [address])
  return Number(b?.totalBalance || 0) / 1e9
}
export async function genKeypairs(n) {
  const { Ed25519Keypair } = await load_deps()
  return Array.from({ length: n }, () => {
    const kp = Ed25519Keypair.generate()
    return { address: kp.getPublicKey().toSuiAddress(), privkey: kp.getSecretKey() }
  })
}

// ── isolated Sui CLI config whose `testnet` env alias resolves to the GOLD localnet RPC ───────
export function prepIsolatedConfig() {
  fs.rmSync(P.SUICFG, { recursive: true, force: true })
  fs.mkdirSync(P.SUICFG, { recursive: true })
  sh(`yes | SUI_CONFIG_DIR='${P.SUICFG}' sui client -y envs`, { stdio: 'ignore' })
  const yaml = path.join(P.SUICFG, 'client.yaml')
  let s = fs.readFileSync(yaml, 'utf8')
  s = s.replace(/(alias: testnet[\s\S]*?rpc: ")[^"]*(")/, `$1${RPC}$2`)
  fs.writeFileSync(yaml, s)
  sh(`SUI_CONFIG_DIR='${P.SUICFG}' sui client switch --env testnet`, { stdio: 'ignore' })
}
export function importSigner({ privkey, address }) {
  sh(`SUI_CONFIG_DIR='${P.SUICFG}' sui keytool import '${privkey}' ed25519`, { stdio: 'ignore' })
  sh(`SUI_CONFIG_DIR='${P.SUICFG}' sui client switch --address '${address}'`, { stdio: 'ignore' })
}

// ── throwaway copy of packages/move (never touch committed Published.toml / manifests) ────────
export function prepMoveCopy() {
  fs.rmSync(P.BUILD, { recursive: true, force: true }) // wipe ONLY gold's own .build/move
  fs.mkdirSync(P.BUILD, { recursive: true })
  const ex = `--exclude 'build/' --exclude 'node_modules/' --exclude 'out/'`
  // Keep this literal array in lockstep with ceremony_lib.mjs TICKET_ORDER without importing its live client.
  const package_sources = gold_move_packages.map((name) => `'${MOVE}/'${name}`).join(' ')
  sh(`rsync -a ${ex} ${package_sources} '${P.BUILD}/'`)
  sh(`rsync -a ${ex} '${MOVE}/scripts' '${P.BUILD}/'`)
  for (const f of ['Move.toml', 'Move.lock', 'Published.toml'])
    if (fs.existsSync(path.join(MOVE, f))) fs.copyFileSync(path.join(MOVE, f), path.join(P.BUILD, f))
  fs.symlinkSync(MOVE_NM, path.join(P.BUILD, 'node_modules'))
}

// ── publish the external Kiosk package to the gold localnet + repoint the copy's aresrpg ──────
export function publishKiosk() {
  // Prefer the testnet-rev clone (this rig's default resolution), else accept ANY cached rev — the copy
  // below is fully repointed (local kiosk + FRAMEWORK_REV) regardless of which upstream rev it started
  // from. A cold `sui move build` can cache MULTIPLE revs in one pass (kiosk_packages' own Move.toml files
  // carry a [dep-replacements.mainnet] Kiosk alongside the default testnet one), so testnet isn't
  // guaranteed to be the rev that actually lands on a fresh machine — determinism here just means picking
  // ONE reproducibly (sort | head -1), not policing which rev it is.
  //
  // TWO CACHE GENERATIONS: older sui toolchains laid the git cache out flat, keyed by the Move.toml rev
  // LITERAL — `~/.move/<url>_git_<testnet|mainnet>/kiosk` (legs 1–2 below). sui 1.75's toolchain nests it
  // one level deeper and keys by the RESOLVED COMMIT SHA instead — `~/.move/git/<url>_git_<sha>/kiosk`
  // (leg 3). Both can coexist on a machine with build history spanning toolchain versions (old dirs are
  // fossils from before the layout changed); a fresh machine on a current toolchain only ever populates
  // the new one, so leg 3 is what actually matches in CI.
  const cache =
    sh(`ls -d ~/.move/https___github_com_MystenLabs_apps_git_testnet/kiosk 2>/dev/null | head -1`).trim() ||
    sh(`ls -d ~/.move/https___github_com_MystenLabs_apps_git_*/kiosk 2>/dev/null | sort | head -1`).trim() ||
    sh(`ls -d ~/.move/git/https___github_com_MystenLabs_apps_git_*/kiosk 2>/dev/null | sort | head -1`).trim()
  if (!cache) throw new Error('Kiosk git cache not found in ~/.move — run a testnet build once to populate it')
  const kdir = path.join(P.BUILD, 'kiosk')
  fs.rmSync(kdir, { recursive: true, force: true })
  sh(`cp -r '${cache}' '${kdir}' && chmod -R u+w '${kdir}'`)
  fs.rmSync(path.join(kdir, 'Move.lock'), { force: true })
  fs.rmSync(path.join(kdir, 'Published.toml'), { force: true })
  const ktoml = path.join(kdir, 'Move.toml')
  let t = fs.readFileSync(ktoml, 'utf8')
  t = t.replace(/^published-at\s*=.*$/m, '')
  t = t.replace(/kiosk\s*=\s*"0x[0-9a-fA-F]+"/, 'kiosk = "0x0"')
  // Fully tolerant match: the cached copy may be either cache generation (see the probe above) — an
  // old-layout clone's Sui-framework pin literal is a branch name ("testnet"/"mainnet"), a new-layout
  // (sui 1.75+) clone may instead carry the resolved commit sha. Kiosk's own Move.toml has exactly one
  // `rev = "..."` occurrence (its Sui dependency line) either way, so matching any quoted value here can't
  // clobber anything else in the file.
  t = t.replace(/rev\s*=\s*"[^"]+"/g, `rev = "${FRAMEWORK_REV}"`)
  fs.writeFileSync(ktoml, t)
  const out = sh(
    `cd '${kdir}' && SUI_CONFIG_DIR='${P.SUICFG}' sui client publish --skip-dependency-verification --json`,
    { maxBuffer: 64 * 1024 * 1024 }
  )
  const r = JSON.parse(out)
  const kid = (r.objectChanges || []).find((c) => c.type === 'published')?.packageId
  if (r.effects?.status?.status !== 'success' || !kid)
    throw new Error(`Kiosk publish failed: ${JSON.stringify(r.effects?.status)}`)
  t = fs.readFileSync(ktoml, 'utf8')
  t = t.replace(/(version = "[^"]*")\n/, `$1\npublished-at = "${kid}"\n`)
  t = t.replace(/kiosk\s*=\s*"0x0"/, `kiosk = "${kid}"`)
  fs.writeFileSync(ktoml, t)
  // Every Kiosk-linking package must resolve the one freshly-published local package, never a testnet id.
  for (const pkg of kiosk_packages) {
    const toml = path.join(P.BUILD, pkg, 'Move.toml')
    if (!fs.existsSync(toml)) continue
    let a = fs.readFileSync(toml, 'utf8')
    a = a.replace(/\[dependencies\.Kiosk\][\s\S]*?rev = "testnet"\n/, '[dependencies.Kiosk]\nlocal = "../kiosk"\n')
    fs.writeFileSync(toml, a)
    fs.rmSync(path.join(P.BUILD, pkg, 'Move.lock'), { force: true })
  }
  return kid
}

// ── drive the reused publish/seed scripts (VERBATIM tooling, isolated config, gold RPC) ───────
export function runCeremony(privkey) {
  sh(`cd '${P.BUILD}/scripts' && ${script_env(privkey)} node ceremony.mjs`, {
    stdio: 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  })
}
export function runEnable(privkey) {
  sh(`cd '${P.BUILD}/scripts' && ${script_env(privkey)} node ceremony.mjs --enable`, { stdio: 'inherit' })
}
export function runSeed(privkey) {
  sh(`cd '${P.BUILD}/scripts' && ${script_env(privkey)} node seed_testnet.mjs`, {
    stdio: 'inherit',
    maxBuffer: 64 * 1024 * 1024,
  })
}
export function readManifests() {
  const cer = JSON.parse(fs.readFileSync(path.join(P.BUILD, 'scripts', 'out', 'ceremony_manifest.json'), 'utf8'))
  const seed = JSON.parse(fs.readFileSync(path.join(P.BUILD, 'scripts', 'out', 'seed_manifest.json'), 'utf8'))
  return { cer, seed }
}
// Canonical SDK id block (same keys as the deployment release schema / gate harness) — the L1 anchor lane
// injects this run-local projection into the app via window.__ARES_LOCALNET_IDS.
export function sdkBlock(m) {
  // DOOR-POLARITY PIN (advisor pass-68): ceremony.mjs stamps `_type_origins.zone_group_root` (the fresh
  // aresrpg pkg = the immutable `zones::ZoneGroupRootKey` defining id) on EVERY fresh publish; stamp_all.mjs
  // projects it to the release row's `type_origins.zone_group_root`, which sdk_ids_from_release maps to
  // ZONE_GROUP_ROOT_PACKAGE_ID — the pin create_fight_ptb gates the cheap `zones::*_with_proof` claim door
  // on. A gold manifest without it silently demotes every fight row to the OLD derivation door (the exact
  // coverage hole this pin closes), so a missing stamp fails the boot instead of faking old-door greens.
  const zone_group_root = m._type_origins?.zone_group_root
  if (!zone_group_root)
    throw new Error(
      'ceremony manifest carries no _type_origins.zone_group_root — a fresh publish always stamps it ' +
        '(ceremony.mjs); refusing a manifest that would silently compose the old claim door'
    )
  return {
    PACKAGE_ID: m.aresrpg.pkg,
    LATEST_PACKAGE_ID: m.aresrpg.latest ?? m.aresrpg.pkg,
    ZONE_GROUP_ROOT_PACKAGE_ID: zone_group_root,
    FOUNDATION_PACKAGE_ID: m.foundation.latest ?? m.foundation.pkg,
    FOUNDATION_LATEST_PACKAGE_ID: m.foundation.latest ?? m.foundation.pkg,
    FOUNDATION_TYPE_PACKAGE_ID: m.foundation.pkg,
    ENGINE_PACKAGE_ID: m.engine.pkg,
    ENGINE_LATEST_PACKAGE_ID: m.engine.latest ?? m.engine.pkg,
    ENGINE_TYPE_PACKAGE_ID: m.engine.pkg,
    ENGINE_VERSION: m.engine.version,
    SPELLS_PACKAGE_ID: m.spells.pkg,
    SPELLS_VERSION: m.spells.version,
    SOCIAL_PACKAGE_ID: m.social.pkg,
    SOCIAL_LATEST_PACKAGE_ID: m.social.latest ?? m.social.pkg,
    SOCIAL_VERSION: m.social.version,
    SOCIAL_FRIEND_REGISTRY: m.social.shared.FriendRegistry,
    // kolizeum/forgemagie are call-target-only siblings (same latest-?? -pkg fallback as ENGINE_LATEST_PACKAGE_ID).
    // Keep both in the run-local projection so their SDK builders never target `undefined::*`.
    KOLIZEUM_PACKAGE_ID: m.kolizeum.latest ?? m.kolizeum.pkg,
    FORGEMAGIE_PACKAGE_ID: m.forgemagie.latest ?? m.forgemagie.pkg,
    GIFTING_PACKAGE_ID: m.gifting.latest ?? m.gifting.pkg,
    DUNGEON_PACKAGE_ID: m.dungeon.latest ?? m.dungeon.pkg,
    VERSION: m.aresrpg.version,
    GAME_CONFIG: m.aresrpg.shared.GameConfig,
    CREATION: m.gifting.shared.Creation,
    CATALOG: m.aresrpg.shared.Catalog,
    FIGHT_REGISTRY: m.engine.shared.FightRegistry,
    POOL_REGISTRY: m.gifting.shared.PoolRegistry,
    ITEM_POLICY: m.policies?.item?.policy,
    ITEM_ROYALTY_MIN_MIST: String(10_000_000),
    CHARACTER_POLICY: m.policies?.character?.policy,
    KIOSK_ROYALTY_RULE_PACKAGE_ID: m._rules,
    EXTRACT_POLICY: m.policies?.extract?.policy,
    SCRIBE_CONFIG: m.aresrpg.shared.ScribeConfig,
    PET_FEED_CONFIG: m.aresrpg.shared.PetFeedConfig,
    CRUSH_BOARD: m.forgemagie.shared.CrushBoard,
    LOOT_REGISTRY: m.gifting.shared.LootRegistry,
    ADMIN_ARESRPG: m.aresrpg.admin,
    ADMIN_SPELLS: m.spells.admin,
    ADMIN_SOCIAL: m.social.admin,
    ADMIN_ENGINE: m.engine.admin,
    SPELL_REGISTRY: m.spells.shared.SpellRegistry,
  }
}

// ── chain writes (publisher-signed, fixed generous localnet budget — framework/sui.js convention) ──
const LOCALNET_GAS_BUDGET = 1_000_000_000 // 1 SUI; disposable localnet, &Random-safe fixed budget

export async function makeClient(rpc = RPC) {
  const { SuiJsonRpcClient } = await load_deps()
  return new SuiJsonRpcClient({ url: rpc, network: 'localnet' })
}
export async function signerOf(privkey) {
  const { Ed25519Keypair, decodeSuiPrivateKey } = await load_deps()
  return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(privkey).secretKey)
}
export async function transfer_all_sui({ client, wallet, recipient }) {
  const { Transaction } = await load_deps()
  const signer = await signerOf(wallet.privkey)
  const tx = new Transaction()
  tx.transferObjects([tx.gas], tx.pure.address(recipient))
  return execTx(client, signer, tx)
}
async function execTx(client, signer, tx) {
  tx.setGasBudget(LOCALNET_GAS_BUDGET)
  const r = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true, showEvents: true },
  })
  await client.waitForTransaction({ digest: r.digest })
  const ok = r?.effects?.status?.status === 'success'
  return { ok, digest: r.digest, abort: r?.effects?.status?.error ?? null, r }
}

// Reachability tune — mirrors the gate lane's proven tuneWorld (harness/lib.mjs TUNE) so bot fights are
// WINNABLE and zones are packed: tiny zones (spawn near content), max density (every zone full — defaults
// already guarantee 3 groups/8 nodes; we pack to 8/16), strong L1 combat (BASE_AP/MP/HP). world_flow's
// discovery + tactical solver are validated against exactly this config. CORE class ids = config.move order.
const TUNE = { ZONE_SIZE: 32, BASE_AP: 12, BASE_MP: 6, BASE_HP: 1_000_000 }
const CORE_CLASS_IDS = [0, 1, 5, 9] // senshi / yajin / shugo / tomoda

/** Admin fixture (docs §4): super-speed travel + max loot/xp multipliers + reachability tune, ONE PTB, AdminCap-gated. */
export async function adminDials({ client, signer, ids, world_id, speed = 100_000, mult = 400 }) {
  const { Transaction } = await load_deps()
  const tx = new Transaction()
  const pkg = ids.LATEST_PACKAGE_ID
  const cap = () => tx.object(ids.ADMIN_ARESRPG)
  const gc = () => tx.object(ids.GAME_CONFIG)
  const world = () => tx.object(world_id)
  const version = () => tx.object(ids.VERSION)
  tx.moveCall({ target: `${pkg}::world::set_speed_budget`, arguments: [cap(), world(), tx.pure.u64(speed), version()] })
  tx.moveCall({
    target: `${pkg}::world::set_zone_size`,
    arguments: [cap(), world(), tx.pure.u32(TUNE.ZONE_SIZE), version()],
  })
  tx.moveCall({
    target: `${pkg}::world::set_density`,
    arguments: [cap(), world(), tx.pure.u16(8), tx.pure.u16(8), tx.pure.u16(16), tx.pure.u16(16), version()],
  })
  tx.moveCall({ target: `${pkg}::config::set_xp_multiplier`, arguments: [cap(), gc(), tx.pure.u64(mult), version()] })
  tx.moveCall({ target: `${pkg}::config::set_loot_multiplier`, arguments: [cap(), gc(), tx.pure.u64(mult), version()] })
  for (const cid of CORE_CLASS_IDS) {
    tx.moveCall({
      target: `${pkg}::config::set_class_base_ap`,
      arguments: [cap(), gc(), tx.pure.u64(cid), tx.pure.u64(TUNE.BASE_AP), version()],
    })
    tx.moveCall({
      target: `${pkg}::config::set_class_base_mp`,
      arguments: [cap(), gc(), tx.pure.u64(cid), tx.pure.u64(TUNE.BASE_MP), version()],
    })
    tx.moveCall({
      target: `${pkg}::config::set_class_base_hp`,
      arguments: [cap(), gc(), tx.pure.u64(cid), tx.pure.u64(TUNE.BASE_HP), version()],
    })
  }
  return execTx(client, signer, tx)
}

/** Best-effort character mint through the SDK choke (paid door — the free door is zkLogin-gated on-chain).
 *  The SDK localnet resolver gaps (GAP-1/GAP-2, documented in test/localnet/bots/framework/context.js) are
 *  owned by the live gate lane — on any build-time gap we SKIP honestly (never a raw hand-built kiosk PTB). */
export async function tryCreateCharacter({ client, wallet, ids, kiosk_pkg, name, character_class }) {
  try {
    const [{ create_character_paid_ptb }, { aresrpg_deployment, aresrpg_shared_ref }, { KioskClient }] =
      await Promise.all([
        import('../../packages/sdk/src/sui/write/items_creation.js'),
        import('../../packages/sdk/src/deployment/aresrpg.js'),
        load_deps(),
      ])
    // diagnose GAP-1/GAP-2 before building anything (context.js precedent — refuse loudly, never guess)
    const dep = aresrpg_deployment('localnet', ids) // throws on GAP-1
    aresrpg_shared_ref('localnet', 'VERSION', false, { objectId: dep.VERSION }) // throws on GAP-2
    const gate = await client.getObject({ id: ids.CREATION, options: { showContent: true } })
    const price_mist = BigInt(gate?.data?.content?.fields?.price ?? 10_000_000_000)
    const kiosk_client = new KioskClient({
      client,
      network: 'testnet', // localnet has no built-in rule ids — explicit packageIds below override
      packageIds: {
        personalKioskRulePackageId: kiosk_pkg,
        kioskLockRulePackageId: kiosk_pkg,
        royaltyRulePackageId: kiosk_pkg,
      },
    })
    const context = { network: 'localnet', ids: { aresrpg: ids }, kiosk_client }
    const tx = create_character_paid_ptb(context)({ name, class: character_class, price_mist })
    const signer = await signerOf(wallet.privkey)
    const res = await execTx(client, signer, tx)
    const character_id = res.r?.objectChanges?.find(
      (c) => c.type === 'created' && String(c.objectType).includes('::character::Character')
    )?.objectId
    const kiosk_id = res.r?.objectChanges?.find(
      (c) => c.type === 'created' && String(c.objectType).includes('::kiosk::Kiosk')
    )?.objectId
    const personal_kiosk_cap_id = res.r?.objectChanges?.find(
      (c) => c.type === 'created' && String(c.objectType).includes('::personal_kiosk::PersonalKioskCap')
    )?.objectId
    return {
      ...res,
      character_id: character_id ?? null,
      kiosk_id: kiosk_id ?? null,
      personal_kiosk_cap_id: personal_kiosk_cap_id ?? null,
    }
  } catch (e) {
    return { ok: false, skipped: true, reason: String(e?.message ?? e).split('\n')[0] }
  }
}
