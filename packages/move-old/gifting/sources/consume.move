// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// CONSUME — the fight-side entry for USING a consumable (SPEC §10). Placement follows the AUTHORITY, not the
/// name: a heal writes the character's PERSISTENT HP under NS_CHARACTER_PROGRESSION, whose ONE `ExtensionCap` is
/// custodied in THIS package's `FightRegistry` (the `results::open` / `character_link::write_back_hp` precedent);
/// and the burn flows through game's cap-gated doors. `aresrpg_game` cannot compose burn + progression (it holds
/// neither a dependency on fight nor the progression cap); `aresrpg_fight` can (it depends on game + items and
/// custodies the cap). So the consume ENTRY lives here, borrowing the cap into `character_link::heal_hp` exactly as
/// `results::open` borrows it into `grant_fight_xp` / `write_back_hp`.
///
/// v1 = HEAL only. The other frozen §10 effect kinds (stat_reset / spell_reset / bag_open / gacha_roll) abort
/// `EUnsupportedEffect` — their targets (a stat-point ledger, a bag-contents table) are unbuilt DFs (the S-14
/// delivered map). A character in a LIVE fight cannot drink (the S-12f latch: `fight_latch::character_fight`) — HP is
/// the fight's to write while it runs. NO `&Random` anywhere: HEAL is deterministic, and SPEC §10 forbids a second
/// Random consumer in one tx — so `use_many(quantity)` is ONE call that heals the batched magnitude (the debounce).
module aresrpg_gifting::consume;

use aresrpg::version::Version;
use aresrpg::{character_link, config::GameConfig};
use aresrpg::{consumable_effect, extract::ItemExtractPolicy, item::{Self, Item, ItemTemplate}, version::Version as ItemsVersion};
use kiosk::personal_kiosk::{Self, PersonalKioskCap};
use sui::{clock::Clock, event, kiosk::Kiosk, transfer_policy::TransferPolicy};
use aresrpg_gifting::gifting;

// ╔════════════════ [ Errors ] ═══════════════════════════════════════════════ ]

const ECharacterInFight: u64 = 101; // the character is seated in a LIVE fight (S-12f) — HP is the fight's to write
const ENotConsumable: u64 = 102; // the template carries no consumable effect DF (not a consumable / none attached)
const EUnsupportedEffect: u64 = 103; // v1 supports HEAL only — the other frozen §10 kinds have no target yet
const EZeroQuantity: u64 = 104; // use_many(0) — nothing to use (blocked when pointless)
const ELevelTooLow: u64 = 105; // the character's level is below the consumable template's required level

// ╔════════════════ [ Events ] ═══════════════════════════════════════════════ ]

public struct ConsumableUsed has copy, drop { character: ID, template: ID, quantity: u64, effect_kind: u8, healed: u64 }

// ╔════════════════ [ Entries ] ══════════════════════════════════════════════ ]

/// Use ONE unit of the consumable — `use_many` with quantity 1 (the single-tap convenience entry).
entry fun use_consumable(
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  item_id: ID,
  template: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  market_policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  items_version: &ItemsVersion,
  clock: &Clock,
  ctx: &mut TxContext,
) {
  use_internal(kiosk, pkcap, character_id, item_id, template, xpolicy, market_policy, config, version, items_version, clock, 1, ctx);
}

/// Use `quantity` units in ONE tx (SPEC §10 multi-use debounce — a single heal of the batched magnitude, no
/// per-unit transaction). Burns exactly `quantity` units and applies the effect × `quantity`.
entry fun use_many(
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  item_id: ID,
  template: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  market_policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  items_version: &ItemsVersion,
  clock: &Clock,
  quantity: u64,
  ctx: &mut TxContext,
) {
  use_internal(kiosk, pkcap, character_id, item_id, template, xpolicy, market_policy, config, version, items_version, clock, quantity, ctx);
}

// ╔════════════════ [ The shared value path ] ════════════════════════════════ ]

fun use_internal(
  kiosk: &mut Kiosk,
  pkcap: &PersonalKioskCap,
  character_id: ID,
  item_id: ID,
  template: &ItemTemplate,
  xpolicy: &ItemExtractPolicy,
  market_policy: &TransferPolicy<Item>,
  config: &GameConfig,
  version: &Version,
  items_version: &ItemsVersion,
  clock: &Clock,
  quantity: u64,
  ctx: &mut TxContext,
) {
  config.assert_enabled(); // the GLOBAL game freeze
  version.assert_enabled(); // this package's dark-ship + upgrade single-path
  assert!(quantity >= 1, EZeroQuantity);
  // S-12f: HP belongs to the fight while one runs — no drinking mid-fight (the multi-fight stale-HP vector).
  // S-46 final split: the mid-fight gate is the DIRTY MARKER (core state — set at every PvM seat, cleared at
  // open). PvP never marks AND never reads the real body (ephemeral copies), so a mid-PvP drink is harmless
  // by construction — the marker covers exactly the fights whose HP belongs to the fight (§ S-12f intent).
  {
    let chr = kiosk.borrow<aresrpg::character::Character>(personal_kiosk::borrow(pkcap), character_id);
    assert!(aresrpg::fight::is_unmarked(chr), ECharacterInFight);
  };

  // read + DISPATCH the effect off the template DF (its on-chain home). v1 handles HEAL only.
  assert!(consumable_effect::has_effect(template), ENotConsumable);
  let effect = consumable_effect::effect(template);
  let kind = consumable_effect::kind(effect);
  assert!(kind == consumable_effect::heal(), EUnsupportedEffect);
  let healed = consumable_effect::amount(effect) * quantity;

  // Apply the HEAL first (one character borrow: level gate + heal) — heal_hp aborts on full-HP (blocked when
  // pointless, SPEC §10) and the level gate aborts under-level, BEFORE any burn. The whole tx is atomic, so a
  // later burn abort (e.g. quantity > stack) un-does the heal too: no heal without an equal burn, ever.
  {
    let owner_cap = personal_kiosk::borrow(pkcap);
    let character = kiosk.borrow_mut(owner_cap, character_id);
    assert!(character_link::level(character) >= (item::template_level(template) as u64), ELevelTooLow);
    character_link::heal_hp_brand(gifting::brand(), config, character, healed, clock.timestamp_ms(), items_version);
  };

  // Burn exactly `quantity` units through the consumable door (extract → burn-all → re-mint remainder).
  gifting::burn_units(config, template, quantity, item_id, kiosk, pkcap, xpolicy, market_policy, items_version, ctx);

  event::emit(ConsumableUsed { character: character_id, template: item::template_id(template), quantity, effect_kind: kind, healed });
}
