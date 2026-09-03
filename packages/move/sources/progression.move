// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// HP — persistent, lazily regenerating (ruling 2026-08-09): no background process, TIME is
/// the regen and the checkpoint doors are the writers — every act (travel, gather, search,
/// fight, consumable) calls `touch` on its way through. Fixed game-wide rate: it feels fast at
/// low level and slow at high level — consumables are the high-level answer. Max hp = class
/// base + per-level + the folded gear vitality. A fight loss or forfeit leaves 1 hp; zero
/// never exists outside a fight.
module aresrpg::progression;

use aresrpg::{character::{Self, Character}, equipment};
use aresrpg_seed::spell_rows::SpellTemplate;
use aresrpg_math::{item_stats, job_xp};
use std::string::String;
use sui::{clock::Clock, dynamic_field as dfield, vec_map::{Self, VecMap}};

const BASE_HP: u64 = 50;
const HP_PER_LEVEL: u64 = 5;
/// One hp every seconds — game-wide constant, tuned before mainnet.
const REGEN_MS_PER_HP: u64 = 1_000;

public struct HpKey() has copy, drop, store;

/// DF key on the character → the raised-spell book: name → invested level (2..max). A spell
/// absent from the map sits at its self-learned level 1. ONE map (not per-spell DFs) so a
/// RESET_SPELL_POINTS consumable can clear the whole allocation in one act.
public struct SpellBookKey() has copy, drop, store;

const ENotLearned: u64 = 1601; // raise_spell: below the spell's unlock level, or a mob spell
const ESpellCapped: u64 = 1602; // raise_spell: already at the spell's top level
const ENoSpellPoints: u64 = 1603; // raise_spell: raising from n to n+1 costs n points

public struct Hp has copy, drop, store {
  current: u64,
  last_ms: u64,
}

// ╔════════════════ [ Job xp — one home, two writers' doors (gather, craft) ] ═ ]

/// DF key on the character → total job xp for one job slug (the 15-job law: 3 gathering
/// tools + 12 craft jobs). Levels come off the immutable `job_xp` curve.
public struct JobXpKey(String) has copy, drop, store;

public fun job_xp_of(character: &Character, job: String): u64 {
  let uid = character.uid();
  if (!dfield::exists(uid, JobXpKey(job))) return 0;
  *dfield::borrow(uid, JobXpKey(job))
}

public fun job_level_of(character: &Character, job: String): u64 {
  job_xp::level_from_xp(job_xp_of(character, job))
}

public(package) fun bank_job_xp(character: &mut Character, job: String, gained: u64) {
  let uid = character.uid_mut();
  if (dfield::exists(uid, JobXpKey(job))) {
    let xp: &mut u64 = dfield::borrow_mut(uid, JobXpKey(job));
    *xp = *xp + gained;
  } else {
    dfield::add(uid, JobXpKey(job), gained);
  }
}

/// Max hp = 50 + 5×level + allocated vitality + the folded gear bonus (malus floored at 1).
public(package) fun max_hp(character: &Character): u64 {
  let base = BASE_HP + HP_PER_LEVEL * (character.level() as u64) + (character.vitality() as u64);
  item_stats::apply_centered_to_base(base, equipment::folded(character).vitality() as u64)
}

/// The checkpoint door: apply lazy regen (whole ticks only — the remainder stays banked in
/// `last_ms`), clamp to max, return current. First touch initializes at full hp.
public(package) fun touch(character: &mut Character, clock: &Clock): u64 {
  let max = max_hp(character);
  let now = clock.timestamp_ms();
  let uid = character::uid_mut(character);
  if (!dfield::exists(uid, HpKey())) {
    dfield::add(uid, HpKey(), Hp { current: max, last_ms: now });
    return max
  };
  let hp: &mut Hp = dfield::borrow_mut(uid, HpKey());
  let elapsed = if (now >= hp.last_ms) now - hp.last_ms else 0;
  let ticks = elapsed / REGEN_MS_PER_HP;
  hp.current = hp.current + ticks;
  hp.last_ms = hp.last_ms + ticks * REGEN_MS_PER_HP;
  if (hp.current > max) hp.current = max;
  hp.current
}

/// Invested level of a spell — 1 the moment the character reaches its unlock level (spells
/// learn themselves, the Dofus law), 0 before.
public fun spell_level(character: &Character, spell: &SpellTemplate): u64 {
  if ((character.level() as u64) < (spell.unlock_level() as u64)) return 0;
  let uid = character.uid();
  if (!dfield::exists(uid, SpellBookKey())) return 1;
  let book: &VecMap<String, u8> = dfield::borrow(uid, SpellBookKey());
  let name = spell.name();
  if (book.contains(&name)) (book[&name] as u64) else 1
}

/// Raise a spell one level. Cost = the CURRENT level (n → n+1 costs n points), 1.29 exact.
/// The pool lives on the character (`available_spell_points`, granted 1 per level from 2).
public(package) fun raise_spell(character: &mut Character, spell: &SpellTemplate) {
  let current = spell_level(character, spell);
  assert!(current >= 1, ENotLearned);
  assert!(current < spell.max_spell_level(), ESpellCapped);
  assert!((character.available_spell_points() as u64) >= current, ENoSpellPoints);
  character::spend_spell_points(character, (current as u16));

  let name = spell.name();
  let uid = character::uid_mut(character);
  if (!dfield::exists(uid, SpellBookKey())) {
    dfield::add(uid, SpellBookKey(), vec_map::empty<String, u8>());
  };
  let book: &mut VecMap<String, u8> = dfield::borrow_mut(uid, SpellBookKey());
  if (book.contains(&name)) {
    let lvl = &mut book[&name];
    *lvl = *lvl + 1;
  } else {
    book.insert(name, (current + 1) as u8); // current was 1 (level 1), now 2
  };
}

/// RESET SPELL POINTS (the consumable): clear the whole raised-spell book and refill the pool
/// to level − 1 — every spell drops to its self-learned level 1, all points refunded.
public(package) fun reset_spells(character: &mut Character) {
  let uid = character::uid_mut(character);
  if (dfield::exists(uid, SpellBookKey())) {
    *dfield::borrow_mut(uid, SpellBookKey()) = vec_map::empty<String, u8>();
  };
  character::reset_spell_points(character);
}

/// HEAL the character by `amount`, capped at max hp (regen banked first). The consumable's
/// answer to the slow high-level regen.
public(package) fun heal(character: &mut Character, amount: u64, clock: &Clock) {
  let max = max_hp(character);
  let current = touch(character, clock); // banks regen, returns current
  let healed = if (current + amount > max) max else current + amount;
  set_hp(character, healed, clock);
}

/// The fight's write-back (loss/forfeit passes 1 — zero never exists outside a fight).
public(package) fun set_hp(character: &mut Character, value: u64, clock: &Clock) {
  let now = clock.timestamp_ms();
  let uid = character::uid_mut(character);
  if (dfield::exists(uid, HpKey())) {
    let hp: &mut Hp = dfield::borrow_mut(uid, HpKey());
    hp.current = value;
    hp.last_ms = now;
  } else {
    dfield::add(uid, HpKey(), Hp { current: value, last_ms: now });
  }
}
