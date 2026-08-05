// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Party proof — every declared party MoveAbort renders HUMANIZED, never a raw abort code / English /
// "[object Object]".
// Exercises the exact chain party_store now uses: party_actions throws `tx_error(raw)` (human .message + the
// structured abort on .cause), party_store sets `humanize_abort(error)`, and the abort_copy `party` arm maps the
// code 201..212 → an i18n key → translated copy. Standalone (no store/game imports, no mocks).
import { describe, expect, test } from 'bun:test'

import i18n from '../i18n'
import { humanize_abort, tx_error, parse_move_abort } from '../game/core/abort_copy.js'

// The EXACT gRPC Core structured error shape a self-pay party tx surfaces (mirrors abort_copy.test.js).
const grpc_party_abort = (code) => ({
  $kind: 'MoveAbort',
  message: `MoveAbort in 1st command, abort code: ${code}, in '0xsocial::party::invite' (instruction 7)`,
  command: 0,
  MoveAbort: {
    abortCode: String(code),
    location: { package: '0xsocial', module: 'party', function: 3, instruction: 7, functionName: 'invite' },
  },
})

// module='party', codes → keys (mirrors abort_copy.js TABLE.party + all declared Move errors)
const CASES = [
  [201, 'errors.party_not_leader'],
  [202, 'errors.party_already_member'],
  [203, 'errors.party_already_invited'],
  [204, 'errors.party_full'],
  [205, 'errors.party_invite_not_found'],
  [206, 'errors.party_not_member'],
  [207, 'errors.party_cannot_kick_leader'],
  [208, 'errors.party_leader_alone'],
  [209, 'errors.party_wrong_kiosk_cap'],
  [210, 'errors.party_character_not_owned'],
  [211, 'errors.party_character_not_owned'],
  [212, 'errors.party_not_solo'],
]

describe('party aborts humanize (audit row 3 — party_store no longer shows raw codes/English)', () => {
  for (const [code, key] of CASES) {
    test(`abort ${code} → the mapped i18n copy (structured gRPC shape)`, () => {
      const copy = humanize_abort(grpc_party_abort(code))
      // maps to the SAME string i18n resolves for the key (proves TABLE.party → key → translated copy)
      expect(copy).toBe(i18n.t(key))
      // never the raw key, never jargon
      expect(copy).not.toBe(key)
      expect(copy).not.toContain('MoveAbort')
      expect(copy).not.toContain('[object Object]')
    })
  }

  test('the full party_actions→party_store chain: tx_error(raw) then humanize_abort(error) still maps', () => {
    // party_actions.js now throws this; party_store.js now calls humanize_abort on it.
    const thrown = tx_error(grpc_party_abort(204))
    // party_actions' toast reads .message — already humanized at the throw site
    expect(thrown.message).toBe(i18n.t('errors.party_full'))
    // party_store's decoder digs the structured abort off .cause and maps it (idempotent)
    expect(humanize_abort(thrown)).toBe(i18n.t('errors.party_full'))
    expect(parse_move_abort(thrown)).toEqual({ module: 'party', code: 204, package: '0xsocial' })
  })

  test('a client-side party throw (non-chain) passes through untouched, never raw-jargon', () => {
    // e.g. create()'s "create_party did not return a Party id" invariant — humanize leaves a human string as-is.
    expect(humanize_abort(new Error('create_party did not return a Party id'))).toBe(
      'create_party did not return a Party id'
    )
  })
})

// #1135 — "party invite refused, unrecognized version rule". EVERY party door (create/invite/accept/decline/
// kick/leave/disband) opens with `version::assert_party_character_type<Character>` BEFORE any party code runs,
// so the abort's MoveLocation names the module `version`, not `party`. The decoder mapped only 101/102 there,
// so the social package's own party-brand gates (103 ECharacterTypeNotSet / 104 EWrongCharacterType) fell to
// `tx_refusal_reason_unmapped` — "Unhandled version error (code 103)" — the raw module+code jargon the owner
// read back as an "unrecognized version rule". The refusal is honest copy now; the codes stay STRUCTURAL.
const grpc_version_abort = (code) => ({
  $kind: 'MoveAbort',
  message: `MoveAbort in 0th command, abort code: ${code}, in '0xsocial::version::assert_party_character_type' (instruction 4)`,
  command: 0,
  MoveAbort: {
    abortCode: String(code),
    location: {
      package: '0xsocial',
      module: 'version',
      function: 5,
      instruction: 4,
      functionName: 'assert_party_character_type',
    },
  },
})

describe('#1135 — the social party-brand gate aborts on module `version`, and must not leak module+code jargon', () => {
  for (const [code, key] of [
    [103, 'errors.party_service_unconfigured'], // ECharacterTypeNotSet — the brand pin was never written
    [104, 'errors.party_character_lineage'], // EWrongCharacterType — the client's Character lineage isn't the pinned one
  ]) {
    test(`version abort ${code} → mapped party copy, never "Unhandled version error"`, () => {
      const copy = humanize_abort(grpc_version_abort(code))
      expect(copy).toBe(i18n.t(key))
      expect(copy).not.toBe(key)
      expect(copy).not.toContain('version')
      expect(copy).not.toContain(String(code))
    })
  }

  test('the PRE-FLIGHT refusal (the shape the invite actually takes) carries no module+code reason line', () => {
    // A dry-run refusal is where the unmapped arm appends `Reason: Unhandled {{module}} error (code {{code}}).`
    const thrown = tx_error(grpc_version_abort(103), { preflight: true })
    expect(thrown.message).toBe(i18n.t('errors.party_service_unconfigured'))
    expect(thrown.message).not.toContain('code 103')
    expect(parse_move_abort(thrown)).toEqual({ module: 'version', code: 103, package: '0xsocial' })
  })

  test('the package-lineage gates keep their own copy — a party brand refusal is not "world updated"', () => {
    // 101 EWrongVersion / 102 ENotEnabled stay exactly what they were (no copy was re-homed).
    expect(humanize_abort(grpc_version_abort(101))).toBe(i18n.t('errors.world_version_changed'))
    expect(humanize_abort(grpc_version_abort(102))).toBe(i18n.t('errors.contracts_paused'))
  })
})
