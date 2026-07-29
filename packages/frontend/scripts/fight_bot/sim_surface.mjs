// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight_bot/sim_surface.mjs — the SIMULATOR surface (`/simulator`): the local sim chain, deterministic, no
// transaction, no gas. It owns exactly two things the world does not: choosing the opponent from the published
// corpus, and seeding the page's OWN setup store with the scenario. Everything after "the fight is open" is the
// shared loop's — this file has no assertions and no turn logic in it, on purpose.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

import { await_seams, open_page, wait_for } from './seam.mjs'
import { make_seat } from './drive.mjs'

/**
 * A mob the page is guaranteed to be able to resolve: it must exist in the published world corpus (which is
 * what the simulator's mob index is built from) AND carry a minted template id in the deployment pin. The
 * URL shape is `asset_url`'s own (`<aggregator>/data/<class>.json`), read off the manifest the app
 * boots from — never a second hardcoded host.
 */
const mob_name_key = (name) =>
  String(name ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

/** Published authored rows that still exist in the current /v1 lineage, joined by stable mob name. */
export const join_live_mobs = (blob, live_mobs) => {
  const live_names = new Set(live_mobs.map((mob) => mob_name_key(mob.name)).filter(Boolean))
  return Object.values(blob)
    .flatMap((world) => world.mobs ?? [])
    .filter((mob) => mob.role !== 'protector' && live_names.has(mob_name_key(mob.name ?? mob.key)))
    .map((mob) => {
      const key = mob.key ?? mob_name_key(mob.name)
      return {
        key,
        // The simulator corpus is itself stable-keyed; `template_id` is its persisted field name, not a Sui id.
        id: key,
        name: mob.name ?? key,
        level: Number(mob.minLevel ?? mob.level ?? 1),
      }
    })
    .sort((a, b) => a.level - b.level || a.key.localeCompare(b.key))
}

export const pick_mob = async ({ frontend, scenario }) => {
  const manifest = JSON.parse(readFileSync(resolve(frontend, 'public/asset_manifest.json'), 'utf8'))
  const [corpus_response, live_response] = await Promise.all([
    fetch(`${manifest.aggregator}/data/world_corpus.json`),
    fetch(`${process.env.VITE_RPC_URL ?? 'https://rpc.aresrpg.world'}/v1/encyclopedia?kind=mobs`),
  ])
  if (!corpus_response.ok)
    throw new Error(`world corpus unreachable (HTTP ${corpus_response.status}) — the bot needs published content`)
  if (!live_response.ok)
    throw new Error(`live mob view unreachable (HTTP ${live_response.status}) — the bot needs current identity`)
  const rows = join_live_mobs(await corpus_response.json(), (await live_response.json()).mobs ?? [])
  const mob = rows[scenario.mob_rank]
  if (!mob)
    throw new Error(
      `the published corpus lists ${rows.length} fightable mobs — rank ${scenario.mob_rank} is out of range`
    )
  return { ...mob, level: scenario.mob_level }
}

/**
 * Seed the page's own persisted setup (IndexedDB `aresrpg_simulator`) with the scenario: one character on the
 * first ALLY start cell, one mob on the first ENEMY start cell. Both bands come from the page's OWN board
 * derivation (`simulator/board.ts`, evaluated in the page), so the cells are legal by construction — the
 * reducer drops a placement that is not on its band, and a dropped placement is a silently empty fight.
 */
const seed_setup = async (page, mob, scenario) => {
  const board = await page.evaluate(async (seed) => {
    const { board_of } = await import(/* @vite-ignore */ '/src/simulator/board.ts')
    const derived = board_of(seed, 0)
    return { ally: [...derived.start_cells_a], enemy: [...derived.start_cells_b] }
  }, scenario.seed)
  if (!board.ally.length || !board.enemy.length)
    throw new Error(`seed ${scenario.seed} derives a board with no start bands`)

  await page.evaluate(
    async ({ seed, ally_cell, enemy_cell, mob_id, mob_level, class_id, level }) => {
      const db = await new Promise((res, rej) => {
        const request = indexedDB.open('aresrpg_simulator', 1)
        request.onupgradeneeded = () => {
          for (const store of ['roster', 'setup', 'traces'])
            if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store)
        }
        request.onsuccess = () => res(request.result)
        request.onerror = () => rej(request.error)
      })
      await new Promise((res, rej) => {
        const tx = db.transaction(['roster', 'setup'], 'readwrite')
        tx.oncomplete = res
        tx.onerror = () => rej(tx.error)
        const roster = tx.objectStore('roster')
        roster.clear()
        roster.put(
          {
            id: 'bot_seat',
            name: 'BOT',
            class_id,
            male: true,
            level,
            stat_alloc: { vitality: 400, wisdom: 0, strength: 100, intelligence: 0, chance: 0, agility: 0 },
            spell_levels: {},
            loadout: {},
          },
          'bot_seat'
        )
        tx.objectStore('setup').put(
          {
            seed,
            focus_id: 'bot_seat',
            anchor_nonce: 0,
            placements: { [ally_cell]: 'bot_seat' },
            mob_picks: { [enemy_cell]: { template_id: mob_id, level: mob_level } },
          },
          'current'
        )
      })
      db.close()
    },
    {
      seed: scenario.seed,
      ally_cell: board.ally[0],
      enemy_cell: board.enemy[0],
      mob_id: mob.id,
      mob_level: mob.level,
      class_id: scenario.class_id,
      level: scenario.level,
    }
  )
  return board
}

/**
 * Boot the simulator, seed the scenario, press START FIGHT, and hand back the ONE seat that plays it.
 * @returns {Promise<{ seats: Array<object>, seams: string[], fight_id: string }>}
 */
export const open_sim_fight = async ({ browser, base, scenario, mob, log, on_seat = () => {} }) => {
  const url = `${base}simulator?dev`
  // The sanctioned Playwright login (auth/dev_wallet.ts): a fresh, unfunded, throwaway keypair per run.
  // Nothing to fund and nothing to leak — the simulator signs no transaction at all (fight_shim.js).
  const { page, console_lines, client } = await open_page(browser, {
    dev_key: Ed25519Keypair.generate().getSecretKey(),
  })
  const seat = make_seat({ name: 'sim', page, client, console_lines })
  on_seat(seat)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.waitForSelector('canvas', { timeout: 180_000 })
  await seed_setup(page, mob, scenario)
  // The page hydrates its setup from IndexedDB at mount, so the scenario needs one reload to be picked up.
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.waitForSelector('canvas', { timeout: 180_000 })

  // THE SEAMS BEFORE THE FIGHT — a reload costs nothing here (the scenario lives in IndexedDB), whereas
  // reloading AFTER START would throw away a live fight.
  // Throws the page's OWN reason (#1255) — "logged out, no route" and "the seams lost the mount race" are the
  // same absence and different bugs, so the rig never again picks one of them by assumption.
  await await_seams(client, page, url, { log, console_lines })
  const seams = await client.seams()
  log(`[bot] DEV seams live: ${seams.join(' ')}`)

  const start = page.getByRole('button', { name: /START FIGHT/i }).first()
  await start.waitFor({ timeout: 120_000 })
  if (!(await start.isEnabled()))
    throw new Error('START FIGHT is disabled — the scenario did not hydrate (roster or mob pick dropped)')
  await start.click()

  const opened = await wait_for(client, (r) => r.my_id && r.fighters.length > 1, { timeout_ms: 120_000 })
  if (!opened) throw new Error('the fight never opened (no seat in the read)')
  log(
    `[bot] fight ${opened.fight_id} open — ${opened.fighters.length} fighters, ${opened.spellbook.length} castable spells`
  )
  return { seats: [seat], seams, fight_id: opened.fight_id }
}
