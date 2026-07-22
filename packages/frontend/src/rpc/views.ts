// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RPC read-API view contract (SPEC §14) — the TypeScript mirror of packages/rpc/api/views.js.
//
// This is the frontend's single home for the `/v1/*` response shapes. It is a HAND-MIRRORED contract
// (there is no shared type across the Bun api and this app, exactly as the Rust indexer and the Bun views
// mirror each other by hand — see packages/rpc/indexer/HANDLERS.md). Keep field names byte-for-byte with
// views.js: a drift here is a silent read bug.
//
// MONEY IS STRINGS. Every `*_mist` field is a decimal string (u64 MIST survives past JSON's 2^53) — never
// coerce it to Number for math; use BigInt. Counts, coordinates, levels, seats and rooms are JSON numbers.
// Fields the indexer cannot yet resolve from events (character level/colors, listed-character level) are
// `null` until object-snapshot indexing lands — the UI renders the gap, never fakes it.

// --- liveness / status -------------------------------------------------------

export type RpcStatus =
  | { status: 'degraded'; redis: 'down' }
  | { status: 'starting'; redis: 'up'; indexed: false; note: string }
  | {
      status: 'ok'
      redis: 'up'
      network: string | null
      indexed: true
      latest_checkpoint: number
      epoch: number
      checkpoint_timestamp_ms: number
      committer_watermark: number | null
      lag_ms: number
      lag_seconds: number
    }

// --- characters --------------------------------------------------------------

export interface CharacterEquip {
  item_id: string
  template: string
  category: string | null // joined from the template object snapshot; null until that template is snapshotted
  amount: number
}

export interface CharacterPet {
  item_id: string
  template_id: string
  slug: string
}

// A worn cosmetic slot's equipped item (hat/cloak) — the shape resolve_worn_cosmetics reads once
// rpc_to_card spreads `worn` onto the render character. `template_id` is the GLB key (cosmetics/<id>.glb).
export interface WornCosmetic {
  item_id: string
  template_id: string
  category: string
}

export interface RpcCharacter {
  id: string
  owner: string | null
  name: string | null
  class: string | null
  male: boolean | null // pending object-snapshot indexing
  level: number | null // pending object-snapshot indexing
  experience: number | null // pending object-snapshot indexing
  colors: { color_1: number; color_2: number; color_3: number } | null // pending object-snapshot indexing
  kiosk_id: string | null // the kiosk currently holding this (always kiosk-locked, §11) character; null
  // until object-snapshot indexing resolves it (e.g. never-yet-snapshotted or escrowed out of a kiosk)
  listed: boolean // joined against rpc:listing:{id} — already on the market? (SELL/kolizeum picker signal)
  world: string | null
  position: { x: number; z: number; zone?: string; at_ms?: number } | null
  // §3 allocated stats (event-sourced `stat_allocation::StatRaised`; 0 before the first raise) + the
  // derived unspent pool (earned − spent, off the snapshotted `level`). Unlike level/experience/colors,
  // the api always computes these — never null (packages/rpc/api/views.js handle_characters).
  vitality: number
  wisdom: number
  strength: number
  intelligence: number
  agility: number
  chance: number
  available_points: number
  // LIVE HP — object-snapshotted from the character_link::Progression DF (RAW stored hp + the lazy-regen
  // last-touch stamp; the client owns the §5.4 natural-regen projection — the indexer never pre-computes it).
  // `gear_vitality` is the positive-only compatibility cache. `equipment_stats` is the exact signed aggregate
  // (`EquipmentMap.gear` − active malus cache) shared with fights; null until the snapshot backfill lands.
  current_hp: number | null
  hp_updated_ms: number | null
  gear_vitality: number | null
  equipment_stats: Record<string, number> | null
  // Current pet truth comes from EquipmentMap.pet; identity comes from its sibling Item field.
  // `pet_equipped: true` with `pet: null` is an honest identity-snapshot gap, not a riding toggle.
  pet: CharacterPet | null
  pet_equipped: boolean
  equipment: CharacterEquip[]
  worn?: Record<string, WornCosmetic> // GLB-worn cosmetic slots (hat/cloak) keyed by category; absent when none equipped
  jobs?: Record<string, number>
}

// --- owner items (the loose kiosk-locked bag, per wallet) --------------------
// One row per unequipped Item held across the wallet's personal kiosks (/v1/owner-items).
// The exact base shape read_staking.js's chain-direct bag builds — the client derives
// `stackable` from `item_category`, so it is NOT on the wire. `item_set` has no on-chain
// source (always ''); `level` is the event-sourced scribe level (0 for the unscribed majority).
export interface RpcOwnedItem {
  id: string
  kiosk_id: string
  kiosk_cap_id: string | null
  template_id: string | null
  name: string
  item_category: string
  item_set: string
  item_type: string
  level: number
  amount: number
  listed: boolean // joined against rpc:listing:{id} — already on the market? (SELL picker signal)
}

// --- listings (marketplace, items AND characters) ----------------------------

export interface RpcListing {
  item_id: string
  kiosk_id: string
  category: string | null // item_type for items, "character" for a listed character
  template_id: string | null // canonical ItemTemplate id; null for characters/legacy rows
  item_category: string | null // stackable discriminator joined from the indexed Item snapshot
  amount: number | null // Item amount (characters 1); null until the listing's item/character doc is snapshotted
  level: number | null
  name: string | null // characters carry a name; items render from their template
  price_mist: string
  seller: string
}

export interface RpcListingsPage {
  listings: RpcListing[]
  total: number
  next_cursor: string | null
}

export type ListingSort = 'price_asc' | 'price_desc' | 'level_asc' | 'level_desc'

// --- sales history (marketplace, seller-side realised sales) ------------------
// A seller's REALISED kiosk sales (native `0x2::kiosk::ItemPurchased`): what sold, when, at what price,
// to whom + trailing-30d revenue. `?seller=` resolves seller → kiosk(s) → the per-kiosk sales log
// (packages/rpc/api/views.js handle_sales_history — mirror byte-for-byte). `category` is the item's
// item_type SLUG (the ItemImage `id` + `templates_item` lookup key); `template_id` is the on-chain
// ItemTemplate object id — BOTH null for a character sale (no item doc) or a since-burned item. MIST is
// a string (revenue_30d_mist too — BigInt for math, never Number). `next_cursor` is a numeric string.

export interface RpcSalesRow {
  item_id: string
  template_id: string | null
  category: string | null
  level: number | null
  price_mist: string
  buyer: string
  sold_at_ms: number
}

export interface RpcSalesHistory {
  seller: string
  sales: RpcSalesRow[]
  revenue_30d_mist: string
  total: number
  next_cursor: string | null
}

// --- pools (constant-product AMM, stackable trade) ---------------------------

export interface RpcPool {
  pool_id: string
  template_id: string
  item_reserve: number
  virtual_sui_mist: string
  real_sui_mist: string
  sui_reserve_mist: string // virtual + real (the curve reserve)
  spot_price_mist: string | null // marginal buy price of one item; null when ≤1 item remains
  paused: boolean
}

// --- shop (first-party sales) ------------------------------------------------

export interface RpcSale {
  sale_id: string
  template_id: string
  price_mist: string
  minted: number
  supply_remaining: number | null // null = unlimited
  starts_ms: number | null
  ends_ms: number | null
  paused: boolean
}

// --- zones (per-world discovery state) ---------------------------------------

export interface RpcZone {
  zone_id: string // `${zx}:${zy}`
  zx: number
  zy: number
  discovered: boolean
  discovered_at_ms: number
  mob_groups: number
  resource_nodes: number
  // The ZONE STATE (search-cost rework — the Zone DF stores seed + consumed-bitmaps, never spawn rows):
  // present ONLY on the single-zone read (`/v1/zones?world=&zone=zx:zy`); absent on the discovered-zone LIST
  // form (counts only). The client derives the live rows from it (game/zone_rows.js → @aresrpg/sim
  // derive_zone). `seed` is a full u64 → STRING (2^53 law).
  seed?: string
  mob_bitmap?: number[]
  res_bitmap?: number[]
}

export interface RpcZones {
  world: string
  seed: string | null // world seed — full u64 → STRING on the wire (2^53 law), null until the world doc lands
  biome: string | null
  zones: RpcZone[]
}

// --- rare links (§6 golden-gather authored base→rare variant links) ---------
// Existence-only: which base resource template has an admin-authored jackpot variant, and
// which minted template id IS that variant. The roll RATE is a fixed Move const (never
// event-projected) — published as a UI constant alongside this read, not served here.

export interface RpcRareLink {
  world: string
  template_id: string
  rare_template_id: string
}

export interface RpcRareLinks {
  rare_links: RpcRareLink[]
}

// --- encyclopedia (on-chain template liveness, SPEC §14) ---------------------
// item name/level/category and mob name/level-range/hp/element come from the object-
// snapshot pipeline (the mint EVENT carries only ids/item_type — the rest lives in the
// object contents). `null` until the snapshot has reached that template — the UI renders
// the gap, never fakes it. Spells are NOT served here: the client resolves minted
// SpellTemplates directly (fight-spells.json), so no spell-liveness view is keyed.

export interface RpcEncyclopediaItem {
  template_id: string
  item_type: string | null
  name: string | null
  description: string | null // §14 EN description (create_template Display); locale overlaid client-side via template_t
  level: number | null
  category: string | null
  // Biased on-chain StatsMinKey/StatsMaxKey ranges. The frontend decodes these through
  // chain/read_templates.js's shared item-stat decoder before rendering them.
  stats?: Record<string, [number | null, number | null]>
  // Live on-chain supply (indexer HANDLERS.md "Item supply"): SUM of still-alive `amount` units
  // across every minted Item of this template. Fully event-derived (mint +amount / burn -amount),
  // so — unlike level/category — never null; a template with zero mints/burns ever seen is an
  // honest 0, not a "snapshot hasn't arrived yet" gap.
  supply: number
  // Last realised PER-UNIT sale price in MIST (string — 2^53 money law; HANDLERS.md "Last sale":
  // shop / pool / kiosk-marketplace venues, zero-price extract-seam purchases excluded). null until
  // the template's FIRST sale ever — the client renders "marketcap unknown", never a fabricated 0.
  last_sale_mist: string | null
}

// One server-joined loot row for the §14 bestiary drops table. `name`/`category` are the
// referenced item template's object-snapshot fields (null until snapshotted); `chance_percent`
// is the on-chain basis-point chance rendered as a percent (10000 bp = 100%).
export interface RpcMobDrop {
  template_id: string
  name: string | null
  category: string | null
  chance_percent: number
  min_qty: number
  max_qty: number
}

export interface RpcEncyclopediaMob {
  template_id: string
  name: string | null
  min_level: number | null
  max_level: number | null
  base_hp: number | null
  element: number | null // raw spell discriminant: 0=fire, 1=water, 2=earth, 3=air, 255=none
  // Display-ready loot rows (server-joined). `null` = the snapshot could not decode the loot
  // tail (honest unknown → the client falls back to the bundled catalog); `[]` = no drops.
  drops: RpcMobDrop[] | null
}

// One on-chain `crafting::Recipe` (object-snapshotted — rpc:recipe:{id}, snapshot.rs
// map_recipe_object; served by /v1/encyclopedia?kind=recipes). EXACT chain values: the
// ingredient list (template id + quantity), output template + quantity, the required job
// (u8 — the SDK JOBS array index) + knowledge level, and the per-craft xp. Ingredient/
// output NAMES are not served — the client joins them against the same view's `items`
// list (raw ids on the wire, never a server-fabricated display value).
export interface RpcRecipeIngredient {
  template_id: string
  quantity: number
}

export interface RpcRecipe {
  recipe_id: string
  output_template_id: string
  output_quantity: number
  required_job: number
  required_level: number
  craft_xp: number
  inputs: RpcRecipeIngredient[]
}

export interface RpcEncyclopedia {
  items: RpcEncyclopediaItem[]
  mobs: RpcEncyclopediaMob[]
  worlds: Array<{ world_id: string; seed: string; biome: string; required_level: number }> // seed: u64 → string (2^53 law)
  recipes: RpcRecipe[]
}

// --- config / creation -------------------------------------------------------
// Free-form indexer docs (rpc:config / rpc:creation) — typed loosely on purpose; the shapes evolve with
// on-chain dials and a strict type here would drift. Consumers read the fields they need defensively.
export type RpcConfig = Record<string, unknown> & {
  /** GameConfig's OWN global master switch (config.move's ConfigEnabledSet projection) — `null` until an
   * admin has EVER called `set_enabled` at least once (event-sourced, not object-hydrated: ships dark but
   * the initial `false` is never mirrored until the first explicit toggle). S-84 contracts-paused modal:
   * treat `null` as unknown (never show), `false` as confirmed paused, `true` as confirmed live. This is a
   * DIFFERENT switch than each package's own `version::Version.enabled` dark-ship gate (not projected here —
   * contracts_paused_modal.tsx reads that one chain-direct). */
  enabled?: boolean | null
  /** Global game dials keyed by name (config.move's DialChanged projection) — e.g. `pvp_level_gate`.
   * A dial only appears here once an admin has explicitly set it (GameConfig has no object-snapshot
   * pipeline) — an un-set dial is simply ABSENT, never a stale zero. */
  dials?: Record<string, number>
  /** §17.22 gather-ambush resolver — the CEREMONY SEED map (env-fed, api views.js): `"${jobType}_${tier}"`
   * (seed gatherProtectorJson casing, e.g. `FARMER_9`) → the protector MobTemplate object id gather_ptb
   * passes as the ambush defender. `{}` until the ceremony seeds it — gather refuses on a missing key. */
  protector_templates?: Record<string, string>
  creation?: {
    price_mist?: string
    paused?: boolean
    free?: boolean
    sponsor?: string | null
    classes?: unknown[]
  }
}

// --- kolizeum (PvP lobby lifecycle) ------------------------------------------

export type KolizeumStatus = 'open' | 'started' | 'settled' | 'cancelled' | 'drawn'

export interface RpcKolizeum {
  kolizeum: string
  creator?: string
  status: KolizeumStatus
  format_slots?: number
  pledge_mist?: string
  is_public?: boolean
  side_a?: string[]
  side_b?: string[]
  winning_side?: number
  pot_mist?: string
  winners?: string[]
  refunded_mist?: string
}

// --- dungeon runs (bound RunPass timeline) -----------------------------------

export interface RpcDungeonRun {
  pass: string
  world: string
  player: string
  status: 'active'
  room: number // u16, 1-based
  fight: string | null
}

// --- fights (shared Fight object — resync primitive, not a live board) -------
// MIRRORS packages/rpc/api/views.js `shape_fight` byte-for-byte (this type is the
// CLIENT's claim about the live server row — rpc/contract.test.ts pins it against a recorded /v1 fixture, and
// its per-field spec is `keyof`-exhaustive so a drift on either side reds a gate). The 2026-07-17 corrective:
// the old claim (`fight`/`anchor_x`/`anchor_z`/`public_fight`, participants as a Record) described the
// indexer's INTERNAL doc, not the view row — consumers had grown `f.fight_id ?? f.fight` fallbacks to survive
// the lie. Every projected field is `?? null`-defaulted server-side, hence the nullables.

export interface RpcFight {
  fight_id: string
  world: string | null
  spawn_id: string | null
  anchor: { x: number | null; z: number | null }
  public: boolean | null
  status: 'placement' | 'active' | 'victory' | 'defeat' | null
  aged_bp: number | null
  mob_count: number | null
  group_template: string | null // the mob-group MobTemplate id (read-time join from rpc:group_template) — names the mobs; null when un-projected
  participants: { character: string; seat: number }[] // seat-sorted
  current_turn: { is_mob: boolean; idx: number; deadline_ms: number } | null
  mob_positions: { idx: number; cell: number }[] // idx-sorted; MobMoved projection (mobs have no p2p presence)
}

// --- fight results (soulbound claim) -----------------------------------------
// MIRRORS packages/rpc/api/views.js `handle_fight_results` byte-for-byte (same contract as above). TWO
// disjoint id families share this row shape: ResultMinted (unopened engine outcome — fight_id/character/
// outcome present) and ResultOpened (core claim ticket — those three null, opened: true). The numeric fields
// are `?? 0`-defaulted and `opened` is `?? false`-defaulted server-side, so they are always present. The
// 2026-07-17 corrective: the old claim (`result`/`fight`/an `owner` field) was stale — the view keys rows by
// `result_id`/`fight_id` and never echoes an owner address back.

export interface RpcFightResult {
  result_id: string
  fight_id: string | null
  character: string | null
  outcome: 'victory' | 'defeat' | null
  xp_share: number
  final_hp: number
  opened: boolean
  loot_units: number
}

// --- pending outcomes (soulbound `settlement::FightOutcome`s not yet opened) --
// The PERMANENT post-settle surface (not a recovery edge case): `settle_and_destroy` transfers
// one soulbound FightOutcome to EVERY seat owner silently, so every non-janitor participant holds unopened
// results until their own `results::open`. The roster pill reads this view; the open PTB's inputs come
// straight from the row (outcome_id + character_id → kiosk derive).

export interface RpcPendingOutcome {
  outcome_id: string
  character_id: string
  fight_id: string | null
  world_id: string | null
  pvp?: boolean
  outcome?: number
  aged_bp?: number
}

// --- pet-box claims (soulbound `loot_box::PetBoxClaim`s not yet collected) ---
// Unclaimed rolled-pet claims: `open_box` mints a soulbound PetBoxClaim recording the roll;
// `claim_pet` consumes (deletes) it. Soulbound + no kiosk join possible, so the indexer
// object-snapshots create/delete keyed by owner (packages/rpc/api/views.js handle_pet_claims —
// mirror byte-for-byte). The shop's "AWAITING COLLECTION" strip reads this to offer COLLECT
// without re-buying — the last sanctioned chain-direct read (docs/V1_SWEEP_PLAN.md §3 item 9).

export interface RpcPetClaim {
  claim_id: string
  rolled_template: string
}

// --- names (SuiNS reverse resolution, D52) ------------------------------------
// `/v1/names?addresses=a,b,c` (packages/rpc/api/views.js's handle_names) — a flat address→name map,
// not an enveloped list like the other views (mirror byte-for-byte). A missing/never-registered
// default name is `null`, never an absent key — every requested address always gets an entry.

export type RpcNames = Record<string, string | null>

// --- sponsor daily allowance remaining ----------------------------------------
// `/v1/sponsor/remaining?address=0x..` (packages/rpc/api/views.js's handle_sponsor_remaining) — the
// per-zkLogin daily FREE-GAMEPLAY allowance the sponsor (api/sponsor.mjs) enforces, made readable so
// the sidebar can show "remaining / allowance" and a fight can be warned before it runs out. MONEY IS
// STRINGS. `resets_at` is the next-UTC-midnight ISO timestamp when the allowance refreshes.

export interface RpcSponsorRemaining {
  allowance_mist: string
  spent_mist: string
  remaining_mist: string
  resets_at: string
}

// --- inbox (escrow-recoverable item gifts) ------------------------------------
// `/v1/inbox?address=0x..` (planned indexer view — docs/ITEM_SEND_PLAN.md §A5: snapshot the shared `Gift`
// objects addressed to / sent by the address). INCOMING = gifts to claim; OUTGOING = gifts you sent (recall
// door). Each carries the escrowed items' template info for the preview + the pre-funded royalty (MIST STRING)
// + the sender's kiosk id (the claim/recall PTB needs it) + the checkpoint ts. This view is NOT live yet
// (behavior key post-publish) — the inbox store degrades to an honest empty state until the route lands.

export interface RpcInboxItem {
  item_id: string
  template_id: string // the ItemImage `id` + `templates_item` lookup slug
  name: string
  appearance: string
  category: string
  level: number
}

export interface RpcInboxGift {
  gift_id: string
  sender: string
  sender_kiosk_id: string
  recipient: string
  items: RpcInboxItem[]
  royalty_mist: string
  created_at_ms: number
}

export interface RpcInbox {
  incoming: RpcInboxGift[]
  outgoing: RpcInboxGift[]
}

// --- airdrops (whitelist claim-mint for external-collection holders) -----------
// `/v1/airdrops?addresses=0x..,0x..` (planned indexer view — docs/ITEM_SEND_PLAN.md Part B: project the shared
// `Airdrop` objects + resolve per-address whitelist membership). `eligible_for` is the SUBSET of the queried
// addresses on this drop's whitelist (eligibility checks BOTH the zkLogin address AND an optional
// connected external wallet). `item` carries the reserved template's display info for the shop-card render. NOT
// live yet — the airdrop store degrades to an honest "no active airdrops" until the route + whitelist content land.

export interface RpcAirdrop {
  airdrop_id: string
  template_id: string
  name: string
  description: string
  item: { template_id: string; name: string; appearance: string }
  minted: number
  eligible_count: number
  eligible_for: string[]
}
