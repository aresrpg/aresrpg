// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Every value has a working local default: a bare boot never throws.

import { DEFAULT_ADMIN_ADDRESS } from '@aresrpg/protocol'

const {
  /** the bound indexer set — graph reads, chain evt:* channels, the checkpoint marker */
  GRAPH_URL = 'redis://localhost:6379',
  /** the ONE cluster redis — player-published ephemera + server heartbeats */
  MESH_REDIS_URL = 'redis://localhost:6379',
  /** the site's public origin: share previews build their addresses on it */
  SITE_ORIGIN = 'https://aresrpg.world',
  GRAPH_NAME = 'aresrpg',
  PORT: RAW_PORT = '9800',
  SUI_NETWORK = 'testnet',
  SUI_RPC_URL = `https://fullnode.${SUI_NETWORK}.sui.io:443`,
  ADMIN_ADDRESSES: RAW_ADMIN_ADDRESSES = DEFAULT_ADMIN_ADDRESS,
  MAX_PLAYERS: RAW_MAX_PLAYERS = '1000',
  MAX_VIEWERS: RAW_MAX_VIEWERS = '5000',
  ALLOWED_ORIGINS: RAW_ALLOWED_ORIGINS = 'http://localhost:5173,https://aresrpg.world',
} = process.env

export { GRAPH_URL, MESH_REDIS_URL, GRAPH_NAME, SUI_NETWORK, SUI_RPC_URL, SITE_ORIGIN }

export const PORT = Number(RAW_PORT)
/** Live game seats per pod. */
export const MAX_PLAYERS = Number(RAW_MAX_PLAYERS)
/** Live non-seat sockets (open and signed: no gameplay input, no presence) per pod; never seats or online. */
export const MAX_VIEWERS = Number(RAW_MAX_VIEWERS)
export const ALLOWED_ORIGINS = new Set(
  RAW_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean)
)

/** This pod's identity for the heartbeat key and the player_connect beacon. Random per boot: the
 *  20 s key TTL is the only membership. */
export const SERVER_ID = crypto.randomUUID()

/** Whitelisted admin addresses — comma-separated; empty = no admin surface at all. */
export const ADMIN_ADDRESSES = new Set(
  RAW_ADMIN_ADDRESSES.split(',')
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean)
)
