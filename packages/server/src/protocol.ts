// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE SERVER-SIDE WIRE MIRRORS — what this process speaks with the INDEXER (the client never
// sees any of this; the client↔server contract lives in @aresrpg/protocol):
//   1. the pub/sub channels + envelope the Rust indexer publishes
//      (mirror of packages/indexer/src/events.rs; a change there lands here, same commit),
//   2. the graph schema the indexer writes (mirror of graph.rs).
// Modules never invent a channel or label — they import it from here.

// ╔════════════════ [ 1. The indexer wire ] ═══════════════════════════════════ ]

/** Every pub/sub payload carries checkpoint provenance. Real Move events have a unique
 *  `(ckpt, tx, evt)` coordinate; synthetic object-write invalidations may share one because
 *  consumers reread full latest-wins state instead of folding them as deltas. */
export type EventEnvelope = {
  ckpt: number
  tx: number
  evt: number
  ts_ms: number
  type: string
  data: Record<string, unknown>
}

/** Channel builders — the exact topics events.rs routes to. */
export const channels = {
  character: (id: string) => `evt:character:${id}`,
  /** one zone's indexer facts (fights, gathers, zone re-rolls) — a pod subscribes exactly the
   *  zones its players track; presence spam never rides a world-global wire */
  zone: (world: string, zx: number, zz: number) => `evt:zone:${world}:${zx}:${zz}`,
  dungeon: (dungeon: string) => `evt:dungeon:${dungeon}`,
  fight: (id: string) => `evt:fight:${id}`,
  party: (id: string) => `evt:party:${id}`,
  social: (address: string) => `evt:social:${address}`,
  kolizeum: 'evt:kolizeum',
  economy: 'evt:economy',
  content: 'evt:content',
  /** shared Version object transitions (version 0 = frozen) */
  game: 'evt:game',
} as const

/** The bus a channel lives on is declared by its name: `evt:*` is indexer-published and rides
 *  the bound set's own redis (the graph bus); every other channel is server-published ephemera
 *  on the ONE cluster mesh redis. Minted here, derived everywhere — never decided at a call site. */
export const is_indexer_channel = (channel: string): boolean => channel.startsWith('evt:')

// ╔════════════════ [ 1b. The SERVER mesh (published by server pods, never stored) ] ═ ]

/** Channels the server itself publishes on — OFF-CHAIN ephemera ONLY (owner 2026-08-12):
 *  presence, chat, live fight-turn intents. On-chain facts are never re-broadcast; they ride
 *  the indexer's evt:* channels above. */
export const mesh = {
  /** one zone's presence facts */
  pos: (world: string, zx: number, zz: number) => `pos:${world}:${zx}:${zz}`,
  /** one world's chat — everyone standing there hears it (owner 2026-08-12) */
  chat_world: (world: string) => `chat:world:${world}`,
  chat_party: (party: string) => `chat:party:${party}`,
  /** whispers (and only whispers) land on the target's own door */
  chat_user: (address: string) => `chat:user:${address}`,
  /** live fight-turn intents relayed between fighters/spectators */
  fight_actions: (fight: string) => `act:fight:${fight}`,
  /** cluster-wide connect beacon — cross-pod duplicate eviction (legacy player_connect) */
  player_connect: 'player_connect',
} as const

/** What rides a `pos:` channel — presence facts. `who` is the join-later cure: a server
 *  starting to track a zone probes it, and every player already standing there re-announces —
 *  presence needs no stored snapshot because the occupants themselves are the state. */
export type MeshFact =
  | { kind: 'appear'; player: import('@aresrpg/protocol').PresenceRow; address: string }
  | { kind: 'move'; character_id: string; address: string; x: number; y: number; z: number; riding: boolean }
  | { kind: 'leave'; character_id: string; address: string }
  | { kind: 'who'; address: string; world: string; zx: number; zz: number }

/** What rides `chat:world:` / `chat:party:` / `chat:user:` channels. */
export type ChatFact = {
  address: string
  character_id: string
  character: string
  parts: readonly import('@aresrpg/protocol').ChatMessagePart[]
}

/** What rides an `act:fight:` channel. */
export type FightActionFact =
  | { kind: 'action'; address: string; action: import('@aresrpg/protocol').FightWireAction }
  | { kind: 'resync'; address: string }

// ╔════════════════ [ 2. The graph schema (indexer-written, read-only here) ] ═ ]

/** Node labels the indexer writes (graph.rs `merge_set` census). */
export const labels = [
  'User',
  'Kiosk',
  'Character',
  'Item',
  'Fight',
  'Party',
  'FriendList',
  'Kolizeum',
  'Market',
  'Zone',
  'Trade',
  'Giftcard',
  'Sale',
  'Airdrop',
  'Meta',
] as const

/** Relations the indexer writes — `(from)-[REL {props}]->(to)`. */
export const relations = {
  OWNS: ['User', 'Kiosk'], // custody root
  HOLDS: ['Kiosk', 'Item|Character'], // kiosk-held (severed while fighting/equipped)
  EQUIPS: ['Character', 'Item'], // props: { slot }
  FIGHTER: ['Fight', 'Character'], // props: { seat, team }
  RESULT_FOR: ['Fight', 'User'], // props: durable unsettled seat / unclaimed drops
  CLOSABLE_FOR: ['Fight', 'User'], // participants allowed an explicit reconnect close retry
  MEMBER_OF: ['Character', 'Party'], // props: { order }
  FRIEND: ['User', 'User'],
  INVITED: ['Party', 'Character'],
  LISTED_IN: ['Item|Character', 'Kiosk'], // props: { price, exclusive, at_ms }
  HOLDS_CLAIM: ['User', 'CrushClaim|BoxClaim'],
  HOLDS_VOUCHER: ['User', 'Giftcard'],
} as const
