// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { bcs } from '@mysten/sui/bcs'
import { PublicKey } from '@mysten/sui/cryptography'
import { fromHex } from '@mysten/sui/utils'

const LEAF_DOMAIN = new TextEncoder().encode('aresrpg.zone-group.leaf')
const MEMBER_LEAF_DOMAIN = new TextEncoder().encode(
  'aresrpg.zone-group.member-leaf',
)
const NODE_DOMAIN = new TextEncoder().encode('aresrpg.zone-group.node')
const SET_DOMAIN = new TextEncoder().encode('aresrpg.zone-group.commitment')
const MAX_GROUPS = 64
const HASH_BYTES = 32

// The two commitment shapes `zone_gen::mob_group_commitment_format` reports off a stored root, mirrored by
// `@aresrpg/sim`'s `commitment_format` on the derivation side (this SDK ships no sim dependency, so the byte
// rule is stated once per side of that boundary and pinned to captured chain bytes by test).
const FORMAT_MERKLE = 1 // a bare 32-byte Merkle root — legacy zones, witnessed by a sibling path
const FORMAT_SET = 2 // `0x02 ‖ blake2b256(domain ‖ 0x02 ‖ bcs(MobGroupSet))` — lattice zones, NO tree
// `0x03 ‖ blake2b256(domain ‖ 0x03 ‖ bcs(MobGroupMemberSet))` — MEMBER-LIST zones (#1110): the format-2 whole-set
// discipline with a per-group ROSTER inside the preimage, so the commitment binds WHO is in the pack. Same
// no-tree, empty-proof claim shape as format 2.
const FORMAT_MEMBERS = 3
// `0x04 ‖ merkle_root(member leaves)` — the MEMBER TREE (#2194). Same derived stream as format 3; the
// commitment became a tree, so a claim carries an O(log n) sibling path and the chain never derives the zone.
const FORMAT_MEMBER_TREE = 4
const MAX_MEMBERS = 16

// ID is a one-address-field Move struct, so its BCS bytes are exactly the address bytes.
const mob_group_leaf_bcs = bcs.struct('MobGroupLeaf', {
  world: bcs.Address,
  zx: bcs.u32(),
  zy: bcs.u32(),
  zone_seed: bcs.u64(),
  discovered_at_ms: bcs.u64(),
  index: bcs.u64(),
  spawn_id: bcs.u64(),
  template: bcs.Address,
  x: bcs.u32(),
  z: bcs.u32(),
  group_size: bcs.u16(),
  group_seed: bcs.u64(),
})

// The FORMAT-2 preimage: one whole-set struct, not a per-group leaf (`zone_gen::MobGroupSet`/`MobGroup`).
const mob_group_bcs = bcs.struct('MobGroup', {
  spawn_id: bcs.u64(),
  template: bcs.Address,
  x: bcs.u32(),
  z: bcs.u32(),
  group_size: bcs.u16(),
  group_seed: bcs.u64(),
})

const mob_group_set_bcs = bcs.struct('MobGroupSet', {
  world: bcs.Address,
  zx: bcs.u32(),
  zy: bcs.u32(),
  zone_seed: bcs.u64(),
  discovered_at_ms: bcs.u64(),
  groups: bcs.vector(mob_group_bcs),
})

// The FORMAT-3 preimage (`zone_gen::MobGroupWithMembers`/`MobGroupMemberSet`): the format-2 row plus the
// per-member template list. `template` stays the PRIMARY — the group's identity row and `members[0]`.
const mob_group_with_members_bcs = bcs.struct('MobGroupWithMembers', {
  spawn_id: bcs.u64(),
  template: bcs.Address,
  members: bcs.vector(bcs.Address),
  x: bcs.u32(),
  z: bcs.u32(),
  group_size: bcs.u16(),
  group_seed: bcs.u64(),
})

const mob_group_member_set_bcs = bcs.struct('MobGroupMemberSet', {
  world: bcs.Address,
  zx: bcs.u32(),
  zy: bcs.u32(),
  zone_seed: bcs.u64(),
  discovered_at_ms: bcs.u64(),
  groups: bcs.vector(mob_group_with_members_bcs),
})

// The FORMAT-4 leaf (`zone_gen::MobGroupMemberLeaf`): the format-3 group row plus the zone context, the zone's
// §4 `progress` and the group's stream `index`, so ONE leaf authenticates ONE group. `members` is the SEATING
// roster — the derived roster already truncated to `group_size`, which is what the chain commits and what the
// fight seats.
const mob_group_member_leaf_bcs = bcs.struct('MobGroupMemberLeaf', {
  world: bcs.Address,
  zx: bcs.u32(),
  zy: bcs.u32(),
  zone_seed: bcs.u64(),
  discovered_at_ms: bcs.u64(),
  progress: bcs.u64(),
  index: bcs.u64(),
  spawn_id: bcs.u64(),
  template: bcs.Address,
  members: bcs.vector(bcs.Address),
  x: bcs.u32(),
  z: bcs.u32(),
  group_size: bcs.u16(),
  group_seed: bcs.u64(),
})

const concat_bytes = (...parts) => {
  const out = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0),
  )
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

// @mysten/sui already ships the browser-safe Noble Blake2b implementation used by PublicKey#toSuiAddress.
// Calling that pure digest seam with explicit bytes avoids adding a second hashing dependency to the SDK.
const blake2b_256 = bytes =>
  fromHex(
    PublicKey.prototype.toSuiAddress.call(
      /** @type {any} */ ({ toSuiBytes: () => bytes }),
    ),
  )

const normalized_unsigned = (value, bits, label) => {
  let out
  if (typeof value === 'bigint') out = value
  else if (typeof value === 'number' && Number.isSafeInteger(value))
    out = BigInt(value)
  else if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value))
    out = BigInt(value)
  else throw new Error(`[fight-proof] ${label} must be a safe unsigned integer`)
  if (out < 0n || out > (1n << BigInt(bits)) - 1n)
    throw new Error(`[fight-proof] ${label} must be a u${bits}`)
  return out
}

const normalized_number = (value, bits, label) =>
  Number(normalized_unsigned(value, bits, label))

const normalized_id = (value, label) => {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value))
    throw new Error(`[fight-proof] ${label} must be an object ID`)
  return value
}

const COMMITMENT_SHAPE =
  'group_root must be a 32-byte legacy root, or a 33-byte `0x02 ‖ digest` set / `0x03 ‖ digest` member / `0x04 ‖ root` member-tree commitment'

/**
 * Decode a stored `ZoneGroupCommitment.root` into the derivation it selects — the client twin of
 * `zone_gen::mob_group_commitment_format`. Anything else is a typed failure: an unknown commitment shape is a
 * chain/client version skew, never a witness to guess at.
 * @param {number[]|Uint8Array} value
 * @returns {{ format:1|2|3|4, digest:Uint8Array }}
 */
const normalized_commitment = value => {
  if (!Array.isArray(value) && !(value instanceof Uint8Array))
    throw new Error(`[fight-proof] ${COMMITMENT_SHAPE}`)
  const out = Uint8Array.from(value)
  if (
    Array.from(value).some(
      byte => !Number.isInteger(byte) || byte < 0 || byte > 255,
    )
  )
    throw new Error(`[fight-proof] ${COMMITMENT_SHAPE}`)
  if (out.length === HASH_BYTES) return { format: FORMAT_MERKLE, digest: out }
  if (out.length === HASH_BYTES + 1 && out[0] === FORMAT_SET)
    return { format: FORMAT_SET, digest: out.subarray(1) }
  if (out.length === HASH_BYTES + 1 && out[0] === FORMAT_MEMBERS)
    return { format: FORMAT_MEMBERS, digest: out.subarray(1) }
  if (out.length === HASH_BYTES + 1 && out[0] === FORMAT_MEMBER_TREE)
    return { format: FORMAT_MEMBER_TREE, digest: out.subarray(1) }
  throw new Error(`[fight-proof] ${COMMITMENT_SHAPE}`)
}

/**
 * Whether a SERVED `group_root` is a format-4 member TREE — the only commitment shape with a per-group leaf,
 * hence the only one whose claim door takes an inclusion witness. The door predicate lives HERE, beside the
 * composer that implements it, so a gate and its witness can never disagree about the same bytes. Nothing
 * else gates this door: no flag, no setting, no deployment pin — only the package that ships the door can have
 * written a format-4 root, so the zone's own byte IS the capability probe. A format-1/2/3 root, an absent one
 * or an unknown shape all answer false and keep the whole-zone derivation door.
 * @param {number[]|Uint8Array|null|undefined} group_root
 */
export const is_member_tree_commitment = group_root => {
  try {
    return normalized_commitment(group_root).format === FORMAT_MEMBER_TREE
  } catch {
    return false
  }
}

const bytes_equal = (left, right) =>
  left.length === right.length &&
  left.every((byte, index) => byte === right[index])

/**
 * Serialize the exact `zone_gen::MobGroupLeaf` BCS layout. Exported as a parity/audit seam; the proof producer
 * hashes these bytes after the pinned leaf domain.
 * @param {{ world_id:string, zx:number, zy:number, zone_seed:string|number|bigint,
 *   discovered_at_ms:string|number|bigint, index:number, spawn_id:string|number|bigint,
 *   template_id:string, x:number, z:number, group_size:number, group_seed:string|number|bigint }} leaf
 * @returns {Uint8Array}
 */
export function mob_group_leaf_bytes({
  world_id,
  zx,
  zy,
  zone_seed,
  discovered_at_ms,
  index,
  spawn_id,
  template_id,
  x,
  z,
  group_size,
  group_seed,
}) {
  return mob_group_leaf_bcs
    .serialize({
      world: normalized_id(world_id, 'world_id'),
      zx: normalized_number(zx, 32, 'zx'),
      zy: normalized_number(zy, 32, 'zy'),
      zone_seed: normalized_unsigned(zone_seed, 64, 'zone_seed'),
      discovered_at_ms: normalized_unsigned(
        discovered_at_ms,
        64,
        'discovered_at_ms',
      ),
      index: normalized_unsigned(index, 64, 'index'),
      spawn_id: normalized_unsigned(spawn_id, 64, 'spawn_id'),
      template: normalized_id(template_id, 'template_id'),
      x: normalized_number(x, 32, 'x'),
      z: normalized_number(z, 32, 'z'),
      group_size: normalized_number(group_size, 16, 'group_size'),
      group_seed: normalized_unsigned(group_seed, 64, 'group_seed'),
    })
    .toBytes()
}

/**
 * Serialize the exact `zone_gen::MobGroupSet` BCS layout — the FORMAT-2 commitment preimage's payload. Exported
 * as a parity/audit seam beside {@link mob_group_leaf_bytes}; groups are the FULL derivation stream in stream
 * order (the set commitment covers every search-time group, consumed siblings included).
 * @param {{ world_id:string, zx:number, zy:number, zone_seed:string|number|bigint,
 *   discovered_at_ms:string|number|bigint, groups:Array<{ spawn_id:string|number|bigint, template_id:string,
 *     x:number, z:number, size:number, group_seed:string|number|bigint }> }} set
 * @returns {Uint8Array}
 */
export function mob_group_set_bytes({
  world_id,
  zx,
  zy,
  zone_seed,
  discovered_at_ms,
  groups,
}) {
  return mob_group_set_bcs
    .serialize({
      world: normalized_id(world_id, 'world_id'),
      zx: normalized_number(zx, 32, 'zx'),
      zy: normalized_number(zy, 32, 'zy'),
      zone_seed: normalized_unsigned(zone_seed, 64, 'zone_seed'),
      discovered_at_ms: normalized_unsigned(
        discovered_at_ms,
        64,
        'discovered_at_ms',
      ),
      groups: groups.map((group, position) => ({
        spawn_id: normalized_unsigned(
          group.spawn_id,
          64,
          `groups[${position}].spawn_id`,
        ),
        template: normalized_id(
          group.template_id,
          `groups[${position}].template_id`,
        ),
        x: normalized_number(group.x, 32, `groups[${position}].x`),
        z: normalized_number(group.z, 32, `groups[${position}].z`),
        group_size: normalized_number(
          group.size,
          16,
          `groups[${position}].size`,
        ),
        group_seed: normalized_unsigned(
          group.group_seed,
          64,
          `groups[${position}].group_seed`,
        ),
      })),
    })
    .toBytes()
}

/**
 * Serialize the exact `zone_gen::MobGroupMemberSet` BCS layout — the FORMAT-3 commitment preimage's payload.
 * Identical to {@link mob_group_set_bytes} except each group also carries its per-member template roster, which
 * is what makes the commitment bind the pack's COMPOSITION and not merely its size. `members` is the FULL
 * derived roster (the raw rolled size, capped at the kernel's MAX_MEMBERS) — never the team-bound-clamped
 * spawn count, which is a live dial and would make the commitment un-reproducible.
 * @param {{ world_id:string, zx:number, zy:number, zone_seed:string|number|bigint,
 *   discovered_at_ms:string|number|bigint, groups:Array<{ spawn_id:string|number|bigint, template_id:string,
 *     member_template_ids:string[], x:number, z:number, size:number, group_seed:string|number|bigint }> }} set
 * @returns {Uint8Array}
 */
export function mob_group_member_set_bytes({
  world_id,
  zx,
  zy,
  zone_seed,
  discovered_at_ms,
  groups,
}) {
  return mob_group_member_set_bcs
    .serialize({
      world: normalized_id(world_id, 'world_id'),
      zx: normalized_number(zx, 32, 'zx'),
      zy: normalized_number(zy, 32, 'zy'),
      zone_seed: normalized_unsigned(zone_seed, 64, 'zone_seed'),
      discovered_at_ms: normalized_unsigned(
        discovered_at_ms,
        64,
        'discovered_at_ms',
      ),
      groups: groups.map((group, position) => ({
        spawn_id: normalized_unsigned(
          group.spawn_id,
          64,
          `groups[${position}].spawn_id`,
        ),
        template: normalized_id(
          group.template_id,
          `groups[${position}].template_id`,
        ),
        members: (group.member_template_ids ?? []).map((id, slot) =>
          normalized_id(id, `groups[${position}].member_template_ids[${slot}]`),
        ),
        x: normalized_number(group.x, 32, `groups[${position}].x`),
        z: normalized_number(group.z, 32, `groups[${position}].z`),
        group_size: normalized_number(
          group.size,
          16,
          `groups[${position}].size`,
        ),
        group_seed: normalized_unsigned(
          group.group_seed,
          64,
          `groups[${position}].group_seed`,
        ),
      })),
    })
    .toBytes()
}

/**
 * Serialize the exact `zone_gen::MobGroupMemberLeaf` BCS layout — the FORMAT-4 leaf preimage's payload.
 * Exported as a parity/audit seam beside {@link mob_group_leaf_bytes}.
 * @param {{ world_id:string, zx:number, zy:number, zone_seed:string|number|bigint,
 *   discovered_at_ms:string|number|bigint, progress:string|number|bigint, index:number,
 *   spawn_id:string|number|bigint, template_id:string, member_template_ids:string[], x:number, z:number,
 *   group_size:number, group_seed:string|number|bigint }} leaf
 * @returns {Uint8Array}
 */
export function mob_group_member_leaf_bytes({
  world_id,
  zx,
  zy,
  zone_seed,
  discovered_at_ms,
  progress,
  index,
  spawn_id,
  template_id,
  member_template_ids,
  x,
  z,
  group_size,
  group_seed,
}) {
  const roster = member_template_ids ?? []
  if (roster.length > MAX_MEMBERS)
    throw new Error(
      `[fight-proof] member_template_ids exceeds the kernel roster rail (${MAX_MEMBERS})`,
    )
  return mob_group_member_leaf_bcs
    .serialize({
      world: normalized_id(world_id, 'world_id'),
      zx: normalized_number(zx, 32, 'zx'),
      zy: normalized_number(zy, 32, 'zy'),
      zone_seed: normalized_unsigned(zone_seed, 64, 'zone_seed'),
      discovered_at_ms: normalized_unsigned(
        discovered_at_ms,
        64,
        'discovered_at_ms',
      ),
      progress: normalized_unsigned(progress, 64, 'progress'),
      index: normalized_unsigned(index, 64, 'index'),
      spawn_id: normalized_unsigned(spawn_id, 64, 'spawn_id'),
      template: normalized_id(template_id, 'template_id'),
      members: roster.map((id, slot) =>
        normalized_id(id, `member_template_ids[${slot}]`),
      ),
      x: normalized_number(x, 32, 'x'),
      z: normalized_number(z, 32, 'z'),
      group_size: normalized_number(group_size, 16, 'group_size'),
      group_seed: normalized_unsigned(group_seed, 64, 'group_seed'),
    })
    .toBytes()
}

// The FORMAT-2 digest: ONE hash over the whole set, domain-separated and format-tagged exactly as
// `zone_gen::mob_group_commitment` builds it before prefixing the tag byte.
const set_digest = (context, groups) =>
  blake2b_256(
    concat_bytes(
      SET_DOMAIN,
      Uint8Array.from([FORMAT_SET]),
      mob_group_set_bytes({ ...context, groups }),
    ),
  )

// The FORMAT-3 digest — the same one-hash-over-the-whole-set shape, over the member-list preimage and tagged
// 0x03, exactly as `zone_gen::mob_group_commitment_members` builds it.
const member_set_digest = (context, groups) =>
  blake2b_256(
    concat_bytes(
      SET_DOMAIN,
      Uint8Array.from([FORMAT_MEMBERS]),
      mob_group_member_set_bytes({ ...context, groups }),
    ),
  )

const leaf_hash = (context, group) =>
  blake2b_256(
    concat_bytes(
      LEAF_DOMAIN,
      mob_group_leaf_bytes({
        ...context,
        ...group,
        group_size: group.size,
      }),
    ),
  )

const member_leaf_hash = (context, group) =>
  blake2b_256(
    concat_bytes(
      MEMBER_LEAF_DOMAIN,
      mob_group_member_leaf_bytes({
        ...context,
        ...group,
        group_size: group.size,
      }),
    ),
  )

const node_hash = (left, right) =>
  blake2b_256(concat_bytes(NODE_DOMAIN, left, right))

const next_level = nodes => {
  const next = []
  for (let i = 0; i < nodes.length; i += 2)
    next.push(node_hash(nodes[i], nodes[i + 1] ?? nodes[i]))
  return next
}

const root_of = leaves => {
  if (leaves.length === 0)
    return blake2b_256(new TextEncoder().encode('aresrpg.zone-group.empty'))
  let nodes = leaves
  while (nodes.length > 1) nodes = next_level(nodes)
  return nodes[0]
}

const proof_of = (leaves, target_index) => {
  const proof = []
  let index = target_index
  let nodes = leaves
  while (nodes.length > 1) {
    const sibling =
      index % 2 === 1 ? index - 1 : index + 1 < nodes.length ? index + 1 : index
    proof.push(...nodes[sibling])
    nodes = next_level(nodes)
    index = Math.floor(index / 2)
  }
  return proof
}

const proof_root = (leaf, proof, target_index) => {
  let digest = leaf
  let index = target_index
  for (let offset = 0; offset < proof.length; offset += HASH_BYTES) {
    const sibling = Uint8Array.from(proof.slice(offset, offset + HASH_BYTES))
    digest =
      index % 2 === 0 ? node_hash(digest, sibling) : node_hash(sibling, digest)
    index = Math.floor(index / 2)
  }
  return digest
}

/**
 * A complete authenticated mob-group witness accepted by `create_fight_ptb`.
 * @typedef {object} MobGroupProof
 * @property {number} index
 * @property {{ spawn_id:string, template_id:string, x:number, z:number, group_size:number, group_seed:string,
 *   member_template_ids?:string[], progress?:number }} facts  the roster and progress ride only on a format-4
 *   witness — they are what its leaf binds, and what the member claim door takes
 * @property {number[]} proof flattened 32-byte sibling hashes — EMPTY on a format-2 (lattice) or format-3
 *   (member-list) zone, whose commitment is a whole-set hash the chain re-derives rather than a tree
 */

/**
 * The witness bytes the claim door accepts for THIS commitment shape, or `null` when the locally rebuilt stream
 * does not reproduce the stored commitment (fail shut — the caller keeps the derivation door).
 *
 * FORMAT 4 (member tree, `0x04 ‖ root`): a real Merkle tree over per-group leaves — the ONLY format whose proof
 * saves the chain the whole derivation. The leaf binds the roster and the zone's `progress`, so a claimant can
 * neither swap in a softer species nor dial the level window down.
 * FORMAT 3 (member list, `0x03 ‖ digest`): the format-2 shape over a preimage that also carries each group's
 * member roster — same whole-set hash, same EMPTY proof vector, and reproducing it here proves our stream
 * agrees with the chain about WHO is in the pack, not just how many.
 * FORMAT 2 (lattice, `0x02 ‖ digest`): there is NO Merkle tree. `zone_gen::mob_group_commitment` hashes the whole
 * `MobGroupSet` once, and `zones::resolve_mob_group` re-derives the stream on-chain to compare it — so the door
 * takes an EMPTY proof vector and aborts 110 (`EBadGroupProof`) on a non-empty one. Reproducing the digest here is
 * still what makes the witness honest: it proves our stream is the chain's stream before we name a group.
 * FORMAT 1 (legacy, bare 32-byte root): the duplicate-last sibling path, replay-verified before it is handed out.
 * @returns {number[]|null}
 */
const commitment_proof = (commitment, context, groups, target_index) => {
  if (commitment.format === FORMAT_MEMBER_TREE) {
    const leaves = groups.map(group => member_leaf_hash(context, group))
    if (!bytes_equal(root_of(leaves), commitment.digest)) return null
    const proof = proof_of(leaves, target_index)
    return bytes_equal(
      proof_root(leaves[target_index], proof, target_index),
      commitment.digest,
    )
      ? proof
      : null
  }
  if (commitment.format === FORMAT_MEMBERS)
    return bytes_equal(member_set_digest(context, groups), commitment.digest)
      ? []
      : null
  if (commitment.format === FORMAT_SET)
    return bytes_equal(set_digest(context, groups), commitment.digest)
      ? []
      : null
  const leaves = groups.map(group => leaf_hash(context, group))
  if (!bytes_equal(root_of(leaves), commitment.digest)) return null
  const proof = proof_of(leaves, target_index)
  return bytes_equal(
    proof_root(leaves[target_index], proof, target_index),
    commitment.digest,
  )
    ? proof
    : null
}

/**
 * Compose the claim witness from the FULL `@aresrpg/sim` derived mob-row stream — a Merkle path on a legacy zone,
 * an empty vector on a lattice zone (see {@link commitment_proof}). This fails shut:
 * malformed facts, a filtered/reordered row set, or any count/root mismatch returns `null`, so callers retain the
 * original derivation door. A returned witness has also been replay-verified locally against the chain commitment.
 * @param {{ world_id:string, zx:number, zy:number, zone_seed:string|number|bigint,
 *   discovered_at_ms:string|number|bigint, group_root:number[]|Uint8Array, group_count:number,
 *   groups:Array<{ index:number, spawn_id:string|number|bigint, template_id:string, x:number, z:number,
 *     size:number, group_seed:string|number|bigint, member_template_ids?:string[],
 *     progress?:number|string|bigint }>, index:number,
 *   progress?:number|string|bigint }} input
 *   `member_template_ids` is the group's per-member roster and `progress` the zone's §4 difficulty — REQUIRED on
 *   a format-3 (member-list) or format-4 (member-tree) zone, whose commitments cover them, and ignored by the
 *   format-1/2 digests. `progress` is zone-level: pass it at the top or let it read off the rows (which is where
 *   {@link proof_group_of} puts it).
 * @returns {MobGroupProof|null}
 */
export function compose_mob_group_proof(input) {
  try {
    const {
      world_id,
      zx,
      zy,
      zone_seed,
      discovered_at_ms,
      group_root,
      group_count,
      groups,
      index,
      progress,
    } = input ?? {}
    if (
      !Array.isArray(groups) ||
      groups.length === 0 ||
      groups.length > MAX_GROUPS
    )
      return null
    const count = normalized_number(group_count, 64, 'group_count')
    const target_index = normalized_number(index, 64, 'index')
    if (count !== groups.length || target_index >= count) return null
    // Progress is ZONE-level, so a stream built by {@link proof_group_of} already carries it on every row; an
    // explicit input still wins (the frozen vectors name it directly). Absent on both ⇒ the format-1/2 zones
    // whose digests never read it.
    const zone_progress = progress ?? groups[0]?.progress ?? 0
    const context = {
      world_id,
      zx,
      zy,
      zone_seed,
      discovered_at_ms,
      progress: zone_progress,
    }
    const normalized_groups = groups.map((group, position) => {
      if (
        normalized_number(group?.index, 64, `groups[${position}].index`) !==
        position
      )
        throw new Error(
          '[fight-proof] groups must be the complete derivation stream',
        )
      return {
        index: position,
        spawn_id: normalized_unsigned(
          group.spawn_id,
          64,
          `groups[${position}].spawn_id`,
        ).toString(),
        template_id: normalized_id(
          group.template_id,
          `groups[${position}].template_id`,
        ),
        x: normalized_number(group.x, 32, `groups[${position}].x`),
        z: normalized_number(group.z, 32, `groups[${position}].z`),
        size: normalized_number(group.size, 16, `groups[${position}].size`),
        group_seed: normalized_unsigned(
          group.group_seed,
          64,
          `groups[${position}].group_seed`,
        ).toString(),
        // format-3 only; absent on a format-1/2 stream and unread by their digests
        member_template_ids: (group.member_template_ids ?? []).map((id, slot) =>
          normalized_id(id, `groups[${position}].member_template_ids[${slot}]`),
        ),
      }
    })
    const commitment = normalized_commitment(group_root)
    const proof = commitment_proof(
      commitment,
      context,
      normalized_groups,
      target_index,
    )
    if (proof == null) return null
    const group = normalized_groups[target_index]
    return {
      index: target_index,
      facts: {
        spawn_id: group.spawn_id,
        template_id: group.template_id,
        x: group.x,
        z: group.z,
        group_size: group.size,
        group_seed: group.group_seed,
        // format 4 alone commits them per group, and its claim door is the only one that takes them
        ...(commitment.format === FORMAT_MEMBER_TREE
          ? {
              member_template_ids: group.member_template_ids,
              progress: normalized_number(zone_progress, 64, 'progress'),
            }
          : {}),
      },
      proof,
    }
  } catch {
    return null
  }
}

const same_unsigned = (left, right) => {
  try {
    return BigInt(left) === BigInt(right)
  } catch {
    return false
  }
}

/** A consumed derivation index on the SERVED live bitmap (bit i of byte i>>3) can never be claimed. */
const bit_consumed = (bitmap, index) =>
  ((Number(bitmap?.[index >> 3] ?? 0) >> (index & 7)) & 1) !== 0

/**
 * THE one translation of a `@aresrpg/sim` `derive_zone` mob ROW into a {@link compose_mob_group_proof} group.
 * The two shapes disagree on exactly two names — the sim calls the seating roster `members` and carries the
 * zone's `progress` per row — and a caller that re-spells that mapping locally is one reroll away from
 * composing witnesses the chain rejects. Every witness producer goes through here: {@link mob_group_witness}
 * for callers that let it derive, and clients that already hold their own derived stream.
 * @param {{ index:number, spawn_id:string, template_id:string, x:number, z:number, size:number,
 *   group_seed:string, members?:string[], progress?:number }} row
 */
export const proof_group_of = row => ({
  index: row.index,
  spawn_id: row.spawn_id,
  template_id: row.template_id,
  x: row.x,
  z: row.z,
  size: row.size,
  group_seed: row.group_seed,
  // the SEATING roster the member commitments bind — dropping it here is what made every member-zone
  // witness fail shut against its own chain digest
  member_template_ids: row.members ?? [],
  progress: row.progress ?? 0,
})

/**
 * PRODUCE a verified {@link MobGroupProof} for `create_fight_ptb` from the `/v1`-served ingredients — the
 * fight-create compute diet's client leg (577.8M → 7.32M MIST computation through the proof door; localnet
 * rehearsal 2026-07-17, digest 9nUaG4hFWgYk4tCto4EE5N634Tj2vaAWkiBrB82HShds).
 *
 * Ingredients (the caller fetches/caches them — this stays pure and sync):
 * - `zone`: the `/v1/zones?world=&zone=zx:zy` single-zone STATE doc (`seed` string, `discovered_at_ms`,
 *   `mob_bitmap`, `group_root`, `group_count`). Fetch it FRESH at compose time; the dryRun preflight
 *   absorbs any residual chain lag pre-sign.
 * - `world`: the world spawn-table doc + `team_bound` (clients already cache both for rendering).
 * - `derive_zone`: the injected `@aresrpg/sim` derivation — the published SDK ships NO sim dependency
 *   (one-way boundary), so the client hands over the mirror it already bundles.
 *
 * The derivation stream is rebuilt with EMPTY bitmaps by law: the chain commitment spans every search-time
 * group — consumption is the claim door's occupancy check, never a tree mutation (a live-filtered stream can
 * never re-root; the composer refuses it). Select the target by `index`, by `spawn_id` (unique match, the
 * click shape), or both (cross-checked); an optional `mob_template_id` guards against a stale render.
 *
 * Returns `null` — the ORIGINAL derivation door — whenever any ingredient is unavailable (pre-diet zone,
 * snapshot lag, undiscovered zone, consumed target, root mismatch): fight-create degrades, never breaks.
 * Missing `derive_zone` or selector is a programmer error and THROWS (never a silent old-door forever).
 * The DOOR choice itself is NOT decided here: `create_fight_ptb` gates the proof path on the deployment
 * manifest's stamped `ZONE_GROUP_ROOT_PACKAGE_ID` (advisor pass-67 — old door is the silent default; a
 * witness composed for an unstamped network is simply ignored at the composer).
 * @param {{ world_id:string, zx:number, zy:number,
 *   zone:{ seed?:string|number|bigint, discovered_at_ms?:number, mob_bitmap?:number[],
 *     group_root?:number[]|Uint8Array|null, group_count?:number|null }|null|undefined,
 *   world:object|null|undefined, team_bound?:number,
 *   derive_zone:(input:{ zone:{ seed:string|number|bigint, discovered_at_ms:number, mob_bitmap:number[],
 *     res_bitmap:number[], group_root?:number[]|Uint8Array|null }, zx:number, zy:number, world:object,
 *     team_bound:number }) =>
 *     Array<{ kind:string, index:number, spawn_id:string, template_id:string, x:number, z:number,
 *       size:number, group_seed:string, members?:string[], progress?:number }>,
 *   index?:number|string|bigint|null, spawn_id?:number|string|bigint|null,
 *   mob_template_id?:string|null }} input
 * @returns {MobGroupProof|null}
 */
export function mob_group_witness({
  world_id,
  zx,
  zy,
  zone,
  world,
  team_bound = 6,
  derive_zone,
  index = null,
  spawn_id = null,
  mob_template_id = null,
}) {
  if (typeof derive_zone !== 'function')
    throw new Error(
      '[fight-proof] mob_group_witness requires the injected @aresrpg/sim derive_zone (the SDK ships no sim dependency)',
    )
  if (index == null && spawn_id == null)
    throw new Error(
      '[fight-proof] mob_group_witness requires index or spawn_id',
    )
  try {
    if (
      zone?.seed == null ||
      zone.group_root == null ||
      zone.group_count == null ||
      world == null
    )
      return null
    // The FULL derivation stream — EMPTY bitmaps (never the live-filtered render rows).
    const groups = derive_zone({
      zone: {
        seed: zone.seed,
        discovered_at_ms: Number(zone.discovered_at_ms ?? 0),
        mob_bitmap: [],
        res_bitmap: [],
        // The commitment root PICKS the derivation (lattice vs legacy placement) — dropping it here derived a
        // different world than the chain's and the composer then failed shut on every lattice zone.
        group_root: zone.group_root,
      },
      zx,
      zy,
      world,
      team_bound,
    })
      .filter(row => row.kind === 'mob')
      .map(proof_group_of)
    const matches =
      spawn_id != null
        ? groups.filter(group => same_unsigned(group.spawn_id, spawn_id))
        : groups.filter(group => same_unsigned(group.index, index))
    if (matches.length !== 1) return null
    const [target] = matches
    if (index != null && !same_unsigned(target.index, index)) return null
    if (
      mob_template_id != null &&
      !same_unsigned(target.template_id, mob_template_id)
    )
      return null
    if (bit_consumed(zone.mob_bitmap, target.index)) return null
    return compose_mob_group_proof({
      world_id,
      zx,
      zy,
      zone_seed: zone.seed,
      discovered_at_ms: zone.discovered_at_ms,
      group_root: zone.group_root,
      group_count: zone.group_count,
      groups,
      index: target.index,
    })
  } catch {
    return null
  }
}
