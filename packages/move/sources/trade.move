// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// TRADE — the p2p escrow that REPLACES transferred PurchaseCaps (owner 2026-08-12: a cap
/// sent to a ghost locks the item forever; a cap parked HERE is withdrawable until the lock).
/// One shared object pinned to two addresses. Each side parks 0-price PurchaseCaps (the items
/// stay exclusively listed in their OWNER'S kiosk) and optional SUI. Every mutation bumps
/// `version` and clears both accepts; `accept` names the version it saw — a stale accept
/// aborts, so nobody ever locks on a state they did not read. Both accepts at the same
/// version LOCK the trade: from that instant nothing moves except each side CLAIMING the
/// other side's caps and SUI — claims never expire, so asymmetric execution cannot rug.
/// The public claim door consumes the cap into an asset + TransferRequest; the SDK must then
/// pay the royalty floor and relock, exactly the public-market path.
module aresrpg::trade;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::dynamic_object_field as dof;
use sui::kiosk::{Self, Kiosk, PurchaseCap};
use sui::sui::SUI;
use sui::transfer_policy::TransferRequest;

const ENotAParty: u64 = 2601; // every door: the caller is neither side of this trade
const ELocked: u64 = 2602; // deposits/withdrawals/accepts after the lock
const ENotLocked: u64 = 2603; // claims before the lock
const EPricedCap: u64 = 2604; // deposit: a cap with min_price > 0 is a hidden price tag
const ECapNotFound: u64 = 2605; // withdraw/claim: the id is not in that side's manifest
const EStaleAccept: u64 = 2606; // accept: the trade changed since the caller read it
const ENotDrained: u64 = 2607; // destroy: caps or SUI remain
const ECapLimit: u64 = 2608; // deposit: one side already carries the maximum twenty assets

const MAX_CAPS_PER_SIDE: u64 = 20;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The escrow. Caps live as dynamic object fields keyed by their item id; the manifests
/// mirror them so both players (and the projection) always see exactly what a lock buys.
public struct Trade has key {
  id: UID,
  a: address,
  b: address,
  /// bumped by EVERY mutation; accepts are only valid against the current value
  version: u64,
  accept_a: bool,
  accept_b: bool,
  /// both accepts at one version — terminal: only claims (and the drained destroy) remain
  locked: bool,
  sui_a: Balance<SUI>,
  sui_b: Balance<SUI>,
  /// item ids of the caps each side parked (the cap itself sits under its item ID)
  caps_a: vector<ID>,
  caps_b: vector<ID>,
}

// ╔════════════════ [ Doors ] ════════════════════════════════════════════════ ]

/// A trade is born pinned to its two players — nobody else can ever touch it.
public(package) fun create(counterparty: address, ctx: &mut TxContext) {
  let trade = Trade {
    id: object::new(ctx),
    a: ctx.sender(),
    b: counterparty,
    version: 0,
    accept_a: false,
    accept_b: false,
    locked: false,
    sui_a: balance::zero(),
    sui_b: balance::zero(),
    caps_a: vector[],
    caps_b: vector[],
  };
  transfer::share_object(trade);
}

/// Park a cap on the caller's side. 0-price only: trades are barter + escrowed SUI — a
/// priced cap would make a "free" claim cost money the counterparty never agreed to see.
public(package) fun pc<T: key + store>(
  trade: &mut Trade,
  cap: PurchaseCap<T>,
  ctx: &TxContext,
) {
  assert!(!trade.locked, ELocked);
  assert!(kiosk::purchase_cap_min_price(&cap) == 0, EPricedCap);
  let item = kiosk::purchase_cap_item(&cap);
  {
    let manifest = mm(trade, ctx);
    assert!(manifest.length() < MAX_CAPS_PER_SIDE, ECapLimit);
    manifest.push_back(item);
  };
  dof::add(&mut trade.id, item, cap);
  t1(trade);
}

/// Take the caller's parked cap back before lock. The SDK returns it to its source kiosk in
/// the same PTB; unlike a claim, raw misuse can strand only the caller's own asset.
public(package) fun tc<T: key + store>(
  trade: &mut Trade,
  item: ID,
  ctx: &TxContext,
): PurchaseCap<T> {
  assert!(!trade.locked, ELocked);
  rf(mm(trade, ctx), item);
  t1(trade);
  dof::remove(&mut trade.id, item)
}

public(package) fun ps(trade: &mut Trade, coin: Coin<SUI>, ctx: &TxContext) {
  assert!(!trade.locked, ELocked);
  mb1(trade, ctx).join(coin.into_balance());
  t1(trade);
}

public(package) fun ts(trade: &mut Trade, amount: u64, ctx: &mut TxContext): Coin<SUI> {
  assert!(!trade.locked, ELocked);
  let coin = coin::from_balance(mb1(trade, ctx).split(amount), ctx);
  t1(trade);
  coin
}

/// Accept the trade AS READ: `version` is the state the caller is agreeing to — any change
/// since aborts. The second matching accept locks the escrow terminally.
public(package) fun a(trade: &mut Trade, version: u64, ctx: &TxContext) {
  assert!(!trade.locked, ELocked);
  assert!(trade.version == version, EStaleAccept);
  let sender = ctx.sender();
  ap2(trade, sender);
  if (sender == trade.a) trade.accept_a = true else trade.accept_b = true;
  if (trade.accept_a && trade.accept_b) {
    trade.locked = true;
  };
}

#[test_only]
public(package) fun trade_for_testing(
  a: address,
  b: address,
  sui_a: u64,
  sui_b: u64,
  ctx: &mut TxContext,
): Trade {
  Trade {
    id: object::new(ctx), a, b, version: 0, accept_a: false, accept_b: false, locked: false,
    sui_a: balance::create_for_testing(sui_a), sui_b: balance::create_for_testing(sui_b),
    caps_a: vector[], caps_b: vector[],
  }
}

#[test_only]
public(package) fun accept_as_for_testing(trade: &mut Trade, version: u64, sender: address) {
  assert!(!trade.locked, ELocked);
  assert!(trade.version == version, EStaleAccept);
  ap2(trade, sender);
  if (sender == trade.a) trade.accept_a = true else trade.accept_b = true;
  if (trade.accept_a && trade.accept_b) trade.locked = true;
}

#[test_only]
public(package) fun touch_for_testing(trade: &mut Trade) { t1(trade); }

#[test_only]
public(package) fun state_for_testing(trade: &Trade): vector<u64> {
  vector[
    trade.version,
    if (trade.accept_a) 1 else 0,
    if (trade.accept_b) 1 else 0,
    if (trade.locked) 1 else 0,
  ]
}

#[test_only]
public(package) fun destroy_for_testing(trade: Trade, ctx: &TxContext) { d(trade, ctx); }

/// Claim one COUNTERPARTY cap post-lock by purchasing at zero inside this module. The returned
/// TransferRequest forces royalty payment and relock before the PTB may complete.
public(package) fun gc<T: key + store>(
  trade: &mut Trade,
  item: ID,
  source: &mut Kiosk,
  ctx: &mut TxContext,
): (T, TransferRequest<T>) {
  assert!(trade.locked, ENotLocked);
  rf(tm(trade, ctx), item);
  source.purchase_with_cap(dof::remove(&mut trade.id, item), coin::zero<SUI>(ctx))
}

/// Claim the COUNTERPARTY's whole escrowed SUI (post-lock).
public(package) fun gs(trade: &mut Trade, ctx: &mut TxContext): Coin<SUI> {
  assert!(trade.locked, ENotLocked);
  let balance = tb(trade, ctx).withdraw_all();
  coin::from_balance(balance, ctx)
}

/// Delete a DRAINED trade — pre-lock after both sides withdrew, or post-lock after both
/// sides claimed. Either player may sweep it.
public(package) fun d(trade: Trade, ctx: &TxContext) {
  ap2(&trade, ctx.sender());
  let Trade { id, sui_a, sui_b, caps_a, caps_b, .. } = trade;
  assert!(caps_a.is_empty() && caps_b.is_empty(), ENotDrained);
  sui_a.destroy_zero();
  sui_b.destroy_zero();
  id.delete();
}

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

// assert_party
fun ap2(trade: &Trade, who: address) {
  assert!(who == trade.a || who == trade.b, ENotAParty);
}

// touch
/// Every mutation reopens negotiation: bump the version, void both signatures.
fun t1(trade: &mut Trade) {
  trade.version = trade.version + 1;
  trade.accept_a = false;
  trade.accept_b = false;
}

// my_manifest
fun mm(trade: &mut Trade, ctx: &TxContext): &mut vector<ID> {
  ap2(trade, ctx.sender());
  if (ctx.sender() == trade.a) &mut trade.caps_a else &mut trade.caps_b
}

// their_manifest
fun tm(trade: &mut Trade, ctx: &TxContext): &mut vector<ID> {
  ap2(trade, ctx.sender());
  if (ctx.sender() == trade.a) &mut trade.caps_b else &mut trade.caps_a
}

// my_balance
fun mb1(trade: &mut Trade, ctx: &TxContext): &mut Balance<SUI> {
  ap2(trade, ctx.sender());
  if (ctx.sender() == trade.a) &mut trade.sui_a else &mut trade.sui_b
}

// their_balance
fun tb(trade: &mut Trade, ctx: &TxContext): &mut Balance<SUI> {
  ap2(trade, ctx.sender());
  if (ctx.sender() == trade.a) &mut trade.sui_b else &mut trade.sui_a
}

// remove_from
fun rf(manifest: &mut vector<ID>, item: ID) {
  let (found, index) = manifest.index_of(&item);
  assert!(found, ECapNotFound);
  manifest.remove(index);
}
