// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The interpreter of the generated door tables (doors.gen.ts, seed_doors.gen.ts): each line names one Move
// call and its pre-resolved arguments; binding a table to an SDK context yields `doors.<name>(tx, args)`.

import type {
  Transaction,
  TransactionArgument,
  TransactionObjectArgument,
  TransactionResult,
} from '@mysten/sui/transactions'

import type { Pins } from './pins.ts'
import { kares_coin_type } from './kares_ptb.ts'

/** What the resolver accepts: a bare id (cache-resolved), an explicit ref, or an in-PTB value. */
export type Resolvable =
  | string
  | { objectId: string; version: string; digest: string }
  | { objectId: string; initialSharedVersion: string }
  | TransactionObjectArgument

/** The composition context every generated door receives. */
export type DoorCtx = {
  pins: Pins
  /** Addresses that NAME published types on-chain (first-publish ids) — never move-call targets. */
  game_type_package: string | null
  math_type_package: string | null
  obj: (tx: Transaction, value: Resolvable, mutable: boolean) => TransactionObjectArgument
  pin: (tx: Transaction, key: string, mutable: boolean) => TransactionObjectArgument
  receiving: (tx: Transaction, value: Resolvable) => TransactionObjectArgument
  pure: {
    id: (tx: Transaction, value: string) => TransactionArgument
    address: (tx: Transaction, value: string) => TransactionArgument
    bool: (tx: Transaction, value: boolean) => TransactionArgument
    u8: (tx: Transaction, value: number) => TransactionArgument
    u16: (tx: Transaction, value: number) => TransactionArgument
    u32: (tx: Transaction, value: number) => TransactionArgument
    u64: (tx: Transaction, value: bigint | number | string) => TransactionArgument
    string: (tx: Transaction, value: string) => TransactionArgument
    option: (tx: Transaction, type: string, value: unknown) => TransactionArgument
    vector: (tx: Transaction, type: string, value: readonly unknown[]) => TransactionArgument
  }
}

type DoorArgument = (tx: Transaction, ctx: DoorCtx, value: never, name: string) => TransactionArgument
export const PURE_KINDS = ['id', 'address', 'bool', 'u8', 'u16', 'u32', 'u64', 'string'] as const
/** Every argument kind a generated door line names; see scripts/generate_doors.mjs. */
const DOOR_ARGUMENTS: Readonly<Record<string, DoorArgument>> = {
  clock: (tx) => tx.object.clock(),
  random: (tx) => tx.object.random(),
  pin: (tx, ctx, _value, name) => ctx.pin(tx, name, false),
  'pin!': (tx, ctx, _value, name) => ctx.pin(tx, name, true),
  obj: (tx, ctx, value) => ctx.obj(tx, value, false),
  'obj!': (tx, ctx, value) => ctx.obj(tx, value, true),
  receiving: (tx, ctx, value) => ctx.receiving(tx, value),
  value: (_tx, _ctx, value) => value,
  ...Object.fromEntries(
    PURE_KINDS.flatMap((type) => [
      [type, (tx: Transaction, ctx: DoorCtx, value: never) => ctx.pure[type](tx, value)],
      [`${type}?`, (tx: Transaction, ctx: DoorCtx, value: unknown) => ctx.pure.option(tx, type, value ?? null)],
      [`${type}[]`, (tx: Transaction, ctx: DoorCtx, value: readonly unknown[]) => ctx.pure.vector(tx, type, value)],
    ])
  ),
}
// `<type package>::<module>::<Type>[]`: a vector of in-PTB Move values, named by their defining package.
const move_vector: DoorArgument = (tx, ctx, value: readonly TransactionObjectArgument[], kind) => {
  const [package_key, ...path] = kind.slice(0, -2).split('::') as ['game_type_package' | 'math_type_package']
  return tx.makeMoveVec({ type: [ctx[package_key], ...path].join('::'), elements: [...value] })
}

const call_door = (tx: Transaction, ctx: DoorCtx, line: string, args: Readonly<Record<string, never>>) => {
  const [target = '', package_key = '', params = ''] = line.split('|')
  const [function_path, token] = target.split('<')
  return tx.moveCall({
    target: `${ctx.pins[package_key]}::${function_path}`,
    ...(token ? { typeArguments: [kares_coin_type(args.coin_type ?? ctx.pins.kares_coin_type)] } : {}),
    arguments: (params ? params.split(',') : []).map((param) => {
      const [kind = '', name = ''] = param.split(' ')
      const argument = DOOR_ARGUMENTS[kind]
      return argument ? argument(tx, ctx, args[name]!, name) : move_vector(tx, ctx, args[name]!, kind)
    }),
  })
}

export type BoundDoors<Args> = { readonly [K in keyof Args]: (tx: Transaction, args: Args[K]) => TransactionResult }

/** Binds a generated door table to one SDK context: `doors.<name>(tx, args)` composes that Move call. */
export const bind_doors = <Args>(
  table: Readonly<Record<keyof Args & string, string>>,
  ctx: DoorCtx
): BoundDoors<Args> =>
  Object.freeze(
    Object.fromEntries(
      Object.entries<string>(table).map(([name, line]) => [
        name,
        (tx: Transaction, args: Readonly<Record<string, never>>) => call_door(tx, ctx, line, args),
      ])
    )
  ) as BoundDoors<Args>
