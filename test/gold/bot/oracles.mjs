// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ORACLES (§1c) — namespaced reads a behavior asserts against. `run.*` = bot bookkeeping, `v1.*` = the keyless
// read-API display truth (the indexer projection — what a player's client actually sees), `chain.*` = JSON-RPC
// object truth (pre-flight ground truth). The CLASS OF ASSERTION picks the CLASS OF ORACLE (§2): exact for
// deterministic surfaces, band for &Random. Every id resolves through /v1 or the run manifest — never hardcoded.
import { get_fields } from '../../localnet/bots/framework/sui.js'

const j = async (url) => (await fetch(url)).json()

/**
 * @param {{ api:string, rpc:string, wallet:any, manifest:any, state:any, backend:any }} deps
 * @returns {Record<string, (args?:any)=>Promise<any>>}
 */
export function make_oracles({ api, rpc, wallet, manifest, state, backend }) {
  const client = backend.get_client()
  const { ctx } = backend

  const rpc_call = async (method, params = []) =>
    (
      await (
        await fetch(rpc, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        })
      ).json()
    ).result

  return {
    // ── run bookkeeping ──────────────────────────────────────────────────────────────────────────────────
    'run.balance_sui': async () =>
      Number((await rpc_call('suix_getBalance', [wallet.address]))?.totalBalance ?? 0) / 1e9,
    'run.step_count': () => state.step_count,
    'run.spent_sui': () => state.spent_sui,
    'run.inventory_count': () => ctx.inventory.length,
    'run.fights_won': () => state.fights_won,
    // LIVE level from cumulative granted xp (the progression source — see backend read_level). Drives the L50 loop.
    'run.level': () => backend.read_level(),
    'run.cumulative_xp': () => ctx.cumulative_xp ?? 0,
    'run.stat_points_spent': () => ctx.stat_spent ?? 0,

    // ── /v1 display truth ────────────────────────────────────────────────────────────────────────────────
    'v1.characters.count_mine': async () => {
      const r = await j(`${api}/v1/characters?owner=${wallet.address}`)
      return Array.isArray(r?.characters) ? r.characters.length : 0
    },
    // ground-truth CROSS-CHECK: the level the indexer projects onto the roster (the player's display truth). If this
    // stays at 1 while run.level climbs, the indexer isn't projecting live post-fight level (a declared finding).
    'v1.character.level': async () => {
      const r = await j(`${api}/v1/characters?owner=${wallet.address}`)
      const mine = Array.isArray(r?.characters)
        ? (r.characters.find((c) => c.id === ctx.ids.character_id) ?? r.characters[0])
        : null
      return Number(mine?.level ?? 0)
    },
    'v1.config.xp_multiplier': async () => {
      const r = await j(`${api}/v1/config`)
      return Number(r?.dials?.xp_multiplier ?? NaN)
    },
    'v1.encyclopedia.items_count': async () => (await j(`${api}/v1/encyclopedia?kind=items`))?.items?.length ?? 0,
    'v1.encyclopedia.mobs_count': async () => (await j(`${api}/v1/encyclopedia?kind=mobs`))?.mobs?.length ?? 0,
    'v1.encyclopedia.worlds_count': async () => (await j(`${api}/v1/encyclopedia?kind=worlds`))?.worlds?.length ?? 0,
    'v1.encyclopedia.worlds_has_seeded': async () => {
      const r = await j(`${api}/v1/encyclopedia?kind=worlds`)
      const seeded = manifest?.world_id
      return seeded ? JSON.stringify(r).includes(seeded.slice(2, 42)) : false
    },

    // ── chain object truth (pre-flight ground truth) ───────────────────────────────────────────────────────
    'chain.character.level': async () => {
      if (!ctx.ids.character_id) return 0
      const f = await get_fields(client, ctx.ids.character_id).catch(() => null)
      return Number(f?.level ?? f?.character_level ?? 1)
    },
    'chain.character.exists': async () => {
      if (!ctx.ids.character_id) return false
      const f = await get_fields(client, ctx.ids.character_id).catch(() => null)
      return !!f
    },
    'chain.character.snapshot': async () => {
      if (!ctx.ids.character_id) return null
      return get_fields(client, ctx.ids.character_id).catch(() => null)
    },
    'chain.inventory_owned': async () => ctx.inventory.length,
  }
}
