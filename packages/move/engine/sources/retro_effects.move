/// WAVE 12 RETRO EFFECTS — stateful mechanics that cannot live in the frozen `Fight` layout.
///
/// Compatibility: queues and named-stack windows are dynamic fields under the fight UID; no published struct
/// changes. All duration rows use the existing spell board and therefore disappear with their fight. A new fight
/// has a new UID, so no queue/stack key can leak across fights.
///
/// Ambiguities fixed here: effect 79 branches once per direct incoming line (`chance` succeeds to heal
/// `incoming * stat`, failure deals `incoming * value`); effect 765 uses value 0 for full source redirect and a
/// positive value for the declared nonrecursive percent-reflect adaptation; effect 776 erodes max HP by its
/// percent of actual HP lost; effect 788 grants `min(actual HP lost, value)` for `area_size` turns per live row.
/// BRAND LAW: reference spell/effect names remain corpus data; runtime types stay generic/internal.
module aresrpg_fight::retro_effects;

use aresrpg_fight::{fight::{Self, Fight}, fight_events, mob, participant};
use aresrpg_foundation::{spell_board, spell_effect::{Self, Effect}, spell_formula};
use sui::dynamic_field as df;

const MOB_FID_BASE: u64 = 1_000;

// ╔════════════════ [ Dynamic-field state ] ════════════════════════════════

public struct TimedPayloadKey has copy, drop, store { fighter: u64 }
public struct TimedPayload has drop, store {
  remaining: u8,
  source: u64,
  effects: vector<Effect>,
}

public struct NamedStackKey has copy, drop, store { caster: u64, spell: ID, target: u64 }
public struct NamedStackRow has copy, drop, store { bonus: u64, expires_turn: u64 }

/// Effect 787 is a marker over a flattened linked payload. Delay zero is normalized to the next bearer turn;
/// the corpus pair used by the held spell has delay one.
public(package) fun schedule_payload(
  fight: &mut Fight,
  fighter: u64,
  source: u64,
  delay: u64,
  effects: vector<Effect>,
) {
  if (effects.is_empty()) return;
  let key = TimedPayloadKey { fighter };
  if (!df::exists(fight::uid(fight), key)) {
    df::add(fight::uid_mut(fight), key, vector<TimedPayload>[]);
  };
  let rows = df::borrow_mut<TimedPayloadKey, vector<TimedPayload>>(fight::uid_mut(fight), key);
  rows.push_back(TimedPayload {
    remaining: clamp_delay(delay),
    source,
    effects,
  });
}

/// Decrement this bearer's private queue at turn start and move out every now-due batch.
public(package) fun take_due_payloads(fight: &mut Fight, fighter: u64): vector<TimedPayload> {
  let key = TimedPayloadKey { fighter };
  if (!df::exists(fight::uid(fight), key)) return vector[];
  let rows = df::borrow_mut<TimedPayloadKey, vector<TimedPayload>>(fight::uid_mut(fight), key);
  let mut kept = vector[];
  let mut due = vector[];
  while (!rows.is_empty()) {
    let TimedPayload { remaining, source, effects } = rows.pop_back();
    if (remaining <= 1) due.push_back(TimedPayload { remaining: 0, source, effects })
    else kept.push_back(TimedPayload { remaining: remaining - 1, source, effects });
  };
  kept.reverse();
  due.reverse();
  *rows = kept;
  due
}

public(package) fun destroy_payload(batch: TimedPayload): (u64, vector<Effect>) {
  let TimedPayload { remaining: _, source, effects } = batch;
  (source, effects)
}

/// Sum still-live base-damage riders for one caster + spell object + aimed fighter. Each appended cast owns its own
/// expiry row; pruning is lazy on the next cast at this exact key.
public(package) fun named_damage_bonus(
  fight: &mut Fight,
  caster: u64,
  spell: ID,
  target: u64,
  turn: u64,
): u64 {
  let key = NamedStackKey { caster, spell, target };
  if (!df::exists(fight::uid(fight), key)) return 0;
  let rows = df::borrow_mut<NamedStackKey, vector<NamedStackRow>>(fight::uid_mut(fight), key);
  let mut kept = vector[];
  let mut sum = 0;
  while (!rows.is_empty()) {
    let row = rows.pop_back();
    if (row.expires_turn >= turn) {
      sum = sum + row.bonus;
      kept.push_back(row);
    };
  };
  kept.reverse();
  *rows = kept;
  sum
}

/// Append the current cast's base-damage rider only after its damage lines resolved, so it benefits future casts only.
public(package) fun record_named_stack(
  fight: &mut Fight,
  caster: u64,
  spell: ID,
  target: u64,
  turn: u64,
  bonus: u64,
  duration: u8,
) {
  if (bonus == 0 || duration == 0) return;
  let key = NamedStackKey { caster, spell, target };
  if (!df::exists(fight::uid(fight), key)) {
    df::add(fight::uid_mut(fight), key, vector<NamedStackRow>[]);
  };
  df::borrow_mut<NamedStackKey, vector<NamedStackRow>>(fight::uid_mut(fight), key).push_back(
    NamedStackRow { bonus, expires_turn: turn + (duration as u64) },
  );
}

// ╔════════════════ [ Status reads / presentation ] ════════════════════════

/// Lowest live 1-in-N denominator wins when multiple critical-failure rows overlap; zero rows are inert.
public(package) fun failure_denominator(fight: &Fight, fighter: u64): u64 {
  let rows = spell_board::fighter_status_rows_of(fight::fx(fight), fighter, spell_effect::k_critical_failure());
  let mut best = 0;
  let n = rows.length();
  let mut i = 0;
  while (i < n) {
    let value = spell_board::status_effect(rows.borrow(i)).value();
    if (value > 0 && (best == 0 || value < best)) best = value;
    i = i + 1;
  };
  best
}

public(package) fun player_fumbles(fight: &Fight, fighter: u64, turn_seed: u64, slot: u64): bool {
  spell_formula::critical_failure_at(turn_seed, slot, failure_denominator(fight, fighter))
}

public(package) fun roll_fumbles(fight: &Fight, fighter: u64, roll: u64): bool {
  let denominator = failure_denominator(fight, fighter);
  denominator > 0 && roll % denominator == 0
}

public(package) fun has_damage_inversion(fight: &Fight, target_is_mob: bool, target_idx: u64): bool {
  spell_board::fighter_status_of(
    fight::fx(fight), fid_of(target_is_mob, target_idx), spell_effect::k_damage_to_heal(),
  ).is_some()
}

/// Stance is a timed board row plus an explicit presentation event. Negative rows restore immediately.
public(package) fun apply_stance(
  fight: &mut Fight,
  target_is_mob: bool,
  target_idx: u64,
  source: u64,
  effect: &Effect,
) {
  let fighter = fid_of(target_is_mob, target_idx);
  spell_board::clear_fighter_status_kind(fight::fx_mut(fight), fighter, spell_effect::k_stance());
  let active = !effect.has_flag(spell_effect::flag_negative());
  if (active && effect.turns() > 0) spell_board::add_status(fight::fx_mut(fight), fighter, source, *effect);
  fight_events::emit_stance_changed(fight::id(fight), target_is_mob, target_idx, effect.value(), active);
}

/// Expiry returns stance rows through the board's existing revert vector; translate them into presentation events.
public(package) fun emit_expired_stances(fight: &Fight, target_is_mob: bool, target_idx: u64, expired: &vector<Effect>) {
  let n = expired.length();
  let mut i = 0;
  while (i < n) {
    let effect = expired.borrow(i);
    if (effect.kind() == spell_effect::k_stance()) {
      fight_events::emit_stance_changed(fight::id(fight), target_is_mob, target_idx, effect.value(), false);
    };
    i = i + 1;
  };
}

/// Stats ids 5 (Vitality) and 10 (MAX_HP) deliberately have no `Stats` field. Punishment bonuses therefore
/// increase the fighter's capacity directly and this expiry fold removes each independent row's exact gain.
public(package) fun revert_expired_max_hp(fight: &mut Fight, target_is_mob: bool, target_idx: u64, expired: &vector<Effect>) {
  let n = expired.length();
  let mut i = 0;
  while (i < n) {
    let effect = expired.borrow(i);
    if (effect.kind() == spell_effect::k_alter_stat()
      && (effect.stat() == spell_effect::stat_vitality() || effect.stat() == spell_effect::stat_max_hp())) {
      if (effect.has_flag(spell_effect::flag_negative())) {
        add_max_hp(fight, target_is_mob, target_idx, effect.value());
      } else {
        remove_max_hp(fight, target_is_mob, target_idx, effect.value());
      };
    };
    i = i + 1;
  };
}

// ╔════════════════ [ Incoming damage / reactions ] ════════════════════════

/// Apply one attributable direct incoming line. Inversion resolves before damage; full redirect replaces the
/// victim write; reflect is calculated from actual HP loss and uses the raw nonrecursive sink.
public(package) fun hit(
  fight: &mut Fight,
  victim_is_mob: bool,
  victim_idx: u64,
  attacker_is_mob: bool,
  attacker_idx: u64,
  has_attacker: bool,
  incoming: u64,
  roll: u64,
): u64 {
  if (incoming == 0 || !fighter_alive(fight, victim_is_mob, victim_idx)) return 0;
  let victim = fid_of(victim_is_mob, victim_idx);

  let inversion = spell_board::fighter_status_of(fight::fx(fight), victim, spell_effect::k_damage_to_heal());
  if (inversion.is_some()) {
    let effect = inversion.destroy_some();
    if (roll % 100 < (effect.chance() as u64)) {
      heal(fight, victim_is_mob, victim_idx, incoming * (effect.stat() as u64));
      return 0
    };
    // The failure branch is still an incoming line and therefore continues through redirect/reactions.
    return hit_after_inversion(
      fight, victim_is_mob, victim_idx, attacker_is_mob, attacker_idx, has_attacker,
      incoming * effect.value(),
    )
  };
  hit_after_inversion(fight, victim_is_mob, victim_idx, attacker_is_mob, attacker_idx, has_attacker, incoming)
}

fun hit_after_inversion(
  fight: &mut Fight,
  victim_is_mob: bool,
  victim_idx: u64,
  attacker_is_mob: bool,
  attacker_idx: u64,
  has_attacker: bool,
  damage: u64,
): u64 {
  let victim = fid_of(victim_is_mob, victim_idx);
  let redirect_rows = spell_board::fighter_status_rows_of(fight::fx(fight), victim, spell_effect::k_damage_redirect());
  let reflect_rows = spell_board::fighter_status_rows_of(fight::fx(fight), victim, spell_effect::k_reflect_damage());
  let punishment_rows = spell_board::fighter_status_rows_of(fight::fx(fight), victim, spell_effect::k_reactive_punishment());
  let erosion_rows = spell_board::fighter_status_rows_of(fight::fx(fight), victim, spell_effect::k_erosion());

  // First full-redirect row wins. It targets the status source and cannot recurse through that fighter's rows.
  let nr = redirect_rows.length();
  let mut r = 0;
  while (r < nr) {
    let row = redirect_rows.borrow(r);
    let effect = spell_board::status_effect(row);
    let source = spell_board::status_source(row);
    if (effect.value() == 0 && source != victim && fid_alive(fight, source)) {
      let (source_is_mob, source_idx) = decode_fid(source);
      raw_hit(fight, source_is_mob, source_idx, damage);
      return 0
    };
    r = r + 1;
  };

  let actual = raw_hit(fight, victim_is_mob, victim_idx, damage);
  if (actual == 0) return 0;

  let erosion_percent = capped_effect_sum(&erosion_rows, 100);
  if (erosion_percent > 0) erode(fight, victim_is_mob, victim_idx, actual * erosion_percent / 100);
  if (fighter_alive(fight, victim_is_mob, victim_idx)) {
    trigger_punishment(fight, victim_is_mob, victim_idx, victim, actual, &punishment_rows);
  };

  // Flat reflection targets the actual attacker, not the row source. The raw hit cannot recurse through reactions.
  if (has_attacker && !(attacker_is_mob == victim_is_mob && attacker_idx == victim_idx)) {
    let reflected = capped_effect_sum(&reflect_rows, damage);
    if (reflected > 0) {
      let _flat_reflected = raw_hit(fight, attacker_is_mob, attacker_idx, reflected);
    };

    // Every positive redirect row remains a separate percent-reflect adaptation.
    let mut j = 0;
    while (j < nr) {
      let effect = spell_board::status_effect(redirect_rows.borrow(j));
      if (effect.value() > 0) {
        let _reflected = raw_hit(fight, attacker_is_mob, attacker_idx, actual * effect.value() / 100);
      };
      j = j + 1;
    };
  };
  actual
}

/// Forced death bypasses mitigation and reactions. The corpus immunity representation is a live reduction row
/// whose value covers the target's whole max-HP pool (raw 105 ships 1500); arbitrary named states do not count.
public(package) fun force_death(fight: &mut Fight, target_is_mob: bool, target_idx: u64): bool {
  if (!fighter_alive(fight, target_is_mob, target_idx)) return false;
  let fighter = fid_of(target_is_mob, target_idx);
  let maximum = max_hp(fight, target_is_mob, target_idx);
  let rows = spell_board::fighter_status_rows_of(fight::fx(fight), fighter, spell_effect::k_reduce_damage());
  let n = rows.length();
  let mut i = 0;
  while (i < n) {
    if (spell_board::status_effect(rows.borrow(i)).value() >= maximum) return false;
    i = i + 1;
  };
  let hp = current_hp(fight, target_is_mob, target_idx);
  raw_hit(fight, target_is_mob, target_idx, hp);
  true
}

fun trigger_punishment(
  fight: &mut Fight,
  target_is_mob: bool,
  target_idx: u64,
  fighter: u64,
  actual: u64,
  rows: &vector<spell_board::FighterStatus>,
) {
  let n = rows.length();
  let mut i = 0;
  while (i < n) {
    let row = rows.borrow(i);
    let effect = spell_board::status_effect(row);
    let gain = if (actual < effect.value()) actual else effect.value();
    let duration = if (effect.area_size() > 255) 255 else effect.area_size() as u8;
    if (gain > 0 && duration > 0) {
      let bonus = spell_effect::alter_stat(effect.stat(), gain, false, true, duration);
      spell_board::add_status(fight::fx_mut(fight), fighter, spell_board::status_source(row), bonus);
      if (effect.stat() == spell_effect::stat_vitality() || effect.stat() == spell_effect::stat_max_hp()) {
        add_max_hp(fight, target_is_mob, target_idx, gain);
      };
    };
    i = i + 1;
  };
  refresh_stats(fight, target_is_mob, target_idx);
}

fun raw_hit(fight: &mut Fight, is_mob: bool, idx: u64, damage: u64): u64 {
  if (!fighter_alive(fight, is_mob, idx)) return 0;
  let before = current_hp(fight, is_mob, idx);
  let actual = if (before < damage) before else damage;
  if (is_mob) mob::damage(fight::mobs_mut(fight).borrow_mut(idx), damage)
  else participant::apply_damage(fight::participants_mut(fight).borrow_mut(idx), damage);
  let remaining = current_hp(fight, is_mob, idx);
  fight_events::emit_hit(fight::id(fight), is_mob, idx, damage, remaining);
  if (remaining == 0) spell_board::clear_fighter(fight::fx_mut(fight), fid_of(is_mob, idx));
  actual
}

fun heal(fight: &mut Fight, is_mob: bool, idx: u64, amount: u64) {
  if (is_mob) mob::apply_heal(fight::mobs_mut(fight).borrow_mut(idx), amount)
  else participant::apply_heal(fight::participants_mut(fight).borrow_mut(idx), amount);
}

fun erode(fight: &mut Fight, is_mob: bool, idx: u64, amount: u64) {
  if (amount == 0) return;
  if (is_mob) mob::erode_max_hp(fight::mobs_mut(fight).borrow_mut(idx), amount)
  else participant::erode_max_hp(fight::participants_mut(fight).borrow_mut(idx), amount);
}

fun add_max_hp(fight: &mut Fight, is_mob: bool, idx: u64, amount: u64) {
  if (is_mob) mob::add_max_hp_bonus(fight::mobs_mut(fight).borrow_mut(idx), amount)
  else participant::add_max_hp_bonus(fight::participants_mut(fight).borrow_mut(idx), amount);
}

fun remove_max_hp(fight: &mut Fight, is_mob: bool, idx: u64, amount: u64) {
  if (is_mob) mob::remove_max_hp_bonus(fight::mobs_mut(fight).borrow_mut(idx), amount)
  else participant::remove_max_hp_bonus(fight::participants_mut(fight).borrow_mut(idx), amount);
}

fun refresh_stats(fight: &mut Fight, is_mob: bool, idx: u64) {
  let fighter = fid_of(is_mob, idx);
  let rows = spell_board::fighter_alter_rows(fight::fx(fight), fighter);
  if (is_mob) mob::refresh_stats(fight::mobs_mut(fight).borrow_mut(idx), &rows)
  else participant::refresh_stats(fight::participants_mut(fight).borrow_mut(idx), &rows);
}

fun capped_effect_sum(rows: &vector<spell_board::FighterStatus>, cap: u64): u64 {
  let mut sum = 0;
  let n = rows.length();
  let mut i = 0;
  while (i < n && sum < cap) {
    let value = spell_board::status_effect(rows.borrow(i)).value();
    let remaining = cap - sum;
    sum = sum + if (value < remaining) value else remaining;
    i = i + 1;
  };
  sum
}

// ╔════════════════ [ Small helpers / test probes ] ════════════════════════

public(package) fun fid_of(is_mob: bool, idx: u64): u64 { if (is_mob) MOB_FID_BASE + idx else idx }

fun decode_fid(fighter: u64): (bool, u64) {
  if (fighter >= MOB_FID_BASE) (true, fighter - MOB_FID_BASE) else (false, fighter)
}

fun fighter_alive(fight: &Fight, is_mob: bool, idx: u64): bool {
  if (is_mob) mob::is_alive(fight::mobs(fight).borrow(idx))
  else participant::is_alive(fight::participants(fight).borrow(idx))
}

fun fid_alive(fight: &Fight, fighter: u64): bool {
  let (is_mob, idx) = decode_fid(fighter);
  fighter_alive(fight, is_mob, idx)
}

fun current_hp(fight: &Fight, is_mob: bool, idx: u64): u64 {
  if (is_mob) mob::hp(fight::mobs(fight).borrow(idx)) else participant::hp(fight::participants(fight).borrow(idx))
}

fun max_hp(fight: &Fight, is_mob: bool, idx: u64): u64 {
  if (is_mob) mob::max_hp(fight::mobs(fight).borrow(idx)) else participant::max_hp(fight::participants(fight).borrow(idx))
}

fun clamp_delay(delay: u64): u8 {
  if (delay == 0) 1 else if (delay > 255) 255 else delay as u8
}

#[test_only]
public fun pending_payloads_for_testing(fight: &Fight, fighter: u64): u64 {
  let key = TimedPayloadKey { fighter };
  if (df::exists(fight::uid(fight), key)) {
    df::borrow<TimedPayloadKey, vector<TimedPayload>>(fight::uid(fight), key).length()
  } else 0
}

#[test_only]
public fun named_rows_for_testing(fight: &Fight, caster: u64, spell: ID, target: u64): u64 {
  let key = NamedStackKey { caster, spell, target };
  if (df::exists(fight::uid(fight), key)) {
    df::borrow<NamedStackKey, vector<NamedStackRow>>(fight::uid(fight), key).length()
  } else 0
}
