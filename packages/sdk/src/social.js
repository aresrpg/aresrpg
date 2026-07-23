// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SOCIAL — the public per-domain home for the STANDALONE `aresrpg_social` package (§13): FRIENDS + PARTY. A
// `FriendList` is a NON-TRANSFERABLE, address-bound personal whitelist: ONE-WAY (no invite / accept / request),
// its owner adds or removes addresses directly (DECISIONS 07-08). The friends write builders live in
// `sui/write/social_friends.js` and the `FriendList` decode in `sui/read/friends.js`; this module RE-EXPORTS
// both (one public import per domain, mirroring `kolizeum.js` / `game.js`) and adds the character-keyed PARTY
// builders.
//
// PARTY Move signatures live in packages/move/social/sources/party.move. Every membership action carries
// an exact Character ID plus the acting character's personal Kiosk/PersonalKioskCap ownership proof. All calls
// target SOCIAL_LATEST_PACKAGE_ID with the social package's own shared Version (SOCIAL_VERSION); the generic
// type argument remains the canonical Character type from PACKAGE_ID.
//
// Ids resolve through the ONE stamp-or-throw deployment home (deployment/aresrpg.js) — the social ids are
// NON-required, so a social call refuses loudly until stamped and goes live at stamp time with zero changes.
//
// S-51b STATIC REFS: SOCIAL_VERSION rides the shared-version cache (aresrpg_shared_ref — & everywhere here);
// the shared Party is a runtime object on the ref-or-id seam (`as_object_arg`): id string or caller-cached ref.

import { aresrpg_deployment, shared_object_arg } from './deployment/aresrpg.js'
import { as_object_arg } from './sui/object_arg.js'
import { new_ptb } from './sui/write/header.js'

export {
  create_friend_list_ptb,
  add_friend_ptb,
  remove_friend_ptb,
} from './sui/write/social_friends.js'
export {
  get_friend_list,
  get_friend_list_by_owner,
} from './sui/read/friends.js'

/**
 * The context a social builder needs: the network + an optional `ids` injection seam.
 * @typedef {object} SocialContext
 * @property {'mainnet' | 'testnet' | 'devnet' | 'localnet'} network
 * @property {{ aresrpg?: Record<string, string> }} [ids]
 */

/** Resolve the two NON-required social ids or throw loudly (the "refuse, never guess" gate). */
function social_ids(network, overrides) {
  const a = aresrpg_deployment(network, overrides)
  if (!a.SOCIAL_LATEST_PACKAGE_ID || !a.SOCIAL_VERSION)
    throw new Error(
      '[social] aresrpg_social is not deployed — stamp SOCIAL_LATEST_PACKAGE_ID/SOCIAL_VERSION in src/deployment/aresrpg.js.',
    )
  return a
}

const character_type = a => `${a.PACKAGE_ID}::character::Character`

// Party keys every membership action by Character ID and proves the acting character's current personal-kiosk
// ownership on-chain. All calls target the standalone social package and pass its Version.

/**
 * Append `party::invite` with already-resolved arguments. The owned-alt builder can thereby reuse the exact
 * Party/Version inputs while threading either shared or distinct leader/invitee kiosk proofs.
 */
function append_party_invite({
  tx,
  package_id,
  party,
  kiosk,
  personal_kiosk_cap,
  leader_character,
  invited_character,
  invited_owner,
  version,
  type,
}) {
  tx.moveCall({
    target: `${package_id}::party::invite`,
    typeArguments: [type],
    arguments: [
      party,
      kiosk,
      personal_kiosk_cap,
      leader_character,
      invited_character,
      tx.pure.address(invited_owner),
      version,
    ],
  })
}

/** Append one current-owner-gated Party membership action with already-resolved proof inputs. */
function append_party_member_action({
  tx,
  package_id,
  action,
  party,
  kiosk,
  personal_kiosk_cap,
  character,
  version,
  type,
}) {
  tx.moveCall({
    target: `${package_id}::party::${action}`,
    typeArguments: [type],
    arguments: [party, kiosk, personal_kiosk_cap, character, version],
  })
}

/**
 * CREATE a character-keyed Party. The leader's personal kiosk/cap proves current ownership on-chain.
 * @param {SocialContext} context
 */
export function create_party_ptb(context) {
  const { network } = context
  return ({
    kiosk_id,
    personal_kiosk_cap_id,
    leader_character_id,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const a = social_ids(network, context.ids?.aresrpg)
    tx.moveCall({
      target: `${a.SOCIAL_LATEST_PACKAGE_ID}::party::create`,
      typeArguments: [character_type(a)],
      arguments: [
        as_object_arg(tx, kiosk_id),
        as_object_arg(tx, personal_kiosk_cap_id),
        tx.pure.id(leader_character_id),
        shared_object_arg(
          tx,
          network,
          'SOCIAL_VERSION',
          false,
          a.SOCIAL_VERSION,
        ),
      ],
    })
    return tx
  }
}

/**
 * INVITE a character. The acting leader proves current ownership; acceptance remains a separate signer action.
 * @param {SocialContext} context
 */
export function party_invite_ptb(context) {
  const { network } = context
  return ({
    party_id,
    leader_kiosk_id,
    leader_personal_kiosk_cap_id,
    leader_character_id,
    invited_character_id,
    invited_owner,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const a = social_ids(network, context.ids?.aresrpg)
    append_party_invite({
      tx,
      package_id: a.SOCIAL_LATEST_PACKAGE_ID,
      party: as_object_arg(tx, party_id),
      kiosk: as_object_arg(tx, leader_kiosk_id),
      personal_kiosk_cap: as_object_arg(tx, leader_personal_kiosk_cap_id),
      leader_character: tx.pure.id(leader_character_id),
      invited_character: tx.pure.id(invited_character_id),
      invited_owner,
      version: shared_object_arg(
        tx,
        network,
        'SOCIAL_VERSION',
        false,
        a.SOCIAL_VERSION,
      ),
      type: character_type(a),
    })
    return tx
  }
}

/**
 * ACCEPT a pending Party invitation using the invited character's current personal-kiosk ownership proof.
 * @param {SocialContext} context
 */
export function party_accept_ptb(context) {
  const { network } = context
  return ({
    party_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const a = social_ids(network, context.ids?.aresrpg)
    append_party_member_action({
      tx,
      package_id: a.SOCIAL_LATEST_PACKAGE_ID,
      action: 'accept',
      party: as_object_arg(tx, party_id),
      kiosk: as_object_arg(tx, kiosk_id),
      personal_kiosk_cap: as_object_arg(tx, personal_kiosk_cap_id),
      character: tx.pure.id(character_id),
      version: shared_object_arg(
        tx,
        network,
        'SOCIAL_VERSION',
        false,
        a.SOCIAL_VERSION,
      ),
      type: character_type(a),
    })
    return tx
  }
}

/**
 * DECLINE a pending Party invitation using the invited character's current personal-kiosk ownership proof.
 * @param {SocialContext} context
 */
export function party_decline_ptb(context) {
  const { network } = context
  return ({
    party_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const a = social_ids(network, context.ids?.aresrpg)
    append_party_member_action({
      tx,
      package_id: a.SOCIAL_LATEST_PACKAGE_ID,
      action: 'decline',
      party: as_object_arg(tx, party_id),
      kiosk: as_object_arg(tx, kiosk_id),
      personal_kiosk_cap: as_object_arg(tx, personal_kiosk_cap_id),
      character: tx.pure.id(character_id),
      version: shared_object_arg(
        tx,
        network,
        'SOCIAL_VERSION',
        false,
        a.SOCIAL_VERSION,
      ),
      type: character_type(a),
    })
    return tx
  }
}

/**
 * INVITE then ACCEPT an owned alt in one same-signer PTB. Both calls reuse the same Party and Version inputs;
 * each character carries its own kiosk/cap proof (the invitee proof defaults to the leader proof when co-located).
 * @param {SocialContext} context
 */
export function party_invite_accept_own_ptb(context) {
  const { network } = context
  return ({
    party_id,
    leader_kiosk_id,
    leader_personal_kiosk_cap_id,
    invited_kiosk_id = leader_kiosk_id,
    invited_personal_kiosk_cap_id = leader_personal_kiosk_cap_id,
    leader_character_id,
    invited_character_id,
    invited_owner,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const a = social_ids(network, context.ids?.aresrpg)
    const party = as_object_arg(tx, party_id)
    const leader_kiosk = as_object_arg(tx, leader_kiosk_id)
    const leader_personal_kiosk_cap = as_object_arg(
      tx,
      leader_personal_kiosk_cap_id,
    )
    const invited_kiosk = as_object_arg(tx, invited_kiosk_id)
    const invited_personal_kiosk_cap = as_object_arg(
      tx,
      invited_personal_kiosk_cap_id,
    )
    const invited_character = tx.pure.id(invited_character_id)
    const version = shared_object_arg(
      tx,
      network,
      'SOCIAL_VERSION',
      false,
      a.SOCIAL_VERSION,
    )

    append_party_invite({
      tx,
      package_id: a.SOCIAL_LATEST_PACKAGE_ID,
      party,
      kiosk: leader_kiosk,
      personal_kiosk_cap: leader_personal_kiosk_cap,
      leader_character: tx.pure.id(leader_character_id),
      invited_character,
      invited_owner,
      version,
      type: character_type(a),
    })
    append_party_member_action({
      tx,
      package_id: a.SOCIAL_LATEST_PACKAGE_ID,
      action: 'accept',
      party,
      kiosk: invited_kiosk,
      personal_kiosk_cap: invited_personal_kiosk_cap,
      character: invited_character,
      version,
      type: character_type(a),
    })
    return tx
  }
}

/** LEAVE Party by character, after proving its current ownership. @param {SocialContext} context */
export function party_leave_ptb(context) {
  const { network } = context
  return ({
    party_id,
    kiosk_id,
    personal_kiosk_cap_id,
    character_id,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const a = social_ids(network, context.ids?.aresrpg)
    append_party_member_action({
      tx,
      package_id: a.SOCIAL_LATEST_PACKAGE_ID,
      action: 'leave',
      party: as_object_arg(tx, party_id),
      kiosk: as_object_arg(tx, kiosk_id),
      personal_kiosk_cap: as_object_arg(tx, personal_kiosk_cap_id),
      character: tx.pure.id(character_id),
      version: shared_object_arg(
        tx,
        network,
        'SOCIAL_VERSION',
        false,
        a.SOCIAL_VERSION,
      ),
      type: character_type(a),
    })
    return tx
  }
}

/** KICK a target character after proving the acting leader's current ownership. @param {SocialContext} context */
export function party_kick_ptb(context) {
  const { network } = context
  return ({
    party_id,
    leader_kiosk_id,
    leader_personal_kiosk_cap_id,
    leader_character_id,
    target_character_id,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const a = social_ids(network, context.ids?.aresrpg)
    tx.moveCall({
      target: `${a.SOCIAL_LATEST_PACKAGE_ID}::party::kick`,
      typeArguments: [character_type(a)],
      arguments: [
        as_object_arg(tx, party_id),
        as_object_arg(tx, leader_kiosk_id),
        as_object_arg(tx, leader_personal_kiosk_cap_id),
        tx.pure.id(leader_character_id),
        tx.pure.id(target_character_id),
        shared_object_arg(
          tx,
          network,
          'SOCIAL_VERSION',
          false,
          a.SOCIAL_VERSION,
        ),
      ],
    })
    return tx
  }
}

/** DISBAND a solo Party after proving current ownership of its leader. @param {SocialContext} context */
export function party_disband_ptb(context) {
  const { network } = context
  return ({
    party_id,
    leader_kiosk_id,
    leader_personal_kiosk_cap_id,
    leader_character_id,
    tx = new_ptb(context.network, context.ids?.aresrpg),
  }) => {
    const a = social_ids(network, context.ids?.aresrpg)
    append_party_member_action({
      tx,
      package_id: a.SOCIAL_LATEST_PACKAGE_ID,
      action: 'disband',
      party: as_object_arg(tx, party_id),
      kiosk: as_object_arg(tx, leader_kiosk_id),
      personal_kiosk_cap: as_object_arg(tx, leader_personal_kiosk_cap_id),
      character: tx.pure.id(leader_character_id),
      version: shared_object_arg(
        tx,
        network,
        'SOCIAL_VERSION',
        false,
        a.SOCIAL_VERSION,
      ),
      type: character_type(a),
    })
    return tx
  }
}
