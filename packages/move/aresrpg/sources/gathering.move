// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// GATHERING — the §6 instant single-transaction harvest. One terminal `&Random` call: travel-verify to the node,
/// prove the job tool is equipped, roll the yield (scaling HARDER with job level — the level bonus replaces the
/// removed gather-time, §6/§18 annex §5), grant job XP (tier in-band rule), consume the node, roll the 2%
/// resource PROTECTOR, and mint the yield through the cap-gated door — locked into the gatherer's personal kiosk.
/// GOLDEN-GATHER (§6): after the yield mints, a resource with an authored rare-variant link (`world::rare_link`)
/// takes ONE extra 0.1% draw from the SAME rng; a hit mints ONE unit of the rare variant IN ADDITION (additive
/// jackpot) through the same door + emits a SEPARATE `RareGathered` event. The `rare_template` object rides in as a
/// gather param (the mint door needs the template object — no mint-by-id exists) and is asserted against the link
/// BEFORE the draw — a wrong/stale client aborts deterministically, never only on the jackpot roll (lead ruling).
///
/// EVERYTHING happens INSIDE the entry: `&Random` forbids any post-roll PTB command except transfers/merges, so
/// the mint+lock cannot be deferred to a later command — it composes in this call (the buy_many law). Refusals
/// come first (they cost only gas); no state mutates until every gate passes.
///
/// PROTECTOR AMBUSH (§17.22, WIRED 2026-07-11): the 2% protector roll now SPAWNS A REAL solo PvM fight vs the
/// passed defender `MobTemplate`, INTRA-call through `fight::create_protector_fight` (the engine composes from a
/// seed, consuming no `&Random`, so this stays a legal terminal `&Random` command — the roll + spawn are atomic and
/// UNDODGEABLE). The gather yield lands REGARDLESS (the guardian ambushes AFTER the harvest — reference-game semantics).
/// A gatherer with UNFINISHED BUSINESS (marked — an unresolved fight) SKIPS the spawn (can't be in two fights): the
/// yield still lands, no revert. `ProtectorTriggered.spawn_id` carries the fight handle (0 = skipped) so the indexer
/// locates the fight (derived from world + spawn_id). P1-1 (2026-07-12): the protector→resource MATCH is now
/// ON-CHAIN — `ResourceEntry.protector_template` pins the defender per node (seeded/`set_resource_protector`),
/// an unpinned node NEVER ambushes, and a pinned ambush ASSERTS the passed template (`EWrongProtector`) — the
/// client-chosen-defender hole (tier-lattice laundering) is closed. The fight still snapshots BASELINE spell
/// levels (raised_spell_ids empty) for now.
/// The yield now mints as ONE stacked `Item` of amount `quantity` through `character_link::mint_and_lock_resource`
/// (`extension::mint_item_stack` — the resource category STACKS), so the `quantity` event value and the minted
/// stack agree (S-11b items amendment; the old "ONE NFT + amount in the event only" seam is resolved).
module aresrpg::gathering;

use aresrpg::{character_link, config::{Self, GameConfig}, equipment, fight, mob_template::MobTemplate, version::Version, world::{Self, World}, zones};
use aresrpg::item::{Item, ItemTemplate};
use aresrpg_fight::{fight_registry::FightRegistry, version::Version as EngineVersion};
use aresrpg_foundation::job_xp;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{clock::Clock, event, kiosk::{Kiosk, KioskOwnerCap}, random::{Self, Random, RandomGenerator}, transfer_policy::TransferPolicy, tx_context::sender};

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const ENotInWorld: u64 = 101; // the character's world field is not this world (join it first)
const ENoCheckpoint: u64 = 102; // no checkpoint for this world (defensive — a joined character always has one)
const ETemplateMismatch: u64 = 103; // the passed ItemTemplate is not the one this resource node spawns
const ENoTool: u64 = 105; // the matching job tool is not equipped (also the honest state when NO equipment map exists yet — RIDER-3)
const ETierLocked: u64 = 106; // the character's job level is below the resource tier's unlock level
const ERareTemplateMismatch: u64 = 107; // golden-gather: the passed rare_template is not this resource's world-linked rare variant
const EWrongProtector: u64 = 108; // P1-1: the passed protector MobTemplate is not the one this resource's world row pins

// ╔════════════════ [ Yield / XP calibration (structure final; magnitudes are a harness SEAM) ] ═ ]
// The SHAPE is spec-fixed (§6/annex §5): yield gains a level bonus (job_level − required)/5; job XP is full
// in-band and decays once the gatherer out-levels the tier. The exact MAGNITUDES (the reference resource-XP table
// is not in the sealed annex) are S-21 harness calibration — pinned here as clearly-marked constants.
const YIELD_BONUS_DIV: u64 = 5; // annex §5: bonus = (job_level − required) / 5
const YIELD_BOOST: u64 = 1; // multiplier that scales the level bonus more aggressively (calibration placeholder)
const GATHER_XP_BASE: u64 = 10; // per-tier base gather XP unit (calibration placeholder)
const XP_BAND_WIDTH: u64 = 10; // one tier band = 10 job levels (tiers unlock every 10 levels)
const XP_OUT_OF_BAND_DIV: u64 = 2; // decay factor once the gatherer out-levels the tier band (never to zero)

// Golden-gather (§6): a FIXED per-gather jackpot rate — 0.1% (10 / 10_000 basis points) for any resource that has
// an authored rare-variant link. A fixed rate (no chance-stat / loot-multiplier scaling, unlike the
// legacy reference) — the loot-philosophy law: scarcity via rate, never throttles; the jackpot is purely additive.
const RARE_BP: u64 = 10;

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

/// The gather outcome. `quantity` is the computed yield (see the ONE-NFT seam — the event is its authoritative
/// home until items carries an amount field). `protector` records whether the ambush fired.
public struct ResourceGathered has copy, drop {
  world: ID,
  gatherer: address,
  template: ID,
  job: u8,
  tier: u8,
  quantity: u64,
  job_xp_gained: u64,
  protector: bool,
}

/// The resource-protector trigger (§17.22). `spawn_id` is the spawned ambush-fight's handle (the indexer derives
/// the Fight address from `world` + `spawn_id`); `spawn_id == 0` means the fight was SKIPPED (the gatherer was
/// already marked — an unresolved fight). The gather yield is granted regardless.
public struct ProtectorTriggered has copy, drop { world: ID, gatherer: address, template: ID, x: u32, z: u32, spawn_id: u64 }

/// GOLDEN-GATHER jackpot (§6): emitted IN ADDITION to `ResourceGathered` when a `RARE_BP` roll hits and the
/// world-linked rare variant is minted. A SEPARATE event so the base gather event shape is UNTOUCHED — the indexer
/// projects the jackpot without re-reading the existing shape.
public struct RareGathered has copy, drop { world: ID, gatherer: address, template: ID, rare_template: ID }

// ╔════════════════ [ GATHER (terminal &Random) ] ═════════════════════════════ ]

entry fun gather(
  world: &mut World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  zx: u32,
  zy: u32,
  node_index: u64,
  template: &ItemTemplate,
  rare_template: &ItemTemplate,
  policy: &TransferPolicy<Item>,
  registry: &mut FightRegistry,
  protector_template: &MobTemplate,
  engine_version: &EngineVersion,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
  r: &Random,
  ctx: &mut TxContext,
) {
  let mut gen = random::new_generator(r, ctx);
  gather_internal(world, kiosk, pkcap, character_id, zx, zy, node_index, template, rare_template, policy, registry, protector_template, engine_version, config, version, clock, &mut gen, ctx);
}

fun gather_internal(
  world: &mut World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  zx: u32,
  zy: u32,
  node_index: u64,
  template: &ItemTemplate,
  rare_template: &ItemTemplate,
  policy: &TransferPolicy<Item>,
  registry: &mut FightRegistry,
  protector_template: &MobTemplate,
  engine_version: &EngineVersion,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
  gen: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  config.assert_enabled();
  config.assert_domain(aresrpg::config::domain_gathering()); // S-46 kill-switch bit
  version.assert_enabled();
  let now = clock.timestamp_ms();
  let wid = object::id(world);
  let gatherer = sender(ctx);
  let owner_cap = personal_kiosk::borrow(pkcap);

  // 1) the live node (immutable) — snapshot its facts; the passed template MUST be the one it spawns
  let (nx, nz, njob, ntier, ntemplate) = zones::read_resource_node(world, zx, zy, node_index);
  assert!(ntemplate == object::id(template), ETemplateMismatch);

  // 2) character reads (immutable borrow) — membership, checkpoint, tool, pet, job level. All refusals here.
  let (cp, pet_both, job_level) = {
    let character = kiosk.borrow(owner_cap, character_id);
    assert!(character_link::in_world(character, wid), ENotInWorld);
    assert!(character_link::has_checkpoint(character, wid), ENoCheckpoint);
    // A fresh character has NO equipment-map DF yet (it is born on the FIRST equip); `tool_equipped_for`
    // short-circuits on that absence and returns false, so an un-equipped gatherer falls through to the
    // HONEST ENoTool refusal ("you need a tool") instead of a plumbing abort (RIDER-3).
    assert!(equipment::tool_equipped_for(character, njob), ENoTool);
    let cp = character_link::checkpoint(character, wid);
    // ×1.5 mount budget only when a pet was equipped at BOTH ends (stored snapshot AND now — §17.2)
    let pet_both = world::pet_equipped(&cp) && equipment::pet_equipped(character);
    let job_level = job_xp::level_from_xp(character_link::job_xp(character, njob));
    (cp, pet_both, job_level)
  };

  // 3) travel verification: you must have been able to WALK from your checkpoint to the node (teach-don't-reject)
  world::verify_travel(world, &cp, nx, nz, now, pet_both);

  // 4) tier gate — the node's tier must be unlocked for the gatherer's job level (§6)
  let required = job_xp::tier_to_level(ntier as u64);
  assert!(job_level >= required, ETierLocked);

  // 5) yield + XP (deterministic; §6 level bonus replaces gather time)
  let quantity = gather_yield(job_level, required);
  let gained_xp = gather_job_xp(ntier, job_level);

  // 6) protector roll (the only randomness) — fires at the world-template rate; yield is granted regardless.
  //    P1-1: the draw ALWAYS happens (rng-stream parity for the rare draw below), but only a node whose world
  //    row PINS a protector can actually ambush — no pin, no fight, no client choice.
  let ambush_rolled = protector_fires(world::protector_bp(world), gen);
  let pinned_protector = world::resource_protector(world, ntemplate);
  let protector = ambush_rolled && pinned_protector.is_some();

  // 7) WRITES — consume the node (world), then advance the checkpoint to the node + bank job XP (character)
  zones::consume_resource_node(world, zx, zy, node_index);
  {
    let character = kiosk.borrow_mut(owner_cap, character_id);
    let pet = equipment::pet_equipped(character);
    character_link::write_checkpoint(character, wid, world::new_checkpoint(nx, nz, now, pet), version);
    character_link::add_job_xp(character, njob, gained_xp, version);
  };

  // 8) mint the whole yield as ONE stacked resource item through the cap-gated door + lock into the gatherer's kiosk
  character_link::mint_and_lock_resource(template, quantity, version, kiosk, owner_cap, policy, ctx);

  // 8b) GOLDEN-GATHER (§6): if this resource has a linked rare variant, ONE extra RARE_BP draw from the SAME rng
  //     mints ONE unit of it IN ADDITION (jackpot-additive — never reduces the normal yield). No link ⇒ no draw.
  settle_rare(world, ntemplate, rare_template, gen, gatherer, wid, version, kiosk, owner_cap, policy, ctx);

  // 8c) PROTECTOR AMBUSH (§17.22): on trigger, spawn a SOLO PvM fight vs `protector_template` — INTRA-call (the
  //     engine composes from `group_seed`, consuming no `&Random`, so this stays a legal terminal command; the roll
  //     and spawn are ATOMIC + undodgeable). The yield ALREADY landed above. A MARKED gatherer (unresolved fight)
  //     SKIPS the spawn — can't be in two fights — so their harvest never reverts. `spawn_id` (0 = skipped) rides the
  //     event so the indexer locates the derived Fight.
  let protector_spawn_id = if (protector && gatherer_unmarked(kiosk, owner_cap, character_id)) {
    // P1-1: the seated defender MUST be the pinned one — the client can no longer cherry-pick a trivial mob.
    assert!(object::id(protector_template) == *pinned_protector.borrow(), EWrongProtector);
    let spawn_id = random::generate_u64(gen); // the ambush fight's per-world handle (identity)
    let group_seed = random::generate_u64(gen); // its mob-composition seed
    fight::create_protector_fight(registry, wid, spawn_id, world::seed(world), nx, nz, group_seed, kiosk, pkcap, character_id, protector_template, 1, config, version, engine_version, clock, ctx);
    spawn_id
  } else 0;

  // 9) events
  if (protector) event::emit(ProtectorTriggered { world: wid, gatherer, template: ntemplate, x: nx, z: nz, spawn_id: protector_spawn_id });
  event::emit(ResourceGathered { world: wid, gatherer, template: ntemplate, job: njob, tier: ntier, quantity, job_xp_gained: gained_xp, protector });
}

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

/// Yield quantity: base 1 + the §6 level bonus `(job_level − required)/5`, boosted (yield replaces gather time).
/// Caller guarantees `job_level ≥ required` (the tier gate) so the subtraction never underflows.
fun gather_yield(job_level: u64, required: u64): u64 {
  1 + (job_level - required) / YIELD_BONUS_DIV * YIELD_BOOST
}

/// Per-gather job XP: full in-band, decayed (never to zero) once the gatherer out-levels the tier's band (§6).
/// Magnitudes are the declared calibration seam; the in-band/out-of-band SHAPE is spec-final.
fun gather_job_xp(tier: u8, job_level: u64): u64 {
  let base = (tier as u64) * GATHER_XP_BASE;
  let band_top = job_xp::tier_to_level(tier as u64) + XP_BAND_WIDTH;
  if (job_level <= band_top) base else base / XP_OUT_OF_BAND_DIV
}

/// Does a `bp`-basis-point roll fire? A 0 rate never fires. Draws once from the threaded rng. Shared by the
/// protector ambush and the golden-gather jackpot — both are the same 0–9999 < bp draw.
fun protector_fires(bp: u64, gen: &mut RandomGenerator): bool {
  bp > 0 && random::generate_u64_in_range(gen, 0, 9999) < bp
}

/// Is the gatherer free of unfinished business? A MARKED character (unresolved PvM result / live seat) cannot be
/// seated into a protector ambush (`fight::mark_seated` would abort), so the caller SKIPS the spawn — the harvest
/// still completes. Read-only borrow through the holder's cap (ownership already proven by the outer gather gates).
fun gatherer_unmarked(kiosk: &Kiosk, owner_cap: &KioskOwnerCap, character_id: ID): bool {
  fight::is_unmarked(kiosk.borrow(owner_cap, character_id))
}

/// GOLDEN-GATHER settle (§6): read this resource's rare link. No link ⇒ NO draw, param inert (loot-philosophy —
/// the jackpot is purely additive, never a throttle). Linked ⇒ the presented `rare_template` MUST be the linked
/// variant (`ERareTemplateMismatch`) BEFORE the draw — a wrong/stale client aborts 100% deterministically (every
/// dry-run catches it), never only on the 0.1% jackpot where the abort would burn the player's winning gather
/// (lead ruling). Then ONE `RARE_BP` draw from the SAME rng; on a hit, mint via `mint_rare`. The extra draw exists
/// ONLY for rare-linked resources; the DF link stays the authority — a richer substitute template can never mint.
fun settle_rare(world: &World, base_tid: ID, rare_template: &ItemTemplate, gen: &mut RandomGenerator, gatherer: address, wid: ID, version: &Version, kiosk: &mut Kiosk, owner_cap: &KioskOwnerCap, policy: &TransferPolicy<Item>, ctx: &mut TxContext) {
  let link = world::rare_link(world, base_tid);
  if (link.is_none()) return;
  assert!(object::id(rare_template) == *link.borrow(), ERareTemplateMismatch);
  if (!protector_fires(RARE_BP, gen)) return;
  mint_rare(rare_template, base_tid, gatherer, wid, version, kiosk, owner_cap, policy, ctx);
}

/// Mint ONE unit of the (already-verified) linked rare variant through the SAME cap-gated door + kiosk-lock as the
/// normal yield, then emit `RareGathered`. Identity was asserted in `settle_rare` BEFORE the draw — the hit path
/// itself never aborts on template identity, so a won jackpot always mints.
fun mint_rare(rare_template: &ItemTemplate, base_tid: ID, gatherer: address, wid: ID, version: &Version, kiosk: &mut Kiosk, owner_cap: &KioskOwnerCap, policy: &TransferPolicy<Item>, ctx: &mut TxContext) {
  character_link::mint_and_lock_resource(rare_template, 1, version, kiosk, owner_cap, policy, ctx);
  event::emit(RareGathered { world: wid, gatherer, template: base_tid, rare_template: object::id(rare_template) });
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun gather_for_testing(
  world: &mut World,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  zx: u32,
  zy: u32,
  node_index: u64,
  template: &ItemTemplate,
  rare_template: &ItemTemplate,
  policy: &TransferPolicy<Item>,
  registry: &mut FightRegistry,
  protector_template: &MobTemplate,
  engine_version: &EngineVersion,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let mut gen = random::new_generator_for_testing();
  gather_internal(world, kiosk, pkcap, character_id, zx, zy, node_index, template, rare_template, policy, registry, protector_template, engine_version, config, version, clock, &mut gen, ctx);
}

#[test_only]
public fun test_yield(job_level: u64, required: u64): u64 { gather_yield(job_level, required) }

#[test_only]
public fun test_job_xp(tier: u8, job_level: u64): u64 { gather_job_xp(tier, job_level) }

#[test_only]
public fun test_protector_fires(bp: u64, gen: &mut RandomGenerator): bool { protector_fires(bp, gen) }

#[test_only]
public fun test_rare_bp(): u64 { RARE_BP }

#[test_only]
/// Force the golden-gather jackpot mint deterministically (bypass the `RARE_BP` draw): mints the rare + emits
/// `RareGathered` exactly as a live hit does. Template identity is `settle_rare`'s PRE-roll gate, not the mint's.
public fun test_mint_rare(rare_template: &ItemTemplate, base_tid: ID, gatherer: address, wid: ID, version: &Version, kiosk: &mut Kiosk, owner_cap: &KioskOwnerCap, policy: &TransferPolicy<Item>, ctx: &mut TxContext) {
  mint_rare(rare_template, base_tid, gatherer, wid, version, kiosk, owner_cap, policy, ctx)
}
