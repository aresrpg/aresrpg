// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// RESULTS — the CORE half of claims v2 (S-46 final split): the engine's permissionless settlement minted a
/// brand-echoing soulbound `FightOutcome` per seat; THIS module is where game truth lands. `open` consumes the
/// outcome, ASSERTS THE BRAND (compile-time self-authentication — only outcomes of fights created through
/// core's own doors are honored), lands the XP/HP write-backs + the dirty-counter decrement on the kiosk-
/// borrowed character, rolls the loot checklist (terminal `&Random`, this call's own entropy), and mints the
/// core `FightResult` claim ticket. `mint_rolled` (per template) + `burn_result` are verbatim claims v2.
///
/// DEFEAT outcomes carry xp 0 / empty table (§7 defeat costs only time) — opening one just writes back HP.
module aresrpg::results;

use aresrpg::{character_link, config::GameConfig, version::Version, fight};
use aresrpg::{extension, item::{Self, Item, ItemTemplate}};
use aresrpg_fight::{fight_latch::FightLatch, mob, mob::MobLootEntry, settlement::{Self, FightOutcome}};
use aresrpg_foundation::prng;
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{clock::Clock, dynamic_field as df, event, kiosk::Kiosk, random::{Self, Random, RandomGenerator}, transfer_policy::TransferPolicy};

// (102 EAlreadyOpened / 103 ENotOpened retired — engine unpack is one-shot; codes stay reserved in the error map)
const ENoMatching: u64 = 104; // mint_rolled: nothing owed for this template
const ENotEmpty: u64 = 105; // burn: rolled loot remains — mint it first
const EWrongBrand: u64 = 106; // open: the outcome was NOT minted under core's own FightBrand — refused

const BP_ONE: u64 = 10_000; // 100.00%

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The OPENED claim ticket — SOULBOUND (`key` only): what the roll owes, mintable per template, then burned.
public struct FightResult has key {
  id: UID,
  fight: ID,
  world: ID,
  character: ID,
  outcome: u8,
  final_hp: u64,
  xp_share: u64,
  pvp: bool,
  team: u8,
  winner_team: Option<u8>,
  rolled: vector<RolledLoot>,
}

public struct RolledLoot has copy, drop, store { item_template: ID, qty: u64 }

/// #758 — the ticket's STAT-ROLL entropy, planted as a dynamic field on the `FightResult` UID at `open` (the one
/// moment this claim touches `&Random`) and spent at `mint_rolled`, where the template object finally exists but
/// no randomness does. A DF, not a struct field: the layout of a live `key` struct is frozen across upgrades.
/// Tickets opened BEFORE this shipped carry no seed — they mint blank, exactly as they did before (honest, never
/// a fabricated roll).
public struct StatSeedKey has copy, drop, store {}

// ── claim events (core-side; the engine emits the settlement events) ──
public struct ResultOpened has copy, drop { result: ID, character: ID, xp_share: u64, loot_units: u64 }
public struct LootMinted has copy, drop { result: ID, item_template: ID, qty: u64 }
public struct ResultBurned has copy, drop { result: ID }

// ╔════════════════ [ Open (terminal &Random — brand-assert, write-backs, roll) ] ═ ]

/// Open your outcome: assert the BRAND, land the HP/XP write-backs + the dirty-counter decrement on YOUR
/// character (kiosk-borrowed by the outcome's OWN character id — the binding is structural), roll the loot
/// checklist, and mint the `FightResult` claim ticket to yourself. Once, anytime, no deadline. Terminal `&Random`.
entry fun open(
  outcome: FightOutcome,
  latch: &mut FightLatch,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
  r: &Random,
  ctx: &mut TxContext,
) {
  let mut gen = random::new_generator(r, ctx);
  y131(outcome, latch, kiosk, pkcap, config, version, clock.timestamp_ms(), &mut gen, ctx);
}

/// PTB-composition twin of `open` (`entry` cannot consume a prior command's result): ONE tx chains
/// `settlement::settle_and_take → (a consumer's &outcome read, e.g. dungeon::settle_run(&o))? → open_taken(o)` — the
/// historical two-tx settle→open gap (the 2026-07-10 stranded-outcome wedge) becomes unreachable for the
/// active player. Semantics identical to `open`; keep it the LAST command (&Random terminal law).
/// public+&Random is grind-safe here: the roll lands only in a transferred soulbound `FightResult` and events —
/// neither readable by a wrapping module in-tx, so a composer cannot observe-then-abort on the outcome.
#[allow(lint(public_random))]
public fun open_taken(
  outcome: FightOutcome,
  latch: &mut FightLatch,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  config: &GameConfig,
  version: &Version,
  clock: &Clock,
  r: &Random,
  ctx: &mut TxContext,
) {
  let mut gen = random::new_generator(r, ctx);
  y131(outcome, latch, kiosk, pkcap, config, version, clock.timestamp_ms(), &mut gen, ctx);
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
fun y131(
  outcome: FightOutcome,
  latch: &mut FightLatch,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  config: &GameConfig,
  version: &Version,
  now_ms: u64,
  gen: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  config.assert_enabled();
  version.assert_enabled();
  assert!(settlement::brand(&outcome) == aresrpg::fight::y45(), EWrongBrand);
  settlement::release_latch(latch, &outcome);
  // THE BRAND ASSERT — the whole trust mechanism: only outcomes of fights created through core's own doors
  // (aresrpg::fight's private FightBrand witness) are honored. A foreign consumer's outcome is refused here.
  let (brand, fight, world, character_id, outcome_status, final_hp, xp_share, aged_bp, chance, mob_count, loot, pvp, team, winner_team, loot_mult) =
    settlement::unpack(outcome);
  assert!(brand == aresrpg::fight::y45(), EWrongBrand);

  // write-backs FIRST (§17.23 — the fight's outcome reaches the character even if the roll lands nothing)
  if (!pvp) {
    // §17.9: an ephemeral (PvP) fight NEVER touches the real character — no XP grant, no HP write-back.
    // The kiosk borrow lives INSIDE the guard: an ephemeral seat's character need not be in THIS kiosk, and
    // borrowing it unconditionally aborts (kiosk EItemNotFound) before the roll ever runs.
    let owner_cap = personal_kiosk::borrow(pkcap);
    let character = kiosk.borrow_mut(owner_cap, character_id);
    if (xp_share > 0) character_link::y12(config, character, xp_share, version);
    character_link::y13(character, final_hp, now_ms, version);
    // the unfinished-business counter decrements HERE and only here — the truth landed, the character is free
    // to fight and to sell again.
    fight::clear(character, version);
  };

  // roll the checklist: the table once PER KILLED MOB, chance/aging/multiplier scaled (empty table on defeat)
  let mut rolled: vector<RolledLoot> = vector[];
  let mut m = 0;
  while (m < mob_count) {
    let mut e = 0;
    while (e < loot.length()) {
      let one = y135(gen, loot.borrow(e), chance, aged_bp, loot_mult);
      if (one.is_some()) y137(&mut rolled, one.destroy_some()) else one.destroy_none();
      e = e + 1;
    };
    m = m + 1;
  };
  let units = y138(&rolled);
  let mut result = FightResult { id: object::new(ctx), fight, world, character: character_id, outcome: outcome_status, final_hp, xp_share, pvp, team, winner_team, rolled };
  // the stat-roll entropy for whatever gear this ticket owes — drawn HERE, off the same `&Random` stream that
  // rolled the checklist, because `mint_rolled` has none (#758).
  df::add(&mut result.id, StatSeedKey {}, random::generate_u64(gen));
  event::emit(ResultOpened { result: object::id(&result), character: character_id, xp_share, loot_units: units });
  transfer::transfer(result, ctx.sender());
}

// ╔════════════════ [ Mint the rolled loot (per template) ] ═══════════════════ ]

/// Mint what the roll owes for ONE template into the result-holder's personal kiosk (LockPledge law). Stackables mint
/// as ONE stack of the owed qty; gear mints qty singletons, each born with its rolled stat block (#758). Only the
/// result's owner can call (owned object).
entry fun mint_rolled(
  result: &mut FightResult,
  template: &ItemTemplate,
  version: &Version,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  policy: &TransferPolicy<Item>,
  ctx: &mut TxContext,
) {
  y132(result, template, version, kiosk, pkcap, policy, ctx);
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// The mint body, returning the minted item ids (the `entry` discards them; tests assert on them).
fun y132(
  result: &mut FightResult,
  template: &ItemTemplate,
  version: &Version,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  policy: &TransferPolicy<Item>,
  ctx: &mut TxContext,
): vector<ID> {
  version.assert_enabled();
  let tid = item::template_id(template);
  let qty = y136(result, tid); // aborts ENoMatching if nothing owed
  let owner_cap = personal_kiosk::borrow(pkcap);
  let mut minted = vector<ID>[];
  if (item::is_stackable_category(item::template_category(template))) {
    let (stack, pledge) = extension::y30(template, qty, version, ctx);
    minted.push_back(object::id(&stack));
    item::lock_in_kiosk(pledge, stack, kiosk, owner_cap, policy);
  } else {
    let base = y133(result);
    let mut i = 0;
    while (i < qty) {
      let seed = if (base.is_some()) option::some(y134(*base.borrow(), tid, i)) else option::none();
      let (loot_item, pledge) = extension::y29(template, seed, version, ctx);
      minted.push_back(object::id(&loot_item));
      item::lock_in_kiosk(pledge, loot_item, kiosk, owner_cap, policy);
      i = i + 1;
    };
  };
  event::emit(LootMinted { result: object::id(result), item_template: tid, qty });
  minted
}

/// Delete an EMPTIED result (the storage rebate). Aborts while rolled loot remains — mint it first.
entry fun burn_result(mut result: FightResult) {
  assert!(result.rolled.is_empty(), ENotEmpty);
  // the stat seed dies with its ticket — a UID with a live dynamic field cannot be deleted. Pre-#758 tickets
  // carry none, hence the existence check.
  if (df::exists(&result.id, StatSeedKey {})) { let _: u64 = df::remove(&mut result.id, StatSeedKey {}); };
  let FightResult { id, fight: _, world: _, character: _, outcome: _, final_hp: _, xp_share: _, pvp: _, team: _, winner_team: _, rolled: _ } = result;
  event::emit(ResultBurned { result: id.to_inner() });
  object::delete(id);
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// This ticket's open-time stat entropy, or NONE for a ticket opened before #758 shipped (it mints blank gear —
/// the same honestly-empty block it would have had, never a fabricated one).
fun y133(result: &FightResult): Option<u64> {
  if (df::exists(&result.id, StatSeedKey {})) option::some(*df::borrow(&result.id, StatSeedKey {}))
  else option::none()
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// The per-unit stat seed: the ticket's own entropy folded with the template id and the unit index. DERIVED, never
/// a running counter — unit `i` of template `t` always rolls the same block, so a holder cannot shop the mint
/// ORDER of the templates they owe to steer a good roll onto the item they care about.
fun y134(base: u64, template: ID, index: u64): u64 {
  let bytes = object::id_to_bytes(&template);
  let mut acc = base;
  let mut i = 0;
  while (i < bytes.length()) {
    acc = prng::mix(acc, bytes[i] as u64);
    i = i + 1;
  };
  prng::mix(acc, index)
}

// ╔════════════════ [ Roll kernels (pure — harvested from dungeon_claim, aging-scaled) ] ═ ]

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// One loot entry roll: effective_bp = min(10000, chance_bp × (700+claimer_chance)/700); on a hit, quantity in
/// [min,max] scaled by aging ×(10000+aged_bp)/10000 and the loot multiplier ×mult/100.
/// Drawn from the FRAMEWORK generator, never the mulberry32 carrier: this is a money decision, nothing in
/// @aresrpg/sim mirrors it, and the carrier exists only to keep the fight twins byte-identical. `generate_u64_in_range`
/// is the unbiased primitive — the hand-rolled `draw % n` it replaces skewed both the hit and the quantity, and
/// the seed it drew from was truncated to 32 bits on the way in.
fun y135(gen: &mut RandomGenerator, entry: &MobLootEntry, claimer_chance: u64, aged_bp: u64, loot_mult: u64): Option<RolledLoot> {
  let effective_bp = loot_effective_bp(mob::loot_entry_chance_bp(entry) as u64, claimer_chance);
  if (random::generate_u64_in_range(gen, 0, BP_ONE - 1) >= effective_bp) return option::none();
  let min_q = mob::loot_entry_min_qty(entry) as u64;
  let max_q = mob::loot_entry_max_qty(entry) as u64;
  let base = if (max_q > min_q) random::generate_u64_in_range(gen, min_q, max_q) else min_q;
  let qty = base * (BP_ONE + aged_bp) / BP_ONE * loot_mult / 100;
  option::some(RolledLoot { item_template: mob::loot_entry_item_template(entry), qty: if (qty < 1) 1 else qty })
}

/// The chance-boosted drop bp (harvested kernel), capped at 100%.
public fun loot_effective_bp(chance_bp: u64, claimer_chance: u64): u64 {
  let e = chance_bp * (700 + claimer_chance) / 700;
  if (e > BP_ONE) BP_ONE else e
}

// ╔════════════════ [ Checklist helpers ] ════════════════════════════════════ ]

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
/// Remove + return the owed qty for `template` from the rolled checklist. Aborts if none.
fun y136(result: &mut FightResult, template: ID): u64 {
  let list = &mut result.rolled;
  let mut idx = option::none();
  let mut i = 0;
  while (i < list.length()) {
    if (list.borrow(i).item_template == template) { idx = option::some(i); break };
    i = i + 1;
  };
  assert!(idx.is_some(), ENoMatching);
  let RolledLoot { item_template: _, qty } = list.remove(idx.destroy_some());
  qty
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
fun y137(rolled: &mut vector<RolledLoot>, loot: RolledLoot) {
  let n = rolled.length();
  let mut i = 0;
  while (i < n) {
    let e = rolled.borrow_mut(i);
    if (e.item_template == loot.item_template) { e.qty = e.qty + loot.qty; return };
    i = i + 1;
  };
  rolled.push_back(loot);
}

// name shortened 2026-07-27: aresrpg at Sui object-size ceiling (republish restructure); see the #1315 landing
fun y138(rolled: &vector<RolledLoot>): u64 {
  let mut u = 0;
  let mut i = 0;
  while (i < rolled.length()) { u = u + rolled.borrow(i).qty; i = i + 1; };
  u
}

// ╔════════════════ [ Reads (RPC + tests) ] ═════════════════════════════════ ]

public fun outcome(result: &FightResult): u8 { result.outcome }
public fun final_hp(result: &FightResult): u64 { result.final_hp }
public fun xp_share(result: &FightResult): u64 { result.xp_share }
#[test_only]
public fun is_pvp(result: &FightResult): bool { result.pvp }
public fun team(result: &FightResult): u8 { result.team }
public fun winner_team(result: &FightResult): Option<u8> { result.winner_team }
public fun character(result: &FightResult): ID { result.character }
public fun fight_id(result: &FightResult): ID { result.fight }

/// The owed qty for `template` after the roll (0 if none) — the client builds mint txs from this.
public fun rolled_qty(result: &FightResult, template: ID): u64 {
  let list = &result.rolled;
  let mut i = 0;
  while (i < list.length()) {
    if (list.borrow(i).item_template == template) return list.borrow(i).qty;
    i = i + 1;
  };
  0
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
/// `mint_rolled` returning the minted ids, so a test can read the born-rolled stat block off the kiosk.
public fun mint_rolled_for_testing(
  result: &mut FightResult,
  template: &ItemTemplate,
  version: &Version,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  policy: &TransferPolicy<Item>,
  ctx: &mut TxContext,
): vector<ID> {
  y132(result, template, version, kiosk, pkcap, policy, ctx)
}

#[test_only]
public fun open_for_testing(
  outcome: FightOutcome,
  latch: &mut FightLatch,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  config: &GameConfig,
  version: &Version,
  now_ms: u64,
  ctx: &mut TxContext,
) {
  let mut gen = random::new_generator_from_seed_for_testing(vector[42u8]);
  y131(outcome, latch, kiosk, pkcap, config, version, now_ms, &mut gen, ctx);
}
