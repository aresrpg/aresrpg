// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// TACKLE — the ordinary-movement escape contest (chain twin of the sim's shipped rule,
/// packages/sim/src/fight_actions.js:63-100; formula layer in `spell_formula::tackle_*`). A fighter standing
/// orthogonally adjacent to a LIVING enemy sits in its tackle zone: an ordinary move out of the zone rolls one
/// combined agility contest FIRST — success proceeds, failure DENIES the move and strips the failed fraction of
/// both pools (committed, never an abort — an abort would refund the penalty). Enemies of a participant are
/// every living mob plus every living OTHER-TEAM participant (PvP); enemies of a mob are every living
/// participant. Death exempts a tackler; INVISIBILITY does not — bodies stay physical exactly as they keep
/// blocking cells (`displacement::add_living_bodies`), and the sim rule carries no visibility filter. Spell
/// displacement (push/pull) never contests — only the ordinary movement paths call in here.
module aresrpg_fight::tackle;

use aresrpg_fight::{fight::{Self, Fight}, fight_events, mob, participant};
use aresrpg_foundation::{combat_grid, spell, spell_formula};

/// The agilities of every living enemy orthogonally adjacent to the runner — the tackle zone scan. Empty means
/// no contest (the caller skips the roll entirely, drawing no entropy — the sim gates the same way).
public(package) fun locker_agilities(fight: &Fight, runner_is_mob: bool, runner_idx: u64): vector<u64> {
  let cell = if (runner_is_mob) mob::cell(fight::mobs(fight).borrow(runner_idx))
  else participant::cell(fight::participants(fight).borrow(runner_idx));
  let neighbors = adjacent_cells(cell);
  let mut agis = vector[];
  // Living participants: enemies of every mob; for a participant runner, enemies are the OTHER team's seats
  // (the runner's own team — itself included — never tackles it). Sentinel team is dead weight when the runner
  // is a mob (the `||` short-circuits first).
  let runner_team = if (runner_is_mob) 255u8
  else participant::team(fight::participants(fight).borrow(runner_idx));
  let np = fight::participants(fight).length();
  let mut i = 0;
  while (i < np) {
    let p = fight::participants(fight).borrow(i);
    let hostile = runner_is_mob || participant::team(p) != runner_team;
    if (hostile && participant::is_alive(p) && neighbors.contains(&participant::cell(p))) {
      agis.push_back(spell::stat_agility(participant::stats(p)));
    };
    i = i + 1;
  };
  // Living mobs: enemies of every participant (a mob never tackles a mob — one side).
  if (!runner_is_mob) {
    let nm = fight::mobs(fight).length();
    let mut j = 0;
    while (j < nm) {
      let m = fight::mobs(fight).borrow(j);
      if (mob::is_alive(m) && neighbors.contains(&mob::cell(m))) {
        agis.push_back(spell::stat_agility(mob::stats(m)));
      };
      j = j + 1;
    };
  };
  agis
}

/// Resolve one contest from a RAW u32 `draw` (the caller owns the entropy thread: a player move passes
/// `rng_next(tackle_seed)`'s value — deterministic + previewable; a mob move passes `prng::draw` off the crank).
/// Returns true = ESCAPED (caller proceeds with the walk). False = TACKLED: the proportional AP/MP loss is
/// WRITTEN and the Tackled event emitted here — the caller only denies the move. `roll = draw % den` is
/// byte-identical to `prng::rng_int` / the sim's `rng_int(state.rng, den)`.
public(package) fun resolve(fight: &mut Fight, runner_is_mob: bool, runner_idx: u64, lockers: &vector<u64>, draw: u64): bool {
  let (agility, ap, mp) = if (runner_is_mob) {
    let m = fight::mobs(fight).borrow(runner_idx);
    (spell::stat_agility(mob::stats(m)), mob::ap(m), mob::mp(m))
  } else {
    let p = fight::participants(fight).borrow(runner_idx);
    (spell::stat_agility(participant::stats(p)), participant::ap(p), participant::mp(p))
  };
  let (num, den) = spell_formula::tackle_contest(agility, lockers);
  if (draw % den < num) return true;
  let (ap_lost, mp_lost) = spell_formula::tackle_losses(ap, mp, num, den);
  if (runner_is_mob) {
    let m = fight::mobs_mut(fight).borrow_mut(runner_idx);
    mob::drain_points(m, 0, ap_lost);
    mob::drain_points(m, 1, mp_lost);
  } else {
    let p = fight::participants_mut(fight).borrow_mut(runner_idx);
    participant::remove_points(p, 0, ap_lost);
    participant::remove_points(p, 1, mp_lost);
  };
  fight_events::emit_tackled(fight::id(fight), runner_is_mob, runner_idx, ap_lost, mp_lost, num, den);
  false
}

/// The ≤4 in-grid orthogonal neighbors of `cell` — `step_cell` owns the row-wrap/edge law, so cell 19→20 style
/// false adjacency can never enter the scan.
fun adjacent_cells(cell: u64): vector<u64> {
  let mut out = vector[];
  let mut d = 0u8;
  while (d < 4) {
    let next = combat_grid::step_cell(cell, d);
    if (next.is_some()) out.push_back(next.destroy_some());
    d = d + 1;
  };
  out
}
