// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { BlastRow, SpotProof } from '@aresrpg/immutable/allocation'

// Format owner: blast-v2-contracts sui/presale/sources/{blast_presale,merkle_tree}.move.
const LEAF_DOMAIN = new TextEncoder().encode('\x00blast-presale-v1')
const blake2b256 = (...parts: readonly Uint8Array[]): Uint8Array => {
  const hasher = new Bun.CryptoHasher('blake2b256')
  parts.forEach((part) => hasher.update(part))
  return new Uint8Array(hasher.digest())
}
const u64 = (value: bigint): Uint8Array => {
  const bytes = new Uint8Array(8)
  new DataView(bytes.buffer).setBigUint64(0, value, true)
  return bytes
}
const address_bytes = (address: string): Uint8Array => Uint8Array.from(Buffer.from(address.slice(2), 'hex'))
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')

export const blast_leaf = (index: number, { address, cap_mist }: BlastRow): Uint8Array =>
  blake2b256(LEAF_DOMAIN, u64(BigInt(index)), address_bytes(address), u64(cap_mist))
const node = (left: Uint8Array, right: Uint8Array): Uint8Array => blake2b256(Uint8Array.of(1), left, right)

/** Level 0 is the leaves; an unpaired node pairs with itself, as Blast's reference builder does. */
const levels = (leaves: readonly Uint8Array[]): readonly (readonly Uint8Array[])[] => {
  if (leaves.length === 0) throw new Error('Blast allowlist has no rows')
  if (leaves.length === 1) return [leaves]
  const parents = Array.from({ length: Math.ceil(leaves.length / 2) }, (_, index) =>
    node(leaves[index * 2]!, leaves[index * 2 + 1] ?? leaves[index * 2]!)
  )
  return [leaves, ...levels(parents)]
}

export const blast_allowlist = (rows: readonly BlastRow[]) => {
  const tree = levels(rows.map((row, index) => blast_leaf(index, row)))
  const proof = (address: string): SpotProof | null => {
    const index = rows.findIndex((row) => row.address === address)
    if (index < 0) return null
    const siblings = tree.slice(0, -1).map((level, depth) => {
      const position = index >> depth
      return hex(level[position ^ 1] ?? level[position]!)
    })
    return { index: String(index), cap_mist: String(rows[index]!.cap_mist), siblings }
  }
  return { root: hex(tree.at(-1)![0]!), leaf_count: rows.length, proof }
}
