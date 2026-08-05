// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import parity from './zone_members_format3_parity.json' with { type: 'json' }

// THE MEMBER-TREE (format-4) WITNESS — one test-only home for every JS consumer. The parity stream below is
// derived by packages/sim/src/zone_derive.js::derive_mob_groups_members and asserted, row for row, by
// aresrpg_foundation::zone_gen_members_tests (Move). Its geometry is live testnet zone 487:487; the tables are
// the ruled equal-rate model (#1111) with row 2 marked BOSS. The #2227 client door was also checked against live
// testnet zone 488:487.
//
// GROUND TRUTH — pinned identically by the Move suite:
//   0x04 ‖ merkle_root(blake2b256("aresrpg.zone-group.member-leaf" ‖ bcs(MobGroupMemberLeaf)))
// `aresrpg_foundation::zone_gen_members_tests::the_member_tree_proves_one_group_without_the_zone` produces the
// same 33-byte root and 128-byte group-0 path. If the BCS field order, leaf domain, tree shape, or tag byte drifts
// on either side, a client composes witnesses the chain will never accept.
export const member_tree_witness = {
  root_hex:
    '045f45b05f1c2c39b05a521e67edd816b953bd28f6006cc6969a88bba87ab0ef15',
  proof_hex:
    '2363f31e53651f2a7615011ff6bfee5f24fca9907fec6bd77b901cdfa167ffda7d56bc6f9d7fa809831086aae5063191b4d54489f54214bddb0324cd7b5fe0ad3ba5f1affcbd4930f0c221682132603cbcef917128ec55d97234a4d587e3ae5002d11e199e560fce3175e16a11b8cddff33a942a15ad94c396f35fa167e63986',
  world_id: '0xbe3f',
  zx: 487,
  zy: 487,
  zone_seed: parity.inputs.seed,
  discovered_at_ms: '1784980009967',
  progress: 613,
  templates: [1, 2, 3, 4, 5].map(n => `0x${n.toString(16).padStart(64, '0')}`),
}

export const zone_members_parity = parity

/** The parity stream in the format-4 witness composer's group shape. */
export const member_tree_groups = () =>
  parity.groups.map((group, index) => ({
    index,
    spawn_id: group.spawn_id,
    template_id: member_tree_witness.templates[group.template_idx],
    // The SEATING roster: the derived roster truncated to the group's size, exactly what the chain commits.
    member_template_ids: group.members
      .slice(0, group.size)
      .map(slot => member_tree_witness.templates[slot]),
    x: group.x,
    z: group.z,
    size: group.size,
    group_seed: String(group.group_seed),
  }))

/** The same parity stream in derive_zone row shape, as rows_from_state hands it to the client door. */
export const member_tree_rows = () =>
  member_tree_groups().map(group => ({
    kind: 'mob',
    index: group.index,
    spawn_id: group.spawn_id,
    template_id: group.template_id,
    x: group.x,
    z: group.z,
    size: group.size,
    group_seed: group.group_seed,
    members: group.member_template_ids,
    progress: member_tree_witness.progress,
  }))
