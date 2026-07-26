// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight_bot/seam.mjs — (a) THE SEAM CLIENT: a thin wrapper over the DEV window seams. It transports; it never
// decides. Split out of fight_bot.mjs when the bot grew a second and third surface (world, coop): the seam is
// the ONE thing all of them share, and a transport copied per surface is how two surfaces start disagreeing.

/** Every door the bot drives, on whichever surface the page happens to be. */
export const seam_client = (page) => ({
  /** Are the bot's doors registered yet? (The seam tree is lazily imported behind the DEV gate.) */
  ready: () =>
    page.evaluate(() => typeof window.__ARES_DEV_READ === 'function' && typeof window.__ARES_DEV_TURN === 'function'),
  /** Every DEV seam this build exposes — the enumeration the brief asks a driver to take, not assume. */
  seams: () =>
    page.evaluate(() =>
      Object.keys(window)
        .filter((k) => k.startsWith('__ARES_DEV_'))
        .sort()
    ),
  read: () => page.evaluate(() => window.__ARES_DEV_READ()),
  /** Commit one whole player turn. `expect` riders are stripped: the seam takes kind/cell/spell_id only. */
  commit: (actions) =>
    page.evaluate(
      (rows) => window.__ARES_DEV_TURN(rows),
      actions.map(({ kind, cell, spell_id }) => ({ kind, cell, ...(spell_id ? { spell_id } : {}) }))
    ),
  /** Take a start cell in the placement window (world surface only — the simulator seeds its placements). */
  place: (cell) => page.evaluate((c) => window.__ARES_DEV_PLACE(c), cell),
  /** Seat this page's character in an already-open PUBLIC world fight (the coop second seat's only door). */
  join: (fight_id) => page.evaluate((id) => window.__ARES_DEV_WORLD_JOIN(id), fight_id),
  /** Forfeit the live fight — how a chain-backed run releases a seat it did not finish. */
  abandon: () => page.evaluate(() => window.__ARES_DEV_ABANDON()),
})

/** Wait until `predicate(read)` holds, polling the seam. Returns the read, or null on timeout. */
export const wait_for = async (client, predicate, { timeout_ms = 60_000, poll_ms = 400 } = {}) => {
  const deadline = Date.now() + timeout_ms
  while (Date.now() < deadline) {
    const read = await client.read().catch(() => null)
    if (read?.ok && predicate(read)) return read
    await new Promise((r) => setTimeout(r, poll_ms))
  }
  return null
}

/** Wait for an HTTP endpoint to answer — the dev server's readiness, never a fixed sleep. */
export const wait_for_server = async (url, timeout_ms = 120_000) => {
  const deadline = Date.now() + timeout_ms
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`dev server never became ready at ${url}`)
}

/**
 * Open a page with the console captured and a dev key injected, and wait for the bot's doors to register.
 * REGISTRATION RACES A DOUBLE MOUNT: it is a lazy dynamic import fired from the board viewport's mount and
 * guarded by its own destroy flag, so React's dev double-mount can race it away (observed: one run in four
 * booted a working board with no seams on it). A reload re-runs the mount; the caller decides whether that is
 * safe (it is before a fight starts, never after).
 */
export const open_page = async (browser, { dev_key, viewport = { width: 1400, height: 900 } }) => {
  const page = await browser.newPage({ viewport })
  const console_lines = []
  page.on('console', (m) => console_lines.push(`[${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => console_lines.push(`[pageerror] ${String(e?.message ?? e)}`))
  if (dev_key)
    await page.addInitScript((key) => {
      window.__ARES_DEV_KEY = key
    }, dev_key)
  return { page, console_lines, client: seam_client(page) }
}

/** Reload until the drive seams register, up to `attempts` mounts. Returns whether they are live. */
export const await_seams = async (client, page, url, { attempts = 3, log = () => {} } = {}) => {
  for (let attempt = 1; attempt <= attempts && !(await client.ready()); attempt++) {
    await page
      .waitForFunction(
        () => typeof window.__ARES_DEV_READ === 'function' && typeof window.__ARES_DEV_TURN === 'function',
        null,
        { timeout: 45_000, polling: 1000 }
      )
      .catch(() => {})
    if (await client.ready()) break
    log(`[bot] the drive seams did not register on mount ${attempt} — reloading`)
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180_000 })
    await page.waitForSelector('canvas', { timeout: 180_000 })
  }
  return client.ready()
}
