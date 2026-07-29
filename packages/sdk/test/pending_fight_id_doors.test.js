// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// THE PENDING FENCE, COUNTED (#1609). A pending session id (`pending:<uuid>` — the branded identity a fight
// mounts under before its create transaction finalizes) must never reach a chain write door. This gate is a
// CENSUS, not a sample: the door population is derived MECHANICALLY from the two builder modules that compose
// fight-scoped PTBs, so a door added tomorrow joins the population automatically and fails until it refuses.
//
// Shape mirrors #1633's deployed-signature census (`scripts/move_signature_doors.mjs` + write_move_signatures):
// enumerate every door, assert each one, and refuse to run at all on an empty/short scan. #1633's own 64-door
// census covers `src/sui/write/*.js` and contains exactly ONE fight-domain door (`dungeon::abandon`, which takes
// a RunPass and no fight_id) — the fight_id population lives entirely in `src/fight.js` + `src/dungeon.js`, so
// this file is that census's missing fight half rather than a duplicate of it.

import { describe, expect, test } from 'bun:test'
import { readFileSync as read_file_sync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath as file_url_to_path } from 'node:url'

import * as fight_doors from '../src/fight.js'
import * as dungeon_doors from '../src/dungeon.js'
import {
  PENDING_FIGHT_ID_ERROR_CODE,
  is_pending_fight_id,
  new_pending_fight_id,
} from '../src/pending_fight_id.js'

import { deployed_context, id } from './_onchain_fixtures.js'

const here = path.dirname(file_url_to_path(import.meta.url))

// The two builder modules that compose fight-scoped PTBs, with the namespace each door is called through.
const DOOR_MODULES = [
  { file: '../src/fight.js', exports: fight_doors },
  { file: '../src/dungeon.js', exports: dungeon_doors },
]

/**
 * Every exported `*_ptb(context)` builder whose returned composer destructures `fight_id`. Source-derived on
 * purpose: the population is the CODE, not a hand-kept list that can silently fall behind it.
 * @param {string} source
 * @returns {string[]}
 */
export function fight_id_doors_in(source) {
  const doors = []
  const declaration =
    /export function (\w+_ptb)\(context\)\s*\{[\s\S]*?return \(\{([\s\S]*?)\}\)\s*=>/g
  let match
  while ((match = declaration.exec(source)))
    if (/\bfight_id\b/.test(match[2])) doors.push(match[1])
  return doors
}

const census = DOOR_MODULES.flatMap(({ file, exports }) => {
  const source = read_file_sync(path.join(here, file), 'utf8')
  return fight_id_doors_in(source).map(name => ({
    id: `${path.basename(file, '.js')}::${name}`,
    name,
    build: exports[name],
  }))
})

// THE POSITIVE CONTROL (instruments THROW, never a plausible 0). A scan that silently matched nothing — a
// refactor to arrow exports, a formatting change the regex missed — would make every assertion below vacuous.
// The pinned floor is the population measured when this gate landed; it may only ever GROW.
const CENSUSED_DOORS = 14

// One minimal, otherwise-valid argument set per door. Everything except `fight_id` is a well-formed id, so the
// ONLY thing that can make a build throw is the pending brand.
const kiosk = { kiosk_id: id('kiosk'), personal_kiosk_cap_id: id('pkcap') }
const seat = { character_id: id('character') }
/** @type {Record<string, (fight_id: string) => object>} */
const ARGUMENTS_OF = {
  'fight::join_fight_ptb': fight_id => ({ ...kiosk, ...seat, fight_id }),
  'fight::place_ptb': fight_id => ({ ...seat, fight_id, cell: 3 }),
  'fight::force_start_ptb': fight_id => ({ fight_id }),
  'fight::crank_ptb': fight_id => ({ fight_id }),
  'fight::act_move_ptb': fight_id => ({ ...seat, fight_id, cell: 3 }),
  'fight::act_weapon_ptb': fight_id => ({ ...seat, fight_id, target_cell: 4 }),
  'fight::act_cast_ptb': fight_id => ({
    ...seat,
    fight_id,
    spell_template_id: id('spell'),
    target_cell: 4,
  }),
  'fight::act_pass_ptb': fight_id => ({ ...seat, fight_id }),
  'fight::commit_turn_ptb': fight_id => ({ ...seat, fight_id, actions: [] }),
  'fight::abandon_fight_ptb': fight_id => ({ ...seat, fight_id }),
  'fight::settle_fight_ptb': fight_id => ({ fight_id }),
  'fight::settle_and_take_ptb': fight_id => ({ ...seat, fight_id }),
  'fight::settle_open_world_ptb': fight_id => ({
    ...kiosk,
    ...seat,
    fight_id,
    lost_group: null,
  }),
  'dungeon::join_fight_ptb': fight_id => ({
    ...kiosk,
    ...seat,
    fight_id,
    run_pass_id: id('run-pass'),
    creator_pass_id: id('creator-pass'),
  }),
}

describe('pending fight id — the brand', () => {
  test('is branded, unique, and structurally un-chain-able', () => {
    const a = new_pending_fight_id()
    const b = new_pending_fight_id()
    expect(a).not.toBe(b)
    expect(a.startsWith('pending:')).toBe(true)
    expect(a.startsWith('0x')).toBe(false)
    expect(is_pending_fight_id(a)).toBe(true)
  })

  test('a real object id is never mistaken for a pending one', () => {
    expect(is_pending_fight_id(id('fight'))).toBe(false)
    expect(is_pending_fight_id(null)).toBe(false)
    expect(is_pending_fight_id(42)).toBe(false)
    expect(is_pending_fight_id({ objectId: new_pending_fight_id() })).toBe(false)
  })
})

describe('pending fight id — the write-door census', () => {
  test(`the scan found the full door population (${CENSUSED_DOORS})`, () => {
    // A short scan means the derivation broke, not that doors vanished — fail here rather than pass vacuously.
    expect(census.length).toBeGreaterThanOrEqual(CENSUSED_DOORS)
    expect(census.every(door => typeof door.build === 'function')).toBe(true)
    expect(census.every(door => ARGUMENTS_OF[door.id] != null)).toBe(true)
  })

  for (const door of census)
    test(`${door.id} refuses a pending session id`, () => {
      const pending = new_pending_fight_id()
      let thrown = null
      try {
        door.build(deployed_context)(ARGUMENTS_OF[door.id](pending))
      } catch (error) {
        thrown = error
      }
      expect(thrown).not.toBeNull()
      expect(thrown.code).toBe(PENDING_FIGHT_ID_ERROR_CODE)
      expect(thrown.value).toBe(pending)
    })

  for (const door of census)
    test(`${door.id} still composes with a real object id`, () => {
      // The other half of red-first: the refusal must be the BRAND, never the door being broken outright.
      expect(() =>
        door.build(deployed_context)(ARGUMENTS_OF[door.id](id('fight'))),
      ).not.toThrow()
    })
})
