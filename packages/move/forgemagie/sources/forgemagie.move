/// FORGEMAGIE DOORS — the S-48 upgrade-#2 payload: the Retro rune system's game-side gates over foundation's
/// pure libs (`forgemagie` applyRune / `taux` inflation / `rune_catalog` hardcode). Canon:
/// docs/RETRO_RUNES_RESEARCH.md + DECISIONS 2026-07-09 riders.
///
///   • SCRIBE (`scribe_rune`) — ONE TX PER RUNE: consumes EXACTLY 1 unit off the rune stack via
///     `consume_units` (the old runes::scribe whole-stack burn bug dies here), draws a FRESH `&Random` seed,
///     threads it into foundation `apply_rune` (3 outcomes, puits-first ledger), and lands an IDENTICAL WRITE
///     SET whatever the outcome (full stat block + the ONE ForgeState DF + one uniform event + one job-xp
///     write) — outcome divergence is COMPUTE-ONLY (kills gas-based outcome filtering).
///   • CRUSH (`crush`) — ONE TX, fixed-arity: BULK per tx over ONE
///     template (a `vector<&ItemTemplate>` is illegal Move; the item carries no level, so multi-template
///     batches are separate txs — declared): entry-snapshot taux pricing (phase-1 settle BEFORE any rng),
///     per-item SEQUENTIAL yield + front-loaded self-decay, one capped bracket-pressure emission
///     post-loop, snapshot stamped POST-emission (self-pressure exclusion). Yielded runes MINT IN THE SAME TX:
///     the signature carries `CRUSH_TEMPLATE_SLOTS` (35) fixed `&ItemTemplate` slots — the client passes every
///     REGISTERED rune template (the yield SET is deterministic from the item's stat lines; only QUANTITIES
///     are random) and fills leftover slots with DISTINCT other ItemTemplates (distinct-padding law: duplicate
///     object args in one MoveCall are of unverified PTB legality, so the client never sends duplicates; the
///     walk below tolerates them anyway). Unregistered / zero-owed / duplicate slots no-op; any owed rune
///     whose template was NOT passed aborts (`EMissingTemplate`) — the whole tx reverts, the gear is safe.
///   • YIELD CALIBRATION (curve-based, docs/ECONOMY_SIM.md §7): the R3 formula
///     transcribed raw yields ~2000 runes for a L50/40-Fo line @100%. A PER-LEVEL-BAND divisor
///     (`aresrpg_foundation::forgemagie::band_divisor`) replaces the old flat constant so the steady-state
///     crush floor holds ≈40-70% of sale value at every level and never beats selling; foundation goldens pin it.
///   • The FORGEMAGIE kill-switch bit gates both doors; the dirty-counter (unfinished business) gates both.
///
/// PUITS UNITS: the catalog ×5 weight domain (integer forever) — UI divides by `rune_catalog::weight_scale()`
/// for the Retro view. Stored in the item's `ForgeState` DF (written through the brand-gated core UID door).
///
/// PACKAGE SPLIT (2026-07-12): this module lives in its OWN `aresrpg_forgemagie` package (core hit the
/// 102,400 B publish cap at 207 B headroom). Core value writes flow through the `*_brand` twins
/// (config-pinned witness, kolizeum-precedent brand pattern) — see `Forge` below.
module aresrpg_forgemagie::forgemagie;

use aresrpg::{admin::AdminCap, character::Character, character_link, config::{Self, GameConfig}, extension, fight_marker, version::Version};
use aresrpg::{extract::ItemExtractPolicy, item::{Self, Item, ItemTemplate}, item_stats::{Self, ItemStatistics}};
use aresrpg_foundation::{forgemagie as forge, job_xp, prng, rune_catalog as cat, taux};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{dynamic_field as df, event, kiosk::Kiosk, random::{Self, Random}, table::{Self, Table}, transfer_policy::TransferPolicy};

// ╔════════════════ [ The brand witness (core's `*_brand` doors key on this) ] ═ ]

/// THE forge witness: `GameConfig.forge_brand` pins `type_name::get<Forge>()` at the ceremony, and every
/// brand-gated core value door (`set_rolled_brand` / `mint_item_stack_brand` / `add_job_xp_brand` /
/// `consume_units_brand` / `item_uid_mut_brand`) refuses any other witness. FENCE: no public constructor —
/// `Forge {}` is packed ONLY inside this module's functions, NEVER returned, NEVER stored; `drop` means every
/// instance dies in the call that made it. That containment is the whole security argument (D319 rider).
public struct Forge has drop {}

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

/// SPEC §6 / the reference corpus `Job.RUNE_UNLOCK_LEVEL`: scribing unlocks at job level 70 (ANY job). Frozen law.
const RUNE_UNLOCK_LEVEL: u64 = 70;
/// SPEC §6: 15 jobs, ids 0..14 (the runic level = the character's BEST job level — the any-job-70 model).
const JOB_COUNT: u8 = 15;
/// OURS (declared): taux level brackets are 20 template-levels wide (Retro's "tranche de niveau" width is
/// unpublished; 20 matches the Retro gear-tier cadence).
const BRACKET_SIZE: u16 = 20;
/// Orphan crush prices at the historic L50 yield anchor (`yield_divisor()` ==
/// `band_divisor(50)`, DECISIONS 460 golden): a burned ItemTemplate leaves the item with NO level, and a
/// client-supplied level would inflate yield, so orphan crush is a fixed, exploit-proof consolation — a burned
/// L200 legendary yields as if L50 (documented loss, acceptable for an exceptional admin-deletion event).
const ORPHAN_CRUSH_LEVEL: u64 = 50;
const EDirty: u64 = 101; // scribe/crush: the character carries unfinished business (open your fight outcome first)
const EScribeLocked: u64 = 102; // scribe: no job has reached level 70 (SPEC §6 unlock)
const EUnknownRune: u64 = 103; // the template is not a registered rune (admin registers the catalog at seed)
const EWrongItem: u64 = 104; // scribe: gear/template mismatch, or the item carries no rolled stat block
const EMalusStat: u64 = 106; // scribe: the target stat is below centre (a malus) — scribing would erase it (refused)
const EMaxApps: u64 = 107; // scribe: this rune's per-item application cap is reached (Po/PM/PA=1, Cri=10)
const EWrongTemplate: u64 = 108; // crush: an item in the batch is not of the passed template
const EMissingTemplate: u64 = 109; // crush: a rune was owed whose ItemTemplate was not among the passed slots
const EBadRegistration: u64 = 111; // register_rune: (stat, tier) is not a real Retro rune
const EEmptyBatch: u64 = 112; // crush_orphan: empty gear batch — no item to derive the burned template id from
const EOrphanWrongTemplate: u64 = 113; // crush_orphan: a batch item is not of the first item's derived template

/// The fixed rune-template arity of `crush` — the FROZEN catalog bound on distinct rune templates ONE crush can
/// yield: 10 multi-tier stats × 3 tiers + 5 single-tier majors = 35 (`rune_catalog`: the 15 RUNEABLE fields;
/// Ba/Pa/Ra where populated). The catalog is hardcoded law (DECISIONS 2143-2145 "runes never change"), so 35 is
/// a constant forever — any smaller K would bake a content ceiling into this door (L120+ gear carries
/// vit/wis + 4 resistances + primaries: >30 reachable templates). Documentation constant: the signature carries
/// the 35 slots explicitly (`t1..t35`).
const CRUSH_TEMPLATE_SLOTS: u64 = 35;

// ╔════════════════ [ Shared state — the ONE CrushBoard (admin-created post-upgrade) ] ═ ]

/// THE forgemagie shared object (one object, no sharding): the rune-template registry (both
/// directions) + per-template taux rows + per-bracket pressure counters. Created ONCE by `create_board`
/// (upgrades never run init — the admin door is the post-upgrade bootstrap).
public struct CrushBoard has key {
  id: UID,
  runes: Table<ID, RuneRef>, // rune ItemTemplate id → catalog coords
  taux: Table<ID, TauxRow>, // gear template id → inflation row
  pressure: Table<u64, u64>, // level bracket → monotone pressure counter
}

public struct RuneRef has copy, drop, store { stat: u8, tier: u8 }

/// Per-template taux state (foundation `taux` two-phase model). `recipe_less` prices at min(coeff, 50%)
/// (anti boss-loot-fodder floor); defaults false on auto-created rows — the admin marks drop-only templates.
public struct TauxRow has store {
  coeff_milli: u64,
  carry: u64,
  snapshot: u64,
  recipe_less: bool,
}

/// The item's forgemagie state — ONE typed DF on the gear's UID (`ForgeKey`): the puits (×5 weight units) +
/// per-stat successful-application counts (the R1 hard caps: Po/PM/PA 1, Cri 10). One DF write per scribe.
public struct ForgeState has copy, drop, store {
  puits: u64,
  apps: vector<u8>, // length 17, indexed by catalog stat id
}

public struct ForgeKey has copy, drop, store {}

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

/// ONE event shape for every scribe outcome (write-set parity): outcome is DATA, never a different shape.
public struct RuneScribed has copy, drop {
  item: ID,
  stat: u8,
  tier: u8,
  outcome: u8, // forge::outcome_cs/ns/cf
  applied_value: u64,
  lost_stat: u8, // forge::no_stat() when nothing was destroyed
  lost_amount: u64,
  new_puits: u64,
  xp: u64,
}

/// Carries the FULL post-crush taux state (the indexer is event-driven — coefficients must be
/// derivable from events alone): `coeff_after` = the crushed template's new coefficient, `bracket` +
/// `pressure_after` = its bracket's counter AFTER this tx's capped emission (== the template's new snapshot).
/// Minted runes carry their own `item::ItemMinted` events (one per stack) — no claim event exists anymore.
public struct Crushed has copy, drop { template: ID, items: u64, total_weight: u64, coeff_after: u64, bracket: u64, pressure_after: u64 }

/// Initial taux state for the indexer: every template starts at `neutral_milli` (100%); brackets are
/// `bracket_size` template-levels wide (the indexer maps template level → bracket with this, no hardcode).
public struct BoardCreated has copy, drop { board: ID, neutral_milli: u64, bracket_size: u16 }

public struct RuneRegistered has copy, drop { rune_template: ID, stat: u8, tier: u8 }

public struct RecipelessSet has copy, drop { gear_template: ID, recipe_less: bool }

// ╔════════════════ [ Admin doors (post-upgrade bootstrap + catalog registration) ] ═ ]

/// Create + share THE CrushBoard (upgrade-#2 bootstrap: upgrades never run init). Run ONCE at the ceremony —
/// re-running would fork the taux economy; the seed script owns the discipline (documented, not asserted:
/// a second board carries no registered runes, so its doors are inert).
public fun create_board(cap: &AdminCap, version: &Version, ctx: &mut TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  let board = CrushBoard { id: object::new(ctx), runes: table::new(ctx), taux: table::new(ctx), pressure: table::new(ctx) };
  event::emit(BoardCreated { board: object::id(&board), neutral_milli: taux::neutral_milli(), bracket_size: BRACKET_SIZE });
  transfer::share_object(board);
}

/// Register a rune ItemTemplate as the (stat, tier) Retro rune — both directions. The catalog law is asserted
/// (`has_rune`); table dup-adds abort naturally (one template per rune, one rune per template).
public fun register_rune(cap: &AdminCap, board: &mut CrushBoard, rune_template: ID, stat: u8, tier: u8, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  assert!(cat::has_rune(stat, tier), EBadRegistration);
  board.runes.add(rune_template, RuneRef { stat, tier });
  event::emit(RuneRegistered { rune_template, stat, tier });
}

/// Mark a gear template recipe-less (drop/quest-only — its taux prices at min(coeff, 50%), the anti-fodder floor).
public fun set_recipeless(cap: &AdminCap, board: &mut CrushBoard, gear_template: ID, recipe_less: bool, version: &Version, ctx: &TxContext) {
  cap.verify(ctx);
  version.assert_latest();
  ensure_taux_row(board, gear_template);
  board.taux.borrow_mut(gear_template).recipe_less = recipe_less;
  event::emit(RecipelessSet { gear_template, recipe_less });
}

// ╔════════════════ [ SCRIBE — one tx per rune ] ═════════════════ ]

/// Apply ONE rune to a kiosk-locked gear item. Gates: global freeze + FORGEMAGIE bit + version + dirty-counter
/// + the SPEC §6 job-70 unlock. Consumes EXACTLY 1 rune unit BEFORE the roll (identical every outcome — the
/// whole-stack burn bug's structural fix), then foundation `apply_rune` decides CS/NS/CF off the fresh
/// `&Random` seed. The write set is IDENTICAL in all three branches: full rolled block + the ForgeState DF +
/// one `RuneScribed` event + one job-xp write. Terminal `&Random` entry.
entry fun scribe_rune(
  board: &CrushBoard,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  gear_id: ID,
  gear_template: &ItemTemplate,
  rune_item_id: ID,
  rune_template: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  market_policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  r: &Random,
  ctx: &mut TxContext,
) {
  let seed = random::new_generator(r, ctx).generate_u64();
  scribe_seeded(board, kiosk, pkcap, character_id, gear_id, gear_template, rune_item_id, rune_template, xpolicy, market_policy, config, version, seed, ctx);
}

// ╔════════════════ [ CRUSH — ONE TX: bulk per template, roll + mint, fixed-arity slots ] ═ ]

/// Crush `gear_ids` (ALL of `gear_template` — the item carries no level and `vector<&ItemTemplate>` is illegal
/// Move, so one template per tx; multi-template = separate txs, declared) and MINT the yielded runes in the
/// SAME TX. `t1..t35` are the `CRUSH_TEMPLATE_SLOTS` fixed rune-template slots — pass every REGISTERED rune
/// template plus DISTINCT fillers (see the module doc; unregistered / zero-owed / duplicate slots no-op). The
/// roll (`crush_roll`): PHASE 1 settles the bracket pressure into the coefficient BEFORE any rng; PHASE 2
/// loops items SEQUENTIALLY — yield each positive runeable line at the CURRENT coefficient (stochastic
/// rounding + reference-corpus tier roll per rune), then decay front-loaded before the next item; post-loop ONE capped
/// pressure emission, snapshot stamped POST-emission (self-exclusion). Every crushed item is DESTROYED
/// unconditionally (sealed semantics). Minted stacks kiosk-lock via the LockPledge law; leftover owed
/// (a yielded rune whose template was not passed) aborts `EMissingTemplate` — full revert, gear safe.
/// Terminal `&Random` entry.
entry fun crush(
  board: &mut CrushBoard,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  gear_template: &ItemTemplate,
  gear_ids: vector<ID>,
  t1: &ItemTemplate, t2: &ItemTemplate, t3: &ItemTemplate, t4: &ItemTemplate, t5: &ItemTemplate,
  t6: &ItemTemplate, t7: &ItemTemplate, t8: &ItemTemplate, t9: &ItemTemplate, t10: &ItemTemplate,
  t11: &ItemTemplate, t12: &ItemTemplate, t13: &ItemTemplate, t14: &ItemTemplate, t15: &ItemTemplate,
  t16: &ItemTemplate, t17: &ItemTemplate, t18: &ItemTemplate, t19: &ItemTemplate, t20: &ItemTemplate,
  t21: &ItemTemplate, t22: &ItemTemplate, t23: &ItemTemplate, t24: &ItemTemplate, t25: &ItemTemplate,
  t26: &ItemTemplate, t27: &ItemTemplate, t28: &ItemTemplate, t29: &ItemTemplate, t30: &ItemTemplate,
  t31: &ItemTemplate, t32: &ItemTemplate, t33: &ItemTemplate, t34: &ItemTemplate, t35: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  r: &Random,
  ctx: &mut TxContext,
) {
  let seed = random::new_generator(r, ctx).generate_u64();
  let mut owed = crush_roll(board, kiosk, pkcap, character_id, gear_template, gear_ids, xpolicy, config, version, seed, ctx);
  mint_slot(board, &mut owed, t1, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t2, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t3, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t4, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t5, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t6, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t7, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t8, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t9, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t10, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t11, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t12, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t13, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t14, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t15, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t16, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t17, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t18, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t19, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t20, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t21, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t22, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t23, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t24, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t25, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t26, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t27, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t28, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t29, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t30, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t31, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t32, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t33, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t34, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t35, kiosk, pkcap, policy, config, version, ctx);
  assert_owed_empty(&owed);
}

/// The seeded crush body (single home — the entry door draws the seed from `&Random`, the test twin injects
/// one). Runs the gates + the two-phase taux roll + destruction + the capped emission + the `Crushed` event,
/// and RETURNS the rolled owed vector (51 slots, `stat×3 + (tier−1)`) for the caller's mint walk.
fun crush_roll(
  board: &mut CrushBoard,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  gear_template: &ItemTemplate,
  gear_ids: vector<ID>,
  xpolicy: &ItemExtractPolicy,
  config: &GameConfig,
  version: &Version,
  seed: u64,
  ctx: &mut TxContext,
): vector<u64> {
  config.assert_enabled();
  config.assert_domain(config::domain_forgemagie()); // S-46 kill-switch bit
  version.assert_enabled();
  {
    let chr: &Character = kiosk.borrow(personal_kiosk::borrow(pkcap), character_id);
    assert!(fight_marker::is_unmarked(chr), EDirty);
  };

  let tid = item::template_id(gear_template);
  let level = item::template_level(gear_template) as u64;
  let bracket = (item::template_level(gear_template) / BRACKET_SIZE) as u64;

  // ── PHASE 1: settle the bracket pressure into the coefficient (entry-snapshot price, pre-rng) ──
  ensure_taux_row(board, tid);
  if (!board.pressure.contains(bracket)) board.pressure.add(bracket, 0);
  let pressure_now = *board.pressure.borrow(bracket);
  let recipe_less = board.taux.borrow(tid).recipe_less;
  {
    let row = board.taux.borrow_mut(tid);
    let (c, carry) = taux::settle_pressure(row.coeff_milli, row.carry, row.snapshot, pressure_now);
    row.coeff_milli = c;
    row.carry = carry;
  };

  // ── PHASE 2: per-item sequential (yield at current coeff → front-loaded decay) ──
  let mut rng = prng::rng_seed(seed);
  let mut owed: vector<u64> = forge::zero_counts();
  let mut total_weight = 0u64;
  let n = gear_ids.length();
  let mut i = 0;
  while (i < n) {
    let (it, pledge) = aresrpg::extract::extract_for_burn(kiosk, pkcap, *gear_ids.borrow(i), xpolicy, version, ctx);
    assert!(item::template(&it) == tid, EWrongTemplate);
    let coeff = board.taux.borrow(tid).coeff_milli;
    let raw = if (item_stats::has_rolled_stats(&it)) item_stats::to_raw(item_stats::rolled_stats(&it)) else item_stats::zero_raw();
    let (counts, weight) = forge::crush_lines(&raw, level, coeff, recipe_less, &mut rng);
    forge::add_counts(&mut owed, &counts);
    total_weight = total_weight + weight;
    aresrpg::extract::burn(pledge, it, version); // destroyed unconditionally (sealed crush law)
    board.taux.borrow_mut(tid).coeff_milli = taux::update_on_crush(coeff); // front-loaded self-decay, per item
    i = i + 1;
  };

  // ── one capped emission + POST-emission snapshot (self-pressure exclusion) ──
  let emission = taux::crush_pressure(total_weight);
  *board.pressure.borrow_mut(bracket) = pressure_now + emission;
  {
    let row = board.taux.borrow_mut(tid);
    row.snapshot = pressure_now + emission;
  };

  event::emit(Crushed {
    template: tid,
    items: n,
    total_weight,
    coeff_after: board.taux.borrow(tid).coeff_milli,
    bracket,
    pressure_after: pressure_now + emission,
  });
  owed
}

// ╔════════════════ [ CRUSH ORPHAN — template-less twin for burned-template gear ] ═ ]

/// Crush ORPHANED gear whose ItemTemplate was DELETED on-chain (`admin::burn_item_template`). The standard
/// `crush` takes `gear_template: &ItemTemplate` by-ref and reads the item level off it — a burned template is an
/// unpassable object arg, so this template-less twin exists so the "crush it for runes" fallback still
/// works. It derives the taux key from the batch's OWN immutable stamped `template` ID (survives the burn) and
/// prices the yield at `ORPHAN_CRUSH_LEVEL` (the item carries no level). Same destruction + 35-slot mint + capped
/// emission as `crush`. Runes are never burned (permanent catalog) so `t1..t35` always resolve. Terminal `&Random` entry.
entry fun crush_orphan(
  board: &mut CrushBoard,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  gear_ids: vector<ID>,
  t1: &ItemTemplate, t2: &ItemTemplate, t3: &ItemTemplate, t4: &ItemTemplate, t5: &ItemTemplate,
  t6: &ItemTemplate, t7: &ItemTemplate, t8: &ItemTemplate, t9: &ItemTemplate, t10: &ItemTemplate,
  t11: &ItemTemplate, t12: &ItemTemplate, t13: &ItemTemplate, t14: &ItemTemplate, t15: &ItemTemplate,
  t16: &ItemTemplate, t17: &ItemTemplate, t18: &ItemTemplate, t19: &ItemTemplate, t20: &ItemTemplate,
  t21: &ItemTemplate, t22: &ItemTemplate, t23: &ItemTemplate, t24: &ItemTemplate, t25: &ItemTemplate,
  t26: &ItemTemplate, t27: &ItemTemplate, t28: &ItemTemplate, t29: &ItemTemplate, t30: &ItemTemplate,
  t31: &ItemTemplate, t32: &ItemTemplate, t33: &ItemTemplate, t34: &ItemTemplate, t35: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  r: &Random,
  ctx: &mut TxContext,
) {
  let seed = random::new_generator(r, ctx).generate_u64();
  let mut owed = crush_roll_orphan(board, kiosk, pkcap, character_id, gear_ids, xpolicy, config, version, seed, ctx);
  mint_slot(board, &mut owed, t1, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t2, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t3, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t4, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t5, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t6, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t7, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t8, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t9, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t10, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t11, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t12, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t13, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t14, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t15, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t16, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t17, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t18, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t19, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t20, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t21, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t22, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t23, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t24, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t25, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t26, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t27, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t28, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t29, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t30, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t31, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t32, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t33, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t34, kiosk, pkcap, policy, config, version, ctx); mint_slot(board, &mut owed, t35, kiosk, pkcap, policy, config, version, ctx);
  assert_owed_empty(&owed);
}

/// The seeded orphan roll — a FOCUSED DUPLICATE of `crush_roll` (kept additive so it never edits the frozen live
/// crush path; a later non-ceremony refactor can DRY the two by extracting a shared `crush_roll(board,…,tid,level,…)`).
/// The ONLY deltas vs `crush_roll` are marked ▲: the taux key comes from the first item's stamped template ID
/// (not a passed `&ItemTemplate`), the level is the fixed `ORPHAN_CRUSH_LEVEL`, and a distinct abort code fires per
/// orphan-specific failure. Every item in the batch must share that first template (`EOrphanWrongTemplate`).
fun crush_roll_orphan(
  board: &mut CrushBoard,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  gear_ids: vector<ID>,
  xpolicy: &ItemExtractPolicy,
  config: &GameConfig,
  version: &Version,
  seed: u64,
  ctx: &mut TxContext,
): vector<u64> {
  config.assert_enabled();
  config.assert_domain(config::domain_forgemagie()); // S-46 kill-switch bit
  version.assert_enabled();
  {
    let chr: &Character = kiosk.borrow(personal_kiosk::borrow(pkcap), character_id);
    assert!(fight_marker::is_unmarked(chr), EDirty);
  };

  // ▲ ORPHAN: the batch must be non-empty — the burned template id is derived FROM item 0 (crush reads it off the
  //   passed `&ItemTemplate`, so it tolerates an empty batch; this twin cannot).
  assert!(gear_ids.length() > 0, EEmptyBatch);
  // ▲ ORPHAN: derive the taux key from the FIRST item's immutable stamped template ID (the burned template object
  //   is gone; the id lives on the item forever). The PHASE-2 loop asserts every item shares it.
  let tid = {
    let first: &Item = kiosk.borrow(personal_kiosk::borrow(pkcap), *gear_ids.borrow(0));
    item::template(first)
  };
  // ▲ ORPHAN: fixed reference level (no template ⇒ no real level; a client level would inflate yield).
  let level = ORPHAN_CRUSH_LEVEL;
  let bracket = ORPHAN_CRUSH_LEVEL / (BRACKET_SIZE as u64);

  // ── PHASE 1: settle the bracket pressure into the coefficient (entry-snapshot price, pre-rng) ──
  ensure_taux_row(board, tid);
  if (!board.pressure.contains(bracket)) board.pressure.add(bracket, 0);
  let pressure_now = *board.pressure.borrow(bracket);
  let recipe_less = board.taux.borrow(tid).recipe_less;
  {
    let row = board.taux.borrow_mut(tid);
    let (c, carry) = taux::settle_pressure(row.coeff_milli, row.carry, row.snapshot, pressure_now);
    row.coeff_milli = c;
    row.carry = carry;
  };

  // ── PHASE 2: per-item sequential (yield at current coeff → front-loaded decay) ──
  let mut rng = prng::rng_seed(seed);
  let mut owed: vector<u64> = forge::zero_counts();
  let mut total_weight = 0u64;
  let n = gear_ids.length();
  let mut i = 0;
  while (i < n) {
    let (it, pledge) = aresrpg::extract::extract_for_burn(kiosk, pkcap, *gear_ids.borrow(i), xpolicy, version, ctx);
    assert!(item::template(&it) == tid, EOrphanWrongTemplate); // ▲ ORPHAN: distinct from crush's EWrongTemplate
    let coeff = board.taux.borrow(tid).coeff_milli;
    let raw = if (item_stats::has_rolled_stats(&it)) item_stats::to_raw(item_stats::rolled_stats(&it)) else item_stats::zero_raw();
    let (counts, weight) = forge::crush_lines(&raw, level, coeff, recipe_less, &mut rng);
    forge::add_counts(&mut owed, &counts);
    total_weight = total_weight + weight;
    aresrpg::extract::burn(pledge, it, version); // destroyed unconditionally (sealed crush law)
    board.taux.borrow_mut(tid).coeff_milli = taux::update_on_crush(coeff); // front-loaded self-decay, per item
    i = i + 1;
  };

  // ── one capped emission + POST-emission snapshot (self-pressure exclusion) ──
  let emission = taux::crush_pressure(total_weight);
  *board.pressure.borrow_mut(bracket) = pressure_now + emission;
  {
    let row = board.taux.borrow_mut(tid);
    row.snapshot = pressure_now + emission;
  };

  event::emit(Crushed {
    template: tid,
    items: n,
    total_weight,
    coeff_after: board.taux.borrow(tid).coeff_milli,
    bracket,
    pressure_after: pressure_now + emission,
  });
  owed
}

/// One template slot of the mint walk: a REGISTERED template with owed > 0 mints ONE kiosk-locked stack of the
/// owed qty and zeroes its row (so a duplicate slot no-ops); an unregistered template (a distinct-padding
/// filler) or a zero-owed rune no-ops. Runes are stackable by category law (`item::is_stackable_category`).
fun mint_slot(
  board: &CrushBoard,
  owed: &mut vector<u64>,
  t: &ItemTemplate,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  ctx: &mut TxContext,
) {
  let tid = item::template_id(t);
  if (!board.runes.contains(tid)) return; // padding filler — not a registered rune
  let rune_ref = *board.runes.borrow(tid);
  let idx = (rune_ref.stat as u64) * 3 + (rune_ref.tier as u64) - 1;
  let qty = *owed.borrow(idx);
  if (qty == 0) return; // nothing owed, or a duplicate slot (first occurrence zeroed the row)
  *owed.borrow_mut(idx) = 0;
  let (stack, pledge) = extension::mint_item_stack_brand(Forge {}, config, t, qty, version, ctx);
  item::lock_in_kiosk(pledge, stack, kiosk, personal_kiosk::borrow(pkcap), policy);
}

/// Every owed row must be zero after the mint walk — a leftover means a yielded rune's template was not among
/// the passed slots (client bug / unregistered rune): abort so the WHOLE crush reverts and the gear survives.
fun assert_owed_empty(owed: &vector<u64>) {
  let mut i = 0;
  while (i < owed.length()) {
    assert!(*owed.borrow(i) == 0, EMissingTemplate);
    i = i + 1;
  };
}

// ╔════════════════ [ Reads (UI displays the coefficient — R3 visibility ruling) + puits read ] ═ ]

/// The SETTLED coefficient a crush of `gear_template` would price at right now (the UI number, milli-percent).
public fun effective_coefficient(board: &CrushBoard, gear_template: ID, template_level: u16): u64 {
  let bracket = (template_level / BRACKET_SIZE) as u64;
  let pressure_now = if (board.pressure.contains(bracket)) *board.pressure.borrow(bracket) else 0;
  if (!board.taux.contains(gear_template)) return taux::effective_coefficient(taux::neutral_milli(), 0, 0, pressure_now);
  let row = board.taux.borrow(gear_template);
  taux::effective_coefficient(row.coeff_milli, row.carry, row.snapshot, pressure_now)
}

/// The item's puits (×5 weight units; UI divides by `rune_catalog::weight_scale()`). Owner 2126 display law:
/// the UI reads the `ForgeState` DF via RPC (dynamic-field read on the item id) — this fn is the test oracle.
#[test_only]
public fun puits(gear: &Item): u64 {
  if (df::exists(item::uid(gear), ForgeKey {})) df::borrow<ForgeKey, ForgeState>(item::uid(gear), ForgeKey {}).puits
  else 0
}

#[test_only]
/// Successful applications of `stat`'s rune on this item (the R1 hard-cap counter; RPC reads the same DF).
public fun applications(gear: &Item, stat: u8): u64 {
  if (df::exists(item::uid(gear), ForgeKey {})) (*df::borrow<ForgeKey, ForgeState>(item::uid(gear), ForgeKey {}).apps.borrow(stat as u64) as u64)
  else 0
}

#[test_only]
/// The owed-vector index of a `(stat, tier)` rune — the goldens read the twin's returned roll with this.
public fun owed_index(stat: u8, tier: u8): u64 { (stat as u64) * 3 + (tier as u64) - 1 }

#[test_only]
public fun crush_template_slots(): u64 { CRUSH_TEMPLATE_SLOTS }

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

fun ensure_taux_row(board: &mut CrushBoard, template: ID) {
  if (!board.taux.contains(template)) {
    board.taux.add(template, TauxRow { coeff_milli: taux::neutral_milli(), carry: 0, snapshot: 0, recipe_less: false });
  };
}

fun ensure_forge_state(gear: &mut Item, config: &GameConfig) {
  if (!df::exists(item::uid(gear), ForgeKey {})) {
    let mut apps = vector<u8>[];
    let mut i = 0;
    while (i < cat::stat_count()) { apps.push_back(0); i = i + 1; };
    df::add(extension::item_uid_mut_brand(Forge {}, config, gear), ForgeKey {}, ForgeState { puits: 0, apps });
  };
}

/// Best job level across the 15 jobs + which job holds it (the any-job-70 unlock; xp lands on that job).
fun best_job_level(chr: &Character): (u64, u8) {
  let mut best = 0u64;
  let mut best_job = 0u8;
  let mut j = 0u8;
  while (j < JOB_COUNT) {
    let lvl = job_xp::level_from_xp(character_link::job_xp(chr, j));
    if (lvl > best) { best = lvl; best_job = j; };
    j = j + 1;
  };
  (best, best_job)
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
/// Fixture: bank job xp on a kiosk-locked character through the REAL brand twin (the sibling test build's only
/// route — `add_job_xp` is core-package-private and `Forge` packs only in this module).
public fun bank_job_xp_for_testing(config: &GameConfig, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, character_id: ID, job: u8, xp: u64, version: &Version) {
  let chr: &mut Character = kiosk.borrow_mut(personal_kiosk::borrow(pkcap), character_id);
  character_link::add_job_xp_brand(Forge {}, config, chr, job, xp, version);
}

#[test_only]
/// Fixture: overwrite a kiosk-locked gear's rolled block through the REAL brand twin.
public fun set_rolled_for_testing(config: &GameConfig, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, gear_id: ID, stats: ItemStatistics) {
  let gear: &mut Item = kiosk.borrow_mut(personal_kiosk::borrow(pkcap), gear_id);
  extension::set_rolled_brand(Forge {}, config, gear, stats);
}

#[test_only]
/// Fixture: mint a `quantity`-unit stack through the REAL brand twin and kiosk-lock it. Returns the item id.
public fun mint_lock_stack_for_testing(config: &GameConfig, template: &ItemTemplate, quantity: u64, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, policy: &TransferPolicy<Item>, version: &Version, ctx: &mut TxContext): ID {
  let (stack, pledge) = extension::mint_item_stack_brand(Forge {}, config, template, quantity, version, ctx);
  let iid = object::id(&stack);
  item::lock_in_kiosk(pledge, stack, kiosk, personal_kiosk::borrow(pkcap), policy);
  iid
}

#[test_only]
/// Fixture: mint NON-stackable gear (core's test-only pledge mint) and kiosk-lock it. Returns the item id.
public fun mint_lock_gear_for_testing(template: &ItemTemplate, kiosk: &mut Kiosk, pkcap: &PersonalKioskCap, policy: &TransferPolicy<Item>, version: &Version, ctx: &mut TxContext): ID {
  let (it, pledge) = extension::mint_item_for_testing(template, version, ctx);
  let iid = object::id(&it);
  item::lock_in_kiosk(pledge, it, kiosk, personal_kiosk::borrow(pkcap), policy);
  iid
}

#[test_only]
public fun create_board_for_testing(ctx: &mut TxContext) {
  let board = CrushBoard { id: object::new(ctx), runes: table::new(ctx), taux: table::new(ctx), pressure: table::new(ctx) };
  transfer::share_object(board);
}

/// ONE home for the scribe body (entry draws the seed from `&Random`; the test twin injects one — the same
/// de-duplication shape as `crush` → `crush_roll`). Returns the outcome for the twin's deterministic sweeps.
fun scribe_seeded(
  board: &CrushBoard,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  gear_id: ID,
  gear_template: &ItemTemplate,
  rune_item_id: ID,
  rune_template: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  market_policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  seed: u64,
  ctx: &mut TxContext,
): u8 {
  config.assert_enabled();
  config.assert_domain(config::domain_forgemagie());
  version.assert_enabled();
  let (runic_level, best_job) = {
    let chr: &Character = kiosk.borrow(personal_kiosk::borrow(pkcap), character_id);
    assert!(fight_marker::is_unmarked(chr), EDirty);
    let (lvl, job) = best_job_level(chr);
    assert!(lvl >= RUNE_UNLOCK_LEVEL, EScribeLocked);
    (lvl, job)
  };
  let rune_tid = item::template_id(rune_template);
  assert!(board.runes.contains(rune_tid), EUnknownRune);
  let rune_ref = *board.runes.borrow(rune_tid);
  character_link::consume_units_brand(Forge {}, config, rune_template, 1, rune_item_id, kiosk, pkcap, xpolicy, market_policy, version, ctx);
  let gear: &mut Item = kiosk.borrow_mut(personal_kiosk::borrow(pkcap), gear_id);
  assert!(item::template(gear) == item::template_id(gear_template), EWrongItem);
  assert!(item_stats::has_rolled_stats(gear), EWrongItem);
  let rolled = *item_stats::rolled_stats(gear);
  let raw = item_stats::to_raw(&rolled);
  assert!(!item_stats::is_malus(&rolled, rune_ref.stat), EMalusStat);
  let max_raw = item_stats::template_max_raw(gear_template);
  ensure_forge_state(gear, config);
  let state = *df::borrow<ForgeKey, ForgeState>(item::uid(gear), ForgeKey {});
  let cap_apps = cat::rune_max_apps(rune_ref.stat);
  assert!(cap_apps == 0 || (*state.apps.borrow(rune_ref.stat as u64) as u64) < cap_apps, EMaxApps);
  let mut rng = prng::rng_seed(seed);
  let res = forge::apply_rune(
    raw, max_raw, rune_ref.stat, cat::rune_amount(rune_ref.stat, rune_ref.tier),
    cat::rune_weight(rune_ref.stat, rune_ref.tier), runic_level, state.puits, &mut rng,
  );
  extension::set_rolled_brand(Forge {}, config, gear, item_stats::from_raw(&rolled, &forge::new_stats(&res)));
  let succeeded = forge::outcome(&res) != forge::outcome_cf();
  let mut apps = state.apps;
  let slot = apps.borrow_mut(rune_ref.stat as u64);
  *slot = *slot + (if (succeeded) 1 else 0);
  *df::borrow_mut<ForgeKey, ForgeState>(extension::item_uid_mut_brand(Forge {}, config, gear), ForgeKey {}) = ForgeState { puits: forge::new_puits(&res), apps };
  let xp = if (succeeded) forge::compute_xp(rune_ref.tier, cat::rune_weight(rune_ref.stat, rune_ref.tier), item::template_level(gear_template) as u64) else 0;
  let chr: &mut Character = kiosk.borrow_mut(personal_kiosk::borrow(pkcap), character_id);
  character_link::add_job_xp_brand(Forge {}, config, chr, best_job, xp, version);
  event::emit(RuneScribed {
    item: gear_id, stat: rune_ref.stat, tier: rune_ref.tier, outcome: forge::outcome(&res),
    applied_value: forge::applied_value(&res), lost_stat: forge::lost_stat(&res),
    lost_amount: forge::lost_amount(&res), new_puits: forge::new_puits(&res), xp,
  });
  forge::outcome(&res)
}

#[test_only]
/// The scribe body over an injected rng seed (the deterministic outcome-shape tests drive CS/NS/CF by seed) —
/// the SAME `scribe_seeded` body the live entry runs.
public fun scribe_for_testing(
  board: &CrushBoard,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  gear_id: ID,
  gear_template: &ItemTemplate,
  rune_item_id: ID,
  rune_template: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  market_policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  seed: u64,
  ctx: &mut TxContext,
): u8 {
  scribe_seeded(board, kiosk, pkcap, character_id, gear_id, gear_template, rune_item_id, rune_template, xpolicy, market_policy, config, version, seed, ctx)
}


#[test_only]
/// The crush twin over an injected seed: the SAME `crush_roll` + the SAME `mint_slot` walk (t1..t4 cover every
/// test registry; the walk tolerates repeats — the duplicate no-op the module doc declares is exercised by
/// passing one registered template twice). Returns the ROLLED owed vector (pre-mint copy) so the goldens pin
/// yields without any receipt object. The 35-slot entry itself is smoke-tested via `sui::random`'s test fixture.
public fun crush_for_testing(
  board: &mut CrushBoard,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  gear_template: &ItemTemplate,
  gear_ids: vector<ID>,
  t1: &ItemTemplate,
  t2: &ItemTemplate,
  t3: &ItemTemplate,
  t4: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  seed: u64,
  ctx: &mut TxContext,
): vector<u64> {
  let rolled = crush_roll(board, kiosk, pkcap, character_id, gear_template, gear_ids, xpolicy, config, version, seed, ctx);
  let mut owed = rolled;
  mint_slot(board, &mut owed, t1, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t2, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t3, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t4, kiosk, pkcap, policy, config, version, ctx);
  assert_owed_empty(&owed);
  rolled
}

#[test_only]
/// Orphan-crush twin over an injected seed — the SAME `crush_roll_orphan` body the live entry runs, with the
/// t1..t4 mint walk the test registry needs (the 35-slot entry is smoke-tested via `sui::random`'s fixture).
/// Returns the ROLLED owed vector (pre-mint copy) so the parity golden pins yields without any receipt object.
public fun crush_orphan_for_testing(
  board: &mut CrushBoard,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  gear_ids: vector<ID>,
  t1: &ItemTemplate,
  t2: &ItemTemplate,
  t3: &ItemTemplate,
  t4: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  seed: u64,
  ctx: &mut TxContext,
): vector<u64> {
  let rolled = crush_roll_orphan(board, kiosk, pkcap, character_id, gear_ids, xpolicy, config, version, seed, ctx);
  let mut owed = rolled;
  mint_slot(board, &mut owed, t1, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t2, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t3, kiosk, pkcap, policy, config, version, ctx);
  mint_slot(board, &mut owed, t4, kiosk, pkcap, policy, config, version, ctx);
  assert_owed_empty(&owed);
  rolled
}

#[test_only]
public fun register_rune_for_testing(board: &mut CrushBoard, rune_template: ID, stat: u8, tier: u8) {
  board.runes.add(rune_template, RuneRef { stat, tier });
}

#[test_only]
public fun yield_divisor(): u64 { forge::yield_divisor() }
