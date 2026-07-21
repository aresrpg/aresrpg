# Typecheck repair summary

## Error classes fixed

- Engine `checkJs` strictness: implicit-`any` parameters and empty arrays, nullable/optional lookups, dynamic-import narrowing, fixed-length tuple and literal-union widening, stale JSDoc object contracts, and test-double types.
- Engine render typing: Three.js WebGPU/TSL node inference, nullable GPU resources, material/config shapes, and typed RGB/VFX/highlight data without changing the runtime graphs.
- Engine module/type drift: corrected type-only module paths and aligned world-generation, quality, tactical, player, mesh, and renderer declarations with their existing runtime values.
- Frontend module resolution: restored the shared `src/types/chain.ts` item/listing contracts used by marketplace and inventory imports, including the live `kiosk_id` field.
- Frontend strictness: declared the untyped process shim, aligned the PWA callback declaration, preserved the Lucide `title` prop contract, and accepted the receipt's existing nullable mint error.

## TypeScript suppressions

None. This change adds no `@ts-expect-error`, `@ts-ignore`, `@ts-nocheck`, new exclusions, or compiler-severity relaxations.

The sole lint directive permits the canonical ambient `var` declaration that makes the existing
`__ARES_SKY_COUPLE` flag visible on `globalThis`; replacing it with `let` would change its TypeScript meaning.

## Workflow delta

`.github/workflows/gate.yml` now runs the root `bun run typecheck` immediately after the frozen install and before the deterministic fight-replay gate. The new CI step is required to pass in the same commit.
