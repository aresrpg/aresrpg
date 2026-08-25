// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/// The admin surface: Display creation and marketplace policy creation ONLY — Publisher
/// possession is the gate. The ONE AdminCap type lives in the control package and is reused
/// by seed and core; this module never mints another authority.
module aresrpg::admin;

use aresrpg::{character::{Self, Character}, item::{Self, Item}};
use sui::{display_registry::{Self, DisplayRegistry}, package::Publisher};

// ╔════════════════ [ Display creation (seeding, once) ] ═════════════════════ ]
// The marketplace policies (protected + royalty/lock) are minted by the seeding PTB —
// protected_policy::mint_and_share + the kiosk SDK's rule installers — never from here.

public fun create_character_display(
  registry: &mut DisplayRegistry,
  publisher: &mut Publisher,
  ctx: &mut TxContext,
): display_registry::DisplayCap<Character> {
  character::nd(registry, publisher, ctx)
}

public fun create_item_display(
  registry: &mut DisplayRegistry,
  publisher: &mut Publisher,
  ctx: &mut TxContext,
): display_registry::DisplayCap<Item> {
  item::nd(registry, publisher, ctx)
}
