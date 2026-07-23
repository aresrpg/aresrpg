// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// SDK VERB BACKEND (§1c "builders barrel law") — the full gameplay verb set as step executors that compose
// PTBs through the @aresrpg/sdk choke. Thin adapters over the PROVEN gate-lane verb layer (read-reuse, per
// docs/GOLD_STANDARD_SUITE.md §1c/§12): framework/driver.js wraps every SDK builder, framework/world_flow.js
// owns the runtime zone-discovery + tactical fight solver, framework/sui.js owns submit() with the tx-retry
// money law baked in. We NEVER edit those (gate-owned); we instantiate them against OUR gold client/context.
//
// Executors are (args) => { ok, digest?, note?, progressed?, item_id?, balance? } and thread a shared run
// CONTEXT (ctx) across steps — behavior files stay pure DATA; the evolving on-chain identity (ids, world,
// zone, fight, inventory) lives here (mirrors world_flow's `ids` threading). `progressed` feeds the soft-lock
// watchdog; `balance` feeds the balance report (§1c balance findings).
//
// FENCE: reads/imports only — the gate lane (test/localnet/**) and packages/sdk are never written.
import { Driver } from '../../localnet/bots/framework/driver.js'
import { reach_zone, win_fight } from '../../localnet/bots/framework/world_flow.js'
import { build_context, make_kiosk_client } from '../../localnet/bots/framework/context.js'
import { make_client, submit, get_fields, SubmitStats } from '../../localnet/bots/framework/sui.js'
// direct SDK builders the gate Driver doesn't wrap (feed / kolizeum / spell-points / scribe / consume)
import { feed_ptb, raise_spell_level_ptb, raise_stat_ptb, scribe_rune_ptb } from '../../../packages/sdk/src/game.js'
import { join_ptb as kolizeum_join_ptb, create_public_ptb } from '../../../packages/sdk/src/sui/write/kolizeum_lobby.js'
import { consume_potion_ptb } from '../../../packages/sdk/src/sui/write/consume.js'
import { experience_to_level } from '../../../packages/sdk/src/experience.js'
import { signerOf } from '../lib_gold.mjs'

const LOCALNET_GAS_BUDGET = 1_000_000_000 // 1 SUI — disposable localnet, &Random-safe fixed budget

/** Read a character object's level (post-fight xp lives on-chain; genesis `experience` is frozen). */
async function read_level(client, character_id) {
  const f = await get_fields(client, character_id).catch(() => null)
  return Number(f?.level ?? f?.character_level ?? 1)
}

/**
 * Build the SDK backend bound to one gold wallet + the gold deployment manifest.
 * @returns {Promise<{ ctx: any, verbs: Map<string, (args:any)=>Promise<any>>, get_client: ()=>any,
 *   declared_missing: string[], stats: SubmitStats }>}
 */
export async function build_sdk_backend({ manifest, wallet, selected_character = null }) {
  const ids_block = manifest.ids.aresrpg
  const pkg_origin = ids_block.PACKAGE_ID // dynamic-field type tags use the DEFINING (origin) package
  const client = make_client(manifest.rpc, 'localnet')
  const signer = await signerOf(wallet.privkey)
  const kiosk_client = make_kiosk_client(client, 'testnet', {
    // localnet @mysten/kiosk has no built-in rule ids — pass the gold Kiosk package for all three rule slots
    personalKioskRulePackageId: manifest.ids.kiosk,
    kioskLockRulePackageId: manifest.ids.kiosk,
    royaltyRulePackageId: manifest.ids.kiosk,
  })
  const context = build_context({ manifest: { ids: { aresrpg: ids_block } }, network: 'localnet', kiosk_client })
  const stats = new SubmitStats()
  // ONE spend hook: wrap submit so every tx (Driver path AND direct-builder path) feeds the gas ledger — the
  // money rail the run-loop's spend cap reads. Net gas in MIST from effects (tx-burn law: executed = counted).
  let gas_mist_total = 0
  const tracked_submit = async (a) => {
    const r = await submit(a)
    if (r?.digest) gas_mist_total += r.gasMist ?? 0
    return r
  }
  const driver = new Driver({
    bot: { name: 'gold_bot', address: wallet.address, keypair: signer },
    context,
    client,
    signer,
    coverage: { record: () => [] }, // coverage is a gate-lane concern; the bot only needs the tx built+submitted
    stats,
    submit_fn: tracked_submit,
    budget: LOCALNET_GAS_BUDGET,
  })

  // ── run context: the on-chain identity that evolves across steps ─────────────────────────────────────────
  const ctx = {
    ids: selected_character
      ? driver.select_character(selected_character)
      : { character_id: null, kiosk_id: null, personal_kiosk_cap_id: null },
    world: null, // { id, offset_x, offset_z, zone_size } — lazy-read from chain on first world step
    zone: null, // reach_zone result { ok, zx, zy, spawn, mobs, nodes, mob, node }
    fight_id: null,
    inventory: [], // item ids the bot now owns (gathered / looted / minted)
    level: 1,
    class: selected_character?.class ?? null,
    stat_spent: 0, // stat points this bot has allocated (unspent is DERIVED: (level-1)*5 - stat_spent)
    cumulative_xp: 0, // Σ xp_share granted at settlement — the LIVE progression source (the Character struct's
    //                   top-level `experience` is the frozen creation genesis; live level lives in a Progression DF).
    //                   level = experience_to_level(cumulative_xp) mirrors the on-chain curve (character_xp.move).
    zone_group_idx: 0, // which discovered group we fight next; a fight CLAIMS a group (swap-removed), so we walk the
    //                   zone's groups then RE-DISCOVER a fresh zone when exhausted (sustained-fight loop).
    result_id: null, // the last settled FightResult (owned) — mint_rolled loot from it
    items_by_tpl: {}, // template_id → [owned item ids] (loot/gather); equip-by-role selects from here
    loot_stacks: [], // [{ id, tpl, qty }] — craft needs an EXACT unit tally, so we track each stack's qty to
    //                  subset-select inputs summing to the recipe quantity (loot drops variable 1-3 unit stacks).
  }

  // gather (§17.22) REQUIRES a `&MobTemplate` protector id even though the ambush only spawns on a `protector_bp`
  // roll — the arg must resolve to a real on-chain MobTemplate. The (job,tier)→protector map is not surfaced by any
  // read (SDK gather_ptb note), so on localnet we source ANY seeded MobTemplate id from the boot manifest (the
  // ambush, if it fires, spawns a winnable seeded mob). Runtime-discovered zone mobs override it when present.
  const seed_mob_ids = Object.values(manifest.seed?.mobs ?? {})
    .map((m) => m?.id ?? m)
    .filter((x) => typeof x === 'string')
  const protector_tpl_fallback = seed_mob_ids[0] ?? null

  /** Lazily hydrate ctx.world from the chain world object (offsets/zone_size drive travel-verify math). A world
   *  CHANGE (target_id ≠ current) re-reads + forces a fresh zone discovery. */
  async function ensure_world(target_id = null) {
    const wid = target_id ?? ctx.world?.id ?? manifest.world_id
    if (ctx.world && ctx.world.id === wid) return ctx.world
    const f = await get_fields(client, wid).catch(() => null)
    ctx.world = {
      id: wid,
      offset_x: Number(f?.offset_x ?? 0),
      offset_z: Number(f?.offset_z ?? 0),
      zone_size: Number(f?.zone_size ?? 512),
    }
    ctx.zone = null // world change ⇒ discover fresh zones/groups
    ctx.zone_group_idx = 0
    return ctx.world
  }
  /** Resolve a world id by index: 0 = the primary seeded world; N = manifest.seed.worlds[N] (multi-world corpus). */
  const world_id_at = (index) => (index ? ((manifest.seed?.worlds ?? [])[index]?.id ?? null) : manifest.world_id)

  /** Ensure a discovered zone (enter + search + read spawns). Idempotent within a run. */
  async function ensure_zone(prefer_template = null) {
    if (ctx.zone?.ok && (ctx.zone.mob || ctx.zone.node)) return ctx.zone
    const world = await ensure_world()
    ctx.zone = await reach_zone({ driver, client, ids: ctx.ids, world, pkg_origin, prefer_template })
    return ctx.zone
  }

  // Wrap a driver result into the executor return shape; `progressed` = an observable state delta happened.
  const ok_of = (r) => !!(r?.res?.ok ?? r?.ok)
  const dig_of = (r) => r?.res?.digest ?? r?.digest ?? null
  // honest failure note: on-chain abort, else the pre-flight/build error (never a silent null) — Agent Std #3
  const err_of = (r) => r?.res?.abort ?? r?.res?.error ?? r?.abort ?? r?.error ?? null

  const declared_missing = []
  const verbs = new Map()

  // ── onboarding ───────────────────────────────────────────────────────────────────────────────────────────
  verbs.set('create_character', async ({ class: klass = 'senshi', name_prefix = 'bot' }) => {
    const r = await driver.create_character({ name: `${name_prefix}_${Date.now() % 1_000_000}`, class: klass })
    if (r?.character_id) {
      ctx.ids = {
        character_id: r.character_id,
        kiosk_id: r.kiosk_id,
        personal_kiosk_cap_id: r.personal_kiosk_cap_id,
      }
      ctx.class = klass
    }
    return {
      ok: !!r?.character_id,
      digest: dig_of(r),
      note: r?.character_id ?? r?.res?.abort,
      progressed: !!r?.character_id,
    }
  })

  // ── world / navigation ───────────────────────────────────────────────────────────────────────────────────
  verbs.set('enter_world', async ({ world_index = 0, __expect_abort = false } = {}) => {
    if (!ctx.ids.character_id) throw new Error('enter_world before create_character')
    const wid = world_id_at(world_index)
    if (!wid)
      return {
        ok: false,
        note: `no world at index ${world_index} — manifest seeds ${(manifest.seed?.worlds ?? []).length} extra world(s) (multi-world content gap)`,
      }
    const world = await ensure_world(wid)
    const r = await driver.enter_world({ world_id: world.id, ...ctx.ids, __expect_abort })
    return {
      ok: ok_of(r),
      digest: dig_of(r),
      abort_module: r?.res?.abort_module,
      abort_code: r?.res?.abort_code,
      progressed: ok_of(r),
      note: err_of(r) ?? `world[${world_index}] ${world.id.slice(0, 10)}`,
    }
  })
  verbs.set('search_zone', async () => {
    const z = await ensure_zone()
    return {
      ok: !!z?.ok,
      progressed: !!(z?.mob || z?.node),
      note: `mobs=${z?.mobs?.length ?? 0} nodes=${z?.nodes?.length ?? 0} zone=(${z?.zx},${z?.zy})`,
    }
  })
  // travel_to (sdk mode): movement is client-side (no chain op) — resolve+select the target the behavior wants
  // via runtime discovery. In ui mode the ui backend performs the real warp (§3). `target: nearest:resource|mob`.
  verbs.set('travel_to', async ({ target = 'nearest:mob' }) => {
    const z = await ensure_zone()
    const kind = String(target).split(':')[1] ?? 'mob'
    const picked = kind === 'resource' ? z?.node : z?.mob
    return {
      ok: !!picked,
      progressed: !!picked,
      note: picked ? `${kind}@(${picked.x},${picked.z})` : `no ${kind} in zone`,
    }
  })

  // ── gathering ────────────────────────────────────────────────────────────────────────────────────────────
  verbs.set('gather', async () => {
    const z = await ensure_zone()
    if (!z?.node) return { ok: false, note: 'no resource node discovered in zone' }
    const protector_template_id = z.mob?.template_id ?? protector_tpl_fallback
    if (!protector_template_id)
      return { ok: false, note: 'gather needs a protector MobTemplate id — none seeded in manifest.seed.mobs' }
    const r = await driver.gather({
      world_id: ctx.world.id,
      ...ctx.ids,
      zx: z.zx,
      zy: z.zy,
      node_index: z.node.node_index,
      template_id: z.node.template_id,
      protector_template_id, // §17.22 REQUIRED — the (job,tier)-matched world protector (sourced from the seed manifest)
    })
    if (r?.item_id) ctx.inventory.push(r.item_id)
    return {
      ok: ok_of(r) && !!r?.item_id,
      digest: dig_of(r),
      item_id: r?.item_id,
      progressed: !!r?.item_id,
      note: r?.item_id ?? err_of(r) ?? `node tpl=${z.node.template_id?.slice(0, 10)}`,
    }
  })

  // ── fight (the balance-recording verb) ──────────────────────────────────────────────────────────────────
  // Each fight CLAIMS its group (swap-removed), so we RE-DISCOVER a fresh zone every call (re-join re-rolls the
  // spawn — join_world does not abort on re-entry). We prefer the seed's MELEE group: a healer group net-heals
  // (world_flow) into a long/unwinnable fight, so preferring melee keeps fights fast + winnable. Retries discovery
  // a few times when a re-roll lands on a depleted zone. Level is derived from cumulative xp (live progression).
  const melee_tpl = manifest.seed?.mobs?.melee?.id ?? protector_tpl_fallback
  verbs.set('fight', async () => {
    let z = null
    for (let attempt = 0; attempt < 4; attempt += 1) {
      ctx.zone = null // fresh discovery (each fight claims a group)
      z = await ensure_zone(melee_tpl) // reach_zone prefers the melee template → winnable
      if (z?.mob) break
    }
    if (!z?.mob)
      return { ok: false, note: 'no mob group discovered after 4 re-discovery attempts (zone density exhausted?)' }
    const group = z.mob
    ctx.level = experience_to_level(ctx.cumulative_xp) // level going INTO this fight (the balance bracket)
    const wf = await win_fight({ driver, client, ids: ctx.ids, world: ctx.world, zone: { ...z, mob: group } })
    ctx.fight_id = wf.fight_id
    if (wf.result_id) ctx.result_id = wf.result_id // the settled FightResult — `loot` mints its rolled drops
    const gained = Number(wf.xp_share ?? 0)
    ctx.cumulative_xp += gained
    const level_after = experience_to_level(ctx.cumulative_xp)
    const balance = {
      my_level: ctx.level,
      class: ctx.class,
      mob_template: group.template_id,
      group_size: group.group_size,
      won: !!wf.won,
      deaths: wf.won ? 0 : 1, // solo fight: not-won == the bot went down (defeat/timeout)
      turns: wf.turn_gas?.length ?? 0,
      xp_share: gained, // GRANTED xp (multiplier already applied on-chain) — raw = xp_share / (mult/100)
      cumulative_xp: ctx.cumulative_xp,
      level_after,
      settled: !!wf.settle?.res?.ok,
    }
    // A settled fight (win OR honest loss) is progress. Any driver reason is a red lifecycle failure even when an
    // earlier action spent gas; partial execution must never masquerade as a completed balance datapoint.
    const ok = !wf.reason && !!wf.fight_id && (wf.won || balance.settled)
    return {
      ok,
      digest: dig_of(wf.settle),
      note: wf.won
        ? `WON xp=${gained} cum=${ctx.cumulative_xp} L${ctx.level}→${level_after}`
        : (wf.reason ?? `lost@L${ctx.level}`),
      progressed: true,
      balance,
    }
  })

  // ── loot: mint the last settled fight's rolled drops into the kiosk (proves "loot enough" + feeds craft/equip) ──
  const unwrap_field = (v) => (v && typeof v === 'object' && 'fields' in v ? v.fields : v)
  verbs.set('loot', async () => {
    if (!ctx.result_id) return { ok: false, note: 'no fight result to loot (win a fight first)' }
    const f = await get_fields(client, ctx.result_id).catch(() => null)
    const rolled = (f?.rolled ?? []).map(unwrap_field)
    if (!rolled.length) return { ok: true, noop: true, note: 'no loot rolled this fight (drop RNG missed)' }
    let minted = 0
    let last = null
    for (const r of rolled) {
      const tpl = r?.item_template ?? r?.template
      if (!tpl) continue
      const qty = Number(r?.qty ?? 1)
      const res = await driver.mint_rolled({ result_id: ctx.result_id, item_template_id: tpl, ...ctx.ids })
      if (res?.item_id) {
        ctx.inventory.push(res.item_id)
        ;(ctx.items_by_tpl[tpl] ??= []).push(res.item_id)
        ctx.loot_stacks.push({ id: res.item_id, tpl, qty })
        minted += 1
        last = res.item_id
      }
    }
    return {
      ok: minted > 0,
      digest: null,
      item_id: last,
      progressed: minted > 0,
      note: minted ? `minted ${minted} loot stack(s) from ${rolled.length} roll(s)` : 'mint_rolled yielded no item',
    }
  })

  // ── inventory / gear ─────────────────────────────────────────────────────────────────────────────────────
  const last_item = (a) => a.item_id ?? ctx.inventory[ctx.inventory.length - 1]
  // equip by explicit item_id, else by ROLE (manifest.seed.items[role] → a looted/crafted item of that template),
  // else the last-acquired item. `item_role: 'longsword'` equips a looted/crafted weapon (the gear-upgrade proof).
  const item_by_role = (role) => (role ? (ctx.items_by_tpl[manifest.seed?.items?.[role]] ?? [])[0] : null)
  verbs.set('equip', async (a) => {
    const item_id = a.item_id ?? item_by_role(a.item_role) ?? last_item(a)
    if (!item_id)
      return {
        ok: false,
        note: `no item to equip${a.item_role ? ` (role ${a.item_role} — none looted/crafted yet)` : ' (loot/gather first)'}`,
      }
    // equip_ptb → equipment::equip REQUIRES the item's &ItemTemplate id (required-level gate + stat-fold source;
    // the SDK throws loudly without it). Resolve: explicit arg → the role's manifest template
    // (manifest.seed.items[role] IS the template object id) → reverse lookup over ctx.items_by_tpl
    // (loot/craft-tracked items). Unresolvable = honest RED with the why, never a blind tx.
    const item_template_id =
      a.item_template_id ??
      (a.item_role ? manifest.seed?.items?.[a.item_role] : null) ??
      Object.entries(ctx.items_by_tpl).find(([, ids]) => ids.includes(item_id))?.[0] ??
      null
    if (!item_template_id)
      return {
        ok: false,
        note: `equip ${item_id.slice(0, 10)}: ItemTemplate id unresolved (no manifest.seed.items role match, not loot/craft-tracked — e.g. shop-bought) — equipment::equip needs the template for the level gate + stat fold`,
      }
    const r = await driver.equip({ ...ctx.ids, item_id, item_template_id })
    return {
      ok: ok_of(r),
      digest: dig_of(r),
      progressed: ok_of(r),
      note: `${a.item_role ?? 'item'} ${item_id.slice(0, 10)}`,
    }
  })
  verbs.set('unequip', async (a) => {
    const item_id = last_item(a)
    if (!item_id) return { ok: false, note: 'no item to unequip' }
    const r = await driver.unequip({ ...ctx.ids, item_id })
    return { ok: ok_of(r), digest: dig_of(r), progressed: ok_of(r), note: item_id.slice(0, 10) }
  })
  // craft resolves the recipe + EXACT inputs from the boot manifest by ROLE (behaviors stay target-independent).
  // The minimal corpus's recipes both consume iron_ore (seed_content), so inputs default to the bot's owned
  // iron_ore stacks (looted/gathered). Passing the whole inventory would abort (craft rejects over-supplied inputs).
  // EXACT subset-select: pick looted `tpl` stacks whose qtys sum to exactly `target` (craft rejects over/under).
  const subset_to_sum = (stacks, target) => {
    const exact = stacks.find((s) => s.qty === target)
    if (exact) return [exact.id]
    const chosen = []
    const dfs = (i, sum) => {
      if (sum === target) return true
      if (sum > target || i >= stacks.length) return false
      chosen.push(stacks[i])
      if (dfs(i + 1, sum + stacks[i].qty)) return true
      chosen.pop()
      return dfs(i + 1, sum)
    }
    return dfs(0, 0) ? chosen.map((s) => s.id) : null
  }
  verbs.set(
    'craft',
    async ({
      recipe_id,
      output_template_id,
      input_item_ids,
      recipe_index = 0,
      input_role = 'iron_ore',
      input_qty = 2,
    } = {}) => {
      const rc = manifest.seed?.recipes?.[recipe_index]
      recipe_id ??= rc?.recipe
      output_template_id ??= rc?.output
      if (!recipe_id)
        return {
          ok: false,
          note: `no recipe at index ${recipe_index} in manifest (the full-corpus seeder drops recipe ids — declared content gap)`,
        }
      const in_tpl = manifest.seed?.items?.[input_role]
      let inputs = input_item_ids
      if (!inputs) {
        const stacks = ctx.loot_stacks.filter((s) => s.tpl === in_tpl)
        inputs = subset_to_sum(stacks, input_qty)
        if (!inputs)
          return {
            ok: false,
            note: `no exact-${input_qty}-unit ${input_role} subset from looted stacks [${stacks.map((s) => s.qty).join(',') || 'none'}] — craft tally is EXACT; loot drops variable 1-3 units, so deterministic craft needs a gather tool or SDK stack-split`,
          }
      }
      const r = await driver.craft({ recipe_id, ...ctx.ids, input_item_ids: inputs, output_template_id })
      if (r?.item_id) {
        ctx.inventory.push(r.item_id)
        ;(ctx.items_by_tpl[output_template_id] ??= []).push(r.item_id)
      }
      return {
        ok: ok_of(r) && !!r?.item_id,
        digest: dig_of(r),
        item_id: r?.item_id,
        progressed: !!r?.item_id,
        note: r?.item_id ?? err_of(r) ?? 'craft produced no item',
      }
    }
  )

  // ── economy: shop / marketplace / pools ─────────────────────────────────────────────────────────────────
  verbs.set('buy', async (a) => {
    // GAP GUARD: shop buy needs a seeded Sale id. The active/minimal corpus seeds NO shop; the
    // full-corpus seeder's PHASE 7 mints 55 priced sales (seed/mainnet/shop.json) with supply caps + lvl-1 cosmetics.
    if (!a.sale_id && !a.shop_id && !manifest.seed?.shop)
      return {
        ok: false,
        note: 'shop buy BLOCKED: no Sale seeded on this corpus (active/minimal). Full-corpus PHASE 7 seeds 55 sales + cosmetics — re-boot GOLD_CORPUS=mainnet to exercise supply-exhaustion + wear-cosmetic.',
      }
    const r = await driver.buy_from_shop(a)
    if (r?.item_id) ctx.inventory.push(r.item_id)
    return {
      ok: ok_of(r),
      digest: dig_of(r),
      item_id: r?.item_id,
      progressed: !!r?.item_id,
      note: r?.item_id ?? r?.res?.abort,
    }
  })
  verbs.set('sell', async (a) => run_list(a)) // "sell" on a kiosk marketplace = list at a price
  verbs.set('list', async (a) => run_list(a))
  async function run_list(a) {
    const item_id = a.item_id ?? item_by_role(a.item_role) ?? last_item(a)
    if (!item_id) return { ok: false, note: `no item to list${a.item_role ? ` (role ${a.item_role})` : ''}` }
    ctx.listed_item_id = item_id
    const input = { ...ctx.ids, ...a, item_id, price_mist: a.price_mist ?? 50_000_000 }
    const r = a.amount == null ? await driver.list(input) : await driver.list_stack(input)
    return {
      ok: ok_of(r),
      digest: dig_of(r),
      progressed: ok_of(r),
      note: `list ${item_id.slice(0, 10)} @ ${(a.price_mist ?? 50_000_000) / 1e9} SUI`,
    }
  }
  verbs.set('delist', async (a) => {
    const item_id = a.item_id ?? ctx.listed_item_id ?? last_item(a)
    if (!item_id) return { ok: false, note: 'no listed item to delist' }
    const r = await driver.delist({ ...ctx.ids, item_id })
    return { ok: ok_of(r), digest: dig_of(r), progressed: ok_of(r), note: item_id.slice(0, 10) }
  })
  verbs.set('marketplace_buy', async (a) => {
    const r = await driver.marketplace_buy({ ...ctx.ids, ...a })
    return {
      ok: ok_of(r),
      digest: dig_of(r),
      abort_module: r?.res?.abort_module,
      abort_code: r?.res?.abort_code,
      gas_mist: r?.res?.gasMist ?? null,
      kiosk_id: r?.kiosk_id ?? null,
      personal_kiosk_cap_id: r?.personal_kiosk_cap_id ?? null,
      progressed: ok_of(r),
      note: err_of(r) ?? r?.kiosk_id ?? null,
    }
  })
  verbs.set('pool_swap', async (a) => {
    // GAP GUARD: stackable pool swaps need a seeded bonding-curve Pool. NEITHER seeder mints
    // pools (pool creation is an admin op absent from seed_testnet/seed_full_corpus) — declared economy-infra gap.
    if (!a.pool_id && !manifest.seed?.pools)
      return {
        ok: false,
        note: 'pool swap BLOCKED: no bonding-curve Pool seeded (neither seeder mints pools; pool creation is an un-seeded admin op). pool_buy_refill_ptb + the 10% fee/0.01 floor stay unexercised until a Pool is seeded.',
      }
    const r = a.side === 'sell' ? await driver.pool_sell(a) : await driver.pool_buy(a)
    return { ok: ok_of(r), digest: dig_of(r), item_id: r?.item_id, progressed: ok_of(r) }
  })

  // ── dungeon ──────────────────────────────────────────────────────────────────────────────────────────────
  verbs.set('enter_dungeon', async ({ key_item_id }) => {
    const r = await driver.dungeon_activate({ world_id: ctx.world?.id ?? manifest.world_id, ...ctx.ids, key_item_id })
    if (r?.run_pass_id) ctx.run_pass_id = r.run_pass_id
    return {
      ok: ok_of(r) && !!r?.run_pass_id,
      digest: dig_of(r),
      progressed: !!r?.run_pass_id,
      note: r?.run_pass_id ?? r?.res?.abort,
    }
  })
  verbs.set('dungeon_fight', async ({ mob_template_id }) => {
    const r = await driver.dungeon_next_fight({
      world_id: ctx.world?.id ?? manifest.world_id,
      run_pass_id: ctx.run_pass_id,
      mob_template_id,
      ...ctx.ids,
    })
    ctx.fight_id = r?.fight_id
    return { ok: ok_of(r), digest: dig_of(r), progressed: ok_of(r) }
  })
  verbs.set('exit_dungeon', async (a) => {
    const r = a.abandon
      ? await driver.dungeon_abandon({ run_pass_id: ctx.run_pass_id, ...ctx.ids })
      : await driver.dungeon_settle_run({ run_pass_id: ctx.run_pass_id, ...ctx.ids })
    return { ok: ok_of(r), digest: dig_of(r), progressed: ok_of(r) }
  })

  // ── forgemagie ───────────────────────────────────────────────────────────────────────────────────────────
  verbs.set('crush', async (a) => {
    const r = await driver.crush({ ...ctx.ids, ...a })
    return { ok: ok_of(r), digest: dig_of(r), progressed: ok_of(r), note: r?.res?.abort }
  })
  verbs.set('scribe', (a) => direct('scribe_rune', scribe_rune_ptb, a))

  // ── pet / consumables ────────────────────────────────────────────────────────────────────────────────────
  verbs.set('feed_pet', (a) => direct('feed_pet', feed_ptb, a))
  verbs.set('consume', (a) => direct('consume', consume_potion_ptb, a))

  // ── kolizeum (PvP queue = create a public lobby + join) ──────────────────────────────────────────────────
  verbs.set('kolizeum_queue', async (a) => {
    if (a.lobby_id) return direct('kolizeum_join', kolizeum_join_ptb, a)
    return direct('kolizeum_create', create_public_ptb, a)
  })

  // ── progression: spell points + stat points (both WIRED — stat door shipped; raise_stat_ptb live) ──────────
  verbs.set('raise_spell_level', (a) => direct('raise_spell_level', raise_spell_level_ptb, { ...ctx.ids, ...a }))
  // Spend the character's UNSPENT stat points: §3 grants 5/level from L2, so unspent = (level−1)*5 − already-spent
  // (this bot is the only spender, so we track `spent` locally — no DF read). Dumps into STRENGTH (index 2 — faster
  // kills). A clean no-op when none owed yet; a real abort surfaces (mark the step `optional` so it's a finding, not
  // a run-killer). `stat`/`points` overridable via `with` for targeted allocation.
  verbs.set('spend_stat_points', async ({ stat = 2, max_points } = {}) => {
    const level = experience_to_level(ctx.cumulative_xp) // COMPUTED live level (chain struct level is frozen genesis)
    let unspent = Math.max(0, (level - 1) * 5 - ctx.stat_spent)
    if (max_points != null) unspent = Math.min(unspent, max_points)
    if (unspent <= 0)
      return { ok: true, noop: true, note: `no unspent stat points (L${level}, spent ${ctx.stat_spent})` }
    const r = await direct('raise_stat', raise_stat_ptb, { ...ctx.ids, stat, points: unspent })
    if (r.ok) {
      ctx.stat_spent += unspent
      return { ...r, progressed: true, note: `+${unspent} → stat[${stat}] (L${level}, total spent ${ctx.stat_spent})` }
    }
    return { ok: false, note: `raise_stat(+${unspent} stat[${stat}]) aborted: ${r.note ?? 'unknown'}` }
  })

  // ── social ───────────────────────────────────────────────────────────────────────────────────────────────
  verbs.set('party_create', async () => {
    const r = await driver.create_party()
    if (r?.party_id) ctx.party_id = r.party_id
    return { ok: ok_of(r), digest: dig_of(r), progressed: !!r?.party_id, note: r?.party_id }
  })
  verbs.set('party_invite', async (a) => {
    const r = await driver.party_invite({ party_id: ctx.party_id, ...a })
    return { ok: ok_of(r), digest: dig_of(r), progressed: ok_of(r) }
  })

  /** Direct SDK-builder path for verbs the gate Driver doesn't wrap: build → submit (money-law) → wrap. */
  async function direct(step, builder, args) {
    let tx
    try {
      tx = builder(context)({ ...args })
    } catch (e) {
      return { ok: false, note: `${step} build failed: ${String(e?.message ?? e).split('\n')[0]}` }
    }
    const res = await tracked_submit({ client, signer, tx, sender: wallet.address, budget: LOCALNET_GAS_BUDGET })
    return { ok: res.ok, digest: res.digest, progressed: res.ok, note: res.abort ?? undefined }
  }

  return {
    ctx,
    verbs,
    get_client: () => client,
    declared_missing,
    stats,
    gas_sui: () => gas_mist_total / 1e9,
    select_character: (character) => {
      ctx.ids = driver.select_character(character)
      ctx.class = character.class ?? ctx.class
      ctx.world = null
      ctx.zone = null
      return ctx.ids
    },
    // LIVE level from cumulative granted xp (mirrors the on-chain curve; the Character struct's `level`/`experience`
    // are the frozen genesis). `read_level_chain` is the raw struct read, kept for cross-checks only.
    read_level: () => experience_to_level(ctx.cumulative_xp),
    read_level_chain: () => read_level(client, ctx.ids.character_id),
  }
}
