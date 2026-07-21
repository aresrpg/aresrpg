// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { is_object_id, seed_manifest } from '../content/seed_manifest'

const selected_network = (
  (import.meta as unknown as { env: Record<string, string> }).env?.VITE_NETWORK || 'testnet'
).trim() as 'testnet' | 'mainnet' | 'localnet'

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// FRONTEND DEPLOYMENT RESIDUE (S-61). The ONE id home is the SDK's `@aresrpg/sdk/deployment/aresrpg`
// (aresrpg_id / aresrpg_deployment / aresrpg_shared_ref) — every package/object id resolves there. The T62 + M1
// bridge constants are RETIRED (their consumers read the SSOT directly; the two homeless seed values — the
// forgemagie CrushBoard and the legacy template_sale companion package — moved inline to their sole consumers).
// What remains is NOT a deployment id map: the app's network selector (DEMO_NETWORK) and the SEEDED-CONTENT
// enumeration (worlds — content, not singletons; the /v1 encyclopedia views replace these). DO NOT add a
// package/object id here — it belongs in the SDK home (stamped by the ceremony) or an RPC view.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────

// The network the app talks to. SINGLE SOURCE: sdk.ts inits the SDK with it and every `aresrpg_id(…)`
// deployment-home read keys off it, so "which network" is stated exactly once. ENV-DRIVEN (VITE_NETWORK, the
// env.ts pattern): a testnet demo, a mainnet launch, or a `localnet` QA build each just set the env — no code
// fork. Defaults to testnet (the live demo). 'localnet' is the L1 anchor (docs/GOLD_STANDARD_SUITE.md §11):
// the SDK's deployment resolver reads the run's ids from the injected `globalThis.__ARES_LOCALNET_IDS` and the
// gRPC endpoint from VITE_SUI_GRPC_URL — nothing is hardcoded here.
export const DEMO_NETWORK = selected_network

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// SEEDED-CONTENT constants (labels + seeded object ids — content enumeration, not deployment singletons).
// IDs are projected synchronously from the current seed receipt; there is no stamped frontend copy.

function label_from_wid(wid: string): string {
  return wid
    .replace(/^\d+_/, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

const seeded_worlds = [...seed_manifest.worlds].sort((left, right) => left.wid.localeCompare(right.wid))
// DEGRADE LOUDLY (never crash boot) when the seed manifest carries no worlds — it is a runtime artifact
// (issue #106 cascade; full runtime conversion is boarded via the inventory). World switcher, travel and the
// world encyclopedia go inert (T62_WORLDS = []); the app still mounts. The per-world integrity guards below
// stay hard — a MALFORMED seeded world is a real data bug, not the migration-absence case.
if (!seeded_worlds.length)
  console.error(
    '[deployment] seed manifest carries no worlds — world switcher, travel and the world encyclopedia are ' +
      'inert until the seed manifest ships (issue #106).'
  )

export const T62_WORLDS = seeded_worlds.map((world) => {
  if (!is_object_id(world.id)) throw new Error(`seed world ${world.wid} has an invalid object id`)
  const label = world.name ?? world.label ?? label_from_wid(world.wid)
  if (!label) throw new Error(`seed world ${world.wid} has no display label`)
  return { id: world.id, label }
})

// ───────────────────────────────────────────────────────────────────────────────────────────────────────
// BIOME → ENGINE RECIPE (frontend wiring lane, DECISIONS 2026-07-12): translates a world's on-chain `biome`
// field (world.move's `biome: String` / WorldCreated.biome, read via the /v1 encyclopedia worlds view —
// world_biome.js's `resolve_world_biome`; seed/mainnet/*/world.json mirrors the same string) to the engine's
// `?biome=` recipe key (packages/engine/src/config/worlds/index.js WORLD_CONFIGS). ONE pinned table + a
// DEFAULT fallback so an unmapped chain biome — an unseeded world, or Testlands' own "testlands" (no
// world-as-planet recipe built for it yet) — never crashes and never silently swaps a live session's
// recipe: it resolves to the exact recipe the boot seam already defaults to today (embed_voxel.js). Extend
// this table (never branch engine-side) when a new world's biome ships.
//
// ALL 20 seeded mainnet worlds are wired (DECISIONS 07-13 — the 01-06 earlier waves + 07-13/14-20 recipe
// fan-out). The keys are the on-chain biome strings; the seed corpus (seed/mainnet/NN/world.json) and the
// live /v1 encyclopedia worlds view were cross-checked and AGREE on every one of the 20 strings. Every
// biome string is unique across the 20 worlds, so a biome-keyed table (matching the existing idiom) is the
// sound shape — no world-id keying needed. Each value is a real recipe key in WORLD_CONFIGS (verified).
export const DEFAULT_ENGINE_RECIPE = 'rainforest'
export const BIOME_ENGINE_RECIPE: Record<string, string> = {
  archipelago: 'paradise', // 01 first_shore
  canyon: 'rainforest', // 02 verdant_hollow
  ash_steppe: 'ember_steppe', // 03 emberfall_steppe
  mesa: 'mistral_heights', // 04 mistral_heights
  swamp: 'drowned_fen', // 05 drowned_fen
  floating_islands: 'pandora_reach', // 06 pandora_reach
  magma_foundry: 'cinderforge_depths', // 07 cinderforge_depths
  pale_forest: 'palewood', // 08 palewood
  reef_city: 'coral_throne', // 09 coral_throne
  glass_desert: 'sunspire_dunes', // 10 sunspire_dunes
  world_tree: 'rootheart', // 11 rootheart
  storm_plateau: 'static_fields', // 12 static_fields
  frost_lake: 'mirrormere', // 13 mirrormere
  ashen_marsh: 'charnel_marches', // 14 charnel_marches
  dead_calm_sea: 'silent_atoll', // 15 silent_atoll
  sundered_waste: 'the_sundering', // 16 the_sundering
  volcanic_cathedral: 'obsidian_choir', // 17 obsidian_choir
  abyssal_forest: 'abyssal_weald', // 18 abyssal_weald
  celestial_ruin: 'hollow_crown', // 19 hollow_crown
  fractured_zenith: 'zenith_scar', // 20 zenith_scar
}

/** Chain biome string → engine recipe key. Unknown/absent (incl. Testlands' own "testlands") → the current
 *  default recipe. Pure, never throws. */
export function engine_recipe_for_biome(biome: string | null | undefined): string {
  if (!biome) return DEFAULT_ENGINE_RECIPE
  return BIOME_ENGINE_RECIPE[biome] ?? DEFAULT_ENGINE_RECIPE
}

/** THE boot-seam precedence (embed_voxel.js): an explicit `?biome=` URL override wins outright — it is
 *  already an ENGINE recipe key (the existing dev/QA switch, e.g. `?biome=paradise`), never itself
 *  translated; else the bound world's CHAIN biome translates via the table above; else the default. Pure —
 *  unit-tested independently of any real boot. */
export function resolve_engine_recipe({
  url_biome,
  chain_biome,
}: {
  url_biome?: string | null
  chain_biome?: string | null
}): string {
  return url_biome || engine_recipe_for_biome(chain_biome)
}
