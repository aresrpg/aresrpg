/// RUNE CATALOG — the RETRO/1.29 rune system as HARDCODED CONTENT (DECISIONS 2026-07-09 2143-2145:
/// "runes never change → they live as constants, not admin data"). PURE data + accessors: no objects, no
/// events, no state. The crush (yield) and scribe (`forgemagie`) lanes read this table; `taux` takes the
/// weights as plain params. Full research canon: `docs/RETRO_RUNES_RESEARCH.md` (R1 catalog / R2 obtention /
/// R3 taux) — the exhaustive GID list lives there and is NOT re-copied here (one home per fact).
///
/// ── STAT-ID SPACE ──────────────────────────────────────────────────────────────────────────────────────
/// A rune targets one of the 17 `ItemStatistics` fields (foundation `item_stats` / aresrpg `item_stats`),
/// indexed 0..16 in DECLARATION ORDER (this is the "kind" key — for the runeable stats kind≡stat). Every table
/// below is indexed by this id; the main-side shell converts an item's centered `ItemStatistics` ↔ the raw
/// `vector<u64>` these libs consume.
///
/// ── WEIGHT SCALE (×5) ──────────────────────────────────────────────────────────────────────────────────
/// Retro's Vitalité weighs 0.2/point (5 Vi = 1 weight) — fractional. ALL weights here are stored ×5
/// (`WEIGHT_SCALE`) so every weight is an integer and the puits ledger never goes fractional. The scale
/// CANCELS exactly everywhere it matters: crush yield divides unit_weight by rune_weight (both ×5);
/// `forgemagie`'s gain cap uses `floor(505/(unit×5)) ≡ floor(101/unit)` (505 = 101×5, exact for every row);
/// `compute_xp` divides the scale back out. Retro-unit views divide by `weight_scale()`.
///
/// ── CATALOG (majority readings, R1; amounts = FIXED integers per R1 dispute 1, adopted) ─────────────────
/// Retro unit wt/pt: Fo/Ine/Cha/Age=1 · Sa=3 · Vi=0.2 · Ré(flat)=2 · Do=20 · Cri=10 · Po=51 · PM=90 · PA=100.
/// Rune weight = amount × unit weight EXACTLY for every R1 row (internal consistency law — also the puits
/// conservation guarantee: destroying the points a rune added releases exactly the rune's weight), so the
/// per-tier weight tables are DERIVED, never stored twice.
///
/// | id | field              | rune (Retro)   | Ba amt | Pa amt | Ra amt | max | unit wt ×5 | retro wt/pt |
/// |----|--------------------|----------------|--------|--------|--------|-----|------------|-------------|
/// |  0 | vitality           | Vi             |   +3   |  +10   |  +30   |  ∞  |     1      |    0.2      |
/// |  1 | wisdom             | Sa (Sagesse)   |   +1   |   +3   |  +10   |  ∞  |    15      |    3        |
/// |  2 | strength           | Fo (Force)     |   +1   |   +3   |  +10   |  ∞  |     5      |    1        |
/// |  3 | intelligence       | Ine            |   +1   |   +3   |  +10   |  ∞  |     5      |    1        |
/// |  4 | chance             | Cha            |   +1   |   +3   |  +10   |  ∞  |     5      |    1        |
/// |  5 | agility            | Age            |   +1   |   +3   |  +10   |  ∞  |     5      |    1        |
/// |  6 | range              | Po (Portée)    |   +1   |   —    |   —    |  1  |   255      |   51        |
/// |  7 | movement           | Ga Pme (+1 PM) |   +1   |   —    |   —    |  1  |   450      |   90        |
/// |  8 | action             | Ga Pa  (+1 PA) |   +1   |   —    |   —    |  1  |   500      |  100        |
/// |  9 | critical           | Cri (+1 crit)  |   +1   |   —    |   —    | 10  |    50      |   10        |
/// | 10 | raw_damage         | Do (global)    |   +1   |   —    |   —    |  ∞  |   100      |   20        |
/// | 11 | critical_chance    |  — NOT-RUNEABLE (combat-DEAD; reseed folds it into `critical` per mandate)    |
/// | 12 | critical_outcomes  |  — NOT-RUNEABLE (no Retro rune; combat-UNFOLDED per combat_gear.move)         |
/// | 13 | earth_resistance   | Ré Terre       |   +1   |   +3   |  +10   |  ∞  |    10      |    2        |
/// | 14 | fire_resistance    | Ré Feu         |   +1   |   +3   |  +10   |  ∞  |    10      |    2        |
/// | 15 | water_resistance   | Ré Eau         |   +1   |   +3   |  +10   |  ∞  |    10      |    2        |
/// | 16 | air_resistance     | Ré Air         |   +1   |   +3   |  +10   |  ∞  |    10      |    2        |
///
/// Single-tier majors (Po/Ga Pme/Ga Pa/Do/Cri) carry Ba ONLY; the app caps (Po·PM·PA=1, Cri=10) come from R1.
/// The 5 previously-missing weights are the DECISIONS 2135 ruling: action=100, movement=90, range=51 (Po-tier),
/// Cri=10; critical_outcomes has NO catalog rune → NOT-RUNEABLE explicitly, never a default.
/// CRIT CONVERGENCE (Option C): the Cri rune targets LIVE `critical`(9) — the stat
/// spell-side combat actually consumes as the crit denominator reducer (`spell::is_critical` crit_bonus via
/// equipment_stats.move's fold). `critical_chance`(11) is combat-DEAD (deliberately absent from the fold — the
/// reseed writes its authored values into canonical `critical`); it keeps its DECISIONS-2135 unit weight (10)
/// solely as the `selectStatToReduce` price on legacy pre-reseed rolls, and is never runeable again.
/// Vitality (row 0) amounts = +3/+10/+30 ("retro/legacy 1.29 exact" — Shivas-1.29
/// corpus, SQL gid1523/1548/1554), overriding R1's back-derived +5/+15/+50; unit weight stays 0.2/pt (×5=1) so
/// derived retro weights recompute to 0.6/2.0/6.0 (the 1.0/3.0/10.0 R1 weights belonged to the wrong amounts).
/// `Signature` (R1, gid 7508, weight 0, brands the crafter name) is `signature_weight()` — a rune with NO stat
/// target that never touches puits/quality; main-side handles the branding.
///
/// ── SCOPE (declared, not smuggled) ──────────────────────────────────────────────────────────────────────
/// Retro rune families with NO 17-field home are EXCLUDED (unreachable on-chain — no field to scribe onto and
/// never yielded by a crush of the 17-field lines): Puissance, Initiative, Pods, Invocations (`Invo`, R1 max 3),
/// Prospection, Soins, Fuite, Tacle, Retrait/Esquive PA·PM, Pièges (Pi/Pi Per), Dommages Renvoyés, per-element
/// DAMAGE, %-resistances, late %Do/%Ré, Rune de Chasse, Rune de Transport (a consumable, not forgemagie). Their
/// R1 rows + the 4 disputed weights (Ra Pui 20-vs-6 · Pa Prospe gid/wt · Do Ren 5-vs-10 · Ré Per Mé/Di 15-vs-10,
/// R1 dispute 4 — all non-17-field) stay single-homed in `docs/RETRO_RUNES_RESEARCH.md`. Encoding them as live
/// constants would be dead code (YAGNI); if the on-chain stat vocab ever grows past 17, re-home them here.
module aresrpg_foundation::rune_catalog;

// ╔════════════════ [ Stat ids (ItemStatistics field order — the "kind" key) ] ═ ]

const STAT_VITALITY: u8 = 0;
const STAT_WISDOM: u8 = 1;
const STAT_STRENGTH: u8 = 2;
const STAT_INTELLIGENCE: u8 = 3;
const STAT_CHANCE: u8 = 4;
const STAT_AGILITY: u8 = 5;
const STAT_RANGE: u8 = 6;
const STAT_MOVEMENT: u8 = 7;
const STAT_ACTION: u8 = 8;
const STAT_CRITICAL: u8 = 9;
const STAT_RAW_DAMAGE: u8 = 10;
const STAT_CRITICAL_CHANCE: u8 = 11;
const STAT_CRITICAL_OUTCOMES: u8 = 12;
const STAT_EARTH_RESISTANCE: u8 = 13;
const STAT_FIRE_RESISTANCE: u8 = 14;
const STAT_WATER_RESISTANCE: u8 = 15;
const STAT_AIR_RESISTANCE: u8 = 16;

/// The 17-field block size — every stat vector the forgemagie/crush lanes pass MUST be exactly this long.
const STAT_COUNT: u64 = 17;

/// All weights are stored ×5 so Retro's fractional Vi (0.2/pt) stays integral (see module doc).
const WEIGHT_SCALE: u64 = 5;

// ╔════════════════ [ Rune tiers (RuneConfig.tier: 1=Ba small, 2=Pa medium, 3=Ra large) ] ═ ]

const TIER_BA: u8 = 1;
const TIER_PA: u8 = 2;
const TIER_RA: u8 = 3;

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const EBadStat: u64 = 1; // stat id outside 0..16
const EBadTier: u64 = 2; // tier outside 1..3
const ENotRuneable: u64 = 3; // (stat, tier) has no rune in the Retro catalog

// ╔════════════════ [ Tables (index = stat id 0..16) ] ══════════════════════ ]

/// Forgemagie per-point weight of each stat, ×5 (Retro wt/pt column of the module table). Defined for ALL 17
/// fields — the 2 non-runeable ones still need a price for `selectStatToReduce` on mint-rolled values:
/// critical = 50 (the Cri retro weight 10 ×5 — the rune's home since the 2026-07-17 crit convergence; the
/// consistency law demands it: rune_weight(Cri) = 1 × 50 = R1's Cri weight) · critical_chance = 50 (keeps its
/// DECISIONS-2135 price for `selectStatToReduce` on legacy pre-reseed rolls; combat-dead, never runeable) ·
/// critical_outcomes = 5 (reference-corpus getOrDefault(1.0) ×5 — absent from both catalogs; the sealed source's default).
const UNIT_WEIGHTS: vector<u64> = vector[1, 15, 5, 5, 5, 5, 255, 450, 500, 50, 100, 50, 5, 10, 10, 10, 10];

/// 1 = a Retro rune can target this field; 0 = NOT-RUNEABLE (explicit per DECISIONS — never a silent default).
/// critical_chance(11) + critical_outcomes(12) are the two non-runeable fields (crit convergence 2026-07-17:
/// the Cri rune moved from dead 11 to live `critical`(9)).
const RUNEABLE: vector<u8> = vector[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1];

/// Hard per-stat application cap (0 = uncapped). R1 single-tier majors: range/movement/action 1, Cri 10.
const MAX_APPS: vector<u64> = vector[0, 0, 0, 0, 0, 0, 1, 1, 1, 10, 0, 0, 0, 0, 0, 0, 0];

/// Stat points added per rune, per tier (0 = that tier has no rune). Single-tier runes carry only Ba.
/// Rune WEIGHT is DERIVED: `rune_weight = amount × unit_weight` — exact for every R1 row (consistency law).
const BA_AMOUNT: vector<u64> = vector[3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1];
const PA_AMOUNT: vector<u64> = vector[10, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 3, 3, 3, 3];
// DISPUTED: the Ra elemental-resist rune (+10, retro wt 20 = amount 10 × unit 2) is R1's late-ID cluster
// (GIDs 29683+, 1-2 sources, "WEAKEST rows"); INCLUDED per the synthesis ruling. Open review point ⚑.
const RA_AMOUNT: vector<u64> = vector[30, 10, 10, 10, 10, 10, 0, 0, 0, 0, 0, 0, 0, 10, 10, 10, 10];

// ╔════════════════ [ Stat-id constant accessors (single home for main-side + siblings) ] ═ ]

public fun stat_vitality(): u8 { STAT_VITALITY }
public fun stat_wisdom(): u8 { STAT_WISDOM }
public fun stat_strength(): u8 { STAT_STRENGTH }
public fun stat_intelligence(): u8 { STAT_INTELLIGENCE }
public fun stat_chance(): u8 { STAT_CHANCE }
public fun stat_agility(): u8 { STAT_AGILITY }
public fun stat_range(): u8 { STAT_RANGE }
public fun stat_movement(): u8 { STAT_MOVEMENT }
public fun stat_action(): u8 { STAT_ACTION }
public fun stat_critical(): u8 { STAT_CRITICAL }
public fun stat_raw_damage(): u8 { STAT_RAW_DAMAGE }
public fun stat_critical_chance(): u8 { STAT_CRITICAL_CHANCE }
public fun stat_critical_outcomes(): u8 { STAT_CRITICAL_OUTCOMES }
public fun stat_earth_resistance(): u8 { STAT_EARTH_RESISTANCE }
public fun stat_fire_resistance(): u8 { STAT_FIRE_RESISTANCE }
public fun stat_water_resistance(): u8 { STAT_WATER_RESISTANCE }
public fun stat_air_resistance(): u8 { STAT_AIR_RESISTANCE }

public fun tier_ba(): u8 { TIER_BA }
public fun tier_pa(): u8 { TIER_PA }
public fun tier_ra(): u8 { TIER_RA }

/// The 17-field block size (raw stat vectors passed to `forgemagie` MUST match this).
public fun stat_count(): u64 { STAT_COUNT }

/// The ×5 weight scale (see module doc) — divide any weight by this for the Retro-unit view.
public fun weight_scale(): u64 { WEIGHT_SCALE }

// ╔════════════════ [ Per-stat accessors ] ═══════════════════════════════════ ]

/// Forgemagie unit weight (per point, ×5) of `stat` — the scribe gain-cap divisor, `selectStatToReduce`
/// pricing, and the crush-yield `unit_weight` term. Defined for ALL 17 fields (incl. the 2 non-runeable ones).
public fun stat_unit_weight(stat: u8): u64 {
  assert!((stat as u64) < STAT_COUNT, EBadStat);
  let t = UNIT_WEIGHTS;
  *t.borrow(stat as u64)
}

/// True iff a Retro rune can be SCRIBED onto `stat`. False for critical_chance(11) + critical_outcomes(12) —
/// the main-side scribe MUST assert this before applying a rune (never default a missing mapping).
public fun is_runeable(stat: u8): bool {
  assert!((stat as u64) < STAT_COUNT, EBadStat);
  let t = RUNEABLE;
  *t.borrow(stat as u64) == 1
}

/// Hard cap on how many of this rune may sit on one item (0 = uncapped). range/movement/action = 1, Cri = 10.
public fun rune_max_apps(stat: u8): u64 {
  assert!((stat as u64) < STAT_COUNT, EBadStat);
  let t = MAX_APPS;
  *t.borrow(stat as u64)
}

/// The highest tier that exists for `stat`'s rune: 3 (Ba/Pa/Ra) for multi-tier stats, 1 (Ba only) for the
/// single-tier majors, 0 for a non-runeable stat. Lets the crush lane iterate tiers without guessing.
public fun max_tier(stat: u8): u8 {
  if (!is_runeable(stat)) return 0;
  let ra = RA_AMOUNT;
  if (*ra.borrow(stat as u64) > 0) TIER_RA
  else TIER_BA
}

/// True iff `(stat, tier)` names a real Retro rune (a runeable stat whose tier is populated).
public fun has_rune(stat: u8, tier: u8): bool {
  if (!is_runeable(stat)) return false;
  if (tier < TIER_BA || tier > TIER_RA) return false;
  tier_amount_vec(tier).borrow(stat as u64) != &0
}

/// Stat points a `(stat, tier)` rune adds on application (the scribe `rune.value`). Aborts on a missing rune.
public fun rune_amount(stat: u8, tier: u8): u64 {
  assert!(has_rune(stat, tier), ENotRuneable);
  *tier_amount_vec(tier).borrow(stat as u64)
}

/// Forgemagie WEIGHT (×5) of a `(stat, tier)` rune — the puits cost on scribe + the `rune_weight` denominator
/// on crush yield. DERIVED `amount × unit_weight` (exact for every R1 row; the puits-conservation law: the
/// weight a rune adds equals the weight its points release if destroyed). Aborts on a missing rune.
public fun rune_weight(stat: u8, tier: u8): u64 {
  rune_amount(stat, tier) * stat_unit_weight(stat)
}

/// Rune de Signature (R1 gid 7508): weight 0, no stat target — brands the crafter, never touches puits/quality.
public fun signature_weight(): u64 { 0 }

// ╔════════════════ [ Internal tier selectors ] ══════════════════════════════ ]

fun tier_amount_vec(tier: u8): vector<u64> {
  if (tier == TIER_BA) BA_AMOUNT
  else if (tier == TIER_PA) PA_AMOUNT
  else if (tier == TIER_RA) RA_AMOUNT
  else abort EBadTier
}
