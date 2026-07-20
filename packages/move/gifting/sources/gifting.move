/// GIFTING — the witness + shared item-burn helper for the `aresrpg_gifting` satellite package (package-split
/// 2026-07-13). This module owns the ONE brand witness the whole package authenticates with, and the single home
/// of the fungible burn-all + re-mint-remainder path that `loot_box` and `consume` share.
///
/// THE BRAND (mirrors forgemagie's `Forge`): `GameConfig.gifting_brand` pins `type_name::get<Gifting>()` at the
/// ceremony, and the gifting-branded core value doors (`character_link::mint_and_lock_output_brand` /
/// `heal_hp_brand` / `character::new_brand`) refuse every witness but this one. FENCE: the constructor is
/// `public(package)` — only aresrpg_gifting modules mint the witness, so no other package can drive those doors,
/// and `none` (the init default) keeps them CLOSED until the admin pins the witness post-publish.
///
/// WHY THE BURN HELPER LIVES HERE, NOT IN CORE: core's own `character_link::consume_units` stays FORGE-only (the
/// scribe's rune burn); re-branding it for gifting would add a second core door against a shrinking cap. Instead
/// the sibling reimplements the exact burn-all + re-mint-remainder over the PUBLIC `extract` doors + the gifting
/// mint door — ZERO extra core bytes (the whole point of the split), single-homed for the two callers here.
module aresrpg_gifting::gifting;

use aresrpg::{
  character_link,
  config::GameConfig,
  extract::{Self, ItemExtractPolicy},
  item::{Self, Item, ItemTemplate},
  version::Version
};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{kiosk::Kiosk, transfer_policy::TransferPolicy};

// ╔════════════════ [ The brand witness (core's gifting `*_brand` doors key on this) ] ═ ]

/// THE gifting witness. Pinned in `GameConfig.gifting_brand`; the gifting-branded core doors assert it. NO public
/// constructor — `brand()` is `public(package)`, so only sibling modules in THIS package can mint it.
public struct Gifting has drop {}

/// The package-scoped witness constructor. `public(package)` is the fence: exactly the aresrpg_gifting modules
/// (airdrop / loot_box / consume / pool / creation) mint the brand to drive their core doors; no external package can.
public(package) fun brand(): Gifting { Gifting {} }

// ╔════════════════ [ Shared burn-all + re-mint-remainder (loot_box + consume) ] ═ ]

const EConsumeTemplateMismatch: u64 = 106; // burn_units: the passed template != the extracted item's template
const EConsumeExceedsStack: u64 = 107; // burn_units: units requested exceeds the stack's amount
const EZeroConsume: u64 = 108; // burn_units: a consume must burn at least 1 unit

/// CONSUME exactly `units` from a kiosk-LOCKED FUNGIBLE stack (`item_id`), returning the burned template id.
/// MECHANISM (net-identical to core's `consume_units`, over PUBLIC doors): extract the whole stack, BURN it, and —
/// when it held MORE than `units` — RE-MINT the remainder as a fresh stack + re-lock it through the gifting mint
/// brand door (the `LockPledge` inside forces the kiosk lock). Net supply change = −`units`. The passed `template`
/// is ASSERTED equal to the extracted item's template (`EConsumeTemplateMismatch`).
public(package) fun burn_units(
  config: &GameConfig,
  template: &ItemTemplate,
  units: u64,
  item_id: ID,
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  xpolicy: &ItemExtractPolicy,
  market_policy: &TransferPolicy<Item>,
  version: &Version,
  ctx: &mut TxContext,
): ID {
  let (item, pledge) = extract::extract_for_burn(kiosk, pkcap, item_id, xpolicy, version, ctx);
  let amount = item::amount(&item);
  assert!(item::template(&item) == item::template_id(template), EConsumeTemplateMismatch);
  assert!(units >= 1, EZeroConsume);
  assert!(units <= amount, EConsumeExceedsStack);
  let (tid, _burned) = extract::burn(pledge, item, version);
  let remainder = amount - units;
  if (remainder >= 1) {
    character_link::mint_and_lock_output_brand(brand(), config, template, remainder, version, kiosk, personal_kiosk::borrow(pkcap), market_policy, ctx);
  };
  tid
}
