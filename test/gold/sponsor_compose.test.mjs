// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

const root = fileURLToPath(new URL('../..', import.meta.url))

test('gold compose runs the sponsor protocol with only a throwaway localnet key', () => {
  const compose = fs.readFileSync(`${root}/test/gold/compose.gold.yml`, 'utf8')
  expect(compose).toContain('sponsor:')
  expect(compose).toContain('api/sponsor.mjs')
  expect(compose).toContain('SPONSOR_DEV_KEY')
  expect(compose).toContain('gas-pool:')
})

test('the poor-wallet sponsor row is collected rather than permanently skipped', () => {
  const regressions = fs.readFileSync(`${root}/test/gold/specs_anchor/regressions.spec.ts`, 'utf8')
  expect(regressions).not.toContain("test.skip('POOR-WALLET SPONSOR ROUTING")
  expect(regressions).toContain("test('POOR-WALLET SPONSOR ROUTING")
})

test('gold deployment exposes runtime fixtures without serializing the station key', () => {
  const up_gold = fs.readFileSync(`${root}/test/gold/up_gold.mjs`, 'utf8')
  const manifest_source = up_gold.slice(
    up_gold.indexOf('const manifest = {'),
    up_gold.indexOf('fs.writeFileSync(P.DEPLOY')
  )
  const fixture_source = up_gold.slice(up_gold.indexOf('const sponsor_fixture = {'), up_gold.indexOf('// 8 —'))
  expect(manifest_source).toContain('market_two_actor,')
  expect(manifest_source).toContain('sponsor_fixture,')
  expect(manifest_source).not.toContain('sponsor_wallet')
  expect(manifest_source).not.toContain('SPONSOR_DEV_KEY')
  expect(fixture_source).not.toContain('privkey')
  expect(fixture_source).not.toContain('sponsor_wallet')
})

test('the throwaway station key exists before boot and is threaded only through compose env', () => {
  const up_gold = fs.readFileSync(`${root}/test/gold/up_gold.mjs`, 'utf8')
  const lib_gold = fs.readFileSync(`${root}/test/gold/lib_gold.mjs`, 'utf8')
  const keygen = up_gold.indexOf('const [sponsor_wallet] = await genKeypairs(1)')
  const boot = up_gold.indexOf('bootStack(')
  expect(keygen).toBeGreaterThan(-1)
  expect(keygen).toBeLessThan(boot)
  expect(up_gold).toContain('bootStack(sponsor_wallet.privkey)')
  expect(up_gold).toContain('boot_sponsor(sponsor_wallet.privkey)')
  expect(up_gold).not.toContain('process.env.SPONSOR_DEV_KEY = sponsor_wallet.privkey')
  // 2 in bootStack (down + up) + 2 in boot_sponsor (build + up, split 2026-07-16 — BOOT-NET-2: a single
  // `up --build` recreated the already-running localnet dependency and wiped its chain state).
  expect(lib_gold.match(/env: sponsor_compose_env\(sponsor_dev_key\)/g)).toHaveLength(4)
})

test('the poor-wallet character mirrors the bounded working-wallet name pattern', () => {
  const up_gold = fs.readFileSync(`${root}/test/gold/up_gold.mjs`, 'utf8')
  const start = up_gold.indexOf('const poor_character_result = await tryCreateCharacter({')
  const fixture_source = up_gold.slice(start, up_gold.indexOf('\n  })', start))
  const template = fixture_source.match(/name: `([^`]*)`/)?.[1]
  const longest_name = template?.replace('${N_WALLETS}', '4').replace('${Date.now() % 100000}', '99999')
  expect(longest_name).toBe('gold_w4_c0_99999')
  expect(longest_name?.length).toBeLessThan(20)
})

test('regenesis purges canonical deployment and sponsor artifacts before compose boot', () => {
  const up_gold = fs.readFileSync(`${root}/test/gold/up_gold.mjs`, 'utf8')
  const boot = up_gold.indexOf('bootStack(sponsor_wallet.privkey)')
  const deployment_purge = up_gold.indexOf("path.join(P.GOLD, '.gold-deployment.json')")
  const sponsor_purge = up_gold.indexOf("path.join(P.GOLD, '.gold-sponsor-release.json')")
  expect(deployment_purge).toBeGreaterThan(-1)
  expect(sponsor_purge).toBeGreaterThan(-1)
  expect(deployment_purge).toBeLessThan(boot)
  expect(sponsor_purge).toBeLessThan(boot)
})

test('the sponsor fixture verifier reads through the manifest RPC', async () => {
  const manifest = { network: 'localnet', rpc: 'http://127.0.0.1:9100' }
  const fallback_rpc = 'http://default-fullnode.invalid'
  const previous_rpc = process.env.GOLD_RPC
  const previous_fetch = globalThis.fetch
  const requests = []
  process.env.GOLD_RPC = fallback_rpc
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
    return Response.json({
      jsonrpc: '2.0',
      id: 1,
      result: { visibility: 'Public', isEntry: true, typeParameters: [], parameters: [], return: [] },
    })
  }
  try {
    const { makeClient } = await import(`./lib_gold.mjs?manifest-rpc=${Date.now()}`)
    const client = await makeClient(manifest.rpc)
    await client.getNormalizedMoveFunction({ package: '0x2', module: 'coin', function: 'value' })
    expect(requests).toEqual([
      {
        url: manifest.rpc,
        body: { jsonrpc: '2.0', id: 1, method: 'sui_getNormalizedMoveFunction', params: ['0x2', 'coin', 'value'] },
      },
    ])
  } finally {
    globalThis.fetch = previous_fetch
    if (previous_rpc === undefined) delete process.env.GOLD_RPC
    else process.env.GOLD_RPC = previous_rpc
  }
})

// BOOT-NET-2 sweep (2026-07-16): boot #7 died on "Package object does not exist" for its own freshly
// published package, right after the sponsor containers started. Root cause: `boot_sponsor`'s single
// `up -d --build gas-pool sponsor` pulled the ALREADY-RUNNING `localnet` dependency (it owns its own
// `build:` block) into the rebuild graph and RECREATED it; `--force-regenesis` then wiped the whole chain.
// (proof: the SAME invocation's log left redis — no `build:` key — as "Running", while localnet was
// "Built"+"Recreated".) These four rows are the class sweep: every client/url construction reachable from
// the boot+fixture chain must resolve the CURRENT boot's rpc, never a module-load-time/env default.
test('boot_sponsor builds gas-pool/sponsor without rebuilding (and thus recreating) the already-booted localnet', () => {
  const lib_gold = fs.readFileSync(`${root}/test/gold/lib_gold.mjs`, 'utf8')
  const start = lib_gold.indexOf('export function boot_sponsor(')
  const body = lib_gold.slice(start, lib_gold.indexOf('\n}', start))
  expect(body).not.toContain('up -d --build')
  expect(body).toMatch(/\bbuild\b\s+gas-pool\s+sponsor/)
  expect(body).toMatch(/\bup\b\s+-d\s+gas-pool\s+sponsor/)
})

test('the soak multiplier crank reads its client through the manifest RPC', () => {
  const soak = fs.readFileSync(`${root}/test/gold/bot/soak.mjs`, 'utf8')
  const start = soak.indexOf('async function crank_multiplier(')
  expect(start).toBeGreaterThan(-1)
  const body = soak.slice(start, soak.indexOf('\n}', start))
  expect(body).toContain('makeClient(manifest.rpc)')
})

test('the localnet bot target overrides its module-default rpc from the loaded manifest', () => {
  const run = fs.readFileSync(`${root}/test/gold/bot/run.mjs`, 'utf8')
  const manifest_load = run.indexOf('const manifest = target.needs_manifest')
  expect(manifest_load).toBeGreaterThan(-1)
  const after = run.slice(manifest_load, manifest_load + 500)
  expect(after).toContain('if (manifest?.rpc) target.rpc = manifest.rpc')
})

test('the speed-budget admin dial reads its client through the manifest RPC', () => {
  const regressions = fs.readFileSync(`${root}/test/gold/specs_anchor/regressions.spec.ts`, 'utf8')
  const start = regressions.indexOf('async function set_speed_budget(')
  expect(start).toBeGreaterThan(-1)
  const body = regressions.slice(start, regressions.indexOf('\n}', start))
  expect(body).toContain('makeClient(manifest.rpc)')
})
