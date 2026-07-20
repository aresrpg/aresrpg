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

const manifests = Object.values(manifest_modules)
if (manifests.length !== 1) throw new Error(`expected one seed manifest, found ${manifests.length}`)

export const seed_manifest = manifests[0] as SeedManifest

export function is_object_id(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}
