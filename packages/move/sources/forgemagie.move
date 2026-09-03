// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// FORGEMAGIE — runes onto gear. Two lanes, both stateless (owner 2026-08-11: no taux economy,
/// no shared board, no admin door): the frozen math lives in `aresrpg_math::{forge, rune_catalog}`,
/// this module is the thin custody shell that composes the shipped item doors.
///
///   • SCRIBE (`scribe`) — apply ONE rune to a kiosk-held gear item. The rune is a stackable
///     item whose `item_type` maps to its catalog coords (`rune_of`); exactly 1 unit burns
///     BEFORE the roll (identical write-set every outcome). Gate: the gear's CATEGORY names its
///     forgery job (owner: "its category defines the job to scribe"); that job must be ≥ 70. The
///     3-outcome puits gamble runs off `apply_rune`; the new rolled block + the per-item
///     `ForgeState` DF (puits + application counts) are written; job xp banks on the forgery job.
///
///   • CRUSH (`crush` → `redeem_rune` → `discard_claim`) — destroy gear, yield runes. STATELESS +
///     LINEAR + LOSSY (`crush_lines`), no coefficient, no bracket. Two-phase and GAS-UNIFORM: phase 1
///     `crush` is FIXED-cost — it only burns the gear, snapshots each item's raw stat block, and
///     commits ONE `&Random` seed into a SOULBOUND `CrushClaim` (no tier math runs yet, so an
///     outcome-dependent gas budget cannot OOG-revert a bad roll to filter for Ra-heavy claims —
///     audit 2026-08-11). Phase 2 `redeem_rune` reveals the owed runes DETERMINISTICALLY off the
///     committed seed (no randomness left to filter) and mints ONE type per call — a real
///     `&ItemTemplate` each, dodging the illegal `vector<&ItemTemplate>`. `discard_claim` closes an
///     emptied claim.
module aresrpg::forgemagie;

use aresrpg_seed::item_rows::{Self, ItemTemplate};
use aresrpg::{
  character::Character,
  item::{Self, Item},
  progression,
  protected_policy::AresRPG_TransferPolicy,
};
use aresrpg_math::{content_rules, forge, item_stats, prng, rune_catalog as cat};
use std::string::String;
use sui::{
  dynamic_field as df,
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  random::RandomGenerator,
  transfer_policy::TransferPolicy,
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const RUNE_UNLOCK_LEVEL: u64 = 70;
/// Forgemagie has NO progression (owner 2026-08-11): the craft job only gates access, it never
/// improves the odds. The ported `apply_rune` takes a runic level (Dofus fed the forgemage's own
/// level), so we PIN it at the production mastery level — everyone scribes at qualified-master competence,
/// a FLAT gamble driven by proximity to the template max + the item's puits. Dofus-faithful rates.
const FORGE_LEVEL: u64 = 70;
/// One application counter per stat id (`rune_catalog::stat_count`).
const APPS_LEN: u64 = 15;

const EScribeLocked: u64 = 2701; // scribe: the gear's forgery job is below the current unlock
const EMaxApps: u64 = 2703; // scribe: this rune's per-item application cap is reached
const EWrongItem: u64 = 2704; // scribe: gear/template mismatch, or the gear carries no rolled block
const ENotForgeable: u64 = 2705; // the item's category has no forgery job (not gear)
const EMissingTemplate: u64 = 2709; // close_crush: a yielded rune's template was not snapshotted
const ENoStats: u64 = 2710; // crush: a gear item carries no rolled block

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The item's forgemagie state — ONE typed DF on the gear (`ForgeKey`): the puits sink balance
/// + per-stat successful-application counts (the hard caps: range/movement/action 1, Cri 10).
public struct ForgeState has copy, drop, store {
  puits: u64,
  apps: vector<u8>, // length 15, indexed by catalog stat id
}

public struct ForgeKey() has copy, drop, store;

/// The SOULBOUND crush claim (`key` only → non-transferable): carries the committed `&Random`
/// `seed` and the burned gear's `raws` (concatenated `stat_count`-stride blocks) — the crush
/// INPUTS, not yet rolled. The seed lands here from a TERMINAL `&Random` in an object the minting
/// tx cannot read back, so the roll can't be observed-then-aborted for a free re-roll, AND phase 1
/// runs the SAME fixed compute for every future outcome (no gas-based tier filtering). The owed
/// runes (51-vector, `stat×3+tier`) reveal DETERMINISTICALLY off the seed on the first redeem/discard.
public struct CrushClaim has key {
  id: UID,
  seed: u64,
  raws: vector<u64>,
  revealed: bool,
  owed: vector<u64>,
}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

/// ONE shape for every scribe outcome (write-set parity): the outcome is DATA, never a shape.
/// `applied_value` is the actual capped gain, so the receipt fully explains the item write.
public struct RuneScribed has copy, drop {
  item: ID,
  stat: u8,
  tier: u8,
  outcome: u8,
  applied_value: u64,
  lost_stat: u8,
  lost_amount: u64,
  new_puits: u64,
  xp: u64,
}

public struct GearCrushed has copy, drop { crusher: address, items: u64 }

// ╔════════════════ [ SCRIBE ] ═══════════════════════════════════════════════ ]

/// Apply one rune to `gear_id`. Consumes 1 unit of the rune stack, gates on the gear's forgery
/// job (≥ 70), rolls the 3-outcome gamble, writes the new block + the ForgeState DF, banks xp.
public(package) fun scribe(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  character_id: ID,
  gear_id: ID,
  gear_template: &ItemTemplate,
  rune_item_id: ID,
  protected_item: &AresRPG_TransferPolicy<Item>,
  generator: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  // the rune identity — aborts if the consumed item is not a catalog rune
  let rune_type = { let rune_item: &Item = kiosk.borrow(cap, rune_item_id); rune_item.item_type() };
  let (rune_stat, rune_tier) = cat::rune_of(rune_type);

  // the forgery job from the gear's category — a pure gate (no odds scaling)
  let job = {
    let character: &Character = kiosk.borrow(cap, character_id);
    forgery_job(character, item_rows::template_category(gear_template))
  };

  // consume exactly one rune unit BEFORE the roll — identical write whatever the outcome
  item::burn(kiosk, cap, protected_item, rune_item_id, 1, ctx);

  let rune_value = cat::rune_amount(rune_stat, rune_tier);
  let rune_weight = cat::rune_weight(rune_stat, rune_tier);
  let seed = generator.generate_u64();

  let (outcome, applied_value, lost_stat, lost_amount, new_puits, xp) = {
    let gear: &mut Item = kiosk.borrow_mut(cap, gear_id);
    assert!(item::template(gear) == item_rows::template_id(gear_template), EWrongItem);
    assert!(item::has_stats(gear), EWrongItem);
    let stats = item::stats(gear);
    ensure_forge_state(gear);
    let state = *df::borrow<ForgeKey, ForgeState>(item::uid(gear), ForgeKey());
    let cap_apps = cat::rune_max_apps(rune_stat);
    assert!(cap_apps == 0 || (state.apps[rune_stat as u64] as u64) < cap_apps, EMaxApps);

    let mut rng = prng::rng_seed(seed);
    let res = forge::apply_rune(
      stats.to_raw(),
      item_rows::stats_max(gear_template).to_raw(),
      rune_stat, rune_value, rune_weight, FORGE_LEVEL, state.puits, &mut rng,
    );

    item::set_stats(gear, stats.apply_raw(&forge::new_stats(&res)));

    let succeeded = forge::outcome(&res) != forge::outcome_cf();
    let mut apps = state.apps;
    if (succeeded) *&mut apps[rune_stat as u64] = apps[rune_stat as u64] + 1;
    *df::borrow_mut<ForgeKey, ForgeState>(item::uid_mut(gear), ForgeKey()) =
      ForgeState { puits: forge::new_puits(&res), apps };

    let gear_level = item::level(gear) as u64;
    let xp = if (succeeded) forge::compute_xp(rune_tier, rune_weight, gear_level) else 0;
    (forge::outcome(&res), forge::applied_value(&res), forge::lost_stat(&res), forge::lost_amount(&res), forge::new_puits(&res), xp)
  };

  {
    let character: &mut Character = kiosk.borrow_mut(cap, character_id);
    progression::bank_job_xp(character, job, xp);
  };

  event::emit(RuneScribed {
    item: gear_id, stat: rune_stat, tier: rune_tier, outcome, applied_value, lost_stat, lost_amount, new_puits, xp,
  });
}

// ╔════════════════ [ CRUSH — phase 1: the terminal roll → soulbound claim ] ═ ]

/// Destroy `gear_ids` and COMMIT the crush: burn each gear, snapshot its raw stat block, and land a
/// single `&Random` seed in a SOULBOUND `CrushClaim` transferred to the crusher. FIXED-COST + TERMINAL
/// `&Random`: no tier math runs here (deferred to redeem), so the roll is both unreadable in-tx AND
/// runs the same compute for every outcome — an OOG-calibrated gas budget can't filter the yield
/// (audit 2026-08-11). The crusher reveals + redeems the runes in a later, deterministic PTB.
public(package) fun crush(
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  gear_ids: vector<ID>,
  protected_item: &AresRPG_TransferPolicy<Item>,
  generator: &mut RandomGenerator,
  ctx: &mut TxContext,
) {
  let seed = generator.generate_u64();
  let mut raws = vector<u64>[];
  let n = gear_ids.length();
  let mut i = 0;
  while (i < n) {
    let gid = gear_ids[i];
    let raw = {
      let g: &Item = kiosk.borrow(cap, gid);
      assert_crushable(item::category(g), item::has_stats(g));
      item::stats(g).to_raw()
    };
    raws.append(raw); // one stat_count-stride block per gear — fixed work, no crush_lines here
    item::burn(kiosk, cap, protected_item, gid, 1, ctx); // gear is non-stackable — one unit
    i = i + 1;
  };
  event::emit(GearCrushed { crusher: ctx.sender(), items: n });
  let claim = CrushClaim { id: object::new(ctx), seed, raws, revealed: false, owed: forge::zero_counts() };
  transfer::transfer(claim, ctx.sender()); // soulbound
}

// ╔════════════════ [ CRUSH — phase 2: deterministic redeem (no randomness) ] ═ ]

/// Redeem ONE owed rune type: mint its owed quantity off the real `template` and merge into the
/// crusher's `existing` stack (no dust). Called once per yielded rune type in the redeem PTB —
/// each call carries the REAL `&ItemTemplate`, so no snapshot dance and no `vector<&ItemTemplate>`.
/// A rune with nothing owed (or already redeemed) no-ops; a non-rune template aborts via `rune_of`.
public(package) fun redeem_rune(
  claim: &mut CrushClaim,
  template: &ItemTemplate,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  item_policy: &TransferPolicy<Item>,
  ctx: &mut TxContext,
) {
  ensure_revealed(claim); // deterministic first-touch reveal off the committed seed
  let (stat, tier) = cat::rune_of(item_rows::template_type(template));
  let idx = (stat as u64) * 3 + (tier as u64) - 1;
  let qty = claim.owed[idx];
  if (qty == 0) return;
  *&mut claim.owed[idx] = 0;
  let stack = item::mint_plain(template, qty as u32, ctx); // runes are stackable + stat-less
  item::deposit(kiosk, cap, item_policy, existing, stack);
}

/// Consume the claim once every owed rune has been redeemed — a leftover row means a yielded rune
/// was never claimed (client bug), so this aborts and the whole redeem reverts (the claim survives).
public(package) fun discard_claim(mut claim: CrushClaim) {
  ensure_revealed(&mut claim); // reveal first — an unrevealed claim's owed is all-zero and would delete the runes
  let CrushClaim { id, seed: _, raws: _, revealed: _, owed } = claim;
  assert_owed_empty(&owed);
  id.delete();
}

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

// forgery_job
/// The gear's forgery job = the SAME job that crafts it — read from the ONE hardcoded map in
/// `content_rules::craft_job_of` (shared with crafting, so a sword is `FORGER` for both, no drift).
/// Only craftable gear is forgeable; a category with no job aborts. (A non-gear category that DOES
/// carry a job, e.g. `key`, still fails scribe later on `has_stats` — keys carry no rolled block.)
fun forgery_job(character: &Character, category: String): String {
  let job = content_rules::craft_job_of(&category);
  assert!(job.is_some(), ENotForgeable);
  let job = job.destroy_some();
  assert!(progression::job_level_of(character, job) >= RUNE_UNLOCK_LEVEL, EScribeLocked);
  job
}

fun assert_crushable(category: String, has_stats: bool) {
  assert!(has_stats, ENoStats);
  assert!(
    !content_rules::is_stackable(&category) && content_rules::craft_job_of(&category).is_some(),
    ENotForgeable,
  );
}

#[test_only]
public(package) fun assert_crushable_for_testing(category: String, has_stats: bool) {
  assert_crushable(category, has_stats);
}

#[test_only]
public(package) fun assert_scribe_job_for_testing(character: &Character, category: String) {
  forgery_job(character, category);
}

// ensure_revealed
/// Reveal the owed runes on first touch: re-seed the prng from the committed `seed` and run
/// `crush_lines` per stored raw block, in the SAME order phase 1 snapshotted them — identical
/// stream, deterministic result. No randomness remains for a gas budget to filter (the seed is
/// already sealed), so this variable-cost work is safe in phase 2.
fun ensure_revealed(claim: &mut CrushClaim) {
  if (claim.revealed) return;
  let stride = cat::stat_count();
  let mut rng = prng::rng_seed(claim.seed);
  let mut owed = forge::zero_counts();
  let mut off = 0;
  while (off < claim.raws.length()) {
    let mut block = vector<u64>[];
    let mut k = 0;
    while (k < stride) { block.push_back(claim.raws[off + k]); k = k + 1; };
    forge::add_counts(&mut owed, &forge::crush_lines(&block, &mut rng));
    off = off + stride;
  };
  claim.owed = owed;
  claim.revealed = true;
}

// ensure_forge_state
fun ensure_forge_state(gear: &mut Item) {
  if (!df::exists(item::uid(gear), ForgeKey())) {
    let mut apps = vector<u8>[];
    let mut i = 0;
    while (i < APPS_LEN) { apps.push_back(0); i = i + 1; };
    df::add(item::uid_mut(gear), ForgeKey(), ForgeState { puits: 0, apps });
  };
}

// assert_owed_empty
/// Every owed row zero after the mint walk — a leftover means a yielded rune's template was not
/// committed: abort so the WHOLE crush reverts (burns included) and the gear survives.
fun assert_owed_empty(owed: &vector<u64>) {
  let mut i = 0;
  while (i < owed.length()) {
    assert!(owed[i] == 0, EMissingTemplate);
    i = i + 1;
  };
}
