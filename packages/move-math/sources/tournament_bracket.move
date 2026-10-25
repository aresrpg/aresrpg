// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Pure bounded knockout bracket. Core supplies authenticated results and chain time.
module aresrpg_math::tournament_bracket;

const EBracket: u64 = 3301;
const EResolved: u64 = 3302;
const ESettings: u64 = 3303;
const MAX_TEAMS: u64 = 64;

/// Heap order; children of i are 2i+1 and 2i+2. The optional last entry is bronze.
/// State 0 waits for inputs, 1 is available, 2 is resolved. Missing inputs propagate as byes.
public struct Match has copy, drop, store {
  a: Option<u64>, b: Option<u64>, available_ms: u64,
  state: u8, winner: Option<u64>, loser: Option<u64>,
}

public fun max_teams(): u64 { MAX_TEAMS }
public fun empty(): vector<Match> { vector[] }

/// Entrants are already shuffled by the core's terminal Random boundary.
public fun new(entrants: vector<u64>, now: u64): vector<Match> {
  let n = entrants.length();
  assert!(n >= 2 && n <= MAX_TEAMS && now > 0, EBracket);
  let mut size = 2;
  while (size < n) size = size * 2;
  let mut matches = vector[];
  let mut i = 0;
  while (i < size - 1) { matches.push_back(empty_match()); i = i + 1; };
  if (size >= 4) matches.push_back(empty_match());
  i = 0;
  while (i < size / 2) {
    let m = &mut matches[size / 2 - 1 + i];
    m.a = option::some(entrants[i]);
    if (i + size / 2 < n) m.b = option::some(entrants[i + size / 2]);
    i = i + 1;
  };
  advance(&mut matches, now);
  matches
}

fun empty_match(): Match {
  Match { a: option::none(), b: option::none(), available_ms: 0, state: 0,
    winner: option::none(), loser: option::none() }
}

fun tree_count(matches: &vector<Match>): u64 {
  if (matches.length() == 1) 1 else matches.length() - 1
}

fun advance(matches: &mut vector<Match>, now: u64) {
  let count = tree_count(matches);
  let mut i = count;
  while (i > 0) {
    i = i - 1;
    if (matches[i].state != 0) continue;
    if (2 * i + 1 < count) {
      let left = &matches[2 * i + 1];
      let right = &matches[2 * i + 2];
      if (left.state != 2 || right.state != 2) continue;
      let (a, b) = (left.winner, right.winner);
      matches[i].a = a; matches[i].b = b;
    };
    activate(&mut matches[i], now);
  };
  if (count > 1 && matches[count].state == 0 && matches[1].state == 2 && matches[2].state == 2) {
    let (a, b) = (matches[1].loser, matches[2].loser);
    matches[count].a = a; matches[count].b = b;
    activate(&mut matches[count], now);
  };
}

fun activate(m: &mut Match, now: u64) {
  m.available_ms = now;
  m.state = 1;
  if (m.a.is_none() || m.b.is_none()) {
    m.winner = if (m.a.is_some()) m.a else m.b;
    m.state = 2;
  };
}

public fun resolve(matches: &mut vector<Match>, index: u64, side: Option<u8>, played: bool, now: u64) {
  let m = &mut matches[index];
  assert!(m.state == 1, EResolved);
  m.state = 2;
  if (side.is_some()) {
    let side = side.destroy_some();
    assert!(side <= 1, EBracket);
    m.winner = if (side == 0) m.a else m.b;
    // Absent teams and expired fights never earn consolation places.
    if (played) m.loser = if (side == 0) m.b else m.a;
  };
  advance(matches, now);
}

public fun done(matches: &vector<Match>): bool {
  let count = tree_count(matches);
  matches[0].state == 2 && (count == 1 || matches[count].state == 2)
}

public fun placement(matches: &vector<Match>, team: u64): u8 {
  assert!(done(matches), EResolved);
  let team = option::some(team);
  if (matches[0].winner == team) return 1;
  if (matches[0].loser == team) return 2;
  let count = tree_count(matches);
  if (count > 1) {
    if (matches[count].winner == team) return 3;
    if (matches[count].loser == team) return 4;
  };
  if (count >= 7) {
    let mut i = 3;
    while (i < 7) { if (matches[i].loser == team) return 5; i = i + 1; };
  };
  0
}

public fun state(m: &Match): u8 { m.state }
public fun available_ms(m: &Match): u64 { m.available_ms }
public fun team(m: &Match, side: u8): u64 {
  assert!(side <= 1, EBracket);
  if (side == 0) m.a.destroy_some() else m.b.destroy_some()
}
public fun winner(m: &Match): Option<u64> { m.winner }
public fun loser(m: &Match): Option<u64> { m.loser }

public fun validate_bps(bps: &vector<u64>) {
  assert!(bps.length() == 5, ESettings);
  let mut total = 0u64;
  let mut i = 0;
  while (i < 5) { assert!(bps[i] <= 10_000, ESettings); total = total + bps[i]; i = i + 1; };
  assert!(total == 10_000, ESettings);
}


public fun minimum_teams(sui_bps: &vector<u64>, token_bps: &vector<u64>, reward_places: vector<u8>): u64 {
  let mut place = 1;
  let mut i = 0;
  while (i < 5) {
    if (sui_bps[i] > 0 || token_bps[i] > 0) place = i + 1;
    i = i + 1;
  };
  i = 0;
  while (i < reward_places.length()) { place = std::u64::max(place, reward_places[i] as u64); i = i + 1; };
  if (place >= 5) 8 else if (place >= 3) 4 else 2
}
