#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// generate_doors.mjs — the SDK IS a projection of the Move contract (owner 2026-08-12): every
// public/entry function of `api.move` becomes one generated PTB builder, so the client surface
// can never drift from the chain surface. Regeneration is a test tooth: the committed
// `src/doors.gen.js` must be byte-identical to a fresh run over the same sources (same-commit
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

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const API_MOVE_PATH = join(root, '../move/sources/api.move')
export const DOORS_OUT_PATH = join(root, 'src/doors.gen.js')

// Move parameter type → argument strategy. Families:
//   skip      — the runtime provides it (TxContext)
//   clock     — tx.object.clock() (offline helper, always immutable)
//   random    — tx.object.random() (offline helper)
//   pin       — a shared object pinned in pins.json ({id, shared_version}) — sharedObjectRef
//   pure      — a BCS pure value (the emitted code names the tx.pure helper)
//   receiving — a Receiving<T> input — exact receivingRef via the resolver
//   object    — a caller object: resolved to objectRef/sharedObjectRef, or an in-PTB argument
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
  '&mut FriendRegistry': { kind: 'pin', pin: 'friend_registry', mutable: true },
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
}

const strategy_of = (type) => {
  if (TYPE_MAP[type]) return TYPE_MAP[type]
  if (/^Receiving</.test(type)) return { kind: 'receiving', type }
  // A caller object: by reference (&mut Fight, &ItemTemplate…) or by value (Fight, Coin<SUI>,
  // CrushClaim, FightBuild…). Mutability drives the sharedObjectRef flag: `&T` is the only
  // read-only shape — `&mut T` and by-value consumption both need mutable access.
  const bare = type.replace(/^&mut\s+|^&/, '')
  if (/^[A-Z]/.test(bare)) return { kind: 'object', type, mutable: !type.startsWith('&') || type.startsWith('&mut ') }
  throw new Error(`generate_doors: unknown Move parameter type "${type}" — add it to TYPE_MAP deliberately`)
}

/** Parse every public/entry fun of a Move source into {name, params: [{name, type, strategy}]}. */
export function parse_doors(move_source) {
  const stripped = move_source.replace(/\/\/[^\n]*/g, '')
  const doors = []
  const sig_re = /(?:public\s+entry\s+fun|public\s+fun|entry\s+fun)\s+(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)/g
  for (const [, name, generics, raw_params] of stripped.matchAll(sig_re)) {
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

const arg_expr = ({ name, strategy }) => {
  switch (strategy.kind) {
    case 'clock':
      return `tx.object.clock()`
    case 'random':
      return `tx.object.random()`
    case 'pin':
      return `ctx.pin(tx, '${strategy.pin}', ${Boolean(strategy.mutable)})`
    case 'pure':
      return `tx.pure.${strategy.helper}(args.${name})`
    case 'pure_option':
      return `tx.pure.option('${strategy.helper}', args.${name} ?? null)`
    case 'pure_vector':
      return `tx.pure.vector('${strategy.helper}', args.${name})`
    case 'receiving':
      return `ctx.receiving(tx, args.${name})`
    case 'object':
      return `ctx.obj(tx, args.${name}, ${strategy.mutable})`
    default:
      throw new Error(`generate_doors: unreachable strategy ${strategy.kind}`)
  }
}

/** Emit the doors module text. Deterministic: same source in, same bytes out. */
export function emit_doors(doors) {
  const header = `// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GENERATED by scripts/generate_doors.mjs from packages/move/sources/api.move — DO NOT EDIT.
// One builder per api.move door: door(tx, ctx, args) composes the move call onto the given
// Transaction and returns its result (hot potatoes chain: engage_fight → add_fight_mob → launch).
// \`ctx\` is the SDK's bound context ({ pins, obj, pin, receiving }) — every object input is
// emitted PRE-RESOLVED (objectRef / sharedObjectRef / offline system helpers), so building the
// transaction costs ZERO RPC roundtrips. Doors marked terminal take &Random: THE TERMINAL LAW —
// such a call must be the LAST command of its transaction (an inspectable roll is a free re-roll).
/* eslint-disable max-lines -- generated projection of api.move: one builder per door, size follows the contract */

`
  const fns = doors
    .map((door) => {
      const args = door.params.filter((p) => p.strategy.kind !== 'skip')
      const arg_list = args.map(arg_expr).join(',\n      ')
      const terminal = door.params.some((p) => p.type === '&Random')
      const jsdoc_params = args
        .filter((p) => !['clock', 'random', 'pin'].includes(p.strategy.kind))
        .map((p) => ` * @arg ${p.name} — ${p.type}`)
        .join('\n')
      return `/**
 * \`api::${door.name}\`${terminal ? ' — TERMINAL (&Random): last command of its transaction.' : ''}
${jsdoc_params || ' * (no caller arguments)'}
 */
export const ${door.name} = (tx, ctx, args = {}) =>
  tx.moveCall({
    target: \`\${ctx.pins.package}::api::${door.name}\`,
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
    const caller = door.params
      .filter((p) => !['skip', 'clock', 'random', 'pin'].includes(p.strategy.kind))
      .map((p) => `'${p.name}'`)
      .join(', ')
    const terminal = door.params.some((p) => p.type === '&Random')
    return `  ${door.name}: { params: [${caller}], terminal: ${terminal} },`
  })
  .join('\n')}
}
`
  return header + fns + meta
}

/** The full projection: parse → emit → format with the REPO's prettier config, so the
 *  generated file obeys the same lint every hand-written file does (zero exemptions). */
export const generate = async (move_source) => {
  const raw = emit_doors(parse_doors(move_source))
  const config = await prettier.resolveConfig(DOORS_OUT_PATH)
  return prettier.format(raw, { ...config, parser: 'babel' })
}

const invoked_directly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invoked_directly) {
  const out = await generate(readFileSync(API_MOVE_PATH, 'utf8'))
  writeFileSync(DOORS_OUT_PATH, out)
  const count = (out.match(/^export const /gm) || []).length
  console.log(`doors.gen.js written — ${count - 1} doors`)
}
