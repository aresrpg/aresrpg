// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { KioskClient, KioskTransaction } from '@mysten/kiosk'
import { Transaction } from '@mysten/sui/transactions'

import {
  aresrpg_deployment,
  shared_object_arg,
} from '../../deployment/aresrpg.js'
import { as_object_arg } from '../object_arg.js'
import { join_world_call } from './game_world.js'

// CHARACTER CREATION PTB BUILDERS for the merged `aresrpg` package's `creation` — the pure transaction composers for the character
// mint gate. Both `create_character_free`/`create_character_paid` are COMPOSABLE `public fun`s (no `&Random` — the
// creation is deterministic — no `&Random` by ruling R-G2), so the mint, lock and terminal world join fit in ONE
// tx against an EXISTING personal kiosk. A kiosk-less account first uses `onboard_kiosk_ptb`: the terminal
// `zones::join_world(..., &Random)` cannot be followed by the share + PersonalKioskCap transfer that a brand-new
// kiosk still owes. That prerequisite creates no Character; the following creation PTB is the only character
// state boundary and atomically writes membership. Every minted object is TYPE-FORCED into a personal kiosk in
// the same PTB (`lock_in_kiosk` asserts personal) — there is no address-delivery path.
//
// FROZEN Move signatures (read firsthand from packages/move/aresrpg/sources/{creation,character,item}.move —
// arities SURVIVED the S-46 merge unchanged; only the id resolution collapsed to the one deployment home):
//   public fun create_character_free(gate: &mut Creation, raw_name, class, male, customization: Customization,
//     address_seed: u256, clock: &Clock, version: &Version, ctx) : (Character, LockPledge)
//   public fun create_character_paid(gate: &mut Creation, raw_name, class, male, customization: Customization,
//     payment: Coin<SUI>, clock: &Clock, version: &Version, ctx) : (Character, LockPledge)
//   public fun character::new_customization(color_1: u32, color_2: u32, color_3: u32) : Customization
//   public fun character::lock_in_kiosk(pledge, character, &mut Kiosk, &KioskOwnerCap, &TransferPolicy<Character>)
//   public fun item::lock_in_kiosk(pledge, item, &mut Kiosk, &KioskOwnerCap, &TransferPolicy<Item>)

/**
 * A KioskClient whose personal_kiosk CALL target is the id the aresrpg package's own linkage table binds
 * (KIOSK_ROYALTY_RULE_PACKAGE_ID — the forked kiosk-rules/personal-kiosk lineage, its UPGRADED id). A PTB that
 * calls `personal_kiosk::*` (create/borrow/return a personal kiosk) ALONGSIDE an aresrpg MoveCall — every
 * character-create + lock — MUST target that id, or the two kiosk-lineage versions collide and the mixed tx
 * aborts `InvalidLinkage` at the first aresrpg command (kiosk-rule-linkage law). This is DISTINCT from the READ
 * client (`context.kiosk_client`), which keeps the type-ORIGIN id (0x06f6…791b1 on testnet) so getOwnedKiosks'
 * owned-object type filter — an exact, non-origin-normalizing match — still finds on-chain PersonalKioskCaps
 * (their canonical type resolves to the origin regardless of which upgraded package minted them). An unstamped
 * call target refuses loudly; falling back to the read client's defining/original id can produce InvalidLinkage.
 * @param {import('@mysten/kiosk').KioskClient} read_client the context's read KioskClient (its `.client` is reused)
 * @param {string} network
 * @param {string} linkage_pkg KIOSK_ROYALTY_RULE_PACKAGE_ID for `network` (may be '')
 */
function personal_kiosk_call_client(read_client, network, linkage_pkg) {
  if (!linkage_pkg)
    throw new Error(
      `[items_creation] kiosk linkage package is not stamped for "${network}"`,
    )
  return new KioskClient({
    client: read_client.client,
    network,
    packageIds: { personalKioskRulePackageId: linkage_pkg },
  })
}

/**
 * Resolve a `&mut Kiosk` + its `&KioskOwnerCap` for same-PTB locks by borrowing an EXISTING personal kiosk's
 * owner cap. The fresh branch remains the shared low-level house primitive, but atomic creation refuses it:
 * terminal world entry cannot precede the share/cap-transfer commands its `finalize()` appends.
 * @param {{ kiosk_client: import('@mysten/kiosk').KioskClient, tx: Transaction, kiosk_id: string | null,
 *   personal_kiosk_cap_id: string | null, personal_kiosk_package_id: string }} args
 */
function personal_kiosk_binding({
  kiosk_client,
  tx,
  kiosk_id,
  personal_kiosk_cap_id,
  personal_kiosk_package_id,
}) {
  // EXISTING personal kiosk: borrow the KioskOwnerCap out of the soulbound PersonalKioskCap, return it after the locks.
  if (personal_kiosk_cap_id) {
    if (!kiosk_id)
      throw new Error(
        '[items_creation] personal_kiosk_cap_id was given without kiosk_id — pass BOTH to lock into an existing kiosk.',
      )
    const cap_ref = as_object_arg(tx, personal_kiosk_cap_id) // ref-or-id seam (S-51b): id string or cached owned ref
    const [owner_cap, promise] = tx.moveCall({
      target: `${personal_kiosk_package_id}::personal_kiosk::borrow_val`,
      arguments: [cap_ref],
    })
    return {
      kiosk: as_object_arg(tx, kiosk_id), // ref-or-id seam: a cached shared-kiosk ref must be mutable:true (locks mutate it)
      owner_cap,
      personal_cap: cap_ref,
      finalize() {
        tx.moveCall({
          target: `${personal_kiosk_package_id}::personal_kiosk::return_val`,
          arguments: [cap_ref, owner_cap, promise],
        })
      },
    }
  }

  // NEW personal kiosk (kiosk-less first character): create + personalize inline; finalize() shares it and
  // soulbinds the PersonalKioskCap to the sender.
  const ktx = new KioskTransaction({
    transaction: tx,
    kioskClient: kiosk_client,
  }).createPersonal(true)
  return {
    kiosk: ktx.getKiosk(),
    owner_cap: ktx.getKioskCap(),
    personal_cap: null,
    finalize() {
      ktx.finalize()
    },
  }
}

/**
 * ONBOARD tx — a kiosk-less buyer creates + SHARES a PERSONAL kiosk and soulbinds its `PersonalKioskCap`, in ONE
 * prior tx. Required before the first `shop::buy` or character creation: both now end in a terminal `&Random`
 * command, so neither can create/share a kiosk in its own tx. The orchestrator reads the created Kiosk +
 * PersonalKioskCap ids from this tx's effects and feeds them to the character/item PTB.
 * Harvested from the frontend world-shell onboarding builder.
 * @param {import("../../../types.js").Context} context
 */
export function onboard_kiosk_ptb(context) {
  const { kiosk_client } = context
  return ({ tx = new Transaction() } = {}) => {
    const ktx = new KioskTransaction({
      transaction: tx,
      kioskClient: kiosk_client,
    })
    ktx.createPersonal(false)
    ktx.finalize()
    return tx
  }
}

/**
 * Create the account's FIRST character for FREE, locking it into a personal kiosk — in ONE tx. NO weapon is
 * granted (early weapons are admin-authored easy loot; a fresh character fights bare-handed).
 * `address_seed` (string|bigint) is REQUIRED — the caller's zkLogin session seed (S-09d gate); once the mainnet
 * sponsor gate is configured the tx must additionally be SPONSORED by the app's gas station (S-09e — the station
 * signs after verifying the app's OAuth aud; an unsponsored send aborts 110). `world_id`, `kiosk_id`, and
 * `personal_kiosk_cap_id` are REQUIRED: a kiosk-less account must run
 * `onboard_kiosk_ptb` first because the terminal world join cannot precede that kiosk's share/cap transfer.
 * Refuses loudly if the package is not deployed (no builder invents an id).
 * @param {import("../../../types.js").Context} context
 */
export function create_character_free_ptb(context) {
  const { kiosk_client, network } = context
  return ({
    name,
    class: character_class,
    male = true,
    color_1 = 0,
    color_2 = 0,
    color_3 = 0,
    address_seed,
    world_id,
    kiosk_id = null,
    personal_kiosk_cap_id = null,
    tx = new Transaction(),
  }) => {
    const dep = aresrpg_deployment(network, context.ids?.aresrpg)
    if (address_seed === undefined || address_seed === null)
      throw new Error(
        '[create_character_free_ptb] address_seed is required — the zkLogin session seed the sender address derives from (S-09d).',
      )
    if (!world_id)
      throw new Error(
        '[create_character_free_ptb] world_id is required — character creation must enter a world atomically (#1714).',
      )
    if (!kiosk_id || !personal_kiosk_cap_id)
      throw new Error(
        '[create_character_free_ptb] kiosk_id and personal_kiosk_cap_id are required for atomic world entry — run onboard_kiosk_ptb first.',
      )

    const binding = personal_kiosk_binding({
      // personal_kiosk::* must be CALLED at the linkage-bound id (see personal_kiosk_call_client) — this PTB
      // mixes those calls with `creation::create_character_free` + `character::lock_in_kiosk`.
      kiosk_client: personal_kiosk_call_client(
        kiosk_client,
        network,
        dep.KIOSK_ROYALTY_RULE_PACKAGE_ID,
      ),
      tx,
      kiosk_id,
      personal_kiosk_cap_id,
      personal_kiosk_package_id: dep.KIOSK_ROYALTY_RULE_PACKAGE_ID,
    })

    const [customization] = tx.moveCall({
      target: `${dep.LATEST_PACKAGE_ID}::character::new_customization`,
      arguments: [
        tx.pure.u32(color_1),
        tx.pure.u32(color_2),
        tx.pure.u32(color_3),
      ],
    })

    const [character, character_pledge] = tx.moveCall({
      target: `${dep.GIFTING_PACKAGE_ID}::creation::create_character_free`,
      arguments: [
        // STATIC shared refs (P0 07-09): mutability mirrors the Move ref kind EXACTLY (&mut Creation / &Version /
        // &TransferPolicy). With every object input statically resolved (clock 0x6 is static via tx.object.clock()),
        // the kind-only sponsored build needs NO client resolution round-trip — the testnet GraphQL endpoint's
        // resolveTransaction (a full simulateTransaction) was failing on a fresh account's first create there.
        shared_object_arg(tx, network, 'CREATION', true, dep.CREATION), // gate: &mut Creation
        shared_object_arg(tx, network, 'GAME_CONFIG', false, dep.GAME_CONFIG), // config: &GameConfig (gifting split: param 2)
        tx.pure.string(name), // raw_name: String
        tx.pure.string(character_class), // class: String
        tx.pure.bool(male), // male: bool
        customization, // customization: Customization
        tx.pure.u256(BigInt(address_seed)), // address_seed: u256 (zkLogin — S-09d)
        tx.object.clock(), // clock: &Clock (0x6)
        shared_object_arg(tx, network, 'VERSION', false, dep.VERSION), // version: &Version
      ],
    })

    // Capture the minted object's ID as a PTB result BEFORE the lock consumes the Character value. This is the
    // exact `ID` the terminal join door accepts; no receipt/read-back boundary exists.
    const [character_id] = tx.moveCall({
      target: `${dep.LATEST_PACKAGE_ID}::character::id`,
      arguments: [character],
    })

    // Lock the character into the personal kiosk. A failed lock reverts the whole tx, freeing the name AND the
    // one-free-per-account slot. The join below borrows this just-locked character by the piped ID.
    tx.moveCall({
      target: `${dep.LATEST_PACKAGE_ID}::character::lock_in_kiosk`,
      arguments: [
        character_pledge,
        character,
        binding.kiosk,
        binding.owner_cap,
        shared_object_arg(
          tx,
          network,
          'CHARACTER_POLICY',
          false,
          dep.CHARACTER_POLICY,
        ), // policy: &TransferPolicy<Character>
      ],
    })

    binding.finalize()
    return join_world_call(context, {
      tx,
      world: as_object_arg(tx, world_id),
      kiosk: binding.kiosk,
      personal_kiosk_cap: binding.personal_cap,
      character_id,
    })
  }
}

/**
 * Create an ADDITIONAL (paid) character — no free-slot claim. `price_mist` is split EXACTLY off
 * the gas coin as the payment (the gate splits `price` to the treasury and refunds change on-chain, so an exact
 * split refunds nothing; a stale-low price aborts EInsufficientPayment). Read the live price from the gate
 * (`get_creation_state`) before building. World and kiosk args behave as in the free path.
 * @param {import("../../../types.js").Context} context
 */
export function create_character_paid_ptb(context) {
  const { kiosk_client, network } = context
  return ({
    name,
    class: character_class,
    male = true,
    color_1 = 0,
    color_2 = 0,
    color_3 = 0,
    price_mist,
    world_id,
    kiosk_id = null,
    personal_kiosk_cap_id = null,
    tx = new Transaction(),
  }) => {
    const dep = aresrpg_deployment(network, context.ids?.aresrpg)
    if (price_mist == null)
      throw new Error(
        '[create_character_paid_ptb] price_mist is required — read the live gate price (get_creation_state).',
      )
    if (!world_id)
      throw new Error(
        '[create_character_paid_ptb] world_id is required — character creation must enter a world atomically (#1714).',
      )
    if (!kiosk_id || !personal_kiosk_cap_id)
      throw new Error(
        '[create_character_paid_ptb] kiosk_id and personal_kiosk_cap_id are required for atomic world entry — run onboard_kiosk_ptb first.',
      )

    const binding = personal_kiosk_binding({
      // personal_kiosk::* must be CALLED at the linkage-bound id (see personal_kiosk_call_client) — this PTB
      // mixes those calls with `creation::create_character_paid` + `character::lock_in_kiosk`.
      kiosk_client: personal_kiosk_call_client(
        kiosk_client,
        network,
        dep.KIOSK_ROYALTY_RULE_PACKAGE_ID,
      ),
      tx,
      kiosk_id,
      personal_kiosk_cap_id,
      personal_kiosk_package_id: dep.KIOSK_ROYALTY_RULE_PACKAGE_ID,
    })

    // Exact price split off gas; the gate refunds any surplus, so a well-formed tx refunds nothing.
    const [payment] = tx.splitCoins(tx.gas, [tx.pure.u64(BigInt(price_mist))])

    const [customization] = tx.moveCall({
      target: `${dep.LATEST_PACKAGE_ID}::character::new_customization`,
      arguments: [
        tx.pure.u32(color_1),
        tx.pure.u32(color_2),
        tx.pure.u32(color_3),
      ],
    })

    const [character, character_pledge] = tx.moveCall({
      target: `${dep.GIFTING_PACKAGE_ID}::creation::create_character_paid`,
      arguments: [
        // STATIC shared refs (P0 07-09): mutability mirrors the Move ref kind EXACTLY (&mut Creation / &Version /
        // &TransferPolicy). With every object input statically resolved (clock 0x6 is static via tx.object.clock()),
        // the kind-only sponsored build needs NO client resolution round-trip — the testnet GraphQL endpoint's
        // resolveTransaction (a full simulateTransaction) was failing on a fresh account's first create there.
        shared_object_arg(tx, network, 'CREATION', true, dep.CREATION), // gate: &mut Creation
        shared_object_arg(tx, network, 'GAME_CONFIG', false, dep.GAME_CONFIG), // config: &GameConfig (gifting split: param 2)
        tx.pure.string(name), // raw_name: String
        tx.pure.string(character_class), // class: String
        tx.pure.bool(male), // male: bool
        customization, // customization: Customization
        payment, // payment: Coin<SUI> (exact split; change refunded on-chain)
        tx.object.clock(), // clock: &Clock (0x6)
        shared_object_arg(tx, network, 'VERSION', false, dep.VERSION), // version: &Version
      ],
    })

    const [character_id] = tx.moveCall({
      target: `${dep.LATEST_PACKAGE_ID}::character::id`,
      arguments: [character],
    })

    tx.moveCall({
      target: `${dep.LATEST_PACKAGE_ID}::character::lock_in_kiosk`,
      arguments: [
        character_pledge,
        character,
        binding.kiosk,
        binding.owner_cap,
        shared_object_arg(
          tx,
          network,
          'CHARACTER_POLICY',
          false,
          dep.CHARACTER_POLICY,
        ), // policy: &TransferPolicy<Character>
      ],
    })

    binding.finalize()
    return join_world_call(context, {
      tx,
      world: as_object_arg(tx, world_id),
      kiosk: binding.kiosk,
      personal_kiosk_cap: binding.personal_cap,
      character_id,
    })
  }
}
