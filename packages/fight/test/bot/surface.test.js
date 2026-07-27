// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The #1255 regression: an unauthenticated page must name AUTH, never the seam chain.
//
// The reported symptom was `__ARES_DEV_READ` missing on /simulator?dev. The seam chain was fine; the page was
// logged out, which removes the whole route. The rig's sentence sent a P1 at the innocent file, so these rows
// pin the sentence itself.

import { describe, expect, it } from 'bun:test'

import { seam_failure, worth_remounting } from '../../src/bot/surface.js'

const reading = (over) => ({ seams_ready: false, dev_login: null, logged_out: false, ...over })

describe('seam_failure', () => {
  it('is silent when the seams are live', () => {
    expect(seam_failure(reading({ seams_ready: true }))).toBeNull()
  })

  it('names the DEV login and quotes its reason when the login was rejected', () => {
    const verdict = seam_failure(reading({ dev_login: 'failed: Unknown letter: "i"', logged_out: true }))
    expect(verdict).toContain('DEV login')
    expect(verdict).toContain('Unknown letter: "i"')
    // The lie the rig used to tell — the seam chain is exonerated here, in executable form.
    expect(verdict).not.toContain('__ARES_DEV_READ')
  })

  it('names the missing key when the landing is up and no login was ever attempted', () => {
    const verdict = seam_failure(reading({ dev_login: null, logged_out: true }))
    expect(verdict).toContain('logged out')
    expect(verdict).toContain('__ARES_DEV_KEY')
    expect(verdict).not.toContain('never registered')
  })

  it('still blames the seams when the page IS authenticated — the residual case', () => {
    const verdict = seam_failure(reading({ dev_login: 'ok', logged_out: false }))
    expect(verdict).toContain('__ARES_DEV_READ')
    expect(verdict).toContain('never registered')
  })
})

describe('worth_remounting', () => {
  it('reloads an authenticated page — the registration really can lose the double-mount race', () => {
    expect(worth_remounting(reading({ dev_login: 'ok' }))).toBe(true)
  })

  it('never reloads a logged-out page — three mounts of a page with no route bought 147s of nothing', () => {
    expect(worth_remounting(reading({ logged_out: true }))).toBe(false)
    expect(worth_remounting(reading({ dev_login: 'failed: bad key', logged_out: true }))).toBe(false)
  })

  it('stops the moment the seams are live', () => {
    expect(worth_remounting(reading({ seams_ready: true }))).toBe(false)
  })
})
