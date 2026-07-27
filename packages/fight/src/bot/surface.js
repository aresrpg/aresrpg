// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// bot/surface.js — WHY the drive seams are missing (#1255). Pure, browser-blind: it takes what the page says
// about itself and returns the sentence an operator should read.
//
// The bug it exists to close was a DIAGNOSIS bug, not a seam bug. `/simulator` lives inside the app's
// authenticated `Layout` (app.tsx), so a page whose DEV login did not take renders the SPECTATE LANDING
// instead — no route, no BoardPane, and therefore no `register_sim_dev_seams` by construction. The rig used
// to measure the missing seams, reload three times (147s, measured) and report "the bot seams never
// registered" — true, useless, and pointing at the one file that was never broken. A P1 was filed against the
// seam chain on the strength of that sentence.
//
// So the page names its own state and this function reads it: `<html data-ares-dev-login>` (written by the
// DEV branch of frontend src/auth/index.ts) and `[data-spectate-landing]` (written by app.tsx where it picks
// the landing over Layout). Both are DEV-inert markers, never behaviour.

/**
 * @typedef {object} SurfaceReading what the page answers about itself
 * @property {boolean} seams_ready both `__ARES_DEV_READ` and `__ARES_DEV_TURN` are functions
 * @property {string | null} dev_login `<html data-ares-dev-login>`: 'ok', 'failed: <reason>', or null when
 *   the DEV login was never attempted (no key reached the boot)
 * @property {boolean} logged_out the app rendered the spectate landing instead of the routed Layout
 */

/** The seam names the rig waits on — quoted in the residual verdict so it stays greppable. */
export const DRIVE_SEAMS = '__ARES_DEV_READ / __ARES_DEV_TURN'

/**
 * Why can this page not be driven? `null` when it can.
 * @param {SurfaceReading} reading
 * @returns {string | null}
 */
export function seam_failure(reading) {
  const { seams_ready, dev_login, logged_out } = reading
  if (seams_ready) return null
  return `the bot seams (${DRIVE_SEAMS}) never registered`
}

/**
 * Is another mount worth paying for? A logged-out page is not a race — reloading it three times buys nothing
 * but the 147s the rig used to spend before saying the wrong thing.
 * @param {SurfaceReading} reading
 * @returns {boolean}
 */
export function worth_remounting(reading) {
  return !reading.seams_ready
}
