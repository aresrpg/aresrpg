// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// PARTICIPANT — one fighter's live per-fight state (a player seat). Owns the mutable combat values the turn
/// machine + cast resolver read and write: position, AP/MP economy, live stats (RE-DERIVED from the base block +
/// the effect board's live timed alter rows — see `refresh_stats`), and HP. The `Fight` holds a
/// `vector<Participant>`; this module owns the struct + every accessor so the field surface stays in one home.
///
/// SNAPSHOT LAW: `class`/`level`/`base_stats`/`max_hp`/`base_ap`/`base_mp` are SNAPSHOTTED at join from the
/// character's combat state (a declared `aresrpg_game` seam — see `fight::create`). A later character edit
/// never retroactively changes an in-progress fight; the snapshot IS the fight's source of truth for this seat.
module aresrpg_fight::participant;

use aresrpg_foundation::{spell::{Self, Stats}, spell_effect::{Self, Effect}};
use std::string::String;
use sui::vec_map::VecMap;

// ╔════════════════ [ Type ] ═════════════════════════════════════════════════ ]

public struct Participant has drop, store {
  character: ID, // the escrowed/authorised character's id (auth is against `owner`)
  owner: address, // the wallet that may act for this seat (a kiosk-locked char can't prove ownership itself)
  team: u8, // 0 = the players' side (PvM); reserved so dungeon/kolizeum can reuse the engine with two player sides
  class: String, // resolver class-book gating (a caster only casts its own class's spells)
  level: u64,
  stats: Stats, // LIVE — always `base_stats` + the live timed alter rows (re-derived by `refresh_stats`)
  base_stats: Stats, // the join snapshot + permanent (turns==0) alters; timed effects NEVER touch it
  hp: u64,
  max_hp: u64,
  ap: u64, // refilled to base_ap at the start of the seat's turn
  mp: u64, // refilled to base_mp at the start of the seat's turn
  base_ap: u64,
  base_mp: u64,
  cell: u64,
  ready: bool, // placement-phase READY flag
  casts_this_turn: u64, // per-turn COMMITTED-ACTION counter (casts + weapon strikes): the crit/damage SLOT index
                        // AND the coarse casts_per_turn gate (total damaging actions this turn < the cast's cap)
  weapon: Weapon, // §17.27 equipped-weapon attack line
  spell_levels: VecMap<ID, u8>, // F-07 seat-time snapshot: spell id → learned level (absent = 1)
}

// ╔════════════════ [ Weapon — the §17.27 equipped-weapon attack snapshot ] ═ ]

/// The equipped weapon's attack line (§17.27): an elemental damage RANGE `[damage, damage_max]` (crit swaps to
/// `[crit_damage, crit_damage_max]`), an AP `ap_cost`, and a Manhattan `reach` by weapon family. #577 — a strike
/// rolls one value in that range off the turn seed (previewable), exactly like a spell; `damage_max == damage`
/// is the degenerate FIXED base (pre-#577 behaviour). SEAM: comes from the declared game EquipmentShim read;
/// no weapon is granted at creation (early weapons = easy loot; bare hands = unarmed_line). Repeatable while AP lasts.
public struct Weapon has copy, drop, store {
  element: u8,
  damage: u64, // #577 — the MIN of the normal-hit range
  damage_max: u64, // #577 — the MAX (== damage ⇒ the fixed base every constructor here still authors)
  crit_damage: u64, // #577 — the MIN of the crit range
  crit_damage_max: u64, // #577 — the MAX (== crit_damage ⇒ fixed)
  crit_rate: u64, // 1-in-X; 0 = never crit
  ap_cost: u64,
  reach: u64,
}

/// PACKAGE-PRIVATE by the anti-forgery ruling (F-02): a public weapon constructor + a public combatant
/// constructor + a raw-param `create` was the forge-a-god-seat exploit chain. Fight-internal code (and this
/// package's tests) build weapons; PTBs never do. FIXED alias (range == single value); `new_weapon_ranged` authors a spread.
public(package) fun new_weapon(element: u8, damage: u64, crit_damage: u64, crit_rate: u64, ap_cost: u64, reach: u64): Weapon {
  Weapon { element, damage, damage_max: damage, crit_damage, crit_damage_max: crit_damage, crit_rate, ap_cost, reach }
}

/// #577 — RANGE-aware weapon constructor: `[damage, damage_max]` normal, `[crit_damage, crit_damage_max]` crit.
public(package) fun new_weapon_ranged(element: u8, damage: u64, damage_max: u64, crit_damage: u64, crit_damage_max: u64, crit_rate: u64, ap_cost: u64, reach: u64): Weapon {
  Weapon { element, damage, damage_max, crit_damage, crit_damage_max, crit_rate, ap_cost, reach }
}

/// ONE authored damage LINE of the equipped weapon (§17.27 wave-2a): an elemental damage RANGE `[damage,
/// damage_max]` (crit swaps to `[crit_damage, crit_damage_max]`), keyed by `element` (spell::el_* id). A weapon
/// carries a `vector<WeaponLine>` — a multi-element weapon resolves each line vs its own resist, exactly as a
/// multi-element spell does. The line carries ONLY damage; the SHARED mechanics (ap_cost / reach / crit_rate) stay
/// on `Weapon`. PUBLIC (like `new_combatant`): the game package builds lines from a character's chain-verified
/// equipped item and threads them through the BRAND-GATED `fight::create`/`join` (a forged line can only enter a
/// fight the forger self-brands — worthless loot, the F-02 guarantee).
public struct WeaponLine has copy, drop, store {
  element: u8,
  damage: u64, // #577 — MIN of the normal-hit range
  damage_max: u64, // #577 — MAX (== damage ⇒ fixed)
  crit_damage: u64, // #577 — MIN of the crit range
  crit_damage_max: u64, // #577 — MAX (== crit_damage ⇒ fixed)
  // §387 — the AUTHORED cell-set shape OVERRIDE. `spell_effect::shape_no_override()` (255) ⇒ no override, resolve
  // the category table. Carried on the line so an authored item can drive its strike's cell set.
  area_shape: u8,
  area_size: u64,
}

/// FIXED alias (range == single value), NO shape override (the category table resolves). `new_weapon_line_ranged`
/// authors a spread; `new_weapon_line_shaped` authors a shape override.
public fun new_weapon_line(element: u8, damage: u64, crit_damage: u64): WeaponLine {
  WeaponLine { element, damage, damage_max: damage, crit_damage, crit_damage_max: crit_damage, area_shape: spell_effect::shape_no_override(), area_size: 0 }
}

/// #577 — RANGE-aware line constructor: `[damage, damage_max]` normal, `[crit_damage, crit_damage_max]` crit. NO shape override.
public fun new_weapon_line_ranged(element: u8, damage: u64, damage_max: u64, crit_damage: u64, crit_damage_max: u64): WeaponLine {
  WeaponLine { element, damage, damage_max, crit_damage, crit_damage_max, area_shape: spell_effect::shape_no_override(), area_size: 0 }
}

/// The shape-OVERRIDE authoring constructor: a ranged line PLUS an explicit `(area_shape, area_size)` that
/// overrides the category resolver. Pass `shape_no_override()` for no override.
public fun new_weapon_line_shaped(element: u8, damage: u64, damage_max: u64, crit_damage: u64, crit_damage_max: u64, area_shape: u8, area_size: u64): WeaponLine {
  WeaponLine { element, damage, damage_max, crit_damage, crit_damage_max, area_shape, area_size }
}

public(package) fun wl_element(w: &WeaponLine): u8 { w.element }
public(package) fun wl_damage(w: &WeaponLine): u64 { w.damage } // #577 — MIN of the normal range
public(package) fun wl_damage_max(w: &WeaponLine): u64 { w.damage_max } // #577 — MAX
public(package) fun wl_crit_damage(w: &WeaponLine): u64 { w.crit_damage } // #577 — MIN of the crit range
public(package) fun wl_crit_damage_max(w: &WeaponLine): u64 { w.crit_damage_max } // #577 — MAX

// ── the §17.27 v1 per-family attack lines (parallel CONST tables, index-aligned with WL_FAMILIES). A CONST by
// the same shape-freeze ruling as equipment's CLASS_FAMILIES: reach/AP-cost are MECHANICS, not dials. The damage
// numbers are the DECLARED v1 tuning band (§17.17) — the S-02 seal owns rebalancing (package upgrade, or a
// migration to per-item damage lines if itemization demands it). Slugs mirror `equipment::WEAPON_FAMILIES`.
const WL_FAMILIES: vector<vector<u8>> = vector[
  b"longsword", b"daggers", b"battleaxe", b"spear", b"staff",
  b"spellbook", b"bow", b"axe", b"mace", b"club", b"sword",
];
const WL_ELEMENT: vector<u8> = vector[2, 3, 2, 2, 0, 1, 3, 0, 2, 2, 2]; // spell::el_* ids: 0 fire · 1 water · 2 earth · 3 air
const WL_DAMAGE: vector<u64> = vector[18, 10, 22, 14, 12, 10, 15, 20, 17, 16, 15];
const WL_CRIT_DAMAGE: vector<u64> = vector[27, 16, 33, 21, 18, 15, 22, 30, 25, 24, 22];
const WL_CRIT_RATE: vector<u64> = vector[20, 10, 25, 20, 20, 20, 20, 22, 20, 18, 18]; // 1-in-X
const WL_AP_COST: vector<u64> = vector[4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3];
const WL_REACH: vector<u64> = vector[1, 1, 1, 2, 3, 4, 8, 1, 1, 1, 1]; // Manhattan

/// The attack line for an equipped weapon FAMILY (`equipment::equipped_weapon_family` is the feed). `none` — or a
/// slug outside the 11 §3 families (a gathering tool in the weapon slot) — fights BARE-HANDED: a weak earth line,
/// never an abort (a miner ambushed mid-gather still gets a fight, §7). `affinity` (DECISIONS 07-12: the caller
/// decided the equipped family is the wielder's OWN class weapon) scales the damage bases by +10% — nothing else;
/// bare hands never carry affinity (returns before the scale — an unarmed hit has no class).
public fun weapon_line_of(family: Option<String>, affinity: bool): Weapon {
  if (family.is_none()) return unarmed_line();
  let f = family.destroy_some();
  let bytes = f.as_bytes();
  let fams = WL_FAMILIES;
  let n = fams.length();
  let mut i = 0;
  while (i < n) {
    if (&fams[i] == bytes) {
      let (el, dmg, cdmg, crate, ap, reach) = (WL_ELEMENT, WL_DAMAGE, WL_CRIT_DAMAGE, WL_CRIT_RATE, WL_AP_COST, WL_REACH);
      return Weapon {
        element: el[i],
        damage: affinity_scale(dmg[i], affinity),
        damage_max: affinity_scale(dmg[i], affinity), // #577 — the family lines are FIXED (max == min)
        crit_damage: affinity_scale(cdmg[i], affinity),
        crit_damage_max: affinity_scale(cdmg[i], affinity),
        crit_rate: crate[i], // affinity NEVER touches crit_rate / ap_cost / reach (mechanics, not damage)
        ap_cost: ap[i],
        reach: reach[i],
      }
    };
    i = i + 1;
  };
  unarmed_line()
}

/// +10% own-class affinity (DECISIONS 07-12) on a damage base: `(base × 110) / 100`, integer-floored. Applies ONLY
/// to the damage / crit_damage bases; the §17.27 bands are ≥10 so the floor never drops a hit below its unscaled value.
fun affinity_scale(base: u64, affinity: bool): u64 { if (affinity) base * 110 / 100 else base }

/// Bare hands: earth (the guaranteed-resolvable element), low fixed damage, cheap swings, melee reach.
fun unarmed_line(): Weapon {
  Weapon { element: 2, damage: 4, damage_max: 4, crit_damage: 6, crit_damage_max: 6, crit_rate: 30, ap_cost: 3, reach: 1 }
}

/// §387 — `weapon_line_of` with an AUTHORABLE per-template AP cost. `ap_override` some(ap) ⇒ that authored AP; none
/// ⇒ the family constant `WL_AP_COST`. Element / damage / reach / crit stay the family line — only the AP becomes
/// template-authorable. The game reads the item's authored AP (equipment seam) and threads it here at fight entry;
/// the chain never trusts a PTB-supplied AP (the Weapon is built fight-side, F-02).
public fun weapon_line_of_authored(family: Option<String>, affinity: bool, ap_override: Option<u64>): Weapon {
  let mut w = weapon_line_of(family, affinity);
  if (ap_override.is_some()) w.ap_cost = *ap_override.borrow();
  w
}

// ╔════════════════ [ Combatant — the character combat SNAPSHOT (the game-read seam shape) ] ═ ]

/// The plain-value combat snapshot a fight seat is built from. Assembled FIGHT-SIDE ONLY (`fight::combatant_of`
/// borrows the kiosk-locked character and reads game's authentic combat views) — the constructor is
/// PACKAGE-PRIVATE by the anti-forgery ruling (F-02): when a PTB could compose a Combatant, it could seat a
/// fabricated god-snapshot and farm real loot. `copy+drop+store` kept so fight-internal escrow/copy flows
/// (dungeon rosters, kolizeum ephemera) stay cheap.
public struct Combatant has copy, drop, store {
  character: ID,
  class: String,
  level: u64,
  stats: Stats,
  hp: u64,
  max_hp: u64,
  base_ap: u64,
  base_mp: u64,
  weapon: Weapon,
  // F-07: the seat's LEARNED SPELL LEVELS, snapshotted at seat time (spell id → level). Absent = level 1 (the
  // free unlock). Caller-supplied id LIST + authentic DF reads: omission self-hurts, a fake id reads baseline 1.
  spell_levels: VecMap<ID, u8>,
}

public fun new_combatant(character: ID, class: String, level: u64, stats: Stats, hp: u64, max_hp: u64, base_ap: u64, base_mp: u64, weapon: Weapon, spell_levels: VecMap<ID, u8>): Combatant {
  Combatant { character, class, level, stats, hp, max_hp, base_ap, base_mp, weapon, spell_levels }
}

public(package) fun combatant_hp(c: &Combatant): u64 { c.hp }

/// §17.9 EPHEMERAL snapshot (S-13b PvP door): the kolizeum copy enters at FULL HP regardless of world wounds —
/// and nothing ever writes back (results::open skips pvp write-backs), so the real character is untouched.
public fun with_full_hp(c: Combatant): Combatant {
  let Combatant { character, class, level, stats, hp: _, max_hp, base_ap, base_mp, weapon, spell_levels } = c;
  Combatant { character, class, level, stats, hp: max_hp, max_hp, base_ap, base_mp, weapon, spell_levels }
}
public(package) fun combatant_character(c: &Combatant): ID { c.character }

// ╔════════════════ [ Constructor ] ══════════════════════════════════════════ ]

/// A fresh seat from a combat snapshot: AP/MP start at 0 (refilled when its turn lands), not ready, no casts
/// yet, placed at `cell` (the seeded start cell; overwritten in placement). `owner` = the acting wallet.
public(package) fun new(c: Combatant, owner: address, team: u8, cell: u64): Participant {
  let Combatant { character, class, level, stats, hp, max_hp, base_ap, base_mp, weapon, spell_levels } = c;
  Participant { character, owner, team, class, level, stats, base_stats: stats, hp, max_hp, ap: 0, mp: 0, base_ap, base_mp, cell, ready: false, casts_this_turn: 0, weapon, spell_levels }
}

// ── weapon accessors (§17.27 attack resolution) ──
public(package) fun weapon_element(self: &Participant): u8 { self.weapon.element }
public(package) fun weapon_damage(self: &Participant): u64 { self.weapon.damage } // #577 — MIN of the normal range
public(package) fun weapon_damage_max(self: &Participant): u64 { self.weapon.damage_max } // #577 — MAX
public(package) fun weapon_crit_damage(self: &Participant): u64 { self.weapon.crit_damage } // #577 — MIN of the crit range
public(package) fun weapon_crit_damage_max(self: &Participant): u64 { self.weapon.crit_damage_max } // #577 — MAX
public(package) fun weapon_crit_rate(self: &Participant): u64 { self.weapon.crit_rate }
public(package) fun weapon_ap_cost(self: &Participant): u64 { self.weapon.ap_cost }
public(package) fun weapon_reach(self: &Participant): u64 { self.weapon.reach }

// ╔════════════════ [ Reads ] ════════════════════════════════════════════════ ]

public(package) fun character(self: &Participant): ID { self.character }
public(package) fun owner(self: &Participant): address { self.owner }
public(package) fun team(self: &Participant): u8 { self.team }
public(package) fun class(self: &Participant): String { self.class }
public(package) fun level(self: &Participant): u64 { self.level }
public(package) fun stats(self: &Participant): &Stats { &self.stats }
public(package) fun hp(self: &Participant): u64 { self.hp }
public(package) fun max_hp(self: &Participant): u64 { self.max_hp }
public(package) fun ap(self: &Participant): u64 { self.ap }
public(package) fun mp(self: &Participant): u64 { self.mp }
public(package) fun base_ap(self: &Participant): u64 { self.base_ap }
public(package) fun base_mp(self: &Participant): u64 { self.base_mp }
public(package) fun cell(self: &Participant): u64 { self.cell }
public(package) fun is_ready(self: &Participant): bool { self.ready }
public(package) fun is_alive(self: &Participant): bool { self.hp > 0 }
public(package) fun casts_this_turn(self: &Participant): u64 { self.casts_this_turn }
/// F-07: the seat's learned level for `spell` — the seat-time snapshot; absent = 1 (the free unlock).
public(package) fun spell_level_of(self: &Participant, spell: ID): u8 {
  if (self.spell_levels.contains(&spell)) *self.spell_levels.get(&spell) else 1
}

// ╔════════════════ [ Placement / turn lifecycle ] ══════════════════════════ ]

public(package) fun set_cell(self: &mut Participant, cell: u64) { self.cell = cell; }
public(package) fun set_ready(self: &mut Participant, ready: bool) { self.ready = ready; }

/// Start this seat's turn: reset the per-turn cast counter, then refill AP/MP to `net_refill(base, debt, credit)`
/// (MOB_DEBUFF_HAT P1 #2 — an enemy's AP/MP-removal reduces the refilled pool for the row's
/// duration, an ally's give-points BOOSTS it; symmetric with mobs). The caller reads both adjustments from the
/// board (`cast::point_adjust`).
public(package) fun begin_turn(self: &mut Participant, ap_debt: u64, mp_debt: u64, ap_credit: u64, mp_credit: u64) {
  self.casts_this_turn = 0;
  self.ap = net_refill(self.base_ap, ap_debt, ap_credit);
  self.mp = net_refill(self.base_mp, mp_debt, mp_credit);
}

/// The ONE refill law both sides share (`mob::begin_turn` calls it too): `base + credit − debt`, floored at 0 —
/// a signed net realised in u64 (credit folds in BEFORE the debt subtraction, so an over-drained-but-fed pool
/// keeps the fed remainder instead of losing it to an intermediate 0-clamp). Never underflows.
public(package) fun net_refill(base: u64, debt: u64, credit: u64): u64 {
  let total = base + credit;
  if (total > debt) total - debt else 0
}

/// Advance the per-turn committed-action counter (the crit/damage slot index). Called by every DAMAGING action
/// — casts AND weapon strikes — in commit order, so slot `i` = the i-th damaging action of the turn.
public(package) fun count_action(self: &mut Participant) { self.casts_this_turn = self.casts_this_turn + 1; }
public(package) fun spend_ap(self: &mut Participant, n: u64) { self.ap = if (self.ap > n) self.ap - n else 0; }
public(package) fun spend_mp(self: &mut Participant, n: u64) { self.mp = if (self.mp > n) self.mp - n else 0; }
/// A critical failure with the authored end-turn flag leaves no further action budget. The turn owner advances
/// through the normal pass path, preserving the published turn-machine signatures.
public(package) fun forfeit_actions(self: &mut Participant) { self.ap = 0; self.mp = 0; }

// ╔════════════════ [ HP application ] ═══════════════════════════════════════ ]

/// Subtract `dmg` (floored at 0). Damage is already element-amplified + resisted by the resolver's
/// `spell_formula::final_damage`; this is the raw HP write (the point where "a hit lands", §7).
public(package) fun apply_damage(self: &mut Participant, dmg: u64) {
  self.hp = if (self.hp > dmg) self.hp - dmg else 0;
}

/// Heal, capped at max_hp (overheal wasted — §10 "blocked when pointless" is the consumable gate; in-fight
/// heals just cap).
public(package) fun apply_heal(self: &mut Participant, amount: u64) {
  let h = self.hp + amount;
  self.hp = if (h > self.max_hp) self.max_hp else h;
}

/// Erosion removes maximum HP by an already-resolved amount, floored at one. Current HP is clamped only when
/// needed; ordinary hit damage has already landed before this fold.
public(package) fun erode_max_hp(self: &mut Participant, amount: u64) {
  self.max_hp = if (self.max_hp > amount) self.max_hp - amount else 1;
  if (self.hp > self.max_hp) self.hp = self.max_hp;
}

/// Timed Vitality/MAX_HP bonus home. Current HP does not heal when capacity grows.
public(package) fun add_max_hp_bonus(self: &mut Participant, amount: u64) { self.max_hp = self.max_hp + amount; }
public(package) fun remove_max_hp_bonus(self: &mut Participant, amount: u64) {
  self.max_hp = if (self.max_hp > amount) self.max_hp - amount else 1;
  if (self.hp > self.max_hp) self.hp = self.max_hp;
}

// ╔════════════════ [ AP/MP points effects (give / remove) ] ════════════════ ]

/// GIVE_POINTS: +n to AP (`point_kind` 0) or MP (1). Buff — no cap beyond u64 (spell bands keep n small).
public(package) fun give_points(self: &mut Participant, point_kind: u8, n: u64) {
  if (point_kind == 0) self.ap = self.ap + n else self.mp = self.mp + n;
}

/// REMOVE_POINTS: −n from AP/MP, floored at 0. `n` is the already-dodge-resolved count from the resolver.
public(package) fun remove_points(self: &mut Participant, point_kind: u8, n: u64) {
  if (point_kind == 0) self.ap = if (self.ap > n) self.ap - n else 0
  else self.mp = if (self.mp > n) self.mp - n else 0;
}

// ╔════════════════ [ The signed-effect encoding (#904 final ruling) ] ══════ ]

/// `Effect.value` is a u64, but ALTER_STAT (9) and ALTER_RESIST (11) author BOTH signs, so those two kinds
/// store their delta CENTERED at 32768 — `value = 32768 + delta` — the ONE signed encoding on chain, the same
/// convention gear `ItemStatistics` and mob resistances (`spell::RES_SHIFT`) already use. Flag-based signing
/// can never cover gear (flagless u64 struct fields, and an upgrade cannot modify a published struct), so
/// centered is the only achievable single system. `FLAG_NEGATIVE` survives on minted rows and still drives the
/// band rule and the target filter, but it is NEVER the sign again: the sign lives in the value.
const SIGNED_SHIFT: u64 = 32768;

/// DECODE a signed alter row → (magnitude, negative). The ONE reader of the centering in this package; every
/// alter consumer (the fold below, `cast::apply_alter`, the max-HP expiry revert) goes through it.
public(package) fun alter_delta(e: &Effect): (u64, bool) {
  let v = e.value();
  if (v >= SIGNED_SHIFT) (v - SIGNED_SHIFT, false) else (SIGNED_SHIFT - v, true)
}

/// ENCODE the inverse: a row the ENGINE synthesizes (steal's debit/credit pair, a punishment bonus) lands on
/// the same board as a minted one and is read by the same fold and the same client decode, so it carries the
/// same centering. A magnitude beyond the shift saturates at 0 rather than wrapping the u64.
public(package) fun centered_value(delta: u64, negative: bool): u64 {
  if (!negative) SIGNED_SHIFT + delta
  else if (delta >= SIGNED_SHIFT) 0
  else SIGNED_SHIFT - delta
}

// ╔════════════════ [ Live-stat derivation (the timed-alter recompute law) ] ═ ]

/// PERMANENT (turns==0) ALTER_STAT: lands on the BASE block, saturating — a permanent effect has no revert, so
/// the 0-floor is its real semantics. The caller re-derives the live block right after (`refresh_stats`).
public(package) fun alter_base_stat(self: &mut Participant, field: u8, amount: u64, neg: bool) {
  if (neg) spell::sub_stat(&mut self.base_stats, field, amount) else spell::add_stat(&mut self.base_stats, field, amount);
}

/// PERMANENT (turns==0) ALTER_RESIST: the base-block twin for element resistances.
public(package) fun alter_base_resist(self: &mut Participant, element: u8, amount: u64, neg: bool) {
  if (neg) spell::sub_resist(&mut self.base_stats, element, amount) else spell::add_resist(&mut self.base_stats, element, amount);
}

/// RE-DERIVE the live block from base + the fighter's live timed alter rows: every addition first, then one
/// saturating subtraction pass per stat. The rows ARE the single home for timed deltas — apply, expiry and
/// dispel all just change the row set and re-derive, so a debuff clamped by the 0-floor can never leak a
/// permanent gain when its row leaves (the old flipped-sign re-application did exactly that, and no per-row
/// bookkeeping survives INTERLEAVED clamped rows — only re-derivation is exact).
public(package) fun refresh_stats(self: &mut Participant, rows: &vector<Effect>) {
  self.stats = derive_live_stats(&self.base_stats, rows);
}

/// The FOLD ITSELF, base-block-in → live-block-out — the ONE home for the timed-alter re-derivation law, reused
/// by `mob::refresh_stats` (a mob's per-fight block folds identically). Every addition first, then one saturating
/// subtraction pass, so a debuff clamped by the 0-floor never leaks a permanent gain when its row leaves.
public(package) fun derive_live_stats(base: &Stats, rows: &vector<Effect>): Stats {
  let mut s = *base;
  fold_alters(&mut s, rows, false);
  fold_alters(&mut s, rows, true);
  s
}

/// One fold pass: apply every row whose sign matches `negatives`. Alter rows fold with their AUTHORED
/// element/stat/value (fully deterministic — the random-element flag died 2026-07-11 as dead vocabulary).
/// The SIGN comes from `alter_delta` (the centered value), never from `FLAG_NEGATIVE` — the two-pass ordering
/// is unchanged, only the question "is this row a debuff?" is now answered by the value it carries.
fun fold_alters(s: &mut Stats, rows: &vector<Effect>, negatives: bool) {
  let n = rows.length();
  let mut i = 0;
  while (i < n) {
    let e = rows.borrow(i);
    let (amount, neg) = alter_delta(e);
    if (neg == negatives) {
      if (e.kind() == spell_effect::k_alter_stat()) {
        if (negatives) spell::sub_stat(s, e.stat(), amount) else spell::add_stat(s, e.stat(), amount);
      } else if (negatives) spell::sub_resist(s, e.element(), amount) else spell::add_resist(s, e.element(), amount);
    };
    i = i + 1;
  };
}

// ╔════════════════ [ Testing ] ══════════════════════════════════════════════ ]

#[test_only]
public fun set_hp_for_testing(self: &mut Participant, hp: u64) { self.hp = hp; }

#[test_only]
public fun set_level_for_testing(self: &mut Participant, level: u64) { self.level = level; }

#[test_only]
/// Replace the authentic join snapshot in tests only; production seats still enter exclusively through the
/// brand-gated game fight doors. Updating both blocks preserves the live/base derivation invariant.
public fun set_stats_for_testing(self: &mut Participant, stats: Stats) {
  self.stats = stats;
  self.base_stats = stats;
}

// ── read a bare `Weapon` line's fields (the affinity suites assert the +10% scale on damage/crit_damage and the
// no-scale invariant on crit_rate/ap_cost/reach directly off `weapon_line_of`, without seating a Participant) ──
#[test_only]
public fun weapon_line_damage(w: &Weapon): u64 { w.damage }
#[test_only]
public fun weapon_line_crit_damage(w: &Weapon): u64 { w.crit_damage }
#[test_only]
public fun weapon_line_crit_rate(w: &Weapon): u64 { w.crit_rate }
#[test_only]
public fun weapon_line_ap_cost(w: &Weapon): u64 { w.ap_cost }
#[test_only]
public fun weapon_line_reach(w: &Weapon): u64 { w.reach }
