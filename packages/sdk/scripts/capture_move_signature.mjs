#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// capture_move_signature.mjs — capture a DEPLOYED Move entry's signature into a provenance-tagged test fixture.
//
// WHY THIS EXISTS (#1494): a PTB builder can only be correct against the signature the chain actually publishes.
// A builder that invents an overload — as craft did, composing a `(vector<Item>, vector<BurnPledge>)` door that
// exists in no published package — builds cleanly, passes every offline test written against itself, and fails
// 100% of the time in a player's hands. Offline composition tests are self-referential unless something pins the
// real shape; this captures that shape so the test asserts against CHAIN TRUTH, not against the builder's opinion.
//
// The package id is READ from the deployment artifact (never hand-typed), so a republish + re-capture is the whole
// refresh ritual:
//   node packages/sdk/scripts/capture_move_signature.mjs crafting craft > packages/sdk/test/fixtures/crafting_craft_signature.json
import { readFileSync as read_file_sync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import { SuiGrpcClient } from '@mysten/sui/grpc'

const NETWORK = process.env.SUI_NETWORK ?? 'testnet'
const BASE_URL = process.env.SUI_GRPC_URL ?? `https://fullnode.${NETWORK}.sui.io:443`

const here = path.dirname(file_url_to_path(import.meta.url))
const release = JSON.parse(read_file_sync(path.join(here, '../src/deployment/release.json'), 'utf8'))

/** The live `aresrpg` package id for `network`, off the stamped deployment artifact — never hand-typed. */
function package_id(network) {
  const id = release?.networks?.[network]?.packages?.aresrpg?.latest
  if (!id)
    throw new Error(
      `[capture_move_signature] no stamped aresrpg package for ${network} in deployment/release.json — publish/stamp first.`,
    )
  return id
}

/** Render one normalized parameter as its Move type string (`&mut 0x2::kiosk::Kiosk`, `vector<0x2::object::ID>`). */
function render(parameter) {
  const prefix =
    parameter.reference === 1 ? '&' : parameter.reference === 2 ? '&mut ' : ''
  const name = node => {
    if (node.type === 9) return `vector<${name(node.typeParameterInstantiation[0])}>`
    if (!node.typeName)
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

/** 'pure' | 'object' — how a PTB must supply this Move parameter. By-value ID/vector<ID> are BCS pure inputs. */
const arg_kind = parameter => {
  const rendered = render(parameter)
  if (rendered.startsWith('&')) return 'object'
  return /^(vector<)?0x0*2::object::ID>?$/.test(rendered) ? 'pure' : 'object'
}

const [module_name, function_name] = process.argv.slice(2)
if (!module_name || !function_name) {
  console.error(
    'usage: capture_move_signature.mjs <module> <function>   (e.g. crafting craft)',
  )
  process.exit(2)
}

const package_address = package_id(NETWORK)
const client = new SuiGrpcClient({ network: NETWORK, baseUrl: BASE_URL })
const { response } = await client.movePackageService.getFunction({
  packageId: package_address,
  moduleName: module_name,
  name: function_name,
})
const descriptor = response?.function
if (!descriptor?.parameters?.length)
  throw new Error(
    `[capture_move_signature] ${module_name}::${function_name} not found in ${package_address} on ${NETWORK}.`,
  )

const parameters = descriptor.parameters.map(render)
const trailing = parameters[parameters.length - 1]
if (!trailing.endsWith('::tx_context::TxContext'))
  throw new Error(
    `[capture_move_signature] expected a trailing &mut TxContext, got ${trailing} — refusing to emit a fixture whose PTB arg count would lie.`,
  )

console.log(
  `${JSON.stringify(
    {
      provenance: {
        network: NETWORK,
        package_id: package_address,
        module: module_name,
        function: function_name,
        source: `sui.rpc.v2.MovePackageService/GetFunction @ ${BASE_URL}`,
        captured: new Date().toISOString().slice(0, 10),
        regenerate: `node packages/sdk/scripts/capture_move_signature.mjs ${module_name} ${function_name}`,
      },
      is_entry: descriptor.isEntry,
      parameters,
      // The PTB-visible arguments: every Move parameter except the runtime-supplied TxContext.
      ptb_arg_kinds: descriptor.parameters.slice(0, -1).map(arg_kind),
    },
    null,
    2,
  )}`,
)
