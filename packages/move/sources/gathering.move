// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// GATHERING — the instant single-transaction harvest (legacy law, carried whole). ONE NODE
/// per transaction (owner 2026-08-10): prove the walk to the pack, prove the matching job
/// tool is equipped (ANY tool of the type — tool level never gates), gate the node's tier
/// against the JOB level, roll the yield off the job level, bank job xp, consume the node,
/// then the two jackpot draws from the SAME rng: GOLDEN-GATHER (0.1% — a resource with an
/// authored rare link mints ONE rare unit IN ADDITION) and the PROTECTOR (2% — the row's
/// pinned mob ambushes into a real solo fight; the yield lands FIRST, the ambush never eats
/// the harvest). Both templates are asserted against the world row BEFORE any draw — a
/// wrong client aborts deterministically, never only on the jackpot.
///
/// A character already fighting cannot gather BY CONSTRUCTION: fight custody means it is
/// not in the kiosk — legacy's whole "unfinished business" marking machinery evaporates.
///
/// JOB XP banks through progression (the one job-xp home — crafting is the other writer);
/// levels come off the immutable `job_xp` curve.
module aresrpg::gathering;

use aresrpg_seed::item_rows::{Self, ItemTemplate};
use aresrpg::{
  character::Character,
  equipment,
  fight,
  item::{Self, Item},
  progression,
  protected_policy::AresRPG_TransferPolicy,
  world,
  zone,
};
use aresrpg_seed::{mob_rows::MobTemplate, spell_rows::SpellTemplate, board_catalog::BoardCatalog, world_content::{Self, WorldContent}};
use aresrpg_math::{job_xp, mob_data, world_map};
use std::string::String;
use sui::{
  clock::Clock,
  dynamic_field as dfield,
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  random::RandomGenerator,
  transfer_policy::TransferPolicy,
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EWrongWorld: u64 = 2201; // the pack lives in another world
const ETemplateMismatch: u64 = 2202; // the passed ItemTemplate is not what this pack spawns
const ENoTool: u64 = 2203; // the matching job tool is not equipped
const ETierLocked: u64 = 2204; // the job level is below the resource tier's unlock level
const ERareMismatch: u64 = 2205; // the passed rare template is not the row's linked variant
const EWrongProtector: u64 = 2206; // the passed MobTemplate is not the row's pinned protector
const ENoAmbush: u64 = 2207; // resolve_ambush: no fired verdict is pending on this character

const RARE_BP: u64 = 10; // golden-gather: 0.1% — fixed, additive, never a throttle
const PROTECTOR_BP: u64 = 200; // the 2% protector law

/// The pending-verdict root: far enough that only `resolve_ambush` ever unroots (~100 years).
const ROOT_UNTIL_RESOLVED_MS: u64 = 3_153_600_000_000;

// The reference formulas (GatheringFormulas.java via the balance framework A.3, ported
// EXACT — owner 2026-08-10: keep the hytale numbers):
//   gatherTime(jl)  = max(2s, 12s − 10s × (jl−1)/99)  — the rooting duration
//   qty roll        ∈ [1 + 5×(jl−1)/99, max(lo, 2 + (jl−req)/5)]
//   gatherXp(req)   = 10 + req/2  — off the RESOURCE's required level, every gather
// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The GAS-UNIFORM ambush verdict (Sui `&Random` law, owner 2026-08-10: every outcome must
/// cost the SAME gas — an expensive in-line ambush could be aborted out-of-gas and
/// re-rolled). EVERY gather writes this fixed-shape DF, fire or not; a `fires` verdict
/// roots the character until `resolve_ambush` — a second transaction with NO randomness,
/// so aborting it re-rolls nothing. `hp` snapshots the gather moment: waiting rooted to
/// regen buys nothing.
public struct AmbushKey() has copy, drop, store;

public struct PendingAmbush has copy, drop, store {
  fires: bool,
  protector: String, // the row's pinned mob_type (same bytes on both outcomes of a node)
  x: u32,
  z: u32,
  scalar: u8, // the mob's level scalar — drawn at gather, zone-ramped
  board_seed: u64, // the fight board — drawn at gather, nothing left to re-roll
  hp: u64, // the gatherer's hp at the gather — the fight seats min(this, live)
}

public struct ResourceGathered has copy, drop {
  world: String,
  x: u32,
  z: u32,
  gatherer: address,
  item_type: String,
  tier: u8,
  quantity: u64,
  job_xp_gained: u64,
  protector: bool,
}

/// The golden-gather jackpot — SEPARATE from the base event so its shape stays untouched.
/// Both carry their anchor so the realtime layer routes them to the ZONE channel — presence
/// spam never rides a world-global wire.
public struct RareGathered has copy, drop { world: String, x: u32, z: u32, gatherer: address, item_type: String, rare_item_type: String }

// ╔════════════════ [ The gather door ] ══════════════════════════════════════ ]

public(package) fun gather(
  zone_object: &mut zone::Zone,
  world_content: &WorldContent,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  pack_index: u64,
  template: &ItemTemplate,
  rare_template: &ItemTemplate,
  existing: Option<ID>, // the gatherer's held stack of this resource — the yield merges in
  existing_rare: Option<ID>, // ditto for the rare variant
  item_policy: &TransferPolicy<Item>,
  generator: &mut RandomGenerator,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  // The live pack (a read — remaining nodes asserted) and its authored row.
  let pack = zone::resource_pack_at(zone_object, world_content, pack_index);
  let item_type = pack.pack_item_type();
  let row = world_map::resource_row_of(world_content::data(world_content), item_type);
  assert!(item_rows::template_type(template) == item_type, ETemplateMismatch);

  // Gates on the character, then the job-xp write — all refusals before any state moves.
  let (quantity, gained_xp, protector) = {
    let character: &mut Character = kiosk.borrow_mut(cap, character_id);
    let current = world::prove_move(character, pack.pack_x(), pack.pack_z(), clock);
    assert!(current == zone::world_name(zone_object), EWrongWorld);
    let job = row.resource_row_job();
    assert!(equipment::tool_of(character) == job_xp::gathering_tool(&job), ENoTool);

    let job_level = progression::job_level_of(character, job);
    let required = job_xp::tier_to_level(row.resource_row_tier() as u64);
    assert!(job_level >= required, ETierLocked);

    // ONE yield roll in the reference band: both bounds climb with the job level.
    let (min_quantity, max_quantity) = job_xp::gather_quantity_bounds(job_level, required);
    let quantity = generator.generate_u64_in_range(min_quantity, max_quantity);

    // THE PROTECTOR VERDICT — gas-uniform by construction (Sui `&Random` law): every draw
    // happens and the SAME fixed-shape verdict writes on BOTH outcomes, so no gas budget
    // can tell a fired ambush from a quiet gather and abort it into a re-roll. The fight
    // itself spawns in `resolve_ambush` — a later tx with nothing left to re-roll.
    let ambush_rolled = generator.generate_u64_in_range(0, 9999) < PROTECTOR_BP;
    let protector = ambush_rolled && !row.resource_row_protector().is_empty();
    let (level_lo, level_hi) = zone::level_bounds(zone_object);
    let scalar = level_lo + generator.generate_u64_in_range(0, level_hi - level_lo);
    let board_seed = generator.generate_u64();
    let hp = progression::touch(character, clock);
    write_ambush_verdict(character, PendingAmbush {
      fires: protector,
      protector: row.resource_row_protector(),
      x: pack.pack_x(),
      z: pack.pack_z(),
      scalar: scalar as u8,
      board_seed,
      hp,
    });

    let gained_xp = job_xp::gather_xp(required);
    progression::bank_job_xp(character, job, gained_xp);
    // GATHER TIME roots the gatherer; a fired verdict roots UNTIL RESOLVED — same stamp,
    // same gas, different horizon.
    let root = if (protector) ROOT_UNTIL_RESOLVED_MS else job_xp::gather_time_ms(job_level);
    world::delay_checkpoint(character, root, clock);
    (quantity, gained_xp, protector)
  };

  // WRITES: one node leaves the pack, the yield lands in the kiosk (merged or fresh).
  zone::consume_resource_node(zone_object, world_content, pack_index);
  item::deposit(kiosk, cap, item_policy, existing, item::mint(template, quantity as u32, generator, ctx));

  // GOLDEN-GATHER: identity asserted BEFORE the draw — a won jackpot always mints.
  let rare = row.resource_row_rare();
  if (!rare.is_empty()) {
    assert!(item_rows::template_type(rare_template) == rare, ERareMismatch);
    if (generator.generate_u64_in_range(0, 9999) < RARE_BP) {
      item::deposit(kiosk, cap, item_policy, existing_rare, item::mint(rare_template, 1, generator, ctx));
      event::emit(RareGathered { world: zone::world_name(zone_object), x: pack.pack_x(), z: pack.pack_z(), gatherer: ctx.sender(), item_type, rare_item_type: rare });
    };
  };

  event::emit(ResourceGathered {
    world: zone::world_name(zone_object),
    x: pack.pack_x(),
    z: pack.pack_z(),
    gatherer: ctx.sender(),
    item_type,
    tier: row.resource_row_tier(),
    quantity,
    job_xp_gained: gained_xp,
    protector,
  });
}

/// Face the pending protector: the ONLY exit from a fired verdict's root. No randomness —
/// everything was drawn at the gather; aborting this transaction re-rolls nothing, the
/// obligation persists. Seats the gatherer at min(gather-moment hp, live hp): waiting
/// rooted to regen buys nothing.
public(package) fun resolve_ambush(
  protected: &AresRPG_TransferPolicy<Character>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  protector_template: &MobTemplate,
  catalog: &BoardCatalog,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  let verdict = {
    let character: &mut Character = kiosk.borrow_mut(cap, character_id);
    let uid = character.uid_mut();
    assert!(dfield::exists(uid, AmbushKey()), ENoAmbush);
    let pending: &mut PendingAmbush = dfield::borrow_mut(uid, AmbushKey());
    assert!(pending.fires, ENoAmbush);
    pending.fires = false;
    let verdict = *pending;
    // unroot — the fight's own admission re-proves the (zero-distance) walk to the node
    world::delay_checkpoint(character, 0, clock);
    verdict
  };
  assert!(mob_data::mob_type(protector_template.data()) == verdict.protector, EWrongProtector);
  fight::ambush(
    protected,
    kiosk,
    cap,
    character_id,
    verdict.x,
    verdict.z,
    protector_template,
    verdict.scalar as u64,
    verdict.board_seed,
    verdict.hp,
    catalog,
    clock,
    ctx,
  );
}

/// Is a FIRED verdict pending? The character-delete door refuses while true (audit
/// 2026-08-10: deleting the character was the last way to dodge the protector — the yield
/// lives in the kiosk and would have survived the dodge).
public(package) fun has_fired_verdict(character: &Character): bool {
  let uid = character.uid();
  dfield::exists(uid, AmbushKey()) &&
    dfield::borrow<AmbushKey, PendingAmbush>(uid, AmbushKey()).fires
}

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

// write_verdict
/// Overwrite-or-add the verdict DF — the same bytes land on both outcomes (the gas law).
fun write_ambush_verdict(character: &mut Character, verdict: PendingAmbush) {
  let uid = character.uid_mut();
  if (dfield::exists(uid, AmbushKey())) {
    *dfield::borrow_mut(uid, AmbushKey()) = verdict;
  } else {
    dfield::add(uid, AmbushKey(), verdict);
  }
}
