// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

import { assert_rig_paths } from '../rig_integrity.mjs'

const gold = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const value_exports = (source: string): Set<string> =>
  new Set(
    [...source.matchAll(/^\s*export\s+(?:const|function|let)\s+([A-Za-z_$][\w$]*)/gm)].map(
      ([, identifier]) => identifier
    )
  )

test('gold rig · compose and bot backend dependency closure exists', async () => {
  expect(assert_rig_paths).not.toThrow()
  await expect(import(path.join(gold, 'bot', 'backend_sdk.mjs'))).resolves.toMatchObject({
    build_sdk_backend: expect.any(Function),
  })
})

test('gold rig · publish copy and SDK ids mirror the current nine-package ceremony', async () => {
  const rig = await import('../lib_gold.mjs')
  expect(rig.gold_move_packages).toEqual([
    'foundation',
    'spells',
    'social',
    'engine',
    'aresrpg',
    'kolizeum',
    'forgemagie',
    'gifting',
    'dungeon',
  ])
  expect(rig.kiosk_packages).toEqual(['social', 'aresrpg', 'kolizeum', 'forgemagie', 'gifting', 'dungeon'])
  // An env OVERLAY since #2149 — the key is a value, never text inside a shell command.
  expect(rig.script_env('fixture-key').SUI_GRPC_URL).toBe(rig.RPC)
  expect(rig.script_env('fixture-key').PRIVATE_KEY).toBe('fixture-key')

  const row = (name: string) => ({
    pkg: `${name}_origin`,
    latest: `${name}_latest`,
    version: `${name}_version`,
    admin: `${name}_admin`,
    shared: {
      Catalog: 'catalog',
      CrushBoard: 'crush_board',
      Creation: 'creation',
      FightRegistry: 'fight_registry',
      FriendRegistry: 'friend_registry',
      GameConfig: 'game_config',
      LootRegistry: 'loot_registry',
      PetFeedConfig: 'pet_feed_config',
      PoolRegistry: 'pool_registry',
      ScribeConfig: 'scribe_config',
      SpellRegistry: 'spell_registry',
    },
  })
  const manifest = {
    foundation: row('foundation'),
    spells: row('spells'),
    social: row('social'),
    engine: row('engine'),
    aresrpg: row('aresrpg'),
    kolizeum: row('kolizeum'),
    forgemagie: row('forgemagie'),
    gifting: row('gifting'),
    dungeon: row('dungeon'),
    policies: {
      item: { policy: 'item_policy' },
      character: { policy: 'character_policy' },
      extract: { policy: 'extract_policy' },
    },
    _rules: 'kiosk_rules',
    _type_origins: { zone_group_root: 'zone_group_root_origin' },
  }
  expect(rig.sdkBlock(manifest)).toMatchObject({
    ZONE_GROUP_ROOT_PACKAGE_ID: 'zone_group_root_origin',
    FOUNDATION_PACKAGE_ID: 'foundation_latest',
    FOUNDATION_LATEST_PACKAGE_ID: 'foundation_latest',
    FOUNDATION_TYPE_PACKAGE_ID: 'foundation_origin',
    ENGINE_TYPE_PACKAGE_ID: 'engine_origin',
    SOCIAL_LATEST_PACKAGE_ID: 'social_latest',
    GIFTING_PACKAGE_ID: 'gifting_latest',
    DUNGEON_PACKAGE_ID: 'dungeon_latest',
    CREATION: 'creation',
    POOL_REGISTRY: 'pool_registry',
    CRUSH_BOARD: 'crush_board',
    LOOT_REGISTRY: 'loot_registry',
  })
  // Door-polarity law (advisor pass-68): a manifest without the ceremony's zone_group_root stamp must FAIL
  // the boot — an empty pin would silently demote every gold fight row to the old derivation door.
  expect(() => rig.sdkBlock({ ...manifest, _type_origins: {} })).toThrow(/zone_group_root/)
})

test('gold rig · stale deployment manifests cannot survive boot or teardown', () => {
  const up_source = fs.readFileSync(path.join(gold, 'up_gold.mjs'), 'utf8')
  const down_source = fs.readFileSync(path.join(gold, 'down_gold.mjs'), 'utf8')
  const cleanup = 'fs.rmSync(P.DEPLOY, { force: true })'

  expect(up_source.indexOf(cleanup), 'up must invalidate stale ids before booting a fresh chain').toBeGreaterThan(-1)
  expect(up_source.indexOf(cleanup)).toBeLessThan(up_source.indexOf('bootStack()'))
  expect(down_source, 'teardown must invalidate the deployment manifest with its chain').toContain(cleanup)
})

test('gold rig · fresh boots seed the production-parity corpus required by anchor rows', () => {
  const up_source = fs.readFileSync(path.join(gold, 'up_gold.mjs'), 'utf8')
  const lib_source = fs.readFileSync(path.join(gold, 'lib_gold.mjs'), 'utf8')
  expect(up_source).toContain("process.env.GOLD_CORPUS ?? 'mainnet'")
  expect(fs.existsSync(path.join(gold, 'fixtures', 'stamp_all_gold.mjs'))).toBe(false)
  expect(lib_source).not.toContain('stamp_all_gold')
  expect(lib_source).not.toContain("path.join(P.BUILD, 'scripts', 'stamp_all.mjs')")
})

test('gold rig · boot refuses to publish a manifest without one character per funded wallet', () => {
  const up_source = fs.readFileSync(path.join(gold, 'up_gold.mjs'), 'utf8')
  expect(up_source).toContain('i < N_WALLETS')
  expect(up_source).toContain('character mint FAILED for w${i}')
  expect(up_source).not.toContain('character mint SKIPPED for w${i}')
})

test('gold rig · localnet-capable regression rows cannot silently skip', () => {
  const regressions_source = fs.readFileSync(path.join(gold, 'specs_anchor', 'regressions.spec.ts'), 'utf8')
  const xp_source = fs.readFileSync(path.join(gold, 'specs_anchor', 'xp_freshness.spec.ts'), 'utf8')
  const in_turn_path = path.join(gold, 'specs_anchor', 'in_turn_beats.spec.ts')
  const worn_source = fs.readFileSync(path.join(gold, 'specs_anchor', 'worn_cosmetics.spec.ts'), 'utf8')
  const lootbox_source = fs.readFileSync(path.join(gold, 'specs_anchor', 'lootbox_open.spec.ts'), 'utf8')

  expect(regressions_source).not.toContain('test.skip(!target')
  expect(regressions_source).not.toContain("test.skip('IN-TURN BEATS")
  expect(regressions_source).not.toContain('test.describe.serial')
  expect(fs.existsSync(in_turn_path)).toBe(true)
  expect(xp_source).toContain('gold_manifest.fight_fixtures?.win')
  expect(xp_source).toContain("play_fixture_fight(page, fixture!, { expected: 'win' })")
  expect(xp_source).toContain('.toBeGreaterThan(before_experience)')
  expect(worn_source).toContain('wait_for_world_binding')
  expect(worn_source).toContain('use_world_binding.getState().world')
  expect(worn_source).toContain('test.setTimeout(300_000)')
  expect(lootbox_source.match(/test\.skip\(/g)).toHaveLength(1)
})

test('gold rig · headed win and loss rows drive the complete fight through mouse input', () => {
  const lifecycle_path = path.join(gold, 'specs_anchor', 'fight_lifecycle.spec.ts')
  const helpers_path = path.join(gold, 'specs_anchor', 'fight_mouse_helpers.ts')
  const fixtures_path = path.join(gold, 'fixtures', 'fight_fixtures.mjs')
  expect(fs.existsSync(lifecycle_path)).toBe(true)
  expect(fs.existsSync(helpers_path)).toBe(true)
  expect(fs.existsSync(fixtures_path)).toBe(true)
  const source = `${fs.readFileSync(lifecycle_path, 'utf8')}\n${fs.readFileSync(helpers_path, 'utf8')}`
  const fixture_source = fs.readFileSync(fixtures_path, 'utf8')

  expect(source).toContain('FULL FIGHT TO WIN')
  expect(source).toContain('FULL FIGHT TO LOSS')
  expect(source).not.toContain('test.describe.serial')
  expect(source).toContain('page.mouse.down()')
  expect(source).toContain('page.mouse.up()')
  expect(source).toContain('.hud-fightctl__ready')
  expect(source).toContain('.hud-fightctl__end')
  expect(source).toContain('click_damage_spell')
  expect(source).toContain("['Warcleave', 'Ghost Talon', 'Lashline']")
  expect(source).toContain('use_world_binding.getState().world === world')
  expect(source).not.toContain('state?.world_id')
  expect(fixture_source).toContain('dryRunTransactionBlock')
  expect(fixture_source).toContain('* 1.5')
  expect(fixture_source).not.toContain('transaction.setGasBudget(localnet_gas_budget)')
  for (const forbidden of [
    '__dev_start_world_fight',
    '__ARES_DEV_PLACE_READY',
    '__ARES_DEV_MOVE',
    '__ARES_DEV_CAST',
    '__voxel_ctl.teleport',
  ])
    expect(source, `mouse-only lifecycle must not call ${forbidden}`).not.toContain(forbidden)
})

test('gold rig · generated world corpus value exports cover the app module', () => {
  const app_source = fs.readFileSync(
    path.resolve(gold, '..', '..', 'packages', 'frontend', 'src', 'pages', 'encyclopedia', 'world_corpus.ts'),
    'utf8'
  )
  const generated_source = fs.readFileSync(path.join(gold, 'out', 'fixtures', 'world_corpus.ts'), 'utf8')
  const generated_exports = value_exports(generated_source)
  const missing_exports = [...value_exports(app_source)].filter((identifier) => !generated_exports.has(identifier))

  expect(missing_exports, 'generated alias must export every app world-corpus value').toEqual([])
})

test('gold rig · anchor rebinds authored content to this boot localnet ids', async () => {
  const fixture_path = path.join(gold, 'fixtures', 'runtime_catalog.mjs')
  const vite_path = path.join(gold, 'vite.anchor.config.ts')
  const world_gate_path = path.join(gold, 'specs_anchor', 'world_gate.spec.ts')
  expect(fs.existsSync(fixture_path)).toBe(true)
  expect(fs.existsSync(vite_path)).toBe(true)
  expect(fs.existsSync(world_gate_path)).toBe(true)

  const seeded = JSON.parse(
    fs.readFileSync(path.resolve(gold, '..', '..', 'packages', 'move', 'scripts', 'out', 'seed_manifest.json'), 'utf8')
  )
  const fixture_world_ids = [`0x${'a'.repeat(64)}`, `0x${'b'.repeat(64)}`]
  const fight_fixtures = {
    win: { world_id: fixture_world_ids[0], mob_template_id: `0x${'c'.repeat(64)}` },
    loss: { world_id: fixture_world_ids[1], mob_template_id: `0x${'d'.repeat(64)}` },
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ares-gold-runtime-'))
  try {
    const { write_runtime_catalog } = await import('../fixtures/runtime_catalog.mjs')
    const runtime = write_runtime_catalog({
      seed: seeded,
      corpus_source: 'mainnet',
      out_dir: scratch,
      fight_fixtures,
    })
    for (const module_path of [
      'spells_module_path',
      'living_module_path',
      'world_module_path',
      'deployment_path',
    ] as const)
      expect(fs.existsSync(runtime[module_path]), `${module_path} must be generated`).toBe(true)

    const { spells, living, world_corpus, worlds } = runtime.catalog
    const local_spell_ids = new Set(Object.values(seeded.spells).map((entry: any) => entry.id))
    const local_world_ids = new Set(seeded.worlds.map((world: any) => world.id))
    const runtime_world_ids = new Set([...local_world_ids, ...fixture_world_ids])
    expect(spells).toHaveLength(240)
    expect(new Set(spells.map((row: any) => row.object_id))).toEqual(local_spell_ids)
    expect(new Set(living.worlds)).toEqual(runtime_world_ids)
    expect(new Set(world_corpus.worlds.map((world: any) => world.id))).toEqual(local_world_ids)
    expect(new Set(worlds.map((world: any) => world.id))).toEqual(runtime_world_ids)
    const deployment_source = fs.readFileSync(runtime.deployment_path, 'utf8')
    expect(deployment_source).toContain(`export const T62_WORLDS = ${JSON.stringify(worlds)}`)
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }

  const anchor_config = fs.readFileSync(path.join(gold, 'playwright.anchor.config.ts'), 'utf8')
  const vite_source = fs.readFileSync(vite_path, 'utf8')
  const world_gate_source = fs.readFileSync(world_gate_path, 'utf8')
  const up_source = fs.readFileSync(path.join(gold, 'up_gold.mjs'), 'utf8')
  expect(anchor_config).toContain('vite.anchor.config.ts')
  expect(up_source).toContain('write_runtime_catalog({')
  for (const module_name of ['fight-spells.js', 'living_corpus.ts', 'world_corpus.ts', 'deployment.ts'])
    expect(vite_source).toContain(module_name)
  expect(world_gate_source).toContain("import('/src/world-shell/world_catalog.js')")
  expect(world_gate_source).not.toContain("import('/src/chain/deployment')")
  expect(world_gate_source).toContain('const character_level = Number(character.level ?? 1)')
  expect(world_gate_source).not.toContain('Number(character.level)')
})
