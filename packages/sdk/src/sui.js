// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { KioskClient } from '@mysten/kiosk'
import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { LRUCache } from 'lru-cache'

import release from './deployment/release.json' with { type: 'json' }
import { aresrpg_id } from './deployment/aresrpg.js'
import { borrow_personal_kiosk_cap } from './sui/write/borrow_personal_kiosk_cap.js'
// S-51b JANITOR PASS: the 16 legacy `context.types` builders (character_new/character_update/explore_world/
// recall_character/equip_item/unequip_item/upgrade_spell/add_header/create_personal_kiosk/admin_* /
// buy_template_sale*) were DELETED — their Move targets (api/staking/character_spells/character_inventory/
// template_sale/header modules) were all verified ABSENT from packages/move/{aresrpg,engine}/sources; every
// live flow rides the S-57 per-domain builders below. (Same verify-target-absent-then-delete treatment the
// board-13 dungeon-combat builders got in S-57.)
// S-57 — the deployed S-46 fight/dungeon/kolizeum/game lifecycle on the CORE (`aresrpg`) + ENGINE (`aresrpg_fight`)
// split. Per-domain builders resolve ids lazily via deployment/aresrpg.js; the SDK `context` (network + kiosk_client)
// binds each. These REPLACE every dead legacy builder noted above.
import {
  create_fight_ptb,
  create_member_fight_ptb,
  join_fight_ptb,
  place_ptb,
  force_start_ptb,
  crank_ptb,
  act_move_ptb,
  act_weapon_ptb,
  act_cast_ptb,
  act_pass_ptb,
  commit_turn_ptb,
  settle_fight_ptb,
  open_result_ptb,
  settle_and_take_ptb,
  open_taken_ptb,
  settle_run_taken_ptb,
  release_group_ptb,
  settle_open_world_ptb,
  mint_rolled_ptb,
  burn_result_ptb,
} from './fight.js'
import {
  activate_ptb,
  activate_many_ptb,
  next_fight_ptb,
  join_fight_ptb as join_dungeon_fight_ptb,
  settle_run_ptb,
  abandon_ptb as abandon_run_ptb,
  get_run_pass,
} from './dungeon.js'
import {
  start_ptb as kolizeum_start_ptb,
  seat_ptb as kolizeum_seat_ptb,
  settle_ptb as kolizeum_settle_ptb,
  open_ptb as kolizeum_open_ptb,
  settle_arena_ptb as kolizeum_settle_arena_ptb,
  create_public_ptb as kolizeum_create_public_ptb,
  create_friends_only_ptb as kolizeum_create_friends_only_ptb,
  join_ptb as kolizeum_join_ptb,
  exit_ptb as kolizeum_exit_ptb,
  cancel_ptb as kolizeum_cancel_ptb,
  sweep_ptb as kolizeum_sweep_ptb,
  get_kolizeum,
} from './kolizeum.js'
import {
  raise_spell_level_ptb,
  feed_ptb,
  crush_ptb,
  scribe_rune_ptb,
  join_world_ptb,
  search_zone_ptb,
  gather_ptb,
} from './game.js'
import { get_user_kiosks } from './sui/read/get_user_kiosks.js'
import { get_royalty_fee } from './sui/read/get_royalty_fee.js'
import { get_supported_tokens } from './sui/read/get_supported_tokens.js'
import { get_expedition } from './sui/read/get_expedition.js'
import { HSUI, SUPPORTED_TOKENS } from './sui/supported_tokens.js'
import { ITEM_CATEGORY } from './items.js'
// S-16a — the aresrpg_items ITEMS surface: character creation + item shop PTBs and chain reads. Ids resolve
// LAZILY from ./deployment/items.js, so an un-stamped package never breaks SDK construction (only an actual
// create/buy/read against it refuses loudly).
import {
  onboard_kiosk_ptb,
  create_character_free_ptb,
  create_character_paid_ptb,
} from './sui/write/items_creation.js'
// S-52 — the single-tx exact-ingredient craft (crafting::craft). THE one craft home (game.js re-exports it).
import { craft_ptb } from './sui/write/craft.js'
// Artisan-commission v2 (commission::request/accept/execute/cancel/redeem_craft_xp). execute runs the craft on the
// customer's kiosk (terminal &Random, mint-locks internally like craft) — no marketplace buy tail.
import {
  commission_request_ptb,
  commission_accept_ptb,
  commission_execute_ptb,
  commission_cancel_ptb,
  commission_redeem_xp_ptb,
} from './sui/write/commission.js'
// #31 — the out-of-fight consumable USE (consume::use_many). Rapid clicks debounce to ONE call carrying the
// batched quantity (SPEC §10); replaces the deleted legacy `character_health::consume_potion` builder.
import { consume_potion_ptb } from './sui/write/consume.js'
// pet loot-box two-phase door (sui/write/lootbox.js): open_box (terminal &Random) burns the box + rolls a
// soulbound PetBoxClaim; claim_pet (deterministic) mints + kiosk-locks the rolled pet. Move shape PROVISIONAL.
import { open_box_ptb, claim_pet_ptb } from './sui/write/lootbox.js'
// board #7 — the S-46 extract-seam equip/unequip composites (extract_for_equip→confirm_equip / unequip→
// lock_in_kiosk). These replace the deleted legacy `character_inventory` equip_item/unequip_item keys.
import { equip_ptb, unequip_ptb } from './sui/write/items_extract.js'
// character DELETE: the one-call in-kiosk burn door (character_extract::
// delete_character; unequipped/unmarked/unlocked guards live ON-CHAIN; the raw Character never escapes).
import { delete_character_ptb } from './sui/write/character_delete.js'
import { buy_ptb, buy_many_ptb } from './sui/write/items_shop.js'
import { burn_mob_template_ptb, burn_sale_ptb } from './sui/write/admin.js'
import {
  list_ptb as marketplace_list_item_ptb,
  list_stack_ptb as marketplace_list_stack_ptb,
  delist_ptb as marketplace_delist_item_ptb,
  marketplace_buy_item_ptb,
  marketplace_buy_character_ptb,
  marketplace_purchase_total_mist,
} from './sui/write/items_marketplace.js'
import {
  split_stack_ptb,
  merge_stack_ptb,
  merge_stacks_ptb,
} from './sui/write/item_stacks.js'
// gift (sui/write/gift.js): escrow-recoverable item send — send lists N items + pre-funded royalty into a shared
// Gift; claim buys each out for 0 and resolves the FULL policy receipt INSIDE Move (ONE moveCall, no offline rule
// resolution); recall delists back (ownership-only). Reads via sui/read/gift.js.
import {
  gift_send_ptb,
  gift_claim_ptb,
  gift_recall_ptb,
} from './sui/write/gift.js'
// airdrop (sui/write/airdrop.js): whitelist claim-MINT for external-collection holders — claim mints the reserved
// item into the whitelisted signer's OWN kiosk (mint-lock, no royalty); admin create/add/remove/close ceremony.
import {
  airdrop_claim_ptb,
  airdrop_create_ptb,
  airdrop_add_addresses_ptb,
  airdrop_remove_addresses_ptb,
  airdrop_close_ptb,
} from './sui/write/airdrop.js'
import { get_gift } from './sui/read/gift.js'
import { get_airdrop } from './sui/read/airdrop.js'
import {
  get_creation_state,
  get_creation_classes,
  is_name_taken,
  is_free_claimed,
  get_sale,
  get_item_template,
  get_rolled_stats,
  read_namespaced_field,
} from './sui/read/items.js'

// The first-party DF namespace ids (mirrors extension.move) — re-exported so read_namespaced_field callers
// name the slot they inspect instead of hardcoding the u8.
export { ITEMS_NS } from './sui/read/items.js'
// The PURE halves of the acquisition fold (#1495) — no context, no chain: a client resolves the destination
// kiosk's same-template stacks off the bag rows it already reads, then hands them to a door builder below.
export {
  MAX_FOLDS_PER_ACQUISITION,
  plan_stack_folds,
  same_template_stack_ids,
} from './sui/write/item_stacks.js'

// keep fetched balances for 3s to avoid spamming the nodes
/** @type {LRUCache<string, bigint>} */
const balances_cache = new LRUCache({ max: 100, ttl: 3000 })

/**
 * @param {Object} [options]
 * @param {'mainnet' | 'testnet' | 'devnet' | 'localnet'} [options.network]
 */
export async function SDK({ network = 'testnet' } = {}) {
  // #23/D79 — the gRPC Core API client is the SSOT for chain reads (testnet JSON-RPC endpoints die wk of Jul 6):
  // every heavy read (roster/stakes/kiosks/worlds/dungeons/objects/balances) runs on `grpc_client.core.*`
  // (transport-agnostic). The default GrpcWebFetchTransport works in the browser; the public testnet fullnode
  // serves gRPC-web at :443 with permissive CORS.
  // gRPC-web Core endpoint. Default = the public fullnode, VERIFIED serving gRPC-web with permissive CORS
  // (~200ms, NOT dead): the /shop + /marketplace 429/CORS floods were a chain-direct DISPLAY-read BURST (now
  // moved to the keyless /v1 read layer), never a dead endpoint. Overridable per-env for a dedicated/paid node
  // WITHOUT a code change: VITE_SUI_GRPC_URL (browser build) or SUI_GRPC_URL (node). Deliberately NOT the repo's
  // SUI_RPC var — that names a JSON-RPC endpoint (publicnode) and this is a gRPC-WEB client; publicnode does not
  // speak gRPC-web (a wrong swap breaks every chain read — roster/stakes/objects), so the override is gRPC-scoped.
  // LOCALNET (L1 anchor): `sui start` serves the gRPC Core API on the fullnode port (default :9000; the gold
  // stack maps it to :9100, fed here via VITE_SUI_GRPC_URL). No graphql exists on localnet — every graphql-
  // dependent read lazy-fails, but the whole PTB/read surface the app uses rides this gRPC client (§11).
  // import.meta.env is Vite-injected — the SDK compiles without vite/client types, so type the seam locally.
  const vite_env = /** @type {{ env?: Record<string, string | undefined> }} */ (
    import.meta
  ).env
  const grpc_base =
    (vite_env && vite_env.VITE_SUI_GRPC_URL) ||
    (typeof process !== 'undefined' &&
      process.env &&
      process.env.SUI_GRPC_URL) ||
    (network === 'mainnet'
      ? 'https://fullnode.mainnet.sui.io:443'
      : network === 'localnet'
        ? 'http://127.0.0.1:9000'
        : 'https://fullnode.testnet.sui.io:443')
  const grpc_client = new SuiGrpcClient({ network, baseUrl: grpc_base })

  // #23/D79 P2 — the GraphQL client covers the two lanes gRPC/Core can't: (1) the KioskClient, whose
  // KioskCompatibleClient type accepts only a JSON-RPC or GraphQL client, never a gRPC one; (2) the event-replay
  // reads (query_events.js) — GraphQL `events(filter:{type})` replaces the deleted JSON-RPC event query. It also
  // implements the Core API + is a valid `Transaction.build({client})` target. Testnet URL per the installed
  // @mysten/sui docs (docs/clients/graphql.md).
  const graphql_client = new SuiGraphQLClient({
    network,
    url:
      network === 'mainnet'
        ? 'https://sui-mainnet.mystenlabs.com/graphql'
        : 'https://graphql.testnet.sui.io/graphql',
  })

  // LOCALNET kiosk reads: the graphql client above is hardcoded to the TESTNET endpoint on every non-mainnet
  // network (localnet runs no graphql service), so getOwnedKiosks silently queried testnet for a localnet
  // address → zero caps → every kiosk_resolve/world-join refused ("character is not in one of your kiosks",
  // caught by the S2 gold multi-turn row). KioskClient's KioskCompatibleClient can't take gRPC — on localnet
  // ONLY, its reader is the local fullnode's JSON-RPC at the SAME base the gRPC client targets (QA plumbing,
  // never a product-code read path; the /v1-only law governs shipped networks, unchanged above).
  const kiosk_reader =
    network === 'localnet'
      ? new SuiJsonRpcClient({ url: grpc_base, network })
      : graphql_client
  // Localnet publishes its OWN kiosk-rules package (up_gold publishKiosk) — the personal-kiosk caps are wrapped
  // by THAT package's type, so getOwnedKiosks finds none without its id. The id rides the same deployment home
  // every localnet id does (globalThis.__ARES_LOCALNET_IDS → deployment/aresrpg.js); absent → no override.
  const localnet_rules_package =
    network === 'localnet'
      ? aresrpg_id('localnet', 'KIOSK_ROYALTY_RULE_PACKAGE_ID')
      : ''
  const kiosk_client = new KioskClient({
    client: kiosk_reader,
    network,
    // seems the kiosk sdk is missing the correct rule
    ...(network === 'mainnet'
      ? {
          packageIds: {
            personalKioskRulePackageId:
              release.networks.mainnet.system.personal_kiosk_rule_package,
          },
        }
      : localnet_rules_package
        ? { packageIds: { personalKioskRulePackageId: localnet_rules_package } }
        : {}),
  })

  // LOCALNET has no HSUI/AFSUI token deploy of its own — the L1 anchor borrows testnet's token config so SDK
  // construction never throws on the missing localnet entry (the app never trades these on a localnet QA pass;
  // a real localnet token deploy would add its own entry to supported_tokens.js). Only the token map borrows —
  // every id/endpoint above stays localnet.
  const token_network = network === 'localnet' ? 'testnet' : network
  const supported_tokens = SUPPORTED_TOKENS(token_network)

  Object.values(supported_tokens).forEach(async token => {
    Object.assign(token, {
      is_token: true,
      item_set: 'none',
      item_type: token.address,
      item_category: ITEM_CATEGORY.RESOURCE,
      level: 1,
    })
  })

  const context = {
    grpc_client,
    graphql_client,
    kiosk_client,
    network,
    supported_tokens,
    HSUI: HSUI[token_network].address,
  }

  return {
    grpc_client,
    graphql_client,
    kiosk_client,
    SUPPORTED_TOKENS: supported_tokens,
    HSUI: HSUI[token_network],

    get_royalty_fee: get_royalty_fee(context),
    get_supported_tokens: get_supported_tokens(context),

    get_user_kiosks: get_user_kiosks(context),

    get_expedition: get_expedition(context),

    borrow_personal_kiosk_cap: borrow_personal_kiosk_cap(context),

    // S-16a — aresrpg_items character creation (free first + starter / paid additional), the kiosk-less
    // onboarding tx, the terminal item buys, and the zero-backend reads. Each factory is context-bound here;
    // pure exports (MEASURED_BUY_GAS_MIST, MAX_BUY_QUANTITY, ITEMS_NS, buy_gas_budget_mist, the marker-id
    // derivers) are imported directly from their modules.
    onboard_kiosk_ptb: onboard_kiosk_ptb(context),
    create_character_free_ptb: create_character_free_ptb(context),
    create_character_paid_ptb: create_character_paid_ptb(context),
    // S-52 — the single-tx exact-ingredient craft (sui/write/craft.js — THE one craft home).
    craft_ptb: craft_ptb(context),
    // Artisan commission v2 (sui/write/commission.js): request escrows an OPTIONAL payment; accept proves the
    // artisan's knowledge; execute crafts on the customer's kiosk (mint-locks internally); cancel refunds; redeem
    // banks the artisan's craft-XP voucher.
    commission_request_ptb: commission_request_ptb(context),
    commission_accept_ptb: commission_accept_ptb(context),
    commission_execute_ptb: commission_execute_ptb(context),
    commission_cancel_ptb: commission_cancel_ptb(context),
    commission_redeem_xp_ptb: commission_redeem_xp_ptb(context),
    // #31 — out-of-fight consumable USE (consume::use_many; sui/write/consume.js). Batched multi-use debounce.
    consume_potion_ptb: consume_potion_ptb(context),
    // pet loot-box two-phase door (sui/write/lootbox.js): open_box rolls a soulbound PetBoxClaim (terminal
    // &Random), claim_pet mints + kiosk-locks the rolled pet (deterministic). Move door shape PROVISIONAL.
    open_box_ptb: open_box_ptb(context),
    claim_pet_ptb: claim_pet_ptb(context),
    // board #7 — equip/unequip via the extract seam (sui/write/items_extract.js). Chainable (pass `tx`) so a
    // staged batch signs ONCE; the slot is on-chain derived from the item's own category (no slot arg).
    equip_ptb: equip_ptb(context),
    unequip_ptb: unequip_ptb(context),
    // BACKLOG 18 — character delete (sui/write/character_delete.js): one moveCall, guards on-chain,
    // IRREVERSIBLE (the name stays reserved forever — the UI confirm states it).
    delete_character_ptb: delete_character_ptb(context),
    buy_ptb: buy_ptb(context),
    buy_many_ptb: buy_many_ptb(context),
    burn_mob_template_ptb: burn_mob_template_ptb(context),
    burn_sale_ptb: burn_sale_ptb(context),
    // Secondary kiosk market: callers pass the TransferPolicy snapshot fetched during pre-flight so the builders
    // verify the live rules before composing their receipts. Kiosk-lineage calls use the fresh linkage stamp.
    marketplace_list_item_ptb: marketplace_list_item_ptb(context),
    marketplace_list_stack_ptb: marketplace_list_stack_ptb(context),
    marketplace_delist_item_ptb: marketplace_delist_item_ptb(context),
    marketplace_buy_item_ptb: marketplace_buy_item_ptb(context),
    marketplace_buy_character_ptb: marketplace_buy_character_ptb(context),
    marketplace_purchase_total_mist: marketplace_purchase_total_mist(context),
    // Free stack shaping: both doors extract and re-lock all survivors into the same personal kiosk.
    split_stack_ptb: split_stack_ptb(context),
    merge_stack_ptb: merge_stack_ptb(context),
    merge_stacks_ptb: merge_stacks_ptb(context),
    // gift — escrow-recoverable item send (send/claim/recall) + pre-flight read.
    gift_send_ptb: gift_send_ptb(context),
    gift_claim_ptb: gift_claim_ptb(context),
    gift_recall_ptb: gift_recall_ptb(context),
    get_gift: get_gift(context),
    // airdrop — whitelist claim-mint (claim) + owner ceremony (create/add/remove/close) + pre-flight read.
    airdrop_claim_ptb: airdrop_claim_ptb(context),
    airdrop_create_ptb: airdrop_create_ptb(context),
    airdrop_add_addresses_ptb: airdrop_add_addresses_ptb(context),
    airdrop_remove_addresses_ptb: airdrop_remove_addresses_ptb(context),
    airdrop_close_ptb: airdrop_close_ptb(context),
    get_airdrop: get_airdrop(context),
    get_creation_state: get_creation_state(context),
    get_creation_classes: get_creation_classes(context),
    is_name_taken: is_name_taken(context),
    is_free_claimed: is_free_claimed(context),
    get_sale: get_sale(context),
    get_item_template: get_item_template(context),
    get_rolled_stats: get_rolled_stats(context),
    read_namespaced_field: read_namespaced_field(context),

    // S-57 — deployed S-46 FIGHT lifecycle (CORE create/join/settle-loot doors + ENGINE turn/action/settle doors).
    create_fight_ptb: create_fight_ptb(context),
    create_member_fight_ptb: create_member_fight_ptb(context),
    join_fight_ptb: join_fight_ptb(context),
    place_ptb: place_ptb(context),
    force_start_ptb: force_start_ptb(context),
    crank_ptb: crank_ptb(context),
    act_move_ptb: act_move_ptb(context),
    act_weapon_ptb: act_weapon_ptb(context),
    act_cast_ptb: act_cast_ptb(context),
    act_pass_ptb: act_pass_ptb(context),
    commit_turn_ptb: commit_turn_ptb(context), // the WHOLE turn as ONE PTB (acts + terminal pass — design ruling 2026-07-11)
    settle_fight_ptb: settle_fight_ptb(context),
    open_result_ptb: open_result_ptb(context),
    // SETTLE→OPEN PATH — PTB-composed settle+open, closes the two-tx settle→open stranded-outcome gap.
    settle_and_take_ptb: settle_and_take_ptb(context),
    open_taken_ptb: open_taken_ptb(context),
    settle_run_taken_ptb: settle_run_taken_ptb(context),
    release_group_ptb: release_group_ptb(context),
    settle_open_world_ptb: settle_open_world_ptb(context),
    mint_rolled_ptb: mint_rolled_ptb(context),
    burn_result_ptb: burn_result_ptb(context),

    // S-57 — deployed S-46 DUNGEON lifecycle (§9 "the key IS the run"). `join_dungeon_fight_ptb` aliases dungeon's
    // `join_fight_ptb` to avoid the clash with the overworld fight join above.
    activate_ptb: activate_ptb(context),
    activate_many_ptb: activate_many_ptb(context),
    next_fight_ptb: next_fight_ptb(context),
    join_dungeon_fight_ptb: join_dungeon_fight_ptb(context),
    settle_run_ptb: settle_run_ptb(context),
    abandon_run_ptb: abandon_run_ptb(context),
    get_run_pass: get_run_pass(context),

    // S-57 — deployed S-46 KOLIZEUM wagered-PvP lobby + fight bridge (§17.9; a real win's pot takes a 10%
    // platform cut at settle, PLATFORM CUTS — draw/cancel/exit refund whole, uncut).
    kolizeum_create_public_ptb: kolizeum_create_public_ptb(context),
    kolizeum_create_friends_only_ptb: kolizeum_create_friends_only_ptb(context),
    kolizeum_join_ptb: kolizeum_join_ptb(context),
    kolizeum_exit_ptb: kolizeum_exit_ptb(context),
    kolizeum_cancel_ptb: kolizeum_cancel_ptb(context),
    kolizeum_start_ptb: kolizeum_start_ptb(context),
    kolizeum_seat_ptb: kolizeum_seat_ptb(context),
    kolizeum_settle_ptb: kolizeum_settle_ptb(context),
    kolizeum_open_ptb: kolizeum_open_ptb(context),
    kolizeum_settle_arena_ptb: kolizeum_settle_arena_ptb(context),
    kolizeum_sweep_ptb: kolizeum_sweep_ptb(context),
    get_kolizeum: get_kolizeum(context),

    // S-57 — deployed S-46 GAME progression + world flows (spell levels / pet feed / forgemagie crush+scribe;
    // join_world / search_zone / gather). The S-46 `get_world` read is via `@aresrpg/sdk/game`; the OLD staking
    // `get_world` factory read (S-61 kill list) has been removed. `craft_ptb` is wired from sui/write/craft.js
    // beside the items keys above.
    raise_spell_level_ptb: raise_spell_level_ptb(context),
    feed_ptb: feed_ptb(context),
    // Forgemagie (forgemagie.move): rune scribing + the 2026-07-11 SINGLE-TX gear crush (roll + mint in one
    // terminal-&Random call; the receipt/mint_crushed/burn_receipt 3-step is deleted). The shared CrushBoard id
    // is a RUNTIME arg (crush_board_id — ref-or-id seam) sourced from the seed record; the ItemExtractPolicy
    // resolves statically from the deployment home (EXTRACT_POLICY — S-51b).
    crush_ptb: crush_ptb(context),
    scribe_rune_ptb: scribe_rune_ptb(context),
    join_world_ptb: join_world_ptb(context),
    search_zone_ptb: search_zone_ptb(context),
    gather_ptb: gather_ptb(context),

    /** @return {Promise<bigint>} balance */
    async get_sui_balance(owner) {
      if (!balances_cache.has(owner)) {
        // #23 gRPC: core.getBalance returns { balance: { balance } } (was jsonRpc { totalBalance }).
        const { balance } = await grpc_client.core.getBalance({ owner })
        balances_cache.set(owner, BigInt(balance.balance))
      }

      return balances_cache.get(owner)
    },
  }
}
