import { bcs } from '@mysten/sui/bcs'
import { deriveObjectID, deriveDynamicFieldID } from '@mysten/sui/utils'

import { aresrpg_deployment } from '../../deployment/aresrpg.js'

// ITEM READS for the merged `aresrpg` package — zero-backend chain reads via the house gRPC Core client (object json + dynamic
// fields), mirroring the Move getters. No devInspect: every read is an object/DF fetch, and the derived-object
// existence checks reproduce `derived_object::exists` off-chain (deriveObjectID → the `Claimed` marker DF), the
// same proven derivation the free-vs-paid character read uses.

const STRING_TYPE = '0x1::string::String'
const CLAIMED_TYPE = '0x2::derived_object::Claimed'
// BCS of an EMPTY Move struct key (`StatsMinKey {}` …) is the compiler's dummy field — ONE 0x00 byte, NEVER
// zero bytes. Proven live 2026-07-09: deriving `NsKey<ProgressionKey{}>` with [ns, 0x00] matches the real
// field id on character 0x3fa7…5344; zero-byte keys derive a different (nonexistent) id, so every empty-struct
// DF read silently returned null.
const EMPTY_STRUCT_KEY = Uint8Array.of(0)

/** Reserved first-party DF namespaces (mirror extension.move — additive, never renumbered). Exported BY NAME so a
 *  reader names the slot it inspects; reads are cap-free (on-chain data is public). */
export const ITEMS_NS = {
  CHARACTER_PROGRESSION: 0,
  CHARACTER_EQUIPMENT: 1,
  CHARACTER_WORLD: 2,
  ITEM: 3,
  MINT: 4,
}

const STAT_FIELDS = [
  'vitality',
  'wisdom',
  'strength',
  'intelligence',
  'chance',
  'agility',
  'range',
  'movement',
  'action',
  'critical',
  'raw_damage',
  'critical_chance',
  'critical_outcomes',
  'earth_resistance',
  'fire_resistance',
  'water_resistance',
  'air_resistance',
]

// ── low-level helpers ───────────────────────────────────────────────────────

const string_bytes = value => bcs.string().serialize(value).toBytes()
const address_bytes = value => bcs.Address.serialize(value).toBytes()

/** getObject → flattened json (`include:{json:true}`), or null on absence / error. */
async function get_object_json(grpc_client, object_id) {
  try {
    const { object } = await grpc_client.core.getObject({
      objectId: object_id,
      include: { json: true },
    })
    return object?.json ?? null
  } catch {
    return null
  }
}

/** Does the object at `object_id` exist on-chain? */
async function object_exists(grpc_client, object_id) {
  try {
    const { object } = await grpc_client.core.getObject({ objectId: object_id })
    return !!object
  } catch {
    return false
  }
}

/** The V of a dynamic field `Field<K,V>` read as flattened json, or null if the field is absent. `key_bytes` is the
 *  BCS of the key value (an empty-struct key is ONE 0x00 byte — EMPTY_STRUCT_KEY, never zero bytes). */
async function get_df_value_json(grpc_client, parent_id, key_type, key_bytes) {
  const field_id = deriveDynamicFieldID(parent_id, key_type, key_bytes)
  const json = await get_object_json(grpc_client, field_id)
  return json?.value ?? null
}

/** Normalize a Move `Option<T>` json (`{vec:[]}` / `{vec:[x]}` / `[x]` / bare / null) to `value | null`. */
function option_value(opt) {
  if (opt == null) return null
  if (Array.isArray(opt)) return opt.length ? opt[0] : null
  if (typeof opt === 'object' && 'vec' in opt)
    return opt.vec.length ? opt.vec[0] : null
  return opt
}

const option_u64 = opt => {
  const v = option_value(opt)
  return v == null ? null : BigInt(v)
}

// ── decoders (json → typed) ─────────────────────────────────────────────────

/** Decode a 17-field `ItemStatistics` json (u16 fields) to a number map, or null if absent. */
function decode_stats(json) {
  if (!json) return null
  const out = {}
  STAT_FIELDS.forEach(field => {
    out[field] = Number(json[field] ?? 0)
  })
  return out
}

/** Decode a `vector<ItemDamages>` json to typed lines. */
function decode_damages(json) {
  if (!Array.isArray(json)) return []
  return json.map(line => ({
    from: Number(line.from ?? 0),
    to: Number(line.to ?? 0),
    damage_type: line.damage_type,
    element: line.element,
  }))
}

/** Decode a `ConsumableEffect` json (`{ kind: u8, amount: u64 }`), or null if absent. */
function decode_effect(json) {
  if (!json) return null
  return { kind: Number(json.kind ?? 0), amount: BigInt(json.amount ?? 0) }
}

// ── pure marker-id derivers (exported for offline verification) ──────────────

/** Pure: the object id of `raw_name`'s derived-object `Claimed` marker on the Creation gate (mirrors on-chain
 *  `derived_object::exists`, case-insensitive). Deterministic — no I/O. */
export function character_name_marker_id({ creation_id, raw_name }) {
  const name_key = `${String(raw_name).toLowerCase()}::character`
  const derived_id = deriveObjectID(
    creation_id,
    STRING_TYPE,
    string_bytes(name_key),
  )
  return deriveDynamicFieldID(
    creation_id,
    CLAIMED_TYPE,
    address_bytes(derived_id),
  )
}

/** Pure: the object id of `owner`'s free-character `Claimed` marker on the Creation gate. `package_id` is the
 *  type-origin id of `creation::FreeCharacterKey`. Deterministic — no I/O. */
export function free_character_marker_id({ creation_id, package_id, owner }) {
  const derived_id = deriveObjectID(
    creation_id,
    `${package_id}::creation::FreeCharacterKey`,
    address_bytes(owner),
  )
  return deriveDynamicFieldID(
    creation_id,
    CLAIMED_TYPE,
    address_bytes(derived_id),
  )
}

// ── CREATION gate reads ──────────────────────────────────────────────────────

/** Creation gate state: `price` (MIST, per ADDITIONAL character) + `paused`. Null if the gate is unreadable.
 *  @param {import("../../../types.js").Context} context */
export function get_creation_state(context) {
  const { grpc_client, network } = context
  return async () => {
    const dep = aresrpg_deployment(network, context.ids?.aresrpg)
    const json = await get_object_json(grpc_client, dep.CREATION)
    if (!json) return null
    return { price: BigInt(json.price ?? 0), paused: Boolean(json.paused) }
  }
}

/** The WHITELISTED class ids on the Creation gate (`classes: Table<String, bool>`) — the create modal reads this
 *  to grey out any class not yet enabled on-chain (an un-whitelisted class shows "coming soon",
 *  and the mint-time abort 103 EUnknownClass carries the same copy). `classes.id` is the Table's inner UID
 *  (`json:true` flattens it — the get_world_explorers pattern); its entries are dynamic fields whose FLATTENED
 *  `name` is the class-id String (no BCS decode). Returns the full whitelist as an id array; ANY read failure /
 *  empty table returns `[]`, which the caller reads as "could not verify → allow all" (a read hiccup must NEVER
 *  brick the creation funnel — a genuinely un-whitelisted pick still aborts honestly at mint time).
 *  @param {import("../../../types.js").Context} context */
export function get_creation_classes(context) {
  const { grpc_client, network } = context
  return async () => {
    try {
      const dep = aresrpg_deployment(network, context.ids?.aresrpg)
      const gate = await get_object_json(grpc_client, dep.CREATION)
      const table_id = gate?.classes?.id
      if (!table_id) return []
      /** @type {string[]} */
      const classes = []
      let cursor = null
      do {
        const { dynamicFields, hasNextPage, cursor: next } = await grpc_client.core.listDynamicFields({
          parentId: table_id,
          cursor,
        })
        if (dynamicFields?.length) {
          // batch-read each Field<String, bool>; json:true flattens the struct so `.name` is the class-id String.
          const { objects } = await grpc_client.core.getObjects({
            objectIds: dynamicFields.map(({ fieldId }) => fieldId),
            include: { json: true },
          })
          for (const entry of objects) {
            if (entry instanceof Error) continue
            const name = /** @type {any} */ (entry.json)?.name
            if (name != null) classes.push(String(name))
          }
        }
        cursor = hasNextPage ? next : null
      } while (cursor)
      return classes
    } catch {
      return [] // read hiccup → caller allows all; a truly un-whitelisted pick still aborts honestly at mint
    }
  }
}

/** True if `raw_name` (case-insensitive) is already claimed (mirrors `is_name_taken`).
 *  @param {import("../../../types.js").Context} context */
export function is_name_taken(context) {
  const { grpc_client, network } = context
  return async raw_name => {
    const dep = aresrpg_deployment(network, context.ids?.aresrpg)
    return object_exists(
      grpc_client,
      character_name_marker_id({ creation_id: dep.CREATION, raw_name }),
    )
  }
}

/** True if `owner` has already claimed its one free character (mirrors `is_free_claimed`).
 *  @param {import("../../../types.js").Context} context */
export function is_free_claimed(context) {
  const { grpc_client, network } = context
  return async owner => {
    const dep = aresrpg_deployment(network, context.ids?.aresrpg)
    return object_exists(
      grpc_client,
      free_character_marker_id({
        creation_id: dep.CREATION,
        package_id: dep.PACKAGE_ID,
        owner,
      }),
    )
  }
}

// ── SHOP sale reads ──────────────────────────────────────────────────────────

/** A `Sale` snapshot: price/supply/minted/window/paused + the template it sells. Null if unreadable.
 *  @param {import("../../../types.js").Context} context */
export function get_sale(context) {
  const { grpc_client } = context
  return async sale_id => {
    const json = await get_object_json(grpc_client, sale_id)
    if (!json) return null
    return {
      id: json.id,
      template: json.template,
      price: BigInt(json.price ?? 0),
      supply: option_u64(json.supply), // null = unlimited
      minted: BigInt(json.minted ?? 0),
      start_ms: option_u64(json.start_ms), // null = open
      end_ms: option_u64(json.end_ms), // null = open
      paused: Boolean(json.paused),
    }
  }
}

// ── ITEM / TEMPLATE reads ────────────────────────────────────────────────────

/** An `ItemTemplate` snapshot: base fields + attached stat RANGES (min/max), damage lines and consumable effect
 *  (each null / [] when absent). Null if the template is unreadable.
 *  @param {import("../../../types.js").Context} context */
export function get_item_template(context) {
  const { grpc_client, network } = context
  return async template_id => {
    const dep = aresrpg_deployment(network, context.ids?.aresrpg)
    const json = await get_object_json(grpc_client, template_id)
    if (!json) return null

    const [stats_min, stats_max, damages, effect] = await Promise.all([
      get_df_value_json(
        grpc_client,
        template_id,
        `${dep.PACKAGE_ID}::item_stats::StatsMinKey`,
        EMPTY_STRUCT_KEY,
      ),
      get_df_value_json(
        grpc_client,
        template_id,
        `${dep.PACKAGE_ID}::item_stats::StatsMaxKey`,
        EMPTY_STRUCT_KEY,
      ),
      get_df_value_json(
        grpc_client,
        template_id,
        `${dep.PACKAGE_ID}::item_damages::DamagesKey`,
        EMPTY_STRUCT_KEY,
      ),
      get_df_value_json(
        grpc_client,
        template_id,
        `${dep.PACKAGE_ID}::consumable_effect::EffectKey`,
        EMPTY_STRUCT_KEY,
      ),
    ])

    return {
      id: json.id,
      name: json.name,
      item_type: json.item_type,
      category: json.category,
      level: Number(json.level ?? 0),
      stats_min: decode_stats(stats_min),
      stats_max: decode_stats(stats_max),
      damages: decode_damages(damages),
      effect: decode_effect(effect),
    }
  }
}

/** The FIXED rolled `ItemStatistics` on a minted item (attached at buy), or null if the item carries none
 *  (resources/consumables). @param {import("../../../types.js").Context} context */
export function get_rolled_stats(context) {
  const { grpc_client, network } = context
  return async item_id => {
    const dep = aresrpg_deployment(network, context.ids?.aresrpg)
    return decode_stats(
      await get_df_value_json(
        grpc_client,
        item_id,
        `${dep.PACKAGE_ID}::item_stats::StatsKey`,
        EMPTY_STRUCT_KEY,
      ),
    )
  }
}

// ── EXTENSION free namespaced reads ──────────────────────────────────────────

/** Concatenate a `NsKey<K>` BCS: `u8(namespace) ++ bcs(key)` (the struct is `{ namespace: u8, key: K }`). */
function ns_key_bytes(namespace, key_bytes) {
  const out = new Uint8Array(1 + key_bytes.length)
  out[0] = namespace & 0xff
  out.set(key_bytes, 1)
  return out
}

/**
 * Read a first-party namespaced dynamic field (`extension::NsKey<K>`) off an Item or Character UID, as flattened
 * json — or null if absent. Cap-free (public on-chain data). `namespace` is an `ITEMS_NS.*` id; `key_type` is K's
 * Move type tag and `key_bytes` its BCS (defaults to the one-byte empty-struct BCS). Concrete first-party field SCHEMAS
 * live in the game package — this is the transport; typed getters layer on top.
 * @param {import("../../../types.js").Context} context
 */
export function read_namespaced_field(context) {
  const { grpc_client, network } = context
  return async ({
    object_id,
    namespace,
    key_type,
    key_bytes = EMPTY_STRUCT_KEY,
  }) => {
    const dep = aresrpg_deployment(network, context.ids?.aresrpg)
    return get_df_value_json(
      grpc_client,
      object_id,
      `${dep.PACKAGE_ID}::extension::NsKey<${key_type}>`,
      ns_key_bytes(namespace, key_bytes),
    )
  }
}
