// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Every value has a working local default — a bare boot never throws (legacy law).

const {
  REDIS_URL = 'redis://localhost:6379',
  GRAPH_NAME = 'aresrpg',
  PORT: RAW_PORT = '9800',
  SUI_NETWORK = 'testnet',
  SUI_RPC_URL = `https://fullnode.${SUI_NETWORK}.sui.io:443`,
  ADMIN_ADDRESSES: RAW_ADMIN_ADDRESSES = '0x3d1342fb7de99c69ce821183bcfc5b6374d81453bf5ca9bf7e383e75b3722983',
  MAX_PLAYERS: RAW_MAX_PLAYERS = '1000',
} = process.env

export { REDIS_URL, GRAPH_NAME, SUI_NETWORK, SUI_RPC_URL }

export const PORT = Number(RAW_PORT)
export const MAX_PLAYERS = Number(RAW_MAX_PLAYERS)

/** This pod's ephemeral identity — heartbeat key + player_connect beacon (legacy SERVER_ID).
 *  Random per boot on purpose: pods are cattle, the 20s key TTL is the only membership. */
export const SERVER_ID = crypto.randomUUID()

/** Whitelisted admin addresses — comma-separated; empty = no admin surface at all. */
export const ADMIN_ADDRESSES = new Set(
  RAW_ADMIN_ADDRESSES.split(',')
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean)
)
