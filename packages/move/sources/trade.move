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
/// The claimed cap is consumed in the same PTB via the kiosk sdk (purchase at 0 + royalty
/// floor + relock), exactly the public-market path.
module aresrpg::trade;

use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::dynamic_object_field as dof;
use sui::event;
use sui::kiosk::{Self, PurchaseCap};
use sui::sui::SUI;

const ENotAParty: u64 = 2601; // every door: the caller is neither side of this trade
const ELocked: u64 = 2602; // deposits/withdrawals/accepts after the lock
const ENotLocked: u64 = 2603; // claims before the lock
const EPricedCap: u64 = 2604; // deposit: a cap with min_price > 0 is a hidden price tag
const ECapNotFound: u64 = 2605; // withdraw/claim: the id is not in that side's manifest
const EStaleAccept: u64 = 2606; // accept: the trade changed since the caller read it
const ENotDrained: u64 = 2607; // destroy: caps or SUI remain

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
  /// item ids of the caps each side parked (the cap itself sits under CapKey{item})
  caps_a: vector<ID>,
  caps_b: vector<ID>,
}

public struct CapKey has copy, drop, store { item: ID }

public struct TradeCreated has copy, drop { trade: ID, a: address, b: address }

/// Any content mutation (cap or SUI, in or out) — accepts were cleared, re-read and re-accept.
public struct TradeChanged has copy, drop { trade: ID, version: u64 }

public struct TradeAccepted has copy, drop { trade: ID, who: address }

public struct TradeLocked has copy, drop { trade: ID }

public struct TradeDestroyed has copy, drop { trade: ID }

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
  event::emit(TradeCreated { trade: trade.id.to_inner(), a: trade.a, b: trade.b });
  transfer::share_object(trade);
}

/// Park a cap on the caller's side. 0-price only: trades are barter + escrowed SUI — a
/// priced cap would make a "free" claim cost money the counterparty never agreed to see.
public(package) fun deposit_cap<T: key + store>(
  trade: &mut Trade,
  cap: PurchaseCap<T>,
  ctx: &TxContext,
) {
  assert!(!trade.locked, ELocked);
  assert!(kiosk::purchase_cap_min_price(&cap) == 0, EPricedCap);
  let item = kiosk::purchase_cap_item(&cap);
  my_manifest(trade, ctx).push_back(item);
  dof::add(&mut trade.id, CapKey { item }, cap);
  touch(trade);
}

/// Take a parked cap back (pre-lock only) — chain `kiosk::return_purchase_cap` in the same
/// PTB to unlist the item. THIS door is why a ghosted trade never locks anything.
public(package) fun withdraw_cap<T: key + store>(
  trade: &mut Trade,
  item: ID,
  ctx: &TxContext,
): PurchaseCap<T> {
  assert!(!trade.locked, ELocked);
  remove_from(my_manifest(trade, ctx), item);
  touch(trade);
  dof::remove(&mut trade.id, CapKey { item })
}

public(package) fun deposit_sui(trade: &mut Trade, coin: Coin<SUI>, ctx: &TxContext) {
  assert!(!trade.locked, ELocked);
  my_balance(trade, ctx).join(coin.into_balance());
  touch(trade);
}

public(package) fun withdraw_sui(trade: &mut Trade, amount: u64, ctx: &mut TxContext): Coin<SUI> {
  assert!(!trade.locked, ELocked);
  let coin = coin::from_balance(my_balance(trade, ctx).split(amount), ctx);
  touch(trade);
  coin
}

/// Accept the trade AS READ: `version` is the state the caller is agreeing to — any change
/// since aborts. The second matching accept locks the escrow terminally.
public(package) fun accept(trade: &mut Trade, version: u64, ctx: &TxContext) {
  assert!(!trade.locked, ELocked);
  assert!(trade.version == version, EStaleAccept);
  let sender = ctx.sender();
  assert_party(trade, sender);
  if (sender == trade.a) trade.accept_a = true else trade.accept_b = true;
  event::emit(TradeAccepted { trade: trade.id.to_inner(), who: sender });
  if (trade.accept_a && trade.accept_b) {
    trade.locked = true;
    event::emit(TradeLocked { trade: trade.id.to_inner() });
  }
}

/// Claim one of the COUNTERPARTY's caps (post-lock) — consume it in the same PTB: purchase
/// at 0, pay the royalty floor, relock in the claimer's kiosk. The claim never expires.
public(package) fun claim_cap<T: key + store>(
  trade: &mut Trade,
  item: ID,
  ctx: &TxContext,
): PurchaseCap<T> {
  assert!(trade.locked, ENotLocked);
  remove_from(their_manifest(trade, ctx), item);
  dof::remove(&mut trade.id, CapKey { item })
}

/// Claim the COUNTERPARTY's whole escrowed SUI (post-lock).
public(package) fun claim_sui(trade: &mut Trade, ctx: &mut TxContext): Coin<SUI> {
  assert!(trade.locked, ENotLocked);
  let balance = their_balance(trade, ctx).withdraw_all();
  coin::from_balance(balance, ctx)
}

/// Delete a DRAINED trade — pre-lock after both sides withdrew, or post-lock after both
/// sides claimed. Either player may sweep it.
public(package) fun destroy(trade: Trade, ctx: &TxContext) {
  assert_party(&trade, ctx.sender());
  let Trade { id, sui_a, sui_b, caps_a, caps_b, .. } = trade;
  assert!(caps_a.is_empty() && caps_b.is_empty(), ENotDrained);
  event::emit(TradeDestroyed { trade: id.to_inner() });
  sui_a.destroy_zero();
  sui_b.destroy_zero();
  id.delete();
}

// ╔════════════════ [ Internals ] ════════════════════════════════════════════ ]

fun assert_party(trade: &Trade, who: address) {
  assert!(who == trade.a || who == trade.b, ENotAParty);
}

/// Every mutation reopens negotiation: bump the version, void both signatures.
fun touch(trade: &mut Trade) {
  trade.version = trade.version + 1;
  trade.accept_a = false;
  trade.accept_b = false;
  event::emit(TradeChanged { trade: trade.id.to_inner(), version: trade.version });
}

fun my_manifest(trade: &mut Trade, ctx: &TxContext): &mut vector<ID> {
  assert_party(trade, ctx.sender());
  if (ctx.sender() == trade.a) &mut trade.caps_a else &mut trade.caps_b
}

fun their_manifest(trade: &mut Trade, ctx: &TxContext): &mut vector<ID> {
  assert_party(trade, ctx.sender());
  if (ctx.sender() == trade.a) &mut trade.caps_b else &mut trade.caps_a
}

fun my_balance(trade: &mut Trade, ctx: &TxContext): &mut Balance<SUI> {
  assert_party(trade, ctx.sender());
  if (ctx.sender() == trade.a) &mut trade.sui_a else &mut trade.sui_b
}

fun their_balance(trade: &mut Trade, ctx: &TxContext): &mut Balance<SUI> {
  assert_party(trade, ctx.sender());
  if (ctx.sender() == trade.a) &mut trade.sui_b else &mut trade.sui_a
}

fun remove_from(manifest: &mut vector<ID>, item: ID) {
  let (found, index) = manifest.index_of(&item);
  assert!(found, ECapNotFound);
  manifest.remove(index);
}
