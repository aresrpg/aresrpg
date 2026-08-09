// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// GIFT — escrow-recoverable player-to-player item send (design doc
/// `docs/ITEM_SEND_PLAN.md` §A4). A direct simplification of `commission.move`'s shared-escrow shape
/// (send/claim/recall ≈ request/execute/cancel), specialised for MOVING kiosk-locked items instead of paying an
/// artisan. The whole point of escrow over a raw cap transfer (the native path) is THREE guarantees:
///
///   ① RECOVERABILITY — a cap sent to a typo/dead address strands the sender's item in exclusive-listing limbo
///      forever (a locked item cannot be `take`-n while exclusively listed — `kiosk.move:42-54`). Escrow's
///      `recall` unwinds it. ② FREE-TO-RECEIVE — the claim's `royalty_rule::pay` draws the 0.01-SUI/item royalty
///      from WHOEVER signs; a receiver would have to fund it themselves. Escrow lets the SENDER PRE-FUND that
///      royalty coin, so the receiver pays only (sponsorable) gas. ③ CLEAN SENDER IDENTITY — a `GiftSent` event
///      the indexer projects into the receiver's inbox (native caps emit nothing — `kiosk.move:338/362/385`).
///
/// FLOW (three doors, ownership-gated, escrow consumed BY VALUE so double-spend is impossible by construction —
/// the exact guarantee `commission.move:21` relies on):
///   • send(SENDER): exclusively-list each item in the sender's kiosk via `list_with_purchase_cap(…, min_price
///     = 0)`, wrap the N `PurchaseCap`s + a pre-funded royalty `Balance<SUI>` + the recipient into a shared
///     `Gift`. Emits `GiftSent`. The items stay physically in the sender's kiosk (exclusively listed) — the cap
///     is the transferable right to buy them for 0.
///   • claim(RECIPIENT-ONLY): consume the `Gift` — for EACH cap `purchase_with_cap` (paying the 0-price into the
///     sender's kiosk profits) and resolve the FULL Item TransferPolicy receipt (`item::ListingRule` + `item::LotRule` +
///     `royalty_rule::pay` from the escrowed balance + `kiosk_lock_rule` + `personal_kiosk_rule` +
///     `confirm_request`), landing each item LOCKED in the recipient's personal kiosk (kiosk-lock constitution).
///     Royalty + lock rules FIRE exactly as a normal purchase — nothing is bypassed. Any over-funded royalty
///     remainder refunds to the sender. ONE-SHOT-ALL (all caps in the gift, or none): the escrow is a single
///     by-value object, which is what makes the shape clean + double-claim-proof (per-item claim would need a
///     `&mut Gift` + cap-vector surgery + an "is it empty yet" lifecycle — a deferred natural extension, not v1).
///   • recall(SENDER-ONLY, unclaimed): `return_purchase_cap` each cap (delists — the item becomes `take`-able by
///     the sender again), refund the royalty, delete the escrow. Ownership-gated ONLY (no version/config gate —
///     a freeze must never strand the sender's OWN items + money, exactly like `commission.move` `cancel`).
///
/// WHY NO RETURN-TO-SENDER CLAIM DOOR: a receiver who doesn't want a gift simply never claims it;
/// the sender `recall`s. A separate receiver-side "reject" is redundant surface.
module aresrpg_gifting::gift;

use aresrpg::{config::GameConfig, item::{Self, Item}, version::Version};
use kiosk::{
  kiosk_lock_rule,
  personal_kiosk::{Self, PersonalKioskCap},
  personal_kiosk_rule,
  royalty_rule
};
use sui::{
  balance::{Self, Balance},
  coin::{Self, Coin},
  event,
  kiosk::{Kiosk, PurchaseCap},
  sui::SUI,
  transfer_policy::{Self, TransferPolicy},
  tx_context::sender
};

// ╔════════════════ [ Errors (teach, don't reject) ] ═════════════════════════ ]

const ENotRecipient: u64 = 101; // claim: the caller is not this gift's named recipient
const ENotSender: u64 = 102; // recall: the caller is not this gift's sender
const EEmptyGift: u64 = 103; // send: a gift must carry at least one item
const ETooManyItems: u64 = 104; // send: the item list exceeds MAX_GIFT_ITEMS

/// Gas backstop on the caller-supplied item list (house idiom: `shop::MAX_BUY_QUANTITY`). Unbounded, `send`
/// looped a list of any length into ONE shared `Gift` — and `claim`/`recall` have to walk that SAME list back
/// in a single tx. A gift that is cheap to CREATE but too big to claim or recall strands its items listed in
/// the sender's kiosk forever, held by caps inside an object nobody can consume. The cap is deliberately
/// tighter than the shop's 100: claim does strictly more per item (purchase-with-cap + a full policy resolve +
/// a personal-kiosk lock, across two kiosks). A larger gift is split into several.
const MAX_GIFT_ITEMS: u64 = 50;

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// A shared escrow binding a SENDER to a RECIPIENT for N items. `caps` are the exclusive-listing purchase caps
/// (one per item, all from the sender's kiosk at `min_price = 0`) — holding a cap IS the right to buy that item
/// for nothing. `royalty` is the sender's PRE-FUNDED royalty pool (≈ 0.01 SUI × N) the claim draws from so the
/// receiver pays only gas; any remainder refunds to the sender at claim/recall. No item field — the items stay
/// kiosk-locked (and exclusively listed) in the sender's kiosk; the caps are the only handle. `key` only —
/// shared, consumed by value at claim/recall (double-claim / claim-after-recall impossible by construction).
public struct Gift has key {
  id: UID,
  sender: address,
  recipient: address,
  caps: vector<PurchaseCap<Item>>,
  royalty: Balance<SUI>,
}

// ╔════════════════ [ Events (the indexer projects the inbox from these) ] ═══ ]

/// A send — the inbox's arrival event. `items` = the exact item ids listed into the escrow (the receiver's inbox
/// row renders "X sent you N items" from one of these per sender+recipient in a window).
public struct GiftSent has copy, drop { gift: ID, sender: address, recipient: address, items: vector<ID> }

/// A claim — the items are now locked in the recipient's kiosk; the inbox row clears.
public struct GiftClaimed has copy, drop { gift: ID, sender: address, recipient: address, items: vector<ID> }

/// A recall — the items are delisted back to the sender's kiosk, the royalty refunded.
public struct GiftRecalled has copy, drop { gift: ID, sender: address, items: vector<ID> }

// ╔════════════════ [ Send — exclusively list N items + escrow the caps + pre-funded royalty ] ═ ]

/// SEND `item_ids` (all currently kiosk-locked in the sender's `kiosk`) to `recipient`, pre-funding `royalty`
/// (the sender's 0.01-SUI-per-item pool that makes the gift free to receive). Each item is exclusively listed at
/// `min_price = 0` via the sender's personal-kiosk owner cap; the returned caps + the royalty balance become a
/// shared `Gift`. The sender is the tx signer. Aborts `EEmptyGift` on an empty list. `list_with_purchase_cap`
/// itself aborts if an item is already listed or absent — so a gift can only wrap unlisted items the sender owns.
public fun send(
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  item_ids: vector<ID>,
  recipient: address,
  royalty: Coin<SUI>,
  config: &GameConfig,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_enabled();
  config.assert_enabled();
  assert!(!item_ids.is_empty(), EEmptyGift);
  assert!(item_ids.length() <= MAX_GIFT_ITEMS, ETooManyItems); // claim/recall must be able to walk it back
  let gift_sender = sender(ctx);
  let owner_cap = personal_kiosk::borrow(pkcap);

  let mut caps = vector[];
  let mut i = 0;
  while (i < item_ids.length()) {
    let cap = kiosk.list_with_purchase_cap<Item>(owner_cap, *item_ids.borrow(i), 0, ctx);
    caps.push_back(cap);
    i = i + 1;
  };

  let gift = Gift { id: object::new(ctx), sender: gift_sender, recipient, caps, royalty: royalty.into_balance() };
  event::emit(GiftSent { gift: object::id(&gift), sender: gift_sender, recipient, items: item_ids });
  transfer::share_object(gift);
}

// ╔════════════════ [ Claim — recipient buys each item for 0 through the real policy; royalty pre-paid ] ═ ]

/// CLAIM a gift (RECIPIENT-ONLY, `ENotRecipient`): consume the escrow and, for EACH cap, `purchase_with_cap`
/// the item out of the SENDER's kiosk (paying the 0 price into the sender's profits) and resolve the FULL Item
/// TransferPolicy receipt — the item lands LOCKED in the recipient's personal kiosk. The 0.01-SUI/item royalty
/// is paid from the ESCROWED balance (the receiver's wallet is untouched — free to receive); any surplus the
/// sender over-funded refunds to the sender. The gift is consumed BY VALUE, so a second claim (or a
/// claim-after-recall) is impossible. `sender_kiosk` is the sender's (shared) kiosk the items are listed in;
/// `recipient_kiosk`/`recipient_pkcap` are the receiver's own. NOTE: a self-gift (sender == recipient, one
/// kiosk) cannot be claimed — Sui rejects the same shared object as two `&mut` args — but `recall` recovers it,
/// so nothing strands.
public fun claim(
  gift: Gift,
  sender_kiosk: &mut Kiosk,
  recipient_kiosk: &mut Kiosk,
  recipient_pkcap: &PersonalKioskCap,
  policy: &mut TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  ctx: &mut TxContext,
) {
  version.assert_enabled();
  config.assert_enabled();
  let claimer = sender(ctx);
  let Gift { id, sender: gift_sender, recipient, mut caps, royalty } = gift;
  assert!(claimer == recipient, ENotRecipient);

  let owner_cap = personal_kiosk::borrow(recipient_pkcap);
  let mut royalty_bal = royalty;
  let mut items = vector[];

  caps.reverse(); // pop_back now walks FORWARD (send) order — GiftClaimed.items mirrors GiftSent.items exactly
  while (!caps.is_empty()) {
    let cap = caps.pop_back();
    // Buy the item out of the sender's kiosk for its 0 min-price (a zero coin → 0 into the sender's profits).
    let (item, mut request) = sender_kiosk.purchase_with_cap<Item>(cap, coin::zero<SUI>(ctx));
    let iid = object::id(&item);
    items.push_back(iid);

    // Receipt tail — the SAME order the marketplace-purchase PTB uses (the two Ares rules need `&item` BEFORE the
    // lock consumes it; the two lock rules need the item ALREADY re-locked in the recipient's kiosk):
    item::prove_listing_amount(&item, &mut request); // amount-0 ghost gate (real stacks pass)
    item::prove_lot(&item, &mut request); // legal stack lot, or trivial pass for a unique Item
    let fee = royalty_rule::fee_amount(policy, 0); // 10% × 0 floored to the 0.01-SUI min_amount
    royalty_rule::pay(policy, &mut request, coin::from_balance(royalty_bal.split(fee), ctx)); // from ESCROW
    recipient_kiosk.lock(owner_cap, policy, item); // → recipient kiosk (framework kiosk::lock; personal-kiosk proven by the two rules below)
    kiosk_lock_rule::prove(&mut request, recipient_kiosk); // item is now locked in the kiosk
    personal_kiosk_rule::prove(recipient_kiosk, &mut request); // …and the kiosk is personal
    let (_id, _paid, _from) = transfer_policy::confirm_request(policy, request); // 5 receipts == 5 rules → OK
  };
  caps.destroy_empty();

  // Refund any royalty the sender over-funded (e.g. the policy min was lowered after send) back to the sender.
  if (royalty_bal.value() > 0) transfer::public_transfer(coin::from_balance(royalty_bal, ctx), gift_sender)
  else royalty_bal.destroy_zero();

  event::emit(GiftClaimed { gift: id.to_inner(), sender: gift_sender, recipient, items });
  id.delete();
}

// ╔════════════════ [ Recall — sender unwinds an unclaimed gift (ownership-only, never freezable) ] ═ ]

/// RECALL an unclaimed gift (SENDER-ONLY, `ENotSender`): `return_purchase_cap` each cap (delists the item — it
/// becomes `take`-able by the sender again in `sender_kiosk`) and refund the pre-funded royalty. Consumes the
/// gift by value, so it can never race a claim. OWNERSHIP-GATED ONLY — no version/config gate, so a package
/// freeze can never trap the sender's own items or money (the `commission.move` `cancel` invariant).
public fun recall(gift: Gift, sender_kiosk: &mut Kiosk, ctx: &mut TxContext) {
  let party = sender(ctx);
  let Gift { id, sender: gift_sender, recipient: _, mut caps, royalty } = gift;
  assert!(party == gift_sender, ENotSender);

  let mut items = vector[];
  caps.reverse(); // forward (send) order — ONE items order across the whole event lifecycle (sent/claimed/recalled)
  while (!caps.is_empty()) {
    let cap = caps.pop_back();
    items.push_back(cap.purchase_cap_item());
    sender_kiosk.return_purchase_cap<Item>(cap); // delist — item takeable by the sender again
  };
  caps.destroy_empty();

  if (royalty.value() > 0) transfer::public_transfer(coin::from_balance(royalty, ctx), gift_sender)
  else royalty.destroy_zero();

  event::emit(GiftRecalled { gift: id.to_inner(), sender: gift_sender, items });
  id.delete();
}

// ╔════════════════ [ Getters (FREE reads — the RPC/SDK project these) ] ═════ ]

public fun gift_sender(self: &Gift): address { self.sender }

public fun recipient(self: &Gift): address { self.recipient }

public fun item_count(self: &Gift): u64 { self.caps.length() }

public fun royalty_value(self: &Gift): u64 { self.royalty.value() }

/// The item ids escrowed in this gift, derived from the caps (single source of truth — the caps).
public fun item_ids(self: &Gift): vector<ID> {
  let mut ids = vector[];
  let mut i = 0;
  while (i < self.caps.length()) {
    ids.push_back(self.caps.borrow(i).purchase_cap_item());
    i = i + 1;
  };
  ids
}
