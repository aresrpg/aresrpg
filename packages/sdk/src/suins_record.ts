// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { bcs } from '@mysten/sui/bcs'
import type { Transaction } from '@mysten/sui/transactions'
import type { PackageInfo, SuinsClient } from '@mysten/suins'

export type NameRecord = NonNullable<Awaited<ReturnType<SuinsClient['getNameRecord']>>>
const record_bcs = bcs.option(
  bcs.struct('NameRecord', {
    nft_id: bcs.Address,
    expiration_timestamp_ms: bcs.u64(),
    target_address: bcs.option(bcs.Address),
    data: bcs.struct('VecMap', {
      contents: bcs.vector(bcs.struct('Entry', { key: bcs.string(), value: bcs.string() })),
    }),
  })
)

/** The SDK reader preserves VecMap insertion order for the supported profile keys. */
export const name_record_bytes = (record: NameRecord | null): Uint8Array =>
  record_bcs
    .serialize(
      record && {
        nft_id: record.nftId,
        expiration_timestamp_ms: record.expirationTimestampMs,
        target_address: record.targetAddress || null,
        data: { contents: Object.entries(record.data).map(([key, value]) => ({ key, value })) },
      }
    )
    .toBytes()

/** Compare the complete record inside the PTB; stale reads must abort before any replacement.
 * Current Sui supports reference-returning public calls. VecMap.remove aborts unless the
 * expected byte vector equals the only inserted key; no custom deployed helper is required. */
export const assert_name_record = (
  transaction: Transaction,
  config: PackageInfo,
  name: string,
  expected: NameRecord | null
): void => {
  const registry = transaction.moveCall({
    target: `${config.packageId}::suins::registry`,
    typeArguments: [`${config.packageIdV1}::registry::Registry`],
    arguments: [transaction.object(config.suins)],
  })
  const domain = transaction.moveCall({
    target: `${config.packageId}::domain::new`,
    arguments: [transaction.pure.string(name)],
  })
  const record = transaction.moveCall({
    target: `${config.packageId}::registry::lookup`,
    arguments: [registry, domain],
  })
  const actual = transaction.moveCall({
    target: '0x1::bcs::to_bytes',
    typeArguments: [`0x1::option::Option<${config.packageIdV1}::name_record::NameRecord>`],
    arguments: [record],
  })
  const type_arguments = ['vector<u8>', 'bool']
  const comparison = transaction.moveCall({ target: '0x2::vec_map::empty', typeArguments: type_arguments })
  transaction.moveCall({
    target: '0x2::vec_map::insert',
    typeArguments: type_arguments,
    arguments: [comparison, actual, transaction.pure.bool(true)],
  })
  transaction.moveCall({
    target: '0x2::vec_map::remove',
    typeArguments: type_arguments,
    arguments: [comparison, transaction.pure.vector('u8', name_record_bytes(expected))],
  })
  transaction.moveCall({
    target: '0x2::vec_map::destroy_empty',
    typeArguments: type_arguments,
    arguments: [comparison],
  })
}
