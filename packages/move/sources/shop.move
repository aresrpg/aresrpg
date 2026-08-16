// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// THE OFFICIAL SHOP + ADMIN DISTRIBUTION (owner 2026-08-10). Three value routes, ZERO
/// randomness — shop items never carry stats, so everything mints through `mint_plain`
/// (which refuses ranged templates mechanically):
///
///   SALE — a seed-minted shared vending machine, never modified after birth (no
///   pause, no price knob, no window — sales are frozen content like everything else);
///   only `supply` counts down. Exact payment × quantity → `@treasury`.
///
///   AIRDROP — a shared whitelist snapshotted at the seeding: each listed address claims
///   ONCE (claiming REMOVES the address — once-only by deletion, and the last claim
///   leaves an empty list).
///
///   GIFTCARD — a `key + store` VOUCHER (not a game item: no stats, freely portable)
///   minted at the seeding and distributed off-chain — zksend links carry it natively.
///   Whoever holds it redeems: the voucher burns, the item is born INSIDE the redeemer's
///   kiosk. The link moves the voucher; a game item never sits at a raw address.
///
/// ALL THREE are SEALED SUPPLY DOORS (owner 2026-08-10): sales, airdrops and giftcards
/// mint items into existence, so all of them author ONLY through the seeding — after
/// the seal, no door can ever introduce supply again.
///
/// Peer trading needs no code here: sales/gifts/exchange ride native kiosk listings
/// (exclusive listings for gifts) under the seed-installed royalty rule.
module aresrpg::shop;

use aresrpg::item::{Self, Item, ItemTemplate, TemplateRegistry};
use std::string::String;
use sui::{
  coin::Coin,
  derived_object,
  event,
  kiosk::{Kiosk, KioskOwnerCap},
  sui::SUI,
  transfer_policy::TransferPolicy,
  vec_set::{Self, VecSet},
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EWrongTemplate: u64 = 2401; // buy/claim/redeem: the passed template is not the one
const EWrongPayment: u64 = 2402; // buy: payment must be exactly price × quantity
const ESoldOut: u64 = 2403; // buy: the batch exceeds the sale's remaining supply
const EZeroQuantity: u64 = 2404;
const ENotWhitelisted: u64 = 2405; // claim: the sender is not (or no longer) on the list

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// Keys a sale's derived address by the item type it sells — the client derives it offline.
public struct SaleKey(String) has copy, drop, store;
public struct AirdropKey(String) has copy, drop, store;
public struct GiftcardKey(String) has copy, drop, store;

/// The seed-minted vending machine: one item type, one price, a finite supply. No
/// admin door ever touches it again — `supply` is the only field that moves.
public struct Sale has key {
  id: UID,
  template: ID,
  price: u64, // MIST per unit
  supply: u64, // remaining units; the seeding authors the total
}

/// A seeded airdrop: the whitelist is the full claim state — an address leaves on claim.
/// A `VecSet` by construction (audit 2026-08-10): a duplicate address in the authored list
/// would have been two claims; the set refuses it at the seeding, mechanically.
public struct Airdrop has key {
  id: UID,
  template: ID,
  amount_each: u32,
  whitelist: VecSet<address>,
}

/// The zksend-portable voucher: `store` lets any link or wallet carry it; redeeming burns
/// it and mints the item inside the redeemer's own kiosk.
public struct Giftcard has key, store {
  id: UID,
  template: ID,
  amount: u32,
}

public struct SaleBought has copy, drop { sale: ID, buyer: address, quantity: u64, paid: u64 }

public struct AirdropCreated has copy, drop { airdrop: ID, template: ID, addresses: u64 }

public struct AirdropClaimed has copy, drop { airdrop: ID, claimer: address }

public struct GiftcardMinted has copy, drop { giftcard: ID, template: ID, amount: u32 }

public struct GiftcardRedeemed has copy, drop { giftcard: ID, redeemer: address }

// ╔════════════════ [ Seeding (seed.move gates) + admin creation ] ═══════════ ]

/// Mint + share a sale at its item-type-derived address — the seeding's door; the seal
/// closes it with the rest. Shared (a frozen object could not count supply down), immutable
/// by door-absence like the World's content.
public(package) fun new_sale(
  registry: &mut TemplateRegistry,
  item_type: String,
  template: ID,
  price: u64,
  supply: u64,
) {
  assert!(supply >= 1, EZeroQuantity);
  transfer::share_object(Sale {
    id: derived_object::claim(item::registry_uid_mut(registry), SaleKey(item_type)),
    template,
    price,
    supply,
  });
}

/// Open an airdrop over a snapshotted whitelist — a seeding door, sealed with the rest.
/// The set-build aborts on any duplicate address: a list that could double-claim never
/// reaches the chain.
public(package) fun new_airdrop(
  registry: &mut TemplateRegistry,
  drop_id: String,
  template: ID,
  amount_each: u32,
  whitelist: vector<address>,
) {
  assert!(amount_each >= 1 && !whitelist.is_empty(), EZeroQuantity);
  let mut set = vec_set::empty();
  let mut i = 0;
  while (i < whitelist.length()) {
    set.insert(whitelist[i]); // aborts on a duplicate — VecSet law
    i = i + 1;
  };
  let drop = Airdrop {
    id: derived_object::claim(item::registry_uid_mut(registry), AirdropKey(drop_id)),
    template,
    amount_each,
    whitelist: set,
  };
  event::emit(AirdropCreated {
    airdrop: drop.id.to_inner(),
    template,
    addresses: drop.whitelist.length(),
  });
  transfer::share_object(drop);
}

/// Mint a giftcard voucher and RETURN it — the seeding PTB routes it (held for later
/// zksend links, direct sends); the object's `store` makes it portable anywhere.
public(package) fun new_giftcard(
  registry: &mut TemplateRegistry,
  card_id: String,
  template: ID,
  amount: u32,
): Giftcard {
  assert!(amount >= 1, EZeroQuantity);
  let card = Giftcard {
    id: derived_object::claim(item::registry_uid_mut(registry), GiftcardKey(card_id)),
    template,
    amount,
  };
  event::emit(GiftcardMinted { giftcard: card.id.to_inner(), template, amount });
  card
}

// ╔════════════════ [ Player doors (api gates the version, then calls) ] ═════ ]

/// Buy `quantity` units: exact payment to the treasury, supply down, the stack lands in
/// the buyer's kiosk (merged into `existing` under the no-dust law). Stat-less by
/// construction — `mint_plain` refuses a ranged template.
public(package) fun buy(
  sale: &mut Sale,
  template: &ItemTemplate,
  quantity: u32,
  payment: Coin<SUI>,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Item>,
  ctx: &mut TxContext,
) {
  assert!(object::id(template) == sale.template, EWrongTemplate);
  assert!(quantity >= 1, EZeroQuantity);
  assert!((quantity as u64) <= sale.supply, ESoldOut);
  let total = sale.price * (quantity as u64);
  assert!(payment.value() == total, EWrongPayment);
  transfer::public_transfer(payment, @treasury);
  sale.supply = sale.supply - (quantity as u64);
  item::deposit(kiosk, cap, policy, existing, item::mint_plain(template, quantity, ctx));
  event::emit(SaleBought {
    sale: sale.id.to_inner(),
    buyer: ctx.sender(),
    quantity: quantity as u64,
    paid: total,
  });
}

/// Claim the sender's airdrop share — once only: the address LEAVES the whitelist.
public(package) fun claim_airdrop(
  drop: &mut Airdrop,
  template: &ItemTemplate,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Item>,
  ctx: &mut TxContext,
) {
  assert!(object::id(template) == drop.template, EWrongTemplate);
  assert!(drop.whitelist.contains(&ctx.sender()), ENotWhitelisted);
  drop.whitelist.remove(&ctx.sender());
  item::deposit(kiosk, cap, policy, existing, item::mint_plain(template, drop.amount_each, ctx));
  event::emit(AirdropClaimed { airdrop: drop.id.to_inner(), claimer: ctx.sender() });
}

/// Redeem a giftcard: the voucher burns, the item is born locked in the redeemer's kiosk.
public(package) fun redeem_giftcard(
  card: Giftcard,
  template: &ItemTemplate,
  existing: Option<ID>,
  kiosk: &mut Kiosk,
  cap: &KioskOwnerCap,
  policy: &TransferPolicy<Item>,
  ctx: &mut TxContext,
) {
  let Giftcard { id, template: wanted, amount } = card;
  assert!(object::id(template) == wanted, EWrongTemplate);
  event::emit(GiftcardRedeemed { giftcard: id.to_inner(), redeemer: ctx.sender() });
  id.delete();
  item::deposit(kiosk, cap, policy, existing, item::mint_plain(template, amount, ctx));
}
