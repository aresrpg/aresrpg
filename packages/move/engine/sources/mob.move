/// MOB — the spawned `FightMob` instance + its §17.21 STOCHASTIC turn AI + the plain `MobSpec` input (S-46
/// final split: the engine knows NOTHING of content objects — the consumer package passes a plain spec built
/// from ITS templates; loot rows ride the spec as plain data for the fight's win-content cache). `spawn_seeded`
/// derives level/archimob/cell from the group's DISCOVERY-time seed (composition is public at discovery).
module aresrpg_fight::mob;

use aresrpg_foundation::prng;
use aresrpg_foundation::{mob_ai, spell::{Self, Stats}, spell_effect::{SpellLevel, Effect}};
use aresrpg_fight::participant;

// ── §17.21 STOCHASTIC AI weights (mob decisions must be genuinely unpredictable).
// The NAMED tuning constants for the weighted draw over the viable-action set (foundation `mob_ai`). SPREAD
// GUARANTEE: the band is [40, 120] (max/min ratio 3), so with 3+ viable actions no single action exceeds
// 120/(120+40+40) = 60% likelihood — competence rides the viable-set filter + this MILD weighting, never argmax.
const AI_W_ATTACK_NOW: u64 = 120; // cast an attack spell from the current cell
const AI_W_ATTACK_MOVE: u64 = 80; // advance (BFS) then cast
const AI_W_HEAL: u64 = 120; // heal a WOUNDED ally (support mobs lean support, §17.21)
const AI_W_REPOSITION: u64 = 40; // advance toward a target without casting

// ╔════════════════ [ Loot entry (plain WIN-content row — the consumer builds it) ] ═ ]

/// One WIN-loot row: `chance_bp` (basis points, boosted by the claimer's chance stat at claim), quantity band.
/// `item_template` is an ID (seam law — the consumer's claim passes its actual template at mint time).
public struct MobLootEntry has copy, drop, store {
  item_template: ID,
  chance_bp: u16,
  min_qty: u16,
  max_qty: u16,
}

public fun new_loot_entry(item_template: ID, chance_bp: u16, min_qty: u16, max_qty: u16): MobLootEntry {
  MobLootEntry { item_template, chance_bp, min_qty, max_qty }
}

public fun loot_entry_item_template(e: &MobLootEntry): ID { e.item_template }
public fun loot_entry_chance_bp(e: &MobLootEntry): u16 { e.chance_bp }
public fun loot_entry_min_qty(e: &MobLootEntry): u16 { e.min_qty }
public fun loot_entry_max_qty(e: &MobLootEntry): u16 { e.max_qty }

// ╔════════════════ [ Mob spec (plain IO — the consumer mirrors its template into this) ] ═ ]

const MAX_SPELLS: u64 = 4; // §17.21 mob spell-list bound (bounded compute, exact client prediction)
const MAX_LOOT: u64 = 16; // §17.14 loot entries per group (the single-path-claim bound)

const ETooManySpells: u64 = 101; // new_mob_spec: spell kit exceeds MAX_SPELLS
const ETooManyLoot: u64 = 102; // new_mob_spec: loot table exceeds MAX_LOOT

/// The PLAIN combat + win-content spec one group spawns from. `stats` arrive already DECENTERED (true
/// magnitudes — the consumer decodes its own storage convention before calling). Copy/drop IO data.
public struct MobSpec has copy, drop {
  min_level: u16,
  max_level: u16,
  base_hp: u64,
  ap: u64,
  mp: u64,
  stats: Stats,
  spells: vector<SpellLevel>,
  xp_reward: u64,
  loot: vector<MobLootEntry>,
}

public fun new_mob_spec(
  min_level: u16,
  max_level: u16,
  base_hp: u64,
  ap: u64,
  mp: u64,
  stats: Stats,
  spells: vector<SpellLevel>,
  xp_reward: u64,
  loot: vector<MobLootEntry>,
): MobSpec {
  assert!(spells.length() <= MAX_SPELLS, ETooManySpells);
  assert!(loot.length() <= MAX_LOOT, ETooManyLoot);
  MobSpec { min_level, max_level, base_hp, ap, mp, stats, spells, xp_reward, loot }
}

public fun spec_xp(spec: &MobSpec): u64 { spec.xp_reward }
public fun spec_loot(spec: &MobSpec): vector<MobLootEntry> { spec.loot }

// ╔════════════════ [ Mob kit (shared combat data — ONE home per group, not per instance) ] ═ ]

/// The combat kit EVERY mob in a group shares (one `MobSpec` → N identical mobs): the `spells` list + the AP/MP
/// refill budget. Stored ONCE on the Fight's `GroupContent` (mob-kit dedup) — the shared Fight re-serializes every
/// byte on every action, so N duplicate kits were taxed per turn/crank. STATS are NO LONGER shared: each
/// `FightMob` now owns a MUTABLE per-fight combat block (base_stats + live stats) so a drain/alter lands on THAT
/// mob alone (one shredded boss must not shred its clones). The kit keeps only the truly
/// group-identical data (spells + AP/MP base).
public struct MobKit has store, drop {
  spells: vector<SpellLevel>,
  base_ap: u64,
  base_mp: u64,
}

/// Build the group's shared kit from its spec (the spec's `ap`/`mp` ARE the refill base — snapshot law: a live
/// template edit never changes an in-progress fight's economy). Stats ride each spawned `FightMob`, not the kit.
public(package) fun kit_of(spec: &MobSpec): MobKit {
  MobKit { spells: spec.spells, base_ap: spec.ap, base_mp: spec.mp }
}

/// The empty kit for a mob-less fight (PvP): never read (mode-gated), but keeps `GroupContent` uniform.
public(package) fun empty_kit(): MobKit {
  MobKit { spells: vector[], base_ap: 0, base_mp: 0 }
}

public(package) fun kit_spell_at(kit: &MobKit, i: u64): &SpellLevel { kit.spells.borrow(i) }
public(package) fun kit_spells(kit: &MobKit): &vector<SpellLevel> { &kit.spells }
public(package) fun kit_base_ap(kit: &MobKit): u64 { kit.base_ap }
public(package) fun kit_base_mp(kit: &MobKit): u64 { kit.base_mp }

// ╔════════════════ [ Spawned instance ] ═════════════════════════════════════ ]

/// One spawned mob — PER-INSTANCE state ONLY. The shared combat kit (stats/spells/AP-MP base) lives ONCE on the
/// Fight's `MobKit` (see `GroupContent`): every mob a group spawns is identical, so duplicating the kit per
/// instance was pure byte-tax on the shared Fight. `ap`/`mp` are the live budget, refilled each turn from the
/// group kit base (F-13, `begin_turn`). `is_archimob` records the §8 rarity roll (the variant stat/loot swap is a
/// content-integration seam — the ROLL lives here). `level`/`hp`/`cell` are the real rolled/live per-mob values.
public struct FightMob has store, drop {
  level: u64,
  hp: u64,
  max_hp: u64,
  cell: u64,
  ap: u64,
  mp: u64,
  is_archimob: bool,
  // MUTABLE per-fight combat block: the template snapshot is copied in at spawn; drains land on
  // ap/mp, PERMANENT alters mutate `base_stats`, TIMED alters live as board rows and `stats` re-derives from
  // base + rows (the `participant` twin). `stats` is the LIVE read every damage/resist/range calc uses.
  stats: Stats,
  base_stats: Stats,
}

/// Spawn ONE instance: roll level in [min,max], reference-scale hp, roll the §8 archimob flag (`archimob_bp`
/// basis points), decenter resistances, place on a Random on-mask / non-blocker / non-start cell, snapshot the
/// spell kit. Deterministic given the generator. `starts` = both sides' start cells (never spawn on one).
/// SEEDED spawn — all mobs are known at the time of discovery — every roll derives from the
/// group's DISCOVERY-time seed via the foundation prng, so the exact composition (level, archimob, cell) is
/// public knowledge from the moment the zone spawns the group, and fight creation is fully DETERMINISTIC
/// (the chain verifier forbids &Random on the public create). Returns the advanced prng state.
public(package) fun spawn_seeded(
  tmpl: &MobSpec,
  mask: &vector<u64>,
  obstacles: &vector<u64>,
  holes: &vector<u64>,
  starts: &vector<u64>,
  archimob_bp: u64,
  state: u64,
): (FightMob, u64) {
  let min_level = tmpl.min_level as u64;
  let max_level = tmpl.max_level as u64;
  let (level, state) = if (max_level == min_level) (min_level, state)
    else { let (new_state, lvl) = prng::rng_range(state, min_level, max_level); (lvl, new_state) };
  let hp = mob_ai::scaled_hp(tmpl.base_hp, min_level, max_level, level);
  let (state, aroll) = prng::rng_int(state, 10000);
  let is_archimob = archimob_bp > 0 && aroll < archimob_bp;
  let (cell, state) = mob_ai::seeded_spawn_cell(mask, obstacles, holes, starts, state);
  (FightMob {
    level,
    hp,
    max_hp: hp,
    cell,
    ap: tmpl.ap, // live budget — refilled from the group kit base each turn (begin_turn)
    mp: tmpl.mp,
    is_archimob,
    // MUTABLE per-fight combat block seeded from the (already-DECENTERED) spec stats: live == base at spawn,
    // then drains/alters diverge it per mob.
    stats: tmpl.stats,
    base_stats: tmpl.stats,
  }, state)
}

// ── reads ──
public(package) fun hp(self: &FightMob): u64 { self.hp }
public(package) fun max_hp(self: &FightMob): u64 { self.max_hp }
public(package) fun cell(self: &FightMob): u64 { self.cell }
public(package) fun level(self: &FightMob): u64 { self.level }
public(package) fun ap(self: &FightMob): u64 { self.ap }
public(package) fun mp(self: &FightMob): u64 { self.mp }
public(package) fun is_alive(self: &FightMob): bool { self.hp > 0 }
public(package) fun is_archimob(self: &FightMob): bool { self.is_archimob }
/// The mob's LIVE combat stats (base + timed alter rows) — every mob damage/resist/range read goes through this
/// per-mob block now, NOT a shared kit (so a shred hits one mob alone).
public(package) fun stats(self: &FightMob): &Stats { &self.stats }

// ── mutations ──
public(package) fun set_cell(self: &mut FightMob, cell: u64) { self.cell = cell; }

/// Heal, capped at max_hp — the `participant::apply_heal` twin (support mobs heal their allies;
/// the resolver's mob-side k_heal application lands here). A dead mob (hp 0) stays dead — no revive-by-heal.
public(package) fun apply_heal(self: &mut FightMob, amount: u64) {
  if (self.hp == 0) return;
  let h = self.hp + amount;
  self.hp = if (h > self.max_hp) self.max_hp else h;
}
/// Start this mob's turn: refill AP/MP to `net_refill(base, debt, credit)` (F-13 +
/// MOB_DEBUFF_HAT P1 #2 — a player's AP/MP-removal reduces the refilled pool for the row's duration, an ALLY
/// mob's feed BOOSTS it: "his allies add MP to him" survives to the boss's act now, exactly the
/// `participant::begin_turn` twin). The one refill law lives in `participant::net_refill` (floored at 0). The
/// base rides the shared `MobKit`; the caller passes it + both adjustments (`cast::point_adjust`).
public(package) fun begin_turn(self: &mut FightMob, base_ap: u64, base_mp: u64, ap_debt: u64, mp_debt: u64, ap_credit: u64, mp_credit: u64) {
  self.ap = participant::net_refill(base_ap, ap_debt, ap_credit);
  self.mp = participant::net_refill(base_mp, mp_debt, mp_credit);
}
public(package) fun spend_ap(self: &mut FightMob, n: u64) { self.ap = if (self.ap > n) self.ap - n else 0; }
public(package) fun damage(self: &mut FightMob, dmg: u64) { self.hp = if (self.hp > dmg) self.hp - dmg else 0; }
public(package) fun forfeit_actions(self: &mut FightMob) { self.ap = 0; self.mp = 0; }
/// Erosion twin of `participant::erode_max_hp`: max HP floors at one and never falls below current HP.
public(package) fun erode_max_hp(self: &mut FightMob, amount: u64) {
  self.max_hp = if (self.max_hp > amount) self.max_hp - amount else 1;
  if (self.hp > self.max_hp) self.hp = self.max_hp;
}
public(package) fun add_max_hp_bonus(self: &mut FightMob, amount: u64) { self.max_hp = self.max_hp + amount; }
public(package) fun remove_max_hp_bonus(self: &mut FightMob, amount: u64) {
  self.max_hp = if (self.max_hp > amount) self.max_hp - amount else 1;
  if (self.hp > self.max_hp) self.hp = self.max_hp;
}

// ── points economy (mob targets are real now) ──
/// GIVE points: +n to AP (kind 0) / MP (1). The ally-mob→boss feed ("his allies add MP to him"). Uncapped like
/// the `participant::give_points` twin — the spell bands keep `n` small (no player-side clamp exists to mirror).
public(package) fun give_points(self: &mut FightMob, point_kind: u8, n: u64) {
  if (point_kind == 0) self.ap = self.ap + n else self.mp = self.mp + n;
}
/// DIRECT drain: −n from the live pool, floored at 0 (the immediate half of a removal; the persistent half is a
/// board debt row the next `begin_turn` honors). `n` is the already-dodge-resolved removed count.
public(package) fun drain_points(self: &mut FightMob, point_kind: u8, n: u64) {
  if (point_kind == 0) self.ap = if (self.ap > n) self.ap - n else 0
  else self.mp = if (self.mp > n) self.mp - n else 0;
}

// ── stat/resist alters on the per-fight block (the `participant` twins) ──
/// PERMANENT (turns==0) alter → the mob's BASE block, saturating (no revert; the 0-floor is its semantics). The
/// caller re-derives live right after (`refresh_stats`).
public(package) fun alter_base_stat(self: &mut FightMob, field: u8, amount: u64, neg: bool) {
  if (neg) spell::sub_stat(&mut self.base_stats, field, amount) else spell::add_stat(&mut self.base_stats, field, amount);
}
public(package) fun alter_base_resist(self: &mut FightMob, element: u8, amount: u64, neg: bool) {
  if (neg) spell::sub_resist(&mut self.base_stats, element, amount) else spell::add_resist(&mut self.base_stats, element, amount);
}
/// RE-DERIVE the live block from base + the mob's live timed alter rows — the ONE fold home lives in `participant`
/// (add + one saturating sub pass); a mob reuses it so a debuff clamped at 0 can never leak a permanent gain when
/// its row leaves. Apply and expiry both converge here.
public(package) fun refresh_stats(self: &mut FightMob, rows: &vector<Effect>) {
  self.stats = participant::derive_live_stats(&self.base_stats, rows);
}

// ╔════════════════ [ §17.21 turn AI — thin shell over foundation::mob_ai (S-46 extraction) ] ═ ]

/// Decide this mob's turn — the STOCHASTIC weighted policy lives in `aresrpg_foundation::mob_ai::decide_turn`
/// (enumerate every VIABLE action — per-target attacks, per-wounded-ally heals,
/// repositions — filter nonsense, then a WEIGHTED DRAW off `rng`, seeded upstream from the crank's fresh
/// `&Random`). This shell unrolls the per-instance FightMob fields (cell/ap/mp) + the group's shared kit `spells`
/// (passed in — no longer per instance) and binds the NAMED AI_W_* weights.
public(package) fun decide_turn(
  self: &FightMob,
  spells: &vector<SpellLevel>, // the group's shared kit spells (from `fight::group_kit`)
  target_cells: &vector<u64>,
  ally_cells: &vector<u64>,
  ally_missing: &vector<u64>,
  move_blocked: &vector<u64>, // a MASK_WORDS-word wall BITSET (from cast::move_blocked_cells*), NOT a cell list
  los_obstacles: &vector<u64>, // LOS blocker CELL LIST (line_of_sight iterates it)
  rng: &mut u64,
): (u64, Option<u64>, u64) {
  let w = mob_ai::new_weights(AI_W_ATTACK_NOW, AI_W_ATTACK_MOVE, AI_W_HEAL, AI_W_REPOSITION);
  // the mob's LIVE +range stat extends a modifiable spell's band (a shred row shrinks it) — the player-parity read.
  let range_bonus = spell::stat_range(&self.stats);
  mob_ai::decide_turn(self.cell, self.ap, self.mp, spells, target_cells, ally_cells, ally_missing, move_blocked, los_obstacles, range_bonus, &w, rng)
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun scaled_hp_for_testing(base_hp: u64, min_level: u64, max_level: u64, level: u64): u64 {
  mob_ai::scaled_hp(base_hp, min_level, max_level, level)
}

/// Build a lean `FightMob` at a KNOWN cell/hp/ap/mp — for the deterministic §17.21 policy tests (no Random
/// spawn, no fight scaffold). The kit spells now ride the group, so tests pass them straight to `decide_turn`;
/// this constructor no longer carries them.
#[test_only]
public fun new_mob_for_testing(cell: u64, hp: u64, max_hp: u64, ap: u64, mp: u64): FightMob {
  let z = spell::new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  FightMob { level: 1, hp, max_hp, cell, ap, mp, is_archimob: false, stats: z, base_stats: z }
}

/// Build a `FightMob` at a KNOWN cell with an explicit combat block — for the mob drain/alter/range tests that
/// need a real per-fight stat block (agility for dodge, resist for shred, range for band-shrink).
#[test_only]
public fun new_mob_with_stats_for_testing(cell: u64, hp: u64, ap: u64, mp: u64, stats: Stats): FightMob {
  FightMob { level: 1, hp, max_hp: hp, cell, ap, mp, is_archimob: false, stats, base_stats: stats }
}

#[test_only]
public fun set_stats_for_testing(self: &mut FightMob, stats: Stats) { self.stats = stats; self.base_stats = stats; }
