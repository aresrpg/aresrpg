// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE WIRE CONTRACT (owner 2026-08-12, legacy model): every packet is a REAL shape with a
// `packet/<name>` discriminant — no generic envelopes, no `kind: string`. The app and the
// server both import THIS module; a packet that isn't declared here does not exist.
//
// PUSH MODEL: the client sends INTENTS only (position, gameplay intents as they land) — never
// broad state queries; its own tx receipts update it client-side. The server pushes one load
// snapshot, then streams every fact the player's own transactions did not cause. Correlated,
// rate-limited requests exist only for facts that cannot be derived, such as current custody.

import { is_item_category, type ItemCategory } from '@aresrpg/immutable'
import { parse_fight_wire_action, type FightWireAction } from '@aresrpg/fight'

export type { FightWireAction } from '@aresrpg/fight'

// ╔════════════════ [ Shared model rows (graph-projected shapes) ] ════════════ ]

/** A worn item on a character — slot + the item's projected row (the character's own kiosk
 *  covers the tx side, so no per-item custody field here). */
export type EquippedItem = { slot: string } & Omit<ItemRow, 'kiosk'>

/** An item as the indexer projects it (packages/indexer graph.rs Item node). `kiosk` is the
 *  custody id — a TRANSACTION-BUILDING convenience only, never a player-facing grouping. */
export type ItemRow = {
  id: string
  name: string
  item_type: string
  category: string
  level: number
  amount: number
  kiosk: string
}

/** A character as the indexer projects it (graph.rs Character node, ALL sources: the base
 *  struct + the hp/spellbook/jobs/world/checkpoint dynamic fields) + custody context. */
export type CharacterRow = {
  id: string
  name: string
  classe: string
  sex: string
  experience: string
  level: number
  color_1: number
  color_2: number
  color_3: number
  vitality: number
  wisdom: number
  strength: number
  intelligence: number
  chance: number
  agility: number
  /** unspent STAT points (5 granted per level) */
  available_points: number
  /** persistent hp + its last-write timestamp (regen derives client-side) */
  hp?: string
  hp_ms?: number
  /** the spellbook: spell name → level (absent spells are level 1) */
  spells: Record<string, number>
  /** unspent SPELL points — a chain field like available_points (1 granted per level from 2) */
  available_spell_points: number
  /** job xp by slug (the 15 job slugs are immutable-module law) */
  jobs: Record<string, string>
  /** the world the character currently stands in, if joined */
  world?: string
  /** last checkpoint — x/z are trusted only when checkpoint_world equals world */
  checkpoint_world?: string
  x?: number
  z?: number
  at_ms?: number
  /** the checkpoint's equipment-derived mount flag (×1.5 speed law) */
  pet?: boolean
  kiosk: string
  equipment: EquippedItem[]
}

/** A searched zone as the indexer projects it — the SEED is the world surface: mobs and
 *  resources derive from it deterministically (zone.move law), consumption rides the bitmaps. */
export type ZoneRow = {
  world: string
  zx: number
  zz: number
  seed: string
  searched_at_ms: number
  mob_taken: string
  res_taken: number[]
}

/** One live mob group of a zone — derived deterministically from the zone seed (zone_math.move
 *  twin, server-side); positions are CHAIN space. `index` is the on-chain engage key. */
export type MobGroupRow = {
  index: number
  x: number
  z: number
  members: { mob_type: string; level_scalar: number }[]
}

/** One live resource pack of a zone — `nodes` is what remains after consumption. */
export type ResourcePackRow = {
  index: number
  x: number
  z: number
  item_type: string
  job: string
  tier: number
  nodes: number
}

/** A live fight marker in the world — enough to render and approach; details come on spectate. */
export type FightRow = {
  id: string
  world: string
  x: number
  z: number
  phase: string
  access_a: number
  access_b: number
  managed: boolean
  wagered: boolean
}

/** The equipment slots OTHER players can see (owner 2026-08-12) — everything else is
 *  fight-internal (HP math) and never rides presence. */
export const VISIBLE_SLOTS = ['hat', 'cloak', 'pet', 'title'] as const
export type VisibleSlot = (typeof VISIBLE_SLOTS)[number]

/** What a nearby player looks like — the display payload published once on appearance.
 *  The four visible slots carry the equipped item's TYPE (null when bare). */
export type PresenceRow = {
  character_id: string
  name: string
  classe: string
  sex: string
  level: number
  color_1: number
  color_2: number
  color_3: number
  hat: string | null
  cloak: string | null
  title: string | null
  /** equipped protector pet's item type — non-null means MOUNTED (×1.5 speed law) */
  pet: string | null
  x: number
  y: number
  z: number
}

/** A market listing — the projected item + its LISTED_IN price edge. */
export type ListingRow = {
  id: string
  name: string
  item_type: string
  category: string
  level: number
  amount: number
  price_mist: string
  kiosk: string
  at_ms: number
}

/** The player's party as projected (MEMBER_OF edges around one Party node). */
export type PartyRow = {
  id: string
  members: { character_id: string; name: string; order: number }[]
}

/** One parked cap inside a trade — the item the counterparty will receive. */
export type TradeCapRow = { object: string; name: string; item_type: string }

/** The p2p escrow as projected (trade.move Trade — the graph node, manifests enriched). */
export type TradeRow = {
  id: string
  a: string
  b: string
  /** bumped by every mutation; accept intents must name it (stale accepts abort on-chain) */
  version: number
  accept_a: boolean
  accept_b: boolean
  locked: boolean
  sui_a: string
  sui_b: string
  caps_a: TradeCapRow[]
  caps_b: TradeCapRow[]
}

/** A pending grind-safe claim (soulbound, redeem later — crush or loot box). */
export type ClaimRow = { id: string; kind: 'crush' | 'box' }

/** Mutable shop state. Authored names, prices, art, and initial caps stay in seed/. */
export type ShopSaleState = Readonly<{ item_type: string; supply: string }>
export type AirdropState = Readonly<{
  drop_id: string
  eligible: boolean
  eligible_count: number
}>
export type ShopState = Readonly<{ sales: readonly ShopSaleState[]; airdrops: readonly AirdropState[] }>

/** Zones are 512-block squares (zone.move ZONE_SIZE) — the tracking unit for everything. */
export const ZONE_SIZE = 512
export const zone_of = (x: number, z: number) => ({ zx: Math.floor(x / ZONE_SIZE), zz: Math.floor(z / ZONE_SIZE) })

/** The AUTHORED speed law (world.move SPEED_BUDGET 1150 ×100 fixed-point): 11.5 blocks/s —
 *  engine RUN_SPEED 10.5 + 10% terrain slack. The server enforces the SAME number the chain
 *  proves travel against; never a separate constant. */
export const SPEED_BUDGET_BLOCKS_PER_SECOND = 11.5

/** The 1008-close reasons that mean the SERVER dropped this client for a rule violation —
 *  the server's cool-off ban and the client's red connection state both key on this ONE set
 *  (lifecycle closes like REPLACED / ALREADY_CONNECTED share the code, never the meaning). */
export const VIOLATION_DROP_REASONS: ReadonlySet<string> = new Set(['SPEED', 'RATE_LIMIT'])
/** Mounted pet = ×1.5 (world.move PET_NUM/PET_DEN, the both-end rule chain-side). */
export const PET_SPEED_MULTIPLIER = 1.5

/** Chat limits — shared so the client pre-limits what the server's flood gate enforces. */
export const CHAT_MAX_LENGTH = 240
export const CHAT_MIN_INTERVAL_MS = 1000

/** The owner's admin address — ONE home: the server's `ADMIN_ADDRESSES` default and the
 *  client's admin-page gate both derive from it. UI-side gating is cosmetic; authority stays
 *  the server whitelist and the on-chain caps. */
export const DEFAULT_ADMIN_ADDRESS = '0x3d1342fb7de99c69ce821183bcfc5b6374d81453bf5ca9bf7e383e75b3722983'

// ╔════════════════ [ client → server (intents, never queries) ] ══════════════ ]

export type ClientPackets = {
  /** The sole pre-auth packet: proof over the challenge issued by this exact socket. */
  'packet/signature_response': { bytes: string; signature: string }
  /** Play THIS character — the server verifies ownership, then mounts world tracking around
   *  its checkpoint and pushes the world (zones, fights, players). */
  'packet/embody': { character_id: string }
  /** The player's live position — drives zone tracking, visibility, and the presence mesh. */
  'packet/position': { x: number; y: number; z: number }
  /** World chat — heard by everyone standing in the same world, never stored. */
  'packet/chat': { text: string }
  /** Party chat — rides the party's channel; refused when partyless. */
  'packet/chat_party': { text: string }
  /** Whisper — rides the target address's own channel. */
  'packet/chat_whisper': { to: string; text: string }
  /** A live fight action relayed to the other fighters. The fight package owns its shape. */
  'packet/fight_action': { fight: string; action: FightWireAction }
  /** Browse intent — folds the observed category into state; the server pushes the slice and
   *  streams its deltas while observed. Null stops observing. Not a query: state, then push. */
  'packet/market_observe': { category: ItemCategory | null }
  /** Spectate a fight standing in the tracked spiral — folds into state; the server verifies
   *  the fight is truly nearby, then streams it. Null stops. */
  'packet/spectate': { fight: string | null }
  /** Registry + name derived the character ID client-side. Current wallet custody is mutable,
   *  so this narrowly asks the indexed owner of that exact object. */
  'packet/character_owner_request': { id: number; character_id: string }
  /** Privileged dashboard request — whitelisted addresses only; everyone else gets a refusal. */
  'packet/admin_request': { id: number; kind: 'stats'; params?: Record<string, unknown> }
  /** Authenticated transport probe. The server echoes the opaque id; neither side stores it. */
  'packet/ping': { id: number }
}

// ╔════════════════ [ server → client (the push stream) ] ═════════════════════ ]

export type ServerPackets = {
  /** Pre-auth challenge. No player state exists until its matching proof verifies. */
  'packet/signature_request': { payload: string }
  'packet/connection_accepted': { address: string }
  /** Transport-only ping response used to measure this socket's round-trip time. */
  'packet/pong': { id: number }
  // ── the one-time load snapshot ──
  'packet/characters': { characters: CharacterRow[] }
  /** The user's ONE flat inventory — every held item, whatever kiosk custody it sits in. */
  'packet/inventory': { items: ItemRow[] }
  /** Friend ADDRESSES — the social baseline the friend stream then patches. */
  'packet/friends': { friends: string[] }
  /** Pending grind-safe claims (crush/box) awaiting their reveal transaction. */
  'packet/claims': { claims: ClaimRow[] }
  /** Held giftcard vouchers. */
  'packet/giftcards': { giftcards: { id: string; template: string; amount: number }[] }
  /** The player's own ACTIVE market listings. */
  'packet/listings': { listings: ListingRow[] }
  /** The player's OPEN trades (either side) — the escrow replaces transferred caps. */
  'packet/trades': { trades: TradeRow[] }
  /** Current mutable shop state; immutable presentation remains the local seed catalog. */
  'packet/shop_state': ShopState

  // ── cluster + indexer heartbeat (5s cadence, decorrelated from user activity) ──
  'packet/server_info': { online: number; indexing_lag: number | null }
  /** Version 0 is the global emergency brake; null means the projection is not available yet. */
  'packet/game_state': { frozen: boolean | null }
  'packet/character_owner_response': { id: number; character_id: string; name: string; owner: string }

  // ── social stream (facts other players' transactions caused, targeting this player) ──
  'packet/friend_added': { list: string; who: string }
  'packet/friend_removed': { list: string; who: string }
  /** A trade involving this player was born or changed — the full row, every time. */
  'packet/trade': { trade: TradeRow }
  'packet/trade_destroyed': { trade: string }
  /** The player was invited to a party (their character named on-chain). */
  'packet/party_invited': { party: string; character: string }

  // ── the world (pushed on embody + as the tracked spiral moves; owner: chunk-spiral law) ──
  'packet/zones': { zones: ZoneRow[] }
  'packet/fights': { fights: FightRow[] }
  /** A tracked zone's live population — sent when a discovered zone enters the spiral and again
   *  the moment a tracked zone is searched (fresh seed, fresh spawns). */
  'packet/zone_spawns': { world: string; zx: number; zz: number; mobs: MobGroupRow[]; resources: ResourcePackRow[] }

  // ── the presence mesh (other players in tracked zones) ──
  'packet/player_appeared': { player: PresenceRow }
  'packet/player_moved': { character_id: string; x: number; y: number; z: number }
  'packet/player_left': { character_id: string }

  // ── live world stream (indexer facts other players caused) ──
  'packet/zone_searched': { world: string; zx: number; zz: number; seed: string }
  'packet/fight_created': { fight: string; world: string; x: number; z: number }
  'packet/resource_gathered': { world: string; gatherer: string; item_type: string; tier: number; quantity: number }
  'packet/rare_gathered': { world: string; gatherer: string; item_type: string; rare_item_type: string }
  /** A VISIBLE player changed a visible slot (their chain event, forwarded). */
  'packet/player_equipment': { character_id: string; slot: VisibleSlot; item_type: string | null }

  // ── chat (off-chain, published on the mesh, never stored) ──
  'packet/chat_message': { channel: 'world' | 'party' | 'whisper'; from: string; character: string; text: string }

  // ── the fight stream (own fight auto-watched via FighterJoined; spectate by intent) ──
  /** The player's embodied character sits a LIVE fight — pushed at embody (mid-fight reconnect). */
  'packet/fight_state': { fight: FightRow; seat: number }
  'packet/fight_started': { fight: string; queue: string[] }
  /** The per-mob-turn seed witness — the client replays the wave deterministically off it. */
  'packet/mob_turn': { fight: string; seat: string; seed: string }
  'packet/fight_ended': { fight: string; winner: number | null }
  'packet/fight_drops': { fight: string; fighter: string; drops: { item_type: string; qty: number }[] }
  /** Another fighter's live turn intent, relayed (see the client packet's TODO(sim)). */
  'packet/fight_action': { fight: string; from: string; action: FightWireAction }

  // ── party stream (the party's channel — other members' transactions) ──
  'packet/party': { party: PartyRow | null }
  'packet/party_joined': { party: string; character: string }
  'packet/party_left': { party: string; character: string }

  // ── market stream (only while observing a category — plus your own sales, always) ──
  'packet/market_slice': { category: string; listings: ListingRow[] }
  'packet/market_listed': { listing: ListingRow }
  'packet/market_delisted': { object: string }
  /** One of YOUR listings sold (the buyer's transaction — money arrived in your kiosk). */
  'packet/listing_sold': { object: string; price_mist: string }

  // ── primary shop stream (other players' transactions only) ──
  'packet/shop_supply': ShopSaleState
  'packet/airdrop_remaining': { drop_id: string; eligible_count: number }

  // ── kolizeum stream ──
  'packet/kolizeum_created': { kolizeum: string; fight: string; pledge: string; format: string }
  'packet/kolizeum_paid': { kolizeum: string; winner: string; amount: string }

  // ── admin ──
  'packet/admin_response': { id: number; result: unknown }

  // ── refusals — instruments THROW server-side, the wire answers honestly ──
  'packet/error': { id?: number; reason: string }
}

// ╔════════════════ [ Derived unions + the parse door ] ═══════════════════════ ]

export type ClientPacket = { [K in keyof ClientPackets]: { type: K } & ClientPackets[K] }[keyof ClientPackets]
export type ServerPacket = { [K in keyof ServerPackets]: { type: K } & ServerPackets[K] }[keyof ServerPackets]
export type Packet = ClientPacket | ServerPacket

// ╔════════════════ [ Client routing — which store folds which packet ] ═══════ ]
// ONE home: a packet joins a domain here, nowhere else. Membership IS the client routing —
// a name in two lists reaches two stores; a name in none is unparseable by construction.

export const SESSION_PACKETS = [
  'packet/signature_request',
  'packet/connection_accepted',
  'packet/characters',
  'packet/inventory',
  'packet/friends',
  'packet/claims',
  'packet/giftcards',
  'packet/listings',
  'packet/trades',
  'packet/shop_state',
  'packet/server_info',
  'packet/game_state',
  'packet/character_owner_response',
  'packet/friend_added',
  'packet/friend_removed',
  'packet/trade',
  'packet/trade_destroyed',
  'packet/market_delisted',
  'packet/listing_sold',
  'packet/shop_supply',
  'packet/airdrop_remaining',
  'packet/error',
] as const

export const WORLD_PACKETS = [
  'packet/zones',
  'packet/zone_spawns',
  'packet/fights',
  'packet/player_appeared',
  'packet/player_moved',
  'packet/player_left',
  'packet/player_equipment',
  'packet/chat_message',
  'packet/party',
  'packet/party_invited',
  'packet/party_joined',
  'packet/party_left',
  'packet/zone_searched',
  'packet/fight_created',
  'packet/resource_gathered',
  'packet/rare_gathered',
] as const

export const FIGHT_PACKETS = [
  'packet/fight_state',
  'packet/fight_started',
  'packet/mob_turn',
  'packet/fight_action',
  'packet/fight_ended',
  'packet/fight_drops',
] as const

export const MARKET_PACKETS = [
  'packet/market_slice',
  'packet/market_listed',
  'packet/market_delisted',
  'packet/listing_sold',
] as const

export const KOLIZEUM_PACKETS = ['packet/kolizeum_created', 'packet/kolizeum_paid'] as const

/** Parseable but folded by NO store — arrives only on surfaces without a UI yet. */
export const IGNORED_PACKETS = ['packet/admin_response'] as const

/** Consumed at the transport boundary before packets enter a domain reducer. */
export const TRANSPORT_PACKETS = ['packet/pong'] as const

export const SERVER_PACKET_TYPES = [
  ...SESSION_PACKETS,
  ...WORLD_PACKETS,
  ...FIGHT_PACKETS,
  ...MARKET_PACKETS,
  ...KOLIZEUM_PACKETS,
  ...IGNORED_PACKETS,
  ...TRANSPORT_PACKETS,
] as const satisfies readonly ServerPacket['type'][]

/** The server is trusted and shares this package; the client only decodes JSON syntax here. */
export const parse_server_packet = (raw: string): ServerPacket => JSON.parse(raw) as ServerPacket

export type SessionPacket = Extract<ServerPacket, { type: (typeof SESSION_PACKETS)[number] }>
export type WorldPacket = Extract<ServerPacket, { type: (typeof WORLD_PACKETS)[number] }>
export type FightPacket = Extract<ServerPacket, { type: (typeof FIGHT_PACKETS)[number] }>
export type MarketPacket = Extract<ServerPacket, { type: (typeof MARKET_PACKETS)[number] }>
export type KolizeumPacket = Extract<ServerPacket, { type: (typeof KOLIZEUM_PACKETS)[number] }>

type RoutedPacketType =
  | (typeof SESSION_PACKETS)[number]
  | (typeof WORLD_PACKETS)[number]
  | (typeof FIGHT_PACKETS)[number]
  | (typeof MARKET_PACKETS)[number]
  | (typeof KOLIZEUM_PACKETS)[number]
  | (typeof IGNORED_PACKETS)[number]
  | (typeof TRANSPORT_PACKETS)[number]
// The census seal: this line reds the moment a declared server packet joins no domain list.
const UNROUTED_SERVER_PACKETS: Record<Exclude<ServerPacket['type'], RoutedPacketType>, never> = {}
void UNROUTED_SERVER_PACKETS

/** Every declared client packet type — the parse door's allowlist. */
export const CLIENT_PACKET_TYPES = [
  'packet/signature_response',
  'packet/embody',
  'packet/position',
  'packet/chat',
  'packet/chat_party',
  'packet/chat_whisper',
  'packet/fight_action',
  'packet/market_observe',
  'packet/spectate',
  'packet/character_owner_request',
  'packet/admin_request',
  'packet/ping',
] as const satisfies readonly (keyof ClientPackets)[]

const is_finite_number = (value: unknown): value is number => Number.isFinite(value)

const is_id = (value: unknown): value is string => typeof value === 'string' && value.startsWith('0x')

/** A sendable chat text: non-empty after trim, within the shared length law. */
const assert_chat_text = (text: unknown): string => {
  if (typeof text !== 'string') throw new Error('chat needs a text')
  const trimmed = text.trim()
  if (trimmed.length === 0) throw new Error('chat text is empty')
  if (trimmed.length > CHAT_MAX_LENGTH) throw new Error(`chat text exceeds ${CHAT_MAX_LENGTH}`)
  return trimmed
}

const assert_bounded_json = (value: unknown, depth = 0): void => {
  if (depth > 5) throw new Error('packet data is nested too deeply')
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return
  if (Array.isArray(value)) {
    if (value.length > 380) throw new Error('packet array is too large')
    value.forEach((entry) => assert_bounded_json(entry, depth + 1))
    return
  }
  if (typeof value !== 'object') throw new Error('packet data is not JSON')
  const entries = Object.entries(value)
  if (entries.length > 128) throw new Error('packet object is too large')
  entries.forEach(([, entry]) => assert_bounded_json(entry, depth + 1))
}

const parse_fight_action_packet = (
  packet: Readonly<Record<string, unknown>>
): Extract<ClientPacket, { type: 'packet/fight_action' }> => {
  if (!is_id(packet.fight)) throw new Error('packet/fight_action needs a fight id')
  if (typeof packet.action !== 'object' || packet.action === null || Array.isArray(packet.action))
    throw new Error('packet/fight_action needs an action object')
  assert_bounded_json(packet.action)
  return { type: 'packet/fight_action', fight: packet.fight, action: parse_fight_wire_action(packet.action) }
}

/** Parse one raw client message into a declared packet, or throw — never coerce. The server
 *  calls this at its door; an undeclared or malformed packet is refused before any module. */
export function parse_client_packet(raw: string | Buffer): ClientPacket {
  const packet = JSON.parse(String(raw)) as Record<string, unknown>
  const { type } = packet
  if (type === 'packet/signature_response') {
    if (typeof packet.bytes !== 'string' || typeof packet.signature !== 'string')
      throw new Error('packet/signature_response needs bytes and signature')
    return packet as ClientPacket
  }
  if (type === 'packet/embody') {
    if (typeof packet.character_id !== 'string' || !packet.character_id.startsWith('0x'))
      throw new Error('packet/embody needs a character_id')
    return packet as ClientPacket
  }
  if (type === 'packet/position') {
    const { x, y, z } = packet
    if (!is_finite_number(x) || !is_finite_number(y) || !is_finite_number(z))
      throw new Error('packet/position needs { x, y, z }')
    return packet as ClientPacket
  }
  if (type === 'packet/chat' || type === 'packet/chat_party') {
    return { type, text: assert_chat_text(packet.text) }
  }
  if (type === 'packet/chat_whisper') {
    if (!is_id(packet.to)) throw new Error('packet/chat_whisper needs a target address')
    return { type, to: packet.to, text: assert_chat_text(packet.text) }
  }
  if (type === 'packet/fight_action') return parse_fight_action_packet(packet)
  if (type === 'packet/market_observe') {
    if (packet.category !== null && (typeof packet.category !== 'string' || !is_item_category(packet.category)))
      throw new Error('packet/market_observe needs a category or null')
    return packet as ClientPacket
  }
  if (type === 'packet/spectate') {
    if (packet.fight !== null && !is_id(packet.fight)) throw new Error('packet/spectate needs a fight id or null')
    return packet as ClientPacket
  }
  if (type === 'packet/character_owner_request') {
    if (!Number.isInteger(packet.id)) throw new Error('packet/character_owner_request needs an integer id')
    if (!is_id(packet.character_id)) throw new Error('packet/character_owner_request needs a character id')
    return packet as ClientPacket
  }
  if (type === 'packet/admin_request') {
    if (packet.kind !== 'stats') throw new Error(`unknown admin kind "${String(packet.kind)}"`)
    if (!Number.isInteger(packet.id)) throw new Error('packet/admin_request needs an integer id')
    return packet as ClientPacket
  }
  if (type === 'packet/ping') {
    if (!Number.isSafeInteger(packet.id) || Number(packet.id) < 0) throw new Error('packet/ping needs a safe id')
    return packet as ClientPacket
  }
  throw new Error(`unknown packet type "${String(type)}"`)
}
