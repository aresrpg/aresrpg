// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// SPELL EFFECT ENVELOPE — the composable, data-only representation a spell entry carries. A spell is a
/// LIST of `Effect`s (the 1.29 model: `{effectId, base, area, targetFilter, chance, duration}`), each effect
/// selecting one of ~24 MECHANICS by a `kind` u8 discriminant (the codebase idiom — no native enums; cf.
/// `spell`'s element consts, `dungeon::Actor.is_mob`). Element and stat are PARAMETERS, never separate
/// opcodes, so ~130 reference effect-IDs collapse to ~24 kinds (taxonomy §5a). SUMMONING is EXCLUDED.
///
/// #577 — RANDOM DAMAGE (owner ruling 2026-07-23, REVERSES the prior "NO damage ranges" addendum). Every
/// damage/heal/life-steal/DoT effect stores an authored RANGE `[value, value_max]` (min..=max). One per-TURN
/// seed roll (`spell_formula::slot_damage_roll`, DOMAIN_DMG) picks a value in that range for the whole cast —
/// the client mirrors it byte-for-byte to preview this turn's exact damage before committing. `value_max == value`
/// is the degenerate FIXED case (byte-identical to the old single-base behaviour), so non-range kinds and any
/// un-authored content keep working unchanged. The exact 1.29 elemental-stat amplification (§5h) applies AFTER
/// the roll; crit stays a DETERMINISTIC higher-range `crit_effects` swap (turn-seed boolean), never a ×multiplier.
/// The value math lives in `spell_formula`; targeting in `spell_target`; persistent board state in `spell_board`.
///
/// PURE DATA — no `Dungeon`/`Character` coupling. This is the vocabulary the (held) `apply_cast` rewrite will
/// resolve against once the dungeon worker lands the Participant/board touchpoints.
module aresrpg_foundation::spell_effect;

// ╔════════════════ [ Effect kinds (~24 mechanics; summoning EXCLUDED) ] ═══════════ ]
// Grouped exactly as taxonomy §5a. `value`'s meaning is per-kind (documented at each const).

// -- damage / life --
const K_DAMAGE: u8 = 0; //  fixed elemental damage; value = base                       (ref 96-100/144)
const K_PERCENT_LIFE_DAMAGE: u8 = 1; //  value = pct of target HP; FLAG_LIFE_LOST = of lost HP (85-89/276/279)
const K_LIFE_STEAL: u8 = 2; //  damage target, heal caster ~½; value = base            (91-95/82)
const K_CASTER_DAMAGE: u8 = 3; //  recoil/sacrifice to the caster; value = base        (109)
const K_PUNISHMENT_DAMAGE: u8 = 4; //  damage scaling UP as caster HP drops; value = base (672)
const K_HEAL: u8 = 5; //  heal, scales caster intelligence; value = base               (108/143/90)
// -- action / movement points --
const K_GIVE_POINTS: u8 = 6; //  give AP|MP (stat = POINT_AP|POINT_MP); value = n       (111/120/78/128)
const K_REMOVE_POINTS: u8 = 7; //  remove AP|MP; value = n; FLAG_DODGE = dodgeable      (101/127 vs 168/169)
const K_STEAL_POINTS: u8 = 8; //  remove from target + give to caster; value = n        (84/77)
// -- stats / resist --
const K_ALTER_STAT: u8 = 9; //  buff/debuff a stat (stat=STAT_*); FLAG_NEGATIVE, FLAG_DISPELLABLE (118..126/606-611)
const K_STEAL_STAT: u8 = 10; //  debuff target + buff caster same stat; value = amount  (267-271/320)
const K_ALTER_RESIST: u8 = 11; //  ± element/AP/MP resist; FLAG_PERCENT, FLAG_NEGATIVE  (210-214/240-244)
// -- movement / position --
const K_PUSH: u8 = 12; //  push target away N cells (collision dmg §B); value = n       (5)
const K_PULL: u8 = 13; //  pull target toward caster N cells; value = n                 (6)
const K_TELEPORT: u8 = 14; //  move caster/target to the target cell                    (4)
const K_SWAP_POSITIONS: u8 = 15; //  swap caster and target cells                       (8)
const K_CARRY: u8 = 16; //  pick an adjacent fighter onto caster's cell                 (50)
const K_THROW: u8 = 17; //  throw the carried fighter to a target cell                  (51)
const K_RESET_POSITIONS: u8 = 18; //  reset all fighters to start-of-turn cells         (784)
// -- persistent board (see spell_board) --
const K_PLACE_TRAP: u8 = 19; //  invisible on-enter trap; area = blast zone; payload carried board-side (400)
const K_PLACE_GLYPH: u8 = 20; //  visible timed glyph; area = zone; turns = duration; phase in flags (401/402)
const K_APPLY_DOT: u8 = 21; //  poison/DoT on a fighter; value = per-tick base; turns = N
// -- control / defense --
const K_APPLY_STATE: u8 = 22; //  apply a named state (value = state_id); turns         (950)
const K_REMOVE_STATE: u8 = 23; //  remove a named state (value = state_id)              (951)
// SKIP_TURN (formerly kind 24) is DELETED, not reserved (annex §1 / review F12): "no stun" is a 1.29
// non-mechanic and nothing is mainnet-published, so the renumber over the hole was free (K max was 29 before the
// later additive geometric-push append). The no-stun
// law also gains a MAGNITUDE form in `spell_bands` (AP/MP strips are bounded) so it can't be re-expressed via a
// total point strip. Off-chain mirrors reference kinds by NAME; the resolver drops its skip branch in the SAME
// atomic land-set (annex F11), so this deletion breaks the out-of-package resolver until that lands (reported).
const K_REDUCE_DAMAGE: u8 = 24; //  flat incoming-damage reduction; value = flat        (105/265)
const K_REFLECT_DAMAGE: u8 = 25; //  reflect a flat amount of received damage; value = flat (107)
const K_DISPEL: u8 = 26; //  strip dispellable buffs/debuffs from target               (132)
const K_INVISIBILITY: u8 = 27; //  make target invisible to the enemy team; turns       (150)
const K_REVEAL: u8 = 28; //  reveal invisible fighters/traps in a zone                  (202)
// #55-E2 spell-reflect: RETURN the incoming cast to its caster (≠ K_REFLECT_DAMAGE's flat dmg reflect); turns.
// REDIRECT DEPTH 1 (annex §1 / review F6): a returned cast can never be returned OR reflected again — enforced
// at RESOLUTION (the dungeon resolver tags an already-redirected cast), never in this pure-data layer.
const K_RETURN_SPELL: u8 = 29;
// Corpus effect 783 uses p1=-1 as geometry, never as a fixed distance. The targeted cell is the repulsion
// origin: every fighter selected by the effect zone travels on its dominant-axis ray AWAY from that cell until
// its next step would leave the zone. Zone membership freezes before movement; participant-index then mob-index
// resolution reads the updated board, so earlier moves can block later ones. The shared displacement path owns
// blocker/trap stops and collision damage. `value` is unused. BRAND LAW: reference mechanics stay
// numeric/internal; no external game names ship here.
const K_GEOMETRIC_PUSH: u8 = 30;
// Wave 12 retro mechanics. Append-only: every published discriminant above remains byte-stable.
// BRAND LAW: reference effect names stay in the corpus; runtime vocabulary is generic/internal.
const K_CRITICAL_FAILURE: u8 = 31; // timed 1-in-value cast-failure denominator
const K_DAMAGE_TO_HEAL: u8 = 32; // incoming-hit branch: chance heals x stat, miss damages x value
const K_FORCED_DEATH: u8 = 33; // set HP to zero, except full K_REDUCE_DAMAGE immunity
const K_TIMED_PAYLOAD: u8 = 34; // stat=count of following flattened effects; value/turns=delay
const K_NAMED_DAMAGE_STACK: u8 = 35; // repeated same spell+target adds damage base for turns
const K_STANCE: u8 = 36; // value=appearance/stance id; FLAG_NEGATIVE restores
const K_REACTIVE_PUNISHMENT: u8 = 37; // stat=bonus stat; value=per-hit cap; area_size=bonus turns
const K_EROSION: u8 = 38; // value=percent max-HP loss taken with damage; turns=duration
const K_DAMAGE_REDIRECT: u8 = 39; // value=0 full redirect to source; >0 percent reflect to attacker

public fun k_damage(): u8 { K_DAMAGE }
public fun k_percent_life_damage(): u8 { K_PERCENT_LIFE_DAMAGE }
public fun k_life_steal(): u8 { K_LIFE_STEAL }
public fun k_caster_damage(): u8 { K_CASTER_DAMAGE }
public fun k_punishment_damage(): u8 { K_PUNISHMENT_DAMAGE }
public fun k_heal(): u8 { K_HEAL }
public fun k_give_points(): u8 { K_GIVE_POINTS }
public fun k_remove_points(): u8 { K_REMOVE_POINTS }
public fun k_steal_points(): u8 { K_STEAL_POINTS }
public fun k_alter_stat(): u8 { K_ALTER_STAT }
public fun k_steal_stat(): u8 { K_STEAL_STAT }
public fun k_alter_resist(): u8 { K_ALTER_RESIST }
public fun k_push(): u8 { K_PUSH }
public fun k_pull(): u8 { K_PULL }
public fun k_teleport(): u8 { K_TELEPORT }
public fun k_swap_positions(): u8 { K_SWAP_POSITIONS }
public fun k_carry(): u8 { K_CARRY }
public fun k_throw(): u8 { K_THROW }
public fun k_reset_positions(): u8 { K_RESET_POSITIONS }
public fun k_place_trap(): u8 { K_PLACE_TRAP }
public fun k_place_glyph(): u8 { K_PLACE_GLYPH }
public fun k_apply_dot(): u8 { K_APPLY_DOT }
public fun k_apply_state(): u8 { K_APPLY_STATE }
public fun k_remove_state(): u8 { K_REMOVE_STATE }
public fun k_reduce_damage(): u8 { K_REDUCE_DAMAGE }
public fun k_reflect_damage(): u8 { K_REFLECT_DAMAGE }
public fun k_dispel(): u8 { K_DISPEL }
public fun k_invisibility(): u8 { K_INVISIBILITY }
public fun k_reveal(): u8 { K_REVEAL }
public fun k_return_spell(): u8 { K_RETURN_SPELL }
public fun k_geometric_push(): u8 { K_GEOMETRIC_PUSH }
public fun k_critical_failure(): u8 { K_CRITICAL_FAILURE }
public fun k_damage_to_heal(): u8 { K_DAMAGE_TO_HEAL }
public fun k_forced_death(): u8 { K_FORCED_DEATH }
public fun k_timed_payload(): u8 { K_TIMED_PAYLOAD }
public fun k_named_damage_stack(): u8 { K_NAMED_DAMAGE_STACK }
public fun k_stance(): u8 { K_STANCE }
public fun k_reactive_punishment(): u8 { K_REACTIVE_PUNISHMENT }
public fun k_erosion(): u8 { K_EROSION }
public fun k_damage_redirect(): u8 { K_DAMAGE_REDIRECT }

// ╔════════════════ [ AoE shape codes (taxonomy §3) ] ═════════════════════════════ ]
const SHAPE_POINT: u8 = 0; //  the single target cell (also the default for anything unknown)
const SHAPE_CIRCLE: u8 = 1; //  filled lozenge, Manhattan radius = size
const SHAPE_CROSS: u8 = 2; //  4 orthogonal arms of length = size
const SHAPE_LINE: u8 = 3; //  target cell + size cells continuing along the cast line
const SHAPE_TBAR: u8 = 4; //  perpendicular bar of half-length = size
const SHAPE_RING: u8 = 5; //  hollow lozenge perimeter at radius = size
const SHAPE_ALLMAP: u8 = 6; //  every cell on the board (1.29 "C_")
const SHAPE_CONE: u8 = 7; //  #55-E9 triangle fanning from the caster toward the target — tip 1-wide, widening to 3, `size` deep
const SHAPE_PODIUM: u8 = 8; //  #387 weapon PODIUM — the TBAR front-arc PLUS one cell beyond the target along the strike axis

public fun shape_point(): u8 { SHAPE_POINT }
public fun shape_circle(): u8 { SHAPE_CIRCLE }
public fun shape_cross(): u8 { SHAPE_CROSS }
public fun shape_line(): u8 { SHAPE_LINE }
public fun shape_tbar(): u8 { SHAPE_TBAR }
public fun shape_ring(): u8 { SHAPE_RING }
public fun shape_allmap(): u8 { SHAPE_ALLMAP }
public fun shape_cone(): u8 { SHAPE_CONE }
public fun shape_podium(): u8 { SHAPE_PODIUM }

// ╔════════════════ [ Per-effect target filter bitmask (taxonomy §2b) ] ══════════ ]
// Values match the reference SpellEffectTarget bits. ONLY_INVOC/NOT_INVOC omitted (summons EXCLUDED).
const TF_NONE: u8 = 0; //  any fighter caught in the zone
const TF_NOT_TEAM: u8 = 1; //  exclude caster's team -> enemies only
const TF_NOT_SELF: u8 = 2; //  exclude the caster
const TF_NOT_ENEMY: u8 = 4; //  exclude the enemy team -> allies/self only
const TF_ONLY_CASTER: u8 = 32; //  caster only (self-cast)

public fun tf_none(): u8 { TF_NONE }
public fun tf_not_team(): u8 { TF_NOT_TEAM }
public fun tf_not_self(): u8 { TF_NOT_SELF }
public fun tf_not_enemy(): u8 { TF_NOT_ENEMY }
public fun tf_only_caster(): u8 { TF_ONLY_CASTER }

// ╔════════════════ [ Point kinds / stat ids / flags / trigger phases ] ══════════ ]
const POINT_AP: u8 = 0;
const POINT_MP: u8 = 1;
public fun point_ap(): u8 { POINT_AP }
public fun point_mp(): u8 { POINT_MP }

const STAT_STRENGTH: u8 = 0;
const STAT_INTELLIGENCE: u8 = 1;
const STAT_CHANCE: u8 = 2;
const STAT_AGILITY: u8 = 3;
const STAT_WISDOM: u8 = 4;
const STAT_VITALITY: u8 = 5;
const STAT_RANGE: u8 = 6;
const STAT_CRIT: u8 = 7;
// #55-E1 — AlterStat targets for the §5h/gear damage stats + max-HP (e.g. a %Damage buff → PERCENT_DAMAGE; a
// vitality/max-HP buff → MAX_HP). PERCENT_DAMAGE/RAW_DAMAGE map to the new `spell::Stats` fields; MAX_HP has no
// Stats home (it's the Participant's max_hp) and the resolver routes it there.
const STAT_PERCENT_DAMAGE: u8 = 8;
const STAT_RAW_DAMAGE: u8 = 9;
const STAT_MAX_HP: u8 = 10;
const STAT_HEAL: u8 = 11; // D149-W3: flat heal stat (spell.add_stat lockstep)
const STAT_AP_DODGE: u8 = 12;
const STAT_MP_DODGE: u8 = 13;
const STAT_PHYSICAL_DAMAGE: u8 = 14;
public fun stat_heal(): u8 { STAT_HEAL } // D149-W3
public fun stat_strength(): u8 { STAT_STRENGTH }
public fun stat_intelligence(): u8 { STAT_INTELLIGENCE }
public fun stat_chance(): u8 { STAT_CHANCE }
public fun stat_agility(): u8 { STAT_AGILITY }
public fun stat_wisdom(): u8 { STAT_WISDOM }
public fun stat_vitality(): u8 { STAT_VITALITY }
public fun stat_range(): u8 { STAT_RANGE }
public fun stat_crit(): u8 { STAT_CRIT }
public fun stat_percent_damage(): u8 { STAT_PERCENT_DAMAGE }
public fun stat_raw_damage(): u8 { STAT_RAW_DAMAGE }
public fun stat_max_hp(): u8 { STAT_MAX_HP }
public fun stat_ap_dodge(): u8 { STAT_AP_DODGE }
public fun stat_mp_dodge(): u8 { STAT_MP_DODGE }
public fun stat_physical_damage(): u8 { STAT_PHYSICAL_DAMAGE }

const FLAG_DODGE: u8 = 1; //  REMOVE_POINTS: dodgeable per-point (else guaranteed, ref 168/169)
const FLAG_PERCENT: u8 = 2; //  ALTER_RESIST: percent (else flat); PERCENT_LIFE_*: always implied
const FLAG_DISPELLABLE: u8 = 4; //  ALTER_STAT: dispellable (else survives Dispel, ref 606-611)
const FLAG_NEGATIVE: u8 = 8; //  ALTER_STAT/ALTER_RESIST: sign is negative (debuff)
const FLAG_LIFE_LOST: u8 = 16; //  PERCENT_LIFE_DAMAGE: % of LOST hp (else current)
// (bit 32 — FLAG_RANDOM_ELEMENT — removed 2026-07-11: dead vocabulary, zero shipped spells rolled an element;
// its removal made the whole cast resolver rng-free, unlocking the single-PTB turn. A future random-element
// mechanic ships as a NEW kind via the custody-gated vocabulary upgrade, never a flag revival.)
public fun flag_dodge(): u8 { FLAG_DODGE }
public fun flag_percent(): u8 { FLAG_PERCENT }
public fun flag_dispellable(): u8 { FLAG_DISPELLABLE }
public fun flag_negative(): u8 { FLAG_NEGATIVE }
public fun flag_life_lost(): u8 { FLAG_LIFE_LOST }

const PHASE_ON_ENTER: u8 = 0; //  trap: triggers when a fighter enters the zone
const PHASE_START: u8 = 1; //  glyph/DoT: ticks at the start of the standing fighter's turn
const PHASE_END: u8 = 2; //  glyph: ticks at end of turn
public fun phase_on_enter(): u8 { PHASE_ON_ENTER }
public fun phase_start(): u8 { PHASE_START }
public fun phase_end(): u8 { PHASE_END }

// ╔════════════════ [ Effect — the flat envelope record ] ════════════════════════ ]
/// One effect in a spell's effect list. Flat by design — this IS the 1.29 effect record shape. `value`'s
/// meaning is per-`kind` (see the kind consts); unused fields are 0 for a given kind. `copy,drop,store` so an
/// effect list rides inside a `SpellLevel`, a board `CellEntry` payload, or a fighter DoT status.
public struct Effect has copy, drop, store {
  kind: u8,
  element: u8, //  spell element for damage/resist; spell::el_none() otherwise
  value: u64, //  base dmg / heal / points / distance / stat amount / pct / state_id (per kind); RANGE kinds: the MIN
  value_max: u64, //  #577 — RANGE kinds (damage/heal/life-steal/DoT): the MAX of the authored roll range (== value ⇒ fixed). Other kinds: == value, ignored.
  area_shape: u8, //  §3 shape for the effect's own zone
  area_size: u64, //  shape radius/length
  target_filter: u8, //  §2b bitmask — who in the zone this effect hits
  chance: u8, //  proc chance 0..=100 (100 = always)
  turns: u8, //  duration for buffs/debuffs/glyphs/DoT ([T]/[B]/[U] kinds)
  stat: u8, //  POINT_AP|POINT_MP for points; STAT_* for alter/steal-stat
  flags: u8, //  FLAG_* bitset (dodge / percent / dispellable / negative / life-lost)
  phase: u8, //  PHASE_* — trigger timing for traps/glyphs/DoT
}

/// Full FIXED constructor — every field explicit, `value_max == value` (a single fixed base). Signature is
/// UNCHANGED across #577 (its ~50 callers stay put); it delegates to `new_effect_ranged` with a degenerate range.
public fun new_effect(
  kind: u8,
  element: u8,
  value: u64,
  area_shape: u8,
  area_size: u64,
  target_filter: u8,
  chance: u8,
  turns: u8,
  stat: u8,
  flags: u8,
  phase: u8,
): Effect {
  new_effect_ranged(kind, element, value, value, area_shape, area_size, target_filter, chance, turns, stat, flags, phase)
}

/// #577 — the RANGE-aware full constructor: `value` = MIN, `value_max` = MAX. `aresrpg_spells` mints
/// damage/heal/life-steal/DoT effects through this (or the range convenience constructors) when a spread is
/// authored; every other kind mints through `new_effect` (max == min). The ONE home for the `Effect` literal.
public fun new_effect_ranged(
  kind: u8,
  element: u8,
  value: u64,
  value_max: u64,
  area_shape: u8,
  area_size: u64,
  target_filter: u8,
  chance: u8,
  turns: u8,
  stat: u8,
  flags: u8,
  phase: u8,
): Effect {
  Effect { kind, element, value, value_max, area_shape, area_size, target_filter, chance, turns, stat, flags, phase }
}

// -- Accessors (field privacy: only this module can read Effect's fields) --
public fun kind(e: &Effect): u8 { e.kind }
public fun element(e: &Effect): u8 { e.element }
public fun value(e: &Effect): u64 { e.value } //  RANGE kinds: the MIN/base of the roll range
public fun value_max(e: &Effect): u64 { e.value_max } //  #577 — RANGE kinds: the MAX; == value() for fixed effects
public fun area_shape(e: &Effect): u8 { e.area_shape }
public fun area_size(e: &Effect): u64 { e.area_size }
public fun target_filter(e: &Effect): u8 { e.target_filter }
public fun chance(e: &Effect): u8 { e.chance }
public fun turns(e: &Effect): u8 { e.turns }
public fun stat(e: &Effect): u8 { e.stat }
public fun flags(e: &Effect): u8 { e.flags }
public fun phase(e: &Effect): u8 { e.phase }
public fun has_flag(e: &Effect, flag: u8): bool { e.flags & flag == flag }

// ╔════════════════ [ Signed-value convention — the KIND_SIGNED {alter_stat, alter_resist} decode ] ══════ ]
// R3 (owner ruling 2026-07-23 — negative stat/resist deltas must WORK): effect kinds 9/11 author BOTH signs in
// the corpus (a debuff spell authors −8..−33), but `value`/`value_max` are u64 — negatives cannot mint raw. For
// EXACTLY these two kinds the fields are CENTERED at 32768 (`value = 32768 + delta`), the SAME convention gear
// `ItemStatistics` and mob resistances already use (spell.move RES_SHIFT). Damage/heal and every other kind stay
// RAW. `signed_delta` is the ONE decode home both apply call sites (permanent `apply_alter`, timed `fold_alters`)
// AND the sim twin (`spell_effect.js`) read through, so a rolled/stored centered value always resolves to the same
// (is_negative, magnitude) pair on chain and client. A ranged debuff rolls on the centered endpoints first
// (`spell_formula::roll_in_range` needs no change — centered endpoints are ordinary ascending u64s) and the decode
// applies to the ROLLED result.
const SIGNED_SHIFT: u64 = 32768;
public fun signed_shift(): u64 { SIGNED_SHIFT }

/// The KIND_SIGNED set — the only kinds whose `value`/`value_max` are centered (else the field is raw).
public fun is_signed_kind(kind: u8): bool { kind == K_ALTER_STAT || kind == K_ALTER_RESIST }

/// Decode a (possibly centered) effect `value` for `kind` → `(is_negative, magnitude)`. Signed kinds decode the
/// 32768-centering; every other kind passes through as `(false, value)` (raw). The magnitude is the absolute
/// stat/resist delta the apply path adds (buff) or saturating-subtracts (debuff).
public fun signed_delta(kind: u8, value: u64): (bool, u64) {
  if (is_signed_kind(kind)) {
    if (value >= SIGNED_SHIFT) (false, value - SIGNED_SHIFT) else (true, SIGNED_SHIFT - value)
  } else {
    (false, value)
  }
}

// ╔════════════════ [ Structural legality — the "legal against the effect system" gate ] ══════ ]
// The `aresrpg_spells` admission (`mint_spell`) AND every cap-gated live-tune setter run this on EVERY effect of
// a level (base + crit) — paired with the `spell_bands` MAGNITUDE law (annex §3 F1). An effect is structurally
// legal ONLY if it selects a KNOWN kind/shape/phase, a target-filter and flag-set that are subsets of the defined
// bits, a valid element, a proc chance in 0..=100, and an in-range stat id. The resolver's dispatch is FROZEN for
// every existing kind (semantics immutable — shell law), so anything structurally legal here is, by construction,
// executable. GROWTH (annex F10): the vocabulary is custody-gated upgrade-appendable — a genuinely new kind ships
// as a coordinated package upgrade appending a discriminant above the current max (the foundation/spells UpgradeCaps
// stay under custody forever). "Frozen rules" means existing-kind semantics never change, NOT that the packages
// are cap-burned.
const TF_ALL_MASK: u8 = 39; //  TF_NOT_TEAM(1)|TF_NOT_SELF(2)|TF_NOT_ENEMY(4)|TF_ONLY_CASTER(32) — legal filter bits
const FLAG_ALL_MASK: u8 = 31; //  all five FLAG_* bits (1|2|4|8|16) — bit 32 (random-element) is dead vocabulary, rejected

public fun is_legal(e: &Effect): bool {
  e.kind <= K_DAMAGE_REDIRECT
    && e.area_shape <= SHAPE_PODIUM
    && (e.target_filter | TF_ALL_MASK) == TF_ALL_MASK
    && e.chance <= 100
    && (e.flags | FLAG_ALL_MASK) == FLAG_ALL_MASK
    && e.phase <= PHASE_END
    && e.stat <= STAT_PHYSICAL_DAMAGE
    && (e.element <= AIR_ELEMENT || e.element == NONE_ELEMENT) // fire/water/earth/air, or neutral(255)
    && e.value_max >= e.value // #577 — a well-formed roll range (fixed effects have value_max == value)
}
const AIR_ELEMENT: u8 = 3; //  spell::el_air() — the top damage-element discriminant
const NONE_ELEMENT: u8 = 255; //  spell::el_none() — neutral/elementless

// ╔════════════════ [ Convenience constructors (the common kinds) ] ══════════════ ]
// A point/single-target enemy damage at fixed base — the workhorse.
public fun damage(element: u8, base: u64): Effect {
  new_effect(K_DAMAGE, element, base, SHAPE_POINT, 0, TF_NOT_TEAM, 100, 0, 0, 0, PHASE_ON_ENTER)
}
// §387 — enemy damage over an explicit AoE (`area_shape`/`area_size`), enemies only (TF_NOT_TEAM), fixed base. The
// weapon strike builds its shaped damage marker off this so the emitted effect carries the strike's cell-set shape.
public fun damage_shaped(element: u8, base: u64, area_shape: u8, area_size: u64): Effect {
  new_effect(K_DAMAGE, element, base, area_shape, area_size, TF_NOT_TEAM, 100, 0, 0, 0, PHASE_ON_ENTER)
}
public fun heal(base: u64): Effect {
  new_effect(K_HEAL, 255, base, SHAPE_POINT, 0, TF_NOT_ENEMY, 100, 0, 0, 0, PHASE_ON_ENTER)
}
// #577 — RANGE variants of the damage family: the turn-seed roll picks a value in `[min, max]` (min == max ⇒ the
// fixed constructors above). The seed serializer mints authored spreads through these.
public fun damage_range(element: u8, min: u64, max: u64): Effect {
  new_effect_ranged(K_DAMAGE, element, min, max, SHAPE_POINT, 0, TF_NOT_TEAM, 100, 0, 0, 0, PHASE_ON_ENTER)
}
public fun heal_range(min: u64, max: u64): Effect {
  new_effect_ranged(K_HEAL, 255, min, max, SHAPE_POINT, 0, TF_NOT_ENEMY, 100, 0, 0, 0, PHASE_ON_ENTER)
}
public fun life_steal_range(element: u8, min: u64, max: u64): Effect {
  new_effect_ranged(K_LIFE_STEAL, element, min, max, SHAPE_POINT, 0, TF_NOT_TEAM, 100, 0, 0, 0, PHASE_ON_ENTER)
}
public fun apply_dot_range(element: u8, per_tick_min: u64, per_tick_max: u64, turns: u8): Effect {
  new_effect_ranged(K_APPLY_DOT, element, per_tick_min, per_tick_max, SHAPE_POINT, 0, TF_NOT_TEAM, 100, turns, 0, 0, PHASE_START)
}
public fun life_steal(element: u8, base: u64): Effect {
  new_effect(K_LIFE_STEAL, element, base, SHAPE_POINT, 0, TF_NOT_TEAM, 100, 0, 0, 0, PHASE_ON_ENTER)
}
public fun push(n: u64): Effect {
  new_effect(K_PUSH, 255, n, SHAPE_POINT, 0, TF_NOT_TEAM, 100, 0, 0, 0, PHASE_ON_ENTER)
}
/// Geometry-driven repulsion. The effect zone selects EVERY fighter; `value=0` records that the resolver derives
/// distance from each fighter's ray to the zone edge rather than reading a fixed magnitude.
public fun geometric_push(area_shape: u8, area_size: u64): Effect {
  new_effect(K_GEOMETRIC_PUSH, 255, 0, area_shape, area_size, TF_NONE, 100, 0, 0, 0, PHASE_ON_ENTER)
}
public fun pull(n: u64): Effect {
  new_effect(K_PULL, 255, n, SHAPE_POINT, 0, TF_NOT_TEAM, 100, 0, 0, 0, PHASE_ON_ENTER)
}
// AP/MP removal. `dodge` = the dodgeable per-point class (ref 101/127); false = guaranteed (168/169).
public fun remove_points(point_kind: u8, n: u64, dodge: bool): Effect {
  let flags = if (dodge) FLAG_DODGE else 0;
  new_effect(K_REMOVE_POINTS, 255, n, SHAPE_POINT, 0, TF_NOT_TEAM, 100, 0, point_kind, flags, PHASE_ON_ENTER)
}
/// A DRAIN DEBT ROW — the POST-DODGE `removed` count a point-removal records on the effect board so the target's
/// next turn-start refill subtracts it (the retrait contract: a removal denies the pool for `turns`, then the row
/// expires and the pool recovers). `value` = the actual removed count (never the requested), `turns` = the
/// duration (the resolver floors it at 1 so a plain removal always bites the target's next turn). Not a dodgeable
/// re-application — it is inert bookkeeping the `spell_board::fighter_point_debt` fold reads.
public fun drain_row(point_kind: u8, removed: u64, turns: u8): Effect {
  new_effect(K_REMOVE_POINTS, 255, removed, SHAPE_POINT, 0, TF_NONE, 100, turns, point_kind, 0, PHASE_ON_ENTER)
}
/// A GIVE CREDIT ROW — the drain row's opposite-sign twin (MOB_DEBUFF_HAT P1 #2): a `k_give_points` records the
/// given count so the RECIPIENT's next turn-start refill ADDS it (refill = base − debt + credit) — without it an
/// ally's feed evaporates unread, overwritten by the recipient's own `begin_turn` before it ever acts. `turns` =
/// duration (resolver floors at 1: a feed boosts at least the recipient's next turn, then expires at its turn-end).
public fun credit_row(point_kind: u8, given: u64, turns: u8): Effect {
  new_effect(K_GIVE_POINTS, 255, given, SHAPE_POINT, 0, TF_NONE, 100, turns, point_kind, 0, PHASE_ON_ENTER)
}
public fun give_points(point_kind: u8, n: u64): Effect {
  new_effect(K_GIVE_POINTS, 255, n, SHAPE_POINT, 0, TF_NOT_ENEMY, 100, 1, point_kind, 0, PHASE_ON_ENTER)
}
/// `amount` is a RAW magnitude + `negative` sign; the stored `value` is CENTERED (R3, signed-value convention):
/// `32768 − amount` for a debuff, `32768 + amount` for a buff — so every runtime alter row (a steal split, a
/// retro grant, a seed template) shares the ONE representation `signed_delta` decodes. FLAG_NEGATIVE stays set as
/// the declared sign the mint-time bands legality (`spell_bands` F5) and dispel classification read.
public fun alter_stat(stat_id: u8, amount: u64, negative: bool, dispellable: bool, turns: u8): Effect {
  let mut flags = 0;
  if (negative) flags = flags | FLAG_NEGATIVE;
  if (dispellable) flags = flags | FLAG_DISPELLABLE;
  let filter = if (negative) TF_NOT_TEAM else TF_NOT_ENEMY;
  let value = if (negative) SIGNED_SHIFT - amount else SIGNED_SHIFT + amount;
  new_effect(K_ALTER_STAT, 255, value, SHAPE_POINT, 0, filter, 100, turns, stat_id, flags, PHASE_ON_ENTER)
}
// A trap placement effect: `zone_*` is the trap's own blast lozenge; the DETONATION payload is carried
// board-side (spell_board::place_trap) — Move forbids a recursive `vector<Effect>` inside `Effect`.
public fun place_trap(zone_shape: u8, zone_size: u64): Effect {
  new_effect(K_PLACE_TRAP, 255, 0, zone_shape, zone_size, TF_NONE, 100, 0, 0, 0, PHASE_ON_ENTER)
}
public fun place_glyph(zone_shape: u8, zone_size: u64, turns: u8, end_of_turn: bool): Effect {
  let phase = if (end_of_turn) PHASE_END else PHASE_START;
  new_effect(K_PLACE_GLYPH, 255, 0, zone_shape, zone_size, TF_NONE, 100, turns, 0, 0, phase)
}
public fun apply_dot(element: u8, per_tick_base: u64, turns: u8): Effect {
  new_effect(K_APPLY_DOT, element, per_tick_base, SHAPE_POINT, 0, TF_NOT_TEAM, 100, turns, 0, 0, PHASE_START)
}

// ╔════════════════ [ SpellLevel — the cast-constraint layer (taxonomy §2a/§5b) ] ═ ]
/// A single spell level's cast constraints + its base/crit effect lists. Extends the prior AresRPG
/// `create_spell.js` shape with the three fields it lacked: `required/forbidden_states`, `crit_rate`, and the
/// per-effect `target_filter` (which lives on each `Effect`). On a crit the `crit_effects` list REPLACES
/// `effects` (a distinct, higher FIXED base — deterministic, no ×multiplier; taxonomy §5h/§D).
public struct SpellLevel has copy, drop, store {
  min_char_level: u16, //  #57 per-level CHARACTER-level gate: raising a spell TO this level needs character.level() >= this. L6 = spell_unlock_tier + 100; intermediates are the spell's per-level retro reqs (Bible-seeded per spell). Pure DATA — no legality bound in is_legal.
  ap_cost: u64,
  range_min: u64,
  range_max: u64,
  modifiable_range: bool,
  line_launch: bool, //  must cast in a straight orthogonal line
  line_of_sight: bool, //  LOS required (spell_target enforces via combat_grid)
  free_cell: bool, //  target cell must be EMPTY (traps/teleport/glyphs) vs must-hit-a-fighter
  casts_per_turn: u8,
  casts_per_target: u8,
  cooldown_turns: u8,
  crit_rate: u64, //  base 1-in-X crit chance (0 = never); agility lowers X (project law)
  ends_turn_on_fail: bool,
  required_states: vector<u16>,
  forbidden_states: vector<u16>,
  effects: vector<Effect>,
  crit_effects: vector<Effect>,
}

public fun new_spell_level(
  min_char_level: u16,
  ap_cost: u64,
  range_min: u64,
  range_max: u64,
  modifiable_range: bool,
  line_launch: bool,
  line_of_sight: bool,
  free_cell: bool,
  casts_per_turn: u8,
  casts_per_target: u8,
  cooldown_turns: u8,
  crit_rate: u64,
  ends_turn_on_fail: bool,
  required_states: vector<u16>,
  forbidden_states: vector<u16>,
  effects: vector<Effect>,
  crit_effects: vector<Effect>,
): SpellLevel {
  SpellLevel {
    min_char_level, ap_cost, range_min, range_max, modifiable_range, line_launch, line_of_sight, free_cell,
    casts_per_turn, casts_per_target, cooldown_turns, crit_rate, ends_turn_on_fail,
    required_states, forbidden_states, effects, crit_effects,
  }
}

/// #57 — the per-level character-level gate the UPGRADE path asserts against, and the frontend REQ-LV chip
/// (D30 tab / D29 pre-validation) reads. See the struct field for the formula.
public fun min_char_level(s: &SpellLevel): u16 { s.min_char_level }

public fun sl_ap_cost(s: &SpellLevel): u64 { s.ap_cost }
public fun sl_range_min(s: &SpellLevel): u64 { s.range_min }
public fun sl_range_max(s: &SpellLevel): u64 { s.range_max }
public fun sl_modifiable_range(s: &SpellLevel): bool { s.modifiable_range }
public fun sl_line_launch(s: &SpellLevel): bool { s.line_launch }
public fun sl_line_of_sight(s: &SpellLevel): bool { s.line_of_sight }
public fun sl_free_cell(s: &SpellLevel): bool { s.free_cell }
public fun sl_casts_per_turn(s: &SpellLevel): u8 { s.casts_per_turn }
public fun sl_casts_per_target(s: &SpellLevel): u8 { s.casts_per_target }
public fun sl_cooldown_turns(s: &SpellLevel): u8 { s.cooldown_turns }
public fun sl_crit_rate(s: &SpellLevel): u64 { s.crit_rate }
public fun sl_ends_turn_on_fail(s: &SpellLevel): bool { s.ends_turn_on_fail }
public fun sl_required_states(s: &SpellLevel): &vector<u16> { &s.required_states }
public fun sl_forbidden_states(s: &SpellLevel): &vector<u16> { &s.forbidden_states }
public fun sl_effects(s: &SpellLevel): &vector<Effect> { &s.effects }
public fun sl_crit_effects(s: &SpellLevel): &vector<Effect> { &s.crit_effects }

/// The effect list a resolution should apply: `crit_effects` on a crit (higher fixed base), else `effects`.
/// Deterministic — the crit BOOLEAN (the only damage-path RNG) is decided upstream in `spell_formula`. The
/// CURRENT dungeon spell (fire strike) is expressed as a 6-LEVEL `Spell` in `spell_book` (per D25).
public fun effects_for(s: &SpellLevel, is_crit: bool): &vector<Effect> {
  if (is_crit && !s.crit_effects.is_empty()) &s.crit_effects else &s.effects
}

// ╔════════════════ [ Live-tune setters — the SPEC §7 balancing lever ] ══════════ ]
/// Mutate ONE aspect of a level in place. These are DUMB — they do NO validation. Their sole caller,
/// `aresrpg_spells`, owns the only `&mut SpellLevel` that matters (a template's levels are private to that
/// package and reachable only with its AdminCap) and RE-RUNS `spell_bands::level_is_legal` after every call, so
/// an out-of-band edit aborts and reverts. Mutating a loose local `SpellLevel` is harmless — only template-owned
/// levels drive resolution, and those are gated. ONE HOME per fact: the bands live in `spell_bands`, never here.
public fun set_ap_cost(s: &mut SpellLevel, ap_cost: u64) { s.ap_cost = ap_cost; }

public fun set_range(s: &mut SpellLevel, range_min: u64, range_max: u64, modifiable_range: bool) {
  s.range_min = range_min;
  s.range_max = range_max;
  s.modifiable_range = modifiable_range;
}

public fun set_limits(s: &mut SpellLevel, casts_per_turn: u8, casts_per_target: u8, cooldown_turns: u8, crit_rate: u64) {
  s.casts_per_turn = casts_per_turn;
  s.casts_per_target = casts_per_target;
  s.cooldown_turns = cooldown_turns;
  s.crit_rate = crit_rate;
}

public fun set_effects(s: &mut SpellLevel, effects: vector<Effect>, crit_effects: vector<Effect>) {
  s.effects = effects;
  s.crit_effects = crit_effects;
}

public fun set_targeting(s: &mut SpellLevel, min_char_level: u16, line_of_sight: bool) {
  s.min_char_level = min_char_level;
  s.line_of_sight = line_of_sight;
}

// ===========================================================================
// Tests — the envelope can REPRESENT every kind + a SpellLevel's crit swap.
// ===========================================================================

#[test]
fun t_spell_level_crit_swap() {
  // A one-effect fire level: crit swaps to the higher FIXED base (deterministic, no multiplier).
  let s = new_spell_level(
    1, 4, 1, 4, false, false, true, false, 255, 255, 0, 50, false, vector[], vector[],
    vector[damage(aresrpg_foundation::spell::el_fire(), 15)],
    vector[damage(aresrpg_foundation::spell::el_fire(), 22)],
  );
  assert!(s.min_char_level() == 1 && s.sl_ap_cost() == 4 && s.sl_line_of_sight() && !s.sl_free_cell(), 0);
  assert!(s.effects_for(false).borrow(0).value() == 15, 0);
  assert!(s.effects_for(true).borrow(0).value() == 22, 0);
}

#[test]
fun t_damage_effect_fields() {
  let e = damage(aresrpg_foundation::spell::el_fire(), 15);
  assert!(e.kind() == K_DAMAGE, 0);
  assert!(e.element() == aresrpg_foundation::spell::el_fire(), 0);
  assert!(e.value() == 15, 0);
  assert!(e.target_filter() == TF_NOT_TEAM, 0);
  assert!(e.chance() == 100, 0);
}

#[test]
fun t_remove_points_dodge_flag() {
  let dodgeable = remove_points(POINT_AP, 3, true);
  assert!(dodgeable.kind() == K_REMOVE_POINTS, 0);
  assert!(dodgeable.stat() == POINT_AP, 0);
  assert!(dodgeable.has_flag(FLAG_DODGE), 0);
  let guaranteed = remove_points(POINT_MP, 2, false);
  assert!(!guaranteed.has_flag(FLAG_DODGE), 0);
  assert!(guaranteed.stat() == POINT_MP, 0);
}

#[test]
fun t_alter_stat_sign_and_filter() {
  let buff = alter_stat(STAT_STRENGTH, 50, false, true, 3);
  assert!(!buff.has_flag(FLAG_NEGATIVE), 0);
  assert!(buff.has_flag(FLAG_DISPELLABLE), 0);
  assert!(buff.target_filter() == TF_NOT_ENEMY, 0); // buffs target allies/self
  let debuff = alter_stat(STAT_AGILITY, 40, true, false, 2);
  assert!(debuff.has_flag(FLAG_NEGATIVE), 0);
  assert!(debuff.target_filter() == TF_NOT_TEAM, 0); // debuffs target enemies
}

#[test]
fun t_signed_delta_centering_roundtrip() {
  // R3: the alter_stat constructor CENTERS; signed_delta decodes back to the authored (sign, magnitude).
  let buff = alter_stat(STAT_STRENGTH, 50, false, true, 3);
  assert!(buff.value() == SIGNED_SHIFT + 50, 0); // +50 centered
  let (neg, mag) = signed_delta(buff.kind(), buff.value());
  assert!(!neg && mag == 50, 1);
  let debuff = alter_stat(STAT_AGILITY, 33, true, true, 2);
  assert!(debuff.value() == SIGNED_SHIFT - 33, 2); // −33 centered
  let (dneg, dmag) = signed_delta(debuff.kind(), debuff.value());
  assert!(dneg && dmag == 33, 3);
  // Raw kinds pass through unchanged (magnitude == value, never negative).
  let (rneg, rmag) = signed_delta(K_DAMAGE, 42);
  assert!(!rneg && rmag == 42, 4);
  // A centered ranged debuff (delta −33..−8 ⇒ centered 32735..32760): each endpoint decodes to its magnitude,
  // and roll_in_range on the centered endpoints then decode yields the exact delta. These three (roll → magnitude)
  // pairs are the SIM PARITY FIXTURE twin (signed_alter_r3.test.js) — chain and client decode the identical delta.
  let (lo_neg, lo_mag) = signed_delta(K_ALTER_STAT, SIGNED_SHIFT - 33); // 32735
  let (hi_neg, hi_mag) = signed_delta(K_ALTER_STAT, SIGNED_SHIFT - 8); //  32760
  assert!(lo_neg && lo_mag == 33 && hi_neg && hi_mag == 8, 5);
  let lo = SIGNED_SHIFT - 33;
  let hi = SIGNED_SHIFT - 8;
  let (r0_neg, r0_mag) = signed_delta(K_ALTER_STAT, aresrpg_foundation::spell_formula::roll_in_range(lo, hi, 0));
  let (r5_neg, r5_mag) = signed_delta(K_ALTER_STAT, aresrpg_foundation::spell_formula::roll_in_range(lo, hi, 5000));
  let (r9_neg, r9_mag) = signed_delta(K_ALTER_STAT, aresrpg_foundation::spell_formula::roll_in_range(lo, hi, 9999));
  assert!(r0_neg && r0_mag == 33, 6); // roll 0 → the min (most-negative) endpoint
  assert!(r5_neg && r5_mag == 20, 7); // roll 5000 → −20
  assert!(r9_neg && r9_mag == 8, 8); //  roll 9999 → the max (least-negative) endpoint
}

#[test]
fun t_trap_and_glyph_and_dot_kinds() {
  let trap = place_trap(SHAPE_CIRCLE, 2);
  assert!(trap.kind() == K_PLACE_TRAP, 0);
  assert!(trap.phase() == PHASE_ON_ENTER, 0);
  assert!(trap.area_shape() == SHAPE_CIRCLE && trap.area_size() == 2, 0);
  let glyph = place_glyph(SHAPE_CIRCLE, 1, 3, false);
  assert!(glyph.kind() == K_PLACE_GLYPH && glyph.phase() == PHASE_START && glyph.turns() == 3, 0);
  let glyph_end = place_glyph(SHAPE_CIRCLE, 1, 2, true);
  assert!(glyph_end.phase() == PHASE_END, 0);
  let dot = apply_dot(aresrpg_foundation::spell::el_earth(), 8, 3);
  assert!(dot.kind() == K_APPLY_DOT && dot.phase() == PHASE_START && dot.turns() == 3 && dot.value() == 8, 0);
}

#[test]
fun t_is_legal_accepts_wellformed_and_rejects_garbage() {
  // Every convenience constructor produces a legal effect.
  assert!(damage(aresrpg_foundation::spell::el_fire(), 15).is_legal(), 0);
  assert!(heal(30).is_legal(), 0);
  assert!(place_trap(SHAPE_CROSS, 2).is_legal(), 0);
  assert!(alter_stat(STAT_MAX_HP, 50, false, true, 3).is_legal(), 0);
  // Unknown kind → rejected.
  let bad_kind = new_effect(200, 0, 1, SHAPE_POINT, 0, TF_NOT_TEAM, 100, 0, 0, 0, PHASE_ON_ENTER);
  assert!(!bad_kind.is_legal(), 0);
  // Unknown shape → rejected.
  let bad_shape = new_effect(K_DAMAGE, 0, 1, 99, 0, TF_NOT_TEAM, 100, 0, 0, 0, PHASE_ON_ENTER);
  assert!(!bad_shape.is_legal(), 0);
  // Undefined target-filter bit (64) → rejected.
  let bad_filter = new_effect(K_DAMAGE, 0, 1, SHAPE_POINT, 0, 64, 100, 0, 0, 0, PHASE_ON_ENTER);
  assert!(!bad_filter.is_legal(), 0);
  // Dead random-element flag bit (32) is not structural vocabulary.
  let bad_flags = new_effect(K_DAMAGE, 0, 1, SHAPE_POINT, 0, TF_NOT_TEAM, 100, 0, 0, 32, PHASE_ON_ENTER);
  assert!(!bad_flags.is_legal(), 0);
  // chance > 100 → rejected.
  let bad_chance = new_effect(K_DAMAGE, 0, 1, SHAPE_POINT, 0, TF_NOT_TEAM, 101, 0, 0, 0, PHASE_ON_ENTER);
  assert!(!bad_chance.is_legal(), 0);
  // Nonsense element (7) → rejected.
  let bad_element = new_effect(K_DAMAGE, 7, 1, SHAPE_POINT, 0, TF_NOT_TEAM, 100, 0, 0, 0, PHASE_ON_ENTER);
  assert!(!bad_element.is_legal(), 0);
  // Upgrade append: RETURN_SPELL remains 29; GEOMETRIC_PUSH occupies the formerly-unknown next slot.
  assert!(k_return_spell() == 29, 0);
  assert!(geometric_push(SHAPE_CIRCLE, 3).is_legal(), 0);
  let next_unknown = new_effect(40, 255, 0, SHAPE_POINT, 0, TF_NONE, 100, 0, 0, 0, PHASE_ON_ENTER);
  assert!(!next_unknown.is_legal(), 0);
  // Stat-id growth: the old STAT_HEAL endpoint and Wave 12's new endpoint are both legal.
  assert!(alter_stat(STAT_HEAL, 20, false, true, 3).is_legal(), 0);
  assert!(alter_stat(STAT_PHYSICAL_DAMAGE, 20, false, true, 3).is_legal(), 0);
}
