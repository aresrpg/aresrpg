// T75 WORLD reads — chain-direct (no server) reader for `world::World` (a SHARED, enumerable-by-constant
// object — unlike templates, worlds don't need event-replay discovery since T62_WORLDS already lists every
// world id the game seeded). Feeds the admin WORLD tab — replaces the dead backend WS path that left the
// tab permanently empty (`all_templates['world']`, see templates_tab.tsx's `templates` selector).
//
// Mirrors read_templates.js's shape (normalize_* chain fields -> flat UI shape). The decode logic below
// flattens world.move's `region`/`rates`/`drop_table` fields (the shape the SDK's retired staking `get_world`
// reader decoded — deleted in the V1 sweep) — implemented here because the frontend only consumes `@aresrpg/sdk` through
// its declared subpath exports (items/jobs/stats/...), and there's no `/sui/read/*` subpath published (only
// the heavy full `SDK()` factory via `@aresrpg/sdk/sui`; this reader sources the gRPC client from the memoised
// `get_sdk()` internally instead).

import { get_sdk } from './sdk'

/**
 * Normalize a decoded `World` object's `fields` into the flat shape templates_tab.tsx / WorldEditor expect —
 * same flat-object convention as normalize_mob_template / normalize_item_template (id, name/label, then
 * domain fields).
 * @param {Record<string, any>} f  the World struct's decoded `fields`
 * @param {string} label  the human label from T62_WORLDS (worlds have no on-chain name)
 */
export function normalize_world(f, label) {
  // #23 gRPC json:true flattens nested structs (no `.fields` wrapper) + UID (`id.id`→`id`) — keep the legacy paths.
  const region = f.region?.fields ?? f.region ?? {}
  const rates = f.rates?.fields ?? f.rates ?? {}
  return {
    id: String(f.id?.id ?? f.id ?? ''),
    name: label,
    label,
    // The World's entry level-gate (world.move `required_level`, clamped 1..200) — the admin GATES dial edits it.
    required_level: Number(f.required_level ?? 1),
    max_level: Number(f.max_level ?? 0),
    per_run_cap: Number(f.per_run_cap ?? 0),
    region: {
      lvl_min: Number(region.lvl_min ?? 0),
      lvl_max: Number(region.lvl_max ?? 0),
      difficulty: Number(region.difficulty ?? 0),
      density: Number(region.density ?? 0),
      resource_rate: Number(rates.resource_rate ?? 0),
      item_rate: Number(rates.item_rate ?? 0),
    },
    // DropEntry{ item_template: ID, percent } — kept as raw ids; the caller (WorldEditor) resolves each
    // item_template against the item-template list (display-first icon) for rendering.
    drop_table: (f.drop_table ?? []).map((e) => ({
      item_template: String(e.fields?.item_template ?? e.item_template ?? ''),
      percent: Number(e.fields?.percent ?? e.percent ?? 0),
    })),
    mobs: (f.mob_templates ?? []).map((id) => String(id)),
  }
}

/**
 * Every seeded World (from the T62_WORLDS constant — worlds are game-defined + admin-enumerated, no event
 * replay needed) read live from chain, batch-fetched the same way get_mob_templates/get_item_templates do.
 * grpc is sourced from the memoised SDK internally (#23).
 * @param {readonly { id: string, label: string }[]} worlds
 */
export async function get_worlds(worlds) {
  if (worlds.length === 0) return []
  const { grpc_client } = await get_sdk()
  // #23 gRPC: getObjects → { objects:[Object|Error] }; json:true is the flat struct (normalize_world unwraps both shapes).
  const { objects } = await grpc_client.core.getObjects({
    objectIds: worlds.map((w) => w.id),
    include: { json: true },
  })
  const label_by_id = new Map(worlds.map((w) => [w.id, w.label]))
  return (objects ?? [])
    .map((o) => {
      if (o instanceof Error) return null
      const f = o?.json
      const id = o?.objectId
      if (!f || !id) return null
      return normalize_world(f, label_by_id.get(id) ?? id)
    })
    .filter(Boolean)
}
