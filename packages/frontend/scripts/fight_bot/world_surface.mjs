// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight_bot/world_surface.mjs — the WORLD surface (`/game-world`): the REAL game, on testnet, where every turn
// is a signed transaction against a shared Fight object. Same seam, same policy, same assertions as the
// simulator — this file only opens the door the simulator opens for free.
//
// WHAT IS DIFFERENT HERE, and why each difference is a rule rather than a knob:
//
//   MONEY. Every commit is a transaction that burns gas. So nothing in this file retries: a create, a join or a
//   placement that comes back refused is reported and the run stops. A digest exists ⇒ gas is spent ⇒ a retry
//   spends again, and an EXECUTED failure retried is the one mistake this repo names by law.
//
//   KEYS. The seats authenticate with real testnet keys, read at RUNTIME from a file outside the repo
//   (`.dev/keys.json`, `FIGHT_BOT_KEYS` to move it). Key material is never printed, never written to the sheet,
//   never passed on a command line — it is handed to the page through `addInitScript`, which is the same door
//   e2e/world_rig.ts uses, and the sheet records the seat NAME and the derived ADDRESS only.
//
//   TIME. A placement window, a confirmation, an indexer catching up: each is seconds, not frames. Every wait
//   here is a generous fixed ceiling with an honest failure message, never a poll that gives up quietly.

import { readFileSync } from 'node:fs'

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography'

import { await_seams, open_page, wait_for } from './seam.mjs'
import { make_seat } from './drive.mjs'

/**
 * Read ONE seat's secret from the local key file. The value never leaves this function's caller as text.
 * The file is machine-local and gitignored by design, so it is present in the main checkout and ABSENT from
 * every worktree — which is what `FIGHT_BOT_KEYS` exists to say out loud, and why a missing file names it.
 */
export const seat_key = (keys_path, name) => {
  const keys = JSON.parse(
    (() => {
      try {
        return readFileSync(keys_path, 'utf8')
      } catch (error) {
        throw new Error(`no seat keys at ${keys_path} (${error.code ?? 'unreadable'}) — point FIGHT_BOT_KEYS at them`)
      }
    })()
  )
  const secret = keys[name]
  if (typeof secret !== 'string' || !secret.startsWith('suiprivkey1'))
    throw new Error(`${keys_path} carries no bech32 secret named "${name}" — set FIGHT_BOT_SEAT_A/B to seats it has`)
  return secret
}

/** The seat's public address — the only half of a key that may be logged, stored or published. */
export const address_of = (secret) =>
  Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(secret).secretKey).getPublicKey().toSuiAddress()

/** Bound a page call that talks to the chain, so a hung transaction fails with its own name instead of the run. */
const within = (promise, ms, what) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} did not settle in ${ms / 1000}s`)), ms)),
  ])

/**
 * Boot ONE authenticated world session and wait for the live game: the voxel session's rig, the bot's seam
 * doors, and a selected character (the roster boot picks one — a seat with no character cannot fight).
 */
export const boot_world_seat = async ({ browser, base, name, secret, log, timeout_ms = 240_000 }) => {
  const url = `${base}game-world?dev`
  const { page, console_lines, client } = await open_page(browser, { dev_key: secret })
  await page.addInitScript(() => {
    // The tutorial backdrop is a full-screen layer over the canvas. Both marker generations are set: this is a
    // UI preference a returning player already holds, never a gate the bot is stepping around.
    try {
      localStorage.setItem('ares_tutorial_seen_v2', '1')
      localStorage.setItem('ares_tutorial_seen', '1')
    } catch {
      /* storage unavailable — the world still boots, the backdrop just has to be skipped by hand */
    }
  })
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeout_ms })
  await page.waitForSelector('canvas', { timeout: timeout_ms })
  await page.waitForFunction(() => typeof window.__dev_start_world_fight === 'function', null, {
    timeout: timeout_ms,
    polling: 1000,
  })
  const character = await page
    .waitForFunction(
      async () => {
        const { context } = await import('/src/game/store.js')
        return context.get_state().selected_character_id ?? false
      },
      null,
      { timeout: timeout_ms, polling: 1000 }
    )
    .then((handle) => handle.jsonValue())
  log(
    `[bot] seat ${name} booted — address ${address_of(secret).slice(0, 10)}…, character ${String(character).slice(0, 10)}…`
  )
  return { name, page, console_lines, client, character_id: character, address: address_of(secret) }
}

/**
 * CREATE a world fight over a live discovered mob group. `__dev_start_world_fight` (embed_voxel_dev.js) is the
 * production path — `create_world_fight` → `enter_world_fight`, the same two calls the world's own engage click
 * fires — and it lets the transaction choke's dry run refuse an out-of-zone spawn for FREE, so the first
 * claimable group in reach is the one that actually executes.
 */
export const create_world_fight = async ({ seat, log, timeout_ms = 420_000 }) => {
  log(`[bot] seat ${seat.name}: claiming a mob group (dry-run scan — out-of-zone spawns refuse for free)`)
  const fight_id = await within(
    seat.page.evaluate(() => window.__dev_start_world_fight()),
    timeout_ms,
    'the world-fight create'
  )
  if (!fight_id) {
    // #1263 — the scan's own verdict, never a guessed cause: `strand` (the character cannot claim ANYWHERE,
    // e.g. it is not in the seat's kiosk) reads nothing like `exhausted` (every reachable group is taken).
    const scan = await seat.page.evaluate(() => window.__dev_last_world_fight_scan ?? null).catch(() => null)
    throw new Error(
      scan
        ? `no fight claimed (${scan.verdict}): tried ${scan.attempted} groups, skipped ${scan.skipped_zones} out-of-reach zones — ${scan.reason ?? 'every reachable group is already claimed'}`
        : 'no claimable mob group in reach — the seat’s checkpoint zone holds no unclaimed group, or the zone reads came back empty'
    )
  }
  log(`[bot] seat ${seat.name}: fight ${fight_id} created`)
  return fight_id
}

/** JOIN an open PUBLIC world fight as a SECOND seat — the coop half, through the seam's production join door. */
export const join_world_fight = async ({ seat, fight_id, log, timeout_ms = 300_000 }) => {
  // The join door is WORLD-ONLY by construction (dev_world_entry.js — the zero-drift gate's world-only ratchet
  // forbids the simulator's closure reaching the chain entry), so it is registered from GameWorldHud rather than
  // beside the other bot seams. If that registration is missing, say exactly that instead of failing on a
  // TypeError about `undefined`.
  if (!(await seat.page.evaluate(() => typeof window.__ARES_DEV_WORLD_JOIN === 'function')))
    throw new Error(
      'no __ARES_DEV_WORLD_JOIN on this build — GameWorldHud must register game/dev/dev_world_entry.js beside the other DEV seams (see that file’s header for the exact three lines)'
    )
  log(`[bot] seat ${seat.name}: joining fight ${fight_id}`)
  const result = await within(seat.client.join(fight_id), timeout_ms, 'the world-fight join')
  // NO RETRY. A join that came back refused either never signed (free) or executed and failed (paid); both are
  // reported, neither is attempted twice.
  if (!result?.ok)
    throw new Error(`seat ${seat.name} could not join ${fight_id}: ${result?.error ?? 'unknown refusal'}`)
  log(`[bot] seat ${seat.name}: joined (status ${result.status})`)
  return result
}

/**
 * TAKE A START CELL. `place` is place-and-ready in one signature and the LAST ready starts the fight, so the
 * order across seats is load-bearing: every seat must be seated before any seat readies.
 *
 * OCCUPANCY IS BOTH CLOCKS, and coop is what proves it. `turns::place` aborts with EBadStartCell(104) on a cell
 * that is not a near-side start OR is already occupied — and a joiner is seated on a start cell the moment its
 * join lands, BEFORE anything about it is committed. Reading only the committed fold therefore saw an empty band
 * and sent the creator onto the joiner's cell (measured: the first coop run died exactly there). Every fighter
 * that is not me holds its cell under whichever clock reports it.
 */
export const place_seat = async ({ seat, log, timeout_ms = 300_000 }) => {
  const read = await wait_for(seat.client, (r) => r.placement && r.placement_cells.length > 0, { timeout_ms: 120_000 })
  if (!read) throw new Error(`seat ${seat.name}: the placement window never opened (no start band in the read)`)
  const taken = new Set(
    read.fighters
      .filter((f) => f.id !== read.my_id)
      .flatMap((f) => [f.cell_committed, f.cell])
      .filter(Boolean)
      .map((c) => `${c.x},${c.y}`)
  )
  const free = read.placement_cells.filter((c) => !taken.has(`${c.x},${c.y}`))
  if (!free.length)
    throw new Error(`seat ${seat.name}: every one of the ${read.placement_cells.length} start cells is occupied`)
  const [cell] = free
  log(`[bot] seat ${seat.name}: placing on ${cell.x},${cell.y} (${free.length} of ${read.placement_cells.length} free)`)
  const result = await within(seat.client.place(cell), timeout_ms, `seat ${seat.name}'s placement`)
  if (!result?.ok)
    throw new Error(`seat ${seat.name} could not place on ${cell.x},${cell.y}: ${result?.error ?? 'unknown refusal'}`)
  return cell
}

/** RELEASE a fight this run opened and did not finish, so the seat is free for the next one. */
export const abandon_fight = async ({ seat, log, timeout_ms = 300_000 }) => {
  const result = await within(seat.client.abandon(), timeout_ms, `seat ${seat.name}'s forfeit`).catch((error) => ({
    ok: false,
    error: String(error?.message ?? error),
  }))
  log(`[bot] seat ${seat.name}: ${result.ok ? 'fight released (forfeit)' : `forfeit refused — ${result.error}`}`)
  return result
}

/**
 * Open a WORLD fight and hand back its seats, ready to play. One seat name = solo world mode; two = coop.
 * `on_seat` receives each seat the MOMENT it boots — the caller registers it there so a failure DURING the
 * opening still ends with that page's console on disk (the first coop run failed at the create and left no
 * console at all, which is the one artefact that would have explained it).
 * @returns {Promise<{ seats: Array<object>, seams: string[], fight_id: string, addresses: Record<string,string> }>}
 */
export const open_world_fight = async ({ browser, base, keys_path, seat_names, log, on_seat = () => {} }) => {
  const booted = []
  for (const name of seat_names) {
    // ONE seat object per seat, built here and handed out once: registering a copy and playing another would
    // give the run two different memories for the same player.
    const seat = make_seat(await boot_world_seat({ browser, base, name, secret: seat_key(keys_path, name), log }))
    booted.push(seat)
    on_seat(seat)
    const url = `${base}game-world?dev`
    // Throws the page's own reason (#1255); the seat is named on the way out so a coop run says WHICH client.
    await await_seams(seat.client, seat.page, url, { log, console_lines: seat.console_lines }).catch((error) => {
      throw new Error(`seat ${name}: ${String(error?.message ?? error)}`)
    })
  }
  const [creator, ...joiners] = booted
  const seams = await creator.client.seams()
  log(`[bot] DEV seams live: ${seams.join(' ')}`)

  const fight_id = await create_world_fight({ seat: creator, log })
  // EVERY SEAT SEATED BEFORE ANY SEAT READIES — a placement is also a ready, and the last ready starts the
  // fight, so a joiner arriving after the creator's placement arrives after the door closed.
  for (const joiner of joiners) await join_world_fight({ seat: joiner, fight_id, log })
  for (const seat of booted) await place_seat({ seat, log })

  const opened = await wait_for(creator.client, (r) => !r.placement && r.my_id && r.fighters.length > 1, {
    timeout_ms: 300_000,
  })
  if (!opened) throw new Error('the fight never left placement (no ACTIVE board in the read)')
  log(
    `[bot] fight ${fight_id} ACTIVE — ${opened.fighters.length} fighters, ${opened.spellbook.length} castable spells for ${creator.name}`
  )
  return {
    seats: booted,
    seams,
    fight_id,
    addresses: Object.fromEntries(booted.map((seat) => [seat.name, seat.address])),
  }
}
