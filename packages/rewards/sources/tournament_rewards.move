// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// Optional tournament currency accounting. The game privately embeds Funds in its pool object;
/// only that owning module can supply this mutable reference. No new capability or global state.
module aresrpg_rewards::tournament_rewards;

use sui::{balance::Balance, coin::Coin, vec_set::{Self, VecSet}};

const EPhase: u64 = 0;
const EClaimed: u64 = 1;
const EEmpty: u64 = 2;

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
