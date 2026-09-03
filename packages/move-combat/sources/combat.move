// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Authority-free combat state and rules. This package owns no UID, object custody, transfer,
/// event, clock, randomness source, or transaction context. The game package authenticates an
/// action, supplies plain entropy and time values, then asks this machine for one deterministic
/// transition.
module aresrpg_combat::combat;

use aresrpg_math::{
  combat_grid::{Self, GridSpec},
  fight_math,
  item_stats::{Self, ItemStatistics},
  mob_data::{Self, LootEntry},
  mob_scaling,
  prng,
  spell_effect::{Self, Effect, SpellLevel},
};
use std::string::String;

const ENotPlacement: u64 = 1706;
const EBadCell: u64 = 1709;
const ENotEnded: u64 = 1710;
const EAlreadySettled: u64 = 1711;
const ENotSettled: u64 = 1712;
const ENoAp: u64 = 1715;
const EOutOfRange: u64 = 1716;
const ENoLineOfSight: u64 = 1717;
const ENotInLine: u64 = 1718;
const EBadTargetCell: u64 = 1720;
const ECapReached: u64 = 1721;
const ENotReady: u64 = 1723;
const ETooSoon: u64 = 1724;
const ENoPath: u64 = 1725;
const ENotAMob: u64 = 1728;
const ENotLastSettler: u64 = 1729;

const PLACEMENT_FORCE_MS: u64 = 60_000;
const TURN_MIN_MS: u64 = 3_000;
const TURN_MAX_MS: u64 = 45_000;
const NO_TARGET: u64 = 0xFFFF_FFFF;
const BASE_AP: u64 = 6;
const BASE_MP: u64 = 3;

const K_DAMAGE: u8 = 0;
const K_PCT_LIFE: u8 = 1;
const K_CASTER_DAMAGE: u8 = 2;
const K_PUNISHMENT: u8 = 3;
const K_ADD: u8 = 4;
const K_REMOVE: u8 = 5;
const K_STEAL: u8 = 6;
const K_CHATIMENT: u8 = 7;
const K_PUSH: u8 = 8;
const K_PULL: u8 = 9;
const K_TELEPORT: u8 = 10;
const K_SWAP: u8 = 11;
const K_TRAP: u8 = 12;
const K_GLYPH: u8 = 13;
const K_REDUCE: u8 = 14;
const K_REFLECT: u8 = 15;
const K_DISPEL: u8 = 16;
const K_INVIS: u8 = 17;
const K_RETURN: u8 = 18;
const K_REDIRECT: u8 = 19;
const K_FIXED_REMOVE: u8 = 20;

const STAT_STRENGTH: u8 = 0;
const STAT_INTELLIGENCE: u8 = 1;
const STAT_CHANCE: u8 = 2;
const STAT_AGILITY: u8 = 3;
const STAT_WISDOM: u8 = 4;
const STAT_RANGE: u8 = 5;
const STAT_AP: u8 = 6;
const STAT_MP: u8 = 7;
const STAT_POWER: u8 = 8;
const STAT_RAW_DAMAGE: u8 = 9;
const STAT_CRITICAL: u8 = 10;
const STAT_RESIST: u8 = 11;
const STAT_HP: u8 = 12;
const STAT_ANY: u8 = 255;

public struct State has store {
  board: GridSpec,
  closed: vector<u64>,
  fighters: vector<Fighter>,
  zones: vector<BoardZone>,
  queue: vector<u64>,
  turn_pointer: u64,
  round: u64,
  ended: bool,
  winner: Option<u8>,
  turn_seed: u64,
  turn_cast_index: u64,
  turn_casts: vector<TurnCast>,
  placement_started_ms: u64,
  turn_started_ms: u64,
}

public enum FighterKind has drop, store {
  Player,
  Mob(MobSnapshot),
}

public struct Fighter has drop, store {
  team: u8,
  kind: FighterKind,
  stats: FighterStats,
  cell: u64,
  ready: bool,
  dead: bool,
  settled: bool,
  forfeited: bool,
  hp: u64,
  ap: u64,
  mp: u64,
  drops: vector<RolledDrop>,
  effects: vector<ActiveEffect>,
  cooldowns: vector<Cooldown>,
}

public struct FighterStats has copy, drop, store {
  sheet: Sheet,
  max_hp: u64,
  base_ap: u64,
  base_mp: u64,
  earth_resistance: u64,
  fire_resistance: u64,
  water_resistance: u64,
  air_resistance: u64,
}

public struct Sheet has copy, drop, store {
  strength: u64,
  intelligence: u64,
  chance: u64,
  agility: u64,
  wisdom: u64,
  raw_damage: u64,
  critical: u64,
  range_bonus: u64,
  level: u64,
}

public struct MobSnapshot has copy, drop, store {
  mob_type: String,
  level: u64,
  kit: vector<KitSpell>,
  xp: u64,
  loot: vector<LootEntry>,
}

public struct KitSpell has copy, drop, store {
  name: String,
  ordinal: u8,
  level: SpellLevel,
}

public struct ActiveEffect has copy, drop, store {
  kind: u8,
  element: String,
  value: u64,
  turns_left: u64,
  source: u64,
  stat: u8,
}

public struct Cooldown has copy, drop, store { spell: String, left: u64 }

public struct BoardZone has copy, drop, store {
  owner_fighter: u64,
  trap: bool,
  shape: u8,
  size: u8,
  anchor: u64,
  turns_left: u64,
  effects: vector<Effect>,
}

public struct TurnCast has copy, drop, store { spell: String, target: u64 }

public struct RolledDrop has copy, drop, store { item_type: String, qty: u32 }

/// One turn seed consumed while the machine advanced. Core emits the durable event.
public struct TurnSeedUse has copy, drop, store { fighter: u64, seed: u64 }

public fun new_sheet(
  strength: u64,
  intelligence: u64,
  chance: u64,
  agility: u64,
  wisdom: u64,
  raw_damage: u64,
  critical: u64,
  range_bonus: u64,
  level: u64,
): Sheet {
  Sheet { strength, intelligence, chance, agility, wisdom, raw_damage, critical, range_bonus, level }
}

public fun new_fighter_stats(
  sheet: Sheet,
  max_hp: u64,
  base_ap: u64,
  base_mp: u64,
  earth_resistance: u64,
  fire_resistance: u64,
  water_resistance: u64,
  air_resistance: u64,
): FighterStats {
  FighterStats {
    sheet, max_hp, base_ap, base_mp, earth_resistance, fire_resistance,
    water_resistance, air_resistance,
  }
}

public fun player_fighter_stats(
  strength: u64,
  intelligence: u64,
  chance: u64,
  agility: u64,
  wisdom: u64,
  level: u64,
  max_hp: u64,
  folded: &ItemStatistics,
): FighterStats {
  let shift = item_stats::shift() as u64;
  let sheet = new_sheet(
    fight_math::apply_centered_shift(strength, folded.strength() as u64, shift),
    fight_math::apply_centered_shift(intelligence, folded.intelligence() as u64, shift),
    fight_math::apply_centered_shift(chance, folded.chance() as u64, shift),
    fight_math::apply_centered_shift(agility, folded.agility() as u64, shift),
    fight_math::apply_centered_shift(wisdom, folded.wisdom() as u64, shift),
    fight_math::apply_centered_shift(0, folded.raw_damage() as u64, shift),
    fight_math::apply_centered_shift(0, folded.critical() as u64, shift),
    fight_math::apply_centered_shift(0, folded.range() as u64, shift),
    level,
  );
  new_fighter_stats(
    sheet,
    max_hp,
    fight_math::apply_centered_shift(BASE_AP, folded.action() as u64, shift),
    fight_math::apply_centered_shift(BASE_MP, folded.movement() as u64, shift),
    folded.earth_resistance() as u64,
    folded.fire_resistance() as u64,
    folded.water_resistance() as u64,
    folded.air_resistance() as u64,
  )
}

public fun new_player_fighter(team: u8, cell: u64, hp: u64, stats: FighterStats): Fighter {
  Fighter {
    team, kind: FighterKind::Player, stats, cell, ready: false, dead: false,
    settled: false, forfeited: false, hp, ap: 0, mp: 0, drops: vector[],
    effects: vector[], cooldowns: vector[],
  }
}

public fun new_mob_snapshot(
  mob_type: String,
  level: u64,
  kit: vector<KitSpell>,
  xp: u64,
  loot: vector<LootEntry>,
): MobSnapshot {
  MobSnapshot { mob_type, level, kit, xp, loot }
}

public fun new_kit_spell(name: String, ordinal: u8, level: SpellLevel): KitSpell {
  KitSpell { name, ordinal, level }
}

public fun new_rolled_drop(item_type: String, quantity: u32): RolledDrop {
  RolledDrop { item_type, qty: quantity }
}

public fun drop_item_type(drop: &RolledDrop): String { drop.item_type }

public fun drop_quantity(drop: &RolledDrop): u32 { drop.qty }

public fun new_mob_fighter(team: u8, cell: u64, stats: FighterStats, snapshot: MobSnapshot): Fighter {
  Fighter {
    team, kind: FighterKind::Mob(snapshot), stats, cell, ready: true, dead: false,
    settled: true, forfeited: false, hp: stats.max_hp, ap: 0, mp: 0, drops: vector[],
    effects: vector[], cooldowns: vector[],
  }
}

public fun scaled_mob_fighter(data: &aresrpg_math::mob_data::MobData, scalar: u64, cell: u64): Fighter {
  let minimum_level = mob_data::level_min(data) as u64;
  let maximum_level = mob_data::level_max(data) as u64;
  let level = minimum_level + (maximum_level - minimum_level) * scalar / 100;
  let max_hp = fight_math::band_scaled(mob_data::hp(data), minimum_level, maximum_level, level);
  let base_ap = fight_math::mob_pool_scaled(
    mob_data::ap(data) as u64, minimum_level, maximum_level, level,
  );
  let base_mp = fight_math::mob_pool_scaled(
    mob_data::mp(data) as u64, minimum_level, maximum_level, level,
  );
  let agility = fight_math::band_scaled(
    mob_data::agility(data) as u64, minimum_level, maximum_level, level,
  );
  let wisdom = fight_math::band_scaled(
    mob_data::wisdom(data) as u64, minimum_level, maximum_level, level,
  );
  let shift = item_stats::shift() as u64;
  let earth_resistance = fight_math::centered_band_scaled(
    mob_data::earth_resistance(data) as u64, shift, minimum_level, maximum_level, level,
  );
  let fire_resistance = fight_math::centered_band_scaled(
    mob_data::fire_resistance(data) as u64, shift, minimum_level, maximum_level, level,
  );
  let water_resistance = fight_math::centered_band_scaled(
    mob_data::water_resistance(data) as u64, shift, minimum_level, maximum_level, level,
  );
  let air_resistance = fight_math::centered_band_scaled(
    mob_data::air_resistance(data) as u64, shift, minimum_level, maximum_level, level,
  );
  let authored_spells = mob_data::spells(data);
  let mut kit = vector[];
  let mut spell_index = 0;
  while (spell_index < authored_spells.length()) {
    let authored_level = mob_data::spell_level(&authored_spells[spell_index]);
    kit.push_back(new_kit_spell(
      mob_data::spell_name(&authored_spells[spell_index]),
      1,
      mob_scaling::spell_level(&authored_level, minimum_level, maximum_level, level),
    ));
    spell_index = spell_index + 1;
  };
  let stats = new_fighter_stats(
    new_sheet(0, 0, 0, agility, wisdom, 0, 0, 0, level),
    max_hp, base_ap, base_mp,
    earth_resistance, fire_resistance, water_resistance, air_resistance,
  );
  let snapshot = new_mob_snapshot(
    mob_data::mob_type(data),
    level,
    kit,
    fight_math::band_scaled(mob_data::xp(data), minimum_level, maximum_level, level),
    mob_scaling::loot(mob_data::loot(data), minimum_level, maximum_level, level),
  );
  new_mob_fighter(1, cell, stats, snapshot)
}

public fun cap_fighter_hp(mut fighter: Fighter, maximum: u64): Fighter {
  if (fighter.hp > maximum) fighter.hp = maximum;
  fighter
}

#[test_only]
public fun set_fighter_settled_for_testing(state: &mut State, fighter: u64, settled: bool) {
  state.fighters[fighter].settled = settled;
}

#[test_only]
public fun set_ended_for_testing(state: &mut State, winner: Option<u8>) {
  state.ended = true;
  state.winner = winner;
}

public fun new_state(board: GridSpec, fighters: vector<Fighter>, placement_started_ms: u64): State {
  let closed = combat_grid::closed_mask(&board);
  State {
    board, closed, fighters, zones: vector[], queue: vector[], turn_pointer: 0, round: 0,
    ended: false, winner: option::none(), turn_seed: 0, turn_cast_index: 0,
    turn_casts: vector[], placement_started_ms, turn_started_ms: 0,
  }
}

public fun destroy(state: State) {
  let State {
    board: _, closed: _, fighters: _, zones: _, queue: _, turn_pointer: _, round: _,
    ended: _, winner: _, turn_seed: _, turn_cast_index: _, turn_casts: _,
    placement_started_ms: _, turn_started_ms: _,
  } = state;
}

public fun add_fighter(state: &mut State, fighter: Fighter) { state.fighters.push_back(fighter); }

public fun fighter_count(state: &State): u64 { state.fighters.length() }

public fun fighter_team(state: &State, fighter: u64): u8 { state.fighters[fighter].team }

public fun fighter_cell(state: &State, fighter: u64): u64 { state.fighters[fighter].cell }

public fun fighter_hp(state: &State, fighter: u64): u64 { state.fighters[fighter].hp }

public fun fighter_dead(state: &State, fighter: u64): bool { state.fighters[fighter].dead }

public fun fighter_settled(state: &State, fighter: u64): bool { state.fighters[fighter].settled }

public fun fighter_forfeited(state: &State, fighter: u64): bool { state.fighters[fighter].forfeited }

public fun fighter_is_mob(state: &State, fighter: u64): bool { is_mob(&state.fighters[fighter]) }

public fun in_placement(state: &State): bool { state.round == 0 && !state.ended }

public fun ended(state: &State): bool { state.ended }

public fun winner(state: &State): Option<u8> { state.winner }

public fun queue(state: &State): vector<u64> { state.queue }

public fun placement_started_ms(state: &State): u64 { state.placement_started_ms }

public fun set_placement_started_ms(state: &mut State, value: u64) { state.placement_started_ms = value; }

public fun first_free_start(state: &State, team: u8): Option<u64> {
  let starts = if (team == 0) state.board.start_cells_a() else state.board.start_cells_b();
  let mut occupied = vector[];
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    if (!state.fighters[fighter].settled) occupied.push_back(state.fighters[fighter].cell);
    fighter = fighter + 1;
  };
  combat_grid::first_free(&starts, &occupied)
}

public fun turn_seed_fighter(receipt: &TurnSeedUse): u64 { receipt.fighter }

public fun turn_seed_value(receipt: &TurnSeedUse): u64 { receipt.seed }

public fun player_count(state: &State, team: u8): u64 {
  let mut count = 0;
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    let row = &state.fighters[fighter];
    if (row.team == team && !is_mob(row) && !row.settled) count = count + 1;
    fighter = fighter + 1;
  };
  count
}

public fun place(state: &mut State, fighter: u64, cell: u64) {
  assert!(in_placement(state), ENotPlacement);
  assert!(!state.fighters[fighter].settled && !state.fighters[fighter].dead, EBadCell);
  let team = state.fighters[fighter].team;
  let starts = if (team == 0) state.board.start_cells_a() else state.board.start_cells_b();
  assert!(starts.contains(&cell) && fighter_at(state, cell).is_none(), EBadCell);
  state.fighters[fighter].cell = cell;
}

/// Mark one player ready. Returns true when this was the final missing ready player.
public fun ready(state: &mut State, fighter: u64): bool {
  assert!(in_placement(state), ENotPlacement);
  let row = &mut state.fighters[fighter];
  assert!(!is_mob(row) && !row.settled && !row.dead, EBadCell);
  row.ready = true;
  all_players_ready(state)
}

public fun start(state: &mut State, turn_seeds: vector<u64>, now_ms: u64): vector<TurnSeedUse> {
  assert!(in_placement(state), ENotPlacement);
  assert!(
    all_players_ready(state) || placement_force_ready(state.placement_started_ms, now_ms),
    ENotReady,
  );
  assert!(living_count(state, 0) > 0 && living_count(state, 1) > 0, ENotReady);
  let mut teams = vector[];
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    teams.push_back(state.fighters[fighter].team);
    fighter = fighter + 1;
  };
  state.queue = fight_math::weave_teams(teams);
  state.round = 1;
  let mut pointer = 0;
  while (state.fighters[state.queue[pointer]].dead) pointer = pointer + 1;
  state.turn_pointer = pointer;
  let mut turn_seeds = turn_seeds;
  advance_to_player(state, &mut turn_seeds, now_ms, true)
}

public fun active_fighter(state: &State): u64 {
  assert_active(state);
  state.queue[state.turn_pointer]
}

public fun move_active_fighter(state: &mut State, path: &vector<u64>) {
  let fighter = active_fighter(state);
  walk_path(state, fighter, path);
}

public fun end_turn(state: &mut State, turn_seeds: vector<u64>, now_ms: u64): vector<TurnSeedUse> {
  let fighter = active_fighter(state);
  assert!(now_ms >= state.turn_started_ms + TURN_MIN_MS, ETooSoon);
  tick_turn_end(state, fighter);
  tick_cooldowns(state, fighter);
  let mut turn_seeds = turn_seeds;
  advance_to_player(state, &mut turn_seeds, now_ms, false)
}

public fun crank(state: &mut State, turn_seeds: vector<u64>, now_ms: u64): vector<TurnSeedUse> {
  let fighter = active_fighter(state);
  if (!state.fighters[fighter].dead) {
    assert!(now_ms >= state.turn_started_ms + TURN_MAX_MS, ETooSoon);
    tick_turn_end(state, fighter);
    tick_cooldowns(state, fighter);
  };
  let mut turn_seeds = turn_seeds;
  advance_to_player(state, &mut turn_seeds, now_ms, false)
}

public fun forfeit(state: &mut State, fighter: u64) {
  assert!(!state.ended, ENotEnded);
  assert!(!state.fighters[fighter].settled, EAlreadySettled);
  state.fighters[fighter].forfeited = true;
  state.fighters[fighter].settled = true;
  kill(state, fighter);
}

public fun fighter_won(state: &State, fighter: u64): bool {
  state.ended && state.winner == option::some(state.fighters[fighter].team)
}

public fun winners_remaining(state: &State): u64 {
  if (state.winner.is_none()) return 0;
  let winning_team = *state.winner.borrow();
  let mut remaining = 0;
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    let row = &state.fighters[fighter];
    if (row.team == winning_team && !is_mob(row) && !row.settled) remaining = remaining + 1;
    fighter = fighter + 1;
  };
  remaining
}

public fun has_mobs(state: &State): bool {
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    if (is_mob(&state.fighters[fighter])) return true;
    fighter = fighter + 1;
  };
  false
}

public fun settlement_values(state: &State, fighter: u64): (bool, bool, u64, u64) {
  assert!(state.ended, ENotEnded);
  assert!(!state.fighters[fighter].settled, EAlreadySettled);
  let won = fighter_won(state, fighter);
  let survived = won && !state.fighters[fighter].dead;
  let hp = if (survived && state.fighters[fighter].hp > 0) state.fighters[fighter].hp else 1;
  let experience = if (won) experience_share(state, fighter) else 0;
  (won, survived, hp, experience)
}

public fun mark_settled(state: &mut State, fighter: u64) {
  assert!(state.ended, ENotEnded);
  assert!(!state.fighters[fighter].settled, EAlreadySettled);
  state.fighters[fighter].settled = true;
}

public fun assert_last_settlers(state: &State, fighters: &vector<u64>) {
  assert!(state.ended, ENotEnded);
  let mut other = 0;
  while (other < state.fighters.length()) {
    if (!fighters.contains(&other))
      assert!(state.fighters[other].settled && state.fighters[other].drops.is_empty(), ENotLastSettler);
    other = other + 1;
  };
}

public fun assert_last_live_player(state: &State, fighter: u64) {
  assert!(in_placement(state), ENotPlacement);
  assert!(!state.fighters[fighter].settled, EAlreadySettled);
  let mut other = 0;
  while (other < state.fighters.length()) {
    if (other != fighter && !is_mob(&state.fighters[other]))
      assert!(state.fighters[other].settled, ENotLastSettler);
    other = other + 1;
  };
}

public fun assert_closable(state: &State) {
  assert!(state.ended, ENotEnded);
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    assert!(state.fighters[fighter].settled && state.fighters[fighter].drops.is_empty(), ENotSettled);
    fighter = fighter + 1;
  };
}

public fun is_closable(state: &State): bool {
  if (!state.ended) return false;
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    if (!state.fighters[fighter].settled || !state.fighters[fighter].drops.is_empty()) return false;
    fighter = fighter + 1;
  };
  true
}

public fun loot_random_draw_count(state: &State, winning_team: u8): u64 {
  let mut rows = 0;
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    let row = &state.fighters[fighter];
    if (row.team != winning_team && is_mob(row)) rows = rows + mob_snapshot(row).loot.length();
    fighter = fighter + 1;
  };
  2 * rows
}

public fun roll_and_split_drops(
  state: &mut State,
  first_settler: u64,
  random_draws: vector<u64>,
): vector<u64> {
  let winning_team = state.fighters[first_settler].team;
  let mut winners = vector[];
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    let row = &state.fighters[fighter];
    if (row.team == winning_team && !is_mob(row) && !row.settled) winners.push_back(fighter);
    fighter = fighter + 1;
  };
  if (winners.is_empty()) return winners;
  let team_chance = team_loot_chance(state, &winners);
  let mut random_draws = random_draws;
  let mut winner_cursor = 0;
  fighter = 0;
  while (fighter < state.fighters.length()) {
    let row = &state.fighters[fighter];
    if (row.team != winning_team && is_mob(row)) {
      let loot = mob_snapshot(row).loot;
      let mut loot_index = 0;
      while (loot_index < loot.length()) {
        let loot_row = &loot[loot_index];
        let chance = {
          let boosted = mob_data::loot_chance_bp(loot_row) as u64 * (600 + team_chance) / 600;
          if (boosted > 10_000) 10_000 else boosted
        };
        let chance_draw = random_draws.remove(0);
        let quantity_draw = random_draws.remove(0);
        if (chance_draw % 10_000 < chance) {
          let minimum = mob_data::loot_min_qty(loot_row) as u64;
          let maximum = mob_data::loot_max_qty(loot_row) as u64;
          let quantity = minimum + quantity_draw % (maximum - minimum + 1);
          state.fighters[winners[winner_cursor]].drops.push_back(RolledDrop {
            item_type: mob_data::loot_item_type(loot_row),
            qty: quantity as u32,
          });
          winner_cursor = (winner_cursor + 1) % winners.length();
        };
        loot_index = loot_index + 1;
      };
    };
    fighter = fighter + 1;
  };
  winners
}

public fun fighter_drops(state: &State, fighter: u64): vector<RolledDrop> {
  state.fighters[fighter].drops
}

public fun first_drop_type(state: &State, fighter: u64): String {
  state.fighters[fighter].drops[0].item_type
}

public fun take_matching_drops(state: &mut State, fighter: u64, item_type: &String): u32 {
  let drops = &mut state.fighters[fighter].drops;
  let mut quantity = 0;
  let mut index = drops.length();
  while (index > 0) {
    index = index - 1;
    if (&drops[index].item_type == item_type) quantity = quantity + drops.remove(index).qty;
  };
  quantity
}

public fun placement_force_ready(placement_started_ms: u64, now_ms: u64): bool {
  placement_started_ms != 0 && now_ms >= placement_started_ms + PLACEMENT_FORCE_MS
}

fun all_players_ready(state: &State): bool {
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    let row = &state.fighters[fighter];
    if (!is_mob(row) && !row.settled && !row.ready) return false;
    fighter = fighter + 1;
  };
  true
}

fun assert_active(state: &State) { assert!(state.round >= 1 && !state.ended, ENotPlacement); }

fun living_count(state: &State, team: u8): u64 {
  let mut count = 0;
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    if (state.fighters[fighter].team == team && !state.fighters[fighter].dead) count = count + 1;
    fighter = fighter + 1;
  };
  count
}

fun experience_share(state: &State, fighter: u64): u64 {
  let team = state.fighters[fighter].team;
  let sheet = sheet_of(state, fighter);
  let mut base_experience = 0;
  let mut player_total_level = 0;
  let mut highest_player_level = 0;
  let mut mob_total_level = 0;
  let mut highest_mob_level = 0;
  let mut index = 0;
  while (index < state.fighters.length()) {
    let row = &state.fighters[index];
    if (row.team == team && !is_mob(row) && !row.forfeited) {
      let level = row.stats.sheet.level;
      player_total_level = player_total_level + level;
      if (level > highest_player_level) highest_player_level = level;
    } else if (row.team != team && is_mob(row)) {
      let snapshot = mob_snapshot(row);
      base_experience = base_experience + snapshot.xp;
      mob_total_level = mob_total_level + snapshot.level;
      if (snapshot.level > highest_mob_level) highest_mob_level = snapshot.level;
    };
    index = index + 1;
  };
  let mut eligible_players = 0;
  index = 0;
  while (index < state.fighters.length()) {
    let row = &state.fighters[index];
    if (row.team == team && !is_mob(row) && !row.forfeited
      && row.stats.sheet.level * 3 >= highest_player_level) eligible_players = eligible_players + 1;
    index = index + 1;
  };
  fight_math::xp_for_player(
    base_experience,
    sheet.wisdom,
    state.fighters[fighter].stats.sheet.level,
    player_total_level,
    mob_total_level,
    highest_mob_level,
    eligible_players,
  )
}

fun team_loot_chance(state: &State, winners: &vector<u64>): u64 {
  let mut sum = 0;
  let mut index = 0;
  while (index < winners.length()) {
    let fighter = winners[index];
    sum = sum + adjusted_stat(
      state, fighter, state.fighters[fighter].stats.sheet.chance, STAT_CHANCE,
    );
    index = index + 1;
  };
  sum / winners.length()
}

fun kill(state: &mut State, fighter: u64) {
  state.fighters[fighter].dead = true;
  state.fighters[fighter].hp = 0;
  let mut zones = vector[];
  let mut index = 0;
  while (index < state.zones.length()) {
    if (state.zones[index].owner_fighter != fighter) zones.push_back(state.zones[index]);
    index = index + 1;
  };
  state.zones = zones;
  let team = state.fighters[fighter].team;
  if (!state.ended && living_count(state, team) == 0) {
    state.ended = true;
    let side_a_alive = living_count(state, 0) > 0;
    let side_b_alive = living_count(state, 1) > 0;
    state.winner = if (side_a_alive) option::some(0)
      else if (side_b_alive) option::some(1)
      else option::none();
  };
}

fun advance_to_player(
  state: &mut State,
  turn_seeds: &mut vector<u64>,
  now_ms: u64,
  inspect_current: bool,
): vector<TurnSeedUse> {
  let queue_length = state.queue.length();
  let mut virtual_ms = now_ms;
  let mut inspect_current = inspect_current;
  let mut hops = 0;
  let mut used = vector[];
  while (hops <= 2 * queue_length) {
    if (!inspect_current) {
      let pointer = (state.turn_pointer + 1) % queue_length;
      if (pointer == 0) state.round = state.round + 1;
      state.turn_pointer = pointer;
    };
    inspect_current = false;
    let fighter = state.queue[state.turn_pointer];
    if (!state.fighters[fighter].dead) {
      state.turn_seed = turn_seeds.remove(0);
      state.turn_cast_index = 0;
      state.turn_casts = vector[];
      state.fighters[fighter].ap = state.fighters[fighter].stats.base_ap;
      state.fighters[fighter].mp = state.fighters[fighter].stats.base_mp;
      apply_pools(state, fighter);
      tick_turn_start(state, fighter);
      if (state.ended) {
        used.push_back(TurnSeedUse { fighter, seed: state.turn_seed });
        return used
      };
      if (!state.fighters[fighter].dead) {
        if (!is_mob(&state.fighters[fighter])) {
          state.turn_started_ms = virtual_ms;
          return used
        };
        used.push_back(TurnSeedUse { fighter, seed: state.turn_seed });
        mob_turn(state, fighter);
        if (state.ended) return used;
        tick_turn_end(state, fighter);
        tick_cooldowns(state, fighter);
        virtual_ms = virtual_ms + TURN_MIN_MS;
      } else {
        used.push_back(TurnSeedUse { fighter, seed: state.turn_seed });
      };
    };
    hops = hops + 1;
  };
  used
}

fun tick_turn_start(state: &mut State, fighter: u64) {
  let effects = state.fighters[fighter].effects;
  let mut index = 0;
  while (index < effects.length()) {
    let effect = &effects[index];
    if (effect.stat == STAT_HP && (effect.kind == K_REMOVE || effect.kind == K_STEAL))
      hit(state, fighter, effect.value, effect.source);
    if (effect.stat == STAT_HP && effect.kind == K_ADD) heal(state, fighter, effect.value);
    index = index + 1;
  };
  if (!state.ended) fire_glyphs_under(state, fighter);
  tick_board_zones(state, fighter);
}

fun tick_turn_end(state: &mut State, fighter: u64) {
  let effects = state.fighters[fighter].effects;
  let mut kept = vector[];
  let mut index = 0;
  while (index < effects.length()) {
    let mut effect = effects[index];
    if (effect.turns_left > 0) effect.turns_left = effect.turns_left - 1;
    if (effect.turns_left > 0) kept.push_back(effect);
    index = index + 1;
  };
  state.fighters[fighter].effects = kept;
}

fun apply_pools(state: &mut State, fighter: u64) {
  let effects = state.fighters[fighter].effects;
  let mut index = 0;
  while (index < effects.length()) {
    let effect = &effects[index];
    if (effect.kind == K_ADD) {
      if (effect.stat == STAT_AP) add_ap(state, fighter, effect.value)
      else if (effect.stat == STAT_MP) add_mp(state, fighter, effect.value);
    } else if (effect.kind == K_REMOVE || effect.kind == K_STEAL || effect.kind == K_FIXED_REMOVE) {
      if (effect.stat == STAT_AP) spend_ap(state, fighter, effect.value)
      else if (effect.stat == STAT_MP) spend_mp(state, fighter, effect.value);
    };
    index = index + 1;
  };
}

fun tick_cooldowns(state: &mut State, fighter: u64) {
  let cooldowns = &mut state.fighters[fighter].cooldowns;
  let mut index = 0;
  while (index < cooldowns.length()) {
    if (cooldowns[index].left > 0) cooldowns[index].left = cooldowns[index].left - 1;
    index = index + 1;
  };
}

fun tick_board_zones(state: &mut State, owner: u64) {
  let mut kept = vector[];
  let mut index = 0;
  while (index < state.zones.length()) {
    let mut zone = state.zones[index];
    if (zone.owner_fighter == owner && zone.turns_left > 0) {
      zone.turns_left = zone.turns_left - 1;
      if (zone.turns_left > 0) kept.push_back(zone);
    } else {
      kept.push_back(zone);
    };
    index = index + 1;
  };
  state.zones = kept;
}

fun sheet_of(state: &State, fighter: u64): Sheet {
  let mut sheet = state.fighters[fighter].stats.sheet;
  sheet.strength = adjusted_stat(state, fighter, sheet.strength, STAT_STRENGTH);
  sheet.intelligence = adjusted_stat(state, fighter, sheet.intelligence, STAT_INTELLIGENCE);
  sheet.chance = adjusted_stat(state, fighter, sheet.chance, STAT_CHANCE);
  sheet.agility = adjusted_stat(state, fighter, sheet.agility, STAT_AGILITY);
  sheet.wisdom = adjusted_stat(state, fighter, sheet.wisdom, STAT_WISDOM);
  sheet.range_bonus = adjusted_stat(state, fighter, sheet.range_bonus, STAT_RANGE);
  sheet.raw_damage = adjusted_stat(state, fighter, sheet.raw_damage, STAT_RAW_DAMAGE);
  sheet.critical = adjusted_stat(state, fighter, sheet.critical, STAT_CRITICAL);
  let power = adjusted_stat(state, fighter, 0, STAT_POWER);
  sheet.strength = sheet.strength + power;
  sheet.intelligence = sheet.intelligence + power;
  sheet.chance = sheet.chance + power;
  sheet.agility = sheet.agility + power;
  sheet
}

fun adjusted_stat(state: &State, fighter: u64, base: u64, stat: u8): u64 {
  let bonus = sum_effects(state, fighter, K_ADD, stat);
  let malus = sum_effects(state, fighter, K_REMOVE, stat)
    + sum_effects(state, fighter, K_STEAL, stat)
    + sum_effects(state, fighter, K_FIXED_REMOVE, stat);
  fight_math::sat_sub(base + bonus, malus)
}

fun effective_stat(state: &State, fighter: u64, stat: u8): u64 {
  let sheet = sheet_of(state, fighter);
  if (stat == STAT_STRENGTH) sheet.strength
  else if (stat == STAT_INTELLIGENCE) sheet.intelligence
  else if (stat == STAT_CHANCE) sheet.chance
  else if (stat == STAT_AGILITY) sheet.agility
  else sheet.wisdom
}

fun adjusted_range(state: &State, fighter: u64, authored_max: u64): u64 {
  let base_bonus = state.fighters[fighter].stats.sheet.range_bonus;
  let bonus = sum_effects(state, fighter, K_ADD, STAT_RANGE);
  let malus = sum_effects(state, fighter, K_REMOVE, STAT_RANGE)
    + sum_effects(state, fighter, K_STEAL, STAT_RANGE);
  fight_math::sat_sub(authored_max + base_bonus + bonus, malus)
}

fun resistance(state: &State, fighter: u64, element: &String): u64 {
  let stats = &state.fighters[fighter].stats;
  let base = if (*element == b"earth".to_string()) stats.earth_resistance
    else if (*element == b"fire".to_string()) stats.fire_resistance
    else if (*element == b"water".to_string()) stats.water_resistance
    else if (*element == b"air".to_string()) stats.air_resistance
    else item_stats::shift() as u64;
  let effects = &state.fighters[fighter].effects;
  let mut bonus = 0;
  let mut malus = 0;
  let mut index = 0;
  while (index < effects.length()) {
    let effect = &effects[index];
    if (effect.stat == STAT_RESIST && (effect.element.is_empty() || effect.element == *element)) {
      if (effect.kind == K_ADD) bonus = bonus + effect.value;
      if (effect.kind == K_REMOVE || effect.kind == K_STEAL) malus = malus + effect.value;
    };
    index = index + 1;
  };
  fight_math::sat_sub(base + bonus, malus)
}

fun hit(state: &mut State, fighter: u64, amount: u64, source: u64) {
  if (state.fighters[fighter].dead || state.ended || amount == 0) return;
  let hp = state.fighters[fighter].hp;
  if (amount >= hp) {
    kill(state, fighter);
    return
  };
  state.fighters[fighter].hp = hp - amount;
  let original_effect_count = state.fighters[fighter].effects.length();
  let turn_owner = state.queue[state.turn_pointer];
  let bonus_turns = spell_effect::chatiment_turns() as u64;
  let from_player = !is_mob(&state.fighters[source]);
  let fed_damage = if (from_player) amount / 2 else amount;
  let mut index = 0;
  while (index < original_effect_count) {
    let stance = state.fighters[fighter].effects[index];
    if (stance.kind == K_CHATIMENT) {
      let mut duplicate = false;
      let mut previous_index = 0;
      while (previous_index < index && !duplicate) {
        let previous = &state.fighters[fighter].effects[previous_index];
        duplicate = previous.kind == K_CHATIMENT
          && previous.stat == stance.stat
          && previous.element == stance.element;
        previous_index = previous_index + 1;
      };
      if (!duplicate) {
        let mut cap = 0;
        let mut stance_index = index;
        while (stance_index < original_effect_count) {
          let row = &state.fighters[fighter].effects[stance_index];
          if (row.kind == K_CHATIMENT && row.stat == stance.stat && row.element == stance.element)
            cap = cap + row.value;
          stance_index = stance_index + 1;
        };
        if (from_player) cap = cap / 2;
        let mut accrued = 0;
        let mut gain_index = 0;
        while (gain_index < state.fighters[fighter].effects.length() && accrued == 0) {
          let gain = &state.fighters[fighter].effects[gain_index];
          if (gain.kind == K_ADD && gain.stat == stance.stat && gain.element == stance.element
            && gain.source == turn_owner && gain.turns_left == bonus_turns) accrued = gain.value;
          gain_index = gain_index + 1;
        };
        let available = fight_math::sat_sub(cap, accrued);
        let gained = if (fed_damage < available) fed_damage else available;
        if (gained > 0) {
          let mut merged = false;
          gain_index = 0;
          while (gain_index < state.fighters[fighter].effects.length() && !merged) {
            let gain = &mut state.fighters[fighter].effects[gain_index];
            if (gain.kind == K_ADD && gain.stat == stance.stat && gain.element == stance.element
              && gain.source == turn_owner && gain.turns_left == bonus_turns) {
              gain.value = gain.value + gained;
              merged = true;
            };
            gain_index = gain_index + 1;
          };
          if (!merged) state.fighters[fighter].effects.push_back(ActiveEffect {
            kind: K_ADD,
            element: stance.element,
            value: gained,
            turns_left: bonus_turns,
            source: turn_owner,
            stat: stance.stat,
          });
        };
      };
    };
    index = index + 1;
  };
}

fun heal(state: &mut State, fighter: u64, amount: u64) {
  if (state.fighters[fighter].dead) return;
  let max_hp = state.fighters[fighter].stats.max_hp;
  let hp = state.fighters[fighter].hp + amount;
  state.fighters[fighter].hp = if (hp > max_hp) max_hp else hp;
}

fun spend_ap(state: &mut State, fighter: u64, amount: u64) {
  state.fighters[fighter].ap = fight_math::sat_sub(state.fighters[fighter].ap, amount);
}

fun spend_mp(state: &mut State, fighter: u64, amount: u64) {
  state.fighters[fighter].mp = fight_math::sat_sub(state.fighters[fighter].mp, amount);
}

fun add_ap(state: &mut State, fighter: u64, amount: u64) {
  state.fighters[fighter].ap = state.fighters[fighter].ap + amount;
}

fun add_mp(state: &mut State, fighter: u64, amount: u64) {
  state.fighters[fighter].mp = state.fighters[fighter].mp + amount;
}

fun sum_effects(state: &State, fighter: u64, kind: u8, stat: u8): u64 {
  let effects = &state.fighters[fighter].effects;
  let mut sum = 0;
  let mut index = 0;
  while (index < effects.length()) {
    let effect = &effects[index];
    if (effect.kind == kind && (stat == STAT_ANY || effect.stat == stat)) sum = sum + effect.value;
    index = index + 1;
  };
  sum
}

fun walk_path(state: &mut State, fighter: u64, path: &vector<u64>) {
  let walls = wall_mask(state, fighter);
  let start = state.fighters[fighter].cell;
  assert!(combat_grid::path_is_walkable(start, path, &walls, state.fighters[fighter].mp), ENoPath);
  let mut contested = vector[];
  let mut index = 0;
  let mut expected = start;
  while (index < path.length()) {
    if (state.fighters[fighter].cell != expected || state.fighters[fighter].mp == 0) return;
    contest_tackle(state, fighter, expected, &mut contested);
    if (state.fighters[fighter].mp == 0) return;
    let next = path[index];
    if (fighter_at(state, next).is_some()) return;
    state.fighters[fighter].cell = next;
    spend_mp(state, fighter, 1);
    on_enter(state, fighter);
    if (state.ended || state.fighters[fighter].dead) return;
    expected = next;
    index = index + 1;
  }
}

fun walk_toward(state: &mut State, fighter: u64, target: u64) {
  let walls = wall_mask(state, fighter);
  let start = state.fighters[fighter].cell;
  if (start == target) return;
  let field = combat_grid::bfs_distance_field(target, &walls, state.fighters[fighter].mp);
  assert!(field[start] <= state.fighters[fighter].mp, ENoPath);
  walk_down(state, fighter, field);
}

fun walk_down(state: &mut State, fighter: u64, field: vector<u64>) {
  let mut contested = vector[];
  loop {
    let current = state.fighters[fighter].cell;
    if (field[current] == 0 || state.fighters[fighter].mp == 0) return;
    contest_tackle(state, fighter, current, &mut contested);
    if (state.fighters[fighter].mp == 0) return;
    let next = combat_grid::best_step(current, &field);
    if (next.is_none()) return;
    let next = next.destroy_some();
    if (fighter_at(state, next).is_some()) return;
    state.fighters[fighter].cell = next;
    spend_mp(state, fighter, 1);
    on_enter(state, fighter);
    if (state.ended || state.fighters[fighter].dead) return;
  }
}

fun contest_tackle(state: &mut State, fighter: u64, cell: u64, contested: &mut vector<u64>) {
  let (fresh, agilities) = fresh_lockers(state, fighter, cell, contested);
  if (fresh.is_empty()) return;
  contested.append(fresh);
  let agility = effective_stat(state, fighter, STAT_AGILITY);
  let (numerator, denominator) = fight_math::tackle_contest(agility, &agilities);
  if (numerator >= denominator) return;
  let mp = state.fighters[fighter].mp;
  let mut roll = fight_math::tackle_seed(state.turn_seed, mp);
  if (prng::draw(&mut roll) % denominator < numerator) return;
  let (ap_loss, mp_loss) = fight_math::tackle_losses(
    state.fighters[fighter].ap, mp, numerator, denominator,
  );
  spend_ap(state, fighter, ap_loss);
  spend_mp(state, fighter, mp_loss);
}

fun wall_mask(state: &State, fighter: u64): vector<u64> {
  let mut walls = state.closed;
  combat_grid::mask_add_cells(&mut walls, &living_cells(state, fighter));
  walls
}

fun fresh_lockers(
  state: &State,
  fighter: u64,
  cell: u64,
  contested: &vector<u64>,
): (vector<u64>, vector<u64>) {
  let team = state.fighters[fighter].team;
  let mut indices = vector[];
  let mut agilities = vector[];
  let mut index = 0;
  while (index < state.fighters.length()) {
    let row = &state.fighters[index];
    if (index != fighter && !row.dead && row.team != team && !contested.contains(&index)
      && combat_grid::manhattan(row.cell, cell) == 1) {
      indices.push_back(index);
      agilities.push_back(effective_stat(state, index, STAT_AGILITY));
    };
    index = index + 1;
  };
  (indices, agilities)
}

fun living_cells(state: &State, excluded: u64): vector<u64> {
  let mut cells = vector[];
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    if (fighter != excluded && !state.fighters[fighter].dead)
      cells.push_back(state.fighters[fighter].cell);
    fighter = fighter + 1;
  };
  cells
}

const MOB_STEP_NONE: u8 = 0;
const MOB_STEP_CAST: u8 = 1;
const MOB_STEP_MOVED: u8 = 2;

fun mob_turn(state: &mut State, mob: u64) {
  loop {
    if (state.ended || state.fighters[mob].dead) return;
    let enemy = nearest_enemy(state, mob);
    if (enemy.is_none()) {
      let starts = if (state.fighters[mob].team == 0) state.board.start_cells_a()
        else state.board.start_cells_b();
      if (!starts.is_empty()) rush_toward(state, mob, starts[0]);
      return
    };
    let enemy = enemy.destroy_some();
    let step = mob_step(state, mob, enemy);
    if (step == MOB_STEP_CAST) continue;
    if (step == MOB_STEP_MOVED) return;
    let enemy_cell = state.fighters[enemy].cell;
    rush_toward(state, mob, enemy_cell);
    return
  }
}

fun mob_step(state: &mut State, mob: u64, enemy: u64): u8 {
  let kit = mob_snapshot(&state.fighters[mob]).kit;
  let mut spell_index = 0;
  while (spell_index < kit.length()) {
    let name = kit[spell_index].name;
    let level = kit[spell_index].level;
    let heal = level.has_heal();
    let caster_only = level.aims_only_at_caster();
    let ally_only = level.aims_only_at_allies();
    let anchor_fighter = if (caster_only) option::some(mob)
      else if (heal) wounded_ally(state, mob)
      else if (ally_only && level.range_max() == 0) option::some(mob)
      else if (ally_only) nearest_ally(state, mob)
      else option::some(enemy);
    if (anchor_fighter.is_some() && level.ap_cost() > 0
      && state.fighters[mob].ap >= level.ap_cost() as u64
      && cooldown_left(state, mob, &name) == 0
      && mob_cast_cap_available(state, &name, &level, *anchor_fighter.borrow())) {
      let target = *anchor_fighter.borrow();
      let anchor = state.fighters[target].cell;
      if (!placement_rows_valid(state, &level, anchor)) {
        spell_index = spell_index + 1;
        continue
      };
      if (mob_castable(state, mob, &level, state.fighters[mob].cell, anchor)) {
        cast_mob_spell(state, mob, &name, anchor);
        return MOB_STEP_CAST
      };
      if (!heal && !caster_only && combat_grid::manhattan(state.fighters[mob].cell, anchor)
        <= state.fighters[mob].mp + (level.range_max() as u64)) {
        let walls = wall_mask(state, mob);
        let cast_cell = combat_grid::bfs_cast_cell(
          state.fighters[mob].cell,
          anchor,
          &walls,
          state.fighters[mob].mp,
          level.range_min() as u64,
          level.range_max() as u64,
          level.line_of_sight(),
          &sight_blockers(state, mob, anchor),
        );
        if (cast_cell.is_some()) {
          walk_toward(state, mob, cast_cell.destroy_some());
          if (state.ended || state.fighters[mob].dead) return MOB_STEP_MOVED;
          let landed = state.fighters[mob].cell;
          let aim = state.fighters[target].cell;
          if (placement_rows_valid(state, &level, aim)
            && mob_castable(state, mob, &level, landed, aim)
            && state.fighters[mob].ap >= level.ap_cost() as u64) {
            cast_mob_spell(state, mob, &name, aim);
            return MOB_STEP_CAST
          };
          return MOB_STEP_MOVED
        };
      };
    };
    spell_index = spell_index + 1;
  };
  MOB_STEP_NONE
}

fun mob_cast_cap_available(state: &State, name: &String, level: &SpellLevel, target: u64): bool {
  let per_turn = level.casts_per_turn() as u64;
  if (per_turn > 0 && casts_this_turn(state, name, option::none()) >= per_turn) return false;
  let per_target = level.casts_per_target() as u64;
  per_target == 0 || casts_this_turn(state, name, option::some(target)) < per_target
}

fun rush_toward(state: &mut State, mob: u64, target: u64) {
  let walls = wall_mask(state, mob);
  let field = combat_grid::approach_field(target, &walls, state.fighters[mob].cell);
  if (field[state.fighters[mob].cell] == combat_grid::path_unreachable()) return;
  walk_down(state, mob, field);
}

fun cast_mob_spell(state: &mut State, fighter: u64, name: &String, target_cell: u64) {
  let kit = mob_snapshot(&state.fighters[fighter]).kit;
  let mut index = 0;
  while (index < kit.length()) {
    if (kit[index].name == *name) {
      let spell = kit[index];
      resolve_spell(state, fighter, &spell.level, spell.name, target_cell, spell.ordinal as u64);
      return
    };
    index = index + 1;
  };
  abort ENotAMob
}

fun mob_castable(state: &State, mob: u64, level: &SpellLevel, from: u64, anchor: u64): bool {
  let distance = combat_grid::manhattan(from, anchor);
  if (distance < level.range_min() as u64 || distance > level.range_max() as u64) return false;
  if (level.line_launch() && !combat_grid::same_line(from, anchor)) return false;
  if (level.line_of_sight()
    && !combat_grid::line_of_sight(from, anchor, &sight_blockers(state, mob, anchor))) return false;
  true
}

fun placement_rows_valid(state: &State, level: &SpellLevel, anchor: u64): bool {
  let effects = level.effects();
  if (!placement_effects_valid(state, &effects, anchor)) return false;
  let critical_effects = level.crit_effects();
  critical_effects.is_empty() || placement_effects_valid(state, &critical_effects, anchor)
}

fun nearest_enemy(state: &State, mob: u64): Option<u64> {
  let team = state.fighters[mob].team;
  let cell = state.fighters[mob].cell;
  let mut best = option::none();
  let mut best_distance = 0;
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    let row = &state.fighters[fighter];
    if (!row.dead && row.team != team && !is_invisible(state, fighter)) {
      let distance = combat_grid::manhattan(row.cell, cell);
      if (best.is_none() || distance < best_distance) {
        best = option::some(fighter);
        best_distance = distance;
      };
    };
    fighter = fighter + 1;
  };
  best
}

fun wounded_ally(state: &State, mob: u64): Option<u64> {
  let team = state.fighters[mob].team;
  let mut best = option::none();
  let mut best_missing_hp = 0;
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    let row = &state.fighters[fighter];
    if (!row.dead && row.team == team) {
      let missing_hp = row.stats.max_hp - row.hp;
      if (missing_hp > best_missing_hp) {
        best = option::some(fighter);
        best_missing_hp = missing_hp;
      };
    };
    fighter = fighter + 1;
  };
  best
}

fun nearest_ally(state: &State, mob: u64): Option<u64> {
  let team = state.fighters[mob].team;
  let cell = state.fighters[mob].cell;
  let mut best = option::none();
  let mut best_distance = 0;
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    let row = &state.fighters[fighter];
    if (fighter != mob && !row.dead && row.team == team) {
      let distance = combat_grid::manhattan(row.cell, cell);
      if (best.is_none() || distance < best_distance) {
        best = option::some(fighter);
        best_distance = distance;
      };
    };
    fighter = fighter + 1;
  };
  if (best.is_none()) option::some(mob) else best
}

public fun cast(
  state: &mut State,
  fighter: u64,
  level: &SpellLevel,
  name: String,
  target_cell: u64,
  learned_level: u64,
) {
  assert!(active_fighter(state) == fighter && !state.fighters[fighter].dead, ENotPlacement);
  resolve_spell(state, fighter, level, name, target_cell, learned_level);
}

fun resolve_spell(
  state: &mut State,
  caster: u64,
  level: &SpellLevel,
  name: String,
  target_cell: u64,
  learned_level: u64,
) {
  let caster_cell = state.fighters[caster].cell;
  let ap_cost = level.ap_cost() as u64;
  assert!(state.fighters[caster].ap >= ap_cost, ENoAp);
  assert!(legal_cell(state, target_cell), EBadTargetCell);
  let sheet = sheet_of(state, caster);
  let distance = combat_grid::manhattan(caster_cell, target_cell);
  let max_range = if (level.modifiable_range()) adjusted_range(state, caster, level.range_max() as u64)
    else level.range_max() as u64;
  assert!(distance >= level.range_min() as u64 && distance <= max_range, EOutOfRange);
  if (level.line_launch()) assert!(combat_grid::same_line(caster_cell, target_cell), ENotInLine);
  if (level.line_of_sight()) assert!(
    combat_grid::line_of_sight(caster_cell, target_cell, &sight_blockers(state, caster, target_cell)),
    ENoLineOfSight,
  );

  let occupant = fighter_at(state, target_cell);
  let per_turn = level.casts_per_turn() as u64;
  if (per_turn > 0)
    assert!(casts_this_turn(state, &name, option::none()) < per_turn, ECapReached);
  let ledger_target = if (occupant.is_some()) *occupant.borrow() else NO_TARGET;
  let per_target = level.casts_per_target() as u64;
  if (per_target > 0 && occupant.is_some()) assert!(
    casts_this_turn(state, &name, option::some(ledger_target)) < per_target,
    ECapReached,
  );
  let cooldown = level.cooldown_turns() as u64;
  if (cooldown > 0) assert!(cooldown_left(state, caster, &name) == 0, ECapReached);

  let cast_index = state.turn_cast_index;
  let critical_roll = fight_math::spell_crit_roll(state.turn_seed, &name);
  let critical_effects = level.crit_effects();
  let critical = !critical_effects.is_empty()
    && fight_math::crit_at(critical_roll, level.crit_1_in() as u64, sheet.critical, sheet.agility);
  let effects = if (critical) critical_effects else level.effects();
  let (placements, payload) = spell_effect::split_placements(&effects);
  if (!placements.is_empty()) assert!(
    zone_anchor_available(state, &placements, target_cell, fighter_at(state, target_cell).is_some()),
    EBadTargetCell,
  );

  spend_ap(state, caster, ap_cost);
  state.turn_cast_index = state.turn_cast_index + 1;
  state.turn_casts.push_back(TurnCast { spell: name, target: ledger_target });
  if (cooldown > 0) set_cooldown(state, caster, name, cooldown);

  if (!placements.is_empty()) {
    let mut placement_index = 0;
    while (placement_index < placements.length()) {
      let placement = &placements[placement_index];
      state.zones.push_back(BoardZone {
        owner_fighter: caster,
        trap: placement.kind() == K_TRAP,
        shape: placement.area_shape(),
        size: placement.area_size(),
        anchor: target_cell,
        turns_left: if (placement.kind() == K_GLYPH) placement.turns() as u64 else 0,
        effects: payload,
      });
      placement_index = placement_index + 1;
    };
    return
  };

  if (spell_effect::has_direct_damage(&effects)) drop_effect_kind(state, caster, K_INVIS);
  let mut effect_entropy = fight_math::effect_seed(state.turn_seed, cast_index);
  resolve_effects(
    state, caster, &sheet, &effects, target_cell, caster_cell, &mut effect_entropy, learned_level,
  );
}

fun resolve_effects(
  state: &mut State,
  caster: u64,
  sheet: &Sheet,
  effects: &vector<Effect>,
  anchor: u64,
  origin: u64,
  entropy: &mut u64,
  learned_level: u64,
) {
  let mut effect_index = 0;
  while (effect_index < effects.length()) {
    if (state.ended) return;
    let effect = &effects[effect_index];
    let chance = effect.chance_bp() as u64;
    if (chance >= 10_000 || prng::draw(entropy) % 10_000 < chance)
      apply_effect(state, caster, sheet, effect, anchor, origin, entropy, learned_level);
    effect_index = effect_index + 1;
  };
}

fun apply_effect(
  state: &mut State,
  caster: u64,
  sheet: &Sheet,
  effect: &Effect,
  anchor: u64,
  origin: u64,
  entropy: &mut u64,
  learned_level: u64,
) {
  let kind = effect.kind();
  if (kind == K_TELEPORT) {
    if (fighter_at(state, anchor).is_none() && legal_cell(state, anchor)) {
      state.fighters[caster].cell = anchor;
      on_enter(state, caster);
    };
    return
  };
  if (kind == K_SWAP) {
    let other = visible_fighter_at(state, caster, anchor);
    if (other.is_some() && *other.borrow() != caster && spell_effect::target_allowed(
      effect.target_filter(),
      state.fighters[caster].team,
      state.fighters[*other.borrow()].team,
      *other.borrow() == caster,
    )) {
      let other = other.destroy_some();
      let caster_cell = state.fighters[caster].cell;
      let other_cell = state.fighters[other].cell;
      state.fighters[caster].cell = other_cell;
      state.fighters[other].cell = caster_cell;
      on_enter(state, caster);
      on_enter(state, other);
    };
    return
  };

  let mut targets = zone_targets(state, caster, effect, anchor, origin);
  if (kind == K_PUSH || kind == K_PULL) {
    let mut cells = vector[];
    let mut fighter = 0;
    while (fighter < state.fighters.length()) {
      cells.push_back(state.fighters[fighter].cell);
      fighter = fighter + 1;
    };
    targets = combat_grid::travel_order(targets, &cells, origin, kind == K_PUSH);
  };
  let mut target_index = 0;
  while (target_index < targets.length()) {
    if (state.ended) return;
    apply_to_fighter(
      state, caster, sheet, effect, targets[target_index], origin, entropy, learned_level,
    );
    target_index = target_index + 1;
  };
}

fun apply_to_fighter(
  state: &mut State,
  caster: u64,
  sheet: &Sheet,
  effect: &Effect,
  target: u64,
  origin: u64,
  entropy: &mut u64,
  learned_level: u64,
) {
  let kind = effect.kind();
  let element = effect.element();
  let value = effect.value() as u64;
  let turns = effect.turns() as u64;
  if (kind == K_DAMAGE) {
    deal_damage(
      state, caster, sheet, target, &element,
      fight_math::roll_effect_value(effect, entropy), learned_level,
    );
  } else if (kind == K_PCT_LIFE) {
    let base = state.fighters[target].stats.max_hp * fight_math::roll_effect_value(effect, entropy) / 100;
    let damage = fight_math::resist(
      base, resistance(state, target, &element), item_stats::shift() as u64,
    );
    hit(state, target, damage, caster);
  } else if (kind == K_CASTER_DAMAGE) {
    let damage = fight_math::resist(
      fight_math::roll_effect_value(effect, entropy),
      resistance(state, caster, &element),
      item_stats::shift() as u64,
    );
    hit(state, caster, damage, caster);
  } else if (kind == K_PUNISHMENT) {
    let base = fight_math::punishment_base(
      fight_math::roll_effect_value(effect, entropy),
      state.fighters[caster].hp,
      state.fighters[caster].stats.max_hp,
    );
    deal_damage(state, caster, sheet, target, &element, base, learned_level);
  } else if (kind == K_REDUCE) {
    let primary = fight_math::primary_stat(
      &element, sheet.strength, sheet.intelligence, sheet.chance, sheet.agility,
    );
    add_active_effect(
      state, target, effect, caster, fight_math::amplify_damage(value, primary, 0),
    );
  } else if (kind == K_ADD || kind == K_REMOVE || kind == K_STEAL || kind == K_FIXED_REMOVE) {
    let stat = effect.stat();
    if (stat == STAT_HP) {
      if (kind == K_ADD && turns == 0) {
        heal(
          state, target,
          fight_math::heal_amount(fight_math::roll_effect_value(effect, entropy), sheet.intelligence),
        );
      } else if (kind == K_ADD) {
        let per_tick = fight_math::heal_amount(
          fight_math::roll_effect_value(effect, entropy), sheet.intelligence,
        );
        add_active_effect(state, target, effect, caster, per_tick);
      } else if (kind == K_STEAL && turns == 0) {
        let dealt = deal_damage(
          state, caster, sheet, target, &element,
          fight_math::roll_effect_value(effect, entropy), learned_level,
        );
        heal(state, caster, dealt / 2);
      } else {
        let per_tick = fight_math::resolved_damage(
          fight_math::roll_effect_value(effect, entropy),
          fight_math::primary_stat(
            &element, sheet.strength, sheet.intelligence, sheet.chance, sheet.agility,
          ),
          sheet.raw_damage,
          resistance(state, target, &element),
          item_stats::shift() as u64,
        );
        add_active_effect(state, target, effect, caster, per_tick);
      };
    } else if (stat == STAT_AP || stat == STAT_MP) {
      let target_is_active = state.queue[state.turn_pointer] == target;
      if (kind == K_ADD) {
        if (target_is_active) {
          if (stat == STAT_AP) add_ap(state, target, value) else add_mp(state, target, value);
        };
        if (turns > 0) add_active_effect(state, target, effect, caster, value);
      } else if (kind == K_FIXED_REMOVE) {
        if (target_is_active) {
          if (stat == STAT_AP) spend_ap(state, target, value) else spend_mp(state, target, value);
        };
        if (!target_is_active || turns > 0) add_active_effect(state, target, effect, caster, value);
      } else {
        let removed = contest_points(state, sheet, target, effect, entropy);
        if (removed > 0) {
          if (target_is_active) {
            if (stat == STAT_AP) spend_ap(state, target, removed) else spend_mp(state, target, removed);
          };
          if (!target_is_active || turns > 0)
            add_active_effect(state, target, effect, caster, removed);
          if (kind == K_STEAL) {
            if (stat == STAT_AP) add_ap(state, caster, removed) else add_mp(state, caster, removed);
          };
        };
      };
    } else {
      add_active_effect(state, target, effect, caster, value);
      if (kind == K_STEAL) state.fighters[caster].effects.push_back(ActiveEffect {
        kind: K_ADD,
        element,
        value,
        turns_left: fight_math::max_1(turns),
        source: caster,
        stat,
      });
    };
  } else if (kind == K_CHATIMENT) {
    add_active_effect(state, target, effect, caster, value);
  } else if (kind == K_PUSH || kind == K_PULL) {
    displace(state, sheet, caster, target, value, kind == K_PUSH, origin, entropy);
  } else if (kind == K_RETURN) {
    state.fighters[target].effects.push_back(ActiveEffect {
      kind: K_RETURN,
      element,
      value: learned_level,
      turns_left: fight_math::max_1(turns),
      source: caster,
      stat: 0,
    });
  } else if (kind == K_DISPEL) {
    state.fighters[target].effects = vector[];
  } else {
    add_active_effect(state, target, effect, caster, value);
  };
}

fun deal_damage(
  state: &mut State,
  caster: u64,
  sheet: &Sheet,
  target: u64,
  element: &String,
  base: u64,
  learned_level: u64,
): u64 {
  if (state.ended || state.fighters[target].dead) return 0;
  let mut damage = fight_math::resolved_damage(
    base,
    fight_math::primary_stat(
      element, sheet.strength, sheet.intelligence, sheet.chance, sheet.agility,
    ),
    sheet.raw_damage,
    resistance(state, target, element),
    item_stats::shift() as u64,
  );
  let target_effects = &state.fighters[target].effects;
  let mut shield = 0;
  let mut effect_index = 0;
  while (effect_index < target_effects.length()) {
    let effect = &target_effects[effect_index];
    if (effect.kind == K_REDUCE && (effect.element.is_empty() || effect.element == *element))
      shield = shield + effect.value;
    effect_index = effect_index + 1;
  };
  damage = fight_math::sat_sub(damage, shield);
  if (damage == 0) return 0;

  let mut final_target = target;
  let mut redirect = option::none();
  effect_index = 0;
  while (effect_index < target_effects.length() && redirect.is_none()) {
    let effect = &target_effects[effect_index];
    if (effect.kind == K_REDIRECT && !state.fighters[effect.source].dead)
      redirect = option::some(effect.source);
    effect_index = effect_index + 1;
  };
  if (redirect.is_some()) final_target = redirect.destroy_some()
  else if (caster != target && learned_level > 0 && learned_level < 6) {
    effect_index = 0;
    while (effect_index < target_effects.length()) {
      let effect = &target_effects[effect_index];
      if (effect.kind == K_RETURN && effect.value >= learned_level) final_target = caster;
      effect_index = effect_index + 1;
    };
  };

  let hp_before = state.fighters[final_target].hp;
  hit(state, final_target, damage, caster);
  if (final_target == target) {
    let reflected = sum_effects_any_stat(state, target, K_REFLECT);
    if (reflected > 0 && caster != target) hit(state, caster, reflected, target);
  };
  if (final_target == target) { if (damage > hp_before) hp_before else damage } else 0
}

fun contest_points(
  state: &State,
  sheet: &Sheet,
  target: u64,
  effect: &Effect,
  entropy: &mut u64,
): u64 {
  let action_points = effect.stat() == STAT_AP;
  let max = if (action_points) state.fighters[target].stats.base_ap
    else state.fighters[target].stats.base_mp;
  let active = state.queue[state.turn_pointer] == target;
  let live = if (action_points) state.fighters[target].ap else state.fighters[target].mp;
  let current = if (active) live else adjusted_stat(
    state, target, max, if (action_points) STAT_AP else STAT_MP,
  );
  let (next, removed) = fight_math::remove_points(
    prng::draw(entropy),
    effect.value() as u64,
    true,
    sheet.wisdom,
    effective_stat(state, target, STAT_WISDOM),
    current,
    max,
  );
  *entropy = next;
  removed
}

fun displace(
  state: &mut State,
  sheet: &Sheet,
  source: u64,
  target: u64,
  cells: u64,
  push: bool,
  origin: u64,
  entropy: &mut u64,
) {
  let started_at = state.fighters[target].cell;
  let direction = if (push) combat_grid::away_dir(origin, started_at)
    else combat_grid::toward_dir(origin, started_at);
  let mut remaining = cells;
  let mut blocked = false;
  while (remaining > 0) {
    let current = state.fighters[target].cell;
    if (!push && combat_grid::manhattan(current, origin) <= 1) break;
    let next = combat_grid::step_cell(current, direction);
    if (next.is_none()) { blocked = current != origin; break };
    let next = next.destroy_some();
    if (!legal_cell(state, next) || fighter_at(state, next).is_some()) { blocked = true; break };
    state.fighters[target].cell = next;
    remaining = remaining - 1;
    if (on_enter(state, target)) break;
    if (state.fighters[target].dead) break;
  };
  if (push && blocked && remaining > 0) hit(
    state,
    target,
    fight_math::push_collision_damage(sheet.level, remaining, prng::draw(entropy)),
    source,
  );
}

fun on_enter(state: &mut State, fighter: u64): bool {
  if (state.fighters[fighter].dead) return false;
  let cell = state.fighters[fighter].cell;
  let zones = state.zones;
  let mut kept = vector[];
  let mut stationary_payloads = vector[];
  let mut displacement_payloads = vector[];
  let mut zone_index = 0;
  while (zone_index < zones.length()) {
    let zone = zones[zone_index];
    let touched = zone.trap
      && combat_grid::in_zone(zone.shape, zone.size as u64, zone.anchor, cell);
    if (touched) {
      if (spell_effect::has_displacement(&zone.effects)) displacement_payloads.push_back(zone)
      else stationary_payloads.push_back(zone);
    } else {
      kept.push_back(zone);
    };
    zone_index = zone_index + 1;
  };
  stationary_payloads.append(displacement_payloads);
  state.zones = kept;
  let fired = !stationary_payloads.is_empty();
  let mut payload_index = 0;
  while (payload_index < stationary_payloads.length()) {
    if (state.ended) break;
    let zone = &stationary_payloads[payload_index];
    let owner_sheet = sheet_of(state, zone.owner_fighter);
    let mut entropy = prng::mix(state.turn_seed, zone.anchor);
    let ordered = spell_effect::displacement_last(&zone.effects);
    let mut effects = vector[];
    let mut effect_index = 0;
    while (effect_index < ordered.length()) {
      effects.push_back(spell_effect::with_area(&ordered[effect_index], zone.shape, zone.size));
      effect_index = effect_index + 1;
    };
    resolve_effects(
      state, zone.owner_fighter, &owner_sheet, &effects, zone.anchor, zone.anchor, &mut entropy, 0,
    );
    payload_index = payload_index + 1;
  };
  fired
}

fun fire_glyphs_under(state: &mut State, fighter: u64) {
  if (state.fighters[fighter].dead) return;
  let cell = state.fighters[fighter].cell;
  let zones = state.zones;
  let mut fired = vector[];
  let mut zone_index = 0;
  while (zone_index < zones.length()) {
    let zone = zones[zone_index];
    if (!zone.trap && combat_grid::in_zone(zone.shape, zone.size as u64, zone.anchor, cell))
      fired.push_back(zone);
    zone_index = zone_index + 1;
  };
  let mut fired_index = 0;
  while (fired_index < fired.length()) {
    if (state.ended) return;
    let zone = &fired[fired_index];
    let owner_sheet = sheet_of(state, zone.owner_fighter);
    let mut entropy = prng::mix(state.turn_seed, zone.anchor);
    resolve_effects(
      state, zone.owner_fighter, &owner_sheet, &zone.effects, cell, cell, &mut entropy, 0,
    );
    fired_index = fired_index + 1;
  };
}

fun add_active_effect(state: &mut State, fighter: u64, effect: &Effect, source: u64, value: u64) {
  state.fighters[fighter].effects.push_back(ActiveEffect {
    kind: effect.kind(),
    element: effect.element(),
    value,
    turns_left: fight_math::max_1(effect.turns() as u64),
    source,
    stat: effect.stat(),
  });
}

fun drop_effect_kind(state: &mut State, fighter: u64, kind: u8) {
  let effects = state.fighters[fighter].effects;
  let mut kept = vector[];
  let mut index = 0;
  while (index < effects.length()) {
    if (effects[index].kind != kind) kept.push_back(effects[index]);
    index = index + 1;
  };
  state.fighters[fighter].effects = kept;
}

fun is_invisible(state: &State, fighter: u64): bool {
  let effects = &state.fighters[fighter].effects;
  let mut index = 0;
  while (index < effects.length()) {
    if (effects[index].kind == K_INVIS) return true;
    index = index + 1;
  };
  false
}

fun cooldown_left(state: &State, fighter: u64, spell: &String): u64 {
  let cooldowns = &state.fighters[fighter].cooldowns;
  let mut index = 0;
  while (index < cooldowns.length()) {
    if (cooldowns[index].spell == *spell) return cooldowns[index].left;
    index = index + 1;
  };
  0
}

fun set_cooldown(state: &mut State, fighter: u64, spell: String, left: u64) {
  let cooldowns = &mut state.fighters[fighter].cooldowns;
  let mut index = 0;
  while (index < cooldowns.length()) {
    if (cooldowns[index].spell == spell) {
      cooldowns[index].left = left;
      return
    };
    index = index + 1;
  };
  cooldowns.push_back(Cooldown { spell, left });
}

fun casts_this_turn(state: &State, spell: &String, target: Option<u64>): u64 {
  let mut count = 0;
  let mut index = 0;
  while (index < state.turn_casts.length()) {
    let cast = &state.turn_casts[index];
    if (cast.spell == *spell && (target.is_none() || *target.borrow() == cast.target))
      count = count + 1;
    index = index + 1;
  };
  count
}

fun sum_effects_any_stat(state: &State, fighter: u64, kind: u8): u64 {
  sum_effects(state, fighter, kind, STAT_ANY)
}

/// Fighter-first zone evaluation. Work scales with the roster, never the 380-cell board.
fun zone_targets(
  state: &State,
  caster: u64,
  effect: &Effect,
  anchor: u64,
  origin: u64,
): vector<u64> {
  let filter = effect.target_filter();
  if (filter == 4) return if (state.fighters[caster].dead) vector[] else vector[caster];
  let mut fighters = vector[];
  let mut ranks = vector[];
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    let row = &state.fighters[fighter];
    if (!row.dead) {
      let rank = combat_grid::zone_rank(
        effect.area_shape(), effect.area_size() as u64, anchor, origin, row.cell,
      );
      let allowed = spell_effect::target_allowed(
        filter, state.fighters[caster].team, row.team, fighter == caster,
      );
      if (rank.is_some() && allowed) {
        fighters.push_back(fighter);
        ranks.push_back(*rank.borrow());
      };
    };
    fighter = fighter + 1;
  };
  let mut sorted = 0;
  while (sorted < fighters.length()) {
    let mut best = sorted;
    let mut candidate = sorted + 1;
    while (candidate < fighters.length()) {
      if (ranks[candidate] < ranks[best]
        || (ranks[candidate] == ranks[best] && fighters[candidate] < fighters[best])) best = candidate;
      candidate = candidate + 1;
    };
    ranks.swap(sorted, best);
    fighters.swap(sorted, best);
    sorted = sorted + 1;
  };
  fighters
}

fun visible_fighter_at(state: &State, caster: u64, cell: u64): Option<u64> {
  let fighter = fighter_at(state, cell);
  if (fighter.is_none()) return fighter;
  let fighter_index = *fighter.borrow();
  if (is_invisible(state, fighter_index)
    && state.fighters[fighter_index].team != state.fighters[caster].team) return option::none();
  fighter
}

fun legal_cell(state: &State, cell: u64): bool {
  combat_grid::in_grid(cell) && !combat_grid::mask_get(&state.closed, cell)
}

fun sight_blockers(state: &State, looker: u64, target_cell: u64): vector<u64> {
  let mut blockers = state.board.obstacles();
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    let row = &state.fighters[fighter];
    if (fighter != looker && !row.dead && !is_invisible(state, fighter) && row.cell != target_cell)
      blockers.push_back(row.cell);
    fighter = fighter + 1;
  };
  blockers
}

fun zone_anchor_available(
  state: &State,
  placements: &vector<Effect>,
  target_cell: u64,
  occupied: bool,
): bool {
  if (placements.length() != 1) return false;
  let mut index = 0;
  while (index < state.zones.length()) {
    if (state.zones[index].anchor == target_cell) return false;
    index = index + 1;
  };
  index = 0;
  while (index < placements.length()) {
    if (placements[index].kind() == K_TRAP && occupied) return false;
    index = index + 1;
  };
  true
}

fun placement_effects_valid(state: &State, effects: &vector<Effect>, target_cell: u64): bool {
  let (placements, _) = spell_effect::split_placements(effects);
  placements.is_empty() || zone_anchor_available(
    state, &placements, target_cell, fighter_at(state, target_cell).is_some(),
  )
}

#[test_only]
fun fighter_for_testing(team: u8, cell: u64, ap: u64, mp: u64): Fighter {
  let sheet = Sheet {
    strength: 0, intelligence: 0, chance: 0, agility: 0, wisdom: 0,
    raw_damage: 0, critical: 0, range_bonus: 0, level: 1,
  };
  Fighter {
    team,
    kind: FighterKind::Player,
    stats: FighterStats {
      sheet, max_hp: 100, base_ap: ap, base_mp: mp,
      earth_resistance: item_stats::shift() as u64,
      fire_resistance: item_stats::shift() as u64,
      water_resistance: item_stats::shift() as u64,
      air_resistance: item_stats::shift() as u64,
    },
    cell, ready: true, dead: false, settled: false, forfeited: false,
    hp: 100, ap, mp, drops: vector[], effects: vector[], cooldowns: vector[],
  }
}

#[test_only]
fun mob_for_testing(team: u8, cell: u64, ap: u64, mp: u64): Fighter {
  let mut fighter = fighter_for_testing(team, cell, ap, mp);
  fighter.kind = FighterKind::Mob(MobSnapshot {
    mob_type: b"test_mob".to_string(), level: 1, kit: vector[], xp: 0, loot: vector[],
  });
  fighter.settled = true;
  fighter
}

#[test_only]
fun active_state_for_testing(board: GridSpec, fighters: vector<Fighter>, active: u64): State {
  let mut state = new_state(board, fighters, 0);
  let mut queue = vector[];
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    queue.push_back(fighter);
    fighter = fighter + 1;
  };
  state.queue = queue;
  state.turn_pointer = active;
  state.round = 1;
  state.turn_seed = 1;
  state
}

#[test_only]
public fun placement_force_ready_for_testing(placement_ms: u64, now_ms: u64): bool {
  placement_force_ready(placement_ms, now_ms)
}

#[test_only]
public fun mob_effect_scaling_for_testing(): vector<u32> {
  let damage = spell_effect::new_effect(
    K_DAMAGE, b"earth".to_string(), 100, 120, spell_effect::shape_point(), 0, 1, 10_000, 0, 0,
  );
  let push = spell_effect::new_effect(
    K_PUSH, b"".to_string(), 3, 3, spell_effect::shape_point(), 0, 1, 10_000, 0, 0,
  );
  let low = mob_scaling::effect(&damage, 10, 20, 10);
  let high = mob_scaling::effect(&damage, 10, 20, 20);
  let geometric = mob_scaling::effect(&push, 10, 20, 20);
  vector[low.value(), low.value_max(), high.value(), high.value_max(), geometric.value()]
}

#[test_only]
public fun final_turn_buff_for_testing(): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let mut fighter = mob_for_testing(0, board.start_cells_a()[0], 6, 3);
  fighter.effects = vector[
    ActiveEffect {
      kind: K_ADD, element: b"".to_string(), value: 2, turns_left: 1, source: 1, stat: STAT_AP,
    },
    ActiveEffect {
      kind: K_ADD, element: b"".to_string(), value: 50, turns_left: 1, source: 1,
      stat: STAT_POWER,
    },
  ];
  let mut state = active_state_for_testing(board, vector[fighter], 0);
  apply_pools(&mut state, 0);
  tick_turn_start(&mut state, 0);
  let mut answer = vector[
    state.fighters[0].ap,
    sheet_of(&state, 0).strength,
    state.fighters[0].effects.length(),
    state.fighters[0].effects[0].turns_left,
  ];
  tick_turn_end(&mut state, 0);
  answer.push_back(state.fighters[0].effects.length());
  destroy(state);
  answer
}

#[test_only]
fun board_zone_for_testing(owner_fighter: u64, trap: bool, anchor: u64): BoardZone {
  BoardZone {
    owner_fighter, trap, shape: spell_effect::shape_point(), size: 0, anchor,
    turns_left: if (trap) 0 else 2, effects: vector[],
  }
}

#[test_only]
public fun zones_after_owner_death_for_testing(): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let cells = board.start_cells_a();
  let fighters = vector[
    mob_for_testing(0, cells[0], 6, 3),
    mob_for_testing(1, board.start_cells_b()[0], 6, 3),
  ];
  let mut state = active_state_for_testing(board, fighters, 0);
  state.zones = vector[
    board_zone_for_testing(0, false, cells[0]),
    board_zone_for_testing(0, true, cells[0]),
    board_zone_for_testing(1, false, cells[0]),
  ];
  kill(&mut state, 0);
  let answer = vector[state.zones.length(), state.zones[0].owner_fighter];
  destroy(state);
  answer
}

#[test_only]
public fun matching_drops_for_testing(): vector<u32> {
  let board = combat_grid::generate(1, 0);
  let mut fighter = fighter_for_testing(0, board.start_cells_a()[0], 6, 3);
  fighter.drops = vector[
    RolledDrop { item_type: b"silk".to_string(), qty: 2 },
    RolledDrop { item_type: b"fang".to_string(), qty: 1 },
    RolledDrop { item_type: b"silk".to_string(), qty: 3 },
  ];
  let mut state = new_state(board, vector[fighter], 0);
  let total = take_matching_drops(&mut state, 0, &b"silk".to_string());
  assert!(state.fighters[0].drops.length() == 1, 0);
  assert!(state.fighters[0].drops[0].item_type == b"fang".to_string(), 1);
  destroy(state);
  vector[total]
}

#[test_only]
public fun three_mob_non_stackable_split_for_testing(): vector<u32> {
  let board = combat_grid::generate(1, 0);
  let mut first = fighter_for_testing(0, board.start_cells_a()[0], 6, 3);
  first.drops = vector[
    RolledDrop { item_type: b"hat".to_string(), qty: 3 },
    RolledDrop { item_type: b"hat".to_string(), qty: 3 },
  ];
  let mut second = fighter_for_testing(0, board.start_cells_a()[1], 6, 3);
  second.drops = vector[RolledDrop { item_type: b"hat".to_string(), qty: 3 }];
  let mut state = new_state(board, vector[first, second], 0);
  let first_total = take_matching_drops(&mut state, 0, &b"hat".to_string());
  let second_total = take_matching_drops(&mut state, 1, &b"hat".to_string());
  destroy(state);
  vector[first_total, second_total, first_total + second_total]
}

#[test_only]
public fun mob_loot_scaling_for_testing(): vector<u64> {
  let authored = vector[mob_data::new_loot_entry(b"fang".to_string(), 5_000, 1, 2)];
  let low = mob_scaling::loot(authored, 10, 20, 10);
  let high = mob_scaling::loot(authored, 10, 20, 20);
  vector[
    mob_data::loot_chance_bp(&low[0]) as u64,
    mob_data::loot_chance_bp(&high[0]) as u64,
    mob_data::loot_min_qty(&high[0]) as u64,
    mob_data::loot_max_qty(&high[0]) as u64,
  ]
}

#[test_only]
public fun rush_for_testing(
  mob_cell: u64,
  enemy_cell: u64,
  wall_cells: vector<u64>,
  movement_points: u64,
): u64 {
  let mut mask = combat_grid::empty_mask();
  let mut y = 0;
  while (y < 12) {
    let mut x = 0;
    while (x < 12) {
      combat_grid::mask_set(&mut mask, combat_grid::encode(x, y));
      x = x + 1;
    };
    y = y + 1;
  };
  let board = combat_grid::grid_spec(
    12, 12, mask, wall_cells, vector[],
    vector[
      combat_grid::encode(0, 0), combat_grid::encode(1, 0), combat_grid::encode(2, 0),
      combat_grid::encode(3, 0), combat_grid::encode(4, 0), combat_grid::encode(5, 0),
    ],
    vector[
      combat_grid::encode(6, 11), combat_grid::encode(7, 11), combat_grid::encode(8, 11),
      combat_grid::encode(9, 11), combat_grid::encode(10, 11), combat_grid::encode(11, 11),
    ],
  );
  let enemy = fighter_for_testing(0, enemy_cell, 6, 3);
  let mob = mob_for_testing(1, mob_cell, 6, movement_points);
  let mut state = active_state_for_testing(board, vector[enemy, mob], 1);
  mob_turn(&mut state, 1);
  let landed = state.fighters[1].cell;
  destroy(state);
  landed
}

#[test_only]
public fun resolve_placement_for_testing(
  existing_kind: u8,
  same_center: bool,
  target_occupied: bool,
  incoming_kinds: vector<u8>,
): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let caster_cell = board.start_cells_a()[0];
  let target_cell = board.start_cells_b()[0];
  let mut fighters = vector[mob_for_testing(0, caster_cell, 6, 3)];
  if (target_occupied) fighters.push_back(mob_for_testing(1, target_cell, 0, 3));
  let mut state = active_state_for_testing(board, fighters, 0);
  if (existing_kind != 0) state.zones.push_back(BoardZone {
    owner_fighter: 0,
    trap: existing_kind == K_TRAP,
    shape: spell_effect::shape_circle(),
    size: 255,
    anchor: if (same_center) target_cell else caster_cell,
    turns_left: if (existing_kind == K_GLYPH) 3 else 0,
    effects: vector[],
  });
  let mut rows = vector[];
  let mut index = 0;
  while (index < incoming_kinds.length()) {
    let kind = incoming_kinds[index];
    rows.push_back(spell_effect::new_effect(
      kind, b"".to_string(), 0, 0, spell_effect::shape_circle(), 2, 0, 10_000,
      if (kind == K_GLYPH) 3 else 0, 0,
    ));
    index = index + 1;
  };
  let level = spell_effect::new_spell_level(
    2, 0, 40, false, false, false, false, 0, 0, 0, 0, rows, vector[],
  );
  cast(&mut state, 0, &level, b"placement_test".to_string(), target_cell, 1);
  let answer = vector[
    state.zones.length(), state.fighters[0].ap, state.turn_cast_index,
    state.turn_casts.length(),
  ];
  destroy(state);
  answer
}

#[test_only]
public fun invisible_after_damage_cast_for_testing(
  placement: bool,
  target_invisible: bool,
): bool {
  let board = combat_grid::generate(1, 0);
  let caster_cell = board.start_cells_a()[0];
  let target_cell = board.start_cells_b()[0];
  let mut caster = mob_for_testing(0, caster_cell, 6, 3);
  caster.effects.push_back(ActiveEffect {
    kind: K_INVIS, element: b"".to_string(), value: 0, turns_left: 3, source: 0, stat: 0,
  });
  let mut fighters = vector[caster];
  if (!placement) {
    let mut target = mob_for_testing(1, target_cell, 0, 3);
    if (target_invisible) target.effects.push_back(ActiveEffect {
      kind: K_INVIS, element: b"".to_string(), value: 0, turns_left: 2, source: 1, stat: 0,
    });
    fighters.push_back(target);
  };
  let damage = spell_effect::new_effect(
    K_DAMAGE, b"earth".to_string(), 10, 10, spell_effect::shape_point(), 0, 0, 10_000, 0, 0,
  );
  let mut rows = vector[];
  if (placement) rows.push_back(spell_effect::new_effect(
    K_TRAP, b"".to_string(), 0, 0, spell_effect::shape_point(), 0, 0, 10_000, 0, 0,
  ));
  rows.push_back(damage);
  let level = spell_effect::new_spell_level(
    2, 0, 40, false, false, false, false, 0, if (target_invisible) 1 else 0, 0, 0,
    rows, vector[],
  );
  let mut state = active_state_for_testing(board, fighters, 0);
  cast(&mut state, 0, &level, b"invisibility_test".to_string(), target_cell, 1);
  if (target_invisible)
    cast(&mut state, 0, &level, b"invisibility_test".to_string(), target_cell, 1);
  let hidden = is_invisible(&state, 0);
  destroy(state);
  hidden
}

#[test_only]
public fun mob_searches_for_invisible_enemy_for_testing(): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let hidden_cell = board.start_cells_a()[1];
  let mob_cell = board.start_cells_a()[0];
  let mut hidden = fighter_for_testing(0, hidden_cell, 0, 3);
  hidden.effects.push_back(ActiveEffect {
    kind: K_INVIS, element: b"".to_string(), value: 0, turns_left: 2, source: 0, stat: 0,
  });
  let mob = mob_for_testing(1, mob_cell, 0, 3);
  let mut state = active_state_for_testing(board, vector[hidden, mob], 1);
  mob_turn(&mut state, 1);
  let after = state.fighters[1].cell;
  destroy(state);
  vector[mob_cell, after]
}

#[test_only]
public fun invisible_teammate_los_for_testing(): bool {
  let board = combat_grid::generate(1, 0);
  let caster_cell = board.start_cells_a()[0];
  let teammate_cell = board.start_cells_a()[1];
  let mut teammate = fighter_for_testing(0, teammate_cell, 0, 3);
  teammate.effects.push_back(ActiveEffect {
    kind: K_INVIS, element: b"".to_string(), value: 0, turns_left: 2, source: 1, stat: 0,
  });
  let state = active_state_for_testing(
    board, vector[fighter_for_testing(0, caster_cell, 6, 3), teammate], 0,
  );
  let blockers = sight_blockers(&state, 0, teammate_cell + 1);
  let transparent = !blockers.contains(&teammate_cell);
  destroy(state);
  transparent
}

#[test_only]
public fun active_chance_for_loot_for_testing(): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let mut player = fighter_for_testing(0, board.start_cells_a()[0], 6, 3);
  player.effects = vector[
    ActiveEffect {
      kind: K_ADD, element: b"".to_string(), value: 600, turns_left: 1, source: 0,
      stat: STAT_CHANCE,
    },
    ActiveEffect {
      kind: K_ADD, element: b"".to_string(), value: 999, turns_left: 1, source: 0,
      stat: STAT_POWER,
    },
  ];
  let mut state = new_state(board, vector[player], 0);
  let winners = vector[0];
  let boosted = team_loot_chance(&state, &winners);
  state.fighters[0].effects.push_back(ActiveEffect {
    kind: K_REMOVE, element: b"".to_string(), value: 120, turns_left: 1, source: 0,
    stat: STAT_CHANCE,
  });
  let reduced = team_loot_chance(&state, &winners);
  state.fighters[0].effects.push_back(ActiveEffect {
    kind: K_STEAL, element: b"".to_string(), value: 60, turns_left: 1, source: 0,
    stat: STAT_CHANCE,
  });
  let stolen = team_loot_chance(&state, &winners);
  destroy(state);
  vector[boosted, reduced, stolen]
}

#[test_only]
public fun elemental_shield_scaling_for_testing(): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let caster_cell = combat_grid::encode(4, 5);
  let target_cell = caster_cell + 1;
  let attacker_cell = combat_grid::encode(10, 15);
  let fighters = vector[
    mob_for_testing(0, caster_cell, 6, 3),
    mob_for_testing(0, target_cell, 6, 3),
    mob_for_testing(1, attacker_cell, 6, 3),
  ];
  let mut state = active_state_for_testing(board, fighters, 0);
  let shield = spell_effect::new_effect(
    K_REDUCE, b"air".to_string(), 12, 12, spell_effect::shape_point(), 0, 0, 10_000, 1, 0,
  );
  let shield_sheet = Sheet {
    strength: 0, intelligence: 0, chance: 0, agility: 400, wisdom: 0,
    raw_damage: 400, critical: 0, range_bonus: 0, level: 1,
  };
  let mut entropy = 1;
  resolve_effects(
    &mut state, 0, &shield_sheet, &vector[shield], target_cell, caster_cell, &mut entropy, 1,
  );
  let scaled = state.fighters[1].effects[0].value;
  state.fighters[1].effects.push_back(ActiveEffect {
    kind: K_REDUCE, element: b"earth".to_string(), value: 100, turns_left: 1,
    source: 0, stat: 0,
  });
  state.fighters[1].effects.push_back(ActiveEffect {
    kind: K_REDUCE, element: b"".to_string(), value: 3, turns_left: 1, source: 0, stat: 0,
  });
  let attacker_sheet = sheet_of(&state, 2);
  let landed = deal_damage(&mut state, 2, &attacker_sheet, 1, &b"air".to_string(), 100, 1);
  destroy(state);
  vector[scaled, landed]
}

#[test_only]
public fun caster_only_cost_for_testing(): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let caster_cell = board.start_cells_a()[0];
  let ally_cell = board.start_cells_a()[1];
  let fighters = vector[
    mob_for_testing(0, caster_cell, 6, 3),
    mob_for_testing(0, ally_cell, 6, 3),
  ];
  let mut state = active_state_for_testing(board, fighters, 0);
  let rows = vector[
    spell_effect::new_effect(
      K_CASTER_DAMAGE, b"water".to_string(), 18, 18, spell_effect::shape_point(), 0, 4,
      10_000, 0, 0,
    ),
    spell_effect::new_effect(
      K_ADD, b"".to_string(), 18, 18, spell_effect::shape_point(), 0, 3, 10_000, 0,
      STAT_HP,
    ),
  ];
  let sheet = sheet_of(&state, 0);
  let mut entropy = 1;
  resolve_effects(
    &mut state, 0, &sheet, &rows, ally_cell, caster_cell, &mut entropy, 1,
  );
  let answer = vector[state.fighters[0].hp, state.fighters[1].hp];
  destroy(state);
  answer
}

#[test_only]
public fun percent_life_roll_for_testing(): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let caster_cell = board.start_cells_a()[0];
  let target_cell = board.start_cells_b()[0];
  let fighters = vector[
    mob_for_testing(0, caster_cell, 6, 3),
    mob_for_testing(1, target_cell, 6, 3),
  ];
  let mut state = active_state_for_testing(board, fighters, 0);
  let row = spell_effect::new_effect(
    K_PCT_LIFE, b"earth".to_string(), 8, 11, spell_effect::shape_point(), 0, 1, 10_000, 0, 0,
  );
  let mut expected_entropy = 1;
  let expected = fight_math::roll_effect_value(&row, &mut expected_entropy);
  let sheet = sheet_of(&state, 0);
  let mut entropy = 1;
  resolve_effects(
    &mut state, 0, &sheet, &vector[row], target_cell, caster_cell, &mut entropy, 1,
  );
  let answer = vector[state.fighters[1].hp, 100 - expected];
  destroy(state);
  answer
}

#[test_only]
public fun pool_removal_semantics_for_testing(): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let caster_cell = board.start_cells_a()[0];
  let target_cell = board.start_cells_b()[0];
  let fighters = vector[
    mob_for_testing(0, caster_cell, 6, 3),
    mob_for_testing(1, target_cell, 6, 3),
  ];
  let mut state = active_state_for_testing(board, fighters, 0);
  let sheet = Sheet {
    strength: 0, intelligence: 0, chance: 0, agility: 0, wisdom: 1_000,
    raw_damage: 0, critical: 0, range_bonus: 0, level: 1,
  };
  let lasting = spell_effect::new_effect(
    K_REMOVE, b"".to_string(), 2, 2, spell_effect::shape_point(), 0, 1, 10_000, 1,
    STAT_AP,
  );
  let mut entropy = 1;
  resolve_effects(
    &mut state, 0, &sheet, &vector[lasting], target_cell, caster_cell, &mut entropy, 1,
  );
  let inactive_rows = state.fighters[1].effects.length();
  let inactive_value = if (inactive_rows == 0) 0 else state.fighters[1].effects[0].value;

  state.fighters[1].effects = vector[];
  state.fighters[1].ap = 6;
  state.queue = vector[1, 0];
  state.turn_pointer = 0;
  let instant = spell_effect::new_effect(
    K_REMOVE, b"".to_string(), 2, 2, spell_effect::shape_point(), 0, 1, 10_000, 0,
    STAT_AP,
  );
  entropy = 1;
  resolve_effects(
    &mut state, 0, &sheet, &vector[instant], target_cell, caster_cell, &mut entropy, 1,
  );
  let instant_ap = state.fighters[1].ap;
  let instant_rows = state.fighters[1].effects.length();

  state.fighters[1].effects = vector[];
  state.fighters[1].ap = 6;
  let fixed = spell_effect::new_effect(
    K_FIXED_REMOVE, b"".to_string(), 100, 100, spell_effect::shape_point(), 0, 1, 10_000, 3,
    STAT_AP,
  );
  entropy = 1;
  resolve_effects(
    &mut state, 0, &sheet, &vector[fixed], target_cell, caster_cell, &mut entropy, 1,
  );
  let fixed_now = state.fighters[1].ap;
  let fixed_value = state.fighters[1].effects[0].value;
  tick_turn_end(&mut state, 1);
  state.fighters[1].ap = BASE_AP;
  apply_pools(&mut state, 1);
  let fixed_next = state.fighters[1].ap;
  tick_turn_end(&mut state, 1);
  tick_turn_end(&mut state, 1);
  state.fighters[1].ap = BASE_AP;
  apply_pools(&mut state, 1);
  let answer = vector[
    inactive_rows, inactive_value, instant_ap, instant_rows,
    fixed_now, fixed_value, fixed_next, state.fighters[1].ap,
  ];
  destroy(state);
  answer
}

#[test_only]
public fun covered_trap_fires_on_move_for_testing(): bool {
  let board = combat_grid::generate(1, 0);
  let anchor = combat_grid::encode(5, 5);
  let to = anchor + 2;
  let fighters = vector[
    fighter_for_testing(0, to, 6, 3),
    mob_for_testing(1, combat_grid::encode(10, 15), 0, 3),
  ];
  let mut state = active_state_for_testing(board, fighters, 0);
  state.zones = vector[BoardZone {
    owner_fighter: 1, trap: true, shape: spell_effect::shape_circle(), size: 2, anchor,
    turns_left: 0, effects: vector[],
  }];
  let fired = on_enter(&mut state, 0);
  let consumed = state.zones.is_empty();
  destroy(state);
  fired && consumed
}

#[test_only]
public fun trap_edge_exit_for_testing(): bool {
  let board = combat_grid::generate(1, 0);
  let anchor = combat_grid::encode(5, 5);
  let to = anchor + 3;
  let fighters = vector[
    fighter_for_testing(0, to, 6, 3),
    mob_for_testing(1, combat_grid::encode(10, 15), 0, 3),
  ];
  let mut state = active_state_for_testing(board, fighters, 0);
  state.zones = vector[BoardZone {
    owner_fighter: 1, trap: true, shape: spell_effect::shape_circle(), size: 2, anchor,
    turns_left: 0, effects: vector[],
  }];
  let fired = on_enter(&mut state, 0);
  let kept = state.zones.length() == 1;
  destroy(state);
  !fired && kept
}

#[test_only]
public fun layered_traps_damage_before_push_for_testing(on_anchor: bool): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let start = combat_grid::encode(5, 5);
  let target = if (on_anchor) start else start + 1;
  let mut zones = vector[BoardZone {
    owner_fighter: 1, trap: true, shape: spell_effect::shape_circle(), size: 1,
    anchor: start, turns_left: 0,
    effects: vector[spell_effect::new_effect(
      K_PUSH, b"".to_string(), 1, 1, spell_effect::shape_circle(), 1, 1, 10_000, 0, 0,
    )],
  }];
  if (!on_anchor) zones.push_back(BoardZone {
    owner_fighter: 1, trap: true, shape: spell_effect::shape_point(), size: 0,
    anchor: target, turns_left: 0,
    effects: vector[spell_effect::new_effect(
      K_DAMAGE, b"earth".to_string(), 5, 5, spell_effect::shape_point(), 0, 1,
      10_000, 0, 0,
    )],
  });
  let fighters = vector[
    fighter_for_testing(0, target, 6, 3),
    mob_for_testing(1, combat_grid::encode(10, 15), 0, 3),
  ];
  let mut state = active_state_for_testing(board, fighters, 0);
  state.zones = zones;
  on_enter(&mut state, 0);
  let answer = vector[
    state.fighters[0].hp,
    state.fighters[0].cell,
    if (on_anchor) start else start + 2,
  ];
  destroy(state);
  answer
}

#[test_only]
public fun life_steal_half_for_testing(): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let caster_cell = board.start_cells_a()[0];
  let target_cell = board.start_cells_b()[0];
  let fighters = vector[
    fighter_for_testing(0, caster_cell, 6, 3),
    mob_for_testing(1, target_cell, 6, 3),
  ];
  let mut state = active_state_for_testing(board, fighters, 0);
  state.fighters[0].hp = 40;
  let sheet = Sheet {
    strength: 0, intelligence: 0, chance: 0, agility: 0, wisdom: 0,
    raw_damage: 0, critical: 0, range_bonus: 0, level: 1,
  };
  let row = spell_effect::new_effect(
    K_STEAL, b"earth".to_string(), 15, 15, spell_effect::shape_point(), 0, 1,
    10_000, 0, STAT_HP,
  );
  let mut entropy = 1;
  resolve_effects(
    &mut state, 0, &sheet, &vector[row], target_cell, caster_cell, &mut entropy, 1,
  );
  let answer = vector[state.fighters[1].hp, state.fighters[0].hp];
  destroy(state);
  answer
}

#[test_only]
public fun range_removal_reaches_authored_max_for_testing(): u64 {
  let board = combat_grid::generate(1, 0);
  let mut fighter = fighter_for_testing(0, board.start_cells_a()[0], 6, 3);
  fighter.effects.push_back(ActiveEffect {
    kind: K_STEAL, element: b"".to_string(), value: 1, turns_left: 2, source: 1,
    stat: STAT_RANGE,
  });
  let state = active_state_for_testing(board, vector[fighter], 0);
  let answer = adjusted_range(&state, 0, 3);
  destroy(state);
  answer
}

#[test_only]
public fun chatiment_caps_for_testing(): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let source = mob_for_testing(0, combat_grid::encode(5, 5), 6, 3);
  let mut target = mob_for_testing(1, combat_grid::encode(10, 15), 6, 3);
  target.stats.max_hp = 300;
  target.hp = 300;
  target.effects.push_back(ActiveEffect {
    kind: K_CHATIMENT, element: b"".to_string(), value: 60, turns_left: 5,
    source: 1, stat: STAT_STRENGTH,
  });
  let mut state = active_state_for_testing(board, vector[source, target], 0);
  hit(&mut state, 1, 40, 0);
  hit(&mut state, 1, 40, 0);
  state.fighters[0].kind = FighterKind::Player;
  state.turn_pointer = 1;
  hit(&mut state, 1, 40, 0);
  hit(&mut state, 1, 40, 0);
  let rows = &state.fighters[1].effects;
  let mut gains = 0;
  let mut gain_value = 0;
  let mut index = 0;
  while (index < rows.length()) {
    if (rows[index].kind == K_ADD && rows[index].stat == STAT_STRENGTH) {
      gains = gains + 1;
      gain_value = gain_value + rows[index].value;
    };
    index = index + 1;
  };
  let mut turns = 0u64;
  while (turns < 4) {
    tick_turn_end(&mut state, 1);
    turns = turns + 1;
  };
  let mut after_four = 0;
  index = 0;
  while (index < state.fighters[1].effects.length()) {
    if (state.fighters[1].effects[index].kind == K_ADD) after_four = after_four + 1;
    index = index + 1;
  };
  tick_turn_end(&mut state, 1);
  let mut after_five = 0;
  index = 0;
  while (index < state.fighters[1].effects.length()) {
    if (state.fighters[1].effects[index].kind == K_ADD) after_five = after_five + 1;
    index = index + 1;
  };
  let answer = vector[gains, gain_value, state.fighters[1].hp, after_four, after_five];
  destroy(state);
  answer
}

#[test_only]
public fun swap_filter_for_testing(): bool {
  let board = combat_grid::generate(1, 0);
  let caster_cell = combat_grid::encode(5, 5);
  let ally_cell = caster_cell + 1;
  let enemy_cell = caster_cell + 2;
  let mut enemy = mob_for_testing(1, enemy_cell, 6, 3);
  enemy.effects.push_back(ActiveEffect {
    kind: K_INVIS, element: b"".to_string(), value: 0, turns_left: 2, source: 2, stat: 0,
  });
  let fighters = vector[
    fighter_for_testing(0, caster_cell, 6, 3),
    fighter_for_testing(0, ally_cell, 6, 3),
    enemy,
  ];
  let mut state = active_state_for_testing(board, fighters, 0);
  let row = spell_effect::new_effect(
    K_SWAP, b"".to_string(), 0, 0, spell_effect::shape_point(), 0, 1, 10_000, 0, 0,
  );
  let sheet = sheet_of(&state, 0);
  let mut entropy = 1;
  resolve_effects(
    &mut state, 0, &sheet, &vector[row], ally_cell, caster_cell, &mut entropy, 1,
  );
  resolve_effects(
    &mut state, 0, &sheet, &vector[row], enemy_cell, caster_cell, &mut entropy, 1,
  );
  let unchanged = state.fighters[0].cell == caster_cell
    && state.fighters[1].cell == ally_cell
    && state.fighters[2].cell == enemy_cell;
  destroy(state);
  unchanged
}

#[test_only]
public fun walk_into_pulled_body_for_testing(): vector<u64> {
  let board = gas_board_for_testing();
  let start = combat_grid::encode(0, 5);
  let step_1 = start + 1;
  let step_2 = start + 2;
  let fighters = vector[
    fighter_for_testing(0, start, 6, 3),
    fighter_for_testing(0, step_2 + 1, 0, 3),
    mob_for_testing(1, combat_grid::encode(10, 15), 0, 3),
  ];
  let mut state = active_state_for_testing(board, fighters, 0);
  state.zones = vector[BoardZone {
    owner_fighter: 2, trap: true, shape: spell_effect::shape_circle(), size: 2,
    anchor: step_1, turns_left: 0,
    effects: vector[spell_effect::new_effect(
      K_PULL, b"".to_string(), 1, 1, spell_effect::shape_point(), 0, 0, 10_000, 0, 0,
    )],
  }];
  walk_path(&mut state, 0, &vector[step_1, step_2]);
  let answer = vector[state.fighters[0].cell, state.fighters[1].cell];
  destroy(state);
  answer
}

#[test_only]
public fun ally_buff_for_testing(): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let player_cell = board.start_cells_a()[0];
  let caster_cell = board.start_cells_b()[0];
  let ally_cell = board.start_cells_b()[1];
  let buff = spell_effect::new_spell_level(
    2, 0, 40, false, false, false, false, 0, 0, 5, 0,
    vector[spell_effect::new_effect(
      K_ADD, b"".to_string(), 4, 10, spell_effect::shape_point(), 0, 3, 10_000, 2,
      STAT_RAW_DAMAGE,
    )],
    vector[],
  );
  let mut caster = mob_for_testing(1, caster_cell, 6, 3);
  caster.kind = FighterKind::Mob(MobSnapshot {
    mob_type: b"nifuwa".to_string(), level: 1,
    kit: vector[KitSpell { name: b"Nifuwoost".to_string(), ordinal: 1, level: buff }],
    xp: 0, loot: vector[],
  });
  let fighters = vector[
    fighter_for_testing(0, player_cell, 6, 3),
    caster,
    mob_for_testing(1, ally_cell, 6, 3),
  ];
  let mut state = active_state_for_testing(board, fighters, 1);
  state.turn_seed = 7;
  mob_turn(&mut state, 1);
  let answer = vector[state.fighters[0].effects.length(), state.fighters[2].effects.length()];
  destroy(state);
  answer
}

#[test_only]
public fun mob_multi_cast_for_testing(casts_per_turn: u8): vector<u64> {
  let board = combat_grid::generate(1, 0);
  let player_cell = board.start_cells_a()[0];
  let mob_cell = board.start_cells_b()[0];
  let attack = spell_effect::new_spell_level(
    4, 1, 40, false, false, false, false, casts_per_turn, 0, 0, 0,
    vector[spell_effect::new_effect(
      K_DAMAGE, b"earth".to_string(), 10, 10, spell_effect::shape_point(), 0, 1,
      10_000, 0, 0,
    )],
    vector[],
  );
  let mut mob = mob_for_testing(1, mob_cell, 8, 0);
  mob.kind = FighterKind::Mob(MobSnapshot {
    mob_type: b"repeat_bite".to_string(), level: 1,
    kit: vector[KitSpell { name: b"Repeat Bite".to_string(), ordinal: 1, level: attack }],
    xp: 0, loot: vector[],
  });
  let fighters = vector[fighter_for_testing(0, player_cell, 6, 3), mob];
  let mut state = active_state_for_testing(board, fighters, 1);
  state.turn_seed = 7;
  mob_turn(&mut state, 1);
  let answer = vector[
    state.fighters[1].ap, state.fighters[0].hp, state.turn_casts.length(),
  ];
  destroy(state);
  answer
}

#[test_only]
public fun three_mob_wave_gas_for_testing(): u64 {
  let board = gas_board_for_testing();
  let side_a = board.start_cells_a();
  let side_b = board.start_cells_b();
  let bolt = spell_effect::new_spell_level(
    3, 1, 8, false, true, false, false, 1, 1, 0, 0,
    vector[spell_effect::new_effect(
      K_DAMAGE, b"earth".to_string(), 1, 2, spell_effect::shape_circle(), 2, 0,
      10_000, 0, 0,
    )],
    vector[],
  );
  let mut caster = mob_for_testing(1, side_b[0], 6, 3);
  caster.kind = FighterKind::Mob(MobSnapshot {
    mob_type: b"gas_probe_caster".to_string(), level: 1,
    kit: vector[KitSpell { name: b"probe_bolt".to_string(), ordinal: 1, level: bolt }],
    xp: 0, loot: vector[],
  });
  let fighters = vector[
    fighter_for_testing(0, side_a[0], 6, 3),
    caster,
    mob_for_testing(1, side_b[1], 6, 3),
    mob_for_testing(1, side_b[2], 6, 3),
  ];
  let mut state = active_state_for_testing(board, fighters, 0);
  let mut turn_seeds = vector[1, 2, 3, 4];
  let _ = advance_to_player(&mut state, &mut turn_seeds, 0, false);
  assert!(!state.ended, 0);
  assert!(!state.fighters[0].dead, 1);
  let rounds = state.round;
  destroy(state);
  rounds
}

#[test_only]
public fun white_ant_turn_gas_for_testing(): vector<u64> {
  let board = gas_board_for_testing();
  let colony_link = spell_effect::new_spell_level(
    2, 0, 0, false, false, false, false, 1, 0, 4, 0,
    vector[
      spell_effect::new_effect(
        K_ADD, b"".to_string(), 1, 1, spell_effect::shape_allmap(), 0, 3, 10_000, 2, STAT_MP,
      ),
      spell_effect::new_effect(
        K_REDIRECT, b"".to_string(), 0, 0, spell_effect::shape_allmap(), 0, 3, 10_000, 1, 0,
      ),
    ],
    vector[],
  );
  let mandibles = spell_effect::new_spell_level(
    4, 1, 2, false, true, false, false, 0, 0, 0, 0,
    vector[
      spell_effect::new_effect(
        K_DAMAGE, b"air".to_string(), 18, 23, spell_effect::shape_point(), 0, 1, 10_000, 0, 0,
      ),
      spell_effect::new_effect(
        K_REMOVE, b"air".to_string(), 1, 1, spell_effect::shape_point(), 0, 1, 10_000, 2, STAT_HP,
      ),
    ],
    vector[],
  );
  let mut ant = fighter_for_testing(1, combat_grid::encode(0, 6), 6, 6);
  ant.kind = FighterKind::Mob(MobSnapshot {
    mob_type: b"ant_white".to_string(),
    level: 8,
    kit: vector[
      KitSpell { name: b"Colony Link".to_string(), ordinal: 1, level: colony_link },
      KitSpell { name: b"Rime Mandibles".to_string(), ordinal: 2, level: mandibles },
    ],
    xp: 1674,
    loot: vector[],
  });
  ant.stats.sheet.agility = 27;
  ant.stats.sheet.wisdom = 11;
  ant.stats.sheet.level = 8;
  ant.stats.max_hp = 80;
  ant.hp = 80;
  let fighters = vector[
    fighter_for_testing(0, combat_grid::encode(0, 5), 6, 3),
    fighter_for_testing(0, combat_grid::encode(1, 5), 6, 3),
    fighter_for_testing(0, combat_grid::encode(2, 5), 6, 3),
    fighter_for_testing(0, combat_grid::encode(3, 5), 6, 3),
    fighter_for_testing(0, combat_grid::encode(4, 5), 6, 3),
    ant,
    fighter_for_testing(1, combat_grid::encode(1, 6), 6, 3),
    fighter_for_testing(1, combat_grid::encode(2, 6), 6, 3),
    fighter_for_testing(1, combat_grid::encode(3, 6), 6, 3),
  ];
  let mut state = new_state(board, fighters, 0);
  state.queue = vector[0, 5, 1, 6, 2, 7, 3, 8, 4];
  state.turn_pointer = 1;
  state.round = 1;
  state.turn_seed = 1;
  mob_turn(&mut state, 5);
  let mut active_effects = 0;
  let mut fighter = 5;
  while (fighter < 9) {
    active_effects = active_effects + state.fighters[fighter].effects.length();
    fighter = fighter + 1;
  };
  let result = vector[state.fighters[5].ap, state.turn_casts.length(), active_effects];
  destroy(state);
  result
}

#[test_only]
public fun crowani_turn_gas_for_testing(): vector<u64> {
  let board = gas_board_for_testing();
  let war_cry = spell_effect::new_spell_level(
    3, 0, 3, false, true, false, false, 1, 0, 4, 0,
    vector[
      spell_effect::new_effect(
        K_ADD, b"".to_string(), 1, 1, spell_effect::shape_circle(), 2, 3, 10_000, 2, STAT_MP,
      ),
      spell_effect::new_effect(
        K_ADD, b"".to_string(), 3, 3, spell_effect::shape_circle(), 2, 3, 10_000, 2,
        STAT_CRITICAL,
      ),
    ],
    vector[],
  );
  let cleaver = spell_effect::new_spell_level(
    4, 1, 3, false, true, false, false, 1, 0, 0, 0,
    vector[spell_effect::new_effect(
      K_DAMAGE, b"air".to_string(), 22, 32, spell_effect::shape_cross(), 2, 1, 10_000, 0, 0,
    )],
    vector[],
  );
  let mut crowani = fighter_for_testing(1, combat_grid::encode(0, 6), 8, 4);
  crowani.kind = FighterKind::Mob(MobSnapshot {
    mob_type: b"cro_wani__white".to_string(),
    level: 11,
    kit: vector[
      KitSpell { name: b"Albino War Cry".to_string(), ordinal: 1, level: war_cry },
      KitSpell { name: b"Gale Cleaver".to_string(), ordinal: 1, level: cleaver },
    ],
    xp: 3067,
    loot: vector[],
  });
  crowani.stats.sheet.agility = 23;
  crowani.stats.sheet.wisdom = 14;
  crowani.stats.sheet.level = 11;
  let fighters = vector[
    fighter_for_testing(0, combat_grid::encode(0, 5), 6, 3),
    fighter_for_testing(0, combat_grid::encode(1, 5), 6, 3),
    fighter_for_testing(0, combat_grid::encode(2, 5), 6, 3),
    fighter_for_testing(0, combat_grid::encode(3, 5), 6, 3),
    fighter_for_testing(0, combat_grid::encode(4, 5), 6, 3),
    crowani,
    fighter_for_testing(1, combat_grid::encode(1, 6), 8, 4),
    fighter_for_testing(1, combat_grid::encode(2, 6), 8, 4),
    fighter_for_testing(1, combat_grid::encode(3, 6), 8, 4),
    fighter_for_testing(1, combat_grid::encode(4, 6), 8, 4),
  ];
  let mut state = new_state(board, fighters, 0);
  state.queue = vector[0, 5, 1, 6, 2, 7, 3, 8, 4, 9];
  state.turn_pointer = 1;
  state.round = 1;
  state.turn_seed = 1;
  mob_turn(&mut state, 5);
  let mut allied_effects = 0;
  let mut fighter = 5;
  while (fighter < 10) {
    allied_effects = allied_effects + state.fighters[fighter].effects.length();
    fighter = fighter + 1;
  };
  let result = vector[
    state.fighters[5].ap,
    state.turn_casts.length(),
    allied_effects,
    state.fighters[0].hp,
  ];
  destroy(state);
  result
}

#[test_only]
fun gas_board_for_testing(): GridSpec {
  combat_grid::grid_spec(
    20,
    19,
    vector[
      0xFFFFFFFFFFFFFFFF,
      0xFFFFFFFFFFFFFFFF,
      0xFFFFFFFFFFFFFFFF,
      0xFFFFFFFFFFFFFFFF,
      0xFFFFFFFFFFFFFFFF,
      0x0FFFFFFFFFFFFFFF,
    ],
    vector[],
    vector[],
    vector[21, 22, 23, 24, 25, 26],
    vector[341, 342, 343, 344, 345, 346],
  )
}

fun is_mob(fighter: &Fighter): bool {
  match (&fighter.kind) { FighterKind::Player => false, FighterKind::Mob(_) => true }
}

fun mob_snapshot(fighter: &Fighter): &MobSnapshot {
  match (&fighter.kind) { FighterKind::Player => abort ENotAMob, FighterKind::Mob(snapshot) => snapshot }
}

fun fighter_at(state: &State, cell: u64): Option<u64> {
  let mut fighter = 0;
  while (fighter < state.fighters.length()) {
    let row = &state.fighters[fighter];
    if (!row.dead && row.cell == cell) return option::some(fighter);
    fighter = fighter + 1;
  };
  option::none()
}
