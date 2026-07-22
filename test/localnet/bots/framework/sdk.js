// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SDK BUILDER BARREL — the single home for the cross-package relative imports of the @aresrpg/sdk PTB
// builder factories the bots drive. Relative import of the SDK *source* works from test/ (proven): the SDK
// files resolve their own @mysten deps from packages/sdk/node_modules, so no root wiring is needed. If track 1
// later makes `@aresrpg/sdk` resolvable by bare specifier from test/, only THIS file changes.
//
// LAW (task constraint): bots CALL these builders — they never hand-build a raw PTB. Every builder is a
// context-bound factory `builder(context) => (args) => Transaction`. We import the raw factories (NOT the
// SDK() mega-factory, which also constructs testnet-pinned grpc/graphql clients we don't want on localnet).

// creation + onboarding (needs context.kiosk_client)
export {
  onboard_kiosk_ptb,
  create_character_free_ptb,
  create_character_paid_ptb,
} from '../../../../packages/sdk/src/sui/write/items_creation.js'

// world flows (join / search / gather) — game.js is the public per-domain home (re-exports game_world.js)
export { join_world_ptb, search_zone_ptb, gather_ptb } from '../../../../packages/sdk/src/game.js'

// forgemagie (crush + scribe) — game.js re-exports both
export { crush_ptb, scribe_rune_ptb } from '../../../../packages/sdk/src/game.js'

// crafting (single-tx exact-ingredient)
export { craft_ptb } from '../../../../packages/sdk/src/sui/write/craft.js'

// item shop (terminal &Random buy)
export { buy_ptb, buy_many_ptb } from '../../../../packages/sdk/src/sui/write/items_shop.js'

// extract seam (equip / unequip / burn)
export { equip_ptb, unequip_ptb, burn_ptb } from '../../../../packages/sdk/src/sui/write/items_extract.js'

// kiosk P2P marketplace (the public SDK owns listing, lot validation, royalty receipts, and kiosk-lock purchase)
export {
  list_ptb,
  list_stack_ptb,
  delist_ptb,
  marketplace_buy_item_ptb,
} from '../../../../packages/sdk/src/sui/write/items_marketplace.js'

// Bonding-curve pools were removed from the current SDK lineage (d6d32bc). The driver's dormant pool methods
// remain for behavior compatibility, but the gold backend refuses that verb unless a pool fixture exists.

// fight lifecycle (create/join → place → commit_turn → settle+open → mint loot)
export {
  create_fight_ptb,
  join_fight_ptb,
  place_ptb,
  force_start_ptb,
  crank_ptb,
  act_move_ptb,
  act_weapon_ptb,
  act_cast_ptb,
  act_pass_ptb,
  commit_turn_ptb,
  abandon_fight_ptb,
  settle_fight_ptb,
  open_result_ptb,
  settle_and_take_ptb,
  open_taken_ptb,
  settle_open_world_ptb,
  settle_run_taken_ptb,
  mint_rolled_ptb,
  burn_result_ptb,
} from '../../../../packages/sdk/src/fight.js'

// dungeon lifecycle (activate → next_fight → settle_run / abandon)
export {
  activate_ptb,
  next_fight_ptb,
  join_fight_ptb as dungeon_join_fight_ptb,
  settle_run_ptb,
  abandon_ptb as dungeon_abandon_ptb,
} from '../../../../packages/sdk/src/dungeon.js'

// social (party create / invite / leave / disband)
export {
  create_party_ptb,
  party_invite_ptb,
  party_leave_ptb,
  party_disband_ptb,
} from '../../../../packages/sdk/src/social.js'

// keypair signer (bech32 suiprivkey1... -> { address, keypair, ... }) — the SDK's own headless signer
export { create_keypair_signer } from '../../../../packages/sdk/src/signer.js'
