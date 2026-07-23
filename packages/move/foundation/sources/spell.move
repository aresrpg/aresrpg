// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
module aresrpg_foundation::spell;

use aresrpg_foundation::prng;

// ---------------------------------------------------------------------------
// Elements. Discriminants are u8. NONE = elementless: no resistance applies,
// and a NONE-element shield is "neutral" (absorbs any damage). Maps the JS
// ELEMENT_STAT: FIRE->intelligence, WATER->chance, EARTH->strength, AIR->agility.
// ---------------------------------------------------------------------------
const FIRE: u8 = 0;
const WATER: u8 = 1;
const EARTH: u8 = 2;
const AIR: u8 = 3;
const NONE: u8 = 255;

public fun el_fire(): u8 { FIRE }
public fun el_water(): u8 { WATER }
public fun el_earth(): u8 { EARTH }
public fun el_air(): u8 { AIR }
public fun el_none(): u8 { NONE }

// ---------------------------------------------------------------------------
// Stats — caster/target attributes. All u64.
// ---------------------------------------------------------------------------
public struct Stats has copy, drop, store {
    strength: u64,
    intelligence: u64,
    chance: u64,
    agility: u64,
    raw_damage: u64,
    critical_hit: u64,
    range: u64,
    fire_resistance: u64,
    water_resistance: u64,
    earth_resistance: u64,
    air_resistance: u64,
    // #55 §5h fidelity fields — appended so `new_stats`'s 11-arg signature is UNCHANGED (the
    // ~22 existing call sites need no edit); these default to 0. `percent_damage`(138)/`physical_damage`(142)
    // feed §5h caster amplification, `wisdom` the AP/MP-removal caster term + spell resist, `flat_resist` the
    // K_REDUCE_DAMAGE reduction, `neutral_resistance` the NONE-element resist, `ap_dodge`/`mp_dodge` the
    // AP/MP-removal target dodge. Populated by AlterStat/AlterResist buffs at cast; gear→ext is a balance pass.
    percent_damage: u64,
    physical_damage: u64,
    wisdom: u64,
    flat_resist: u64,
    neutral_resistance: u64,
    ap_dodge: u64,
    mp_dodge: u64,
    // D149-W3 (reference corpus: heals = rand·(100+int)/100 + healStat): the FLAT heal stat (gear "heal" lines / buffs).
    // Appended per the §5h extension pattern — constructor unchanged, defaults 0, populated via add_stat(11).
    heal: u64,
    // D172 (stats are part of the game core) — gear-fold carriers. ap/mp_bonus feed the JOIN pools
    // (base_ap(lvl)+bonus / PLAYER_MP_MAX+bonus); vitality feeds max_hp (100 + (alloc+gear_vit)×5, current
    // formula — the W2 reference-corpus-formula question stays a separate ruling). Same append pattern, default 0.
    ap_bonus: u64,
    mp_bonus: u64,
    vitality: u64,
}

/// The 11-arg constructor (UNCHANGED signature — every existing caller keeps working). The 7 §5h-fidelity
/// fields default to 0; buffs set them via the `add_*`/`sub_*` mutators below.
public fun new_stats(
    strength: u64,
    intelligence: u64,
    chance: u64,
    agility: u64,
    raw_damage: u64,
    critical_hit: u64,
    range: u64,
    fire_resistance: u64,
    water_resistance: u64,
    earth_resistance: u64,
    air_resistance: u64,
): Stats {
    Stats {
        strength,
        intelligence,
        chance,
        agility,
        raw_damage,
        critical_hit,
        range,
        fire_resistance,
        water_resistance,
        earth_resistance,
        air_resistance,
        percent_damage: 0,
        physical_damage: 0,
        wisdom: 0,
        flat_resist: 0,
        neutral_resistance: 0,
        ap_dodge: 0,
        mp_dodge: 0,
        heal: 0,
        ap_bonus: 0,
        mp_bonus: 0,
        vitality: 0,
    }
}

/// Mob resistances are stored CENTERED at 32768 (the same convention gear ItemStatistics use) so a MobTemplate can
/// carry a real elemental WEAKNESS (a negative resistance = vulnerability) that a bare u64 can't. Combat reads raw
/// magnitudes, so the mob's combat snapshot must DECODE the 4 elemental resistances back: v>=32768 → resist (v-32768);
/// v<32768 → a weakness, floored to 0 here (the reduce-only path — mobs read their true POSITIVE resists and are never
/// mis-read as max-tanky). The weakness AMPLIFICATION (vulnerability = bonus damage taken) lands body-only in the first
/// post-release upgrade — the data is already true on the template; this is just the combat read. Str/int/etc. are NOT
/// centered → passed through. MOB-ONLY: a player's gear resistances are already decentered into their Participant.stats.
const RES_SHIFT: u64 = 32768;
public fun decenter_mob_resistances(s: &Stats): Stats {
    let mut out = *s;
    out.fire_resistance = if (s.fire_resistance >= RES_SHIFT) s.fire_resistance - RES_SHIFT else 0;
    out.water_resistance = if (s.water_resistance >= RES_SHIFT) s.water_resistance - RES_SHIFT else 0;
    out.earth_resistance = if (s.earth_resistance >= RES_SHIFT) s.earth_resistance - RES_SHIFT else 0;
    out.air_resistance = if (s.air_resistance >= RES_SHIFT) s.air_resistance - RES_SHIFT else 0;
    out
}

#[test]
/// (b)+ gate proof: a mob's CENTERED resistances decode to their true positive magnitudes, and a WEAKNESS floors to
/// 0 (neutral) — NOT to its stored centered value, which apply_resistance would cap at 60% = the "absurdly tanky"
/// mis-read devops flagged. This is the fix that lets the ceremony ship centered data with correct combat.
fun decenter_mob_resistances_decodes_and_floors_weakness() {
    // fire +15 → 32783 · water 0/neutral → 32768 · earth -10 WEAKNESS → 32758 · air +7232 → 40000
    let s = new_stats(0, 0, 0, 0, 0, 0, 0, 32783, 32768, 32758, 40000);
    let d = decenter_mob_resistances(&s);
    assert!(d.fire_resistance == 15, 0);            // +15 resist decoded
    assert!(d.water_resistance == 0, 1);            // neutral
    assert!(d.earth_resistance == 0, 2);            // -10 weakness FLOORED to 0 (not 32758 = the tanky bug)
    assert!(d.air_resistance == 40000 - RES_SHIFT, 3); // large resist decoded (7232)
}

public fun stat_strength(s: &Stats): u64 { s.strength }
public fun stat_intelligence(s: &Stats): u64 { s.intelligence }
public fun stat_chance(s: &Stats): u64 { s.chance }
public fun stat_agility(s: &Stats): u64 { s.agility }
public fun stat_raw_damage(s: &Stats): u64 { s.raw_damage }
public fun stat_critical_hit(s: &Stats): u64 { s.critical_hit }
public fun stat_range(s: &Stats): u64 { s.range }
public fun stat_fire_resistance(s: &Stats): u64 { s.fire_resistance }
public fun stat_water_resistance(s: &Stats): u64 { s.water_resistance }
public fun stat_earth_resistance(s: &Stats): u64 { s.earth_resistance }
public fun stat_air_resistance(s: &Stats): u64 { s.air_resistance }
// #55 §5h-fidelity getters (default 0 unless a buff set them).
public fun stat_percent_damage(s: &Stats): u64 { s.percent_damage }
public fun stat_physical_damage(s: &Stats): u64 { s.physical_damage }
public fun stat_wisdom(s: &Stats): u64 { s.wisdom }
public fun stat_flat_resist(s: &Stats): u64 { s.flat_resist }
public fun stat_neutral_resistance(s: &Stats): u64 { s.neutral_resistance }
public fun stat_ap_dodge(s: &Stats): u64 { s.ap_dodge }
public fun stat_mp_dodge(s: &Stats): u64 { s.mp_dodge }
public fun stat_heal(s: &Stats): u64 { s.heal } // D149-W3
public fun stat_ap_bonus(s: &Stats): u64 { s.ap_bonus } // D172
public fun stat_mp_bonus(s: &Stats): u64 { s.mp_bonus } // D172
public fun stat_vitality(s: &Stats): u64 { s.vitality } // D172

// ---------------------------------------------------------------------------
// #55 Stat MUTATORS — buff/debuff a combat stat in place (AlterStat / AlterResist / StealStat). `field` MIRRORS
// spell_effect::STAT_* (spell can't `use` spell_effect — that module already `use`s spell → cycle; the ids are
// kept in lockstep by comment). `sat_sub` floors at 0 (no negative combat stats). VITALITY(5)/MAX_HP(10) have
// no Stats home (they map to the Participant's max_hp) → no-op here; the caller handles max_hp separately.
// ---------------------------------------------------------------------------
fun sat_sub(a: u64, b: u64): u64 { if (a > b) a - b else 0 }

/// D172 — the gear-fold writers for the extension fields (combat_gear's maps/combine/subtract use these;
/// the 11-arg constructor stays frozen). Additive set; sub saturates at 0 like every combat stat.
public fun set_ext_gear(s: &mut Stats, wisdom: u64, ap_bonus: u64, mp_bonus: u64, vitality: u64) {
    s.wisdom = wisdom;
    s.ap_bonus = ap_bonus;
    s.mp_bonus = mp_bonus;
    s.vitality = vitality;
}

public fun add_stat(s: &mut Stats, field: u8, delta: u64) {
    if (field == 0) s.strength = s.strength + delta
    else if (field == 1) s.intelligence = s.intelligence + delta
    else if (field == 2) s.chance = s.chance + delta
    else if (field == 3) s.agility = s.agility + delta
    else if (field == 4) s.wisdom = s.wisdom + delta
    else if (field == 6) s.range = s.range + delta
    else if (field == 7) s.critical_hit = s.critical_hit + delta
    else if (field == 8) s.percent_damage = s.percent_damage + delta // STAT_PERCENT_DAMAGE (E1)
    else if (field == 9) s.raw_damage = s.raw_damage + delta // STAT_RAW_DAMAGE (E1)
    else if (field == 11) s.heal = s.heal + delta // STAT_HEAL (D149-W3; 10=MAX_HP has no Stats home)
    else if (field == 12) s.ap_dodge = s.ap_dodge + delta
    else if (field == 13) s.mp_dodge = s.mp_dodge + delta
    else if (field == 14) s.physical_damage = s.physical_damage + delta;
}

public fun sub_stat(s: &mut Stats, field: u8, delta: u64) {
    if (field == 0) s.strength = sat_sub(s.strength, delta)
    else if (field == 1) s.intelligence = sat_sub(s.intelligence, delta)
    else if (field == 2) s.chance = sat_sub(s.chance, delta)
    else if (field == 3) s.agility = sat_sub(s.agility, delta)
    else if (field == 4) s.wisdom = sat_sub(s.wisdom, delta)
    else if (field == 6) s.range = sat_sub(s.range, delta)
    else if (field == 7) s.critical_hit = sat_sub(s.critical_hit, delta)
    else if (field == 8) s.percent_damage = sat_sub(s.percent_damage, delta)
    else if (field == 9) s.raw_damage = sat_sub(s.raw_damage, delta)
    else if (field == 11) s.heal = sat_sub(s.heal, delta) // STAT_HEAL (D149-W3)
    else if (field == 12) s.ap_dodge = sat_sub(s.ap_dodge, delta)
    else if (field == 13) s.mp_dodge = sat_sub(s.mp_dodge, delta)
    else if (field == 14) s.physical_damage = sat_sub(s.physical_damage, delta);
}

/// AlterResist by element (FIRE/WATER/EARTH/AIR/NONE→neutral). AP/MP resist buffs aren't element-keyed → the
/// caller routes those to `ap_dodge`/`mp_dodge` directly (no shipped content uses them yet — flagged).
public fun add_resist(s: &mut Stats, element: u8, delta: u64) {
    if (element == FIRE) s.fire_resistance = s.fire_resistance + delta
    else if (element == WATER) s.water_resistance = s.water_resistance + delta
    else if (element == EARTH) s.earth_resistance = s.earth_resistance + delta
    else if (element == AIR) s.air_resistance = s.air_resistance + delta
    else if (element == NONE) s.neutral_resistance = s.neutral_resistance + delta;
}

public fun sub_resist(s: &mut Stats, element: u8, delta: u64) {
    if (element == FIRE) s.fire_resistance = sat_sub(s.fire_resistance, delta)
    else if (element == WATER) s.water_resistance = sat_sub(s.water_resistance, delta)
    else if (element == EARTH) s.earth_resistance = sat_sub(s.earth_resistance, delta)
    else if (element == AIR) s.air_resistance = sat_sub(s.air_resistance, delta)
    else if (element == NONE) s.neutral_resistance = sat_sub(s.neutral_resistance, delta);
}

// ---------------------------------------------------------------------------
// Shields.
// ---------------------------------------------------------------------------
public struct Shield has copy, drop, store { id: u64, element: u8, value: u64 }
public fun new_shield(id: u64, element: u8, value: u64): Shield {
    Shield { id, element, value }
}

public struct ShieldConsumed has copy, drop, store { id: u64, absorbed: u64 }
public fun consumed_id(c: &ShieldConsumed): u64 { c.id }
public fun consumed_absorbed(c: &ShieldConsumed): u64 { c.absorbed }

// ---------------------------------------------------------------------------
// Damage / heal / crit math. Integer-only, deterministic. The single rng draw
// in the damage pipeline is the damage roll; scaling/resist/shields draw none.
// ---------------------------------------------------------------------------

/// Element -> caster stat that scales its damage. Unknown/NONE -> 0.
public fun element_stat_value(s: &Stats, element: u8): u64 {
    if (element == FIRE) s.intelligence
    else if (element == WATER) s.chance
    else if (element == EARTH) s.strength
    else if (element == AIR) s.agility
    else 0
}

/// Raw damage range before the roll: base + floor(element_stat / 10) + raw_damage.
public fun calculate_raw_damage(element: u8, min: u64, max: u64, caster: &Stats): (u64, u64) {
    let stat_value = element_stat_value(caster, element);
    let raw_bonus = caster.raw_damage;
    let stat_bonus = stat_value / 10;
    (min + stat_bonus + raw_bonus, max + stat_bonus + raw_bonus)
}

/// Roll a value in [rmin, rmax] off the prng thread. The only draw in the pipeline.
public fun roll_damage(rng: u64, rmin: u64, rmax: u64): (u64, u64) {
    prng::rng_range(rng, rmin, rmax)
}

/// +1% damage per level, integer floor. caster_level is always >= 1, so
/// (100 + caster_level - 1) >= 100 and never underflows.
public fun apply_level_scaling(damage: u64, caster_level: u64): u64 {
    damage * (100 + caster_level - 1) / 100
}

/// Resistance reduction, integer floor. NONE element now reads the dedicated `neutral_resistance` field (#55
/// §5h fidelity — was "no resistance"; default 0 keeps every prior result identical since nothing sets it yet).
public fun apply_resistance(damage: u64, element: u8, target: &Stats): u64 {
    let resistance = if (element == FIRE) target.fire_resistance
        else if (element == WATER) target.water_resistance
        else if (element == EARTH) target.earth_resistance
        else if (element == AIR) target.air_resistance
        else if (element == NONE) target.neutral_resistance
        else 0;
    // S4-2 (balance_audit §7.4): CAP total applied resistance at 60% (owner ruling 2026-07-23 — Dofus 1.29
    // boss-resist practice runs past 50 in-element; limits flex to faithful data, data never trims to a stale
    // ceiling) — so stacked resist sources can never reach elemental immunity. Was 50% (before 07-23); the sim
    // twin `spell_calculator.js RESISTANCE_CAP` and the authoring cap `apply_xp_payload MAX_RESIST_MAGNITUDE`
    // mirror this. No underflow: `capped` is always <= 60.
    let capped = if (resistance > 60) 60 else resistance;
    damage * (100 - capped) / 100
}

/// Absorb damage against shields. A shield with a specific element only absorbs
/// matching damage; a NONE-element shield is neutral and absorbs any.
public fun apply_shields(
    damage: u64,
    element: u8,
    shields: &vector<Shield>,
): (u64, vector<ShieldConsumed>) {
    let mut remaining = damage;
    let mut consumed = vector[];
    let n = shields.length();
    let mut i = 0;
    while (i < n) {
        let shield = shields.borrow(i);
        i = i + 1;
        if (shield.element != NONE && shield.element != element) continue;
        let absorbed = if (shield.value < remaining) shield.value else remaining;
        remaining = remaining - absorbed;
        consumed.push_back(ShieldConsumed { id: shield.id, absorbed });
        if (remaining == 0) break;
    };
    (remaining, consumed)
}

/// Full damage pipeline: raw -> roll (1 draw) -> level scale -> resistance -> shields.
public fun calculate_final_damage(
    rng: u64,
    element: u8,
    min: u64,
    max: u64,
    caster: &Stats,
    target: &Stats,
    caster_level: u64,
    shields: &vector<Shield>,
): (u64, u64, vector<ShieldConsumed>) {
    let (rmin, rmax) = calculate_raw_damage(element, min, max, caster);
    let (rng2, rolled) = roll_damage(rng, rmin, rmax);
    let scaled = apply_level_scaling(rolled, caster_level);
    let resisted = apply_resistance(scaled, element, target);
    let (damage, consumed) = apply_shields(resisted, element, shields);
    (rng2, damage, consumed)
}

/// Heal: roll(min, max) (1 draw) + floor(intelligence / 10).
public fun calculate_heal(rng: u64, min: u64, max: u64, caster: &Stats): (u64, u64) {
    let stat_bonus = caster.intelligence / 10;
    let (state, value) = prng::rng_range(rng, min, max);
    (state, value + stat_bonus)
}

/// Whether a chance-gated effect fires. chance >= 100 fires with no draw.
public fun effect_triggers(rng: u64, chance: u64): (u64, bool) {
    if (chance >= 100) return (rng, true);
    let (state, value) = prng::rng_int(rng, 100);
    (state, value < chance)
}

/// Critical hit. critical_chance is 1-in-X. chance == 0 -> never, no draw.
public fun is_critical(rng: u64, critical_chance: u64, crit_bonus: u64): (u64, bool) {
    if (critical_chance == 0) return (rng, false);
    // S4-1 (balance_audit §7.3): FLOOR the effective 1-in-X chance at 2 → crit caps at 1-in-2 (50%, retro).
    // The old floor of 1 let crit_bonus (Lucky Charm +10 / agility law / crit gear) drive `effective_chance`
    // to 1 = a permanent 100%-crit build. `crit_bonus + 2` can't overflow for any real crit_bonus.
    let effective_chance = if (critical_chance >= crit_bonus + 2) critical_chance - crit_bonus else 2;
    let (state, value) = prng::rng_int(rng, effective_chance);
    (state, value == 0)
}

// ===========================================================================
// Tests — reference values captured live from the JS sim.
// ===========================================================================

#[test_only]
/// Directly set physical_damage (142) — the one §5h-fidelity field without a STAT_* mutation id (it's not a
/// player-buffable stat, only gear/innate); lets spell_formula assert its earth/neutral amplification term.
public fun set_physical_damage_for_testing(s: &mut Stats, v: u64) { s.physical_damage = v; }

#[test_only]
fun caster(): Stats { new_stats(0, 55, 0, 0, 3, 0, 0, 0, 0, 0, 0) }
#[test_only]
fun target30(): Stats { new_stats(0, 0, 0, 0, 0, 0, 0, 30, 0, 0, 0) }

#[test]
fun t1_raw_damage() {
    let c = caster();
    let (rmin, rmax) = calculate_raw_damage(FIRE, 10, 20, &c);
    assert!(rmin == 18, 1);
    assert!(rmax == 28, 1);
}

#[test]
fun t2_level_scaling() {
    assert!(apply_level_scaling(100, 50) == 149, 2);
}

#[test]
fun t3_resistance() {
    let t = target30();
    assert!(apply_resistance(149, FIRE, &t) == 104, 3);
}

#[test]
fun t4_resistance_capped_at_60() {
    // S4-2 (owner ruling 2026-07-23, cap 50→60): resistance is capped at 60% — even 120 fire resist reduces
    // incoming damage by 60%, never more (was → 0 before the cap existed; was 50% before 07-23).
    let t120 = new_stats(0, 0, 0, 0, 0, 0, 0, 120, 0, 0, 0);
    assert!(apply_resistance(50, FIRE, &t120) == 20, 4); // 50 × (100−60)/100
    // exactly 60 resist = the cap boundary, 61 clamps back to 60 (still 60% — not more).
    let t60 = new_stats(0, 0, 0, 0, 0, 0, 0, 60, 0, 0, 0);
    let t61 = new_stats(0, 0, 0, 0, 0, 0, 0, 61, 0, 0, 0);
    assert!(apply_resistance(100, FIRE, &t60) == 40, 4);
    assert!(apply_resistance(100, FIRE, &t61) == 40, 4);
}

#[test]
fun t5_final_damage_no_shields() {
    let c = caster();
    let t = target30();
    let (rng1, dmg, consumed) =
        calculate_final_damage(prng::rng_seed(42), FIRE, 10, 20, &c, &t, 50, &vector[]);
    assert!(dmg == 19, 5);
    assert!(rng1 == 1831565855, 5);
    assert!(consumed.length() == 0, 5);
}

#[test]
fun t6_final_damage_shields() {
    let c = caster();
    let t = target30();
    let shields = vector[new_shield(7, FIRE, 40), new_shield(8, WATER, 100)];
    let (rng2, dmg2, consumed2) =
        calculate_final_damage(prng::rng_seed(42), FIRE, 10, 20, &c, &t, 50, &shields);
    assert!(dmg2 == 0, 6);
    assert!(rng2 == 1831565855, 6);
    assert!(consumed2.length() == 1, 6);
    assert!(consumed_id(consumed2.borrow(0)) == 7, 6);
    assert!(consumed_absorbed(consumed2.borrow(0)) == 19, 6);
}

#[test]
fun t7_heal() {
    let c = caster();
    let (rng, value) = calculate_heal(prng::rng_seed(42), 30, 40, &c);
    assert!(rng == 1831565855, 7);
    assert!(value == 36, 7);
}

#[test]
fun t8_is_critical() {
    let (rng, crit) = is_critical(prng::rng_seed(7), 5, 0);
    assert!(rng == 1831565820, 8);
    assert!(crit == false, 8);
}

#[test]
fun t9_is_critical_bonus() {
    let (rng, crit) = is_critical(prng::rng_seed(7), 50, 10);
    assert!(rng == 1831565820, 9);
    assert!(crit == false, 9);
}

#[test]
fun t_crit_floor_is_two() {
    // S4-1: a 1-in-1 configured chance (or a crit_bonus that would drive effective below 2) is FLOORED to
    // 1-in-2. Find a seed whose 1-in-2 roll is a MISS, then prove chance-1 and a below-2 bonus MISS identically
    // at that seed — the old floor of 1 would have forced chance-1 into a guaranteed crit.
    let mut seed = 1;
    loop {
        let (_s, c2) = is_critical(prng::rng_seed(seed), 2, 0);
        if (!c2) {
            let (_a, c1) = is_critical(prng::rng_seed(seed), 1, 0); // effective floored 2 → same miss
            let (_b, c3) = is_critical(prng::rng_seed(seed), 3, 100); // bonus would give <2 → floored 2 → same miss
            assert!(c1 == false && c3 == false, 11);
            break
        };
        seed = seed + 1;
    };
}

#[test]
fun t10_effect_triggers() {
    let (rng, fired) = effect_triggers(prng::rng_seed(99), 30);
    assert!(rng == 1831565912, 10);
    assert!(fired == false, 10);
}

// ╔════════════════ [ Gear-cache Stats arithmetic (S-46: moved from `aresrpg::equipment`) ] ═ ]

/// All-zero combat block (the empty gear fold).
public fun stats_zero(): Stats { new_stats(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0) }

/// Field-wise ADD of two combat blocks (equip fold-in). Verbatim from the equipment gear cache.
public fun stats_add(a: &Stats, b: &Stats): Stats {
  let mut out = new_stats(
    stat_strength(a) + stat_strength(b),
    stat_intelligence(a) + stat_intelligence(b),
    stat_chance(a) + stat_chance(b),
    stat_agility(a) + stat_agility(b),
    stat_raw_damage(a) + stat_raw_damage(b),
    stat_critical_hit(a) + stat_critical_hit(b),
    stat_range(a) + stat_range(b),
    stat_fire_resistance(a) + stat_fire_resistance(b),
    stat_water_resistance(a) + stat_water_resistance(b),
    stat_earth_resistance(a) + stat_earth_resistance(b),
    stat_air_resistance(a) + stat_air_resistance(b),
  );
  set_ext_gear(&mut out,
    stat_wisdom(a) + stat_wisdom(b),
    stat_ap_bonus(a) + stat_ap_bonus(b),
    stat_mp_bonus(a) + stat_mp_bonus(b),
    stat_vitality(a) + stat_vitality(b),
  );
  out
}

/// Field-wise floored SUB (unequip fold-out; never underflows — round-trips exactly against `stats_add` for the
/// same delta). Verbatim from the equipment gear cache.
public fun stats_sub(a: &Stats, b: &Stats): Stats {
  let mut out = new_stats(
    stats_sub_floor(stat_strength(a), stat_strength(b)),
    stats_sub_floor(stat_intelligence(a), stat_intelligence(b)),
    stats_sub_floor(stat_chance(a), stat_chance(b)),
    stats_sub_floor(stat_agility(a), stat_agility(b)),
    stats_sub_floor(stat_raw_damage(a), stat_raw_damage(b)),
    stats_sub_floor(stat_critical_hit(a), stat_critical_hit(b)),
    stats_sub_floor(stat_range(a), stat_range(b)),
    stats_sub_floor(stat_fire_resistance(a), stat_fire_resistance(b)),
    stats_sub_floor(stat_water_resistance(a), stat_water_resistance(b)),
    stats_sub_floor(stat_earth_resistance(a), stat_earth_resistance(b)),
    stats_sub_floor(stat_air_resistance(a), stat_air_resistance(b)),
  );
  set_ext_gear(&mut out,
    stats_sub_floor(stat_wisdom(a), stat_wisdom(b)),
    stats_sub_floor(stat_ap_bonus(a), stat_ap_bonus(b)),
    stats_sub_floor(stat_mp_bonus(a), stat_mp_bonus(b)),
    stats_sub_floor(stat_vitality(a), stat_vitality(b)),
  );
  out
}

fun stats_sub_floor(a: u64, b: u64): u64 { if (a > b) a - b else 0 }
