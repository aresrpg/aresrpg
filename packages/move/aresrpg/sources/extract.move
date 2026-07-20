// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// EXTRACT — the TWO-FLAVOR seam that pulls a kiosk-LOCKED item back out for the two legitimate reasons an item
/// leaves the market: to be WORN by a character, or to be DESTROYED. Both are royalty-safe by CONSTRUCTION, not by
/// trust (DECISIONS 2026-07-08 "Extract-seam ruling").
///
/// THE PROBLEM. Every item is force-locked into a PERSONAL kiosk at birth (the `LockPledge` constitution). A
/// locked item can leave a kiosk ONLY via `list` → `purchase` → `confirm_request` against a `TransferPolicy<Item>`
/// (the framework has no `take` for locked items — that is the whole point of the lock). The marketplace policy
/// carries the kiosk-lock rule (a purchaser MUST re-lock) + the 10% royalty rule, so a normal trade always pays
/// royalty and stays locked. But EQUIP and BURN are not trades — the item must come fully OUT — so they cannot
/// satisfy the lock rule. This module is the modern, in-package equivalent of the legacy `protected_policy`
/// zero-price trick, made royalty-safe by a hot-potato pledge instead of a hidden admin cap.
///
/// THE MECHANISM. Each flavor runs the zero-price flow (`list` at 0 → `purchase` with a zero coin → confirm) and
/// hands back the raw `Item` PLUS an ABILITYLESS pledge:
///   • EQUIP:   `extract_for_equip` → (Item, `EquipPledge`). The pledge is consumed ONLY by `confirm_equip`, which
///     re-attaches the item as a dynamic field UNDER a kiosk-locked character (§1's "second state") via the package-private
///     `extension::add_character_field` (`NS_CHARACTER_EQUIPMENT` namespace — S-46: `public(package)` is the gate, not a cap). `unequip` reverses it, returning a `LockPledge` that FORCES a
///     personal-kiosk re-lock (the constitution re-imposed on the way back).
///   • BURN:    `extract_for_burn` → (Item, `BurnPledge`). The pledge is consumed ONLY by `burn`, which DESTROYS
///     the item and returns `(template_id, amount)` — via the package-private `item::destroy`; the abilityless
///     `BurnPledge` (discharged in-PTB) is the real gate, no cap. The callers
///     act on the return: pools credit the ledger, crush mints runes, pet-feed grows the pet.
///
/// WHY NO ROYALTY EVASION (the type argument — this IS the R-02 evasion probe). A pledge has NO abilities (no
/// drop/store/key/copy), so a raw extracted `Item` can NEVER be walked off to an address. The only discharge paths
/// are `confirm_equip` (the matching item lands on a locked character) and `burn` (the matching item ceases to
/// exist); both validate the pledged item id, and only this module can construct a pledge. Calling a public extract
/// door without completing one of those terminal paths leaves an abilityless value, so the tx aborts and extraction
/// reverts. The DIRECT attack (list-purchase-confirm your own locked item to free it) is impossible too:
/// the empty extraction `TransferPolicy<Item>` is WRAPPED inside `ItemExtractPolicy`, so no raw `&TransferPolicy
/// <Item>` ever escapes this module — the only publicly-referenceable policy is the marketplace one, whose lock
/// rule blocks the escape. NO function here `transfer`s an `Item` to an address; grep the package to confirm.
///
/// CEREMONY IMPLICATION (what the publish PTB needs). The item type gets TWO policies: (1) the MARKETPLACE policy
/// from `item::create_item_policy` — the ceremony binds kiosk-lock + 10% royalty (+ personal-kiosk) rules; used by
/// `shop::buy` and secondary kiosk listings. (2) the EXTRACTION policy from `create_extract_policy` here — a
/// permanently EMPTY, wrapped `TransferPolicy<Item>` (its cap is sealed inside the wrapper, so no rule can ever be
/// added). It is safe empty precisely because it is wrapped + pledge-gated. No extension caps are handed out (S-46
/// dissolved them): public composition sees only abilityless pledges; the storage/destroy primitives remain
/// package-private inside the merged core.
module aresrpg::extract;

use aresrpg::{
  character::Character,
  extension,
  item::{Self, Item, LockPledge},
  lot_rule,
  version::Version
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{
  coin,
  event,
  kiosk::Kiosk,
  package::Publisher,
  sui::SUI,
  transfer_policy::{Self, TransferPolicy, TransferPolicyCap}
};

// ╔════════════════ [ Constants ] ════════════════════════════════════════════ ]

const EPledgeMismatch: u64 = 101; // confirm_equip / burn: the pledge's item id != the passed item id
const ESameStack: u64 = 102; // merge_locked_stacks: target and source are the same object (nothing to fold)

// ╔════════════════ [ Types ] ════════════════════════════════════════════════ ]

/// The WRAPPED extraction policy. The inner `policy` is a permanently rule-less `TransferPolicy<Item>` and `cap`
/// is its `TransferPolicyCap<Item>` — SEALED inside with no accessor, so no rule can ever be added and the policy
/// stays confirmable-with-no-receipts forever. Neither field is ever exposed: only `extract_locked` (this module)
/// reaches `&self.policy` to confirm the zero-price request. Because a raw `&TransferPolicy<Item>` never escapes,
/// no external code can confirm a hand-rolled `TransferRequest<Item>` against it (the royalty-evasion path). `key`
/// only — shared, never wrapped or moved.
public struct ItemExtractPolicy has key {
  id: UID,
  policy: TransferPolicy<Item>,
  cap: TransferPolicyCap<Item>,
}

/// The EQUIP hot potato — NO abilities. Carries the id of the extracted item; the ONLY consumer is `confirm_equip`
/// (attach onto a character). Cannot be dropped/stored/transferred, so the compiler forces the extracted item onto
/// a kiosk-locked character in the SAME PTB.
public struct EquipPledge { item_id: ID }

/// The BURN hot potato — NO abilities. Carries the id of the extracted item; the ONLY consumer is `burn` (destroy).
/// Cannot escape, so the extracted item is destroyed in the SAME PTB — it never reaches a raw address.
public struct BurnPledge { item_id: ID }

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct ItemEquipped has copy, drop { character: ID, item: ID, template: ID, amount: u64 }

public struct ItemUnequipped has copy, drop { character: ID, item: ID, template: ID, amount: u64 }

public struct ItemBurned has copy, drop { item: ID, template: ID, amount: u64 }

public struct ExtractPolicyCreated has copy, drop { policy: ID }

/// A locked `source` stack folded into a locked `target` stack (both in one personal kiosk). `added` = units moved
/// off `source` (now deleted); `total` = `target`'s new amount. The refill/dedup door's receipt (§11 merge-door).
public struct StacksMerged has copy, drop { target: ID, source: ID, added: u64, total: u64 }

// ╔════════════════ [ Extraction policy — Publisher gated (ceremony creates it) ] ═ ]

/// Create + SHARE the wrapped, permanently-EMPTY extraction policy (authority IS the `Publisher`, version-gated so
/// it is authored at ceremony while dark). The returned `TransferPolicyCap<Item>` is SEALED inside the wrapper
/// (never handed out), so the inner policy can never gain a rule — it confirms the zero-price extraction request
/// with no receipts, forever. Distinct from the marketplace `item::create_item_policy`; see the module CEREMONY note.
public fun create_extract_policy(publisher: &Publisher, version: &Version, ctx: &mut TxContext) {
  version.assert_latest();
  let (policy, cap) = transfer_policy::new<Item>(publisher, ctx);
  let wrapper = ItemExtractPolicy { id: object::new(ctx), policy, cap };
  event::emit(ExtractPolicyCreated { policy: object::id(&wrapper) });
  transfer::share_object(wrapper);
}

// ╔════════════════ [ The zero-price extraction (private — the ONLY confirm against the wrapped policy) ] ═ ]

/// Pull a kiosk-LOCKED item OUT via the policy-compliant zero-price flow: list at price 0, purchase with a zero
/// coin, and CONFIRM the resulting `TransferRequest<Item>` against the WRAPPED empty policy (no rules → no
/// receipts needed). `list` aborts (`EItemNotFound`) unless the caller's kiosk actually holds the item, so a caller
/// can only extract items from a kiosk they hold the cap to. This is the sole site that reads `&self.policy` — the
/// wrapping is what keeps this confirm unreachable to any hand-rolled request (royalty-evasion barrier).
fun extract_locked(
  self: &ItemExtractPolicy,
  kiosk: &mut Kiosk,
  personal_cap: &PersonalKioskCap,
  item_id: ID,
  ctx: &mut TxContext,
): Item {
  let owner_cap = personal_kiosk::borrow(personal_cap);
  kiosk.list<Item>(owner_cap, item_id, 0);
  let (item, mut request) = kiosk.purchase<Item>(item_id, coin::zero<SUI>(ctx));
  // The sweep stays explicit at every Item confirmation, while this branch remains false for the sealed empty
  // extraction policy. A receipt against that zero-rule policy would make confirm_request reject the request.
  if (transfer_policy::has_rule<Item, lot_rule::Rule>(&self.policy)) {
    lot_rule::prove(&item, &mut request);
  };
  let (_id, _paid, _from) = self.policy.confirm_request(request);
  item
}

// ╔════════════════ [ Flavor 1 — EQUIP (item survives, lands on a kiosk-locked character) ] ═ ]

/// EQUIP-extract: pull the locked item out and return it with an `EquipPledge` that can ONLY be discharged by
/// `confirm_equip`. Value path — `assert_enabled` gated. The item is NOT free: the abilityless pledge forces it
/// onto a character (needing the equipment cap) in the same PTB, or the tx aborts and the extraction reverts.
public fun extract_for_equip(
  kiosk: &mut Kiosk,
  personal_cap: &PersonalKioskCap,
  item_id: ID,
  policy: &ItemExtractPolicy,
  version: &Version,
  ctx: &mut TxContext,
): (Item, EquipPledge) {
  version.assert_enabled();
  let item = extract_locked(policy, kiosk, personal_cap, item_id, ctx);
  let extracted_id = object::id(&item);
  (item, EquipPledge { item_id: extracted_id })
}

/// Discharge an `EquipPledge` by ATTACHING the item onto `character` as a dynamic field under the EQUIPMENT
/// namespace, keyed by the item's own id (so `unequip` can find it). Package-gated, not cap-gated (S-46): the write
/// goes through the `public(package)` `extension::add_character_field` under the `NS_CHARACTER_EQUIPMENT` namespace —
/// reachable only by sibling aresrpg modules, and version-gates (assert_enabled) inside it. The item now lives ON the
/// kiosk-locked character (§1's second state) — still no raw-address path.
public fun confirm_equip(
  pledge: EquipPledge,
  item: Item,
  character: &mut Character,
  version: &Version,
) {
  let EquipPledge { item_id } = pledge;
  assert!(item_id == object::id(&item), EPledgeMismatch);
  let template = item::template(&item);
  let amount = item::amount(&item);
  let character_id = object::id(character);
  extension::add_character_field(extension::ns_character_equipment(), character, item_id, item, version);
  event::emit(ItemEquipped { character: character_id, item: item_id, template, amount });
}

/// Reverse of `confirm_equip`: DETACH the item (stored under `key` = its id) from `character` and return it with a
/// `LockPledge` that FORCES a personal-kiosk re-lock — the constitution re-imposed the moment the item leaves the
/// character. Package-gated (S-46 — no cap): the read/remove is `public(package)` under the `NS_CHARACTER_EQUIPMENT` namespace and version-gates
/// inside `extension::remove_character_field`.
public fun unequip(
  character: &mut Character,
  key: ID,
  version: &Version,
): (Item, LockPledge) {
  let item: Item = extension::remove_character_field(extension::ns_character_equipment(), character, key, version);
  let item_id = object::id(&item);
  event::emit(ItemUnequipped {
    character: object::id(character),
    item: item_id,
    template: item::template(&item),
    amount: item::amount(&item),
  });
  (item, item::new_lock_pledge(item_id))
}

// ╔════════════════ [ Flavor 2 — CONSUME (item ceases to exist) ] ═════════════ ]

/// CONSUME-extract: pull the locked item out and return it with a `BurnPledge` that can ONLY be discharged by
/// `burn`. Value path — `assert_enabled` gated. The item is NOT free: the abilityless pledge forces its destruction
/// through the matching-pledge burn door in the same PTB, or the tx aborts and the extraction reverts.
public fun extract_for_burn(
  kiosk: &mut Kiosk,
  personal_cap: &PersonalKioskCap,
  item_id: ID,
  policy: &ItemExtractPolicy,
  version: &Version,
  ctx: &mut TxContext,
): (Item, BurnPledge) {
  version.assert_enabled();
  let item = extract_locked(policy, kiosk, personal_cap, item_id, ctx);
  let extracted_id = object::id(&item);
  (item, BurnPledge { item_id: extracted_id })
}

/// Split exactly ONE unit out of a kiosk-locked stack for an immediate burn while preserving the original stack
/// id as the locked remainder. The public boundary is identical to `extract_for_burn`: only `(Item,
/// BurnPledge)` escapes, so the unit cannot be transferred or stored and must be destroyed in this PTB.
///
/// For a multi-unit stack, both values created by `item::split` are first re-locked under the sealed extraction
/// policy: the original object (now the remainder) gets a fresh `LockPledge`, and the one-unit child consumes the
/// pledge returned by `split`. The child is then immediately re-extracted through `extract_locked`. Thus EVERY
/// surviving item is kiosk-locked when this call returns; only the burn-bound unit is transiently outside.
/// Keeping the remainder's original id also lets one PTB repeat this call N times against one owned key stack.
public fun extract_one_for_burn(
  kiosk: &mut Kiosk,
  personal_cap: &PersonalKioskCap,
  item_id: ID,
  policy: &ItemExtractPolicy,
  version: &Version,
  ctx: &mut TxContext,
): (Item, BurnPledge) {
  version.assert_enabled();
  let mut remainder = extract_locked(policy, kiosk, personal_cap, item_id, ctx);
  if (item::amount(&remainder) == 1) {
    let unit_id = object::id(&remainder);
    (remainder, BurnPledge { item_id: unit_id })
  } else {
    let (unit, unit_lock) = item::split(&mut remainder, 1, ctx);
    let remainder_id = object::id(&remainder);
    let unit_id = object::id(&unit);
    let owner_cap = personal_kiosk::borrow(personal_cap);

    // KIOSK-LOCK CONSTITUTION: EVERY item stays kiosk-locked. Neither half crosses a public boundary unlocked;
    // `policy.policy` remains sealed inside this module and the burn-bound child is immediately re-extracted.
    item::lock_in_kiosk(item::new_lock_pledge(remainder_id), remainder, kiosk, owner_cap, &policy.policy);
    item::lock_in_kiosk(unit_lock, unit, kiosk, owner_cap, &policy.policy);
    let unit = extract_locked(policy, kiosk, personal_cap, unit_id, ctx);
    (unit, BurnPledge { item_id: unit_id })
  }
}

/// The BURN door — discharges a `BurnPledge` by DESTROYING the item, returning what died: `(template_id,
/// amount)`. Pledge-gated, not cap-gated (S-46): the abilityless `BurnPledge` forces in-PTB discharge, and `item::destroy`
/// is `public(package)` — an external package can neither forge a pledge nor call destroy. Value path — `assert_enabled` gated.
/// The item CEASES TO EXIST, so it can never be resold ⇒ no royalty evasion; the callers (pool ledger credit,
/// crush→runes, pet feed) act on the return.
public fun burn(pledge: BurnPledge, item: Item, version: &Version): (ID, u64) {
  version.assert_enabled();
  let BurnPledge { item_id } = pledge;
  assert!(item_id == object::id(&item), EPledgeMismatch);
  let template = item::template(&item);
  let amount = item::amount(&item);
  item::destroy(item);
  event::emit(ItemBurned { item: item_id, template, amount });
  (template, amount)
}

// ╔════════════════ [ Flavor 3 — MERGE (two locked stacks fold into one — the refill/dedup door) ] ═ ]

/// MERGE-extract: fold locked stack `source_id` INTO locked stack `target_id`, returning the grown `target` with a
/// `LockPledge` that FORCES a personal-kiosk re-lock. THE stack-merge door (the ghost-zero-refill design):
/// a heavy gatherer's many one-per-gather stacks collapse into one object, and a pool BUY refills a
/// player's existing stack (mint fresh → merge here) instead of leaving a second NFT — object COUNT stays 1 per
/// template, killing the ~0.77 SUI/day storage bloat.
///
/// INVARIANTS (a pure-item value path — NO SUI leg, so NO royalty applies; it is not a trade):
///   • NEVER CROSS-OWNER — both stacks are pulled from the SAME `kiosk` under the SAME `personal_cap`, and one
///     PersonalKioskCap authorises exactly one personal kiosk (one owner). No parameter can name a second kiosk, so
///     value can never move between owners here — the royalty-choke bypass class is closed by construction.
///   • NEVER CROSS-TEMPLATE — `item::merge` aborts `ETemplateMismatch` unless the two stacks share a template id
///     (and `ENotStackable` for a non-stackable category — gear never folds).
///   • AMOUNT CONSERVED, NO VALUE CREATED — `item::merge` sets `target.amount += source.amount` and DELETES
///     `source`; the sum is exact and a u64 overflow ABORTS natively (never wraps), so no units are minted or lost.
///   • DISTINCT STACKS — `target_id != source_id` (`ESameStack`): the same id cannot be double-extracted (the second
///     `list` would abort opaquely), and folding an object into itself is a caller bug, refused with a clear code.
/// Value path — `assert_enabled` gated. The returned `LockPledge`'s only consumer is `item::lock_in_kiosk`, so the
/// grown target is TYPE-FORCED back into the personal kiosk in the same PTB (the lock constitution re-imposed).
public fun merge_locked_stacks(
  kiosk: &mut Kiosk,
  personal_cap: &PersonalKioskCap,
  target_id: ID,
  source_id: ID,
  policy: &ItemExtractPolicy,
  version: &Version,
  ctx: &mut TxContext,
): (Item, LockPledge) {
  version.assert_enabled();
  assert!(target_id != source_id, ESameStack);
  let mut target = extract_locked(policy, kiosk, personal_cap, target_id, ctx);
  let source = extract_locked(policy, kiosk, personal_cap, source_id, ctx);
  let added = item::amount(&source);
  item::merge(&mut target, source); // asserts same template + stackable; adds source's units, deletes source
  let merged_id = object::id(&target);
  event::emit(StacksMerged { target: merged_id, source: source_id, added, total: item::amount(&target) });
  (target, item::new_lock_pledge(merged_id))
}

/// Split `amount` units from one stack already locked in `kiosk`, then immediately lock BOTH the original remainder
/// and the new child back into that SAME personal kiosk under the marketplace policy. This is the free stack-shaping
/// door: no Coin/SUI parameter, no fee, and no raw `Item` crosses the public boundary. `item::split` supplies the
/// arithmetic guards (stackable category, non-zero take, non-zero remainder) and its child `LockPledge`; this wrapper
/// adds a pledge for the surviving source and discharges both through `item::lock_in_kiosk`, preserving the kiosk-lock
/// constitution on each half. Returns the new child's id so a PTB/UI can select the shaped lot immediately.
public fun split_locked_stack(
  kiosk: &mut Kiosk,
  personal_cap: &PersonalKioskCap,
  item_id: ID,
  amount: u64,
  extract_policy: &ItemExtractPolicy,
  marketplace_policy: &TransferPolicy<Item>,
  version: &Version,
  ctx: &mut TxContext,
): ID {
  version.assert_enabled();
  let mut source = extract_locked(extract_policy, kiosk, personal_cap, item_id, ctx);
  let (child, child_pledge) = item::split(&mut source, amount, ctx);
  let source_id = object::id(&source);
  let child_id = object::id(&child);
  let owner_cap = personal_kiosk::borrow(personal_cap);

  item::lock_in_kiosk(item::new_lock_pledge(source_id), source, kiosk, owner_cap, marketplace_policy);
  item::lock_in_kiosk(child_pledge, child, kiosk, owner_cap, marketplace_policy);
  child_id
}

/// Fold `source_id` into `target_id` and immediately re-lock the conserved result in the SAME personal kiosk. Reuses
/// `merge_locked_stacks` for extraction, same-owner/template/stackability guards, arithmetic, source deletion and the
/// re-lock pledge; this additive convenience door merely discharges that pledge before returning. No Coin/SUI
/// parameter means shaping is free, and the only surviving `Item` never escapes the kiosk-lock constitution.
public fun merge_locked_stacks_and_relock(
  kiosk: &mut Kiosk,
  personal_cap: &PersonalKioskCap,
  target_id: ID,
  source_id: ID,
  extract_policy: &ItemExtractPolicy,
  marketplace_policy: &TransferPolicy<Item>,
  version: &Version,
  ctx: &mut TxContext,
): ID {
  let (merged, pledge) = merge_locked_stacks(kiosk, personal_cap, target_id, source_id, extract_policy, version, ctx);
  let merged_id = object::id(&merged);
  item::lock_in_kiosk(pledge, merged, kiosk, personal_kiosk::borrow(personal_cap), marketplace_policy);
  merged_id
}
