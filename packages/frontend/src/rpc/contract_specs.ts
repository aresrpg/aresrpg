// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// /v1 VIEW CONTRACT SPECS (D770c) — the RUNTIME twin of views.ts, pinned per-field.
//
// Each table below is a `Spec<T>` over its views.ts interface: `required` must list EXACTLY the
// non-optional keys of T and `optional` EXACTLY the `?` keys — tsc enforces the exhaustiveness both
// ways (a field added/renamed/removed in views.ts reds this file at `bun run typecheck`), and
// contract.test.ts asserts every RECORDED live-response row against the table (closed-world: an
// unexpected server field reds the run). Together the two directions make drift mechanical:
//   views.ts change without a spec change  → typecheck RED (this file)
//   server truth diverging from the claim  → contract.test.ts RED (recorded fixtures)
// This is the census rung-6 deliverable — the "views contract rows vs the live read-API" the stale
// RpcFightResult finding proved was missing.

import type {
  CharacterEquip,
  CharacterPet,
  RpcCharacter,
  RpcDungeonRun,
  RpcEncyclopediaItem,
  RpcEncyclopediaMob,
  RpcFight,
  RpcFightResult,
  RpcKolizeum,
  RpcListing,
  RpcMobDrop,
  RpcOwnedItem,
  RpcPendingOutcome,
  RpcPetClaim,
  RpcPool,
  RpcRareLink,
  RpcRecipe,
  RpcRecipeIngredient,
  RpcSale,
  RpcSalesRow,
  RpcSponsorRemaining,
  RpcZone,
  WornCosmetic,
} from './views'
import type { RpcTauxRow } from './client'

export type Checker = (value: unknown) => boolean

type OptionalKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? K : never }[keyof T]

/** Closed-world row spec: `required` = every non-`?` key of T, `optional` = every `?` key. */
export type Spec<T> = {
  required: { [K in Exclude<keyof T, OptionalKeys<T>>]-?: Checker }
  optional: { [K in OptionalKeys<T>]-?: Checker }
}

export const str: Checker = (v) => typeof v === 'string'
export const num: Checker = (v) => typeof v === 'number' && Number.isFinite(v)
export const bool: Checker = (v) => typeof v === 'boolean'
/** Decimal-string money field (MIST survives past 2^53 — views.ts "MONEY IS STRINGS"). */
export const mist: Checker = (v) => typeof v === 'string' && /^\d+$/.test(v)
export const nullable =
  (checker: Checker): Checker =>
  (v) =>
    v === null || checker(v)
export const arr =
  (checker: Checker): Checker =>
  (v) =>
    Array.isArray(v) && v.every(checker)
export const record_of =
  (checker: Checker): Checker =>
  (v) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(checker)
export const one_of =
  (...literals: (string | number | boolean)[]): Checker =>
  (v) =>
    literals.includes(v as string | number | boolean)

/** Closed nested object: every `fields` key must pass; `optional_fields` pass when present; no extras. */
export const shape =
  (fields: Record<string, Checker>, optional_fields: Record<string, Checker> = {}): Checker =>
  (v) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
    const row = v as Record<string, unknown>
    const known = new Set([...Object.keys(fields), ...Object.keys(optional_fields)])
    if (!Object.keys(row).every((key) => known.has(key))) return false
    if (!Object.entries(fields).every(([key, check]) => check(row[key]))) return false
    return Object.entries(optional_fields).every(([key, check]) => !(key in row) || check(row[key]))
  }

/** Row-level violations for one Spec: missing/failed required keys, failed present optionals, unknown keys. */
export function spec_violations<T>(spec: Spec<T>, row: Record<string, unknown>): string[] {
  const required = spec.required as Record<string, Checker>
  const optional = spec.optional as Record<string, Checker>
  const known = new Set([...Object.keys(required), ...Object.keys(optional)])
  return [
    ...Object.entries(required).flatMap(([key, check]) =>
      key in row
        ? check(row[key])
          ? []
          : [`required '${key}' failed: ${JSON.stringify(row[key])}`]
        : [`required '${key}' missing`]
    ),
    ...Object.entries(optional).flatMap(([key, check]) =>
      key in row && !check(row[key]) ? [`optional '${key}' failed: ${JSON.stringify(row[key])}`] : []
    ),
    ...Object.keys(row).flatMap((key) =>
      known.has(key) ? [] : [`unknown server field '${key}' (client claim is behind the live view)`]
    ),
  ]
}

// ── characters ────────────────────────────────────────────────────────────────

const equip_spec: Checker = shape({
  item_id: str,
  template: str,
  category: nullable(str),
  amount: num,
} satisfies Record<keyof CharacterEquip, Checker>)

const pet_spec: Checker = shape({
  item_id: str,
  template_id: str,
  slug: str,
} satisfies Record<keyof CharacterPet, Checker>)

const worn_spec: Checker = shape({
  item_id: str,
  template_id: str,
  category: str,
} satisfies Record<keyof WornCosmetic, Checker>)

export const character_spec: Spec<RpcCharacter> = {
  required: {
    id: str,
    owner: nullable(str),
    name: nullable(str),
    class: nullable(str),
    male: nullable(bool),
    level: nullable(num),
    experience: nullable(num),
    colors: nullable(shape({ color_1: num, color_2: num, color_3: num })),
    kiosk_id: nullable(str),
    listed: bool,
    world: nullable(str),
    position: nullable(shape({ x: num, z: num }, { zone: str, at_ms: num })),
    vitality: num,
    wisdom: num,
    strength: num,
    intelligence: num,
    agility: num,
    chance: num,
    available_points: num,
    current_hp: nullable(num),
    hp_updated_ms: nullable(num),
    gear_vitality: nullable(num),
    equipment_stats: nullable(record_of(num)),
    pet: nullable(pet_spec),
    pet_equipped: bool,
    equipment: arr(equip_spec),
  },
  optional: {
    worn: record_of(worn_spec),
    jobs: record_of(num),
  },
}

// ── owner items / listings / sales ───────────────────────────────────────────

export const owned_item_spec: Spec<RpcOwnedItem> = {
  required: {
    id: str,
    kiosk_id: str,
    kiosk_cap_id: nullable(str),
    template_id: nullable(str),
    name: str,
    item_category: str,
    item_set: str,
    item_type: str,
    level: num,
    amount: num,
    listed: bool,
  },
  optional: {},
}

export const listing_spec: Spec<RpcListing> = {
  required: {
    item_id: str,
    kiosk_id: str,
    category: nullable(str),
    template_id: nullable(str),
    item_category: nullable(str),
    amount: nullable(num),
    level: nullable(num),
    name: nullable(str),
    price_mist: mist,
    seller: str,
  },
  optional: {},
}

export const sales_row_spec: Spec<RpcSalesRow> = {
  required: {
    item_id: str,
    template_id: nullable(str),
    category: nullable(str),
    level: nullable(num),
    price_mist: mist,
    buyer: str,
    sold_at_ms: num,
  },
  optional: {},
}

export const pool_spec: Spec<RpcPool> = {
  required: {
    pool_id: str,
    template_id: str,
    item_reserve: num,
    virtual_sui_mist: mist,
    real_sui_mist: mist,
    sui_reserve_mist: mist,
    spot_price_mist: nullable(mist),
    paused: bool,
  },
  optional: {},
}

export const taux_row_spec: Spec<RpcTauxRow> = {
  required: {
    template_id: str,
    coeff_milli: num,
    coeff_percent: num,
    recipe_less: bool,
    source: one_of('neutral', 'crushed'),
  },
  optional: {},
}

export const sale_spec: Spec<RpcSale> = {
  required: {
    sale_id: str,
    template_id: str,
    price_mist: mist,
    minted: num,
    supply_remaining: nullable(num),
    starts_ms: nullable(num),
    ends_ms: nullable(num),
    paused: bool,
  },
  optional: {},
}

// ── zones ─────────────────────────────────────────────────────────────────────

export const zone_spec: Spec<RpcZone> = {
  required: {
    zone_id: str,
    zx: num,
    zy: num,
    discovered: bool,
    discovered_at_ms: num,
    mob_groups: num,
    resource_nodes: num,
  },
  optional: {
    seed: str, // full u64 → STRING (2^53 law)
    mob_bitmap: arr(num),
    res_bitmap: arr(num),
  },
}

export const rare_link_spec: Spec<RpcRareLink> = {
  required: { world: str, template_id: str, rare_template_id: str },
  optional: {},
}

// ── encyclopedia ──────────────────────────────────────────────────────────────

export const encyclopedia_item_spec: Spec<RpcEncyclopediaItem> = {
  required: {
    template_id: str,
    item_type: nullable(str),
    name: nullable(str),
    description: nullable(str),
    level: nullable(num),
    category: nullable(str),
    supply: num,
    last_sale_mist: nullable(mist),
  },
  optional: {
    stats: record_of((value) => Array.isArray(value) && value.length === 2 && value.every(nullable(num))),
  },
}

const mob_drop_spec: Checker = shape({
  template_id: str,
  name: nullable(str),
  category: nullable(str),
  chance_percent: num,
  min_qty: num,
  max_qty: num,
} satisfies Record<keyof RpcMobDrop, Checker>)

export const encyclopedia_mob_spec: Spec<RpcEncyclopediaMob> = {
  required: {
    template_id: str,
    name: nullable(str),
    min_level: nullable(num),
    max_level: nullable(num),
    base_hp: nullable(num),
    element: nullable(num),
    drops: nullable(arr(mob_drop_spec)),
  },
  optional: {
    // Raw wire, CENTERED @32768 — undefined on every live row today (snapshot.rs doesn't project a
    // MobTemplate's stats tail yet); declared so the day it does, this contract stays exhaustive.
    earth_resistance: nullable(num),
    fire_resistance: nullable(num),
    water_resistance: nullable(num),
    air_resistance: nullable(num),
  },
}

export const encyclopedia_world_spec: Spec<{ world_id: string; seed: number; biome: string; required_level: number }> =
  {
    required: { world_id: str, seed: str, biome: str, required_level: num },
    optional: {},
  }

const recipe_ingredient_spec: Checker = shape({
  template_id: str,
  quantity: num,
} satisfies Record<keyof RpcRecipeIngredient, Checker>)

export const recipe_spec: Spec<RpcRecipe> = {
  required: {
    recipe_id: str,
    output_template_id: str,
    output_quantity: num,
    required_job: num,
    required_level: num,
    craft_xp: num,
    inputs: arr(recipe_ingredient_spec),
  },
  optional: {},
}

// ── kolizeum / dungeon runs ───────────────────────────────────────────────────

export const kolizeum_spec: Spec<RpcKolizeum> = {
  required: {
    kolizeum: str,
    status: one_of('open', 'started', 'settled', 'cancelled', 'drawn'),
  },
  optional: {
    creator: str,
    format_slots: num,
    pledge_mist: mist,
    is_public: bool,
    side_a: arr(str),
    side_b: arr(str),
    winning_side: num,
    pot_mist: mist,
    winners: arr(str),
    refunded_mist: mist,
  },
}

export const dungeon_run_spec: Spec<RpcDungeonRun> = {
  required: {
    pass: str,
    world: str,
    player: str,
    status: one_of('active'),
    room: num,
    fight: nullable(str),
  },
  optional: {},
}

// ── fights / results / outcomes / pet claims ─────────────────────────────────

export const fight_spec: Spec<RpcFight> = {
  required: {
    fight_id: str,
    world: nullable(str),
    spawn_id: nullable(str),
    anchor: shape({ x: nullable(num), z: nullable(num) }),
    public: nullable(bool),
    status: nullable(one_of('placement', 'active', 'victory', 'defeat')),
    aged_bp: nullable(num),
    mob_count: nullable(num),
    group_template: nullable(str),
    participants: arr(shape({ character: str, seat: num })),
    current_turn: nullable(shape({ is_mob: bool, idx: num, deadline_ms: num })),
    mob_positions: arr(shape({ idx: num, cell: num })),
  },
  optional: {},
}

export const fight_result_spec: Spec<RpcFightResult> = {
  required: {
    result_id: str,
    fight_id: nullable(str),
    character: nullable(str),
    outcome: nullable(one_of('victory', 'defeat')),
    xp_share: num,
    final_hp: num,
    opened: bool,
    loot_units: num,
  },
  optional: {},
}

export const pending_outcome_spec: Spec<RpcPendingOutcome> = {
  required: {
    outcome_id: str,
    character_id: str,
    fight_id: nullable(str),
    world_id: nullable(str),
  },
  optional: {
    pvp: bool,
    outcome: num,
    aged_bp: num,
  },
}

export const pet_claim_spec: Spec<RpcPetClaim> = {
  required: { claim_id: str, rolled_template: str },
  optional: {},
}

// ── sponsor allowance ─────────────────────────────────────────────────────────

export const sponsor_remaining_spec: Spec<RpcSponsorRemaining> = {
  required: {
    allowance_mist: mist,
    spent_mist: mist,
    remaining_mist: mist,
    resets_at: str,
  },
  optional: {},
}
