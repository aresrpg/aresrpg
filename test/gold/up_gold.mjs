// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// test/gold up — boot the GOLD stack (localnet + indexer + api on ONE docker network), publish the
// CURRENT Move source, seed content, apply the admin fixture (super speed + max multipliers), fund M
// dev wallets, mint the required QA characters, WAIT for /v1 display truth, and write the deployment
// manifest every gold spec consumes. LOCALNET ONLY. docs/GOLD_STANDARD_SUITE.md §1/§4/§10.
//
//   node test/gold/up_gold.mjs          # full boot (≈5–10 min: regenesis + publish + seed + backfill)
//   node test/gold/down_gold.mjs        # teardown (kill-your-own-rigs law)
import fs from 'node:fs'
import path from 'node:path'

import { level_coop_full_kit_fighters } from './fixtures/coop_full_kit_bootstrap.mjs'
import { create_fight_fixtures } from './fixtures/fight_fixtures.mjs'
import { character_fixture_plan, validate_character_fixture } from './fixtures/actor_fixture.mjs'
import { create_market_two_actor } from './fixtures/market_bootstrap.mjs'
import { write_runtime_catalog } from './fixtures/runtime_catalog.mjs'
import { assert_parity, write_corpus_manifest } from './parity.mjs'
import {
  P,
  RPC,
  FAUCET,
  API,
  N_WALLETS,
  gold_move_packages,
  log,
  ensureDeps,
  bootStack,
  boot_sponsor,
  waitHealthy,
  waitApi,
  wait_sponsor,
  waitV1,
  prepIsolatedConfig,
  prepMoveCopy,
  genKeypairs,
  faucet,
  balanceSui,
  importSigner,
  publishKiosk,
  runCeremony,
  runEnable,
  runSeed,
  readManifests,
  sdkBlock,
  makeClient,
  signerOf,
  adminDials,
  tryCreateCharacter,
  transfer_all_sui,
} from './lib_gold.mjs'

const CLASSES = ['senshi', 'yajin', 'tomoda', 'shugo'] // one per wallet — L2 covers all 12
const coop_full_kit_classes = [...CLASSES, 'senshi'] // four fighter classes + one seatless spectator identity

async function main() {
  const t0 = Date.now()
  const timings = {}
  const phase = (name, since) => {
    timings[name] = Date.now() - since
    log(`⏱ ${name}: ${timings[name]}ms`)
  }
  const stale_gold_artifacts = [
    P.DEPLOY,
    P.SPONSOR_RELEASE,
    path.join(P.GOLD, '.gold-deployment.json'),
    path.join(P.GOLD, '.gold-sponsor-release.json'),
  ]
  for (const artifact of new Set(stale_gold_artifacts)) fs.rmSync(artifact, { force: true })
  ensureDeps()
  const [sponsor_wallet] = await genKeypairs(1)

  // 1 — the whole stack on one network: localnet(+checkpoint dump) → chk → indexer → redis → api
  let t = Date.now()
  bootStack(sponsor_wallet.privkey)
  const chain_id = await waitHealthy()
  await waitApi()
  phase('boot_stack', t)
  log(`localnet healthy · chainId=${chain_id} · api up at ${API}`)

  // 2 — isolation (gold's own CLI config + move copy) and the publisher
  t = Date.now()
  prepIsolatedConfig()
  prepMoveCopy()
  const [publisher] = await genKeypairs(1)
  await faucet(publisher.address, 4)
  importSigner(publisher)
  log(`publisher=${publisher.address} · balance=${await balanceSui(publisher.address)} SUI`)

  // 3 — Kiosk + the current package lineage + enable + seed (the shipped tooling, VERBATIM)
  const kiosk = publishKiosk()
  log(`kiosk published → ${kiosk}`)
  const release_actors = JSON.parse(
    fs.readFileSync(path.join(P.REPO, 'packages', 'sdk', 'src', 'deployment', 'release.json'), 'utf8')
  ).networks.testnet.actors
  process.env.ARES_OWNER_ADDRESS = release_actors.owner
  process.env.ARES_TREASURY_ADDRESS = release_actors.treasury
  process.env.STAMP_ALL_TARGET = path.join(P.BUILD, 'scripts', 'out', 'release.json')
  runCeremony(publisher.privkey)
  runEnable(publisher.privkey)
  phase('publish', t)
  // GOLD_CORPUS wiring: seed_testnet delegates `mainnet` to the shipped full-corpus seeder. Gold defaults to
  // production-parity content; `active` remains an explicit diagnostic override for the minimal QA corpus.
  const corpus_source = process.env.GOLD_CORPUS ?? 'mainnet'
  process.env.GOLD_CORPUS = corpus_source // export to the child seed process (lib_gold.runSeed inherits process.env)
  log(`seed corpus: ${corpus_source}`)
  t = Date.now()
  runSeed(publisher.privkey)
  phase('seed', t)

  // 4 — manifest + admin fixture (docs §4): speed 100_000 (SPEED_MAX), xp/loot ×4.00 (MULT_MAX today;
  //     the MULT_MAX→10_000 Move spec is queued on the republish train — specs read the LIVE dial, never 4).
  t = Date.now()
  const { cer, seed } = readManifests()
  const ids = sdkBlock(cer)
  const world_id = seed.world?.id ?? null
  if (!world_id) throw new Error('seed manifest has no world.id — cannot apply the speed dial')
  // Justified bare default (BOOT-NET-2 sweep): this call IS the source of `manifest.rpc` below (`rpc: RPC`)
  // — the deployment manifest doesn't exist on disk yet for this call to read back, so there is no "manifest
  // rpc" to pass here that isn't this exact module constant.
  const client = await makeClient()
  const admin_signer = await signerOf(publisher.privkey)
  const dials = await adminDials({ client, signer: admin_signer, ids, world_id })
  if (!dials.ok) throw new Error(`admin dials FAILED on-chain: ${dials.abort} (digest ${dials.digest})`)
  log(`admin dials ok · digest=${dials.digest} (speed=100000, xp/loot mult=400)`)
  phase('admin_dials', t)

  // 5 — M dev wallets, faucet-funded (localnet faucet mints unlimited — throwaway keys only)
  t = Date.now()
  const wallets = await genKeypairs(N_WALLETS)
  for (const w of wallets) await faucet(w.address, 2)
  log(`${N_WALLETS} wallets funded · w0=${wallets[0].address} bal=${await balanceSui(wallets[0].address)} SUI`)
  phase('wallets', t)

  // 6 — four funded actors, with two characters on wallets 0/1 for team-play and selection coverage.
  t = Date.now()
  const characters = []
  for (const request of character_fixture_plan(N_WALLETS)) {
    for (let slot = 0; slot < request.count; slot += 1) {
      const klass = CLASSES[(request.wallet_index + slot) % CLASSES.length]
      const res = await tryCreateCharacter({
        client,
        wallet: wallets[request.wallet_index],
        ids,
        kiosk_pkg: kiosk,
        name: `gold_w${request.wallet_index}_c${slot}_${Date.now() % 100000}`,
        character_class: klass,
      })
      if (!res.ok || !res.character_id || !res.kiosk_id || !res.personal_kiosk_cap_id)
        throw new Error(
          `character mint FAILED for w${request.wallet_index}/c${slot}: ${res.reason ?? res.abort ?? 'missing character kiosk state'}`
        )
      characters.push({
        wallet: request.wallet_index,
        wallet_index: request.wallet_index,
        slot,
        character_id: res.character_id,
        kiosk_id: res.kiosk_id,
        personal_kiosk_cap_id: res.personal_kiosk_cap_id,
        class: klass,
      })
      log(`character minted for w${request.wallet_index}/c${slot} → ${res.character_id}`)
    }
  }
  validate_character_fixture(characters)
  phase('characters', t)

  // A fifth, isolated wallet owns a real character but no SUI after setup; only the sponsor row consumes it.
  const [poor_wallet] = await genKeypairs(1)
  await faucet(poor_wallet.address, 2)
  const poor_character_result = await tryCreateCharacter({
    client,
    wallet: poor_wallet,
    ids,
    kiosk_pkg: kiosk,
    name: `gold_w${N_WALLETS}_c0_${Date.now() % 100000}`,
    character_class: 'senshi',
  })
  if (
    !poor_character_result.ok ||
    !poor_character_result.character_id ||
    !poor_character_result.kiosk_id ||
    !poor_character_result.personal_kiosk_cap_id
  )
    throw new Error(`poor-wallet character mint FAILED: ${poor_character_result.reason ?? poor_character_result.abort}`)
  const drained = await transfer_all_sui({ client, wallet: poor_wallet, recipient: publisher.address })
  if (!drained.ok || (await balanceSui(poor_wallet.address)) > 0.2)
    throw new Error(`poor-wallet drain FAILED: ${drained.abort ?? 'balance remains above sponsor threshold'}`)

  // FULL-KIT COOP ISOLATION: five dedicated, fully funded wallets live after the existing poor-wallet row.
  // The first four own one class apiece; the fifth owns the spectator identity. Never add these characters to
  // wallets 0..3: sibling fixtures deliberately assert their original per-wallet roster cardinalities.
  const coop_full_kit_wallet_offset = N_WALLETS + 1
  const coop_full_kit_wallets = await genKeypairs(coop_full_kit_classes.length)
  for (const wallet of coop_full_kit_wallets) await faucet(wallet.address, 2)
  const coop_full_kit_characters = []
  for (const [offset, character_class] of coop_full_kit_classes.entries()) {
    const wallet_index = coop_full_kit_wallet_offset + offset
    const wallet = coop_full_kit_wallets[offset]
    const result = await tryCreateCharacter({
      client,
      wallet,
      ids,
      kiosk_pkg: kiosk,
      name: `gold_w${wallet_index}_c0_${Date.now() % 100000}`,
      character_class,
    })
    if (!result.ok || !result.character_id || !result.kiosk_id || !result.personal_kiosk_cap_id)
      throw new Error(
        `coop full-kit character mint FAILED for w${wallet_index}/c0: ` +
          `${result.reason ?? result.abort ?? 'missing character kiosk state'}`
      )
    const row = {
      wallet: wallet_index,
      wallet_index,
      slot: 0,
      character_id: result.character_id,
      kiosk_id: result.kiosk_id,
      personal_kiosk_cap_id: result.personal_kiosk_cap_id,
      class: character_class,
    }
    characters.push(row)
    coop_full_kit_characters.push(row)
    log(`coop full-kit character minted for w${wallet_index}/c0 → ${result.character_id}`)
  }
  validate_character_fixture(characters)
  const manifest_wallets = [...wallets, poor_wallet, ...coop_full_kit_wallets]

  // B1 FIXTURE ISOLATION (2026-07-20): two more fully isolated wallets, each owning ZERO seeded characters —
  // dedicated targets for the anchor suite's two ad-hoc "mint a character live through the app" writes
  // (anchor.spec.ts's "ui create" proof + regressions.spec.ts's CHECKPOINT/SPEED GATE fresh-character gate).
  // Both writes used to land on shared, statically-counted fixture wallets (2 and 3): the fresh character
  // silently became a SECOND character on a wallet another spec's static count (MULTI-CHARACTER FIXTURE) or
  // "the wallet's only character" live pick (join_fixture_world's rows[0]) assumed had exactly one, desyncing
  // every downstream read on the same sequential single-worker boot (R16_TAXONOMY B1, confirmed via
  // anchor_768261 landing as gold_w2_c0's uninvited sibling). One-home law: give each write its own wallet so
  // the collision class can't exist, rather than cleaning up after it — never referenced by character_fixture_plan,
  // never read by any other spec.
  const [anchor_write_wallet, speed_gate_wallet] = await genKeypairs(2)
  await faucet(anchor_write_wallet.address, 2)
  await faucet(speed_gate_wallet.address, 2)

  // 7 — DISPLAY TRUTH gate: the indexer (genesis backfill over the checkpoint volume) must project the
  //     seeded world into /v1 before any spec runs. This IS the "indexer deployed alongside" proof.
  t = Date.now()
  const catchup_ms = await waitV1(
    `/v1/encyclopedia?kind=worlds`,
    (j) => JSON.stringify(j).includes(world_id.slice(2, 42)),
    300_000,
    'worlds visible'
  )
  phase('v1_catchup', t)
  log(`/v1 shows the seeded world after ${catchup_ms}ms`)

  // 7b — SEED-PARITY GATE (§4 SEED-PARITY LAW): /v1/encyclopedia counts vs the selected corpus manifest. A
  //      shortfall FAILS the boot (never a silent partial seed). The default full corpus is the anchor fixture.
  t = Date.now()
  const cc = write_corpus_manifest(path.join(P.OUT, 'corpus_manifest.json'), corpus_source)
  log(`corpus [${corpus_source}] counts: ${JSON.stringify(cc.counts)} → ${path.join(P.OUT, 'corpus_manifest.json')}`)
  const parity = await assert_parity({ api: API, source: corpus_source, wait_ms: 180_000 })
  log(parity.report)
  if (!parity.ok)
    throw new Error(
      `SEED-PARITY FAILED (${corpus_source}): ${parity.report} — the boot REFUSES a partial seed (§4 SEED-PARITY LAW). ` +
        `Land a current-lineage seeder for this corpus, or set GOLD_CORPUS to a corpus the current seeder fully mints.`
    )
  phase('parity', t)

  // 7c — deterministic cross-wallet marketplace inventory: two unique objects plus native lots 1/10/100.
  t = Date.now()
  const market_two_actor = await create_market_two_actor({
    api: API,
    client,
    admin_signer,
    ids,
    kiosk_pkg: kiosk,
    wallets,
    characters,
    wait_v1: waitV1,
  })
  log(`market fixture ready · items=${market_two_actor.unique_item_ids.length + market_two_actor.stack_lots.length}`)
  phase('market_fixture', t)

  // Sponsor key was generated before compose interpolation; fund it only from this disposable localnet.
  await faucet(sponsor_wallet.address, 4)
  const sponsor_release = {
    schema: 1,
    generated_at: new Date().toISOString(),
    networks: {
      localnet: {
        packages: Object.fromEntries(
          gold_move_packages.map((name) => [name, { origin: cer[name].pkg, latest: cer[name].latest ?? cer[name].pkg }])
        ),
        rules_package: ids.KIOSK_ROYALTY_RULE_PACKAGE_ID,
        system: { sponsor_framework_packages: ['0x2', kiosk, ids.KIOSK_ROYALTY_RULE_PACKAGE_ID] },
      },
    },
  }
  fs.writeFileSync(P.SPONSOR_RELEASE, `${JSON.stringify(sponsor_release, null, 2)}\n`)
  process.env.GOLD_SPONSOR_RELEASE_PATH = P.SPONSOR_RELEASE
  boot_sponsor(sponsor_wallet.privkey)
  const sponsor_endpoint = await wait_sponsor()
  const sponsor_fixture = {
    endpoint: `${sponsor_endpoint}/api/sponsor`,
    wallet_index: N_WALLETS,
    wallet: { address: poor_wallet.address },
    character: {
      character_id: poor_character_result.character_id,
      kiosk_id: poor_character_result.kiosk_id,
      personal_kiosk_cap_id: poor_character_result.personal_kiosk_cap_id,
    },
  }

  // 8 — deterministic fight fixtures live outside the production-parity world/count baseline: each dedicated
  //     World has one mob roster, so the headed win/loss/beat rows never depend on production encounter RNG.
  t = Date.now()
  const fight_fixtures = await create_fight_fixtures({ client, signer: admin_signer, ids, seeded_mobs: seed.mobs })
  const fixture_world_ids = Object.values(fight_fixtures).map((fixture) => fixture.world_id)
  const fixture_mob_ids = Object.values(fight_fixtures).map((fixture) => fixture.mob_template_id)
  await waitV1(
    '/v1/encyclopedia?kind=worlds',
    (json) => fixture_world_ids.every((id) => JSON.stringify(json).includes(id)),
    120_000,
    'fight fixture worlds visible'
  )
  await waitV1(
    '/v1/encyclopedia?kind=mobs',
    (json) => fixture_mob_ids.every((id) => JSON.stringify(json).includes(id)),
    120_000,
    'fight fixture mobs visible'
  )
  const coop_full_kit_fighters = await level_coop_full_kit_fighters({
    client,
    ids,
    kiosk_pkg: kiosk,
    wallets: manifest_wallets,
    fighters: coop_full_kit_characters.slice(0, CLASSES.length),
    fixture: fight_fixtures.coop_full_kit_leveler,
  })
  const coop_full_kit_roster = {
    fighters: coop_full_kit_fighters,
    spectator: { ...coop_full_kit_characters[CLASSES.length], level: 1 },
  }
  await Promise.all(
    coop_full_kit_fighters.map((fighter) =>
      waitV1(
        `/v1/characters?owner=${manifest_wallets[fighter.wallet_index].address}`,
        (json) =>
          (json.characters ?? []).some(
            (character) => character.id === fighter.character_id && Number(character.level) === fighter.level
          ),
        120_000,
        `coop full-kit ${fighter.class} L${fighter.level} visible`
      )
    )
  )
  log(`coop full-kit roster ready · ${coop_full_kit_fighters.map((row) => `${row.class}=L${row.level}`).join(' · ')}`)
  const runtime_catalog = write_runtime_catalog({
    seed,
    corpus_source,
    out_dir: path.join(P.OUT, 'fixtures'),
    fight_fixtures,
  })
  log(`fight fixtures + runtime catalogs ready · ${JSON.stringify(runtime_catalog.counts)}`)
  phase('fight_fixtures', t)

  // 9 — the manifest (gold's OWN file — never the gate lane's .localnet-deployment.json)
  const manifest = {
    network: 'localnet',
    chain_id,
    rpc: RPC,
    faucet: FAUCET,
    api: API,
    ids: { aresrpg: ids, kiosk },
    world_id,
    dials: { speed_budget: 100_000, xp_multiplier: 400, loot_multiplier: 400, digest: dials.digest },
    fight_fixtures,
    runtime_catalog,
    market_two_actor,
    sponsor_fixture,
    coop_full_kit_roster,
    publisher, // localnet throwaway — regenerated every boot, worthless off this chain
    wallets: manifest_wallets, // localnet throwaway dev actors; sponsor gas wallet is never included
    anchor_write_wallet, // localnet throwaway — anchor.spec.ts "ui create" WRITE only; unseeded, unread elsewhere
    speed_gate_wallet, // localnet throwaway — regressions.spec.ts CHECKPOINT/SPEED GATE fresh char only; unseeded, unread elsewhere
    characters,
    seed: {
      world: seed.world ?? null,
      worlds: seed.worlds ?? [],
      recipes: seed.recipes ?? [],
      mobs: seed.mobs ?? null,
      items: seed.items ?? null,
      digests: seed.digests ?? null,
    },
    timings,
    created_at: new Date().toISOString(),
  }
  fs.writeFileSync(P.DEPLOY, JSON.stringify(manifest, null, 2))
  log(`manifest → ${P.DEPLOY}`)
  log(`GOLD UP in ${((Date.now() - t0) / 1000).toFixed(0)}s · timings=${JSON.stringify(timings)}`)
}

main().catch((e) => {
  console.error('[gold] up FAILED:', e)
  process.exit(1)
})
