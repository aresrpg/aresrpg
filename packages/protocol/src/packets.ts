// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE WIRE CONTRACT (owner 2026-08-12, legacy model): every packet is a REAL shape with a
// `packet/<name>` discriminant — no generic envelopes, no `kind: string`. The app and the
// server both import THIS module; a packet that isn't declared here does not exist.
//
// PUSH MODEL: the client sends INTENTS only (position, gameplay intents as they land) — never
// queries; its own tx receipts update it client-side. The server pushes one load snapshot at
// connection, then streams every fact the player's own transactions did not cause. The
// whitelisted admin request is the single query exception.

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
  /** lifetime spell points spent — see available_spell_points() for the live pool */
  spell_points_spent: number
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

/** Available SPELL points — the chain formula (progression.move): one point granted per level
 *  from level 2, minus lifetime spent. ONE home; both sides derive, never store. */
export const available_spell_points = ({
  level,
  spell_points_spent,
}: Pick<CharacterRow, 'level' | 'spell_points_spent'>): number => Math.max(0, level - 1 - spell_points_spent)

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

/** Zones are 512-block squares (zone.move ZONE_SIZE) — the tracking unit for everything. */
export const ZONE_SIZE = 512
export const zone_of = (x: number, z: number) => ({ zx: Math.floor(x / ZONE_SIZE), zz: Math.floor(z / ZONE_SIZE) })

/** The AUTHORED speed law (world.move SPEED_BUDGET 1150 ×100 fixed-point): 11.5 blocks/s —
 *  engine RUN_SPEED 10.5 + 10% terrain slack. The server enforces the SAME number the chain
 *  proves travel against; never a separate constant. */
export const SPEED_BUDGET_BLOCKS_PER_SECOND = 11.5
/** Mounted pet = ×1.5 (world.move PET_NUM/PET_DEN, the both-end rule chain-side). */
export const PET_SPEED_MULTIPLIER = 1.5

/** Chat limits — shared so the client pre-limits what the server's flood gate enforces. */
export const CHAT_MAX_LENGTH = 240
export const CHAT_MIN_INTERVAL_MS = 1000

// ╔════════════════ [ client → server (intents, never queries) ] ══════════════ ]

export type ClientPackets = {
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
  /** A live fight-turn intent (aim previews, piece motion) relayed to the other fighters.
   *  TODO(sim): once the simulation package lands, the server VALIDATES the action is legal
   *  for the current fight state before relaying — until then it relays shape-checked only.
   *  The action union is the sim package's to define (one home); loose until it exists. */
  'packet/fight_action': { fight: string; action: Record<string, unknown> }
  /** Browse intent — folds the observed category into state; the server pushes the slice and
   *  streams its deltas while observed. Null stops observing. Not a query: state, then push. */
  'packet/market_observe': { category: string | null }
  /** Spectate a fight standing in the tracked spiral — folds into state; the server verifies
   *  the fight is truly nearby, then streams it. Null stops. */
  'packet/spectate': { fight: string | null }
  /** The ONE query exception — whitelisted addresses only; everyone else gets a refusal. */
  'packet/admin_request': { id: number; kind: 'stats'; params?: Record<string, unknown> }
}

// ╔════════════════ [ server → client (the push stream) ] ═════════════════════ ]

export type ServerPackets = {
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

  // ── cluster heartbeat (5s cadence, decorrelated from user activity — owner 2026-08-12) ──
  'packet/server_info': { online: number }

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
  'packet/fight_action': { fight: string; from: string; action: Record<string, unknown> }

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

/** Every declared client packet type — the parse door's allowlist. */
export const CLIENT_PACKET_TYPES = [
  'packet/embody',
  'packet/position',
  'packet/chat',
  'packet/chat_party',
  'packet/chat_whisper',
  'packet/fight_action',
  'packet/market_observe',
  'packet/spectate',
  'packet/admin_request',
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

/** Parse one raw client message into a declared packet, or throw — never coerce. The server
 *  calls this at its door; an undeclared or malformed packet is refused before any module. */
export function parse_client_packet(raw: string | Buffer): ClientPacket {
  const packet = JSON.parse(String(raw)) as Record<string, unknown>
  const { type } = packet
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
  if (type === 'packet/fight_action') {
    if (!is_id(packet.fight)) throw new Error('packet/fight_action needs a fight id')
    if (typeof packet.action !== 'object' || packet.action === null || Array.isArray(packet.action))
      throw new Error('packet/fight_action needs an action object')
    return packet as ClientPacket
  }
  if (type === 'packet/market_observe') {
    if (packet.category !== null && typeof packet.category !== 'string')
      throw new Error('packet/market_observe needs a category or null')
    return packet as ClientPacket
  }
  if (type === 'packet/spectate') {
    if (packet.fight !== null && !is_id(packet.fight)) throw new Error('packet/spectate needs a fight id or null')
    return packet as ClientPacket
  }
  if (type === 'packet/admin_request') {
    if (packet.kind !== 'stats') throw new Error(`unknown admin kind "${String(packet.kind)}"`)
    if (!Number.isInteger(packet.id)) throw new Error('packet/admin_request needs an integer id')
    return packet as ClientPacket
  }
  throw new Error(`unknown packet type "${String(type)}"`)
}
