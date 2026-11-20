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
const from_hex = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, 'hex'))

export const blast_leaf = (index: number, { address, cap_mist }: BlastRow): Uint8Array =>
  blake2b256(LEAF_DOMAIN, u64(BigInt(index)), from_hex(address.slice(2)), u64(cap_mist))
const node = (left: Uint8Array, right: Uint8Array): Uint8Array => blake2b256(Uint8Array.of(1), left, right)

/** The root one wallet's proof commits to, folded as the chain folds it. Blast holds the full list
 * and issues the proofs; a proof is accepted here only when this equals the sale's on-chain root. */
export const blast_proof_root = (address: string, proof: SpotProof): string => {
  const index = Number(proof.index)
  const leaf = blast_leaf(index, { address, cap_mist: BigInt(proof.cap_mist) })
  const root = proof.siblings.reduce((current, sibling, depth) => {
    const other = from_hex(sibling)
    return (index >> depth) & 1 ? node(other, current) : node(current, other)
  }, leaf)
  return Buffer.from(root).toString('hex')
}
