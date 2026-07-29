#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// capture_move_signature.mjs — capture DEPLOYED Move signatures into provenance-tagged test fixtures.
//
// WHY THIS EXISTS (#1494): a PTB builder can only be correct against the signature the chain actually publishes.
// A builder that invents an overload — as craft did, composing a `(vector<Item>, vector<BurnPledge>)` door that
// exists in no published package — builds cleanly, passes every offline test written against itself, and fails
// 100% of the time in a player's hands. Offline composition tests are self-referential unless something pins the
// real shape; this captures that shape so the test asserts against CHAIN TRUTH, not against the builder's opinion.
//
// The package id is READ from the deployment artifact (never hand-typed), so a republish + re-capture is the whole
// refresh ritual (all write doors, one fixture each):
//   node packages/sdk/scripts/capture_move_signature.mjs
//
// One-door compatibility/debug forms:
//   node packages/sdk/scripts/capture_move_signature.mjs --door crafting::craft
//   node packages/sdk/scripts/capture_move_signature.mjs crafting craft
import {
  readFileSync as read_file_sync,
  renameSync as rename_sync,
  writeFileSync as write_file_sync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { SuiGrpcClient } from '@mysten/sui/grpc'

import { MOVE_SIGNATURE_DOORS } from './move_signature_doors.mjs'

const NETWORK = process.env.SUI_NETWORK ?? 'testnet'
const BASE_URL = process.env.SUI_GRPC_URL ?? `https://fullnode.${NETWORK}.sui.io:443`

const here = path.dirname(file_url_to_path(import.meta.url))
const release = JSON.parse(read_file_sync(path.join(here, '../src/deployment/release.json'), 'utf8'))

/** The deployed target package for one door. Custom/linkage ids always come from release.json. */
function package_id(network, selector) {
  const network_release = release?.networks?.[network]
  const id =
    selector === 'rules'
      ? network_release?.rules_package
      : selector === 'move_stdlib'
        ? '0x1'
        : selector === 'sui_framework'
          ? '0x2'
          : network_release?.packages?.[selector]?.latest
  if (!id)
    throw new Error(
      `[capture_move_signature] no stamped ${selector} package for ${network} in deployment/release.json — publish/stamp first.`,
    )
  return id
}

/** Render one normalized parameter as its Move type string (`&mut 0x2::kiosk::Kiosk`, `vector<0x2::object::ID>`). */
function render(parameter) {
  const prefix =
    parameter.reference === 1 ? '&' : parameter.reference === 2 ? '&mut ' : ''
  const name = node => {
    const primitives = {
      1: 'address',
      2: 'bool',
      3: 'u8',
      4: 'u16',
      5: 'u32',
      6: 'u64',
      7: 'u128',
      8: 'u256',
    }
    if (primitives[node.type]) return primitives[node.type]
    if (node.type === 9)
      return `vector<${name(node.typeParameterInstantiation[0])}>`
    if (node.type === 11) return `T${node.typeParameter}`
    if (node.type !== 10 || !node.typeName)
      throw new Error(
        `[capture_move_signature] unrenderable type node: ${JSON.stringify(node)}`,
      )
    const instantiation = node.typeParameterInstantiation?.length
      ? `<${node.typeParameterInstantiation.map(name).join(', ')}>`
      : ''
    return `${node.typeName}${instantiation}`
  }
  return `${prefix}${name(parameter.body ?? parameter)}`
}

/** 'pure' | 'object' | 'generic' — how a PTB may supply one normalized Move parameter. */
const arg_kind = parameter => {
  if (parameter.reference) return 'object'
  const classify = node => {
    if (node.type >= 1 && node.type <= 8) return 'pure'
    if (node.type === 9) return classify(node.typeParameterInstantiation[0])
    if (node.type === 11) return 'generic'
    if (node.type !== 10) return 'object'
    const type_name = node.typeName?.replace(/^0x0+/, '0x')
    if (
      /::object::ID$/.test(type_name) ||
      /0x1::(?:ascii|string)::String$/.test(type_name)
    )
      return 'pure'
    if (/0x1::option::Option$/.test(type_name))
      return classify(node.typeParameterInstantiation[0])
    return 'object'
  }
  return classify(parameter.body)
}

function selected_door(args) {
  if (args[0] === '--door') {
    const entry = MOVE_SIGNATURE_DOORS.find(({ id }) => id === args[1])
    if (!entry)
      throw new Error(
        `[capture_move_signature] unknown door ${JSON.stringify(args[1])}`,
      )
    return entry
  }
  if (args.length === 2) {
    const [module_name, function_name] = args
    const matches = MOVE_SIGNATURE_DOORS.filter(
      entry =>
        entry.module === module_name && entry.function === function_name,
    )
    if (matches.length !== 1)
      throw new Error(
        `[capture_move_signature] ${module_name}::${function_name} is not one unique write door`,
      )
    return matches[0]
  }
  if (args.length)
    throw new Error(
      'usage: capture_move_signature.mjs [--door module::function | <module> <function>]',
    )
  return null
}

const client = new SuiGrpcClient({ network: NETWORK, baseUrl: BASE_URL })

async function capture(entry) {
  const package_address = package_id(NETWORK, entry.package)
  const { response } = await client.movePackageService.getFunction({
    packageId: package_address,
    moduleName: entry.module,
    name: entry.function,
  })
  const descriptor = response?.function
  if (!descriptor)
    throw new Error(
      `[capture_move_signature] ${entry.id} not found in ${package_address} on ${NETWORK}.`,
    )

  const parameters = descriptor.parameters.map(render)
  const context_indexes = parameters.flatMap((parameter, index) =>
    parameter.endsWith('::tx_context::TxContext') ? [index] : [],
  )
  if (
    context_indexes.length > 1 ||
    (context_indexes.length === 1 &&
      context_indexes[0] !== parameters.length - 1)
  )
    throw new Error(
      `[capture_move_signature] ${entry.id} has a non-trailing TxContext (${parameters.join(', ')}) — refusing to emit a lying PTB arity.`,
    )
  const ptb_parameters = context_indexes.length
    ? descriptor.parameters.slice(0, -1)
    : descriptor.parameters

  return {
    status: 'captured',
    target: entry.id,
    package: entry.package,
    provenance: {
      network: NETWORK,
      package_id: package_address,
      module: entry.module,
      function: entry.function,
      source: `sui.rpc.v2.MovePackageService/GetFunction @ ${BASE_URL}`,
      captured: new Date().toISOString().slice(0, 10),
      regenerate: `node packages/sdk/scripts/capture_move_signature.mjs --door ${entry.id}`,
    },
    is_entry: descriptor.isEntry,
    parameters,
    // The PTB-visible arguments: every Move parameter except the runtime-supplied TxContext.
    ptb_arg_kinds: ptb_parameters.map(arg_kind),
  }
}

const one = selected_door(process.argv.slice(2))
if (one) {
  console.log(`${JSON.stringify(await capture(one), null, 2)}`)
} else {
  const fixture_directory = path.join(here, '../test/fixtures')
  const failures = []
  for (const entry of MOVE_SIGNATURE_DOORS) {
    try {
      const fixture = await capture(entry)
      const destination = path.join(fixture_directory, entry.fixture)
      const temporary = `${destination}.tmp`
      write_file_sync(temporary, `${JSON.stringify(fixture, null, 2)}\n`)
      rename_sync(temporary, destination)
      console.error(
        `[capture_move_signature] captured ${entry.id} -> ${entry.fixture}`,
      )
    } catch (error) {
      failures.push(`${entry.id}: ${error?.message ?? String(error)}`)
      console.error(`[capture_move_signature] FAILED ${failures.at(-1)}`)
    }
  }
  if (failures.length)
    throw new Error(
      `[capture_move_signature] ${failures.length}/${MOVE_SIGNATURE_DOORS.length} captures failed; successful fixtures were kept.\n${failures.join('\n')}`,
    )
}
