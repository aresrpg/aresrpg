// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { bcs } from '@mysten/sui/bcs'
import { PublicKey } from '@mysten/sui/cryptography'
import { fromHex } from '@mysten/sui/utils'

const LEAF_DOMAIN = new TextEncoder().encode('aresrpg.zone-group.leaf')
const NODE_DOMAIN = new TextEncoder().encode('aresrpg.zone-group.node')
const COMMITMENT_DOMAIN = new TextEncoder().encode(
  'aresrpg.zone-group.commitment',
)
const MAX_GROUPS = 64
const HASH_BYTES = 32
const FLAT_FORMAT = 2

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

const normalized_commitment = value => {
  if (!Array.isArray(value) && !(value instanceof Uint8Array))
    throw new Error('[fight-proof] group_root must be a supported commitment')
  const out = Uint8Array.from(value)
  if (
    (out.length !== HASH_BYTES &&
      !(out.length === HASH_BYTES + 1 && out[0] === FLAT_FORMAT)) ||
    Array.from(value).some(
      byte => !Number.isInteger(byte) || byte < 0 || byte > 255,
    )
  )
    throw new Error('[fight-proof] group_root must be a supported commitment')
  return out
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

const normalized_groups = groups =>
  groups.map((group, position) => {
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
    }
  })

const flat_commitment = (context, groups) => {
  const payload = mob_group_set_bcs
    .serialize({
      world: normalized_id(context.world_id, 'world_id'),
      zx: normalized_number(context.zx, 32, 'zx'),
      zy: normalized_number(context.zy, 32, 'zy'),
      zone_seed: normalized_unsigned(context.zone_seed, 64, 'zone_seed'),
      discovered_at_ms: normalized_unsigned(
        context.discovered_at_ms,
        64,
        'discovered_at_ms',
      ),
      groups: groups.map(group => ({
        spawn_id: group.spawn_id,
        template: group.template_id,
        x: group.x,
        z: group.z,
        group_size: group.size,
        group_seed: group.group_seed,
      })),
    })
    .toBytes()
  return concat_bytes(
    Uint8Array.of(FLAT_FORMAT),
    blake2b_256(
      concat_bytes(COMMITMENT_DOMAIN, Uint8Array.of(FLAT_FORMAT), payload),
    ),
  )
}

/** Serialize and hash the flat all-groups commitment exactly as `zone_gen::mob_group_commitment`. */
export function mob_group_commitment_bytes({ groups, ...context }) {
  if (!Array.isArray(groups) || groups.length > MAX_GROUPS)
    throw new Error(
      '[fight-proof] groups must be the complete derivation stream',
    )
  return flat_commitment(context, normalized_groups(groups))
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
 * @property {{ spawn_id:string, template_id:string, x:number, z:number,
 *   group_size:number, group_seed:string }} facts
 * @property {number[]} proof flattened 32-byte sibling hashes
 */

/**
 * Compose a commitment witness from the FULL `@aresrpg/sim` derived mob-row stream. Flat commitments re-hash the
 * ordered BCS set once and carry an empty proof; historical roots retain their duplicate-last Merkle witness.
 * Malformed facts, a filtered/reordered row set, or any count/root mismatch returns `null`.
 * @param {{ world_id:string, zx:number, zy:number, zone_seed:string|number|bigint,
 *   discovered_at_ms:string|number|bigint, group_root:number[]|Uint8Array, group_count:number,
 *   groups:Array<{ index:number, spawn_id:string|number|bigint, template_id:string, x:number, z:number,
 *     size:number, group_seed:string|number|bigint }>, index:number }} input
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
    const context = { world_id, zx, zy, zone_seed, discovered_at_ms }
    const normalized_group_set = normalized_groups(groups)
    const committed_root = normalized_commitment(group_root)
    const group = normalized_group_set[target_index]
    if (
      bytes_equal(
        flat_commitment(context, normalized_group_set),
        committed_root,
      )
    )
      return {
        index: target_index,
        facts: {
          spawn_id: group.spawn_id,
          template_id: group.template_id,
          x: group.x,
          z: group.z,
          group_size: group.size,
          group_seed: group.group_seed,
        },
        proof: [],
      }
    if (committed_root.length !== HASH_BYTES) return null
    const leaves = normalized_group_set.map(group => leaf_hash(context, group))
    if (!bytes_equal(root_of(leaves), committed_root)) return null
    const proof = proof_of(leaves, target_index)
    if (
      !bytes_equal(
        proof_root(leaves[target_index], proof, target_index),
        committed_root,
      )
    )
      return null
    return {
      index: target_index,
      facts: {
        spawn_id: group.spawn_id,
        template_id: group.template_id,
        x: group.x,
        z: group.z,
        group_size: group.size,
        group_seed: group.group_seed,
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
 *     res_bitmap:number[], group_root:number[]|Uint8Array }, zx:number, zy:number, world:object, team_bound:number }) =>
 *     Array<{ kind:string, index:number, spawn_id:string, template_id:string, x:number, z:number,
 *       size:number, group_seed:string }>,
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
        group_root: zone.group_root,
      },
      zx,
      zy,
      world,
      team_bound,
    })
      .filter(row => row.kind === 'mob')
      .map(row => ({
        index: row.index,
        spawn_id: row.spawn_id,
        template_id: row.template_id,
        x: row.x,
        z: row.z,
        size: row.size,
        group_seed: row.group_seed,
      }))
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
