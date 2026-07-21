// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The app is backend-off (on-chain build): it reads/writes the chain directly (SDK PTBs + zkLogin self-pay)
// and never connects a WS backend — every export here has a working default, so a bare boot never throws.
const env = (import.meta as unknown as { env: Record<string, string> }).env ?? {}

// Host-free fallback base (the external asset CDN host is DELETED, never configurable).
// Assets resolve against the app's own origin under public/assets/
// (e.g. /assets/items/<id>.png). Classes published on Walrus (spell/music/mob/character/cosmetic — the
// asset_manifest.json quilts) resolve THROUGH the SDK builders (item_icon_url / spell_icon_url / walrus_asset_url)
// to the aggregator FIRST; this base is only the fallback for a class/file absent from the manifest (today: vanilla), whose
// files must live in public/assets/ or degrade honestly to a glyph. No environment override can reintroduce a
// retired/dead remote host; the asset manifest is the single remote-base source.
export const ASSETS_URL = '/assets'

// RPC read-API base (SPEC §14 read layer, packages/rpc/api). ALL live DISPLAY data flows through this
// keyless, read-only view API — the UI-DATA LAW: reactive short-poll req/res (see src/rpc/use_view.ts),
// NEVER streaming, NEVER silently stale. Chain-direct SDK calls stay for tx pre-flight only. No package id
// is ever hardcoded app-side: the api resolves ids from the indexer, so pointing VITE_RPC_URL at the
// testnet deploy survives a republish untouched. An explicit VITE_RPC_URL always wins. Unset: the local
// dev server (`import.meta.env.DEV`, vite serve) falls back to the local api's default PORT (3000); any
// BUILT bundle (preview or production — `vite build` always has DEV=false) falls back to the live testnet
// read-API host instead of an unreachable localhost (a preview deploy that forgot to set VITE_RPC_URL was
// spamming ERR_CONNECTION_REFUSED at localhost:3000 in the console — 2026-07-21). The prod host is the
// repo's own recorded truth, not a guess: packages/move/scripts/shop_live_rows.mjs queries it directly and
// src/rpc/contract.test.ts's fixture provenance header names it as "VITE_RPC_URL of the deployed testnet build".
//
// derive_rpc_url is deliberately just "override-or-fallback + normalize" — the dev/prod SELECTION stays a
// literal `import.meta.env.DEV` ternary at the call site below (not a function parameter): Vite statically
// replaces that exact literal and dead-code-eliminates the losing branch, so a BUILT bundle never carries the
// 'http://localhost:3000' string at all. Routing is_dev through a function argument instead defeats that —
// esbuild cannot specialize an exported function per call site, so both branches would ship as inert text
// (caught by this file's own scripts/assert_clean_bundle.mjs gate when tried).
export function derive_rpc_url(vite_rpc_url: string | undefined, fallback: string): string {
  return (vite_rpc_url || fallback).replace(/\/+$/, '')
}
export const RPC_URL = derive_rpc_url(
  env.VITE_RPC_URL,
  import.meta.env.DEV ? 'http://localhost:3000' : 'https://rpc.aresrpg.world'
)

// Stateless @server sponsor endpoint — the client's ONE sponsorship door (the
// Mysten sui-gas-pool is identity-blind BY DESIGN, an internal primitive only server-side services may call;
// the client-direct VITE_GAS_STATION_* flag was deleted — a browser-held bearer on it was the defect).
// The client POSTs a kind-only PTB + sender, gets back the built txBytes + the sponsor's gas signature.
// Defaults to `/api/sponsor` (the Vercel same-origin serverless route); set VITE_SPONSOR_URL to a full URL
// for local dev (e.g. http://localhost:<port>/api/sponsor). Flows through it: @server-gated txs (create-
// character, join-world) and the low-balance gameplay GAS-STATION FALLBACK (tx/gas_fallback.ts); funded
// wallets stay self-pay.
export const SPONSOR_URL = env.VITE_SPONSOR_URL || '/api/sponsor'

// Sentry error-reporting (errors-only scope — no tracing, no replay; see core/report.js). DSN present ⇒ the
// reporter inits; ABSENT (the default for dev/local) ⇒ init is a hard no-op, so a bare boot never phones home.
// NEVER commit the DSN value — it lives in the gitignored .env / .env.production; .env.example templates the
// NAME only. NETWORK tags the Sentry `environment` (testnet | mainnet) so error streams split per chain.
export const SENTRY_DSN = env.VITE_SENTRY_DSN || ''
export const NETWORK = env.VITE_NETWORK || 'testnet'

// UNSAFE, TESTNET-ONLY override for the un-simulatable `aresrpg_items::shop::buy` gas budget (per-item MIST).
// A `&Random` buy CANNOT be dry-run, so the SDK REFUSES to derive a budget until the real per-item cost is
// measured + stamped at the publish rehearsal (MEASURED_BUY_GAS_MIST). Setting this lets a PRE-measurement
// testnet build submit a buy AT YOUR OWN RISK — a too-low value fails ON-CHAIN and burns the full budget.
// NEVER set in production. Unset (the default) ⇒ buys refuse loudly with an honest message, never a silent guess.
export const UNSAFE_DEV_GAS_MIST = env.VITE_UNSAFE_DEV_GAS ? Number(env.VITE_UNSAFE_DEV_GAS) : null
