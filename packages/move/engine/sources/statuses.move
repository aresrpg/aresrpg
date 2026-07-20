// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Fight-status combat semantics over the upgrade-safe `spell_board` rows.
///
/// AresRPG 1.29 brand rules implemented here: kind 27 is the authoritative invisibility state; enemies cannot
/// directly select an invisible fighter, while allies may still target them. A selected cast is DIRECT only when
/// it has at least one fighter-resolving effect and every such effect is point-shaped; any non-point fighter zone
/// makes the cast cell-resolved AoE and hidden occupants still resolve normally. When every participant is hidden,
/// mobs idle because the frozen fight layouts hold no trustworthy last-known cell—current hidden cells are never
/// approached omnisciently. Only positive direct cast/weapon/displacement-collision damage reveals the DAMAGER;
/// recoil and trap/glyph/DoT board damage are indirect. Reveal removes every invisibility row and nothing else,
/// preserving separate riders such as the corpus spell's MP status.
module aresrpg_fight::statuses;

use aresrpg_fight::{fight::{Self, Fight}, fight_events, mob, participant};
use aresrpg_foundation::{spell_board, spell_effect::{Self, Effect}};

const MOB_FID_BASE: u64 = 1_000;

public(package) fun is_invisible(fight: &Fight, is_mob: bool, idx: u64): bool {
  spell_board::fighter_status_of(
    fight::fx(fight),
    fighter_id(is_mob, idx),
    spell_effect::k_invisibility(),
  ).is_some()
}

/// Strip ONLY invisibility from the named fighter and ANNOUNCE it — multiple stacked kind-27 rows all leave
/// together. The `is_invisible` guard makes this a no-op (and emits NOTHING) on an already-visible fighter, so
/// the every-damaging-cast callers only fire `Revealed` on a real reveal — the client had no signal to clear the
/// hidden state before (it stayed hidden forever). Also the `k_reveal` spell's home, so that path announces too.
public(package) fun reveal(fight: &mut Fight, is_mob: bool, idx: u64) {
  if (!is_invisible(fight, is_mob, idx)) return;
  spell_board::clear_fighter_status_kind(
    fight::fx_mut(fight),
    fighter_id(is_mob, idx),
    spell_effect::k_invisibility(),
  );
  fight_events::emit_revealed(fight::id(fight), is_mob, idx);
}

/// Does `target_cell` hold a living invisible enemy of player `caster_seat`? Participant allies stay targetable;
/// every mob is an enemy in PvM. Used only after the selected normal/critical effect list is known to be direct.
public(package) fun invisible_enemy_at(fight: &Fight, caster_seat: u64, target_cell: u64): bool {
  let caster_team = participant::team(fight::participants(fight).borrow(caster_seat));
  let np = fight::participants(fight).length();
  let mut i = 0;
  while (i < np) {
    let p = fight::participants(fight).borrow(i);
    if (participant::is_alive(p)
      && participant::team(p) != caster_team
      && participant::cell(p) == target_cell
      && is_invisible(fight, false, i)) return true;
    i = i + 1;
  };
  let nm = fight::mobs(fight).length();
  let mut j = 0;
  while (j < nm) {
    let m = fight::mobs(fight).borrow(j);
    if (mob::is_alive(m) && mob::cell(m) == target_cell && is_invisible(fight, true, j)) return true;
    j = j + 1;
  };
  false
}

/// Chosen-list directness. Caster-only movement/recoil and board-placement markers do not select a fighter.
/// A mixed list containing any non-point fighter zone is canonically an AoE-by-cell cast.
public(package) fun is_direct_effect_list(effects: &vector<Effect>): bool {
  let mut selects_fighter = false;
  let n = effects.length();
  let mut i = 0;
  while (i < n) {
    let effect = effects.borrow(i);
    if (fighter_resolving(effect.kind())) {
      selects_fighter = true;
      if (effect.area_shape() != spell_effect::shape_point()) return false;
    };
    i = i + 1;
  };
  selects_fighter
}

fun fighter_resolving(kind: u8): bool {
  kind != spell_effect::k_caster_damage()
    && kind != spell_effect::k_teleport()
    && kind != spell_effect::k_place_trap()
    && kind != spell_effect::k_place_glyph()
}

fun fighter_id(is_mob: bool, idx: u64): u64 {
  if (is_mob) MOB_FID_BASE + idx else idx
}
