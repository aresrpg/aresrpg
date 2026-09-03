// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Durable p2p escrow. Pure lifecycle lives in move-math; this object owns balances, caps,
/// kiosk transfers, and the terminal shrinking lattice.
module aresrpg::trade;

use aresrpg::version::{Self, Version};
use aresrpg::item::Item;
use aresrpg_math::trade_state::{Self, TradeState};
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::dynamic_object_field as dof;
use sui::kiosk::{Self, Kiosk, PurchaseCap};
use sui::sui::SUI;
use sui::transfer_policy::TransferRequest;

public struct Trade has key {
  id: UID,
  state: TradeState,
  sui_a: Balance<SUI>,
  sui_b: Balance<SUI>,
  caps_a: vector<ID>,
  caps_b: vector<ID>,
}

public fun create(counterparty: address, version: &Version, ctx: &mut TxContext) {
  version.assert_latest();
  transfer::share_object(Trade { id: object::new(ctx), state: trade_state::new(ctx.sender(), counterparty),
    sui_a: balance::zero(), sui_b: balance::zero(), caps_a: vector[], caps_b: vector[] });
}
public fun join(trade: &mut Trade, seen: u64, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  trade_state::join(&mut trade.state, seen, ctx.sender());
}
public fun end_request(trade: Trade, seen: u64, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  trade_state::assert_request_exit(&trade.state, seen, ctx.sender());
  destroy_drained(trade, ctx);
}
public fun cancel(trade: &mut Trade, seen: u64, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  trade_state::cancel(&mut trade.state, seen, ctx.sender());
}
public(package) fun put_item(trade: &mut Trade, cap: PurchaseCap<Item>, seen: u64, ctx: &TxContext) {
  trade_state::assert_editable(&trade.state, seen, ctx.sender());
  trade_state::assert_zero_price(kiosk::purchase_cap_min_price(&cap));
  let item = kiosk::purchase_cap_item(&cap);
  {
    let manifest = my_manifest(trade, ctx.sender());
    trade_state::assert_cap_room(manifest.length());
    manifest.push_back(item);
  };
  dof::add(&mut trade.id, item, cap);
  trade_state::touch(&mut trade.state);
}
public(package) fun take_item(trade: &mut Trade, item: ID, seen: u64, ctx: &TxContext): PurchaseCap<Item> {
  trade_state::assert_editable(&trade.state, seen, ctx.sender());
  remove_from(my_manifest(trade, ctx.sender()), item);
  let cap = dof::remove(&mut trade.id, item);
  trade_state::touch(&mut trade.state);
  cap
}
public fun put_sui(trade: &mut Trade, coin: Coin<SUI>, seen: u64, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  trade_state::assert_editable(&trade.state, seen, ctx.sender());
  trade_state::assert_positive(coin.value());
  my_balance(trade, ctx.sender()).join(coin.into_balance());
  trade_state::touch(&mut trade.state);
}
public fun take_sui(
  trade: &mut Trade,
  amount: u64,
  seen: u64,
  version: &Version,
  ctx: &mut TxContext,
): Coin<SUI> {
  version.assert_latest();
  trade_state::assert_editable(&trade.state, seen, ctx.sender());
  trade_state::assert_positive(amount);
  let coin = coin::from_balance(my_balance(trade, ctx.sender()).split(amount), ctx);
  trade_state::touch(&mut trade.state);
  coin
}
public fun accept(trade: &mut Trade, seen: u64, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  trade_state::accept(&mut trade.state, seen, ctx.sender());
}
public(package) fun claim_item(trade: &mut Trade, item: ID, source: &mut Kiosk, ctx: &mut TxContext): (Item, TransferRequest<Item>) {
  source.purchase_with_cap(take_terminal_cap(trade, item, false, ctx.sender()), coin::zero<SUI>(ctx))
}
public fun claim_sui(trade: &mut Trade, version: &Version, ctx: &mut TxContext): Coin<SUI> {
  version.assert_latest();
  take_terminal_sui(trade, false, ctx)
}
public(package) fun recover_item(trade: &mut Trade, item: ID, ctx: &TxContext): PurchaseCap<Item> {
  take_terminal_cap(trade, item, true, ctx.sender())
}
public fun recover_sui(trade: &mut Trade, version: &Version, ctx: &mut TxContext): Coin<SUI> {
  version.assert_latest();
  take_terminal_sui(trade, true, ctx)
}
fun take_terminal_cap(trade: &mut Trade, item: ID, own: bool, sender: address): PurchaseCap<Item> {
  trade_state::assert_phase(&trade.state, if (own) trade_state::cancelled() else trade_state::settling());
  trade_state::assert_party(&trade.state, sender);
  let manifest = if (trade_state::is_initiator(&trade.state, sender) == own) &mut trade.caps_a else &mut trade.caps_b;
  remove_from(manifest, item);
  dof::remove(&mut trade.id, item)
}
fun take_terminal_sui(trade: &mut Trade, own: bool, ctx: &mut TxContext): Coin<SUI> {
  trade_state::assert_phase(&trade.state, if (own) trade_state::cancelled() else trade_state::settling());
  let sender = ctx.sender();
  trade_state::assert_party(&trade.state, sender);
  let balance = if (trade_state::is_initiator(&trade.state, sender) == own) &mut trade.sui_a else &mut trade.sui_b;
  trade_state::assert_positive(balance.value());
  coin::from_balance(balance.withdraw_all(), ctx)
}
public fun close(trade: Trade, version: &Version, ctx: &TxContext) {
  version.assert_latest();
  trade_state::assert_terminal(&trade.state);
  destroy_drained(trade, ctx);
}

fun my_manifest(trade: &mut Trade, sender: address): &mut vector<ID> {
  if (trade_state::is_initiator(&trade.state, sender)) &mut trade.caps_a else &mut trade.caps_b
}
fun my_balance(trade: &mut Trade, sender: address): &mut Balance<SUI> {
  if (trade_state::is_initiator(&trade.state, sender)) &mut trade.sui_a else &mut trade.sui_b
}
fun remove_from(manifest: &mut vector<ID>, item: ID) {
  let index = trade_state::item_index(manifest, item);
  manifest.remove(index);
}
fun destroy_drained(trade: Trade, ctx: &TxContext) {
  trade_state::assert_party(&trade.state, ctx.sender());
  let Trade { id, sui_a, sui_b, caps_a, caps_b, .. } = trade;
  trade_state::assert_drained(caps_a.length(), caps_b.length());
  sui_a.destroy_zero(); sui_b.destroy_zero(); id.delete();
}

#[test_only]
public(package) fun trade_for_testing(a: address, b: address, phase: u8, revision: u64, sui_a: u64, sui_b: u64, ctx: &mut TxContext): Trade {
  Trade { id: object::new(ctx), state: trade_state::state_for_testing(a, b, phase, revision),
    sui_a: balance::create_for_testing(sui_a), sui_b: balance::create_for_testing(sui_b), caps_a: vector[], caps_b: vector[] }
}
#[test_only]
public(package) fun join_for_testing(trade: &mut Trade, seen: u64, sender: address) {
  trade_state::join(&mut trade.state, seen, sender);
}
#[test_only]
public(package) fun end_request_for_testing(trade: Trade, seen: u64, sender: address, ctx: &TxContext) {
  trade_state::assert_request_exit(&trade.state, seen, sender); destroy_drained(trade, ctx);
}
#[test_only]
public(package) fun accept_as_for_testing(trade: &mut Trade, seen: u64, sender: address) { trade_state::accept(&mut trade.state, seen, sender); }
#[test_only]
public(package) fun cancel_as_for_testing(trade: &mut Trade, seen: u64, sender: address) { trade_state::cancel(&mut trade.state, seen, sender); }
#[test_only]
public(package) fun touch_for_testing(trade: &mut Trade, seen: u64, sender: address) {
  trade_state::assert_editable(&trade.state, seen, sender); trade_state::touch(&mut trade.state);
}
#[test_only]
public(package) fun state_for_testing(trade: &Trade): vector<u64> {
  let (accept_a, accept_b) = trade_state::accepts(&trade.state);
  vector[trade_state::to_u8(trade_state::phase(&trade.state)), trade_state::offer_revision(&trade.state),
    if (accept_a) 1 else 0, if (accept_b) 1 else 0]
}
#[test_only]
public(package) fun close_for_testing(trade: Trade, ctx: &TxContext) {
  trade_state::assert_terminal(&trade.state); destroy_drained(trade, ctx);
}
#[test_only]
public(package) fun assert_claimable_sui_for_testing(trade: &Trade, sender: address) {
  trade_state::assert_phase(&trade.state, trade_state::settling());
  trade_state::assert_party(&trade.state, sender);
  let balance = if (trade_state::is_initiator(&trade.state, sender)) &trade.sui_b else &trade.sui_a;
  trade_state::assert_positive(balance.value());
}
