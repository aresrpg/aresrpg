// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight_bot/world_search.mjs — THE SEARCH LEG (#1184): the drive provisions its own zone instead of depending
// on one being fresh.
//
// The first full-gate coop run refused honestly at setup — "no claimable mob group in reach", zero gas, correct
// exit — because the night's play had consumed the checkpoint zone's groups. That refusal is right and it is
// also a dead end: a drive that only runs on a rested world is not a gate. So when the dry-scan finds nothing,
// this leg pulls the [F] search lever where the chain accepts one, rescans, and walks one zone over when it
// does not — bounded at three hops.
//
// THE SPLIT, same as everywhere else in this rig: the DECISION is pure and fixture-tested
// (`@aresrpg/fight/bot`'s `plan_provision`), and this file only performs it against the app's own seams
// (`__ARES_DEV_WORLD_SCOUT` / `_SEARCH` / `_WALK`, registered by game/dev/dev_world_entry.js).
//
// MONEY. Every `search` row is a real transaction against a terminal `&Random` entry that cannot be dry-run.
// Nothing here retries one: a press either never signed (free) or executed (paid), and both are reported. The
// digests of everything a seat fired are read straight off the page's own `window.__TX_TIMINGS` ledger.

import { plan_provision, zone_key_of } from '@aresrpg/fight/bot'

// The zone-grid ↔ world-point conversion has ONE home — the landed scouter's pure core, which imports nothing
// and so loads under bare node exactly as it loads in the browser.
import { zone_center_world } from '../../src/game/dev/auto_search.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Every transaction this page has fired, newest last — klass + digest only (world-shell/tx.js's own ledger). */
export const tx_digests = (seat) =>
  seat.page
    .evaluate(() => (window.__TX_TIMINGS ?? []).map(({ klass, digest }) => ({ klass, digest })))
    .catch(() => [])

/** The digests a page fired since `mark` — what one leg cost, without re-reading the whole run's ledger. */
const digests_since = async (seat, mark) => (await tx_digests(seat)).slice(mark)

const scout_of = (seat) => seat.page.evaluate(() => window.__ARES_DEV_WORLD_SCOUT())

/**
 * Walk to a zone and wait to be standing in it. Arrival is the STANDING ZONE, not the centre — crossing the
 * boundary is what re-arms [F], and holding out for the exact centre would fail a leg that already succeeded.
 * The lever then takes a beat to arm (its gate reads the /v1 zones view, which polls), so the wait continues
 * until the lever answers or the ceiling elapses — an unarmed lever is a real answer, not a stall.
 */
const walk_to_zone = async ({ seat, target, log, leg_ms = 240_000, arm_ms = 30_000 }) => {
  const here = await scout_of(seat)
  const point = {
    x: zone_center_world(target.zx, here.zone_size, here.offset_x),
    z: zone_center_world(target.zy, here.zone_size, here.offset_z),
  }
  log(`[bot] seat ${seat.name}: walking to zone ${zone_key_of(target.zx, target.zy)} (${point.x}, ${point.z})`)
  await seat.page.evaluate((p) => window.__ARES_DEV_WORLD_WALK(p), point)
  const deadline = Date.now() + leg_ms
  while (Date.now() < deadline) {
    await sleep(2000)
    const scout = await scout_of(seat).catch(() => null)
    if (scout?.zone?.zx === target.zx && scout.zone.zy === target.zy) {
      const armed_by = Date.now() + arm_ms
      while (Date.now() < armed_by && !(await scout_of(seat).catch(() => null))?.prompt_armed) await sleep(2000)
      // stop the body: the leg is over, and a still-running walk would drag it out of the zone it just entered
      await seat.page.evaluate(() => window.__ARES_DEV_WORLD_WALK(null))
      return { ok: true }
    }
  }
  await seat.page.evaluate(() => window.__ARES_DEV_WORLD_WALK(null))
  return { ok: false, error: `the body never reached zone ${zone_key_of(target.zx, target.zy)} in ${leg_ms / 1000}s` }
}

/**
 * PROVISION a claimable mob group for `seat`, then hand back the fight the scan claimed.
 *
 * `claim` is the caller's dry-scan — the production create path, whose refusals are free — and it runs FIRST:
 * a zone that already holds an unclaimed group is never paid for. Every later attempt costs one search
 * transaction, and the whole run is bounded by `plan_provision` (three hops).
 *
 * @param {{ seat: object, claim: () => Promise<string|null>, log: Function, max_hops?: number }} args
 * @returns {Promise<{ fight_id: string|null, attempts: Array<object>, digests: Array<object>, why?: string }>}
 */
export const provision_fight = async ({ seat, claim, log, max_hops = 3 }) => {
  const mark = (await tx_digests(seat)).length
  const memory = { hops: 0, tried: [] }
  const attempts = []
  for (;;) {
    const fight_id = await claim()
    if (fight_id) return { fight_id, attempts, digests: await digests_since(seat, mark) }
    const scout = await scout_of(seat)
    const command = plan_provision(scout, memory, { max_hops })
    attempts.push({ at: scout.zone, prompt_armed: !!scout.prompt_armed, command })
    if (command.kind === 'exhausted') {
      log(`[bot] seat ${seat.name}: search leg exhausted — ${command.why}`)
      return { fight_id: null, attempts, digests: await digests_since(seat, mark), why: command.why }
    }
    if (command.kind === 'hop') {
      memory.hops += 1
      const walked = await walk_to_zone({ seat, target: command, log })
      // A leg that never arrived retires that zone: re-picking it would walk the same failing path again.
      if (!walked.ok) {
        log(`[bot] seat ${seat.name}: ${walked.error}`)
        memory.tried.push(zone_key_of(command.zx, command.zy))
      }
      continue
    }
    log(`[bot] seat ${seat.name}: searching zone ${zone_key_of(command.zx, command.zy)} (a real SUI transaction)`)
    const searched = await seat.page.evaluate(() => window.__ARES_DEV_WORLD_SEARCH())
    // NO RETRY, whichever way it went — the zone is retired either way, and the next loop rescans for free.
    memory.tried.push(zone_key_of(command.zx, command.zy))
    attempts.at(-1).result = searched
    log(
      `[bot] seat ${seat.name}: search ${searched.ok ? `revealed ${zone_key_of(searched.zx, searched.zy)}` : `refused — ${searched.error}`}`
    )
  }
}
