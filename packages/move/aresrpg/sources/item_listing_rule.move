/// ITEM_LISTING_RULE — the ANTI-GHOST-STACK gate on item resale: a kiosk TRANSFER-POLICY rule on
/// `TransferPolicy<Item>` that BLOCKS the sale of an amount-0 stack instance (the "ghost" the pool-refill design
/// keeps in a player kiosk so buys top up ONE object instead of minting a fresh one). This rule
/// blocks 0-amount listings, closing the ghost-stack exploit.
/// Mirrors `character_listing_rule` and the Mysten `royalty_rule` receipt shape exactly: the creator ADDs it ONCE
/// at ceremony, and every secondary PURCHASE must satisfy its receipt or the framework's `confirm_request` aborts.
///
/// WHY THE GHOST MUST STAY HOME. A stackable item's amount lives in one on-chain object; the refill design keeps
/// that object alive at amount 0 (a "ghost") so the next pool buy or stack-merge REFILLS it rather than minting a
/// new NFT. A ghost carries NO value, so it must never become a transfer vehicle: without this rule a griefer could
/// list amount-0 ghosts into other players' kiosks, and — combined with amount-arithmetic refills — a 0-value object
/// changing hands is exactly the kiosk-royalty-choke bypass the pool-fee fix closes on the SUI leg. This rule closes
/// it on the OBJECT leg: an amount-0 instance can be listed, but NO SALE CAN COMPLETE, so ghosts are economically
/// non-transferable and stay bound to the player who owns them. Real stacks (amount >= 1) list and sell normally,
/// paying the 10% royalty rule beside this one.
///
/// HONEST LIMIT — ENFORCED AT PURCHASE, NOT AT LIST (identical to `character_listing_rule`). The Sui framework
/// exposes NO list-time hook: native `kiosk::list` is generic and a transfer policy fires ONLY at
/// `confirm_request` (purchase). So listing an amount-0 ghost is not itself blocked — but the sale can never
/// complete, which is ECONOMICALLY EQUIVALENT. This is the only enforceable home for the gate.
///
/// EVASION GUARD — `prove_amount` asserts the proven `&Item` IS the one being transferred
/// (`object::id(item) == transfer_policy::item(request)`), so a buyer purchasing an amount-0 ghost cannot satisfy
/// the receipt by passing a DIFFERENT non-zero stack they happen to own (the wrong-object / royalty-evasion class,
/// closed by construction like `character_listing_rule`'s EWrongCharacter and the extract seam's pledge-id check).
///
/// CEREMONY — the `TransferPolicyCap<Item>` holder adds this rule to the Item policy at the coordinated publish,
/// alongside the Mysten rules (royalty / kiosk_lock / personal_kiosk), while the package is DARK:
///
///     item_listing_rule::add(&mut item_policy, &item_policy_cap);
///
/// A secondary buy PTB then satisfies this receipt (`prove_amount`) beside the Mysten receipts before
/// `confirm_request`. The shop's initial mint-lock and the pool's mint-lock BYPASS `confirm_request` (they `lock`,
/// never `purchase`), so the gate never blocks a first acquisition — spec-correct, a freshly-minted stack is the
/// buyer's own to lock. The extraction seam (`extract`) confirms against its OWN wrapped empty policy, never this
/// one, so equip/burn/merge extraction is unaffected.
module aresrpg::item_listing_rule;

use aresrpg::item::{Self, Item};
use sui::transfer_policy::{Self, TransferPolicy, TransferPolicyCap, TransferRequest};

// ╔════════════════ [ Errors (teach, don't reject) ] ═════════════════════════ ]

const EZeroAmount: u64 = 101; // prove_amount: the item being purchased carries 0 units (a ghost instance)
const EWrongItem: u64 = 102; // prove_amount: the proven item is not the one being purchased (evasion guard)

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The rule witness that authorises this policy rule (Mysten `royalty_rule::Rule` shape). `drop` only — it names
/// the rule to the framework's `add_rule` / `add_receipt`; it is never stored or transferred.
public struct Rule has drop {}

/// The rule's on-policy config — EMPTY on purpose: the gate reads the item's OWN amount at prove time, so nothing
/// is baked in here and no dial is needed. `store + drop` as the framework requires.
public struct Config has store, drop {}

// ╔════════════════ [ Creator action — ADD the rule (cap-gated; ceremony, while dark) ] ═ ]

/// Attach the zero-amount gate to the Item `policy`. Authority IS the `TransferPolicyCap<Item>` — the framework
/// `add_rule` asserts the cap matches the policy and that the rule is not already present. Mirrors
/// `royalty_rule::add` / `character_listing_rule::add`: one line, cap-gated, no runtime config.
public fun add(policy: &mut TransferPolicy<Item>, cap: &TransferPolicyCap<Item>) {
  transfer_policy::add_rule(Rule {}, policy, cap, Config {});
}

// ╔════════════════ [ Buyer action — PROVE the amount is non-zero to unblock confirm_request ] ═ ]

/// Prove the purchased `item` carries at least 1 unit and add the receipt that unblocks `confirm_request`. Aborts
/// `EWrongItem` if the proven item is not the one being transferred (the evasion guard — a buyer cannot substitute
/// a different non-zero stack they own) and `EZeroAmount` if the item is a ghost (amount 0). Called by the
/// secondary-purchase PTB after `kiosk::purchase` hands over the item by value; the buyer already holds `&Item`.
public fun prove_amount(item: &Item, request: &mut TransferRequest<Item>) {
  assert!(object::id(item) == transfer_policy::item(request), EWrongItem);
  assert!(item::amount(item) > 0, EZeroAmount);
  transfer_policy::add_receipt(Rule {}, request);
}
