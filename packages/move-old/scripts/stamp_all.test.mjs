// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

import { classify } from './ceremony_lib.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../../..')
const release_path = path.join(repo, 'packages/sdk/src/deployment/release.json')
const deployment_path = path.join(repo, 'packages/sdk/src/deployment/aresrpg.js')
const ceremony_path = path.join(here, 'out/ceremony_manifest.json')
// MISSING-ARTIFACT (#96): out/ceremony_manifest.json is stamped by the content pipeline's engine-upgrade
// ceremony (private repo) and is absent by design in this public repo. The 3 tests below read a REAL
// stamped manifest; 'release validation rejects malformed preserved deployment ids' uses synthetic data
// and has no ceremony dependency, so it keeps running for real.
const CEREMONY_MANIFEST_AVAILABLE = existsSync(ceremony_path)

test.skipIf(!CEREMONY_MANIFEST_AVAILABLE)(
  'release.json owns every SDK pin and stamp_all replaces it atomically',
  async () => {
    expect(existsSync(release_path)).toBe(true)

    const ceremony = JSON.parse(readFileSync(ceremony_path, 'utf8'))
    const release = JSON.parse(readFileSync(release_path, 'utf8'))
    const network = ceremony._network
    const release_network = release.networks[network]
    expect(release_network).toBeDefined()
    expect(release.networks.mainnet.type_origins).toEqual({ zone_group_root: '' })
    expect(release_network.actors.owner).toMatch(/^0x[0-9a-f]{64}$/)
    expect(release_network.actors.treasury).toMatch(/^0x[0-9a-f]{64}$/)

    const deployment_source = readFileSync(deployment_path, 'utf8')
    expect(deployment_source).toContain("from './release.json'")
    for (const [consumer, actor] of [
      ['packages/frontend/src/chain/read_treasury.js', 'treasury'],
      // Admin surface extracted to the private apps/admin app (OSS split 2026-07-19); the admin-gate guard
      // follows the moved files — both still read the ceremony-stamped actor from the manifest, never a literal.
      ['apps/admin/src/admin-gate.js', 'owner'],
      ['apps/admin/src/components/admin_release_steps.tsx', 'owner'],
    ]) {
      const consumer_path = path.join(repo, consumer)
      // OSS split (2026-07-19): admin-surface consumers live only in the private apps/admin overlay.
      if (!existsSync(consumer_path)) continue
      const source = readFileSync(consumer_path, 'utf8')
      expect(source).toContain('release_network')
      expect(source).toContain(`actors?.${actor}`)
      expect(source).not.toMatch(/0x[0-9a-f]{64}/)
      if (actor === 'owner') expect(source).not.toContain('VITE_OWNER_ADDRESS')
    }
    for (const caller of ['ceremony.mjs', 'ceremony_upgrade.mjs'])
      expect(readFileSync(path.join(here, caller), 'utf8')).toContain("execSync('node stamp_all.mjs'")
    expect(readFileSync(path.join(here, 'seed_full_corpus.mjs'), 'utf8')).not.toContain("execSync('node stamp_all.mjs'")
    // #1302: the read above proves what the FILE says — it stayed green for weeks over a module that could not
    // be imported at all. One assertion goes through a REAL import so a dead seeder can never pass again. (The
    // seeder reads THIS test's ceremony manifest at import, hence its home inside the manifest-gated test.)
    const prev_key = process.env.PRIVATE_KEY
    process.env.PRIVATE_KEY ??= Ed25519Keypair.generate().getSecretKey() // throwaway: no chain call, no keystore read
    const { seed_full_corpus } = await import('./seed_full_corpus.mjs')
    if (prev_key === undefined) delete process.env.PRIVATE_KEY
    expect(typeof seed_full_corpus).toBe('function')
    for (const [artifact, applicator, generator] of [
      ['pet_feed_payload.json', 'apply_pet_payload.mjs', 'seed/generators/pet_feed_payload.mjs'],
      ['mob_distance_payload.json', 'apply_mob_distance_payload.mjs', 'seed/generators/mob_distance_payload.mjs'],
    ]) {
      expect(existsSync(path.join(here, 'out', artifact))).toBe(false)
      expect(readFileSync(path.join(here, applicator), 'utf8')).toContain(generator)
    }
    for (const file of ['apply_shop_payload.mjs', 'apply_pet_payload.mjs', 'apply_mob_distance_payload.mjs'])
      expect(readFileSync(path.join(here, file), 'utf8')).not.toContain('ceremony_manifest.json')
    const sponsor_source = readFileSync(path.join(repo, 'api', 'sponsor.mjs'), 'utf8')
    // SPONSOR_ARESRPG_PACKAGES now wires up (owner ruling 2026-07-24: env config, fail-closed,
    // release.json fallback) — FRAMEWORK_PACKAGES stays release.json-only, out of that ticket's scope.
    expect(sponsor_source).toContain('SPONSOR_ARESRPG_PACKAGES')
    expect(sponsor_source).not.toContain('SPONSOR_FRAMEWORK_PACKAGES')
    expect(readFileSync(path.join(here, 'emergency', 'status.sh'), 'utf8')).not.toContain('types.json')
    const gold_compose = readFileSync(path.join(repo, 'test', 'gold', 'compose.gold.yml'), 'utf8')
    expect(gold_compose).not.toContain('SPONSOR_ARESRPG_PACKAGES')
    expect(gold_compose).not.toContain('SPONSOR_FRAMEWORK_PACKAGES')
    expect(gold_compose).toContain('SPONSOR_RELEASE_PATH')
    const { aresrpg_deployment, aresrpg_shared_ref, random_shared_ref } = await import(
      pathToFileURL(deployment_path).href
    )
    const { network: resolved_network, ...resolved_ids } = aresrpg_deployment(network)
    expect(resolved_network).toBe(network)
    const { packages } = release_network
    const { shared } = release_network
    const { policies } = release_network
    const release_ids = {
      PACKAGE_ID: packages.aresrpg.origin,
      LATEST_PACKAGE_ID: packages.aresrpg.latest,
      ZONE_GROUP_ROOT_PACKAGE_ID: release_network.type_origins.zone_group_root,
      FOUNDATION_PACKAGE_ID: packages.foundation.latest,
      ENGINE_PACKAGE_ID: packages.engine.origin,
      ENGINE_LATEST_PACKAGE_ID: packages.engine.latest,
      ENGINE_VERSION: shared.ENGINE_VERSION.id,
      SPELLS_PACKAGE_ID: packages.spells.origin,
      SPELLS_VERSION: shared.SPELLS_VERSION.id,
      SOCIAL_PACKAGE_ID: packages.social.origin,
      SOCIAL_LATEST_PACKAGE_ID: packages.social.latest,
      SOCIAL_VERSION: shared.SOCIAL_VERSION.id,
      SOCIAL_FRIEND_REGISTRY: shared.SOCIAL_FRIEND_REGISTRY.id,
      KOLIZEUM_PACKAGE_ID: packages.kolizeum.latest,
      FORGEMAGIE_PACKAGE_ID: packages.forgemagie.latest,
      GIFTING_PACKAGE_ID: packages.gifting.latest,
      DUNGEON_PACKAGE_ID: packages.dungeon.latest,
      VERSION: shared.VERSION.id,
      GAME_CONFIG: shared.GAME_CONFIG.id,
      CREATION: shared.CREATION.id,
      CATALOG: shared.CATALOG.id,
      FIGHT_REGISTRY_SHARDS: shared.FIGHT_REGISTRY_SHARDS.map((row) => ({
        id: row.id,
        initial_shared_version: row.initial_shared_version,
      })),
      FIGHT_LATCH_SHARDS: shared.FIGHT_LATCH_SHARDS.map((row) => ({
        id: row.id,
        initial_shared_version: row.initial_shared_version,
      })),
      POOL_REGISTRY: shared.POOL_REGISTRY.id,
      ITEM_POLICY: policies.item.id,
      CHARACTER_POLICY: policies.character.id,
      KIOSK_ROYALTY_RULE_PACKAGE_ID: release_network.rules_package,
      EXTRACT_POLICY: policies.extract.id,
      // OPTIONAL until the BACKLOG-18 delete-door ceremony stamps it — the resolver defaults it to ''.
      CHARACTER_EXTRACT_POLICY: policies.character_extract?.id ?? '',
      SCRIBE_CONFIG: shared.SCRIBE_CONFIG.id,
      PET_FEED_CONFIG: shared.PET_FEED_CONFIG.id,
      CRUSH_BOARD: shared.CRUSH_BOARD.id,
      LOOT_REGISTRY: shared.LOOT_REGISTRY.id,
      ITEM_ROYALTY_MIN_MIST: release_network.constants.item_royalty_min_mist,
    }
    expect(resolved_ids).toEqual(release_ids)

    for (const [key, pin] of Object.entries(shared)) {
      if (!(key in release_ids)) continue
      // The shard list resolves through `fight_registry_arg`, which supplies both overrides per index — there is
      // no single ref to sweep for it.
      if (Array.isArray(pin)) continue
      expect(aresrpg_shared_ref(network, key, false)).toEqual({
        objectId: pin.id,
        initialSharedVersion: pin.initial_shared_version,
        mutable: false,
      })
    }
    for (const [key, pin] of [
      ['ITEM_POLICY', policies.item],
      ['CHARACTER_POLICY', policies.character],
      ['EXTRACT_POLICY', policies.extract],
    ])
      expect(aresrpg_shared_ref(network, key, false)).toEqual({
        objectId: pin.id,
        initialSharedVersion: pin.initial_shared_version,
        mutable: false,
      })
    const { random } = release_network.system
    expect(random_shared_ref(network)).toEqual({
      objectId: random.id,
      initialSharedVersion: random.initial_shared_version,
      mutable: false,
    })

    const scratch = mkdtempSync(path.join(tmpdir(), 'ares-release-atomic-'))
    const target = path.join(scratch, 'release.json')
    const old_source = '{\n  "old": true\n}\n'
    writeFileSync(target, old_source)

    try {
      const stamp_all_url = pathToFileURL(path.join(here, 'stamp_all.mjs'))
      stamp_all_url.searchParams.set('test', String(Date.now()))
      const { write_release_atomic } = await import(stamp_all_url.href)
      expect(() =>
        write_release_atomic(
          target,
          { schema: 1, networks: {} },
          {
            write_file(temp_path, source) {
              writeFileSync(temp_path, source.slice(0, Math.floor(source.length / 2)))
              throw new Error('injected before rename')
            },
          }
        )
      ).toThrow('injected before rename')
      expect(readFileSync(target, 'utf8')).toBe(old_source)
      expect(readdirSync(scratch)).toEqual(['release.json'])
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }
)

// #770 — the shipped pins silently kept the ORIGIN as `latest` through two aresrpg upgrades, so every
// SDK moveCall (LATEST_PACKAGE_ID, packages/sdk/src/deployment/aresrpg.js) targeted retired bytecode.
// The ceremony manifest is the receipt stamp_all reads; release.json must be nothing but its faithful
// stamp. Chain drift itself is caught by check_release_pins.mjs (it needs a fullnode); this locks the
// two checked-in artifacts together so a recorded upgrade can never fail to reach the pins again.
test.skipIf(!CEREMONY_MANIFEST_AVAILABLE)("release.json pins the ceremony receipt's latest for every package", () => {
  const ceremony = JSON.parse(readFileSync(ceremony_path, 'utf8'))
  const release = JSON.parse(readFileSync(release_path, 'utf8'))
  const { packages } = release.networks[ceremony._network]
  for (const [name, pins] of Object.entries(packages)) {
    // stamp_all's own fallback: an un-upgraded package records no `latest`, so the origin IS latest.
    expect(pins.latest).toBe(ceremony[name].latest ?? ceremony[name].pkg)
    expect(pins.origin).toBe(ceremony[name].pkg)
    // A retired version stays sponsorable (drain window) and never collides with the live pair.
    for (const retired of pins.previous ?? []) {
      expect(retired).not.toBe(pins.latest)
      expect(retired).not.toBe(pins.origin)
    }
  }
})

test('package_row rolls the retired latest into `previous` on repoint (sponsor drain window)', async () => {
  const stamp_all_url = pathToFileURL(path.join(here, 'stamp_all.mjs'))
  stamp_all_url.searchParams.set('roll-test', String(Date.now()))
  const { package_row } = await import(stamp_all_url.href)
  const id = (h) => '0x' + h.padEnd(64, '0')
  const cap = { upgradeCap: id('ca9') }
  const rolled = (entry, prior) => package_row(entry, 'engine', prior).previous
  // fresh publish (no prior, latest == origin): no `previous` key at all
  expect(rolled({ pkg: id('e0'), latest: id('e0'), ...cap }, undefined)).toBeUndefined()
  // v3 → v4 repoint: the retired v3 latest joins `previous`
  expect(rolled({ pkg: id('e0'), latest: id('e4'), ...cap }, { origin: id('e0'), latest: id('e3') })).toEqual([
    id('e3'),
  ])
  // v4 → v5 repoint accumulates history in order (dedup keeps it a set)
  expect(
    rolled({ pkg: id('e0'), latest: id('e5'), ...cap }, { origin: id('e0'), latest: id('e4'), previous: [id('e3')] })
  ).toEqual([id('e3'), id('e4')])
  // no repoint (latest unchanged): history preserved, never grows or dupes
  expect(
    rolled(
      { pkg: id('e0'), latest: id('e5'), ...cap },
      { origin: id('e0'), latest: id('e5'), previous: [id('e3'), id('e4')] }
    )
  ).toEqual([id('e3'), id('e4')])
  // a latest that returns to origin never lands in `previous` — origin is always allowlisted
  expect(rolled({ pkg: id('e0'), latest: id('e0'), ...cap }, { origin: id('e0'), latest: id('e0') })).toBeUndefined()
  // LINEAGE SWITCH: a fresh publish mints a new origin, so the prior lineage's ids are NOT this package's
  // history — they must be dropped, never carried into the sponsor's outdated list.
  expect(
    rolled(
      { pkg: id('f0'), latest: id('f0'), ...cap },
      { origin: id('e0'), latest: id('e5'), previous: [id('e3'), id('e4')] }
    )
  ).toBeUndefined()
  // …and the new lineage then accumulates only its own retired ids
  expect(
    rolled({ pkg: id('f0'), latest: id('f2'), ...cap }, { origin: id('e0'), latest: id('e5'), previous: [id('e3')] })
  ).toBeUndefined()
  expect(
    rolled({ pkg: id('f0'), latest: id('f2'), ...cap }, { origin: id('f0'), latest: id('f1'), previous: [] })
  ).toEqual([id('f1')])
})

test('the republish marker has ONE home — both readers resolve the same file', async () => {
  // stamp_all.mjs spells the marker path out instead of importing it (it is copied alone into gold's isolated
  // Move tree and must run standalone). That is a deliberate duplication of a STRING, not of the fact — the
  // marker file itself is the fact. This assert is what keeps the duplication honest: rename or move the marker
  // and the reader that was not updated fails here, rather than going silently blind mid-ceremony.
  const { REPUBLISH_MARKER } = await import(pathToFileURL(path.join(here, 'stamp_all.mjs')).href)
  const { REPUBLISH_MARKER_PATH } = await import(pathToFileURL(path.join(here, 'ceremony_preflight_compat.mjs')).href)
  expect(REPUBLISH_MARKER).toBe(REPUBLISH_MARKER_PATH)
})

test('package_row keeps the DRAINING lineage in `previous` during a republish window', async () => {
  const stamp_all_url = pathToFileURL(path.join(here, 'stamp_all.mjs'))
  stamp_all_url.searchParams.set('republish-test', String(Date.now()))
  const { package_row } = await import(stamp_all_url.href)
  const id = (h) => '0x' + h.padEnd(64, '0')
  const cap = { upgradeCap: id('ca9') }
  const rolled = (entry, prior, republish) => package_row(entry, 'engine', prior, republish).previous
  // THE DRAIN CASE. A republish mints the new lineage while the OLD one still hosts live sessions, so the ids
  // those clients are still calling — the retired lineage's origin and its latest — stay in `previous`. Without
  // them the sponsor answers a mid-session client with a generic refusal instead of `outdated-package`.
  expect(rolled({ pkg: id('f0'), latest: id('f0'), ...cap }, { origin: id('e0'), latest: id('e5') }, true)).toEqual([
    id('e0'),
    id('e5'),
  ])
  // The retired lineage's DEEPER history is not resurrected — those drained a ceremony ago.
  expect(
    rolled(
      { pkg: id('f0'), latest: id('f0'), ...cap },
      { origin: id('e0'), latest: id('e5'), previous: [id('e3'), id('e4')] },
      true
    )
  ).toEqual([id('e0'), id('e5')])
  // An un-upgraded prior lineage (origin == latest) contributes one id, not a duplicate pair.
  expect(rolled({ pkg: id('f0'), latest: id('f0'), ...cap }, { origin: id('e0'), latest: id('e0') }, true)).toEqual([
    id('e0'),
  ])
  // The window changes ONLY the lineage-switch case: an in-lineage upgrade still accumulates exactly as before.
  expect(rolled({ pkg: id('e0'), latest: id('e4'), ...cap }, { origin: id('e0'), latest: id('e3') }, true)).toEqual([
    id('e3'),
  ])
  // A first publish has no draining lineage to keep, window open or not.
  expect(rolled({ pkg: id('e0'), latest: id('e0'), ...cap }, undefined, true)).toBeUndefined()
  // And with the window CLOSED the same switch drops the prior lineage — upgrade semantics, unchanged.
  expect(
    rolled({ pkg: id('f0'), latest: id('f0'), ...cap }, { origin: id('e0'), latest: id('e5') }, false)
  ).toBeUndefined()
})

test('release validation rejects malformed preserved deployment ids', async () => {
  const release = JSON.parse(readFileSync(release_path, 'utf8'))
  const stamp_all_url = pathToFileURL(path.join(here, 'stamp_all.mjs'))
  stamp_all_url.searchParams.set('validation-test', String(Date.now()))
  const { validate_release } = await import(stamp_all_url.href)
  for (const [label, mutate] of [
    ['system.random.id', (row) => (row.system.random.id = 'not-an-id')],
    ['external_coin_types.HSUI.type', (row) => (row.external_coin_types.HSUI.type = 'not-a-type')],
    ['policies.item.id', (row) => (row.policies.item.id = 'not-an-id')],
    ['packages.aresrpg.publishers.item', (row) => (row.packages.aresrpg.publishers.item = 'not-an-id')],
    ['actors.owner', (row) => (row.actors.owner = 'not-an-id')],
    ['actors.treasury', (row) => (row.actors.treasury = 'not-an-id')],
  ]) {
    const malformed = structuredClone(release)
    mutate(malformed.networks.testnet)
    expect(() => validate_release(malformed, 'testnet')).toThrow(label)
  }
})

// #422 — the pre-merge monolith package minted a set of assets under `policies.legacy`; publishing creates
// a new universe (only upgrades carry state forward), so those assets belong to an abandoned universe and
// the mapping keeping them tradable was dead weight. stamp_all used to preserve that block FOREVER via
// `json_clone(previous.policies?.legacy)` on every ceremony — a stale fossil neither the manifest nor any
// SDK reader ever repopulated. Both the preservation and the shipped config must stay gone.
test('stamp_all no longer preserves or validates a legacy policy block, and release.json ships none', () => {
  const stamp_all_source = readFileSync(path.join(here, 'stamp_all.mjs'), 'utf8')
  expect(stamp_all_source).not.toContain('policies?.legacy')
  expect(stamp_all_source).not.toContain('policies.legacy')

  const release = JSON.parse(readFileSync(release_path, 'utf8'))
  for (const network of Object.keys(release.networks))
    expect(release.networks[network].policies).not.toHaveProperty('legacy')
})

/**
 * The recorded ceremony manifest predates the fight-registry sharding, and re-recording a whole publish for a
 * spec about an unrelated object would be theatre. Give the stamp step a well-formed shard list instead — the
 * fabricated ids live HERE, in a test, never in a recorded artifact.
 */
function with_fight_shards(manifest) {
  manifest.engine.shared.FightRegistryShards ??= Array.from(
    { length: 16 },
    (_, i) => `0x${(i + 1).toString(16).padStart(64, '0')}`
  )
  manifest.engine.shared_versions.FightRegistryShards ??= Array.from({ length: 16 }, () => '1')
  manifest.engine.shared.FightLatchShards ??= Array.from(
    { length: 16 },
    (_, i) => `0x${(i + 17).toString(16).padStart(64, '0')}`
  )
  manifest.engine.shared_versions.FightLatchShards ??= Array.from({ length: 16 }, () => '1')
  delete manifest.engine.shared.FightRegistry
  delete manifest.engine.shared_versions.FightRegistry
  delete manifest.engine.shared.FightLatch
  delete manifest.engine.shared_versions.FightLatch
  return manifest
}

// The real ceremony subprocess measured 795ms isolated green / 6027ms under load with identical output.
test.skipIf(!CEREMONY_MANIFEST_AVAILABLE)(
  'Gold localnet ceremony creates and stamps a real CrushBoard',
  async () => {
    const manifest = with_fight_shards(JSON.parse(readFileSync(ceremony_path, 'utf8')))
    const previous = JSON.parse(readFileSync(release_path, 'utf8')).networks.testnet
    delete manifest.forgemagie.shared.CrushBoard
    delete manifest.forgemagie.shared_versions.CrushBoard

    // Gold points the ceremony's `testnet` alias at its isolated local RPC. Model the
    // fresh wiring receipt only when that exact ceremony plan creates the board.
    const plan = execFileSync('node', [path.join(here, 'ceremony.mjs'), '--dry-run', '--network', 'testnet'], {
      encoding: 'utf8',
    })
    if (plan.includes('forgemagie::forgemagie::create_board'))
      classify(
        'forgemagie',
        {
          objectChanges: [
            {
              type: 'created',
              objectType: `${manifest.forgemagie.pkg}::forgemagie::CrushBoard`,
              objectId: '0xcafe',
              owner: { Shared: { initial_shared_version: '7' } },
            },
          ],
        },
        manifest
      )

    const stamp_all_url = pathToFileURL(path.join(here, 'stamp_all.mjs'))
    stamp_all_url.searchParams.set('localnet-test', String(Date.now()))
    const { release_network_from_manifest, validate_release } = await import(stamp_all_url.href)
    let release
    expect(() => {
      release = {
        schema: 1,
        generated_at: '2026-07-16T00:00:00.000Z',
        networks: { localnet: release_network_from_manifest(manifest, previous) },
      }
      validate_release(release, 'localnet')
    }).not.toThrow()
    expect(release.networks.localnet.shared.CRUSH_BOARD).toEqual({
      id: '0xcafe',
      initial_shared_version: '7',
    })
  },
  30_000
)

test.skipIf(!CEREMONY_MANIFEST_AVAILABLE)('Gold keeps strict release stamping inside its isolated Move copy', () => {
  const scratch = realpathSync(mkdtempSync(path.join(tmpdir(), 'ares-gold-stamp-')))
  const { actors } = JSON.parse(readFileSync(release_path, 'utf8')).networks.testnet
  const copied_scripts = path.join(scratch, 'test/gold/.build/move/scripts')
  const copied_stamp = path.join(copied_scripts, 'stamp_all.mjs')
  const copied_manifest = path.join(copied_scripts, 'out/ceremony_manifest.json')
  const isolated_target = path.join(copied_scripts, 'out/release.json')
  const fallback_target = path.join(scratch, 'test/gold/packages/sdk/src/deployment/release.json')

  try {
    mkdirSync(path.dirname(copied_manifest), { recursive: true })
    mkdirSync(path.dirname(fallback_target), { recursive: true })
    copyFileSync(path.join(here, 'stamp_all.mjs'), copied_stamp)
    writeFileSync(
      copied_manifest,
      JSON.stringify(with_fight_shards(JSON.parse(readFileSync(ceremony_path, 'utf8'))), null, 2)
    )
    execFileSync('node', [copied_stamp], {
      encoding: 'utf8',
      env: {
        ...process.env,
        STAMP_ALL_TARGET: isolated_target,
        ARES_OWNER_ADDRESS: actors.owner,
        ARES_TREASURY_ADDRESS: actors.treasury,
      },
    })

    expect(existsSync(isolated_target)).toBe(true)
    expect(existsSync(fallback_target)).toBe(false)
    const gold_source = readFileSync(path.join(repo, 'test/gold/up_gold.mjs'), 'utf8')
    expect(gold_source).toContain("process.env.STAMP_ALL_TARGET = path.join(P.BUILD, 'scripts', 'out', 'release.json')")
    expect(gold_source).toContain("path.join(P.REPO, 'packages', 'sdk', 'src', 'deployment', 'release.json')")
    expect(gold_source).toContain('process.env.ARES_OWNER_ADDRESS = release_actors.owner')
    expect(gold_source).toContain('process.env.ARES_TREASURY_ADDRESS = release_actors.treasury')
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})
