// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Bounded single-elimination competition. Fight owns combat and custody; this object owns
/// consenting rosters, the bracket, deadlines and prizes. No wager or platform fee applies.
module aresrpg::tournament;

use aresrpg::{character::Character, fight::{Self, Fight}, item::{Self, Item, PM}, version::Version};
use aresrpg_control::admin::AdminCap;
use aresrpg_math::tournament_bracket::{Self as bracket, Match};
use aresrpg_rewards::{economy::{Self, Economy}, tournament_rewards::{Self as funds, Funds}};
use aresrpg_seed::item_rows::{Self, ItemTemplate};
use std::string::String;
use sui::{balance::{Self, Balance}, clock::Clock, coin::Coin, event, kiosk::{Kiosk, KioskOwnerCap},
  random::RandomGenerator, sui::SUI, transfer_policy::TransferPolicy};

const ESettings: u64 = 3201;
const EPhase: u64 = 3202;
const ESeat: u64 = 3203;
const EMatch: u64 = 3204;
const ETooEarly: u64 = 3205;
const EClaim: u64 = 3206;
const MATCH_MS: u64 = 1_800_000;

public struct Tournament has key {
  id: UID,
  name: String,
  status: String,
  organizer: address,
  format: u64,
  start_before_ms: u64,
  sui_bps: vector<u64>,
  token_bps: vector<u64>,
  rewards: vector<Reward>,
  sui: Balance<SUI>,
  sui_total: u64,
  kares_pool: Option<ID>,
  teams: vector<Team>,
  matches: vector<Match>,
  fights: vector<Option<ID>>,
}

public struct Reward has copy, drop, store { place: u8, template: ID, amount: u32 }
public struct Seat has copy, drop, store {
  character: ID, owner: address, sui_claimed: bool, items_claimed: u64,
}
public struct Team has copy, drop, store {
  name: String, revision: u64, allowed: vector<ID>, seats: vector<Seat>, place: u8,
}
public struct TournamentUpdated has copy, drop { tournament: ID }

public(package) fun reward(template: &ItemTemplate, place: u8, amount: u32): Reward {
  assert!(place >= 1 && place <= 5 && amount > 0 && amount <= 10, ESettings);
  // Non-stackable rewards are one copy per seat; stackable rewards may contain ten units.
  assert!(amount == 1 || aresrpg_math::content_rules::is_stackable(&item_rows::template_category(template)), ESettings);
  Reward { place, template: item_rows::template_id(template), amount }
}

/// Build typed prize settings inside Move, including an empty list, without guessing type origins.
public fun rewards(): vector<Reward> { vector[] }
public fun add_reward(mut rewards: vector<Reward>, template: &ItemTemplate, place: u8, amount: u32): vector<Reward> {
  rewards.push_back(reward(template, place, amount)); rewards
}

public fun create(
  admin: &AdminCap, name: String, format: u64, start_before_ms: u64,
  sui_bps: vector<u64>, token_bps: vector<u64>, rewards: vector<Reward>,
  version: &Version, clock: &Clock, ctx: &mut TxContext,
) {
  version.assert_latest();
  admin.verify(ctx);
  let tournament = new(name, format, start_before_ms, sui_bps, token_bps, rewards, clock, ctx);
  changed(&tournament);
  transfer::share_object(tournament);
}

fun new(name: String, format: u64, start_before_ms: u64, sui_bps: vector<u64>,
  token_bps: vector<u64>, rewards: vector<Reward>, clock: &Clock, ctx: &mut TxContext): Tournament {
  assert!(format == 1 || format == 3 || format == 6, ESettings);
  assert!(name.length() > 0 && name.length() <= 80 && rewards.length() <= 10, ESettings);
  assert!(start_before_ms > clock.timestamp_ms(), ESettings);
  bracket::validate_bps(&sui_bps);
  bracket::validate_bps(&token_bps);
  Tournament { id: object::new(ctx), name, status: b"open".to_string(), organizer: ctx.sender(),
    format, start_before_ms, sui_bps, token_bps, rewards, sui: balance::zero(),
    sui_total: 0, kares_pool: option::none(), teams: vector[], matches: bracket::empty(), fights: vector[] }
}


public fun donate_sui(t: &mut Tournament, payment: Coin<SUI>, version: &Version, clock: &Clock) {
  version.assert_latest(); open(t, clock); t.sui.join(payment.into_balance()); changed(t);
}

/// This object exists only after a valid KARES contribution; SUI tournaments need no token binding.
public struct KaresPool<phantom Token> has key { id: UID, funds: Funds<Token> }

public fun create_kares_pool<Token>(t: &mut Tournament, economy: &Economy, payment: Coin<Token>,
  version: &Version, clock: &Clock, ctx: &mut TxContext) {
  version.assert_latest(); open(t, clock);
  economy::assert_token<Token>(economy);
  assert!(t.kares_pool.is_none(), ESettings);
  let pool = KaresPool { id: object::new(ctx), funds: funds::new(payment) };
  t.kares_pool = option::some(object::id(&pool));
  transfer::share_object(pool);
  changed(t);
}

public fun donate_kares<Token>(t: &Tournament, pool: &mut KaresPool<Token>, payment: Coin<Token>,
  version: &Version, clock: &Clock) {
  version.assert_latest(); open(t, clock); assert_pool(t, pool);
  funds::deposit(&mut pool.funds, payment); changed(t);
}

fun assert_pool<Token>(t: &Tournament, pool: &KaresPool<Token>) {
  assert!(t.kares_pool == option::some(object::id(pool)), EClaim);
}

/// The SDK composes this after cancellation/expiry and before claims. Anyone may recover it.
public fun refund_kares<Token>(t: &Tournament, pool: &mut KaresPool<Token>, version: &Version, ctx: &mut TxContext) {
  version.assert_latest(); assert_pool(t, pool);
  assert!(t.status == b"cancelled".to_string() || t.status == b"finished".to_string(), EPhase);
  let total = funds::total(&pool.funds);
  let amount = if (t.status == b"cancelled".to_string()) total else unawarded(t, &t.token_bps, total);
  funds::refund(&mut pool.funds, amount, t.organizer, ctx); changed(t);
}

public fun claim_kares<Token>(t: &Tournament, pool: &mut KaresPool<Token>, team: u64, seat: u64,
  version: &Version, ctx: &mut TxContext) {
  assert!(t.status == b"finished".to_string(), EPhase);
  refund_kares(t, pool, version, ctx);
  let place = t.teams[team].place;
  assert!(place > 0, EClaim);
  let (count, preceding) = placement_seats(t, place, team);
  let amount = share(portion(funds::total(&pool.funds), t.token_bps[(place - 1) as u64]), count, preceding + seat);
  let member = &t.teams[team].seats[seat];
  funds::claim(&mut pool.funds, member.character, member.owner, amount, ctx); changed(t);
}

/// Empty allowed means open admission. The creator registers their own first seat atomically.
public(package) fun create_team(t: &mut Tournament, name: String, allowed: vector<ID>,
  character: &Character, clock: &Clock, ctx: &TxContext) {
  open(t, clock);
  assert!(name.length() > 0 && name.length() <= 40 && allowed.length() <= t.format, ESettings);
  let mut team = 0;
  while (team < t.teams.length() && !t.teams[team].seats.is_empty()) team = team + 1;
  let revision = if (team < t.teams.length()) t.teams[team].revision + 1 else 0;
  let roster = Team { name, revision, allowed, seats: vector[], place: 0 };
  if (team < t.teams.length()) *t.teams.borrow_mut(team) = roster
  else { assert!(team < bracket::max_teams(), ESettings); t.teams.push_back(roster); };
  join_team(t, team, revision, character, clock, ctx);
}

public(package) fun join_team(t: &mut Tournament, team: u64, revision: u64, character: &Character,
  clock: &Clock, ctx: &TxContext) {
  open(t, clock);
  let id = object::id(character);
  let owner = ctx.sender();
  let mut i = 0;
  while (i < t.teams.length()) {
    let mut j = 0;
    while (j < t.teams[i].seats.length()) {
      let seat = &t.teams[i].seats[j];
      assert!(seat.character != id && (i == team || seat.owner != owner), ESeat);
      j = j + 1;
    };
    i = i + 1;
  };
  let roster = &mut t.teams[team];
  assert!(roster.revision == revision && roster.seats.length() < t.format, ESeat);
  assert!(roster.allowed.is_empty() || roster.allowed.contains(&id), ESeat);
  roster.seats.push_back(Seat { character: id, owner, sui_claimed: false, items_claimed: 0 });
  changed(t);
}

public fun leave_team(t: &mut Tournament, team: u64, character: ID,
  version: &Version, clock: &Clock, ctx: &TxContext) {
  version.assert_latest(); open(t, clock);
  let seats = &mut t.teams[team].seats;
  let mut seat = 0;
  while (seat < seats.length() && seats[seat].character != character) seat = seat + 1;
  assert!(seats[seat].owner == ctx.sender(), ESeat);
  seats.remove(seat);
  changed(t);
}

public(package) fun start(t: &mut Tournament, admin: &AdminCap,
  generator: &mut RandomGenerator, clock: &Clock, ctx: &TxContext) {
  admin.verify(ctx);
  open(t, clock);
  let mut entrants = vector[];
  let mut i = 0;
  while (i < t.teams.length()) {
    if (t.teams[i].seats.length() == t.format) entrants.push_back(i);
    i = i + 1;
  };
  let n = entrants.length();
  assert!(n >= bracket::minimum_teams(&t.sui_bps, &t.token_bps, t.rewards.map_ref!(|reward| reward.place)), ESettings);
  // Fixed-work Fisher-Yates: gas usage does not depend on which teams receive byes.
  i = n;
  while (i > 1) { i = i - 1; let j = generator.generate_u64_in_range(0, i); entrants.swap(i, j); };
  t.matches = bracket::new(entrants, clock.timestamp_ms());
  i = 0;
  while (i < t.matches.length()) { t.fights.push_back(option::none()); i = i + 1; };
  t.sui_total = t.sui.value();
  t.status = b"in_progress".to_string();
  changed(t);
}


public(package) fun admission(t: &Tournament, index: u64, character: ID, owner: address,
  clock: &Clock): (u8, u64) {
  running(t);
  let m = &t.matches[index];
  assert!(bracket::state(m) == 1 && clock.timestamp_ms() < bracket::available_ms(m) + fight::placement_duration_ms(), EMatch);
  let mut side = 0u8;
  while (side < 2) {
    let team = bracket::team(m, side);
    let mut i = 0;
    while (i < t.teams[team].seats.length()) {
      let seat = &t.teams[team].seats[i];
      if (seat.character == character && seat.owner == owner) return (side, bracket::available_ms(m));
      i = i + 1;
    };
    side = side + 1;
  };
  abort ESeat
}

public(package) fun link_fight(t: &mut Tournament, index: u64, fight: ID) {
  assert!(t.fights[index].is_none(), EMatch);
  *t.fights.borrow_mut(index) = option::some(fight);
  changed(t);
}

public(package) fun assert_fight(t: &Tournament, index: u64, f: &Fight) {
  assert!(t.fights[index] == option::some(object::id(f)), EMatch);
  fight::assert_tournament_controlled(f);
}

public(package) fun ready(t: &Tournament, index: u64, f: &mut Fight, seats: vector<u64>,
  generator: &mut RandomGenerator, clock: &Clock, ctx: &TxContext) {
  running(t); assert_fight(t, index, f);
  assert!(bracket::state(&t.matches[index]) == 1 && clock.timestamp_ms() < bracket::available_ms(&t.matches[index]) + MATCH_MS, EMatch);
  assert!(!seats.is_empty() && seats.length() <= t.format, ESeat);
  let mut all_ready = false;
  let mut i = 0;
  while (i < seats.length()) { all_ready = fight::ready(f, seats[i], ctx); i = i + 1; };
  if (all_ready && fight::side_players(f, 0) == t.format && fight::side_players(f, 1) == t.format)
    fight::start(f, generator, clock);
}

public(package) fun crank(t: &mut Tournament, index: u64, f: &mut Fight,
  generator: &mut RandomGenerator, clock: &Clock, ctx: &mut TxContext) {
  assert_fight(t, index, f);
  if (bracket::state(&t.matches[index]) == 2) return;
  running(t);
  let m = &t.matches[index];
  if (!fight::ended(f)) {
    if (clock.timestamp_ms() >= bracket::available_ms(m) + MATCH_MS) fight::end_tournament(f, option::none())
    else {
      assert!(clock.timestamp_ms() >= bracket::available_ms(m) + fight::placement_duration_ms(), ETooEarly);
      let (a, b) = (fight::side_players(f, 0), fight::side_players(f, 1));
      if (a > 0 && b > 0) { fight::start(f, generator, clock); return }
      else fight::end_tournament(f, option::some(if (a > 0) 0 else 1));
    };
  };
  record(t, index, f, clock, ctx);
}

/// First settlement records the result atomically; later settlement and crank calls are idempotent.
public(package) fun record(t: &mut Tournament, index: u64, f: &Fight, clock: &Clock, ctx: &mut TxContext) {
  assert_fight(t, index, f);
  if (bracket::state(&t.matches[index]) == 2) return;
  running(t); assert!(fight::ended(f), EMatch);
  resolve(t, index, fight::winner(f), fight::tournament_was_played(f), clock, ctx);
}

public fun crank_unopened(t: &mut Tournament, index: u64, version: &Version,
  clock: &Clock, ctx: &mut TxContext) {
  version.assert_latest(); running(t);
  let m = &t.matches[index];
  assert!(bracket::state(m) == 1 && t.fights[index].is_none(), EMatch);
  assert!(clock.timestamp_ms() >= bracket::available_ms(m) + fight::placement_duration_ms(), ETooEarly);
  resolve(t, index, option::none(), false, clock, ctx);
}

fun resolve(t: &mut Tournament, index: u64, side: Option<u8>, played: bool, clock: &Clock, ctx: &mut TxContext) {
  bracket::resolve(&mut t.matches, index, side, played, clock.timestamp_ms());
  if (bracket::done(&t.matches)) finish(t, ctx);
  changed(t);
}

fun finish(t: &mut Tournament, ctx: &mut TxContext) {
  let mut team = 0;
  while (team < t.teams.length()) {
    t.teams[team].place = bracket::placement(&t.matches, team);
    team = team + 1;
  };
  t.status = b"finished".to_string();
  let remaining = unawarded(t, &t.sui_bps, t.sui_total);
  pay(&mut t.sui, remaining, t.organizer, ctx);
}

fun unawarded(t: &Tournament, bps: &vector<u64>, total: u64): u64 {
  let mut allocated = 0;
  let mut place = 1u8;
  while (place <= 5) {
    let (count, _) = placement_seats(t, place, 0);
    if (count > 0) allocated = allocated + portion(total, bps[(place - 1) as u64]);
    place = place + 1;
  };
  total - allocated
}

fun portion(total: u64, bps: u64): u64 { ((total as u128) * (bps as u128) / 10_000) as u64 }

/// Total seats at a placement and the seats preceding this team. Rosters are frozen at start.
fun placement_seats(t: &Tournament, place: u8, team: u64): (u64, u64) {
  let (mut count, mut preceding) = (0, 0);
  let mut i = 0;
  while (i < t.teams.length()) {
    if (t.teams[i].place == place) {
      count = count + t.teams[i].seats.length();
      if (i < team) preceding = count;
    };
    i = i + 1;
  };
  (count, preceding)
}

fun share(amount: u64, count: u64, ordinal: u64): u64 {
  amount / count + if (ordinal < amount % count) 1 else 0
}

public fun claim_sui(t: &mut Tournament, team: u64, seat: u64,
  version: &Version, ctx: &mut TxContext) {
  version.assert_latest(); assert!(t.status == b"finished".to_string(), EPhase);
  let place = t.teams[team].place;
  assert!(place > 0, EClaim);
  let (count, preceding) = placement_seats(t, place, team);
  let sui = share(portion(t.sui_total, t.sui_bps[(place - 1) as u64]), count, preceding + seat);
  let member = &mut t.teams[team].seats[seat];
  assert!(!member.sui_claimed, EClaim);
  member.sui_claimed = true;
  let owner = member.owner;
  pay(&mut t.sui, sui, owner, ctx); changed(t);
}

public(package) fun claim_item(t: &mut Tournament, team: u64, seat: u64, reward: u64,
  plan: PM, kiosk: &mut Kiosk, cap: &KioskOwnerCap, policy: &TransferPolicy<Item>,
  generator: &mut RandomGenerator, ctx: &mut TxContext) {
  assert!(t.status == b"finished".to_string(), EPhase);
  let prize = t.rewards[reward];
  let roster = &mut t.teams[team];
  assert!(roster.place == prize.place, EClaim);
  let member = &mut roster.seats[seat];
  assert!(member.owner == ctx.sender() && member.items_claimed & (1 << (reward as u8)) == 0, EClaim);
  member.items_claimed = member.items_claimed | (1 << (reward as u8));
  item::deliver_claim(plan, prize.template, prize.amount, kiosk, cap, policy, generator, ctx);
  changed(t);
}

public fun cancel(t: &mut Tournament, admin: &AdminCap, version: &Version, ctx: &mut TxContext) {
  version.assert_latest(); admin.verify(ctx); cancel_open(t, ctx);
}

public fun expire(t: &mut Tournament, version: &Version, clock: &Clock, ctx: &mut TxContext) {
  version.assert_latest(); assert!(clock.timestamp_ms() >= t.start_before_ms, ETooEarly); cancel_open(t, ctx);
}

fun cancel_open(t: &mut Tournament, ctx: &mut TxContext) {
  assert!(t.status == b"open".to_string(), EPhase);
  t.status = b"cancelled".to_string();
  let sui = t.sui.value();
  pay(&mut t.sui, sui, t.organizer, ctx); changed(t);
}

fun pay(balance: &mut Balance<SUI>, amount: u64, recipient: address, ctx: &mut TxContext) {
  if (amount > 0) transfer::public_transfer(balance.split(amount).into_coin(ctx), recipient);
}

public(package) fun assert_recorded(t: &Tournament, index: u64, f: &Fight) {
  assert_fight(t, index, f); assert!(bracket::state(&t.matches[index]) == 2, EMatch);
}

fun open(t: &Tournament, clock: &Clock) {
  assert!(t.status == b"open".to_string() && clock.timestamp_ms() < t.start_before_ms, EPhase);
}
fun running(t: &Tournament) { assert!(t.status == b"in_progress".to_string(), EPhase); }
fun changed(t: &Tournament) { event::emit(TournamentUpdated { tournament: object::id(t) }); }

#[test_only]
public(package) fun matches_for_testing(t: &Tournament): vector<Match> { t.matches }
#[test_only]
public(package) fun status_for_testing(t: &Tournament): String { t.status }
#[test_only]
public(package) fun place_for_testing(t: &Tournament, team: u64): u8 { t.teams[team].place }
#[test_only]
public(package) fun sui_balance_for_testing(t: &Tournament): u64 { t.sui.value() }
#[test_only]
public(package) fun resolve_for_testing(t: &mut Tournament, index: u64, side: Option<u8>,
  played: bool, clock: &Clock, ctx: &mut TxContext) { resolve(t, index, side, played, clock, ctx) }
#[test_only]
public(package) fun destroy_for_testing(t: Tournament) {
  let Tournament { id, sui, .. } = t;
  sui.destroy_zero(); id.delete();
}

#[test_only]
public(package) fun destroy_pool_for_testing<Token>(pool: KaresPool<Token>) {
  let KaresPool { id, funds } = pool; funds::destroy_for_testing(funds); id.delete();
}
#[test_only]
public(package) fun pool_balance_for_testing<Token>(pool: &KaresPool<Token>): u64 { funds::balance(&pool.funds) }
