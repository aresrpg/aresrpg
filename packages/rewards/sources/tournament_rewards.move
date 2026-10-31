// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Optional tournament currency accounting. The game privately embeds Funds in its pool object;
/// only that owning module can supply this mutable reference. No new capability or global state.
module aresrpg_rewards::tournament_rewards;

use sui::{balance::Balance, coin::Coin, sui::SUI, vec_set::{Self, VecSet}};

const EPhase: u64 = 0;
const EClaimed: u64 = 1;
const EEmpty: u64 = 2;
const EEntryFee: u64 = 3;

public struct Funds<phantom Token> has store {
  balance: Balance<Token>,
  paid: u64,
  claimed: VecSet<ID>,
  refunded: bool,
}

public fun new<Token>(payment: Coin<Token>): Funds<Token> {
  assert!(payment.value() > 0, EEmpty);
  Funds { balance: payment.into_balance(), paid: 0, claimed: vec_set::empty(), refunded: false }
}

public fun deposit<Token>(funds: &mut Funds<Token>, payment: Coin<Token>) {
  assert!(!funds.refunded, EPhase);
  funds.balance.join(payment.into_balance());
}

/// Remaining plus already released value is the immutable funded total after registration closes.
public fun total<Token>(funds: &Funds<Token>): u64 { funds.balance.value() + funds.paid }
#[test_only]
public fun balance<Token>(funds: &Funds<Token>): u64 { funds.balance.value() }

/// Core proves cancellation or final standings and computes the unawarded allocation.
public fun refund<Token>(funds: &mut Funds<Token>, amount: u64, organizer: address, ctx: &mut TxContext) {
  if (funds.refunded) return;
  funds.refunded = true;
  pay(funds, amount, organizer, ctx);
}

/// Core supplies the registered character, fixed recipient and exact placement entitlement.
public fun claim<Token>(funds: &mut Funds<Token>, character: ID, recipient: address, amount: u64, ctx: &mut TxContext) {
  assert!(funds.refunded, EPhase);
  assert!(!funds.claimed.contains(&character), EClaimed);
  funds.claimed.insert(character);
  pay(funds, amount, recipient, ctx);
}

fun pay<Token>(funds: &mut Funds<Token>, amount: u64, recipient: address, ctx: &mut TxContext) {
  if (amount > 0) {
    funds.paid = funds.paid + amount;
    transfer::public_transfer(funds.balance.split(amount).into_coin(ctx), recipient);
  };
}

#[test_only]
public fun destroy_for_testing<Token>(funds: Funds<Token>) {
  let Funds { balance, .. } = funds;
  balance.destroy_zero();
}


/// Only successful registration retains this immediate 50/50 split; its caller owns roster validation.
public fun pay_entry(prizes: &mut Balance<SUI>,
  payment: Coin<SUI>, expected: u64, treasury: address, ctx: &mut TxContext) {
  let amount = payment.value();
  assert!(amount == expected, EEntryFee);
  prizes.join(payment.into_balance());
  let cut = amount / 2;
  if (cut > 0) transfer::public_transfer(prizes.split(cut).into_coin(ctx), treasury);
}

public fun portion(total: u64, bps: u64): u64 { ((total as u128) * (bps as u128) / 10_000) as u64 }

public fun share(amount: u64, count: u64, ordinal: u64): u64 {
  amount / count + if (ordinal < amount % count) 1 else 0
}
