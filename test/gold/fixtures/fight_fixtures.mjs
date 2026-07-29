// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Gold-only deterministic fight corpus: 1 real seeded template + 6 real-identity mints. Each dedicated World
// has exactly one roster row. These objects live only on the disposable localnet and their ids are meant to be
// copied into the gold deployment manifest.
import { load_deps } from '../deps_gold.mjs'
import { log } from '../lib_gold.mjs'

const localnet_gas_ceiling = 1_000_000_000
const centered_resistance = 32_768
const world_zone_size = 32 // world::ZONE_SIZE_MIN; smaller values are clamped on-chain
// WORLD-ANCHOR DRIFT CONTAINMENT (R16_TAXONOMY B5 fixture-root, live-verified 2026-07-20): every fresh
// character's first-join spawn rolls INSIDE a box centered on the world (zones.move join_internal, D186 —
// bounds/2), and next_zone's search always spirals outward from there for the nearest UNDISCOVERED zone. A
// fixture world reused sequentially by many specs (multi_turn: 4 spec files × headed/lagged) burns a fresh
// zone per boot_fixture_world call, so the search radius grows over a run's lifetime. When an EARLIER call's
// fight is left orphaned (a forfeit self-guard refusal — the SAME species as the B1 bucket's stale-fight rows,
// e.g. fight 0xf9d0c731 on multi_turn, anchor (142,243) raw / (-114,-13) signed, confirmed live via
// /v1/fights?world=), its stale board anchor can be read during a LATER, unrelated engage many zones farther
// out — world_board_seat.js's D230 clamp (MAX_ANCHOR_DRIFT=64 blocks) then re-centers the board MID-ENGAGE,
// racing the mouse-click helper's aim (fight_mouse_helpers.ts click_cell — B5 dead-click). At the previous
// bounds (512, 256 zones) two live fixtures showed exactly this: multi_turn 86-160 blocks, aoe 132-257 blocks,
// all six R16 log lines traced to these two orphaned fights. Shrinking bounds does not eliminate the
// mechanism (an orphaned fight's own tear-down is a product-side fix, out of this fixture's reach) but bounds
// the BLAST RADIUS: 256 (8x8=64 zones) is ~3x the highest zone count observed for one fixture in a single
// stack's lifetime (multi_turn: 18) — ample search headroom — while roughly halving the worst-case any-zone-
// to-any-zone drift (512's max ≈724 blocks → 256's max ≈317). NOT a mathematical guarantee under the
// 64-block clamp in the pathological opposite-corner case; the click helper's own pointerup re-decode
// (fight_mouse_helpers.ts press_release_on_cell) is the robust half of this cure and does not depend on this
// number. Takes effect on the NEXT `up_gold.mjs` boot (world bounds are set once, at fixture creation).
const world_bounds = 256
// Density high enough that a <=6-block mouse-click target is reliably discoverable within boot_fixture_world's
// 6-attempt search loop (~94%/attempt at 24 groups → effectively certain), yet low enough that the on-chain
// search_zone derivation stays UNDER the SDK's fixed `SEARCH_ZONE_GAS_MIST` (400M MIST) budget ceiling. Measured
// on-chain (test/gold, 2026-07-16): 64=667M (blew the ceiling → InsufficientGas pre-flight refusal), 32=273M,
// 24=181M (2.2x headroom, mirrors the product's own ~2x margin), 16=73M. DENSITY_MAX (64) is NOT usable here —
// the client cannot afford to search it. Prod worlds default to 3-8 groups (world.move DEFAULT_MIN/MAX_GROUPS).
const world_group_density = 24

export const fixture_specs = [
  {
    // OPTION A — the real seeded template, referenced by corpus key. Info fields (hp/ap/mp/xp) mirror
    // seed/mainnet/01_first_shore/mobs.json:razkin for the manifest; the CHAIN truth is the seeded object.
    key: 'win',
    mode: 'seeded',
    seed_key: 'razkin', // Razkin L1-3 · HP 8-16 rolled · melee air 1 · dies to 1-3 Warcleaves
    biome: 'gold-training',
    world_seed: 0x474f4c4457494en,
    hp: 12,
    ap: 4,
    mp: 3,
    xp_reward: 2,
    level_band: [1, 3],
    lethal_damage: null,
  },
  {
    // OPTION B — real identity (name/level/hp/ap/mp/stats/element = the sir_rattlebone corpus row,
    // seed/mainnet/08_palewood/mobs.json), ONE overridden spell: a whole-board no-LOS nuke. Real kits max
    // out at 3 MP + range 4 — no real spell can settle defeat on wave 1 from an arbitrary spawn cell, and
    // the loss drive never plays a second turn. min_level == max_level pins HP at exactly base (no roll).
    key: 'loss',
    mode: 'mint',
    mob_name: 'Sir Rattlebone',
    biome: 'gold-doom',
    world_seed: 0x474f4c444c4f5353n,
    level: 38,
    hp: 700,
    ap: 4,
    mp: 3,
    element: 'el_earth',
    stats: { str: 77, earth_res: 30, air_res: -15 },
    xp_reward: 3260,
    lethal_damage: 5_000, // ×1.77 str amplify = 8850 — lethal at any resistance; headroom over class retunes
  },
  {
    // OPTION B — real identity (firesteel_golem corpus row, seed/mainnet/12_static_fields/mobs.json), inert
    // overrides: in_turn_beats aligns a push-into-trap formation, so the mob must never act/move/die.
    key: 'beats',
    mode: 'mint',
    mob_name: 'Firesteel Golem',
    biome: 'gold-beats',
    world_seed: 0x474f4c4442454154n,
    level: 67,
    hp: 10_000_000,
    ap: 0,
    mp: 0,
    element: 'el_fire',
    stats: { int: 95, fire_res: 40, earth_res: -20 },
    xp_reward: 2468,
    lethal_damage: null,
  },
  {
    // OPTION B — real Strawman identity (seed/mainnet/02_verdant_hollow/mobs.json): a low-HP earth "trash" mob,
    // minted with its REAL kit — base HP 30, 4 AP / 3 MP, str 16, earth_res 20 / air_res -10, and its real r1
    // earth melee spell (base 9), which preserves the WALK-IN and a visible ~3s counter wave each turn (≈10/player
    // turn after str amplify — ≤5 hits ≪ 300 core-class HP, non-lethal).
    // BUDGET ARITHMETIC (A8 root ①, the reason this row is Strawman, not the old Wolfling): the drive's
    // `click_damage_spell` priority arms Ghost Talon (tomoda, FIRE, AP 5) — the character's AP ceiling fits exactly
    // ONE cast per turn, a proven flat 6 damage into this mob's NEUTRAL fire resistance (trace-verified). 30 HP ÷ 6
    // = 5 player turns to a clamped-to-0 kill (fight_actions.js:115 `killed = new_health === 0`) — a 7-turn margin
    // inside the 12-turn drive cap, with ≥3 turns + ≥4 waves shown. The retired Wolfling (base HP 120) needed
    // ⌈120/6⌉ = 20 such turns: it could NEVER win inside the cap, so its own drive loop exhausted with the mob at
    // ~45% and no Victory dialog (the A8 red). fight_fixtures.test.mjs guards this budget so a future HP/cap drift
    // names itself.
    key: 'multi_turn',
    mode: 'mint',
    mob_name: 'Strawman',
    biome: 'gold-cycle',
    world_seed: 0x474f4c44435943n,
    level: 8, // Strawman's corpus band is L6-10; midpoint pin. HP is set explicitly below, so level is cosmetic here.
    hp: 30,
    ap: 4,
    mp: 3,
    element: 'el_earth',
    stats: { str: 16, earth_res: 20, air_res: -10 },
    spell: { damage: 9, ap: 4, rmin: 1, rmax: 1, los: true, cpt: 255, cpta: 255, cd: 0, crit: 10 },
    // xp is held at 123 (NOT Strawman's corpus 35): coop_kernel_test.mjs mirrors THIS exact value in its
    // xp_share_kernel proof (123 ÷ 3 seats, ×400/100 mult = 164). The win-budget fix is HP-only, so leaving xp
    // put keeps that unit↔rig mirror intact with zero cross-spec churn; the victory assert only reads `+N XP`.
    xp_reward: 123,
    lethal_damage: null,
  },
  {
    // OPTION B — a dedicated one-hit leveling Strawman, inert so bootstrap can earn (never administratively
    // write) the four full-kit characters' XP. The live gold dial applies once in settlement and again when the
    // result grants progression: 5,992,875 × 4 × 4 = 95,886,000, the EXACT L100 threshold. One mob and one solo
    // winner keep party division/aging out; boot fights it while the freshly authored mob is age-hour zero.
    key: 'coop_full_kit_leveler',
    mode: 'mint',
    mob_name: 'Strawman',
    biome: 'gold-level-100',
    world_seed: 0x474f4c444c564c31n,
    level: 1,
    hp: 1,
    ap: 0,
    mp: 0,
    element: 'el_earth',
    stats: {},
    xp_reward: 5_992_875,
    lethal_damage: null,
  },
  {
    // OPTION B — the full-kit sibling stays separate from multi_turn: one planted Strawman must survive every
    // once-only cast in the published L100 core-class catalog before cleanup begins. L100 UNLOCKS all 80 ids but
    // unallocated spells snapshot learned rank 1 (participant::spell_level's absent=1 law). The immutable corpus
    // at d6d32bcd:seed/mainnet/spells/{senshi,yajin,tomoda,shugo}.json has a 726 direct critical upper sum across
    // those levels[0] rows (269+179+204+74); 1,200 HP leaves 474 for DoT/push/order variance. Its one 5-base,
    // ALLMAP hit per mob turn deterministically reaches every shielded class; MP 0 keeps push-into-trap positioning
    // under the players' control. Cleanup stays bounded: rank-1 Quietus needs <=39 hits; four seats are faster.
    key: 'coop_full_kit',
    mode: 'mint',
    mob_name: 'Strawman',
    biome: 'gold-full-kit',
    world_seed: 0x474f4c44464b4954n,
    level: 1,
    hp: 1_200,
    ap: 1,
    mp: 0,
    element: 'el_earth',
    stats: {},
    spell: {
      damage: 5,
      ap: 1,
      rmin: 0,
      rmax: 64,
      los: false,
      cpt: 1,
      cpta: 1,
      cd: 0,
      crit: 0,
      area_shape: 'allmap',
    },
    xp_reward: 400,
    lethal_damage: null,
  },
  {
    // OPTION B — real Bonelet identity (seed/mainnet/01_first_shore/mobs.json), pinned in-band at level 7 with
    // the corpus stats (air_res -10 — the senshi's air cross-zone spell always lands >0). Inert (ap/mp 0 — the
    // aligned adjacency never drifts) and durable (10M hp — every AoE hp delta is measurable, nothing dies),
    // exactly the `beats` doctrine. `group: [2, 2]` is the one new lever: a TWO-mob group (the chain door is
    // add_mob_entry's own min/max-group params) so "every entity in the zone takes the effect" is a real plural
    // for the anchor AoE proof (aoe_zone.spec.ts) whatever geometry the board rolls.
    key: 'aoe',
    mode: 'mint',
    mob_name: 'Bonelet',
    biome: 'gold-aoe',
    world_seed: 0x474f4c44414f45n,
    level: 7,
    hp: 10_000_000,
    ap: 0,
    mp: 0,
    element: 'el_earth',
    stats: { int: 15, earth_res: 20, air_res: -10 },
    group: [2, 2],
    xp_reward: 30,
    lethal_damage: null,
  },
]

function require_ids(ids) {
  const required = ['LATEST_PACKAGE_ID', 'FOUNDATION_PACKAGE_ID', 'ENGINE_PACKAGE_ID', 'ADMIN_ARESRPG', 'VERSION']
  for (const key of required) if (!ids?.[key]) throw new Error(`fight fixtures: ids.${key} is required`)
}

function created_id(receipt, suffix) {
  return receipt.objectChanges?.find(
    (change) => change.type === 'created' && String(change.objectType ?? '').endsWith(suffix)
  )?.objectId
}

async function execute_transaction({ client, signer, transaction, label }) {
  transaction.setSenderIfNotSet(signer.getPublicKey().toSuiAddress())
  transaction.setGasBudget(localnet_gas_ceiling)
  const bytes = await transaction.build({ client })
  const dry_run = await client.dryRunTransactionBlock({ transactionBlock: bytes })
  if (dry_run.effects?.status?.status !== 'success')
    throw new Error(
      `fight fixtures: ${label} dryRun failed — refusing to guess a budget: ` +
        JSON.stringify(dry_run.effects?.status ?? null)
    )
  const gas = dry_run.effects.gasUsed ?? {}
  const net = Number(BigInt(gas.computationCost ?? 0) + BigInt(gas.storageCost ?? 0) - BigInt(gas.storageRebate ?? 0))
  const budget = Math.max(5_000_000, Math.ceil(net * 1.5))
  if (budget > localnet_gas_ceiling)
    throw new Error(`fight fixtures: ${label} derived gas ${budget} exceeds the 1-SUI localnet ceiling`)
  transaction.setGasBudget(budget)
  const receipt = await client.signAndExecuteTransaction({
    signer,
    transaction,
    options: { showEffects: true, showObjectChanges: true, showEvents: true },
  })
  await client.waitForTransaction({ digest: receipt.digest })
  if (receipt.effects?.status?.status !== 'success')
    throw new Error(
      `fight fixtures: ${label} executed but failed (${receipt.digest}): ` +
        `${receipt.effects?.status?.error ?? 'unknown chain failure'}`
    )
  return receipt
}

function empty_struct_vector(transaction, type) {
  return transaction.makeMoveVec({ type, elements: [] })
}

function mob_stats(transaction, foundation_package, stats = {}) {
  return transaction.moveCall({
    target: `${foundation_package}::spell::new_stats`,
    arguments: [
      stats.str ?? 0,
      stats.int ?? 0,
      stats.chance ?? 0,
      stats.agility ?? 0,
      0,
      0,
      0,
      centered_resistance + (stats.fire_res ?? 0),
      centered_resistance + (stats.water_res ?? 0),
      centered_resistance + (stats.earth_res ?? 0),
      centered_resistance + (stats.air_res ?? 0),
    ].map((value) => transaction.pure.u64(value)),
  })
}

function damage_spell(transaction, foundation_package, foundation_type_package, spec) {
  const spell = {
    ap: spec.ap,
    rmin: 0,
    rmax: 64,
    mod: false,
    line: false,
    los: false,
    free: false,
    cpt: 1,
    cpta: 1,
    cd: 0,
    crit: 0,
    ...(spec.spell ?? {}),
  }
  const damage_value = spell.damage ?? spec.lethal_damage
  const element = transaction.moveCall({
    target: `${foundation_package}::spell::${spec.element}`,
  })
  const effect_constant = (name) => transaction.moveCall({ target: `${foundation_package}::spell_effect::${name}` })
  const damage =
    spell.area_shape === 'allmap'
      ? transaction.moveCall({
          target: `${foundation_package}::spell_effect::new_effect`,
          arguments: [
            effect_constant('k_damage'),
            element,
            transaction.pure.u64(damage_value),
            effect_constant('shape_allmap'),
            transaction.pure.u64(0),
            effect_constant('tf_not_team'),
            transaction.pure.u8(100),
            transaction.pure.u8(0),
            transaction.pure.u8(0),
            transaction.pure.u8(0),
            effect_constant('phase_on_enter'),
          ],
        })
      : transaction.moveCall({
          target: `${foundation_package}::spell_effect::damage`,
          arguments: [element, transaction.pure.u64(damage_value)],
        })
  const effect_type = `${foundation_type_package}::spell_effect::Effect`
  return transaction.moveCall({
    target: `${foundation_package}::spell_effect::new_spell_level`,
    arguments: [
      transaction.pure.u16(1),
      transaction.pure.u64(spell.ap),
      transaction.pure.u64(spell.rmin),
      transaction.pure.u64(spell.rmax),
      transaction.pure.bool(spell.mod),
      transaction.pure.bool(spell.line),
      transaction.pure.bool(spell.los),
      transaction.pure.bool(spell.free),
      transaction.pure.u8(spell.cpt),
      transaction.pure.u8(spell.cpta),
      transaction.pure.u8(spell.cd),
      transaction.pure.u64(spell.crit),
      transaction.pure.bool(false),
      transaction.pure.vector('u16', []),
      transaction.pure.vector('u16', []),
      transaction.makeMoveVec({ type: effect_type, elements: [damage] }),
      empty_struct_vector(transaction, effect_type),
    ],
  })
}

function mob_spell_vector(transaction, ids, spec) {
  const foundation_package = ids.FOUNDATION_LATEST_PACKAGE_ID ?? ids.FOUNDATION_PACKAGE_ID
  const foundation_type_package = ids.FOUNDATION_TYPE_PACKAGE_ID ?? ids.FOUNDATION_PACKAGE_ID
  const spell_type = `${foundation_type_package}::spell_effect::SpellLevel`
  const damage_value = spec.spell?.damage ?? spec.lethal_damage
  if (damage_value === null || damage_value === undefined) return empty_struct_vector(transaction, spell_type)
  return transaction.makeMoveVec({
    type: spell_type,
    elements: [damage_spell(transaction, foundation_package, foundation_type_package, spec)],
  })
}

function build_fixture_objects(transaction, ids, spec) {
  const game_package = ids.LATEST_PACKAGE_ID
  const foundation_package = ids.FOUNDATION_LATEST_PACKAGE_ID ?? ids.FOUNDATION_PACKAGE_ID
  const engine_type_package = ids.ENGINE_TYPE_PACKAGE_ID ?? ids.ENGINE_PACKAGE_ID
  if (spec.mode === 'mint') {
    const mob_element = transaction.moveCall({
      target: `${foundation_package}::spell::${spec.element}`,
    })
    transaction.moveCall({
      target: `${game_package}::mob_template::mint`,
      arguments: [
        transaction.object(ids.ADMIN_ARESRPG),
        transaction.object(ids.VERSION),
        transaction.pure.string(spec.mob_name),
        transaction.pure.u16(spec.level),
        transaction.pure.u16(spec.level),
        transaction.pure.u64(spec.hp),
        transaction.pure.u64(spec.ap),
        transaction.pure.u64(spec.mp),
        mob_element,
        mob_stats(transaction, foundation_package, spec.stats),
        mob_spell_vector(transaction, ids, spec),
        empty_struct_vector(transaction, `${engine_type_package}::mob::MobLootEntry`),
        transaction.pure.u64(spec.xp_reward),
      ],
    })
  }
  transaction.moveCall({
    target: `${game_package}::world::create_world`,
    arguments: [
      transaction.object(ids.ADMIN_ARESRPG),
      transaction.object(ids.VERSION),
      transaction.pure.u64(spec.world_seed),
      transaction.pure.string(spec.biome),
    ],
  })
}

function build_world_authoring(transaction, ids, world_id, mob_template_id, group = [1, 1]) {
  const game_package = ids.LATEST_PACKAGE_ID
  const cap = () => transaction.object(ids.ADMIN_ARESRPG)
  const world = () => transaction.object(world_id)
  const version = () => transaction.object(ids.VERSION)
  const call = (name, arguments_) =>
    transaction.moveCall({
      target: `${game_package}::world::${name}`,
      arguments: arguments_,
    })

  call('set_required_level', [cap(), world(), transaction.pure.u16(1), version()])
  call('set_bounds', [
    cap(),
    world(),
    transaction.pure.u32(world_bounds),
    transaction.pure.u32(world_bounds),
    version(),
  ])
  call('set_zone_size', [cap(), world(), transaction.pure.u32(world_zone_size), version()])
  call('set_spawn_zone', [
    cap(),
    world(),
    transaction.pure.u32(world_zone_size),
    transaction.pure.u32(world_zone_size),
    version(),
  ])
  call('set_speed_budget', [cap(), world(), transaction.pure.u64(100_000), version()])
  call('set_density', [
    cap(),
    world(),
    transaction.pure.u16(world_group_density),
    transaction.pure.u16(world_group_density),
    transaction.pure.u16(0),
    transaction.pure.u16(0),
    version(),
  ])
  call('add_mob_entry', [
    cap(),
    world(),
    transaction.pure.id(mob_template_id),
    transaction.pure.u16(10_000),
    transaction.pure.u16(group[0]),
    transaction.pure.u16(group[1]),
    version(),
  ])
  call('set_mob_level', [cap(), world(), transaction.pure.id(mob_template_id), transaction.pure.u16(1), version()])
}

/**
 * Resolve 1 real seeded template, mint 6 real-identity matchups, and author one dedicated World per fixture.
 * No transaction is retried: any executed failure is returned as a hard boot failure with its digest.
 */
export async function create_fight_fixtures({ client, signer, ids, seeded_mobs }) {
  require_ids(ids)
  const { Transaction } = await load_deps()
  const fixtures = {}

  for (const spec of fixture_specs) {
    const seeded = spec.mode === 'seeded' ? seeded_mobs?.[spec.seed_key] : null
    if (spec.mode === 'seeded' && !seeded) {
      // The public active corpus deliberately omits this production-authored row. Dependent specs already
      // gate on fight_fixtures.win; the minted COOP fixtures remain available to the public CI rig.
      log(`fight fixtures: SKIP '${spec.key}' — '${spec.seed_key}' requires GOLD_CORPUS=mainnet`)
      continue
    }
    const create_transaction = new Transaction()
    build_fixture_objects(create_transaction, ids, spec)
    const create_receipt = await execute_transaction({
      client,
      signer,
      transaction: create_transaction,
      label: `${spec.key}:create`,
    })
    const mob_template_id =
      spec.mode === 'seeded' ? seeded.id : created_id(create_receipt, '::mob_template::MobTemplate')
    const mob_name = spec.mode === 'seeded' ? seeded.name : spec.mob_name
    const world_id = created_id(create_receipt, '::world::World')
    if (!world_id || (spec.mode === 'mint' && !mob_template_id))
      throw new Error(
        `fight fixtures: ${spec.key}:create ${create_receipt.digest} omitted ` +
          `${spec.mode === 'mint' ? 'MobTemplate or World' : 'World'} object changes`
      )

    const author_transaction = new Transaction()
    build_world_authoring(author_transaction, ids, world_id, mob_template_id, spec.group ?? [1, 1])
    const author_receipt = await execute_transaction({
      client,
      signer,
      transaction: author_transaction,
      label: `${spec.key}:author`,
    })
    fixtures[spec.key] = {
      outcome:
        spec.key === 'beats' || spec.key === 'aoe'
          ? 'durable'
          : spec.key === 'multi_turn' || spec.key === 'coop_full_kit_leveler' || spec.key === 'coop_full_kit'
            ? 'win'
            : spec.key,
      world_id,
      world_seed: spec.world_seed.toString(),
      world_biome: spec.biome,
      zone_size: world_zone_size,
      density: { groups: world_group_density, resources: 0 },
      mob_template_id,
      mob_name,
      mob_hp: spec.hp,
      mob_ap: spec.ap,
      mob_mp: spec.mp,
      mob_spell_damage: spec.spell?.damage ?? null,
      mob_spell_area_shape: spec.spell?.area_shape ?? null,
      group: spec.group ?? [1, 1],
      xp_reward: spec.xp_reward,
      lethal_damage: spec.lethal_damage,
      mob_source: spec.mode === 'seeded' ? 'seeded' : 'minted',
      ...(spec.mode === 'seeded' ? { level_band: spec.level_band } : {}),
      create_digest: create_receipt.digest,
      author_digest: author_receipt.digest,
    }
  }

  return fixtures
}
