// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
export interface SeedManifestWorld {
  wid: string
  id: string
  name?: string
  label?: string
  biome?: string
  requiredLevel?: number
}

export interface SeedManifestMob {
  id: string
  name?: string
  role?: string
}

export interface SeedManifestSpell {
  id: string
  name: string
  class: string
  unlock: number
  slot?: number
  role?: string
  element?: string | null
  description_key?: string
}

export interface SeedManifest {
  _network?: string
  items: Record<string, string>
  mobs: Record<string, SeedManifestMob>
  spells: Record<string, SeedManifestSpell>
  worlds: SeedManifestWorld[]
}

export const bun_runtime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'

// Vite turns the literal glob into an eager JSON import for browser builds. Bun's test runner has no
// import.meta.glob, so its branch reads the exact same receipt synchronously through import.meta.require.
// Neither path creates another checked-in projection: the seed receipt remains the only content-ID record.
const manifest_modules: Record<string, unknown> = bun_runtime
  ? {
      seed_manifest: (import.meta as ImportMeta & { require(path: string): unknown }).require(
        '../../../move/scripts/out/seed_manifest.json'
      ),
    }
  : import.meta.glob('../../../move/scripts/out/seed_manifest.json', { eager: true, import: 'default' })

const EMPTY_SEED_MANIFEST: SeedManifest = { items: {}, mobs: {}, spells: {}, worlds: [] }

// Resolves the single seed manifest the build inlined. Zero manifests — the deployment-pin artifact
// never shipped (issue #94) — DEGRADES loudly to an inert manifest so the client still boots; the >1
// case stays a hard guard (a build must never inline two).
export function resolve_seed_manifest(modules: Readonly<Record<string, unknown>>): SeedManifest {
  const manifests = Object.values(modules)
  if (manifests.length > 1) throw new Error(`expected one seed manifest, found ${manifests.length}`)
  if (manifests.length === 0) {
    console.error(
      '[seed_manifest] no seed manifest at packages/move/scripts/out/seed_manifest.json — content ' +
        'features (encyclopedia, shop living-corpus fence, spell rows) are inert until a build inlines ' +
        'this deployment pin.'
    )
    return EMPTY_SEED_MANIFEST
  }
  return manifests[0] as SeedManifest
}

export const seed_manifest = resolve_seed_manifest(manifest_modules)

// The deployment receipt is the ruled per-template content model consumed by both the world roster and the
// encyclopedia. Keep the authored mob tier keyed by the live template id here, beside its decode, so display
// surfaces never infer archi-ness from a name or carry their own role lookup.
const mob_tier_by_id = new Map(
  Object.values(seed_manifest.mobs).map(({ id, role }) => [id, role?.toLowerCase() ?? null] as const)
)

export const mob_tier_of = (template_id: string | null | undefined): string | null =>
  mob_tier_by_id.get(template_id ?? '') ?? null
