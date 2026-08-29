#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// generate_doors.mjs — the SDK IS a projection of the Move contract (owner 2026-08-12): every
// public/entry function of `api.move` becomes one generated PTB builder, so the client surface
// can never drift from the chain surface. Regeneration is a test tooth: the committed
// `src/doors.gen.ts` must be byte-identical to a fresh run over the same sources (same-commit
// law — a Move door change lands with its regenerated builder or the suite is red).
//
//   bun run generate            (from packages/sdk)
//
// ZERO-ROUNDTRIP LAW (owner 2026-08-12: Sui finality is sub-second, so must every tx be):
// generated doors never emit an unresolved input. Every object argument goes through the bound
// context's resolver — owned objects become exact `objectRef` (version + digest), shared objects
// become `sharedObjectRef` (initialSharedVersion is STABLE), clock/random use the SDK's offline
// helpers — so `tx.build()` performs no RPC resolution at all.
//
// The parser reads MOVE SOURCE, not chain state: deterministic, offline, and bound to the exact
// commit. An UNKNOWN parameter type is a hard throw, never a guess: a new Move type joins
// TYPE_MAP as a deliberate, reviewed act.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import prettier from 'prettier'

/**
 * @typedef {{ kind: 'skip' | 'clock' | 'random' }
 *   | { kind: 'pin', pin: string, mutable?: boolean }
 *   | { kind: 'pure' | 'pure_option' | 'pure_vector', helper: string }
 *   | { kind: 'move_value' | 'move_vector', type: string }
 *   | { kind: 'receiving', type: string }
 *   | { kind: 'object', type: string, mutable: boolean }} DoorStrategy
 * @typedef {{ name: string, type: string, strategy: DoorStrategy }} DoorParam
 * @typedef {{ name: string, params: DoorParam[], module?: string, package_key?: string, export_name?: string }} Door
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const API_MOVE_PATH = join(root, '../move/sources/api.move')
export const TRADE_MOVE_PATH = join(root, '../move/sources/trade.move')
export const DOORS_OUT_PATH = join(root, 'src/doors.gen.ts')
export const CHARACTER_MOVE_PATH = join(root, '../move/sources/character.move')
export const CHARACTER_PRICE_OUT_PATH = join(root, 'src/character_price.ts')

// Move parameter type → argument strategy. Families:
//   skip      — the runtime provides it (TxContext)
//   clock     — tx.object.clock() (offline helper, always immutable)
//   random    — tx.object.random() (offline helper)
//   pin       — a shared object pinned in pins.json ({id, shared_version}) — sharedObjectRef
//   pure      — a BCS pure value (the emitted code names the tx.pure helper)
//   receiving — a Receiving<T> input — exact receivingRef via the resolver
//   object    — a caller object: resolved to objectRef/sharedObjectRef, or an in-PTB argument
/** @type {Readonly<Record<string, DoorStrategy>>} */
const TYPE_MAP = {
  '&mut TxContext': { kind: 'skip' },
  '&TxContext': { kind: 'skip' },
  '&Clock': { kind: 'clock' },
  '&Random': { kind: 'random' },
  '&Version': { kind: 'pin', pin: 'version' },
  '&TransferPolicy<Item>': { kind: 'pin', pin: 'item_policy' },
  '&TransferPolicy<Character>': { kind: 'pin', pin: 'character_policy' },
  '&AresRPG_TransferPolicy<Item>': { kind: 'pin', pin: 'item_protected_policy' },
  '&AresRPG_TransferPolicy<Character>': { kind: 'pin', pin: 'character_protected_policy' },
  '&mut NameRegistry': { kind: 'pin', pin: 'name_registry', mutable: true },
  '&LootRegistry': { kind: 'pin', pin: 'loot_registry' },
  '&mut LootRegistry': { kind: 'pin', pin: 'loot_registry', mutable: true },
  '&TemplateRegistry': { kind: 'pin', pin: 'template_registry' },
  '&mut TemplateRegistry': { kind: 'pin', pin: 'template_registry', mutable: true },
  '&mut FriendRegistry': { kind: 'pin', pin: 'friend_registry', mutable: true },
  '&FriendRegistry': { kind: 'pin', pin: 'friend_registry', mutable: false },
  ID: { kind: 'pure', helper: 'id' },
  address: { kind: 'pure', helper: 'address' },
  bool: { kind: 'pure', helper: 'bool' },
  u8: { kind: 'pure', helper: 'u8' },
  u16: { kind: 'pure', helper: 'u16' },
  u32: { kind: 'pure', helper: 'u32' },
  u64: { kind: 'pure', helper: 'u64' },
  String: { kind: 'pure', helper: 'string' },
  'Option<ID>': { kind: 'pure_option', helper: 'id' },
  'vector<ID>': { kind: 'pure_vector', helper: 'id' },
  'vector<u8>': { kind: 'pure_vector', helper: 'u8' },
  'vector<u16>': { kind: 'pure_vector', helper: 'u16' },
  'vector<u32>': { kind: 'pure_vector', helper: 'u32' },
  'vector<u64>': { kind: 'pure_vector', helper: 'u64' },
  'vector<address>': { kind: 'pure_vector', helper: 'address' },
  'vector<String>': { kind: 'pure_vector', helper: 'string' },
}

const MOVE_VALUE_TYPES = Object.freeze({
  PM: { type_package: 'game_type_package', module: 'item' },
  ItemDamages: { type_package: 'math_type_package', module: 'item_damages' },
  Effect: { type_package: 'math_type_package', module: 'spell_effect' },
  SpellLevel: { type_package: 'math_type_package', module: 'spell_effect' },
  MobSpell: { type_package: 'math_type_package', module: 'mob_data' },
  LootEntry: { type_package: 'math_type_package', module: 'mob_data' },
  MobRow: { type_package: 'math_type_package', module: 'world_map' },
  ResourceRow: { type_package: 'math_type_package', module: 'world_map' },
  RoomMob: { type_package: 'math_type_package', module: 'world_map' },
  DungeonRoom: { type_package: 'math_type_package', module: 'world_map' },
})

/** @param {string} type @returns {DoorStrategy} */
const strategy_of = (type) => {
  if (TYPE_MAP[type]) return TYPE_MAP[type]
  const value_vector = type.match(MOVE_VALUE_VECTOR)
  if (value_vector) {
    const [, value_type] = value_vector
    if (!MOVE_VALUE_TYPES[value_type])
      throw new Error(`generate_doors: unknown Move vector value type "${value_type}" — map its defining module`)
    return { kind: 'move_vector', type: value_type }
  }
  if (MOVE_VALUE_TYPES[type]) return { kind: 'move_value', type }
  if (/^Receiving</.test(type)) return { kind: 'receiving', type }
  // A caller object: by reference (&mut Fight, &ItemTemplate…) or by value (Fight, Coin<SUI>,
  // CrushClaim, FightBuild…). Mutability drives the sharedObjectRef flag: `&T` is the only
  // read-only shape — `&mut T` and by-value consumption both need mutable access.
  const bare = type.replace(/^&mut\s+|^&/, '')
  if (/^[A-Z]/.test(bare)) return { kind: 'object', type, mutable: !type.startsWith('&') || type.startsWith('&mut ') }
  throw new Error(`generate_doors: unknown Move parameter type "${type}" — add it to TYPE_MAP deliberately`)
}

/** Parse every public/entry fun of a Move source into {name, params: [{name, type, strategy}]}. */
/** @param {string} move_source @param {ReadonlySet<string> | null} [include_names] @returns {Door[]} */
export function parse_doors(move_source, include_names = null) {
  const stripped = move_source.replace(/\/\/[^\n]*/g, '')
  /** @type {Door[]} */
  const doors = []
  const sig_re = /(?:public\s+entry\s+fun|public\s+fun|entry\s+fun)\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)/g
  for (const [, name, generics, raw_params] of stripped.matchAll(sig_re)) {
    if (include_names && !include_names.has(name)) continue
    if (generics)
      throw new Error(`generate_doors: door "${name}" is generic — the generator does not model type arguments yet`)
    const params = raw_params
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const [pname, ...rest] = p.split(':')
        const type = rest.join(':').trim().replace(/\s+/g, ' ')
        return { name: pname.trim(), type, strategy: strategy_of(type) }
      })
    doors.push({ name, params })
  }
  if (doors.length === 0)
    throw new Error('generate_doors: parsed ZERO doors — the instrument is broken, not the surface empty')
  return doors
}

const MOVE_VALUE_VECTOR = /^vector<([A-Z][A-Za-z0-9_]*)>$/

/** @param {DoorParam} param */
const arg_expr = ({ name, strategy }) => {
  switch (strategy.kind) {
    case 'clock':
      return `tx.object.clock()`
    case 'random':
      return `tx.object.random()`
    case 'pin':
      return `ctx.pin(tx, '${strategy.pin}', ${Boolean(strategy.mutable)})`
    case 'pure':
      return `ctx.pure.${strategy.helper}(tx, args.${name})`
    case 'pure_option':
      return `ctx.pure.option(tx, '${strategy.helper}', args.${name} ?? null)`
    case 'pure_vector':
      return `ctx.pure.vector(tx, '${strategy.helper}', args.${name})`
    case 'move_vector': {
      const value = MOVE_VALUE_TYPES[strategy.type]
      // type arguments name types by their DEFINING package — never the latest upgrade target
      return `tx.makeMoveVec({ type: \`\${ctx.${value.type_package}}::${value.module}::${strategy.type}\`, elements: [...args.${name}] })`
    }
    case 'move_value':
      return `args.${name}`
    case 'receiving':
      return `ctx.receiving(tx, args.${name})`
    case 'object':
      return `ctx.obj(tx, args.${name}, ${strategy.mutable})`
    default:
      throw new Error(`generate_doors: unreachable strategy ${strategy.kind}`)
  }
}

/** @type {Readonly<Record<string, string>>} */
const pure_type = {
  id: 'string',
  address: 'string',
  bool: 'boolean',
  u8: 'number',
  u16: 'number',
  u32: 'number',
  u64: 'bigint | number | string',
  string: 'string',
}

/** @param {DoorParam} param */
const arg_type = ({ strategy }) => {
  switch (strategy.kind) {
    case 'pure':
      return pure_type[strategy.helper]
    case 'pure_option':
      return `${pure_type[strategy.helper]} | null | undefined`
    case 'pure_vector':
      return `readonly (${pure_type[strategy.helper]})[]`
    case 'move_vector':
      return 'readonly TransactionObjectArgument[]'
    case 'move_value':
      return 'TransactionObjectArgument'
    case 'receiving':
    case 'object':
      return 'Resolvable'
    default:
      throw new Error(`generate_doors: strategy ${strategy.kind} is not a caller argument`)
  }
}

/** Emit the doors module text. Deterministic: same source in, same bytes out. */
/** @param {readonly Door[]} doors */
export function emit_doors(doors, { source = 'packages/move/sources/api.move', description = 'api.move doors' } = {}) {
  const value_vector_import = doors.some((door) =>
    door.params.some(({ strategy }) => strategy.kind === 'move_vector' || strategy.kind === 'move_value')
  )
    ? ', TransactionObjectArgument'
    : ''
  const header = `// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GENERATED by scripts/generate_doors.mjs from ${source} — DO NOT EDIT.
// One builder per ${description}: door(tx, ctx, args) composes the move call onto the given
// Transaction and returns its Move result for further composition.
// \`ctx\` is the SDK's bound context ({ pins, obj, pin, receiving, pure }) — every input is
// emitted PRE-RESOLVED (objectRef / sharedObjectRef / offline system helpers), so building the
// transaction costs ZERO RPC roundtrips. Doors marked terminal take &Random: THE TERMINAL LAW —
// such a call must be the LAST command of its transaction (an inspectable roll is a free re-roll).
/* eslint-disable max-lines -- generated projection: one builder per door, size follows the Move contract */

import type { Transaction${value_vector_import} } from '@mysten/sui/transactions'

import type { DoorCtx, Resolvable } from './client.ts'

`
  const fns = doors
    .map((door) => {
      const export_name = door.export_name ?? door.name
      const module = door.module ?? 'api'
      const package_key = door.package_key ?? 'package'
      const args = door.params.filter((p) => p.strategy.kind !== 'skip')
      const caller_args = args.filter((p) => !['clock', 'random', 'pin'].includes(p.strategy.kind))
      const arg_list = args.map(arg_expr).join(',\n      ')
      const args_type = caller_args.length
        ? `{ ${caller_args.map((p) => `${p.name}: ${arg_type(p)}`).join('; ')} }`
        : 'Record<string, never>'
      const terminal = door.params.some((p) => p.type === '&Random')
      const jsdoc_params = args
        .filter((p) => !['clock', 'random', 'pin'].includes(p.strategy.kind))
        .map((p) => ` * @arg ${p.name} — ${p.type}`)
        .join('\n')
      return `/**
 * \`${module}::${door.name}\`${terminal ? ' — TERMINAL (&Random): last command of its transaction.' : ''}
${jsdoc_params || ' * (no caller arguments)'}
 */
export const ${export_name} = (tx: Transaction, ctx: DoorCtx, args: ${args_type}) =>
  tx.moveCall({
    target: \`\${ctx.pins.${package_key}}::${module}::${door.name}\`,
    arguments: [
      ${arg_list}
    ],
  })`
    })
    .join('\n\n')

  const meta = `

/** Every door, by name — { params: caller-facing names, terminal: carries &Random }. */
export const DOORS = {
${doors
  .map((door) => {
    const export_name = door.export_name ?? door.name
    const caller = door.params
      .filter((p) => !['skip', 'clock', 'random', 'pin'].includes(p.strategy.kind))
      .map((p) => `'${p.name}'`)
      .join(', ')
    const terminal = door.params.some((p) => p.type === '&Random')
    return `  ${export_name}: { params: [${caller}], terminal: ${terminal} },`
  })
  .join('\n')}
}
`
  return header + fns + meta
}

/** The full projection: parse → emit → format with the REPO's prettier config, so the
 *  generated file obeys the same lint every hand-written file does (zero exemptions). */
/** @param {string} move_source */
export const generate = async (move_source) => {
  const raw = emit_doors(parse_doors(move_source))
  const config = await prettier.resolveConfig(DOORS_OUT_PATH)
  return prettier.format(raw, { ...config, parser: 'typescript' })
}

const TRADE_DOORS = Object.freeze({
  create: 'trade_create',
  join: 'trade_join',
  cancel: 'trade_cancel',
  put_sui: 'trade_put_s',
  take_sui: 'trade_take_s',
  accept: 'trade_accept',
  claim_sui: 'trade_get_s',
  recover_sui: 'trade_recover_s',
  close: 'trade_close',
})

export const generate_game_doors = async (api_source, trade_source) => {
  const names = new Set([...Object.keys(TRADE_DOORS), 'end_request'])
  const trade = parse_doors(trade_source, names).flatMap((door) => {
    const projected = {
      ...door,
      params: door.params.map((param) => (param.name === 'trade' ? { ...param, name: 't' } : param)),
      module: 'trade',
    }
    return door.name === 'end_request'
      ? [
          { ...projected, export_name: 'trade_cancel_request' },
          { ...projected, export_name: 'trade_decline_request' },
        ]
      : [{ ...projected, export_name: TRADE_DOORS[door.name] }]
  })
  const raw = emit_doors([...parse_doors(api_source), ...trade], {
    source: 'packages/move/sources/{api,trade}.move',
    description: 'public game doors',
  })
  const config = await prettier.resolveConfig(DOORS_OUT_PATH)
  return prettier.format(raw, { ...config, parser: 'typescript' })
}

/** Project the fixed character mint price without giving it a second authored home. */
export const generate_character_price = async (move_source) => {
  const match = move_source.match(/const PRICE: u64 = ([\d_]+);/)
  if (!match) throw new Error('generate_doors: character.move has no `const PRICE: u64`')
  const mist = BigInt(match[1].replaceAll('_', ''))
  const raw = `// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GENERATED by scripts/generate_doors.mjs from packages/move/sources/character.move — DO NOT EDIT.
// Kept isolated so display code does not pull the transaction writer into the initial UI chunk.

export const CHARACTER_PRICE_MIST = ${mist}n
`
  const config = await prettier.resolveConfig(CHARACTER_PRICE_OUT_PATH)
  return prettier.format(raw, { ...config, parser: 'typescript' })
}

/** @param {readonly Door[]} doors @param {string} output_path @param {{source?: string, description?: string}} options */
export const generate_projected_doors = async (doors, output_path, options = {}) => {
  const raw = emit_doors(doors, options)
  const config = await prettier.resolveConfig(output_path)
  return prettier.format(raw, { ...config, parser: 'typescript' })
}

const invoked_directly = import.meta.main ?? (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
if (invoked_directly) {
  const out = await generate_game_doors(readFileSync(API_MOVE_PATH, 'utf8'), readFileSync(TRADE_MOVE_PATH, 'utf8'))
  writeFileSync(DOORS_OUT_PATH, out)
  writeFileSync(CHARACTER_PRICE_OUT_PATH, await generate_character_price(readFileSync(CHARACTER_MOVE_PATH, 'utf8')))
  const count = (out.match(/^export const /gm) || []).length
  console.log(`doors.gen.ts written — ${count - 1} doors; character_price.ts written`)
}
