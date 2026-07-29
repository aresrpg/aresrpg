#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Read-only #1746 instrument: fetch a testnet Fight and compare every escrowed
// participant weapon with the engine's bare-hands fallback. No keys or
// transaction-building APIs are imported.
import { createRequire } from 'node:module'

const default_weapon = Object.freeze({
  element: 2,
  damage: 4,
  damage_max: 4,
  crit_damage: 6,
  crit_damage_max: 6,
  crit_rate: 30,
  ap_cost: 3,
  reach: 1,
})

const weapon_fields = Object.keys(default_weapon)

function usage() {
  console.log(
    'Usage: node probe_escrow_weapon.mjs <fight-id>\n' + 'Optional: SUI_GRPC_URL=https://fullnode.testnet.sui.io:443'
  )
}

function fields_of(value) {
  return value?.fields ?? value ?? {}
}

function decode_weapon(participant) {
  const raw = fields_of(fields_of(participant).weapon)
  return Object.fromEntries(weapon_fields.map((field) => [field, Number(raw[field])]))
}

function is_default_weapon(weapon) {
  return weapon_fields.every((field) => weapon[field] === default_weapon[field])
}

const [fight_id] = process.argv.slice(2)
if (fight_id === '--help' || fight_id === '-h') {
  usage()
  process.exit(0)
}
if (!/^0x[0-9a-fA-F]{1,64}$/.test(fight_id ?? '')) {
  usage()
  throw new Error('fight-id must be a 0x-prefixed Sui object id')
}

const base_url = process.env.SUI_GRPC_URL ?? 'https://fullnode.testnet.sui.io:443'
// The root is a Bun workspace and keeps this dependency at the SDK package
// boundary. Resolve from that package so plain Node works without a root-level
// @mysten symlink.
const require = createRequire(new URL('./packages/sdk/package.json', import.meta.url))
const { SuiGrpcClient } = await import(require.resolve('@mysten/sui/grpc'))
const client = new SuiGrpcClient({ network: 'testnet', baseUrl: base_url })
const { object } = await client.core.getObject({
  objectId: fight_id,
  include: { json: true },
})
if (!object?.json) throw new Error(`Fight ${fight_id} was not readable`)

const { participants } = object.json
if (!Array.isArray(participants)) throw new Error(`Fight ${fight_id} has no participants vector`)

console.log(
  JSON.stringify(
    {
      fight_id,
      rpc: base_url,
      default_weapon,
      participants: participants.map((participant, seat) => {
        const fields = fields_of(participant)
        const weapon = decode_weapon(fields)
        return {
          seat,
          character: fields.character ?? fields.character_id ?? null,
          weapon,
          matches_default_weapon: is_default_weapon(weapon),
        }
      }),
    },
    null,
    2
  )
)
